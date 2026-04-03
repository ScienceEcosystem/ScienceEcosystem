// server/index.js
import express from "express";
import fetch from "node-fetch";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";
import pkg from "pg";
import { resolveArtifacts } from "./artifacts-resolver.js";
const { Pool } = pkg;
const fsp = fs.promises;
import paperRoutes from "../routes/paper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const {
  PORT = 5173,
  SESSION_SECRET = "dev-secret",
  ORCID_BASE = "https://orcid.org",
  ORCID_API_BASE = "https://api.orcid.org/v3.0",
  ORCID_CLIENT_ID,
  ORCID_CLIENT_SECRET,
  ORCID_REDIRECT_URI,
  ORCID_SCOPE = "/authenticate",
  STATIC_DIR = "../",
  NODE_ENV = "development",
  COOKIE_DOMAIN,                // optional: ".scienceecosystem.org"
  DATABASE_URL,                 // Neon: postgresql://... ?sslmode=require
  ZOTERO_SYNC_INTERVAL_MS = 3600000
} = process.env;

if (!ORCID_CLIENT_ID || !ORCID_CLIENT_SECRET || !ORCID_REDIRECT_URI) {
  console.error("Missing ORCID env vars in .env");
  process.exit(1);
}
const HAS_DATABASE_URL = !!process.env.DATABASE_URL;
if (!HAS_DATABASE_URL) {
  console.warn("[db] DATABASE_URL not set; database-backed routes will be unavailable.");
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// Canonical host + scheme redirects for SEO.
app.use((req, res, next) => {
  if (NODE_ENV !== "production") return next();

  const host = req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const isHttps = proto === "https";
  const canonicalHost = "scienceecosystem.org";

  if (host && host !== canonicalHost) {
    return res.redirect(301, `https://${canonicalHost}${req.originalUrl}`);
  }
  if (!isHttps) {
    return res.redirect(301, `https://${canonicalHost}${req.originalUrl}`);
  }
  if (req.path === "/index.html") {
    return res.redirect(301, `https://${canonicalHost}/`);
  }
  next();
});

// If DB is unavailable, short-circuit API/auth routes with a clear error.
app.use((req, res, next) => {
  if (!pool && (req.path.startsWith("/api") || req.path.startsWith("/auth"))) {
    return res.status(503).json({ error: "Database unavailable" });
  }
  return next();
});

/* ---------------------------------
   Postgres (Neon) connection + DDL
----------------------------------*/
const pool = HAS_DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
function assertDb(res) {
  if (pool) return true;
  res.status(503).json({ error: "Database unavailable" });
  return false;
}

async function pgInit() {
  if (!pool) return;
  // Core tables you already had
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      orcid TEXT PRIMARY KEY,
      name TEXT,
      affiliation TEXT,
      bio TEXT,
      keywords TEXT[],
      languages TEXT[],
      links TEXT[],
      visibility TEXT DEFAULT 'public'
    );

    CREATE TABLE IF NOT EXISTS library_items (
      orcid TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (orcid, id),
      CONSTRAINT fk_user FOREIGN KEY (orcid) REFERENCES users(orcid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claimed_authors (
      orcid TEXT NOT NULL,
      author_id TEXT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (orcid, author_id),
      CONSTRAINT fk_user2 FOREIGN KEY (orcid) REFERENCES users(orcid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS merged_claims (
      orcid TEXT NOT NULL,
      primary_author_id TEXT NOT NULL,
      merged_author_id  TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (orcid, primary_author_id, merged_author_id),
      CONSTRAINT fk_user3 FOREIGN KEY (orcid) REFERENCES users(orcid) ON DELETE CASCADE
    );
  `);

  // Ensure legacy tables gain newer columns (idempotent)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS keywords TEXT[]`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS languages TEXT[]`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS links TEXT[]`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public'`);
  await pool.query(`UPDATE users SET visibility='public' WHERE visibility IS NULL`);

  // New: followed authors
  await pool.query(`
    CREATE TABLE IF NOT EXISTS followed_authors (
      orcid TEXT NOT NULL,
      author_id TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (orcid, author_id),
      CONSTRAINT fk_user_follow FOREIGN KEY (orcid) REFERENCES users(orcid) ON DELETE CASCADE
    );
  `);

  // New: collections + collection_items
  await pool.query(`
    CREATE TABLE IF NOT EXISTS collections (
      id SERIAL PRIMARY KEY,
      orcid TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collection_items (
      orcid TEXT NOT NULL,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      paper_id TEXT NOT NULL,
      PRIMARY KEY (orcid, collection_id, paper_id)
    );
  `);
  await pool.query(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

  // New: notes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id BIGSERIAL PRIMARY KEY,
      orcid TEXT NOT NULL,
      paper_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Library PDFs (user-scoped)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS library_pdfs (
      id BIGSERIAL PRIMARY KEY,
      orcid TEXT NOT NULL REFERENCES users(orcid) ON DELETE CASCADE,
      paper_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      file_size BIGINT,
      mime_type TEXT DEFAULT 'application/pdf',
      source TEXT DEFAULT 'upload',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(orcid, paper_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS library_pdfs_orcid_idx ON library_pdfs(orcid)`);

  // Identity linking status
  await pool.query(`
    CREATE TABLE IF NOT EXISTS identity_links (
      orcid TEXT PRIMARY KEY,
      github BOOLEAN DEFAULT FALSE,
      scholar BOOLEAN DEFAULT FALSE,
      osf BOOLEAN DEFAULT FALSE,
      zenodo BOOLEAN DEFAULT FALSE,
      last_sync TIMESTAMPTZ
    );
  `);

  // Projects + tasks + team
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      orcid TEXT NOT NULL REFERENCES users(orcid) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT,
      stage TEXT DEFAULT 'in-progress',
      last_active TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS projects_orcid_idx ON projects(orcid);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_tasks (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      orcid TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      assignee TEXT,
      due_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS project_tasks_proj_idx ON project_tasks(project_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_team (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      orcid TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'collaborator',
      invited_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS project_team_proj_idx ON project_team(project_id);
  `);

  // Materials + files
  await pool.query(`
    CREATE TABLE IF NOT EXISTS materials (
      id BIGSERIAL PRIMARY KEY,
      orcid TEXT NOT NULL REFERENCES users(orcid) ON DELETE CASCADE,
      project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'material',
      status TEXT DEFAULT 'draft',
      description TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS materials_orcid_idx ON materials(orcid);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS material_files (
      id BIGSERIAL PRIMARY KEY,
      material_id BIGINT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      name TEXT,
      url TEXT,
      size BIGINT
    );
    CREATE INDEX IF NOT EXISTS material_files_mat_idx ON material_files(material_id);
  `);

  // Activity stream (user scoped)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id BIGSERIAL PRIMARY KEY,
      orcid TEXT NOT NULL REFERENCES users(orcid) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'all',
      project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
      verb TEXT NOT NULL,
      object TEXT,
      link TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS activity_orcid_idx ON activity_log(orcid);
  `);

  // Extend library_items with cached metadata columns (idempotent)
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS openalex_id  TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS openalex_url TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS doi         TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS year        INTEGER`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS venue       TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS authors     TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS cited_by    INTEGER`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS abstract    TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS pdf_url     TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS meta_fresh  BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS local_pdf_path TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS zotero_key TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS zotero_version INTEGER`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS tags TEXT[]`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS notes_raw TEXT`);
  await pool.query(`ALTER TABLE library_items ADD COLUMN IF NOT EXISTS collection_ids_zotero TEXT[]`);

  // Zotero connections + sync log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zotero_connections (
      orcid TEXT PRIMARY KEY REFERENCES users(orcid) ON DELETE CASCADE,
      zotero_user_id TEXT NOT NULL,
      api_key TEXT NOT NULL,
      last_sync_version INTEGER DEFAULT 0,
      last_synced_at TIMESTAMPTZ,
      sync_enabled BOOLEAN DEFAULT TRUE,
      sync_pdfs BOOLEAN DEFAULT TRUE,
      conflict_resolution TEXT DEFAULT 'zotero_wins'
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zotero_sync_log (
      id BIGSERIAL PRIMARY KEY,
      orcid TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      items_synced INTEGER,
      errors JSONB
    );
  `);

  // Collections: map Zotero keys (optional)
  await pool.query(`ALTER TABLE collections ADD COLUMN IF NOT EXISTS zotero_key TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS collections_orcid_zotero_key_idx ON collections(orcid, zotero_key) WHERE zotero_key IS NOT NULL`);
}
try {
  await pgInit();
} catch (e) {
  console.error("[db] init failed; continuing without database:", e?.message || e);
}

/* ---------------------------
   Session helpers (persistent)
----------------------------*/
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: NODE_ENV === "production",
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  };
}
async function setSession(res, payload) {
  const sid = crypto.randomBytes(24).toString("hex");
  const expires = Date.now() + (30 * 24 * 60 * 60 * 1000);
  // Ensure JSONB gets valid JSON
  await pool.query(
    `INSERT INTO sessions (sid, data, expires_at)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [sid, JSON.stringify(payload), expires]
  );
  res.cookie("sid", sid, cookieOptions());
}
async function getSession(req) {
  const sid = req.signedCookies?.sid;
  if (!sid) return null;
  const { rows } = await pool.query(`SELECT data, expires_at FROM sessions WHERE sid = $1`, [sid]);
  if (!rows.length) return null;
  const row = rows[0];
  if (Number(row.expires_at) < Date.now()) {
    await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
    return null;
  }
  // row.data is JSONB → JS object already, but normalize:
  return typeof row.data === "string" ? JSON.parse(row.data) : row.data;
}
async function clearSession(req, res) {
  const sid = req.signedCookies?.sid;
  if (sid) await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
  res.clearCookie("sid", cookieOptions());
}
setInterval(() => pool.query(`DELETE FROM sessions WHERE expires_at < $1`, [Date.now()]).catch(()=>{}), 12 * 60 * 60 * 1000);

function requireAuth(req, res) {
  return getSession(req).then(sess => {
    if (!sess) { res.status(401).json({ error: "Not signed in" }); return null; }
    return sess;
  });
}

/* ------------
   SQL helpers
-------------*/
async function upsertUser({ orcid, name, affiliation, bio = null, keywords = null, languages = null, links = null, visibility = null }) {
  await pool.query(
    `INSERT INTO users (orcid, name, affiliation, bio, keywords, languages, links, visibility)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (orcid) DO UPDATE SET
       name = EXCLUDED.name,
       affiliation = EXCLUDED.affiliation,
       bio = COALESCE(EXCLUDED.bio, users.bio),
       keywords = COALESCE(EXCLUDED.keywords, users.keywords),
       languages = COALESCE(EXCLUDED.languages, users.languages),
       links = COALESCE(EXCLUDED.links, users.links),
       visibility = COALESCE(EXCLUDED.visibility, users.visibility)`,
    [orcid, name, affiliation, bio, keywords, languages, links, visibility]
  );
}
async function getUser(orcid) {
  const { rows } = await pool.query(
    `SELECT orcid, name, affiliation, bio, keywords, languages, links, visibility FROM users WHERE orcid = $1`,
    [orcid]
  );
  return rows[0] || null;
}
async function updateProfile(orcid, payload) {
  const { name, affiliation, bio, keywords, languages, links, visibility } = payload;
  const { rowCount, rows } = await pool.query(
    `UPDATE users SET
      name=$2,
      affiliation=$3,
      bio=$4,
      keywords=$5,
      languages=$6,
      links=$7,
      visibility=$8
     WHERE orcid=$1
     RETURNING orcid, name, affiliation, bio, keywords, languages, links, visibility`,
    [orcid, name, affiliation, bio, keywords, languages, links, visibility]
  );
  if (rowCount) return rows[0];
  // If user row is missing for some reason, create it and return payload
  await upsertUser({ orcid, name, affiliation, bio, keywords, languages, links, visibility });
  return payload;
}
async function libraryList(orcid) {
  const { rows } = await pool.query(
    `SELECT id, title, doi, openalex_id
     FROM library_items WHERE orcid = $1 ORDER BY title`,
    [orcid]
  );
  return rows;
}
async function libraryAdd(orcid, id, title) {
  await pool.query(
    `INSERT INTO library_items (orcid, id, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (orcid, id) DO NOTHING`,
    [orcid, id, title]
  );
}
async function libraryDel(orcid, id) {
  await pool.query(`DELETE FROM library_items WHERE orcid = $1 AND id = $2`, [orcid, id]);
}
async function libraryClear(orcid) {
  await pool.query(`DELETE FROM library_items WHERE orcid = $1`, [orcid]);
}

// Claims/Merges
async function claimsList(orcid) {
  const claims = await pool.query(
    `SELECT author_id, verified, EXTRACT(EPOCH FROM created_at)::bigint AS created_at
     FROM claimed_authors WHERE orcid=$1 ORDER BY created_at DESC`, [orcid]);
  const merges = await pool.query(
    `SELECT primary_author_id, merged_author_id, EXTRACT(EPOCH FROM created_at)::bigint AS created_at
     FROM merged_claims WHERE orcid=$1 ORDER BY created_at DESC`, [orcid]);
  return { claims: claims.rows, merges: merges.rows };
}
async function claimAdd(orcid, author_id) {
  await pool.query(
    `INSERT INTO claimed_authors (orcid, author_id, verified)
     VALUES ($1, $2, FALSE)
     ON CONFLICT (orcid, author_id) DO NOTHING`,
    [orcid, author_id]
  );
}
async function claimDel(orcid, author_id) {
  await pool.query(`DELETE FROM claimed_authors WHERE orcid=$1 AND author_id=$2`, [orcid, author_id]);
}

// Follows
async function followsList(orcid) {
  const { rows } = await pool.query(
    `SELECT author_id, name, EXTRACT(EPOCH FROM created_at)::bigint AS created_at
     FROM followed_authors WHERE orcid=$1 ORDER BY created_at DESC`,
    [orcid]
  );
  return rows;
}
async function followAdd(orcid, author_id, name) {
  await pool.query(
    `INSERT INTO followed_authors (orcid, author_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (orcid, author_id) DO UPDATE SET name = EXCLUDED.name`,
    [orcid, author_id, name]
  );
}
async function followDel(orcid, author_id) {
  await pool.query(`DELETE FROM followed_authors WHERE orcid=$1 AND author_id=$2`, [orcid, author_id]);
}
async function mergeAdd(orcid, primary_id, merged_id) {
  await pool.query(
    `INSERT INTO merged_claims (orcid, primary_author_id, merged_author_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [orcid, primary_id, merged_id]
  );
}
async function mergeDel(orcid, primary_id, merged_id) {
  await pool.query(
    `DELETE FROM merged_claims WHERE orcid=$1 AND primary_author_id=$2 AND merged_author_id=$3`,
    [orcid, primary_id, merged_id]
  );
}

// Identity links
async function getIdentity(orcid) {
  const { rows } = await pool.query(
    `INSERT INTO identity_links (orcid)
     VALUES ($1)
     ON CONFLICT (orcid) DO NOTHING
     RETURNING orcid, github, scholar, osf, zenodo, last_sync`,
    [orcid]
  );
  if (rows[0]) return rows[0];
  const existing = await pool.query(
    `SELECT orcid, github, scholar, osf, zenodo, last_sync FROM identity_links WHERE orcid=$1`,
    [orcid]
  );
  return existing.rows[0] || { orcid, github:false, scholar:false, osf:false, zenodo:false, last_sync:null };
}

async function setIdentityField(orcid, field, value) {
  const allowed = ["github","scholar","osf","zenodo"];
  if (!allowed.includes(field)) throw new Error("Invalid identity field");
  await pool.query(
    `INSERT INTO identity_links (orcid, ${field})
     VALUES ($1, $2)
     ON CONFLICT (orcid) DO UPDATE SET ${field} = EXCLUDED.${field}`,
    [orcid, !!value]
  );
}

async function markIdentitySync(orcid) {
  await pool.query(
    `INSERT INTO identity_links (orcid, last_sync)
     VALUES ($1, now())
     ON CONFLICT (orcid) DO UPDATE SET last_sync = now()`,
    [orcid]
  );
}

// Projects + tasks + activity
async function ownedProject(orcid, projectId) {
  const { rows } = await pool.query(
    `SELECT id, orcid, title, summary, stage, last_active
     FROM projects WHERE id=$1 AND orcid=$2`,
    [Number(projectId), orcid]
  );
  return rows[0] || null;
}

async function touchProject(projectId) {
  await pool.query(`UPDATE projects SET last_active = now() WHERE id=$1`, [Number(projectId)]);
}

async function countOpenTasks(projectId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS open_tasks FROM project_tasks WHERE project_id=$1 AND status NOT IN ('done','closed','completed')`,
    [Number(projectId)]
  );
  return rows[0]?.open_tasks ?? 0;
}

async function logActivity(orcid, { scope = "all", project_id = null, verb, object, link = null }) {
  if (!verb) return;
  await pool.query(
    `INSERT INTO activity_log (orcid, scope, project_id, verb, object, link)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [orcid, scope, project_id ? Number(project_id) : null, verb, object || null, link || null]
  );
}

// Materials
async function ownedMaterial(orcid, materialId) {
  const { rows } = await pool.query(
    `SELECT id, orcid, project_id, title, type, status, description, updated_at FROM materials WHERE id=$1 AND orcid=$2`,
    [Number(materialId), orcid]
  );
  return rows[0] || null;
}

/* -----------------------------
   External APIs (OpenAlex/OA)
------------------------------*/
const OPENALEX = "https://api.openalex.org";
const UNPAYWALL_EMAIL = "scienceecosystem@icloud.com";
const OA_CACHE = new Map();
const OA_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(()=>r.statusText)}`);
  return r.json();
}
function cacheGet(key) {
  if (!key) return null;
  const entry = OA_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    OA_CACHE.delete(key);
    return null;
  }
  return entry.value || null;
}
function cacheSet(key, value) {
  if (!key) return;
  OA_CACHE.set(key, { value, expiresAt: Date.now() + OA_TTL_MS });
}
function normalizeDoi(raw) {
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/doi.org\//i, "");
}
function normalizeOpenAlexId(raw) {
  if (!raw) return "";
  return String(raw).trim().replace(/^https?:\/\/openalex\.org\//i, "");
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}
async function fetchJSONTimeout(url, options = {}, timeoutMs = 5000) {
  const r = await fetchWithTimeout(url, { ...options, headers: { "Accept": "application/json", ...(options.headers || {}) } }, timeoutMs);
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(()=>r.statusText)}`);
  return r.json();
}

// Simple HTML link extractor for known code/data hosts
function extractLinks(html) {
  const links = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    links.push(m[1]);
  }
  const allow = [
    "github.com","gitlab.com","bitbucket.org","zenodo.org","figshare.com","figshare.com",
    "osf.io","dataverse","dryad","codeocean","kaggle.com"
  ];
  return links.filter(h=>{
    try {
      const u = new URL(h, "https://example.com");
      return allow.some(a=>u.hostname.includes(a));
    } catch(_){ return false; }
  });
}
function invertAbstract(idx){
  const words = [];
  Object.keys(idx||{}).forEach(word => {
    for (const pos of idx[word]) words[pos] = word;
  });
  return words.join(" ");
}
async function hydrateWorkMeta(idTail) {
  const work = await fetchJSON(`${OPENALEX}/works/${encodeURIComponent(idTail)}`);

  // DOI → Unpaywall
  const doi = work.doi || work?.ids?.doi || null;
  let pdf_url = null;
  if (doi) {
    try {
      const doiClean = String(doi).replace(/^doi:/i,"");
      const up = await fetchJSON(`https://api.unpaywall.org/v2/${encodeURIComponent(doiClean)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`);
      const best = up.best_oa_location || null;
      pdf_url = best?.url_for_pdf || best?.url || null;
    } catch(_) {}
  }

  const authors = (work.authorships || [])
    .map(a => a?.author?.display_name)
    .filter(Boolean).join(", ");

  const venue = work?.host_venue?.display_name || work?.primary_location?.source?.display_name || null;

  return {
    openalex_id: idTail,
    openalex_url: work.id,
    doi: doi ? String(doi).replace(/^doi:/i,"") : null,
    title: work.display_name || work.title || "Untitled",
    year: work.publication_year ?? null,
    venue,
    authors,
    cited_by: work.cited_by_count ?? 0,
    abstract: work.abstract_inverted_index ? invertAbstract(work.abstract_inverted_index) : null,
    pdf_url,
    meta_fresh: true
  };
}

/* -----------------------------
   Zotero sync helpers
------------------------------*/
const ZOTERO_BASE = "https://api.zotero.org";
const ZOTERO_UA = "ScholarsEdge/1.0 (https://scienceecosystem.org)";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function zoteroFetch(url, apiKey, options = {}, attempt = 0) {
  const maxAttempts = 5;
  const opts = {
    ...options,
    headers: {
      "Zotero-API-Key": apiKey,
      "User-Agent": ZOTERO_UA,
      ...(options.headers || {})
    }
  };
  const res = await fetchWithTimeout(url, opts, 10000);
  if (res.status === 429 && attempt < maxAttempts) {
    const retryAfter = Number(res.headers.get("Retry-After")) || Math.min(2 ** attempt, 30);
    await sleep(retryAfter * 1000);
    return zoteroFetch(url, apiKey, options, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zotero ${res.status}: ${text || res.statusText}`);
  }
  return res;
}

function zoteroItemToLibrary(item) {
  const data = item?.data || {};
  const doi = normalizeDoi(data.DOI || "");
  const yearMatch = String(data.date || "").match(/\b(19|20)\d{2}\b/);
  const creators = Array.isArray(data.creators) ? data.creators : [];
  const authors = creators.map(c => {
    if (c.name) return c.name;
    return [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  }).filter(Boolean).join(", ");
  const url = String(data.url || "").trim();
  const isOpenAlexUrl = url.includes("openalex.org");
  const tags = Array.isArray(data.tags) ? data.tags.map(t => t?.tag).filter(Boolean) : [];

  return {
    id: doi ? `doi:${doi}` : `zotero:${item.key}`,
    title: data.title || data.shortTitle || "Untitled",
    openalex_url: isOpenAlexUrl ? url : null,
    pdf_url: !isOpenAlexUrl && url ? url : null,
    doi: doi || null,
    year: yearMatch ? Number(yearMatch[0]) : null,
    venue: data.publicationTitle || data.conferenceName || null,
    authors: authors || null,
    abstract: data.abstractNote || null,
    tags,
    zotero_key: item.key,
    zotero_version: item.version || null,
    collection_ids_zotero: Array.isArray(data.collections) ? data.collections : []
  };
}

async function ensureZoteroCollections(orcid, zoteroUserId, apiKey) {
  const res = await zoteroFetch(`${ZOTERO_BASE}/users/${zoteroUserId}/collections`, apiKey);
  const collections = await res.json();
  if (!Array.isArray(collections) || !collections.length) return new Map();

  // First pass: ensure each collection row exists
  for (const c of collections) {
    const key = c?.key;
    if (!key) continue;
    const name = c?.data?.name || "Untitled";
    await pool.query(
      `INSERT INTO collections (orcid, name, parent_id, zotero_key)
       VALUES ($1, $2, NULL, $3)
       ON CONFLICT (orcid, zotero_key) DO UPDATE SET name = EXCLUDED.name`,
      [orcid, name, key]
    );
  }

  const { rows } = await pool.query(
    `SELECT id, zotero_key FROM collections WHERE orcid=$1 AND zotero_key IS NOT NULL`,
    [orcid]
  );
  const map = new Map(rows.map(r => [r.zotero_key, r.id]));

  // Second pass: update parents
  for (const c of collections) {
    const key = c?.key;
    if (!key) continue;
    const parentKey = c?.data?.parentCollection || null;
    const parentId = parentKey ? map.get(parentKey) || null : null;
    await pool.query(
      `UPDATE collections SET parent_id=$1 WHERE orcid=$2 AND zotero_key=$3`,
      [parentId, orcid, key]
    );
  }
  return map;
}

async function syncZoteroForUser(orcid) {
  const startedAt = new Date();
  const errors = [];
  let itemsSynced = 0;
  const conn = await pool.query(
    `SELECT zotero_user_id, api_key, last_sync_version, sync_enabled, sync_pdfs
     FROM zotero_connections WHERE orcid=$1`,
    [orcid]
  );
  if (!conn.rowCount) return { synced: 0, errors: ["No Zotero connection"] };
  const { zotero_user_id: zid, api_key: apiKey, last_sync_version: lastVersion, sync_enabled, sync_pdfs } = conn.rows[0];
  if (!sync_enabled) return { synced: 0, errors: ["Sync disabled"] };

  try {
    const versionsRes = await zoteroFetch(
      `${ZOTERO_BASE}/users/${zid}/items?since=${Number(lastVersion || 0)}&format=versions`,
      apiKey
    );
    const versions = await versionsRes.json();
    const changedKeys = Object.keys(versions || {});
    const newVersion = Number(versionsRes.headers.get("Last-Modified-Version")) || Number(lastVersion || 0);

    const collectionMap = await ensureZoteroCollections(orcid, zid, apiKey);
    const zoteroCollectionIds = Array.from(collectionMap.values());

    const batches = [];
    for (let i = 0; i < changedKeys.length; i += 25) {
      batches.push(changedKeys.slice(i, i + 25));
    }

    for (const batch of batches) {
      const fetched = await Promise.all(batch.map(async (key) => {
        try {
          const itemRes = await zoteroFetch(`${ZOTERO_BASE}/users/${zid}/items/${key}`, apiKey);
          return await itemRes.json();
        } catch (e) {
          errors.push(`Item ${key}: ${e.message}`);
          return null;
        }
      }));

      for (const item of fetched.filter(Boolean)) {
        if (item?.data?.itemType === "attachment" || item?.data?.itemType === "note") {
          continue;
        }
        const mapped = zoteroItemToLibrary(item);
        await pool.query(
          `INSERT INTO library_items (
            orcid, id, title, openalex_url, doi, year, venue, authors, abstract, pdf_url,
            zotero_key, zotero_version, last_synced_at, tags, notes_raw, collection_ids_zotero, meta_fresh, deleted_at
          )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13,$14,$15,TRUE,NULL)
           ON CONFLICT (orcid, id) DO UPDATE SET
             title=EXCLUDED.title,
             openalex_url=EXCLUDED.openalex_url,
             doi=EXCLUDED.doi,
             year=EXCLUDED.year,
             venue=EXCLUDED.venue,
             authors=EXCLUDED.authors,
             abstract=EXCLUDED.abstract,
             pdf_url=EXCLUDED.pdf_url,
             zotero_key=EXCLUDED.zotero_key,
             zotero_version=EXCLUDED.zotero_version,
             last_synced_at=now(),
             tags=EXCLUDED.tags,
             notes_raw=EXCLUDED.notes_raw,
             collection_ids_zotero=EXCLUDED.collection_ids_zotero,
             meta_fresh=TRUE`,
          [
            orcid, mapped.id, mapped.title, mapped.openalex_url, mapped.doi, mapped.year, mapped.venue,
            mapped.authors, mapped.abstract, mapped.pdf_url,
            mapped.zotero_key, mapped.zotero_version, mapped.tags, null, mapped.collection_ids_zotero
          ]
        );
        itemsSynced += 1;

        if (zoteroCollectionIds.length) {
          await pool.query(
            `DELETE FROM collection_items
             WHERE orcid=$1 AND paper_id=$2 AND collection_id = ANY($3::int[])`,
            [orcid, mapped.id, zoteroCollectionIds]
          );
        }
        for (const zk of mapped.collection_ids_zotero || []) {
          const cid = collectionMap.get(zk);
          if (!cid) continue;
          await pool.query(
            `INSERT INTO collection_items (orcid, collection_id, paper_id)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [orcid, cid, mapped.id]
          );
        }

        if (sync_pdfs) {
          try {
            const childrenRes = await zoteroFetch(
              `${ZOTERO_BASE}/users/${zid}/items/${item.key}/children?itemType=attachment`,
              apiKey
            );
            const children = await childrenRes.json();
            const pdfChild = Array.isArray(children)
              ? children.find(c => (c?.data?.contentType === "application/pdf") || String(c?.data?.filename || "").toLowerCase().endsWith(".pdf"))
              : null;
            if (pdfChild?.key) {
              const fileRes = await zoteroFetch(`${ZOTERO_BASE}/users/${zid}/items/${pdfChild.key}/file`, apiKey);
              const buf = Buffer.from(await fileRes.arrayBuffer());
              await fsp.mkdir(path.join(pdfUploadDir, orcid), { recursive: true });
              const safeKey = String(item.key).replace(/[^\w.\-]/g, "_");
              const safeAttach = String(pdfChild.key).replace(/[^\w.\-]/g, "_");
              const fname = `zotero_${safeKey}_${safeAttach}.pdf`;
              const fullPath = path.join(pdfUploadDir, orcid, fname);
              await fsp.writeFile(fullPath, buf);
              const safePath = ensureSafePath(pdfUploadDir, fullPath);
              const urlPath = `/uploads/pdfs/${orcid}/${fname}`;
              await pool.query(
                `INSERT INTO library_pdfs (orcid, paper_id, filename, storage_path, file_size, mime_type, source)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (orcid, paper_id) DO UPDATE SET
                   filename=EXCLUDED.filename,
                   storage_path=EXCLUDED.storage_path,
                   file_size=EXCLUDED.file_size,
                   mime_type=EXCLUDED.mime_type,
                   source=EXCLUDED.source`,
                [orcid, mapped.id, fname, safePath, buf.length, "application/pdf", "zotero"]
              );
              await pool.query(
                `UPDATE library_items SET local_pdf_path=$1 WHERE orcid=$2 AND id=$3`,
                [urlPath, orcid, mapped.id]
              );
            }
          } catch (e) {
            errors.push(`PDF ${item.key}: ${e.message}`);
          }
        }
      }
    }

    try {
      const delRes = await zoteroFetch(`${ZOTERO_BASE}/users/${zid}/deleted?since=${Number(lastVersion || 0)}`, apiKey);
      const del = await delRes.json();
      const deletedKeys = Array.isArray(del?.items) ? del.items : [];
      if (deletedKeys.length) {
        await pool.query(
          `UPDATE library_items SET deleted_at = now()
           WHERE orcid=$1 AND zotero_key = ANY($2::text[])`,
          [orcid, deletedKeys]
        );
      }
    } catch (e) {
      errors.push(`Deleted items: ${e.message}`);
    }

    await pool.query(
      `UPDATE zotero_connections SET last_sync_version=$1, last_synced_at=now()
       WHERE orcid=$2`,
      [newVersion, orcid]
    );
  } catch (e) {
    errors.push(e.message);
  } finally {
    const finishedAt = new Date();
    await pool.query(
      `INSERT INTO zotero_sync_log (orcid, started_at, finished_at, items_synced, errors)
       VALUES ($1,$2,$3,$4,$5)`,
      [orcid, startedAt, finishedAt, itemsSynced, JSON.stringify(errors)]
    );
  }

  return { synced: itemsSynced, errors };
}

