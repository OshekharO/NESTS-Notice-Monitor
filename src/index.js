import * as cheerio from "cheerio";

const NESTS_URL =
  "https://nests.tribal.gov.in/show_content.php?lang=1&level=0&ls_id=15&lid=13";

const NOTIFY_URL =
  "https://contact.oshekher.workers.dev/f/contact";

const TIME_ZONE = "Asia/Kolkata";


function getToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  const months = [
    "Jan", "Feb", "Mar", "Apr",
    "May", "Jun", "Jul", "Aug",
    "Sep", "Oct", "Nov", "Dec"
  ];

  return `${day} ${months[Number(month) - 1]} ${year}`;
}


function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


async function fetchNests() {
  const response = await fetch(NESTS_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; NESTS-Notice-Monitor/1.0)",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language":
        "en-US,en;q=0.9"
    }
  });

  if (!response.ok) {
    throw new Error(
      `NESTS HTTP ${response.status}`
    );
  }

  return await response.text();
}


function extractTodaysNotices(html, today) {
  const $ = cheerio.load(html);

  const notices = [];

  $("tr").each((index, element) => {
    const row = $(element);
    const cells = row.find("td");

    if (!cells.length) {
      return;
    }

    const date = cleanText(
      cells.last().text()
    );

    if (date !== today) {
      return;
    }

    const link = row.find("a").first();

    if (!link.length) {
      return;
    }

    const title = cleanText(
      link.text()
    );

    const href = cleanText(
      link.attr("href")
    );

    if (!title || !href) {
      return;
    }

    const url = new URL(
      href,
      NESTS_URL
    ).href;

    notices.push({
      title,
      url,
      date
    });
  });


  /*
   * Remove duplicates.
   */
  return [
    ...new Map(
      notices.map(
        notice => [notice.url, notice]
      )
    ).values()
  ];
}


/**
 * Check D1.
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
 *
 * IMPORTANT:
 * Return the API response instead of
 * hiding it inside an exception.
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
    email: "test@example.com",
    subject:
      `New NESTS Notice: ${notice.title}`,
    message
  };


  let response;

  try {

    response = await fetch(
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

  } catch (error) {

    return {
      success: false,
      stage: "fetch",
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }


  const body =
    await response.text();


  return {
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: body.slice(0, 5000)
  };
}


/**
 * Save notice to D1.
 */
async function saveNotice(env, notice) {
  await env.DB
    .prepare(`
      INSERT INTO notices
        (title, url, notice_date)
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
 * Main check.
 */
async function checkNests(env) {

  const today = getToday();

  const html =
    await fetchNests();


  const notices =
    extractTodaysNotices(
      html,
      today
    );


  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const results = [];


  for (const notice of notices) {

    const alreadySent =
      await isAlreadySent(
        env,
        notice.url
      );


    if (alreadySent) {

      skipped++;

      results.push({
        title: notice.title,
        url: notice.url,
        status: "already_sent"
      });

      continue;
    }


    /*
     * Try notification.
     */
    const notification =
      await sendNotification(
        notice
      );


    /*
     * If notification failed,
     * DO NOT save to D1.
     */
    if (!notification.success) {

      failed++;

      results.push({
        title: notice.title,
        url: notice.url,
        status: "notification_failed",
        notification
      });

      continue;
    }


    /*
     * Notification succeeded.
     */
    try {

      await saveNotice(
        env,
        notice
      );

      sent++;

      results.push({
        title: notice.title,
        url: notice.url,
        status: "sent",
        notification
      });

    } catch (error) {

      failed++;

      results.push({
        title: notice.title,
        url: notice.url,
        status: "database_failed",
        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }


  return {
    success: true,
    today,
    found: notices.length,
    sent,
    skipped,
    failed,
    results
  };
}


export default {

  async fetch(request, env, ctx) {

    const url =
      new URL(request.url);


    /*
     * /check
     */
    if (url.pathname === "/check") {

      try {

        return Response.json(
          await checkNests(env)
        );

      } catch (error) {

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


  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      checkNests(env)
        .catch(error => {
          console.error(
            "Cron error:",
            error
          );
        })
    );
  }

};
