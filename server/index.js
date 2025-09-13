import express from "express";
import fetch from "node-fetch";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import pkg from "pg";
const { Pool } = pkg;

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

/** ---------------------------
 * Postgres (Neon) connection
 * --------------------------*/
const pool = new Pool({
  connectionString: DATABASE_URL,
  // sslmode=require in the URL is sufficient; keeping config simple
});

async function pgInit() {
  // Create tables (idempotent)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      orcid TEXT PRIMARY KEY,
      name TEXT,
      affiliation TEXT
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
}
await pgInit();

/** ---------------------------
 * Session helpers (persistent)
 * --------------------------*/
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
  await pool.query(
    `INSERT INTO sessions (sid, data, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [sid, payload, expires]
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
  return row.data; // JSONB -> object
}
async function clearSession(req, res) {
  const sid = req.signedCookies?.sid;
  if (sid) await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
  res.clearCookie("sid", cookieOptions());
}
// Optional GC
setInterval(() => pool.query(`DELETE FROM sessions WHERE expires_at < $1`, [Date.now()]).catch(()=>{}), 12 * 60 * 60 * 1000);

/** ---------------------------
 * SQL helpers
 * --------------------------*/
async function upsertUser({ orcid, name, affiliation }) {
  await pool.query(
    `INSERT INTO users (orcid, name, affiliation)
     VALUES ($1, $2, $3)
     ON CONFLICT (orcid) DO UPDATE SET name = EXCLUDED.name, affiliation = EXCLUDED.affiliation`,
    [orcid, name, affiliation]
  );
}
async function getUser(orcid) {
  const { rows } = await pool.query(`SELECT orcid, name, affiliation FROM users WHERE orcid = $1`, [orcid]);
  return rows[0] || null;
}
async function libraryList(orcid) {
  const { rows } = await pool.query(`SELECT id, title FROM library_items WHERE orcid = $1 ORDER BY title`, [orcid]);
  return rows;
}
async function libraryAdd(orcid, id, title) {
  await pool.query(`INSERT INTO library_items (orcid, id, title) VALUES ($1, $2, $3) ON CONFLICT (orcid, id) DO NOTHING`, [orcid, id, title]);
}
async function libraryDel(orcid, id) {
  await pool.query(`DELETE FROM library_items WHERE orcid = $1 AND id = $2`, [orcid, id]);
}
async function libraryClear(orcid) {
  await pool.query(`DELETE FROM library_items WHERE orcid = $1`, [orcid]);
}

// Claims/Merges
async function claimsList(orcid) {
  const claims = await pool.query(`SELECT author_id, verified, EXTRACT(EPOCH FROM created_at)::bigint AS created_at FROM claimed_authors WHERE orcid=$1 ORDER BY created_at DESC`, [orcid]);
  const merges = await pool.query(`SELECT primary_author_id, merged_author_id, EXTRACT(EPOCH FROM created_at)::bigint AS created_at FROM merged_claims WHERE orcid=$1 ORDER BY created_at DESC`, [orcid]);
  return { claims: claims.rows, merges: merges.rows };
}
async function claimAdd(orcid, author_id) {
  await pool.query(`INSERT INTO claimed_authors (orcid, author_id, verified) VALUES ($1, $2, FALSE) ON CONFLICT (orcid, author_id) DO NOTHING`, [orcid, author_id]);
}
async function claimDel(orcid, author_id) {
  await pool.query(`DELETE FROM claimed_authors WHERE orcid=$1 AND author_id=$2`, [orcid, author_id]);
}
async function mergeAdd(orcid, primary_id, merged_id) {
  await pool.query(`INSERT INTO merged_claims (orcid, primary_author_id, merged_author_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [orcid, primary_id, merged_id]);
}
async function mergeDel(orcid, primary_id, merged_id) {
  await pool.query(`DELETE FROM merged_claims WHERE orcid=$1 AND primary_author_id=$2 AND merged_author_id=$3`, [orcid, primary_id, merged_id]);
}

/** ---------------------------
 * Health + static
 * --------------------------*/
app.get("/health", (_req, res) => res.type("text").send("ok"));

const staticRoot = path.resolve(__dirname, STATIC_DIR);
app.use(express.static(staticRoot, {
  extensions: ["html"],
  maxAge: NODE_ENV === "production" ? "1h" : 0
}));

/** ---------------------------
 * ORCID OAuth
 * --------------------------*/
app.get("/auth/orcid/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    response_type: "code",
    scope: "/authenticate",
    redirect_uri: ORCID_REDIRECT_URI
  });
  return res.redirect(`${ORCID_BASE}/oauth/authorize?${params.toString()}`);
});

app.get("/auth/orcid/callback", async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) return res.status(400).send(`ORCID error: ${String(error_description || error)}`);
  if (!code) return res.status(400).send("Missing authorization code");

  const form = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    client_secret: ORCID_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: ORCID_REDIRECT_URI
  });

  const tokenRes = await fetch(`${ORCID_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text().catch(() => "");
    return res.status(400).send(`Token exchange failed: ${tokenRes.status} ${t}`);
  }

  const token = await tokenRes.json();
  const orcid = token.orcid;
  if (!orcid) return res.status(400).send("Token response missing ORCID iD");

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
});

/** ---------------------------
 * Auth + API
 * --------------------------*/
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

// Claim/Merge
app.get("/api/claims", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  res.json(await claimsList(sess.orcid));
});

app.post("/api/claims", async (req, res) => {
  const sess = await getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { author_id } = req.body || {};
  if (!author_id || !/^A\\d+$/.test(String(author_id))) {
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
  if (!/^A\\d+$/.test(String(primary_author_id)) || !/^A\\d+$/.test(String(merged_author_id))) {
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

/** ---------------------------
 * SPA fallback
 * --------------------------*/
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