/* ---------------------------
   Health + static
----------------------------*/
app.get("/health", (_req, res) => res.type("text").send("ok"));

app.use(paperRoutes);

const staticRoot = path.resolve(__dirname, STATIC_DIR);
const uploadDir = path.join(staticRoot, "uploads", "materials");
const pdfUploadDir = path.join(staticRoot, "uploads", "pdfs");
app.use(express.static(staticRoot, {
  extensions: ["html"],
  maxAge: NODE_ENV === "production" ? "1h" : 0
}));

function isPathInside(baseDir, targetPath) {
  const rel = path.relative(baseDir, targetPath);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
function ensureSafePath(baseDir, targetPath) {
  const resolved = path.resolve(targetPath);
  const baseResolved = path.resolve(baseDir);
  if (!isPathInside(baseResolved, resolved)) {
    const err = new Error("Invalid file path");
    err.code = "INVALID_PATH";
    throw err;
  }
  return resolved;
}

/* ---------------------------
   ORCID OAuth
----------------------------*/
app.get("/auth/orcid/login", (req, res) => {
  console.log("\n=== ORCID LOGIN INITIATED ===");
  console.log("Time:", new Date().toISOString());
  console.log("Environment check:");
  console.log("  ORCID_BASE:", process.env.ORCID_BASE);
  console.log("  ORCID_CLIENT_ID:", process.env.ORCID_CLIENT_ID);
  console.log("  ORCID_REDIRECT_URI:", process.env.ORCID_REDIRECT_URI);

  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("orcid_oauth", JSON.stringify({ state }), {
    httpOnly: true,
    sameSite: "lax",
    secure: NODE_ENV === "production",
    path: "/"
  });

  const params = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    response_type: "code",
    scope: ORCID_SCOPE,
    redirect_uri: ORCID_REDIRECT_URI,
    state
  });
  const authUrl = `${ORCID_BASE}/oauth/authorize?${params.toString()}`;
  console.log("Generated auth URL:", authUrl);
  console.log("Redirecting to ORCID...");
  console.log("===============================\n");
  return res.redirect(authUrl);
});

