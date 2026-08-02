import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pkg from "pg";

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Generate sitemap.xml from every .html file in the repo root, PLUS real
// entity pages pulled from the database — paper.html?id=X for every paper
// that's actually in someone's library, and profile.html?id=X for every
// user with a linked OpenAlex author id. Before this, the sitemap only ever
// listed the 20-odd bare template files (paper.html with no ?id= at all),
// meaning Google had no way to discover a single real content page through
// it — bare template URLs even show "Loading paper…" with nothing to index.
// DB step degrades gracefully: no DATABASE_URL, or a DB error, just falls
// back to the static-file-only sitemap this always produced.
async function fetchDbUrls(domain) {
  if (!process.env.DATABASE_URL) return [];
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [papers, profiles] = await Promise.all([
      pool.query(`SELECT DISTINCT id FROM library_items`),
      pool.query(`SELECT openalex_author_id FROM users WHERE openalex_author_id IS NOT NULL AND openalex_author_id <> ''`),
    ]);
    // library_items.id isn't always an OpenAlex work id — Zotero-synced
    // items store a Zotero key instead (e.g. "zotero:SI4WZIEM"), which
    // paper.html can't resolve into anything (no such OpenAlex work exists,
    // so the page would just show "Error loading paper details"). Checked
    // live: ~27% of library_items rows are Zotero keys. Only include ids
    // paper.js's own normalizePaperId() can actually turn into a working
    // OpenAlex lookup: a bare/URL work id, or a DOI.
    const isResolvableWorkId = (id) =>
      /^W\d+$/.test(id) || /openalex\.org\/W\d+/i.test(id) || /^doi:/i.test(id) || /^10\.\d{4,9}\//.test(id);
    // users.openalex_author_id is meant to only ever hold a real OpenAlex
    // author id, but at least one row in production has something else in
    // it (a username, not an id) — checked live. Filter to the real format.
    const isResolvableAuthorId = (id) => /^A\d+$/.test(id);

    const urls = [];
    for (const row of papers.rows) {
      if (!row.id || !isResolvableWorkId(row.id)) continue;
      urls.push({ loc: `${domain}paper.html?id=${encodeURIComponent(row.id)}` });
    }
    for (const row of profiles.rows) {
      if (!row.openalex_author_id || !isResolvableAuthorId(row.openalex_author_id)) continue;
      urls.push({ loc: `${domain}profile.html?id=${encodeURIComponent(row.openalex_author_id)}` });
    }
    return urls;
  } catch (err) {
    console.warn("Skipping DB-backed sitemap URLs (DB unavailable):", err.message);
    return [];
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  const root = process.cwd();
  const domain = "https://scienceecosystem.org/";
  const today = new Date().toISOString().slice(0, 10);

  const entries = await fs.readdir(root, { withFileTypes: true });
  const pages = entries
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  // Map files to URLs (index.html becomes site root).
  const staticUrls = pages.map((file) => {
    const loc = file === "index.html" ? domain : domain + file;
    return { loc, lastmod: today, priority: file === "index.html" ? "1.0" : undefined };
  });

  const dbUrls = (await fetchDbUrls(domain)).map((u) => ({ ...u, lastmod: today }));

  const urls = [...staticUrls, ...dbUrls];

  const xmlBody = urls
    .map((u) => {
      const priority = u.priority ? `<priority>${u.priority}</priority>` : "";
      return `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod>${priority}</url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlBody}\n</urlset>\n`;

  await fs.writeFile(path.join(root, "sitemap.xml"), xml, "utf8");
  console.log(`sitemap.xml updated with ${urls.length} URLs (${staticUrls.length} static, ${dbUrls.length} from DB) (${today}).`);
}

main().catch((err) => {
  console.error("Failed to generate sitemap:", err);
  process.exit(1);
});
