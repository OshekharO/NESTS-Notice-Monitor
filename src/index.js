import * as cheerio from "cheerio";

const NESTS_URL =
  "https://nests.tribal.gov.in/show_content.php?lang=1&level=0&ls_id=15&lid=13";

const NOTIFY_URL =
  "https://contact.oshekher.workers.dev/f/contact";

const TIME_ZONE = "Asia/Kolkata";


/**
 * Get today's date in the exact format
 * used by the NESTS website.
 *
 * Example:
 * 09 Sep 2026
 */
function getToday() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const year = parts.find(
    (part) => part.type === "year"
  ).value;

  const month = parts.find(
    (part) => part.type === "month"
  ).value;

  const day = parts.find(
    (part) => part.type === "day"
  ).value;

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];

  return `${day} ${months[Number(month) - 1]} ${year}`;
}


/**
 * Clean whitespace from scraped text.
 */
function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Fetch NESTS page.
 */
async function fetchNests() {
  console.log("Fetching NESTS...");

  const response = await fetch(NESTS_URL, {
    method: "GET",

    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

      "Accept-Language":
        "en-US,en;q=0.9"
    }
  });

  if (!response.ok) {
    throw new Error(
      `NESTS returned HTTP ${response.status}`
    );
  }

  const html = await response.text();

  console.log(
    `NESTS response received: ${html.length} bytes`
  );

  return html;
}


/**
 * Extract notices whose date equals today.
 */
function extractTodaysNotices(html, today) {
  const $ = cheerio.load(html);

  const notices = [];

  console.log(
    `Looking for notices dated: ${today}`
  );

  $("tr").each((index, element) => {
    const row = $(element);

    const cells = row.find("td");

    if (cells.length === 0) {
      return;
    }

    /*
     * Date is the last <td>.
     */
    const date = cleanText(
      cells.last().text()
    );

    /*
     * Log rows for debugging.
     */
    console.log(
      `Row ${index}: ${date}`
    );

    /*
     * Only today's date.
     */
    if (date !== today) {
      return;
    }

    /*
     * Find first link.
     */
    const link = row.find("a").first();

    if (!link.length) {
      console.log(
        `Today's row has no link: row ${index}`
      );

      return;
    }

    /*
     * Extract title.
     */
    const title = cleanText(
      link.text()
    );

    /*
     * Extract href.
     */
    const href = cleanText(
      link.attr("href")
    );

    if (!title || !href) {
      console.log(
        `Today's row has incomplete data: row ${index}`
      );

      return;
    }

    /*
     * Convert relative URL to absolute URL.
     *
     * Example:
     *
     * showfile.php?lang=1...
     *
     * becomes:
     *
     * https://nests.tribal.gov.in/showfile.php?lang=1...
     */
    const url = new URL(
      href,
      NESTS_URL
    ).href;

    notices.push({
      title,
      url,
      date
    });

    console.log(
      `FOUND: ${title}`
    );

    console.log(
      `URL: ${url}`
    );
  });


  /*
   * Remove duplicate URLs.
   */
  const unique = [];

  const seen = new Set();

  for (const notice of notices) {
    if (seen.has(notice.url)) {
      continue;
    }

    seen.add(notice.url);

    unique.push(notice);
  }

  return unique;
}


/**
 * Check D1 to see whether
 * this notice was already sent.
 */
async function isAlreadySent(env, url) {
  const result = await env.DB
    .prepare(`
      SELECT id
      FROM notices
      WHERE url = ?
      LIMIT 1
    `)
    .bind(url)
    .first();

  return Boolean(result);
}


/**
 * Send notification to your contact endpoint.
 */
async function sendNotification(notice) {
  const message = [
    "🚨 New NESTS Notice",
    "",
    `📌 ${notice.title}`,
    `📅 ${notice.date}`,
    "",
    `🔗 ${notice.url}`
  ].join("\n");


  const payload = {
    name: "NESTS Notice Monitor",

    email: "nests-monitor@example.com",

    subject:
      `New NESTS Notice: ${notice.title}`,

    message
  };


  console.log(
    "--------------------------------"
  );

  console.log(
    "Sending notification..."
  );

  console.log(
    JSON.stringify(payload)
  );


  const response = await fetch(
    NOTIFY_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },

      body: JSON.stringify(payload)
    }
  );


  /*
   * Always read the response body.
   * This is important for debugging.
   */
  const responseText =
    await response.text();


  console.log(
    `Notification HTTP status: ${response.status}`
  );

  console.log(
    `Notification response: ${responseText}`
  );


  if (!response.ok) {
    throw new Error(
      `Notification endpoint failed: HTTP ${response.status} - ${responseText}`
    );
  }


  console.log(
    "Notification endpoint accepted the request."
  );

  console.log(
    "--------------------------------"
  );

  return true;
}