function sendAuthError(res, message) {
  res.status(400).type("html").send(`
    <!doctype html>
    <html><body style="font-family:Arial,sans-serif;padding:2rem;">
      <h2>Login error</h2>
      <p>${message}</p>
      <p><a href="/auth/orcid/login">Try logging in again</a> or go back to the <a href="/">home page</a>.</p>
    </body></html>
  `);
}

app.get("/auth/orcid/callback", async (req, res) => {
  console.log("\n=== ORCID CALLBACK RECEIVED ===");
  console.log("Time:", new Date().toISOString());
  console.log("Query params:", req.query);
  console.log("Full URL:", req.protocol + '://' + req.get('host') + req.originalUrl);

  const { code, state, error, error_description } = req.query;
  if (error) {
    console.error("❌ ORCID returned error:", error, error_description);
    console.log("===============================\n");
    return sendAuthError(res, `ORCID error: ${String(error_description || error)}`);
  }
  if (!code) {
    console.error("❌ No authorization code received");
    console.error("This usually means redirect URI mismatch");
    console.log("===============================\n");
    return res.redirect("/auth/orcid/login");
  }
  console.log("✓ Authorization code received:", String(code).substring(0, 20) + "...");
  console.log("Exchanging code for token...");
  const oauthCookie = req.cookies?.orcid_oauth;
  try {
    const parsed = JSON.parse(oauthCookie || "{}");
    if (parsed.state !== state) return sendAuthError(res, "State mismatch. Please try logging in again.");
  } catch (_e) {
    return sendAuthError(res, "Session expired. Please try logging in again.");
  }
  res.clearCookie("orcid_oauth", { path: "/" });

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: ORCID_REDIRECT_URI
  });

  try {
    console.log("Sending token request to ORCID...");
    const tokenRes = await fetch(`${ORCID_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: (() => {
        const withClient = new URLSearchParams(form);
        withClient.set("client_id", ORCID_CLIENT_ID);
        withClient.set("client_secret", ORCID_CLIENT_SECRET);
        return withClient;
      })()
    });
    console.log("Token response status:", tokenRes.status);
    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => "");
      console.error("ORCID token exchange failed:", tokenRes.status, t, "redirect:", ORCID_REDIRECT_URI);
      return sendAuthError(res, `Token exchange failed: ${tokenRes.status} ${t || "No response body."}`);
    }

    const token = await tokenRes.json();
    console.log("Token data received:", {
      access_token: token.access_token ? "present" : "missing",
      orcid: token.orcid,
      expires_in: token.expires_in
    });
    const orcid = token.orcid;
    if (!orcid) return sendAuthError(res, "Token response missing ORCID iD");

    // Fetch public profile (best-effort)
    let name = null, affiliation = null;
    try {
      const recRes = await fetch(`${ORCID_API_BASE}/${orcid}/record`, { headers: { Accept: "application/json" } });
      if (recRes.ok) {
        const rec = await recRes.json();
        const person = rec?.person;
        const given  = person?.name?.["given-names"]?.value || "";
        const family = person?.name?.["family-name"]?.value || "";
        const credit = person?.name?.["credit-name"]?.value || "";
        name = (credit || `${given} ${family}`).trim() || null;
        const emp = rec?.["activities-summary"]?.employments?.["employment-summary"]?.[0];
        affiliation = emp?.organization?.name || null;
      }
    } catch {}

    await upsertUser({ orcid, name, affiliation });
    await setSession(res, {
      orcid,
      orcid_access_token: token.access_token || null,
      orcid_scope: token.scope || null,
      orcid_expires_in: token.expires_in || null,
      orcid_token_type: token.token_type || null
    });
    console.log("✓ Token exchange successful");
    console.log("✓ User authenticated:", orcid);
    console.log("===============================\n");
    res.redirect("/user-profile.html");
  } catch (e) {
    console.error("❌ Token exchange failed:", e);
    console.log("===============================\n");
    return sendAuthError(res, `Login failed. Please try again. (${e.message || e})`);
  }
});

/* ---------------------------
   Upload helpers (materials)
----------------------------*/
async function parseMultipartForm(req, maxSize = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers["content-type"] || "";
    const boundaryMatch = ctype.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) return reject(new Error("Missing multipart boundary"));
    const boundary = `--${boundaryMatch[1]}`;
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxSize) {
        reject(new Error("Upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const parts = buffer.toString("binary").split(boundary).filter(Boolean);
      const fields = {};
      const files = [];

      for (const raw of parts) {
        if (raw === "--\r\n" || raw === "--") continue;
        const [rawHeaders, rawBody] = raw.split("\r\n\r\n");
        if (!rawHeaders || !rawBody) continue;
        const headerLines = rawHeaders.trim().split("\r\n").filter(Boolean);
        const dispoLine = headerLines.find(l => l.toLowerCase().startsWith("content-disposition"));
        if (!dispoLine) continue;
        const nameMatch = dispoLine.match(/name="([^"]+)"/i);
        const filenameMatch = dispoLine.match(/filename="([^"]*)"/i);
        const content = rawBody.replace(/^\r\n/, "").replace(/\r\n--$/, "").replace(/\r\n$/, "");

        if (filenameMatch && filenameMatch[1]) {
          const typeLine = headerLines.find(l => l.toLowerCase().startsWith("content-type"));
          const contentType = typeLine ? typeLine.split(":").slice(1).join(":").trim() : null;
          const buf = Buffer.from(content, "binary");
          files.push({ field: nameMatch?.[1] || "file", filename: filenameMatch[1], buffer: buf, size: buf.length, contentType });
        } else if (nameMatch) {
          fields[nameMatch[1]] = content.trim();
        }
      }
      resolve({ fields, files });
    });
  });
}

async function saveUploadedFile(file) {
  if (!file?.buffer?.length) return null;
  await fsp.mkdir(uploadDir, { recursive: true });
  const safeBase = (file.filename || "file").replace(/[^\w.\-]/g, "_");
  const fname = `${Date.now()}_${crypto.randomBytes(5).toString("hex")}_${safeBase}`;
  const fullPath = path.join(uploadDir, fname);
  await fsp.writeFile(fullPath, file.buffer);
  return { name: file.filename || "file", url: `/uploads/materials/${fname}`, size: file.size || file.buffer.length };
}

/* ---------------------------
   Auth + existing Library API
----------------------------*/
app.post("/auth/logout", async (req, res) => {
  await clearSession(req, res);
  res.status(204).end();
});

app.get("/api/me", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const row = await getUser(sess.orcid);
  if (!row) return res.status(404).json({ error: "User not found" });
  res.json(row);
});

app.get("/api/orcid/record", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const token = sess.orcid_access_token;
  if (!token) return res.status(403).json({ error: "ORCID access not granted" });
  try {
    const recRes = await fetch(`${ORCID_API_BASE}/${sess.orcid}/record`, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`
      }
    });
    if (!recRes.ok) {
      const text = await recRes.text().catch(() => "");
      return res.status(recRes.status).json({ error: text || "ORCID request failed" });
    }
    const record = await recRes.json();
    res.json(record);
  } catch (e) {
    console.error("GET /api/orcid/record failed:", e);
    res.status(500).json({ error: "Failed to load ORCID record" });
  }
});

