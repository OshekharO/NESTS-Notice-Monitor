# NESTS-Notice-Monitor

A Cloudflare Worker that monitors the official [NESTS](https://nests.tribal.gov.in/) website for new notices related to **NESTS** and **EMRS** (Eklavya Model Residential Schools), and sends real‑time alerts via Telegram.

## Overview

NESTS-Notice-Monitor is a serverless application that periodically scrapes the NESTS notice board, extracts notices published on the current day, and sends notifications through Telegram. It uses Cloudflare Workers for serverless execution, D1 for state management, Cheerio for HTML parsing, and the companion [Telegram-Form-Worker](https://github.com/OshekharO/Telegram-Form-Worker) as the notification backend.

> **Note:** The official NESTS portal (`nests.tribal.gov.in`) publishes all announcements, including those for EMRS (Eklavya Model Residential Schools) admissions, results, and other important updates.

## Features

- **Automated Monitoring**: Checks the NESTS notice page every 5 minutes for new notice.
- **Smart Deduplication**: Tracks already‑sent notices using Cloudflare D1 to prevent duplicates.
- **Real‑time Telegram Alerts**: Sends notifications via the companion Telegram‑Form‑Worker (service binding).
- **Simple API**: Provides status and manual trigger endpoints.
- **Serverless**: Runs on Cloudflare Workers – no infrastructure to manage.
- **Time Zone Aware**: Uses IST (Asia/Kolkata) for accurate date comparisons.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **HTML Parsing**: Cheerio
- **Notification Backend**: [Telegram-Form-Worker](https://github.com/OshekharO/Telegram-Form-Worker) (Cloudflare Worker + Telegram Bot API)
- **Configuration**: Wrangler
- **Language**: JavaScript (ES Modules)

## How It Works

1. The Worker runs on a scheduled cron trigger (`*/5 * * * *`).
2. It fetches the NESTS notice page:  
   `https://nests.tribal.gov.in/show_content.php?lang=1&level=0&ls_id=15&lid=13`
3. Using Cheerio, it parses the HTML and extracts notices with **today's date**.
4. For each notice, it checks D1 to see if it has already been sent.
5. If not sent, it dispatches a notification through the Telegram‑Form‑Worker service binding (`env.CONTACT.fetch()`).
6. On success, it records the notice in D1.
7. Failed notifications are retried on the next cron run.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account with Workers and D1 enabled
- A Telegram Bot Token and Chat ID (for notifications)

## Setup

### 1. Clone the Repository

```bash
git clone https://github.com/OshekharO/NESTS-Notice-Monitor.git
cd NESTS-Notice-Monitor
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Deploy the Telegram‑Form‑Worker (Notification Backend)

This monitor relies on [Telegram-Form-Worker](https://github.com/OshekharO/Telegram-Form-Worker) to send Telegram messages. Deploy it first:

```bash
git clone https://github.com/OshekharO/Telegram-Form-Worker.git
cd Telegram-Form-Worker
npm install
wrangler deploy
```

Set the required secrets:

```bash
wrangler secret put BOT_TOKEN    # Your Telegram Bot Token
wrangler secret put CHAT_ID      # Your Telegram Chat ID
```

### 4. Configure the Service Binding

In `wrangler.jsonc` of NESTS-Notice-Monitor, add a service binding pointing to your deployed Telegram‑Form‑Worker:

```json
{
  "services": [
    {
      "binding": "CONTACT",
      "service": "telegram-form-worker"  // Replace with your actual Worker name
    }
  ]
}
```

The monitor will then call `env.CONTACT.fetch()` with a payload formatted for the `/f/contact` endpoint.

### 5. Configure D1 Database

Create a D1 database:

```bash
wrangler d1 create nest
```

Update the `database_id` in `wrangler.jsonc` with your database ID.

### 6. Create the Database Table

Run the following SQL to create the `notices` table:

```sql
CREATE TABLE notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    notice_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 7. Deploy the Monitor

```bash
npm run deploy
```

This runs `wrangler deploy` as defined in `package.json`.

## Notification Payload

The monitor sends notifications to Telegram‑Form‑Worker using this JSON structure (compatible with the `/f/contact` endpoint):

```json
{
    "name": "NESTS Notice Monitor",
    "email": "test@example.com",
    "subject": "New NESTS/EMRS Notice: {notice title}",
    "message": "New NESTS/EMRS Notice\n\n{notice title}\n{notice date}\n\n{notice url}"
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service status information |
| `/check` | GET | Manually trigger a check for new notices |

### GET `/`

Returns service metadata:

```json
{
    "success": true,
    "service": "NESTS Notice Monitor",
    "status": "running",
    "today": "09 Sep 2026",
    "timezone": "Asia/Kolkata",
    "source": "https://nests.tribal.gov.in/show_content.php?lang=1&level=0&ls_id=15&lid=13",
    "check": "/check",
    "cron": "Every 5 minutes"
}
```

### GET `/check`

Manually triggers the monitoring process. Returns a summary of the check:

```json
{
    "success": true,
    "today": "09 Sep 2026",
    "found": 3,
    "sent": 2,
    "skipped": 1,
    "failed": 0,
    "results": [
        {
            "title": "Notice Title",
            "url": "https://...",
            "status": "sent" | "already_sent" | "notification_failed" | "database_failed"
        }
    ]
}
```

## Configuration

### `wrangler.jsonc`

| Key | Description |
|-----|-------------|
| `name` | Worker name |
| `main` | Entry point file |
| `compatibility_date` | Cloudflare compatibility date |
| `d1_databases` | D1 database binding configuration |
| `services` | Service binding to Telegram‑Form‑Worker (binding name: `CONTACT`) |
| `triggers.crons` | Cron schedule (every 5 minutes) |

### Environment Variables (for Telegram‑Form‑Worker)

These are set in the Telegram‑Form‑Worker deployment:

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Your Telegram Bot Token (from @BotFather) |
| `CHAT_ID` | Your Telegram Chat ID (where notifications will be sent) |

### Constants (in `src/index.js`)

| Variable | Description |
|----------|-------------|
| `NESTS_URL` | NESTS notice page URL |
| `TIME_ZONE` | Time zone for date calculations (IST) |

## Database Schema

### `notices` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Primary key (auto‑increment) |
| `title` | TEXT | Notice title |
| `url` | TEXT | Unique notice URL |
| `notice_date` | TEXT | Notice publication date |
| `created_at` | DATETIME | Timestamp when the record was created |

## Development

### Run Locally

```bash
npm run dev
```

This starts Wrangler's development server with hot reloading.

### View Logs

```bash
npm run tail
```

This streams live logs from the deployed Worker.

## Project Structure

```
NESTS-Notice-Monitor/
├── src/
│   └── index.js          # Main Worker code
├── .github/
│   └── workflows/        # GitHub Actions workflows
├── package.json          # Dependencies and scripts
├── wrangler.jsonc        # Wrangler configuration
└── README.md             # This file
```

## Related Projects

- [Telegram-Form-Worker](https://github.com/OshekharO/Telegram-Form-Worker) — Lightweight contact form backend using Cloudflare Workers and Telegram Bot API. Used as the notification backend for this monitor.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Author

**OshekharO** - [GitHub](https://github.com/OshekharO)

---

⭐ If you find this project useful, please consider giving it a star on GitHub!
