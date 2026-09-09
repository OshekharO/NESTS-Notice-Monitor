# Bolt's Journal

## 2026-09-09 - Batch D1 Database Queries for Scraped Items
**Learning:** In Cloudflare Workers using D1, executing individual `SELECT` queries inside a loop for each scraped item creates sequential network/IPC overhead (N round-trips). Batching the candidate URLs into a single `SELECT url FROM notices WHERE url IN (...)` query reduces D1 database interaction latency from O(N) to O(1) round-trip.
**Action:** When deduplicating scraped/processed items against D1 database tables, extract candidate keys and query them in a single batch using `WHERE key IN (...)` before entering processing loops.