app.patch("/api/settings/profile", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const body = req.body || {};
  const payload = {
    name: body.name || null,
    affiliation: body.affiliation || null,
    bio: body.bio || null,
    keywords: Array.isArray(body.keywords) ? body.keywords : [],
    languages: Array.isArray(body.languages) ? body.languages : [],
    links: Array.isArray(body.links) ? body.links : [],
    visibility: body.visibility || "public"
  };
  try {
    const updated = await updateProfile(sess.orcid, payload);
    res.json(updated || payload);
  } catch (e) {
    console.error("PATCH /api/settings/profile failed:", e);
    res.status(500).json({ error: "Failed to save profile" });
  }
});

app.get("/api/library", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  res.json(await libraryList(sess.orcid));
});

app.post("/api/library", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { id, title } = req.body || {};
  if (!id || !title) return res.status(400).json({ error: "id and title required" });
  await libraryAdd(sess.orcid, String(id), String(title));
  res.status(201).json({ ok: true });
});

app.delete("/api/library/:id", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  await libraryDel(sess.orcid, String(req.params.id));
  res.status(204).end();
});

app.delete("/api/library", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  await libraryClear(sess.orcid);
  res.status(204).end();
});

/* ---------------------------
   Library PDFs API
----------------------------*/
app.post("/api/library/pdf", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    const { fields, files } = await parseMultipartForm(req, 50 * 1024 * 1024);
    const paperId = String(fields?.paper_id || "").trim();
    if (!paperId) return res.status(400).json({ error: "paper_id required" });
    const file = (files || []).find(f => f.field === "file") || files?.[0];
    if (!file?.buffer?.length) return res.status(400).json({ error: "file required" });

    const filename = file.filename || "upload.pdf";
    const extOk = filename.toLowerCase().endsWith(".pdf");
    const mimeOk = String(file.contentType || "").toLowerCase() === "application/pdf";
    if (!extOk && !mimeOk) return res.status(400).json({ error: "Only PDF files allowed" });
    if (file.size > 50 * 1024 * 1024) return res.status(400).json({ error: "File too large" });

    const safePaper = paperId.replace(/[^\w.\-]/g, "_");
    await fsp.mkdir(path.join(pdfUploadDir, sess.orcid), { recursive: true });
    const fname = `${safePaper}_${Date.now()}.pdf`;
    const fullPath = path.join(pdfUploadDir, sess.orcid, fname);
    await fsp.writeFile(fullPath, file.buffer);
    const safePath = ensureSafePath(pdfUploadDir, fullPath);
    const urlPath = `/uploads/pdfs/${sess.orcid}/${fname}`;

    await pool.query(
      `INSERT INTO library_pdfs (orcid, paper_id, filename, storage_path, file_size, mime_type, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (orcid, paper_id) DO UPDATE SET
         filename=EXCLUDED.filename,
         storage_path=EXCLUDED.storage_path,
         file_size=EXCLUDED.file_size,
         mime_type=EXCLUDED.mime_type,
         source=EXCLUDED.source`,
      [sess.orcid, paperId, filename, safePath, file.size, file.contentType || "application/pdf", "upload"]
    );
    await pool.query(
      `UPDATE library_items SET local_pdf_path=$1 WHERE orcid=$2 AND id=$3`,
      [urlPath, sess.orcid, paperId]
    );
    res.json({ ok: true, url: urlPath, paper_id: paperId });
  } catch (e) {
    console.error("POST /api/library/pdf failed:", e);
    res.status(500).json({ error: "Failed to upload PDF" });
  }
});

app.get("/api/library/pdf/:paperId", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const paperId = String(req.params.paperId || "");
  const { rows } = await pool.query(
    `SELECT storage_path FROM library_pdfs WHERE orcid=$1 AND paper_id=$2`,
    [sess.orcid, paperId]
  );
  if (!rows.length) return res.status(404).json({ error: "PDF not found" });
  try {
    const stored = rows[0].storage_path;
    let candidate = stored;
    if (!path.isAbsolute(candidate)) {
      const rel = candidate.startsWith("/") ? candidate.slice(1) : candidate;
      candidate = path.join(staticRoot, rel);
    }
    const safePath = ensureSafePath(pdfUploadDir, candidate);
    return res.sendFile(safePath, err => {
      if (err) {
        if (err.code === "ENOENT") return res.status(404).json({ error: "PDF not found" });
        console.error("sendFile error:", err);
        return res.status(500).json({ error: "Failed to load PDF" });
      }
    });
  } catch (e) {
    return res.status(404).json({ error: "PDF not found" });
  }
});