/**
 * Save successfully sent notice to D1.
 */
async function saveNotice(env, notice) {
  await env.DB
    .prepare(`
      INSERT INTO notices
        (
          title,
          url,
          notice_date
        )
      VALUES
        (?, ?, ?)
    `)
    .bind(
      notice.title,
      notice.url,
      notice.date
    )
    .run();

  console.log(
    `Saved to D1: ${notice.title}`
  );
}


/**
 * Run complete check.
 */
async function checkNests(env) {
  const today = getToday();

  console.log("");
  console.log("================================");
  console.log("NESTS NOTICE MONITOR");
  console.log(`Today: ${today}`);
  console.log("================================");


  /*
   * Fetch NESTS.
   */
  const html =
    await fetchNests();


  /*
   * Parse today's notices.
   */
  const notices =
    extractTodaysNotices(
      html,
      today
    );


  console.log(
    `Today's notices found: ${notices.length}`
  );


  let sent = 0;
  let skipped = 0;
  let failed = 0;


  /*
   * Process every today's notice.
   */
  for (const notice of notices) {

    console.log("");
    console.log(
      `Processing: ${notice.title}`
    );


    /*
     * Check D1.
     */
    const alreadySent =
      await isAlreadySent(
        env,
        notice.url
      );


    if (alreadySent) {
      console.log(
        "Already sent. Skipping."
      );

      skipped++;

      continue;
    }


    /*
     * New notice.
     */
    try {

      /*
       * Send notification FIRST.
       */
      await sendNotification(
        notice
      );


      /*
       * Only save to D1 after
       * notification succeeds.
       */
      await saveNotice(
        env,
        notice
      );


      sent++;

      console.log(
        "SUCCESS: Notice sent and saved."
      );

    } catch (error) {

      failed++;

      console.error(
        "FAILED:",
        error instanceof Error
          ? error.message
          : String(error)
      );

      /*
       * IMPORTANT:
       *
       * We do NOT save the notice to D1
       * if notification failed.
       *
       * Therefore the next cron run can
       * retry it.
       */
    }
  }


  const result = {
    success: true,

    today,

    found:
      notices.length,

    sent,

    skipped,

    failed
  };


  console.log("");
  console.log(
    "FINAL RESULT:"
  );

  console.log(
    JSON.stringify(result)
  );

  console.log(
    "================================"
  );


  return result;
}


/**
 * Cloudflare Worker.
 */
export default {

  /**
   * HTTP requests.
   */
  async fetch(
    request,
    env,
    ctx
  ) {

    const url =
      new URL(request.url);


    /*
     * Manual check endpoint:
     *
     * /check
     */
    if (url.pathname === "/check") {

      try {

        const result =
          await checkNests(env);


        return Response.json(
          result
        );

      } catch (error) {

        console.error(
          "CHECK ERROR:",
          error
        );


        return Response.json(
          {
            success: false,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },

          {
            status: 500
          }
        );
      }
    }


    /*
     * Health endpoint:
     *
     * /
     */
    if (url.pathname === "/") {

      return Response.json({
        service:
          "NESTS Notice Monitor",

        status:
          "running",

        today:
          getToday(),

        timezone:
          TIME_ZONE,

        source:
          NESTS_URL,

        cron:
          "Every 5 minutes"
      });
    }


    return new Response(
      "Not Found",
      {
        status: 404
      }
    );
  },


  /**
   * Cloudflare Cron Trigger.
   */
  async scheduled(
    event,
    env,
    ctx
  ) {

    console.log(
      "Cron triggered."
    );


    ctx.waitUntil(
      checkNests(env)
        .catch(error => {
          console.error(
            "CRON ERROR:",
            error
          );
        })
    );
  }

};
