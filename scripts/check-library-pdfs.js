// Audits library_items / library_pdfs for PDFs that will show (or already
// show) "PDF not found" / "PDF no longer available" in the reader.
//
// Usage:
//   node scripts/check-library-pdfs.js
//
// Categories reported:
//   1. "dead"    — local_pdf_path is set but there's no matching library_pdfs
//                  row, so sendLibraryPdf() has nothing to serve at all
//                  (the "PDF not found" case).
//   2. "at-risk" — library_pdfs.storage_path points at the local filesystem
//                  (not "r2:...") — these still work today, but will be
//                  wiped on the next Render restart/deploy.
'use strict';
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const dead = await pool.query(`
    SELECT li.orcid, li.id AS paper_id, li.title, li.local_pdf_path
    FROM library_items li
    LEFT JOIN library_pdfs lp ON lp.orcid = li.orcid AND lp.paper_id = li.id
    WHERE li.local_pdf_path IS NOT NULL AND lp.storage_path IS NULL
    ORDER BY li.orcid, li.title
  `);

  const atRisk = await pool.query(`
    SELECT li.orcid, li.id AS paper_id, li.title, lp.storage_path, lp.source
    FROM library_pdfs lp
    JOIN library_items li ON li.orcid = lp.orcid AND li.id = lp.paper_id
    WHERE lp.storage_path NOT LIKE 'r2:%'
    ORDER BY li.orcid, li.title
  `);

  const totals = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM library_items WHERE local_pdf_path IS NOT NULL) AS with_local_pdf_path,
      (SELECT COUNT(*) FROM library_pdfs) AS total_pdf_rows,
      (SELECT COUNT(*) FROM library_pdfs WHERE storage_path LIKE 'r2:%') AS r2_rows
  `);

  console.log('--- Summary ---');
  console.log(totals.rows[0]);

  console.log(`\n--- Dead references (${dead.rowCount}) ---`);
  console.log('These show "PDF not found" right now. Re-attach the PDF via');
  console.log('the library inspector\'s "Attach PDF" button to fix.');
  for (const r of dead.rows) {
    console.log(`[${r.orcid}] ${r.paper_id} — ${r.title}`);
  }

  console.log(`\n--- At-risk (local filesystem storage, ${atRisk.rowCount}) ---`);
  console.log('These work now but will break on the next Render restart');
  console.log('unless re-attached so they get stored in R2.');
  for (const r of atRisk.rows) {
    console.log(`[${r.orcid}] ${r.paper_id} — ${r.title} (source: ${r.source}, path: ${r.storage_path})`);
  }
}

run()
  .catch(e => { console.error('Audit failed:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