app.delete("/api/library/pdf/:paperId", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const paperId = String(req.params.paperId || "");
  const { rows } = await pool.query(
    `SELECT id, storage_path FROM library_pdfs WHERE orcid=$1 AND paper_id=$2`,
    [sess.orcid, paperId]
  );
  if (!rows.length) return res.status(404).json({ error: "PDF not found" });
  try {
    const safePath = ensureSafePath(pdfUploadDir, rows[0].storage_path);
    await fsp.unlink(safePath).catch(e => { if (e.code !== "ENOENT") throw e; });
    await pool.query(`DELETE FROM library_pdfs WHERE id=$1`, [rows[0].id]);
    await pool.query(
      `UPDATE library_items SET local_pdf_path=NULL WHERE orcid=$1 AND id=$2`,
      [sess.orcid, paperId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/library/pdf failed:", e);
    res.status(500).json({ error: "Failed to delete PDF" });
  }
});

/* ---------------------------
   PDF import -> new library item
----------------------------*/
app.post("/api/library/import-pdf", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    const { files } = await parseMultipartForm(req, 50 * 1024 * 1024);
    const file = (files || []).find(f => f.field === "file") || files?.[0];
    if (!file?.buffer?.length) return res.status(400).json({ error: "file required" });

    const filename = file.filename || "import.pdf";
    const extOk = filename.toLowerCase().endsWith(".pdf");
    const mimeOk = String(file.contentType || "").toLowerCase() === "application/pdf";
    if (!extOk && !mimeOk) return res.status(400).json({ error: "Only PDF files allowed" });
    if (file.size > 50 * 1024 * 1024) return res.status(400).json({ error: "File too large" });

    await fsp.mkdir(path.join(pdfUploadDir, sess.orcid), { recursive: true });
    const fname = `import_${Date.now()}.pdf`;
    const fullPath = path.join(pdfUploadDir, sess.orcid, fname);
    await fsp.writeFile(fullPath, file.buffer);
    const safePath = ensureSafePath(pdfUploadDir, fullPath);
    const urlPath = `/uploads/pdfs/${sess.orcid}/${fname}`;

    const sniff = file.buffer.slice(0, 8192).toString("latin1");
    const doiMatch = sniff.match(/10\.\d{4,9}\/[^\s"<>]+/);
    const doi = doiMatch ? normalizeDoi(doiMatch[0]) : "";

    let item = {
      id: doi ? `doi:${doi}` : `upload:${Date.now()}`,
      title: filename.replace(/\.pdf$/i, "") || "Imported PDF",
      openalex_id: null,
      openalex_url: null,
      doi: doi || null,
      year: null,
      venue: null,
      authors: null,
      cited_by: null,
      abstract: null,
      pdf_url: null,
      meta_fresh: false
    };

    if (doi) {
      try {
        const work = await fetchJSONTimeout(`${OPENALEX}/works/doi:${encodeURIComponent(doi)}`, {}, 10000);
        const authors = (work.authorships || []).map(a => a?.author?.display_name).filter(Boolean).join(", ");
        const venue = work?.host_venue?.display_name || work?.primary_location?.source?.display_name || null;
        item = {
          ...item,
          id: `doi:${doi}`,
          title: work.display_name || work.title || item.title,
          openalex_id: normalizeOpenAlexId(work.id || ""),
          openalex_url: work.id || null,
          year: work.publication_year ?? null,
          venue,
          authors: authors || null,
          cited_by: work.cited_by_count ?? 0,
          abstract: work.abstract_inverted_index ? invertAbstract(work.abstract_inverted_index) : null,
          meta_fresh: true
        };
      } catch (e) {
        // keep fallback item
      }
    }

    await pool.query(
      `INSERT INTO library_items (
        orcid, id, title, openalex_id, openalex_url, doi, year, venue, authors, cited_by, abstract, pdf_url, meta_fresh
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (orcid, id) DO UPDATE SET
         title=EXCLUDED.title,
         openalex_id=EXCLUDED.openalex_id,
         openalex_url=EXCLUDED.openalex_url,
         doi=EXCLUDED.doi,
         year=EXCLUDED.year,
         venue=EXCLUDED.venue,
         authors=EXCLUDED.authors,
         cited_by=EXCLUDED.cited_by,
         abstract=EXCLUDED.abstract,
         meta_fresh=EXCLUDED.meta_fresh`,
      [
        sess.orcid, item.id, item.title, item.openalex_id, item.openalex_url, item.doi,
        item.year, item.venue, item.authors, item.cited_by, item.abstract, item.pdf_url, item.meta_fresh
      ]
    );

    await pool.query(
      `INSERT INTO library_pdfs (orcid, paper_id, filename, storage_path, file_size, mime_type, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (orcid, paper_id) DO UPDATE SET
         filename=EXCLUDED.filename,
         storage_path=EXCLUDED.storage_path,
         file_size=EXCLUDED.file_size,
         mime_type=EXCLUDED.mime_type,
         source=EXCLUDED.source`,
      [sess.orcid, item.id, filename, safePath, file.size, file.contentType || "application/pdf", "import"]
    );
    await pool.query(
      `UPDATE library_items SET local_pdf_path=$1 WHERE orcid=$2 AND id=$3`,
      [urlPath, sess.orcid, item.id]
    );

    res.json({ item: { ...item, local_pdf_path: urlPath }, pdf_url: urlPath });
  } catch (e) {
    console.error("POST /api/library/import-pdf failed:", e);
    res.status(500).json({ error: "Failed to import PDF" });
  }
});

/* ---------------------------
   Zotero integrations
----------------------------*/
app.post("/api/integrations/zotero/connect", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { zotero_user_id, api_key } = req.body || {};
  if (!zotero_user_id || !api_key) return res.status(400).json({ error: "zotero_user_id and api_key required" });
  try {
    await zoteroFetch(`${ZOTERO_BASE}/users/${zotero_user_id}/items?limit=1`, api_key);
    await pool.query(
      `INSERT INTO zotero_connections (orcid, zotero_user_id, api_key)
       VALUES ($1,$2,$3)
       ON CONFLICT (orcid) DO UPDATE SET zotero_user_id=EXCLUDED.zotero_user_id, api_key=EXCLUDED.api_key`,
      [sess.orcid, String(zotero_user_id), String(api_key)]
    );
    res.json({ ok: true, zotero_user_id: String(zotero_user_id) });
  } catch (e) {
    res.status(400).json({ error: `Zotero validation failed: ${e.message}` });
  }
});

app.patch("/api/integrations/zotero/settings", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { sync_enabled, sync_pdfs, conflict_resolution } = req.body || {};
  const fields = [];
  const params = [];
  if (sync_enabled !== undefined) { fields.push(`sync_enabled=$${fields.length + 1}`); params.push(!!sync_enabled); }
  if (sync_pdfs !== undefined) { fields.push(`sync_pdfs=$${fields.length + 1}`); params.push(!!sync_pdfs); }
  if (conflict_resolution !== undefined) { fields.push(`conflict_resolution=$${fields.length + 1}`); params.push(String(conflict_resolution)); }
  if (!fields.length) return res.status(400).json({ error: "No settings provided" });
  params.push(sess.orcid);
  await pool.query(
    `UPDATE zotero_connections SET ${fields.join(", ")} WHERE orcid=$${fields.length + 1}`,
    params
  );
  res.json({ ok: true });
});

app.delete("/api/integrations/zotero/disconnect", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  await pool.query(`DELETE FROM zotero_connections WHERE orcid=$1`, [sess.orcid]);
  res.status(204).end();
});

app.get("/api/integrations/zotero/status", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { rows } = await pool.query(
    `SELECT zotero_user_id, last_sync_version, last_synced_at, sync_enabled, sync_pdfs, conflict_resolution
     FROM zotero_connections WHERE orcid=$1`,
    [sess.orcid]
  );
  if (!rows.length) return res.json({ connected: false });
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM library_items WHERE orcid=$1 AND zotero_key IS NOT NULL`,
    [sess.orcid]
  );
  res.json({
    connected: true,
    zotero_user_id: rows[0].zotero_user_id,
    last_sync_version: rows[0].last_sync_version,
    last_synced_at: rows[0].last_synced_at,
    sync_enabled: rows[0].sync_enabled,
    sync_pdfs: rows[0].sync_pdfs,
    conflict_resolution: rows[0].conflict_resolution,
    item_count: countRes.rows[0]?.count ?? 0
  });
});

app.post("/api/integrations/zotero/sync", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    const result = await syncZoteroForUser(sess.orcid);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Sync failed", details: String(e.message || e) });
  }
});

app.get("/api/integrations/zotero/sync/status", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { rows } = await pool.query(
    `SELECT started_at, finished_at, items_synced, errors
     FROM zotero_sync_log WHERE orcid=$1
     ORDER BY started_at DESC LIMIT 1`,
    [sess.orcid]
  );
  res.json(rows[0] || null);
});

/* ---------------------------
   Trash endpoints (items)
----------------------------*/
app.post("/api/trash/items", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const id = String(req.body?.id || "");
  if (!id) return res.status(400).json({ error: "id required" });
  await pool.query(`UPDATE library_items SET deleted_at = NOW() WHERE orcid = $1 AND id = $2`, [sess.orcid, id]);
  res.json({ ok: true });
});

app.post("/api/trash/collections", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const id = Number(req.body?.id || 0);
  if (!id) return res.status(400).json({ error: "id required" });
  await pool.query(
    `
    WITH RECURSIVE sub AS (
      SELECT id FROM collections WHERE orcid = $1 AND id = $2
      UNION ALL
      SELECT c.id FROM collections c
      INNER JOIN sub s ON c.parent_id = s.id
      WHERE c.orcid = $1
    )
    UPDATE collections SET deleted_at = NOW()
    WHERE orcid = $1 AND id IN (SELECT id FROM sub)
    `,
    [sess.orcid, id]
  );
  res.json({ ok: true });
});

app.post("/api/trash/restore", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const scope = req.body?.scope || null;
  const type = req.body?.type || null;
  const id = String(req.body?.id || "");
  if (scope === "all") {
    await pool.query(`UPDATE library_items SET deleted_at = NULL WHERE orcid = $1`, [sess.orcid]);
    await pool.query(`UPDATE collections SET deleted_at = NULL WHERE orcid = $1`, [sess.orcid]);
    return res.json({ ok: true });
  }
  if (type === "item" && id) {
    await pool.query(`UPDATE library_items SET deleted_at = NULL WHERE orcid = $1 AND id = $2`, [sess.orcid, id]);
    return res.json({ ok: true });
  }
  if (type === "collection" && id) {
    await pool.query(
      `
      WITH RECURSIVE sub AS (
        SELECT id FROM collections WHERE orcid = $1 AND id = $2
        UNION ALL
        SELECT c.id FROM collections c
        INNER JOIN sub s ON c.parent_id = s.id
        WHERE c.orcid = $1
      )
      UPDATE collections SET deleted_at = NULL
      WHERE orcid = $1 AND id IN (SELECT id FROM sub)
      `,
      [sess.orcid, Number(id)]
    );
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: "invalid restore request" });
});

app.post("/api/trash/empty", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  await pool.query(`DELETE FROM library_items WHERE orcid = $1 AND deleted_at IS NOT NULL`, [sess.orcid]);
  await pool.query(`DELETE FROM collections WHERE orcid = $1 AND deleted_at IS NOT NULL`, [sess.orcid]);
  res.json({ ok: true });
});

app.delete("/api/trash/items", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const id = String(req.body?.id || "");
  if (!id) return res.status(400).json({ error: "id required" });
  await pool.query(`DELETE FROM library_items WHERE orcid = $1 AND id = $2`, [sess.orcid, id]);
  res.json({ ok: true });
});

// Publisher landing links (code/data hosts)
app.get("/api/paper/links", async (req, res) => {
  const { url, doi } = req.query || {};
  const target = url || (doi ? `https://doi.org/${doi}` : null);
  if (!target) return res.status(400).json({ error: "url or doi required" });
  try {
    const r = await fetch(target, { headers: { "User-Agent":"ScienceEcosystemBot/1.0 (+https://scienceecosystem.org)" } });
    if (!r.ok) return res.status(400).json({ error: `Fetch failed ${r.status}` });
    const html = await r.text();
    const links = extractLinks(html);
    const unique = Array.from(new Set(links));
    res.json(unique.map(h=>({ url: h, provenance:"Publisher page" })));
  } catch (e) {
    res.status(500).json({ error: String(e.message||e) });
  }
});

