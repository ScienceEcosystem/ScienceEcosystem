// Checks every link in scripts/tools-catalog-data.js for dead/moved URLs.
//
// Usage:
//   node scripts/check-tool-links.js
//
// Prints any link that doesn't return a 2xx/3xx (after redirects) so they
// can be investigated and fixed in tools-catalog-data.js, then regenerate
// research-tools.html with build-research-tools.js.
'use strict';
import { toolCategories } from './tools-catalog-data.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 15000;
const CONCURRENCY = 10;

const all = [];
for (const c of toolCategories) {
  for (const t of c.tools) all.push({ cat: c.cat, name: t.name, link: t.link });
}

async function checkOne(entry) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(entry.link, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    return { ...entry, status: res.status, ok: res.ok || (res.status >= 300 && res.status < 400) };
  } catch (err) {
    return { ...entry, status: 0, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < all.length) {
      const entry = all[i++];
      results.push(await checkOne(entry));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const bad = results.filter((r) => !r.ok);
  console.log(`Checked ${results.length} links.`);
  if (bad.length === 0) {
    console.log('All links OK.');
    return;
  }
  console.log(`\n${bad.length} link(s) need a look — verify manually before editing the catalog, since some`);
  console.log('"403"/ERROR results are just bot-blocking or TLS quirks on otherwise-live sites:\n');
  for (const r of bad.sort((a, b) => a.status - b.status)) {
    const reason = r.status === 0 ? `ERROR (${r.error})` : `HTTP ${r.status}`;
    console.log(`[${r.cat}] ${r.name} — ${reason} — ${r.link}`);
  }
}

run();
