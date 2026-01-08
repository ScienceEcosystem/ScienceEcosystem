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
const { Pool } = pkg;
const fsp = fs.promises;

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  PORT = 5173,
  SESSION_SECRET = "dev-secret",
  ORCID_BASE = "https://orcid.org",
  ORCID_API_BASE = "https://api.orcid.org/v3.0",
  ORCID_CLIENT_ID,
  ORCID_CLIENT_SECRET,
  ORCID_REDIRECT_URI,
  STATIC_DIR = "../",
  NODE_ENV = "development",
  COOKIE_DOMAIN,                // optional: ".scienceecosystem.org"
  DATABASE_URL                  // Neon: postgresql://... ?sslmode=require
} = process.env;

if (!ORCID_CLIENT_ID || !ORCID_CLIENT_SECRET || !ORCID_REDIRECT_URI) {
  console.error("Missing ORCID env vars in .env");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var (Neon Postgres)");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

/* ---------------------------------
   Postgres (Neon) connection + DDL
----------------------------------*/
const pool = new Pool({ connectionString: DATABASE_URL });

async function pgInit() {
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
}
await pgInit();

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
  const { rows } = await pool.query(`SELECT id, title FROM library_items WHERE orcid = $1 ORDER BY title`, [orcid]);
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

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
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

/* ---------------------------
   Health + static
----------------------------*/
app.get("/health", (_req, res) => res.type("text").send("ok"));

const staticRoot = path.resolve(__dirname, STATIC_DIR);
const uploadDir = path.join(staticRoot, "uploads", "materials");
app.use(express.static(staticRoot, {
  extensions: ["html"],
  maxAge: NODE_ENV === "production" ? "1h" : 0
}));

/* ---------------------------
   ORCID OAuth
----------------------------*/
app.get("/auth/orcid/login", (req, res) => {
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
    scope: "/authenticate",
    redirect_uri: ORCID_REDIRECT_URI,
    state
  });
  return res.redirect(`${ORCID_BASE}/oauth/authorize?${params.toString()}`);
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
  const { code, state, error, error_description } = req.query;
  if (error) return sendAuthError(res, `ORCID error: ${String(error_description || error)}`);
  if (!code) return sendAuthError(res, "Missing authorization code");
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
    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => "");
      console.error("ORCID token exchange failed:", tokenRes.status, t, "redirect:", ORCID_REDIRECT_URI);
      return sendAuthError(res, `Token exchange failed: ${tokenRes.status} ${t || "No response body."}`);
    }

    const token = await tokenRes.json();
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
    await setSession(res, { orcid });
    res.redirect("/user-profile.html");
  } catch (e) {
    console.error("ORCID callback failed:", e);
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
          const buf = Buffer.from(content, "binary");
          files.push({ field: nameMatch?.[1] || "file", filename: filenameMatch[1], buffer: buf, size: buf.length });
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
  if (!doiRaw) return res.status(400).json({ error: "doi required" });
  const doi = String(doiRaw).replace(/^doi:/i, "").replace(/^https?:\/\/doi.org\//i, "");
  const out = [];
  try {
    // DataCite backlinks
    const dc = await fetchJSONSafe(`https://api.datacite.org/works?query=${encodeURIComponent('relatedIdentifiers.identifier:"' + doi.replace(/"/g,'\\"') + '"')}&page[size]=200`);
    const hits = Array.isArray(dc.data) ? dc.data : [];
    hits.forEach(rec => {
      const a = rec.attributes || {};
      const title = Array.isArray(a.titles) && a.titles[0]?.title ? a.titles[0].title : (a.title || "");
      const typeGen = String(a.types?.resourceTypeGeneral || "").toLowerCase();
      const kind = typeGen.includes("software") ? "Software" : (typeGen.includes("dataset") ? "Dataset" : "Other");
      out.push({
        provenance: "DataCite",
        type: kind,
        title: title || a.doi || "Related item",
        doi: a.doi || "",
        url: a.url || (a.doi ? `https://doi.org/${a.doi}` : ""),
        repository: a.publisher || ""
      });
    });
  } catch (_) {}

  try {
    // Zenodo backlinks
    const doiEsc = doi.replace(/"/g, '\\"');
    const zenQueries = [
      `metadata.related_identifiers.identifier:"${doiEsc}"`,
      `related.identifiers.identifier:"${doiEsc}"`,
      `doi:"${doiEsc}" OR metadata.related_identifiers.identifier:"${doiEsc}"`,
      `"${doiEsc}"`,
      doiEsc.split("/").pop() || doiEsc
    ];
    for (const qRaw of zenQueries) {
      try {
        const zn = await fetchJSONSafe(`https://zenodo.org/api/records/?q=${encodeURIComponent(qRaw)}&size=200`);
        const hits = Array.isArray(zn.hits?.hits) ? zn.hits.hits : [];
        hits.forEach(h => {
          const md = h.metadata || {};
          const typeGen = String(md.resource_type?.type || "").toLowerCase();
          const kind = typeGen.includes("software") ? "Software" : (typeGen.includes("dataset") ? "Dataset" : "Other");
          const title = md.title || h.doi || "";
          const doiZ = md.doi || h.doi || "";
          const urlZ = h.links?.html || (doiZ ? `https://doi.org/${doiZ}` : "");
          out.push({
            provenance: "Zenodo",
            type: kind,
            title: title || "Zenodo record",
            doi: doiZ,
            url: urlZ,
            repository: "Zenodo",
            version: md.version || "",
            licence: (md.license && (md.license.id || md.license)) || ""
          });
        });
        if (hits.length) break;
      } catch (_) { /* try next */ }
    }
  } catch (_) {}

  try {
    // Publisher page scrape fallback (re-use existing endpoint logic)
    const r = await fetch(`${req.protocol}://${req.get("host")}/api/paper/links?doi=${encodeURIComponent(doi)}`, {
      headers: { "Accept": "application/json" }
    });
    if (r.ok) {
      const links = await r.json();
      links.forEach(h => {
        out.push({
          provenance: h.provenance || "Publisher page",
          type: classifyROKind(h.url || ""),
          title: h.url,
          url: h.url
        });
      });
    }
  } catch (_) {}

  if (!out.length) return res.json([]);
  // Deduplicate by URL
  const seen = new Set();
  const unique = [];
  out.forEach(item => {
    const key = item.url || item.doi;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    unique.push(item);
  });
  res.json(unique);
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
    `SELECT id, name, parent_id FROM collections WHERE orcid=$1 ORDER BY name`,
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
        COALESCE(li.meta_fresh, FALSE) AS meta_fresh,
        COALESCE(ARRAY_AGG(ci.collection_id) FILTER (WHERE ci.collection_id IS NOT NULL), '{}') AS collection_ids
      FROM library_items li
      LEFT JOIN collection_items ci
        ON ci.orcid = li.orcid AND ci.paper_id = li.id
      WHERE li.orcid = $1
      GROUP BY
        li.id, li.title, li.openalex_id, li.openalex_url, li.doi, li.year,
        li.venue, li.authors, li.cited_by, li.abstract, li.pdf_url, li.meta_fresh
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
   SPA fallback
----------------------------*/
// Pretty institution path -> static file with query
app.get("/institution/:id", (req, res) => {
  const instPath = path.join(staticRoot, "institution.html");
  if (fs.existsSync(instPath)) {
    res.sendFile(instPath);
  } else {
    res.redirect(`/institution.html?id=${encodeURIComponent(req.params.id)}`);
  }
});

app.get("*", (req, res, next) => {
  if (req.method === "GET" && req.accepts("html")) {
    return res.sendFile(path.join(staticRoot, "index.html"));
  }
  next();
});

app.listen(PORT, () => {
  const host = NODE_ENV === "production" ? "https://scienceecosystem.org" : `http://localhost:${PORT}`;
  console.log(`ScienceEcosystem server (Postgres) running at ${host}`);
});