// Server-side DOI backlinks (avoids browser CORS)
async function fetchJSONSafe(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
function classifyROKind(str) {
  const s = String(str || "").toLowerCase();
  if (s.includes("software") || s.includes("code")) return "Software";
  if (s.includes("dataset") || s.includes("data")) return "Dataset";
  return "Other";
}

app.get("/api/paper/artifacts", async (req, res) => {
  const doiRaw = (req.query?.doi || "").trim();
  const titleRaw = (req.query?.title || "").trim();
  const authorsRaw = (req.query?.authors || "").trim();
  const openAlexId = (req.query?.id || "").trim();
  if (!doiRaw && !titleRaw) return res.status(400).json({ error: "doi or title required" });

  try {
    const results = await resolveArtifacts({
      doi: doiRaw,
      title: titleRaw,
      authors: authorsRaw,
      openAlexId,
      minConfidence: 25
    });
    res.set("Cache-Control", "public, max-age=3600");
    return res.json(results);
  } catch (err) {
    console.error("GET /api/paper/artifacts failed:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// Aggressive Open Access resolver
app.get("/api/paper/oa", async (req, res) => {
  const doiParam = normalizeDoi(req.query?.doi || "");
  const openalexIdParam = normalizeOpenAlexId(req.query?.openalex_id || "");
  if (!doiParam && !openalexIdParam) {
    return res.status(400).json({ error: "doi or openalex_id required" });
  }

  const cacheKey = (doiParam || (openalexIdParam ? `openalex:${openalexIdParam.toLowerCase()}` : "")).toLowerCase();
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const sources = [];
  function pushSource(entry) {
    if (!entry) return;
    const pdfUrl = entry.pdf_url || "";
    const landingUrl = entry.landing_url || "";
    if (!pdfUrl && !landingUrl) return;
    sources.push({
      source: entry.source || "Unknown",
      pdf_url: pdfUrl || null,
      landing_url: landingUrl || null,
      license: entry.license || null
    });
  }

  let work = null;
  try {
    if (openalexIdParam) {
      work = await fetchJSONTimeout(`${OPENALEX}/works/${encodeURIComponent(openalexIdParam)}`);
    } else if (doiParam) {
      const doiUrl = `https://doi.org/${encodeURIComponent(doiParam)}`;
      work = await fetchJSONTimeout(`${OPENALEX}/works/${encodeURIComponent(doiUrl)}`);
    }
  } catch (_) {}

  const doiFromWork = normalizeDoi(work?.doi || work?.ids?.doi || "");
  const doi = doiParam || doiFromWork;

  // 1) OpenAlex
  try {
    const best = work?.best_oa_location || null;
    const primary = work?.primary_location || null;
    const pdf = (best && (best.url_for_pdf || best.pdf_url)) || (primary && primary.pdf_url) || null;
    const landing = (best && (best.url || best.landing_page_url)) || (primary && (primary.landing_page_url || primary.url)) || work?.open_access?.oa_url || null;
    if (pdf || landing) {
      pushSource({
        source: "OpenAlex",
        pdf_url: pdf,
        landing_url: landing,
        license: best?.license || work?.open_access?.oa_status || null
      });
    }
  } catch (_) {}

  // 2) Unpaywall
  if (doi) {
    try {
      const up = await fetchJSONTimeout(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent("info@scienceecosystem.org")}`);
      const best = up?.best_oa_location || null;
      const pdf = best?.url_for_pdf || null;
      const landing = best?.url || null;
      if (pdf || landing) {
        pushSource({ source: "Unpaywall", pdf_url: pdf, landing_url: landing, license: best?.license || null });
      }
    } catch (_) {}
  }

  // 3-9) Parallel sources
  const coreKey = process.env.CORE_API_KEY || "";
  const pmcid = work?.ids?.pmcid || "";
  const arxivId = work?.ids?.arxiv_id || "";
  const preprintNames = [
    "arxiv","biorxiv","medrxiv","chemrxiv","osf preprints","psyarxiv","engrXiv".toLowerCase(),
    "eartharxiv","socarxiv","lawarxiv","paleorxiv","agrixiv","research square","preprints.org","ssrn"
  ];

  const tasks = [
    // CORE
    async () => {
      if (!doi) return null;
      const headers = coreKey ? { "X-API-Key": coreKey } : {};
      const core = await fetchJSONTimeout(`https://api.core.ac.uk/v3/search/works?q=doi:${encodeURIComponent(doi)}&limit=1`, { headers });
      const hit = Array.isArray(core?.results) ? core.results[0] : null;
      const pdf = hit?.downloadUrl || hit?.fullTextIdentifier || null;
      if (!pdf) return null;
      return { source: "CORE", pdf_url: pdf, landing_url: hit?.fullTextIdentifier || hit?.sourceFulltextUrls?.[0] || null };
    },
    // Europe PMC
    async () => {
      if (!doi) return null;
      const epmc = await fetchJSONTimeout(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:${encodeURIComponent(doi)}&format=json&resultType=core`);
      const results = Array.isArray(epmc?.resultList?.result) ? epmc.resultList.result : [];
      for (const r of results) {
        const list = Array.isArray(r?.fullTextUrlList?.fullTextUrl) ? r.fullTextUrlList.fullTextUrl : [];
        const oa = list.find(x => String(x?.availability || "").toLowerCase() === "open access");
        if (oa?.url) return { source: "Europe PMC", pdf_url: oa.url, landing_url: r?.pmcHtmlUrl || r?.fullTextUrl || null };
      }
      return null;
    },
    // Semantic Scholar
    async () => {
      if (!doi) return null;
      const ss = await fetchJSONTimeout(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf`);
      const pdf = ss?.openAccessPdf?.url || null;
      if (!pdf) return null;
      return { source: "Semantic Scholar", pdf_url: pdf, landing_url: ss?.openAccessPdf?.url || null };
    },
    // BASE
    async () => {
      if (!doi) return null;
      const base = await fetchJSONTimeout(`https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?func=PerformSearch&query=dcdoi:${encodeURIComponent(doi)}&format=json`);
      const doc = base?.response?.docs?.[0] || null;
      const link = Array.isArray(doc?.dclink) ? doc.dclink[0] : doc?.dclink || null;
      if (!link) return null;
      return { source: "BASE", pdf_url: link, landing_url: link };
    },
    // PubMed Central
    async () => {
      if (!pmcid) return null;
      const pmcId = String(pmcid).replace(/^PMC/i, "PMC");
      const pdf = `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(pmcId)}/pdf/`;
      const landing = `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(pmcId)}/`;
      return { source: "PubMed Central", pdf_url: pdf, landing_url: landing };
    },
    // arXiv
    async () => {
      if (!arxivId) return null;
      const id = String(arxivId).replace(/^arxiv:/i, "");
      return {
        source: "arXiv",
        pdf_url: `https://arxiv.org/pdf/${encodeURIComponent(id)}`,
        landing_url: `https://arxiv.org/abs/${encodeURIComponent(id)}`
      };
    },
    // Preprint servers from OpenAlex locations
    async () => {
      const locs = Array.isArray(work?.locations) ? work.locations : [];
      if (!locs.length) return null;
      const out = [];
      for (const loc of locs) {
        const name = String(loc?.source?.display_name || "").toLowerCase();
        if (!name) continue;
        if (!preprintNames.some(p => name.includes(p))) continue;
        const pdf = loc?.pdf_url || loc?.url_for_pdf || null;
        const landing = loc?.landing_page_url || loc?.url || null;
        if (pdf || landing) {
          out.push({
            source: `Preprint: ${loc?.source?.display_name || "Preprint server"}`,
            pdf_url: pdf,
            landing_url: landing,
            license: loc?.license || null
          });
        }
      }
      return out.length ? out : null;
    }
  ];

  const settled = await Promise.allSettled(tasks.map(fn => fn().catch(() => null)));
  settled.forEach((res, idx) => {
    if (res.status !== "fulfilled") return;
    const val = res.value;
    if (!val) return;
    if (Array.isArray(val)) {
      val.forEach(v => pushSource(v));
    } else {
      pushSource(val);
    }
  });

  // Deduplicate by URL
  const seen = new Set();
  const unique = [];
  sources.forEach(s => {
    const key = (s.pdf_url || s.landing_url || "").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(s);
  });

  const best = unique.find(s => s.pdf_url) || unique.find(s => s.landing_url) || null;
  const payload = {
    best_pdf_url: best?.pdf_url || null,
    best_landing_url: best?.landing_url || null,
    sources: unique,
    is_oa: !!(best && best.pdf_url)
  };

  if (doi) cacheSet(doi.toLowerCase(), payload);
  if (cacheKey && (!doi || cacheKey !== doi.toLowerCase())) cacheSet(cacheKey, payload);
  res.json(payload);
});

/* ---------------------------
   Identity + alerts + activity
----------------------------*/
app.get("/api/identity/status", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    const row = await getIdentity(sess.orcid);
    res.json({
      orcid: true,
      github: !!row.github,
      scholar: !!row.scholar,
      osf: !!row.osf,
      zenodo: !!row.zenodo,
      last_sync: row.last_sync ? new Date(row.last_sync).toISOString() : null
    });
  } catch (e) {
    console.error("GET /api/identity/status failed:", e);
    res.status(500).json({ error: "Failed to load identity status" });
  }
});

app.post("/api/identity/sync", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    await markIdentitySync(sess.orcid);
    res.json({ ok: true, last_sync: new Date().toISOString() });
  } catch (e) {
    console.error("POST /api/identity/sync failed:", e);
    res.status(500).json({ error: "Failed to sync" });
  }
});

["github","scholar","osf","zenodo"].forEach(provider => {
  app.post(`/auth/${provider}/disconnect`, async (req, res) => {
    const sess = await requireAuth(req, res); if (!sess) return;
    try {
      await setIdentityField(sess.orcid, provider, false);
      res.status(204).end();
    } catch (e) {
      console.error(`POST /auth/${provider}/disconnect failed:`, e);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });
});

app.get("/api/alerts", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.due_at, t.project_id
       FROM project_tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE p.orcid=$1
         AND t.due_at IS NOT NULL
         AND t.status NOT IN ('done','closed','completed')
       ORDER BY t.due_at ASC
       LIMIT 30`,
      [sess.orcid]
    );
    const alerts = rows.map(r => ({
      id: r.id,
      type: "task",
      title: r.title,
      due_at: r.due_at,
      link: r.project_id ? `/project.html?id=${r.project_id}#tasks` : null
    }));
    res.json(alerts);
  } catch (e) {
    console.error("GET /api/alerts failed:", e);
    res.status(500).json({ error: "Failed to load alerts" });
  }
});

app.get("/api/activity", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const scope = req.query?.scope || "all";
  const projectId = req.query?.project_id ? Number(req.query.project_id) : null;
  try {
    const params = [sess.orcid];
    let where = "orcid = $1";
    if (scope && scope !== "all") { params.push(scope); where += ` AND scope = $${params.length}`; }
    if (projectId) { params.push(projectId); where += ` AND project_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT id, verb, object, link, created_at
       FROM activity_log
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 40`,
      params
    );
    res.json(rows.map(r => ({
      id: r.id,
      verb: r.verb,
      object: r.object,
      link: r.link,
      when: r.created_at
    })));
  } catch (e) {
    console.error("GET /api/activity failed:", e);
    res.status(500).json({ error: "Failed to load activity" });
  }
});

// Followed authors (requires login)
app.get("/api/follows", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    res.json(await followsList(sess.orcid));
  } catch (e) {
    console.error("GET /api/follows failed:", e);
    res.status(500).json({ error: "Failed to load follows" });
  }
});

app.post("/api/follows", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { author_id, name } = req.body || {};
  if (!author_id) return res.status(400).json({ error: "author_id required" });
  try {
    await followAdd(sess.orcid, String(author_id), String(name || author_id));
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/follows failed:", e);
    res.status(500).json({ error: "Failed to save follow" });
  }
});

