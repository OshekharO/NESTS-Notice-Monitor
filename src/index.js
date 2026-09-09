const NESTS_URL =
  "https://nests.tribal.gov.in/show_content.php?lang=1&level=0&ls_id=15&lid=13";

const NOTIFY_URL =
  "https://contact.oshekher.workers.dev/f/contact";

const TIME_ZONE = "Asia/Kolkata";


/**
 * Get today's date in the same format used by NESTS.
 *
 * Example:
 * 09 Sep 2026
 */
function getToday() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());
}


/**
 * Fetch the NESTS page.
 */
async function fetchNestsPage() {
  const response = await fetch(NESTS_URL, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(
      `NESTS returned HTTP ${response.status}`
    );
  }

  return await response.text();
}


/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}


/**
 * Clean whitespace from scraped text.
 */
function cleanText(text) {
  return decodeHtmlEntities(text)
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Extract today's notices from the HTML.
 *
 * We don't use a browser here because the NESTS page
 * contains normal HTML tables.
 */
function extractTodaysNotices(html, today) {
  const notices = [];

  // Find table rows.
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    // Extract TD cells.
    const cells = row.match(/<td\b[\s\S]*?<\/td>/gi) || [];

    if (cells.length === 0) {
      continue;
    }

    // Date is normally the last TD.
    const lastCell = cells[cells.length - 1];

    const date = cleanText(
      lastCell.replace(/<[^>]*>/g, " ")
    );

    // Only process today's rows.
    if (date !== today) {
      continue;
    }

    // Find first anchor.
    const anchorMatch = row.match(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
    );

    if (!anchorMatch) {
      continue;
    }

    const href = decodeHtmlEntities(anchorMatch[1]);

    const title = cleanText(
      anchorMatch[2].replace(/<[^>]*>/g, " ")
    );

    if (!title || !href) {
      continue;
    }

    // Convert relative URL into absolute URL.
    let absoluteUrl;

    try {
      absoluteUrl = new URL(href, NESTS_URL).href;
    } catch {
      continue;
    }

    notices.push({
      title,
      url: absoluteUrl,
      date,
    });
  }

  // Remove duplicates.
  const unique = [];
  const seen = new Set();

  for (const notice of notices) {
    if (!seen.has(notice.url)) {
      seen.add(notice.url);
      unique.push(notice);
    }
  }

  return unique;
}


/**
 * Check whether this notice was already sent.
 */
async function wasAlreadySent(env, url) {
  const result = await env.DB
    .prepare(
      "SELECT id FROM notices WHERE url = ? LIMIT 1"
    )
    .bind(url)
    .first();

  return !!result;
}


/**
 * Send notification through your Cloudflare contact endpoint.
 */
async function sendNotification(notice) {
  const message = [
    "🚨 New NESTS Notice",
    "",
    `📌 ${notice.title}`,
    `📅 ${notice.date}`,
    "",
    `🔗 ${notice.url}`,
  ].join("\n");

  const response = await fetch(NOTIFY_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      name: "NESTS Notice Monitor",
      email: "nests-monitor@example.com",
      subject: `New NESTS Notice: ${notice.title}`,
      message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Notification endpoint returned HTTP ${response.status}: ${body}`
    );
  }

  return true;
}


/**
 * Save successfully-notified notice in D1.
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
 * Main monitor.
 */
async function checkNests(env) {
  const today = getToday();

  console.log(`Checking NESTS for: ${today}`);

  const html = await fetchNestsPage();

  const notices = extractTodaysNotices(
    html,
    today
  );

  console.log(
    `Found ${notices.length} notice(s) dated ${today}`
  );

  let newCount = 0;

  for (const notice of notices) {
    console.log(
      `Found: ${notice.title} -> ${notice.url}`
    );

    const alreadySent = await wasAlreadySent(
      env,
      notice.url
    );

    if (alreadySent) {
      console.log(
        `Already notified: ${notice.url}`
      );

      continue;
    }

    try {
      // Send first.
      await sendNotification(notice);

      // Save only after notification succeeds.
      await saveNotice(env, notice);

      newCount++;

      console.log(
        `✅ Notification sent and saved: ${notice.title}`
      );
    } catch (error) {
      console.error(
        `❌ Failed to process notice: ${notice.title}`,
        error
      );
    }
  }

  console.log(
    `Finished. New notifications: ${newCount}`
  );

  return {
    today,
    found: notices.length,
    newNotifications: newCount,
  };
}


/**
 * HTTP endpoint.
 *
 * Visiting:
 *
 * /check
 *
 * manually runs the scraper.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/check") {
      try {
        const result = await checkNests(env);

        return Response.json({
          success: true,
          ...result,
        });
      } catch (error) {
        console.error(error);

        return Response.json(
          {
            success: false,
            error: error.message,
          },
          {
            status: 500,
          }
        );
      }
    }

    return new Response(
      "NESTS Monitor is running.\n\nUse /check to manually run a check.",
      {
        headers: {
          "Content-Type": "text/plain",
        },
      }
    );
  },


  /**
   * Cloudflare Cron Trigger.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      checkNests(env)
    );
  },
};
