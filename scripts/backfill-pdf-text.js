// One-off backfill for full-text PDF search: extracts and stores
// library_pdfs.full_text for rows uploaded before that feature existed
// (extraction only happens automatically on new uploads, in
// server/index.js's extractAndStorePdfText()). Safe to re-run — only
// touches rows where full_text IS NULL.
//
// Usage:
//   node scripts/backfill-pdf-text.js
'use strict';
import 'dotenv/config';
import pkg from 'pg';
import fs from 'fs';
import { PDFParse } from 'pdf-parse';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const r2Client = process.env.R2_ACCOUNT_ID ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_KEY || '',
  },
}) : null;
const R2_BUCKET = process.env.R2_BUCKET || '';

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Mirrors storePdfFile()'s two storage shapes (server/index.js): an
// "r2:{key}" prefix, or a plain local filesystem path.
async function fetchPdfBuffer(storagePath) {
  if (storagePath.startsWith('r2:')) {
    if (!r2Client) throw new Error('R2 not configured, cannot fetch r2:-stored PDF');
    const key = storagePath.slice(3);
    const obj = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return streamToBuffer(obj.Body);
  }
  return fs.promises.readFile(storagePath);
}

async function run() {
  const { rows } = await pool.query(
    `SELECT id, orcid, paper_id, storage_path FROM library_pdfs WHERE full_text IS NULL ORDER BY id`
  );
  console.log(`${rows.length} PDF(s) need backfilling.`);

  let ok = 0, empty = 0, failed = 0;
  for (const row of rows) {
    try {
      const buffer = await fetchPdfBuffer(row.storage_path);
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      const text = (result?.text || '').slice(0, 2_000_000);
      await pool.query(`UPDATE library_pdfs SET full_text=$1 WHERE id=$2`, [text, row.id]);
      if (text.trim().length) { ok++; console.log(`[ok] ${row.orcid}/${row.paper_id} — ${text.length} chars`); }
      else { empty++; console.log(`[empty] ${row.orcid}/${row.paper_id} — likely a scanned/image PDF, no text layer`); }
    } catch (e) {
      failed++;
      console.log(`[fail] ${row.orcid}/${row.paper_id} — ${e.message}`);
    }
  }
  console.log(`\nDone: ${ok} extracted, ${empty} empty (scanned/no text), ${failed} failed.`);
}

run()
  .catch(e => { console.error('Backfill failed:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
