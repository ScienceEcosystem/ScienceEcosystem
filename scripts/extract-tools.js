// One-off extraction: parse the 236 hand-written tool cards out of
// research-tools.html and write them as structured data to
// scripts/tools-catalog-data.js, for use by scripts/build-research-tools.js.
//
// Run with: node scripts/extract-tools.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(__dirname, '..', 'research-tools.html');
const lines = fs.readFileSync(srcPath, 'utf8').split('\n');

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const categories = []; // { cat, tools: [...] }
let currentCat = null;
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  const catMatch = line.match(/^<div class="tool-category" data-cat="([^"]*)">$/);
  if (catMatch) {
    currentCat = { cat: decodeEntities(catMatch[1]), tools: [] };
    categories.push(currentCat);
    i++;
    continue;
  }

  if (line.startsWith('<article class="tool-card"')) {
    const attrs = {};
    const attrRe = /data-(cat|cost|search|geo|userlevel|taxon)="([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(line))) attrs[m[1]] = decodeEntities(m[2]);

    const headerLine = lines[i + 1];
    const domainMatch = headerLine.match(/domain=([^&"]*)/);
    const nameMatch = headerLine.match(/<span style="font-size:\.9rem;font-weight:700;color:#0f172a;">([^<]*)<\/span>/);

    const descLine = lines[i + 2];
    const descMatch = descLine.match(/<p style="font-size:\.82rem;color:#475569;margin:0;line-height:1\.45;">([^<]*)<\/p>/);

    let cursor = i + 3;
    let openSource = false;
    if (lines[cursor].includes('background:#dcfce7')) {
      openSource = true;
      cursor++;
    }

    const linkLine = lines[cursor];
    const linkMatch = linkLine.match(/<a href="([^"]*)" target="_blank" rel="noopener noreferrer" style="font-size:\.8rem;color:#2e7f9f;text-decoration:none;font-weight:600;">Visit ([^<]*) →<\/a>/);

    const closeIdx = cursor + 1; // </article>

    const tool = {
      name: nameMatch ? decodeEntities(nameMatch[1]) : '',
      domain: domainMatch ? domainMatch[1] : '',
      cost: attrs.cost || '',
      desc: descMatch ? decodeEntities(descMatch[1]) : '',
      openSource,
      link: linkMatch ? linkMatch[1] : '',
      search: attrs.search || '',
    };
    if (linkMatch && linkMatch[2] !== tool.name) tool.linkText = decodeEntities(linkMatch[2]);
    if (attrs.geo) tool.geo = attrs.geo;
    if (attrs.userlevel) tool.userlevel = attrs.userlevel;
    if (attrs.taxon) tool.taxon = attrs.taxon;

    currentCat.tools.push(tool);
    i = closeIdx + 1; // skip past </article>
    continue;
  }

  i++;
}

const total = categories.reduce((n, c) => n + c.tools.length, 0);
console.log(`Extracted ${total} tools across ${categories.length} categories`);

// ── Write data file: one tool object per line, grouped by category ─────────
function jsStr(s) {
  return JSON.stringify(s);
}

function toolLine(t) {
  const parts = [];
  parts.push(`name: ${jsStr(t.name)}`);
  parts.push(`domain: ${jsStr(t.domain)}`);
  parts.push(`cost: ${jsStr(t.cost)}`);
  parts.push(`desc: ${jsStr(t.desc)}`);
  if (t.openSource) parts.push(`openSource: true`);
  if (t.geo) parts.push(`geo: ${jsStr(t.geo)}`);
  if (t.userlevel) parts.push(`userlevel: ${jsStr(t.userlevel)}`);
  if (t.taxon) parts.push(`taxon: ${jsStr(t.taxon)}`);
  parts.push(`link: ${jsStr(t.link)}`);
  if (t.linkText) parts.push(`linkText: ${jsStr(t.linkText)}`);
  parts.push(`search: ${jsStr(t.search)}`);
  return `  { ${parts.join(', ')} },`;
}

let out = '';
out += '// Research tools catalog — one object per tool.\n';
out += '// To add a tool: append a line to the matching category array below\n';
out += '// (or create a new category array) following the existing fields, then run:\n';
out += '//   node scripts/build-research-tools.js\n';
out += '// This regenerates the pre-rendered <article class="tool-card"> blocks in\n';
out += '// research-tools.html between the TOOLS:AUTOGEN markers. Do not hand-edit\n';
out += '// those generated blocks — edit this file and rebuild instead.\n';
out += '\n';
out += 'const toolCategories = [\n';
for (const c of categories) {
  out += `{ cat: ${jsStr(c.cat)}, tools: [\n`;
  for (const t of c.tools) out += toolLine(t) + '\n';
  out += '] },\n';
}
out += '];\n';
out += '\n';
out += 'export { toolCategories };\n';

const outPath = path.join(__dirname, 'tools-catalog-data.js');
fs.writeFileSync(outPath, out);
console.log('Wrote', outPath);
