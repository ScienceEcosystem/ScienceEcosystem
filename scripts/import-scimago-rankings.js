// One-off importer for Scimago Journal Rank (SJR) data into
// journal_scimago_rankings. Scimago has no live public API — their site
// (scimagojr.com/journalrank.php) sits behind a Cloudflare bot challenge
// that blocks automated fetches entirely (confirmed directly: even a plain
// page load from this server gets a "Just a moment..." JS-challenge page,
// not real content), so this can't be a scheduled job. Deliberately manual:
// download the file yourself in a real browser once a year via the
// "Download data" button on https://www.scimagojr.com/journalrank.php,
// then run this script against it.
//
// Usage:
//   node scripts/import-scimago-rankings.js /path/to/scimagojr-YYYY.csv [year]
//
// Expected format: Scimago's standard export — semicolon-delimited,
// quoted fields, header row, decimal comma (e.g. "1,234" not "1.234"),
// an "Issn" column that can hold multiple ISSNs separated by ", " with no
// dashes (e.g. "18728162, 03043894"). Column lookup is by header name
// (case-insensitive), not position, so minor column-order/renaming
// changes in future Scimago exports shouldn't break this — but if a
// real file parses to 0 rows, check the header names against
// COLUMN_ALIASES below and report back rather than assuming the data.
'use strict';
import 'dotenv/config';
import pkg from 'pg';
import fs from 'fs';

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // A ~32k-row file means ~32k sequential round-trips — without these, a
  // single dropped connection mid-run hangs the whole process forever
  // with no error (confirmed live: a run silently stalled ~19k rows in,
  // never crashed, never finished, just sat at 0% CPU indefinitely).
  connectionTimeoutMillis: 10_000,
  query_timeout: 10_000,
});

const COLUMN_ALIASES = {
  title: ['title'],
  issn: ['issn'],
  sjr: ['sjr'],
  quartile: ['sjr best quartile', 'best quartile', 'quartile'],
  hIndex: ['h index', 'h-index'],
  categories: ['categories'],
};

function parseCsvLine(line, delimiter) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields.map(f => f.trim());
}

function detectDelimiter(headerLine) {
  return (headerLine.split(';').length > headerLine.split(',').length) ? ';' : ',';
}

function findColumn(headerLower, aliases) {
  for (const alias of aliases) {
    const idx = headerLower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseScimagoNumber(raw) {
  if (!raw) return null;
  // Scimago uses a decimal comma (European convention) — "1,234" is 1.234,
  // not one-thousand-two-hundred-thirty-four.
  const cleaned = String(raw).replace(/\./g, '').replace(',', '.').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeIssn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

async function run() {
  const filePath = process.argv[2];
  const yearArg = process.argv[3] ? Number(process.argv[3]) : new Date().getFullYear();
  if (!filePath) {
    console.error('Usage: node scripts/import-scimago-rankings.js /path/to/file.csv [year]');
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) { console.error('Empty file'); process.exit(1); }

  const delimiter = detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delimiter).map(h => h.toLowerCase());

  const col = {
    title: findColumn(header, COLUMN_ALIASES.title),
    issn: findColumn(header, COLUMN_ALIASES.issn),
    sjr: findColumn(header, COLUMN_ALIASES.sjr),
    quartile: findColumn(header, COLUMN_ALIASES.quartile),
    hIndex: findColumn(header, COLUMN_ALIASES.hIndex),
    categories: findColumn(header, COLUMN_ALIASES.categories),
  };
  console.log('Detected delimiter:', JSON.stringify(delimiter), '| columns:', col);
  if (col.issn === -1 || col.sjr === -1) {
    console.error('Could not find Issn/SJR columns in header — aborting rather than importing garbage.');
    console.error('Header found:', header);
    process.exit(1);
  }

  // Resume support: an interrupted run (dropped connection, killed process)
  // shouldn't have to redo everything already written for this same year —
  // fetch what's already there once, up front, and skip those ISSNs below.
  const already = await pool.query(`SELECT issn FROM journal_scimago_rankings WHERE year = $1`, [yearArg]);
  const alreadyDone = new Set(already.rows.map(r => r.issn));
  if (alreadyDone.size) console.log(`Resuming — ${alreadyDone.size} ISSNs already imported for ${yearArg}, will skip those.`);

  let rowsUpserted = 0;
  let rowsSkipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i], delimiter);
    const issnRaw = fields[col.issn] || '';
    const issns = issnRaw.split(',').map(normalizeIssn).filter(Boolean);
    if (!issns.length) { rowsSkipped++; continue; }
    if (issns.every(issn => alreadyDone.has(issn))) continue; // whole row already done

    const title = col.title !== -1 ? fields[col.title] : null;
    const sjr = parseScimagoNumber(fields[col.sjr]);
    const quartile = col.quartile !== -1 ? (fields[col.quartile] || null) : null;
    const hIndexVal = col.hIndex !== -1 ? parseScimagoNumber(fields[col.hIndex]) : null;
    const categories = col.categories !== -1 ? fields[col.categories] : null;

    for (const issn of issns) {
      try {
        await pool.query(
          `INSERT INTO journal_scimago_rankings (issn, title, sjr, sjr_best_quartile, h_index, categories, year, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,now())
           ON CONFLICT (issn) DO UPDATE SET
             title=EXCLUDED.title, sjr=EXCLUDED.sjr, sjr_best_quartile=EXCLUDED.sjr_best_quartile,
             h_index=EXCLUDED.h_index, categories=EXCLUDED.categories, year=EXCLUDED.year, updated_at=now()`,
          [issn, title || null, sjr, quartile, hIndexVal != null ? Math.round(hIndexVal) : null, categories || null, yearArg]
        );
        rowsUpserted++;
      } catch (e) {
        console.error(`Failed to upsert ISSN ${issn} (row ${i}):`, e.message);
      }
    }
    if (rowsUpserted > 0 && rowsUpserted % 2000 === 0) {
      console.log(`...${rowsUpserted} upserted so far (row ${i}/${lines.length})`);
    }
  }

  console.log(`Done. ${rowsUpserted} ISSN rows upserted, ${rowsSkipped} source rows skipped (no ISSN).`);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
