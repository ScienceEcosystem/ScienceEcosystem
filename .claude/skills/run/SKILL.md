---
description: Launch and drive the ScienceEcosystem site locally — Express dev server + Playwright, with the fix for a node_modules gotcha that can hang the server silently after a folder move/copy.
---

# Running ScienceEcosystem locally

## Start the server

```bash
cd <repo root>   # the folder containing package.json / server/index.js
node server/index.js
```

No `npm run dev` — `package.json`'s `start` script (`node server/index.js`) is
what to use. Reads config from `.env` (DATABASE_URL, ORCID_CLIENT_ID/SECRET,
R2 creds, OPENALEX_API_KEY, etc. — see `.env.example`).

Serves on `http://localhost:5173` (`PORT` env var to override). Startup can
legitimately take 15-25s (first DB pool connection to Neon) — poll instead of
assuming a fixed sleep is enough:

```bash
for i in $(seq 1 30); do curl -sf http://localhost:5173 >/dev/null 2>&1 && break; sleep 1; done
```

Stop it with `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill` before relaunching,
or the next run hits `EADDRINUSE`.

## Gotcha: server hangs forever with zero output after a folder move/copy

**Symptom:** `node server/index.js` prints nothing at all — not even the
"ScienceEcosystem server running at..." log line — and never binds the port.
`ps` shows the process alive at 0% CPU (blocked on I/O, not crashed or
looping). `curl localhost:5173` just times out indefinitely.

**Cause:** importing `pg` or any `@aws-sdk/*` package hangs during ESM module
resolution/evaluation — confirmed by isolating each import in a standalone
probe script; `express`/`dotenv`/`node-fetch`/`cookie-parser` were all fine,
only `pg` and the AWS SDK packages hung. Because ESM hoists and fully resolves
the whole import graph before any of the file's own code runs, this blocks
the entire module — nothing prints, including code written before the
offending `import` line in source order. Root cause wasn't pinned down
further (not an iCloud-placeholder issue — files read instantly via `cat`;
not a broken symlink — none present); a clean reinstall reliably fixes it
regardless of the underlying cause, so that's the standing workaround.

**Fix:**

```bash
rm -rf node_modules
npm install
```

Confirm before re-launching the real server:

```bash
node -e "import('pg').then(()=>console.log('pg OK'))"
```

If that hangs too, the reinstall didn't take — check `npm install`'s own
output for errors rather than re-running the server again.

## First interaction (proves it's actually serving, not just bound)

```bash
curl -s http://localhost:5173/ -o /dev/null -w "%{http_code}\n"        # 200
curl -s http://localhost:5173/api/openalex/works/W3103727569 -o /dev/null -w "%{http_code}\n"   # 200 — proxy + key working
```

## Driving it with a browser (screenshots, click-through)

`chromium-cli` is not installed in this environment. Fall back to a scratch
Playwright project instead of adding it to the site's own `package.json`:

```bash
mkdir -p /tmp/se-pw && cd /tmp/se-pw
npm init -y >/dev/null 2>&1
npm install playwright
npx playwright install chromium
```

Then drive it with a small script using `chromium.launch({ args: ['--no-sandbox'] })`
→ `browser.newPage()` → `page.goto('http://localhost:5173/...')` →
`page.waitForTimeout(...)` (several seconds — OpenAlex/Field Data panels load
async) → `page.screenshot(...)`. Check `page.on('console', ...)` for errors
and `page.on('response', ...)` for non-2xx same-origin requests before
declaring a page "working."

## Known-slow pages, not bugs

- Search results and Field Data panels can take several seconds to populate
  even under normal conditions — several sequential/parallel OpenAlex or
  third-party calls per page. A 3-4s `waitForTimeout` before screenshotting
  will often catch it mid-load; wait 8-10s+ for a fair look.
- Under real OpenAlex rate-limiting, both surface a delayed "taking longer
  than usual" hint after 5s (search.js's `.skel-retry-hint`, topic.js's
  `#fieldDataHint`, paper.js's header text) rather than sitting silently —
  if you don't see real content by ~15-20s even with the hint showing,
  something's actually wrong, not just slow.
