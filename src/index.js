import * as cheerio from "cheerio";

const NESTS_URL =
  "https://nests.tribal.gov.in/show_content.php?lang=1&level=0&ls_id=15&lid=13";

const TIME_ZONE = "Asia/Kolkata";


/* =========================================================
   DATE
   ========================================================= */

function getToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const year =
    parts.find((p) => p.type === "year")?.value;

  const month =
    parts.find((p) => p.type === "month")?.value;

  const day =
    parts.find((p) => p.type === "day")?.value;

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


/* =========================================================
   TEXT CLEANING
   ========================================================= */

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/* =========================================================
   FETCH NESTS PAGE
   ========================================================= */

async function fetchNestsPage() {
  const response = await fetch(
    NESTS_URL,
    {
      method: "GET",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NESTS-Notice-Monitor/1.0)",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":
          "en-US,en;q=0.9"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `NESTS returned HTTP ${response.status}`
    );
  }

  return await response.text();
}


/* =========================================================
   EXTRACT TODAY'S NOTICES
   ========================================================= */

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
     * Date is the last <td>.
     */
    const date = cleanText(
      cells.last().text()
    );

    /*
     * Only today's notices.
     */
    if (date !== today) {
      return;
    }

    /*
     * First anchor in the row.
     */
    const link =
      row.find("a").first();

    if (!link.length) {
      return;
    }

    const title = cleanText(
      link.text()
    );

    const href =
      cleanText(
        link.attr("href")
      );

    if (!title || !href) {
      return;
    }

    /*
     * Convert relative URL to absolute URL.
     */
    const absoluteUrl =
      new URL(
        href,
        NESTS_URL
      ).href;

    notices.push({
      title,
      url: absoluteUrl,
      date
    });
  });


  /*
   * Remove duplicate URLs.
   */
  return [
    ...new Map(
      notices.map(
        (notice) => [
          notice.url,
          notice
        ]
      )
    ).values()
  ];
}


/* =========================================================
   D1 - CHECK WHETHER NOTICE WAS ALREADY SENT
   ========================================================= */

async function isAlreadySent(env, url) {
  const result =
    await env.DB
      .prepare(
        `
        SELECT id
        FROM notices
        WHERE url = ?
        LIMIT 1
        `
      )
      .bind(url)
      .first();

  return Boolean(result);
}


/* =========================================================
   D1 - SAVE NOTICE
   ========================================================= */

async function saveNotice(env, notice) {
  await env.DB
    .prepare(
      `
      INSERT INTO notices
        (title, url, notice_date)
      VALUES
        (?, ?, ?)
      `
    )
    .bind(
      notice.title,
      notice.url,
      notice.date
    )
    .run();
}


/* =========================================================
   SEND NOTIFICATION THROUGH CONTACT WORKER
   ========================================================= */

async function sendNotification(env, notice) {

  /*
   * This is the same JSON structure
   * that your /f/contact endpoint accepts.
   */
  const payload = {
    name: "NESTS Notice Monitor",

    email: "test@example.com",

    subject:
      `New NESTS Notice: ${notice.title}`,

    message: [
      "🚨 New NESTS Notice",
      "",
      `📌 ${notice.title}`,
      `📅 ${notice.date}`,
      "",
      `🔗 ${notice.url}`
    ].join("\n")
  };


  /*
   * IMPORTANT:
   *
   * This is NOT:
   *
   * https://contact.oshekher.workers.dev
   *
   * It uses the Cloudflare Service Binding.
   */
  const request =
    new Request(
      "https://contact/f/contact",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "Accept":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      }
    );


  let response;

  try {

    response =
      await env.CONTACT.fetch(
        request
      );

  } catch (error) {

    return {
      success: false,

      status: 0,

      statusText:
        "SERVICE_BINDING_ERROR",

      body:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }


  const body =
    await response.text();


  return {
    success: response.ok,

    status:
      response.status,

    statusText:
      response.statusText,

    body:
      body.slice(0, 5000)
  };
}


/* =========================================================
   MAIN CHECK
   ========================================================= */

async function checkNests(env) {

  const today =
    getToday();


  /*
   * Download NESTS page.
   */
  const html =
    await fetchNestsPage();


  /*
   * Find today's notices.
   */
  const notices =
    extractTodaysNotices(
      html,
      today
    );


  let sent = 0;

  let skipped = 0;

  let failed = 0;


  const results = [];


  /*
   * Process each notice.
   */
  for (
    const notice
    of notices
  ) {

    /*
     * Check D1.
     */
    const alreadySent =
      await isAlreadySent(
        env,
        notice.url
      );


    if (alreadySent) {

      skipped++;

      results.push({
        title:
          notice.title,

        url:
          notice.url,

        status:
          "already_sent"
      });

      continue;
    }


    /*
     * Send Telegram notification
     * through contact Worker.
     */
    const notification =
      await sendNotification(
        env,
        notice
      );


    /*
     * Notification failed.
     *
     * DON'T insert into D1.
     *
     * This means the next cron will
     * retry it.
     */
    if (!notification.success) {

      failed++;

      results.push({
        title:
          notice.title,

        url:
          notice.url,

        status:
          "notification_failed",

        notification
      });

      continue;
    }


    /*
     * Notification succeeded.
     *
     * Now save it to D1.
     */
    try {

      await saveNotice(
        env,
        notice
      );

      sent++;

      results.push({
        title:
          notice.title,

        url:
          notice.url,

        status:
          "sent",

        notification
      });

    } catch (error) {

      failed++;

      results.push({
        title:
          notice.title,

        url:
          notice.url,

        status:
          "database_failed",

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

    found:
      notices.length,

    sent,

    skipped,

    failed,

    results
  };
}


/* =========================================================
   WORKER
   ========================================================= */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    const url =
      new URL(request.url);


    /* ---------------------------------------------
       GET /
       --------------------------------------------- */

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {

      return Response.json({
        success: true,

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

        check:
          "/check",

        cron:
          "Every 5 minutes"
      });
    }


    /* ---------------------------------------------
       GET /check
       --------------------------------------------- */

    if (
      request.method === "GET" &&
      url.pathname === "/check"
    ) {

      try {

        const result =
          await checkNests(env);

        return Response.json(
          result
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


    /* ---------------------------------------------
       Anything else
       --------------------------------------------- */

    return Response.json(
      {
        success: false,

        message:
          "Not Found"
      },

      {
        status: 404
      }
    );
  },


  /* =======================================================
     CRON
     ======================================================= */

  async scheduled(
    event,
    env,
    ctx
  ) {

    ctx.waitUntil(
      checkNests(env)
        .catch((error) => {

          console.error(
            "NESTS cron error:",
            error
          );

        })
    );
  }

};
