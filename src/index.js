import * as cheerio from "cheerio";

const NESTS_URL =
  "https://nests.tribal.gov.in/show_content.php?lang=1&level=0&ls_id=15&lid=13";

const NOTIFY_URL =
  "https://contact.oshekher.workers.dev/f/contact";

const TIME_ZONE = "Asia/Kolkata";


/**
 * Get today's date exactly in the format
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
    p => p.type === "year"
  ).value;

  const month = parts.find(
    p => p.type === "month"
  ).value;

  const day = parts.find(
    p => p.type === "day"
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
 * Clean whitespace.
 */
function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Fetch NESTS website.
 */
async function fetchNests() {
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

  return await response.text();
}


/**
 * Find all notices whose date is today.
 */
function extractTodaysNotices(html, today) {
  const $ = cheerio.load(html);

  const notices = [];

  $("tr").each((index, element) => {

    const row = $(element);

    const cells = row.find("td");

    if (cells.length === 0) {
      return;
    }


    /*
     * NESTS puts the notice date
     * in the last <td>.
     */
    const date = cleanText(
      cells.last().text()
    );


    console.log(
      `Row ${index}: date="${date}"`
    );


    /*
     * Compare against today's date.
     */
    if (date !== today) {
      return;
    }


    /*
     * Find first anchor.
     */
    const linkElement =
      row.find("a").first();


    if (!linkElement.length) {
      return;
    }


    /*
     * Extract title.
     *
     * This will automatically remove
     * the <img src="new.gif"> text because
     * .text() only gets actual text.
     */
    const title = cleanText(
      linkElement.text()
    );


    /*
     * Extract href.
     */
    const href = cleanText(
      linkElement.attr("href")
    );


    if (!title || !href) {
      return;
    }


    /*
     * Convert relative URL to absolute URL.
     */
    let url;

    try {

      url = new URL(
        href,
        NESTS_URL
      ).href;

    } catch (error) {

      console.error(
        `Invalid URL: ${href}`
      );

      return;
    }


    notices.push({
      title,
      url,
      date
    });
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
 * Check if notice has already
 * been sent.
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
 * Send notification.
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


  console.log(
    "Sending notification..."
  );


  const response = await fetch(
    NOTIFY_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        name:
          "NESTS Notice Monitor",

        email:
          "nests-monitor@example.com",

        subject:
          `New NESTS Notice: ${notice.title}`,

        message
      })
    }
  );


  if (!response.ok) {

    const body =
      await response.text();

    throw new Error(
      `Notification endpoint returned HTTP ${response.status}: ${body}`
    );
  }


  console.log(
    "✅ Notification endpoint succeeded"
  );
}


/**
 * Save notice to D1.
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
}


/**
 * Main checker.
 */
async function checkNests(env) {

  const today = getToday();


  console.log(
    "================================"
  );

  console.log(
    `NESTS CHECK: ${today}`
  );

  console.log(
    "================================"
  );


  /*
   * Download page.
   */
  const html =
    await fetchNests();


  console.log(
    `Downloaded ${html.length} bytes`
  );


  /*
   * Extract today's notices.
   */
  const notices =
    extractTodaysNotices(
      html,
      today
    );


  console.log(
    `Found ${notices.length} notice(s) for ${today}`
  );


  let sent = 0;
  let skipped = 0;
  let failed = 0;


  /*
   * Process notices.
   */
  for (const notice of notices) {

    console.log("");
    console.log(
      `Title: ${notice.title}`
    );

    console.log(
      `URL: ${notice.url}`
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
        "⏭️ Already sent - skipping"
      );

      skipped++;

      continue;
    }


    /*
     * New notice.
     */
    try {

      await sendNotification(
        notice
      );


      /*
       * Save only after notification
       * succeeds.
       */
      await saveNotice(
        env,
        notice
      );


      console.log(
        "✅ Notice saved to D1"
      );


      sent++;

    } catch (error) {

      console.error(
        "❌ Failed to notify:",
        error
      );

      failed++;
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


  console.log(
    JSON.stringify(result)
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
     * Manual check.
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
          "Check failed:",
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
     * Health check.
     */
    if (url.pathname === "/") {

      return Response.json({
        service:
          "NESTS Notice Monitor",

        status:
          "running",

        timezone:
          TIME_ZONE,

        today:
          getToday(),

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
   * Cron Trigger.
   */
  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      checkNests(env)
        .catch(error => {
          console.error(
            "Scheduled check failed:",
            error
          );
        })
    );
  }

};
