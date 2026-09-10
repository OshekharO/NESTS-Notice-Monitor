## 2026-09-10 - Module-level Intl.DateTimeFormat caching and RegExp optimization
**Learning:** Instantiating `new Intl.DateTimeFormat()` on every call in V8/Cloudflare Workers is expensive (~150µs per call). Caching the formatter instance at module scope reduced execution time by ~96% (~25x speedup). Additionally, `\s` in JS RegExp natively matches non-breaking space `\u00a0`, making explicit `.replace(/\u00a0/g, " ")` redundant before `\s+`.
**Action:** Always reuse `Intl.DateTimeFormat` instances at module scope and rely on `\s` regex matching for non-breaking whitespace.
