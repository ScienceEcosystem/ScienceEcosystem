// Regenerates the pre-rendered <article class="tool-card"> blocks in
// research-tools.html from scripts/tools-catalog-data.js.
//
// research-tools.html MUST stay a static, pre-rendered HTML file (no runtime
// fetch of tool data) — Safari has a parser bug on very long lines that, in a
// past version of this page, corrupted the DOM when tool data was loaded as a
// big inline JSON/JS blob, leaving the page with no tools showing for over a
// week. This script only runs at edit time, on your machine; its output is
// committed like any other file.
//
// Usage:
//   1. Edit scripts/tools-catalog-data.js (add/change a tool entry)
//   2. node scripts/build-research-tools.js
//   3. Check the diff, then commit research-tools.html + the data file.
'use strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toolCategories } from './tools-catalog-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetPath = path.join(__dirname, '..', 'research-tools.html');

const START = '<!-- TOOLS:AUTOGEN:START -->';
const END = '<!-- TOOLS:AUTOGEN:END -->';

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTool(t, cat) {
  let attrs = `data-cat="${escAttr(cat)}" data-cost="${escAttr(t.cost)}" data-search="${escAttr(t.search)}"`;
  if (t.geo) attrs += ` data-geo="${escAttr(t.geo)}"`;
  if (t.userlevel) attrs += ` data-userlevel="${escAttr(t.userlevel)}"`;
  if (t.taxon) attrs += ` data-taxon="${escAttr(t.taxon)}"`;

  const linkText = t.linkText || t.name;
  let html = '';
  html += `<article class="tool-card" ${attrs} style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1rem;display:flex;flex-direction:column;gap:.5rem;">\n`;
  html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;"><span style="display:flex;align-items:center;gap:.4rem;min-width:0;"><img src="https://www.google.com/s2/favicons?sz=32&amp;domain=${escAttr(t.domain)}" alt="" loading="lazy" width="16" height="16" style="border-radius:3px;flex-shrink:0;" onerror="window.toolFaviconFallback(this)"><span style="font-size:.9rem;font-weight:700;color:#0f172a;">${escText(t.name)}</span></span><span style="font-size:.72rem;background:#f1f5f9;color:#374151;padding:2px 7px;border-radius:10px;flex-shrink:0;">${escText(t.cost)}</span></div>\n`;
  html += `<p style="font-size:.82rem;color:#475569;margin:0;line-height:1.45;">${escText(t.desc)}</p>\n`;
  if (t.openSource) {
    html += `<span style="font-size:.72rem;background:#dcfce7;color:#166534;padding:2px 7px;border-radius:10px;display:inline-block;">Open-source</span>\n`;
  }
  html += `<div style="margin-top:auto;padding-top:.25rem;"><a href="${escAttr(t.link)}" target="_blank" rel="noopener noreferrer" style="font-size:.8rem;color:#2e7f9f;text-decoration:none;font-weight:600;">Visit ${escText(linkText)} →</a></div>\n`;
  html += `</article>`;
  return html;
}

function renderCategory(c) {
  let html = '';
  html += `<div class="tool-category" data-cat="${escAttr(c.cat)}">\n`;
  html += `<h2 style="font-size:.95rem;font-weight:700;color:#374151;margin:0 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid #e5e7eb;">${escText(c.cat)}</h2>\n`;
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.75rem;">\n`;
  html += c.tools.map((t) => renderTool(t, c.cat)).join('\n') + '\n';
  html += `</div>\n`;
  html += `</div>`;
  return html;
}

let total = 0;
const generated = toolCategories.map((c) => {
  total += c.tools.length;
  return renderCategory(c);
}).join('\n');

const src = fs.readFileSync(targetPath, 'utf8');
const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END);
if (startIdx === -1 || endIdx === -1) {
  console.error(`Could not find ${START} / ${END} markers in research-tools.html`);
  process.exit(1);
}

const before = src.slice(0, startIdx + START.length);
const after = src.slice(endIdx);
const out = before + '\n' + generated + '\n' + after;

fs.writeFileSync(targetPath, out);
console.log(`Regenerated ${total} tool cards across ${toolCategories.length} categories.`);