app.delete("/api/follows/:authorId", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  try {
    await followDel(sess.orcid, String(req.params.authorId));
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/follows/:authorId failed:", e);
    res.status(500).json({ error: "Failed to remove follow" });
  }
});

/* ---------------------------
   NEW: Collections API
----------------------------*/
app.get("/api/collections", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { rows } = await pool.query(
    `SELECT id, name, parent_id, deleted_at FROM collections WHERE orcid=$1 ORDER BY name`,
    [sess.orcid]
  );
  res.json(rows);
});

app.post("/api/collections", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { name, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  if (parent_id) {
    const p = await pool.query(`SELECT id FROM collections WHERE orcid=$1 AND id=$2`, [sess.orcid, Number(parent_id)]);
    if (!p.rowCount) return res.status(400).json({ error: "parent not found" });
  }
  const out = await pool.query(
    `INSERT INTO collections (orcid, name, parent_id) VALUES ($1,$2,$3)
     RETURNING id, name, parent_id`,
    [sess.orcid, String(name), parent_id ? Number(parent_id) : null]
  );
  res.status(201).json(out.rows[0]);
});

app.patch("/api/collections/:id", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  const out = await pool.query(
    `UPDATE collections SET name=$1 WHERE orcid=$2 AND id=$3
     RETURNING id, name, parent_id`,
    [String(name), sess.orcid, Number(req.params.id)]
  );
  if (!out.rowCount) return res.status(404).json({ error: "not found" });
  res.json(out.rows[0]);
});

app.delete("/api/collections/:id", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  await pool.query(`DELETE FROM collections WHERE orcid=$1 AND id=$2`, [sess.orcid, Number(req.params.id)]);
  res.status(204).end();
});

/* ---------------------------
   NEW: Collection Items API
----------------------------*/
app.post("/api/collections/:id/items", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const cid = Number(req.params.id);
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "paper id required" });

  const col = await pool.query(`SELECT id FROM collections WHERE orcid=$1 AND id=$2`, [sess.orcid, cid]);
  if (!col.rowCount) return res.status(404).json({ error: "collection not found" });

  await pool.query(
    `INSERT INTO collection_items (orcid, collection_id, paper_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [sess.orcid, cid, String(id)]
  );
  res.status(201).json({ ok: true });
});

app.delete("/api/collections/:id/items/:paperId", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  await pool.query(
    `DELETE FROM collection_items WHERE orcid=$1 AND collection_id=$2 AND paper_id=$3`,
    [sess.orcid, Number(req.params.id), String(req.params.paperId)]
  );
  res.status(204).end();
});

/* ---------------------------
   NEW: Library full + membership
----------------------------*/
// --- replace the whole /api/library/full handler with this ---
app.get("/api/library/full", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;

  try {
    // Single round-trip: items + aggregated collection_ids
    const { rows } = await pool.query(
      `
      SELECT
        li.id,
        li.title,
        li.openalex_id,
        li.openalex_url,
        li.doi,
        li.year,
        li.venue,
        li.authors,
        li.cited_by,
        li.abstract,
        li.pdf_url,
        li.local_pdf_path,
        li.zotero_key,
        li.zotero_version,
        li.last_synced_at,
        li.tags,
        li.notes_raw,
        li.collection_ids_zotero,
        li.deleted_at,
        COALESCE(li.meta_fresh, FALSE) AS meta_fresh,
        COALESCE(ARRAY_AGG(ci.collection_id) FILTER (WHERE ci.collection_id IS NOT NULL), '{}') AS collection_ids
      FROM library_items li
      LEFT JOIN collection_items ci
        ON ci.orcid = li.orcid AND ci.paper_id = li.id
      WHERE li.orcid = $1
      GROUP BY
        li.id, li.title, li.openalex_id, li.openalex_url, li.doi, li.year,
        li.venue, li.authors, li.cited_by, li.abstract, li.pdf_url, li.local_pdf_path, li.zotero_key,
        li.zotero_version, li.last_synced_at, li.tags, li.notes_raw, li.collection_ids_zotero,
        li.deleted_at, li.meta_fresh
      ORDER BY li.title;
      `,
      [sess.orcid]
    );

    res.json(rows);
  } catch (e) {
    console.error("GET /api/library/full failed:", e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});


/* ---------------------------
   NEW: Refresh one item metadata
----------------------------*/
app.post("/api/items/:id/refresh", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const id = String(req.params.id);
  try {
    const idTail = id.replace(/^https?:\/\/openalex\.org\//i, "");
    const meta = await hydrateWorkMeta(idTail);

    const upd = await pool.query(
      `UPDATE library_items SET
        title=$1, openalex_id=$2, openalex_url=$3, doi=$4, year=$5, venue=$6,
        authors=$7, cited_by=$8, abstract=$9, pdf_url=$10, meta_fresh=TRUE
       WHERE orcid=$11 AND id=$12
       RETURNING id, title, openalex_id, openalex_url, doi, year, venue, authors, cited_by, abstract, pdf_url, meta_fresh`,
      [
        meta.title, meta.openalex_id, meta.openalex_url, meta.doi, meta.year, meta.venue,
        meta.authors, meta.cited_by, meta.abstract, meta.pdf_url,
        sess.orcid, id
      ]
    );
    if (!upd.rowCount) return res.status(404).json({ error: "Library item not found" });
    res.json({ item: upd.rows[0] });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* ---------------------------
   NEW: Notes API
----------------------------*/
app.get("/api/notes", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { paper_id } = req.query;
  if (!paper_id) return res.status(400).json({ error: "paper_id required" });
  const { rows } = await pool.query(
    `SELECT id, text, created_at FROM notes
     WHERE orcid=$1 AND paper_id=$2
     ORDER BY created_at DESC`,
    [sess.orcid, String(paper_id)]
  );
  res.json(rows);
});

app.post("/api/notes", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const { paper_id, text } = req.body || {};
  if (!paper_id || !text) return res.status(400).json({ error: "paper_id and text required" });
  const out = await pool.query(
    `INSERT INTO notes (orcid, paper_id, text)
     VALUES ($1, $2, $3)
     RETURNING id, text, created_at`,
    [sess.orcid, String(paper_id), String(text)]
  );
  res.status(201).json(out.rows[0]);
});

app.delete("/api/notes/:id", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  await pool.query(`DELETE FROM notes WHERE orcid=$1 AND id=$2`, [sess.orcid, Number(req.params.id)]);
  res.status(204).end();
});

/* ---------------------------
   Projects API
----------------------------*/
app.get("/api/projects", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const q = (req.query?.q || "").trim();
  const stage = (req.query?.stage || "").trim();
  const sort = (req.query?.sort || "recent").trim();
  const limit = Math.min(Math.max(Number(req.query?.limit) || 20, 1), 100);

  try {
    const params = [sess.orcid];
    let where = "p.orcid = $1";
    if (q) { params.push(`%${q}%`); where += ` AND (p.title ILIKE $${params.length} OR p.summary ILIKE $${params.length})`; }
    if (stage) { params.push(stage); where += ` AND p.stage = $${params.length}`; }

    let orderBy = "p.last_active DESC";
    if (sort === "title") orderBy = "p.title ASC";
    if (sort === "tasks") orderBy = "open_tasks DESC, p.last_active DESC";

    const sql = `
      SELECT p.id, p.title, p.summary, p.stage, p.last_active,
             COALESCE(t.open_tasks, 0) AS open_tasks
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) FILTER (WHERE status NOT IN ('done','closed','completed')) AS open_tasks
        FROM project_tasks
        GROUP BY project_id
      ) t ON t.project_id = p.id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limit};
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error("GET /api/projects failed:", e);
    res.status(500).json({ error: "Failed to load projects" });
  }
});

app.post("/api/projects", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const body = req.body || {};
  const title = (body.title || "").trim();
  const summary = (body.summary || "").trim() || null;
  const stage = (body.stage || "in-progress").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  try {
    const out = await pool.query(
      `INSERT INTO projects (orcid, title, summary, stage)
       VALUES ($1,$2,$3,$4)
       RETURNING id, title, summary, stage, last_active`,
      [sess.orcid, title, summary, stage]
    );
    await logActivity(sess.orcid, { scope: "project", project_id: out.rows[0].id, verb: "Created project", object: title, link: `/project.html?id=${out.rows[0].id}` });
    res.status(201).json({ ...out.rows[0], open_tasks: 0 });
  } catch (e) {
    console.error("POST /api/projects failed:", e);
    res.status(500).json({ error: "Failed to create project" });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const open_tasks = await countOpenTasks(proj.id);
  res.json({ ...proj, open_tasks });
});

// Tasks
app.get("/api/projects/:id/tasks", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const { rows } = await pool.query(
    `SELECT id, title, status, assignee, due_at, created_at
     FROM project_tasks
     WHERE project_id=$1
     ORDER BY created_at DESC`,
    [proj.id]
  );
  res.json(rows);
});

app.post("/api/projects/:id/tasks", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const body = req.body || {};
  const title = (body.title || "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  const status = (body.status || "open").trim();
  const assignee = (body.assignee || "").trim() || null;
  const due_at = body.due_at ? new Date(body.due_at) : null;
  try {
    const out = await pool.query(
      `INSERT INTO project_tasks (project_id, orcid, title, status, assignee, due_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, title, status, assignee, due_at, created_at`,
      [proj.id, sess.orcid, title, status, assignee, due_at]
    );
    await touchProject(proj.id);
    await logActivity(sess.orcid, { scope: "project", project_id: proj.id, verb: "Added task", object: title, link: `/project.html?id=${proj.id}#tasks` });
    res.status(201).json(out.rows[0]);
  } catch (e) {
    console.error("POST /api/projects/:id/tasks failed:", e);
    res.status(500).json({ error: "Failed to create task" });
  }
});

app.patch("/api/projects/:id/tasks/:taskId", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const body = req.body || {};
  const fields = [];
  const params = [];
  if (body.status) { fields.push(`status=$${fields.length + 1}`); params.push(body.status); }
  if (body.assignee !== undefined) { fields.push(`assignee=$${fields.length + 1}`); params.push(body.assignee || null); }
  if (body.due_at !== undefined) { fields.push(`due_at=$${fields.length + 1}`); params.push(body.due_at ? new Date(body.due_at) : null); }
  if (!fields.length) return res.status(400).json({ error: "No changes" });
  params.push(proj.id, Number(req.params.taskId));
  try {
    const out = await pool.query(
      `UPDATE project_tasks SET ${fields.join(", ")}, updated_at = now()
       WHERE project_id=$${fields.length + 1} AND id=$${fields.length + 2}
       RETURNING id, title, status, assignee, due_at, created_at`,
      params
    );
    if (!out.rowCount) return res.status(404).json({ error: "Task not found" });
    await touchProject(proj.id);
    await logActivity(sess.orcid, { scope: "project", project_id: proj.id, verb: "Updated task", object: out.rows[0].title, link: `/project.html?id=${proj.id}#tasks` });
    res.json(out.rows[0]);
  } catch (e) {
    console.error("PATCH /api/projects/:id/tasks failed:", e);
    res.status(500).json({ error: "Failed to update task" });
  }
});

app.delete("/api/projects/:id/tasks/:taskId", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const del = await pool.query(
    `DELETE FROM project_tasks WHERE project_id=$1 AND id=$2 RETURNING title`,
    [proj.id, Number(req.params.taskId)]
  );
  if (!del.rowCount) return res.status(404).json({ error: "Task not found" });
  await touchProject(proj.id);
  await logActivity(sess.orcid, { scope: "project", project_id: proj.id, verb: "Deleted task", object: del.rows[0].title, link: `/project.html?id=${proj.id}#tasks` });
  res.status(204).end();
});

// Team
app.get("/api/projects/:id/team", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const { rows } = await pool.query(
    `SELECT id, email, role, invited_at
     FROM project_team
     WHERE project_id=$1
     ORDER BY invited_at DESC`,
    [proj.id]
  );
  const owner = await getUser(sess.orcid);
  const ownerEntry = {
    id: "owner",
    name: owner?.name || sess.orcid,
    email: owner?.links?.[0] || "",
    role: "owner"
  };
  res.json([ownerEntry, ...rows.map(r => ({ id: r.id, email: r.email, role: r.role, invited_at: r.invited_at }))]);
});

app.post("/api/projects/:id/team", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const email = (req.body?.email || "").trim();
  const role = (req.body?.role || "collaborator").trim();
  if (!email) return res.status(400).json({ error: "email required" });
  await pool.query(
    `INSERT INTO project_team (project_id, orcid, email, role)
     VALUES ($1,$2,$3,$4)`,
    [proj.id, sess.orcid, email, role]
  );
  await logActivity(sess.orcid, { scope: "project", project_id: proj.id, verb: "Invited teammate", object: email, link: `/project.html?id=${proj.id}` });
  res.status(201).json({ ok: true });
});

// Project → materials
app.get("/api/projects/:id/materials", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const proj = await ownedProject(sess.orcid, req.params.id);
  if (!proj) return res.status(404).json({ error: "Project not found" });
  const { rows } = await pool.query(
    `SELECT id, title, type, status, updated_at
     FROM materials
     WHERE project_id=$1 AND orcid=$2
     ORDER BY updated_at DESC`,
    [proj.id, sess.orcid]
  );
  res.json(rows.map(r => ({ ...r, link: `/material.html?id=${r.id}` })));
});

/* ---------------------------
   Materials API
----------------------------*/
app.get("/api/materials", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const q = (req.query?.q || "").trim().toLowerCase();
  const type = (req.query?.type || "").trim();
  const status = (req.query?.status || "").trim();
  const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
  try {
    const params = [sess.orcid];
    let where = "orcid = $1";
    if (q) { params.push(`%${q}%`); where += ` AND (LOWER(title) LIKE $${params.length} OR LOWER(type) LIKE $${params.length})`; }
    if (type) { params.push(type); where += ` AND type = $${params.length}`; }
    if (status) { params.push(status); where += ` AND status = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT id, title, type, status, updated_at
       FROM materials
       WHERE ${where}
       ORDER BY updated_at DESC
       LIMIT ${limit}`,
      params
    );
    res.json(rows.map(r => ({ ...r, link: `/material.html?id=${r.id}` })));
  } catch (e) {
    console.error("GET /api/materials failed:", e);
    res.status(500).json({ error: "Failed to load materials" });
  }
});

app.get("/api/materials/:id", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const mat = await ownedMaterial(sess.orcid, req.params.id);
  if (!mat) return res.status(404).json({ error: "Material not found" });
  const files = await pool.query(
    `SELECT id, name, url, size FROM material_files WHERE material_id=$1`,
    [mat.id]
  );
  let project = null;
  if (mat.project_id) {
    const p = await ownedProject(sess.orcid, mat.project_id);
    if (p) project = { id: p.id, title: p.title };
  }
  res.json({ ...mat, files: files.rows, project });
});

app.post("/api/materials", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  let fields = {}, files = [];
  try {
    const ctype = req.headers["content-type"] || "";
    if (ctype.startsWith("multipart/form-data")) {
      ({ fields, files } = await parseMultipartForm(req));
    } else {
      fields = req.body || {};
    }
    const title = (fields.title || "").trim();
    if (!title) return res.status(400).json({ error: "title required" });
    const projectId = fields.project_id ? Number(fields.project_id) : null;
    if (projectId) {
      const p = await ownedProject(sess.orcid, projectId);
      if (!p) return res.status(400).json({ error: "project not found" });
    }
    const type = (fields.type || "material").trim();
    const status = (fields.status || "draft").trim();
    const description = (fields.description || "").trim() || null;

    const created = await pool.query(
      `INSERT INTO materials (orcid, project_id, title, type, status, description)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, project_id, title, type, status, description, updated_at`,
      [sess.orcid, projectId, title, type, status, description]
    );
    const materialId = created.rows[0].id;
    const savedFiles = [];
    for (const file of files || []) {
      const saved = await saveUploadedFile(file);
      if (!saved) continue;
      savedFiles.push(saved);
      await pool.query(
        `INSERT INTO material_files (material_id, name, url, size)
         VALUES ($1,$2,$3,$4)`,
        [materialId, saved.name, saved.url, saved.size]
      );
    }
    if (projectId) await touchProject(projectId);
    await logActivity(sess.orcid, { scope: "project", project_id: projectId, verb: "Uploaded material", object: title, link: `/material.html?id=${materialId}` });
    res.status(201).json({ ...created.rows[0], files: savedFiles, link: `/material.html?id=${materialId}` });
  } catch (e) {
    console.error("POST /api/materials failed:", e);
    res.status(500).json({ error: "Failed to create material" });
  }
});

app.patch("/api/materials/:id", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const mat = await ownedMaterial(sess.orcid, req.params.id);
  if (!mat) return res.status(404).json({ error: "Material not found" });
  const body = req.body || {};
  const fields = [];
  const params = [];
  if (body.title) { fields.push(`title=$${fields.length + 1}`); params.push(body.title); }
  if (body.status) { fields.push(`status=$${fields.length + 1}`); params.push(body.status); }
  if (body.type) { fields.push(`type=$${fields.length + 1}`); params.push(body.type); }
  if (body.description !== undefined) { fields.push(`description=$${fields.length + 1}`); params.push(body.description || null); }
  if (body.project_id !== undefined) {
    const projectId = body.project_id ? Number(body.project_id) : null;
    if (projectId) {
      const p = await ownedProject(sess.orcid, projectId);
      if (!p) return res.status(400).json({ error: "project not found" });
    }
    fields.push(`project_id=$${fields.length + 1}`); params.push(projectId);
  }
  if (!fields.length) return res.status(400).json({ error: "No changes" });
  params.push(mat.id, sess.orcid);
  try {
    const out = await pool.query(
      `UPDATE materials SET ${fields.join(", ")}, updated_at = now()
       WHERE id=$${fields.length + 1} AND orcid=$${fields.length + 2}
       RETURNING id, project_id, title, type, status, description, updated_at`,
      params
    );
    await logActivity(sess.orcid, { scope: "project", project_id: out.rows[0].project_id, verb: "Updated material", object: out.rows[0].title, link: `/material.html?id=${out.rows[0].id}` });
    if (out.rows[0].project_id) await touchProject(out.rows[0].project_id);
    res.json({ ...out.rows[0] });
  } catch (e) {
    console.error("PATCH /api/materials/:id failed:", e);
    res.status(500).json({ error: "Failed to update material" });
  }
});

app.delete("/api/materials/:id", async (req, res) => {
  const sess = await requireAuth(req, res); if (!sess) return;
  const mat = await ownedMaterial(sess.orcid, req.params.id);
  if (!mat) return res.status(404).json({ error: "Material not found" });
  const files = await pool.query(`SELECT url FROM material_files WHERE material_id=$1`, [mat.id]);
  await pool.query(`DELETE FROM materials WHERE id=$1 AND orcid=$2`, [mat.id, sess.orcid]);
  for (const f of files.rows) {
    if (!f.url) continue;
    const rel = f.url.startsWith("/") ? f.url : `/${f.url}`;
    const full = path.join(staticRoot, rel);
    try { await fsp.unlink(full); } catch (e) { if (e.code !== "ENOENT") console.error("Failed to delete file", full, e); }
  }
  await logActivity(sess.orcid, { scope: "project", project_id: mat.project_id, verb: "Deleted material", object: mat.title });
  if (mat.project_id) await touchProject(mat.project_id);
  res.status(204).end();
});

/* ---------------------------
   Claims/Merges (kept as-is)
----------------------------*/
app.get("/api/claims", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  res.json(await claimsList(sess.orcid));
});

app.post("/api/claims", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { author_id } = req.body || {};
  if (!author_id || !/^A\d+$/.test(String(author_id))) {
    return res.status(400).json({ error: "author_id must look like A123..." });
  }
  await claimAdd(sess.orcid, String(author_id));
  res.status(201).json({ ok: true });
});

app.delete("/api/claims/:author_id", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  await claimDel(sess.orcid, String(req.params.author_id));
  res.status(204).end();
});

app.post("/api/claims/merge", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { primary_author_id, merged_author_id } = req.body || {};
  if (!/^A\d+$/.test(String(primary_author_id)) || !/^A\d+$/.test(String(merged_author_id))) {
    return res.status(400).json({ error: "author ids must look like A123..." });
  }
  await mergeAdd(sess.orcid, String(primary_author_id), String(merged_author_id));
  res.status(201).json({ ok: true });
});

app.delete("/api/claims/merge", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { primary_author_id, merged_author_id } = req.query || {};
  if (!primary_author_id || !merged_author_id) return res.status(400).json({ error: "both ids required" });
  await mergeDel(sess.orcid, String(primary_author_id), String(merged_author_id));
  res.status(204).end();
});

/* ---------------------------
   Zotero background scheduler
----------------------------*/
const zoteroIntervalMs = Math.max(60 * 1000, Number(ZOTERO_SYNC_INTERVAL_MS) || 3600000);
const zoteroIntervalSeconds = Math.round(zoteroIntervalMs / 1000);
setInterval(async () => {
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      `SELECT orcid FROM zotero_connections
       WHERE sync_enabled = TRUE
       AND (last_synced_at IS NULL OR last_synced_at < now() - ($1 * interval '1 second'))`,
      [zoteroIntervalSeconds]
    );
    for (const row of rows) {
      await syncZoteroForUser(row.orcid).catch(e =>
        console.error(`Zotero sync failed for ${row.orcid}:`, e.message)
      );
    }
  } catch (e) {
    console.error("Zotero scheduler error:", e.message);
  }
}, zoteroIntervalMs);

/* ---------------------------
   SPA fallback
----------------------------*/
// Pretty institution path -> static file with query
app.get("/institution/:id", (req, res) => {
  const instPath = path.join(staticRoot, "institute.html");
  if (fs.existsSync(instPath)) {
    res.sendFile(instPath);
  } else {
    res.redirect(`/institute.html?id=${encodeURIComponent(req.params.id)}`);
  }
});
app.get("/institute/:id", (req, res) => {
  const instPath = path.join(staticRoot, "institute.html");
  if (fs.existsSync(instPath)) {
    res.sendFile(instPath);
  } else {
    res.redirect(`/institute.html?id=${encodeURIComponent(req.params.id)}`);
  }
});

app.get("*", (req, res, next) => {
  if (req.method === "GET" && req.accepts("html")) {
    return res.sendFile(path.join(staticRoot, "index.html"));
  }
  next();
});

app.use((err, req, res, next) => {
  console.error("\n=== UNHANDLED ERROR ===");
  console.error("Path:", req.path);
  console.error("Error:", err);
  console.error("Stack:", err.stack);
  console.error("======================\n");
  res.status(500).send("Internal server error - check console");
});

app.listen(PORT, () => {
  const host = NODE_ENV === "production" ? "https://scienceecosystem.org" : `http://localhost:${PORT}`;
  console.log(`ScienceEcosystem server (Postgres) running at ${host}`);
});
