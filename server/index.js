import express from "express";
import fetch from "node-fetch";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import crypto from "crypto";

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
  // Optional: only set this if you do NOT redirect www -> apex
  // e.g. COOKIE_DOMAIN=".scienceecosystem.org"
  COOKIE_DOMAIN
} = process.env;

if (!ORCID_CLIENT_ID || !ORCID_CLIENT_SECRET || !ORCID_REDIRECT_URI) {
  console.error("Missing ORCID env vars in .env");
  process.exit(1);
}

const app = express();

// Behind TLS/proxy (Render), let Express detect req.secure
app.set("trust proxy", 1);

app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// ------------------------------
// SQLite setup
// ------------------------------
const db = new Database(path.join(__dirname, "scienceecosystem.sqlite"));

db.exec(`
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
    FOREIGN KEY(orcid) REFERENCES users(orcid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );


CREATE TABLE IF NOT EXISTS claimed_authors (
  orcid TEXT NOT NULL,
  author_id TEXT NOT NULL,           -- OpenAlex author id tail, e.g. 'A1969205033'
  verified INTEGER NOT NULL DEFAULT 0, -- 0=unverified, 1=verified (phase 2)
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (orcid, author_id),
  FOREIGN KEY(orcid) REFERENCES users(orcid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS merged_claims (
  orcid TEXT NOT NULL,
  primary_author_id TEXT NOT NULL,    -- the “main” author id
  merged_author_id  TEXT NOT NULL,    -- an extra author id merged under the main
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (orcid, primary_author_id, merged_author_id),
  FOREIGN KEY(orcid) REFERENCES users(orcid) ON DELETE CASCADE
);
`);

const qUserUpsert = db.prepare(`
  INSERT INTO users (orcid, name, affiliation) VALUES (@orcid, @name, @affiliation)
  ON CONFLICT(orcid) DO UPDATE SET name=excluded.name, affiliation=excluded.affiliation
`);
const qLibList  = db.prepare(`SELECT id, title FROM library_items WHERE orcid=? ORDER BY title`);
const qLibAdd   = db.prepare(`INSERT OR IGNORE INTO library_items (orcid, id, title) VALUES (?, ?, ?)`);
const qLibDel   = db.prepare(`DELETE FROM library_items WHERE orcid=? AND id=?`);
const qLibClear = db.prepare(`DELETE FROM library_items WHERE orcid=?`);

const qSessGet = db.prepare(`SELECT data, expires_at FROM sessions WHERE sid=?`);
const qSessSet = db.prepare(`INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)`);
const qSessDel = db.prepare(`DELETE FROM sessions WHERE sid=?`);
const qSessGC  = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`);

// ------------------------------
// Session helpers (persistent)
// ------------------------------
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
function setSession(res, payload) {
  const sid = crypto.randomBytes(24).toString("hex");
  const data = JSON.stringify({ ...payload, createdAt: Date.now() });
  const expires = Date.now() + (30 * 24 * 60 * 60 * 1000);
  qSessSet.run(sid, data, expires);
  res.cookie("sid", sid, cookieOptions());
}
function getSession(req) {
  const sid = req.signedCookies?.sid;
  if (!sid) return null;
  const row = qSessGet.get(sid);
  if (!row) return null;
  if (row.expires_at < Date.now()) { qSessDel.run(sid); return null; }
  try { return JSON.parse(row.data); } catch { return null; }
}
function clearSession(req, res) {
  const sid = req.signedCookies?.sid;
  if (sid) qSessDel.run(sid);
  res.clearCookie("sid", cookieOptions());
}
// Garbage-collect expired sessions periodically
setInterval(() => qSessGC.run(Date.now()), 12 * 60 * 60 * 1000);

// ------------------------------
// Health check
// ------------------------------
app.get("/health", (_req, res) => res.type("text").send("ok"));

// ------------------------------
// Static site
// ------------------------------
const staticRoot = path.resolve(__dirname, STATIC_DIR);
app.use(express.static(staticRoot, {
  extensions: ["html"],
  maxAge: NODE_ENV === "production" ? "1h" : 0
}));

// ------------------------------
// ORCID OAuth
// ------------------------------
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
  if (error) {
    return res.status(400).send(`ORCID error: ${String(error_description || error)}`);
  }
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
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
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
      const org = emp?.organization?.name;
      affiliation = org || null;
    }
  } catch {}

  qUserUpsert.run({ orcid, name, affiliation });

  // Persist session (IMPORTANT: correct parameter order)
  setSession(res, { orcid });

  // Redirect to profile
  res.redirect("/user-profile.html");
});

// ------------------------------
// Auth: logout
// ------------------------------
app.post("/auth/logout", (req, res) => {
  clearSession(req, res);
  res.status(204).end();
});

// ------------------------------
// API
// ------------------------------
app.get("/api/me", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const row = db.prepare("SELECT orcid, name, affiliation FROM users WHERE orcid=?").get(sess.orcid);
  if (!row) return res.status(404).json({ error: "User not found" });
  res.json(row);
});

app.get("/api/library", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  res.json(qLibList.all(sess.orcid));
});

app.post("/api/library", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { id, title } = req.body || {};
  if (!id || !title) return res.status(400).json({ error: "id and title required" });
  qLibAdd.run(sess.orcid, String(id), String(title));
  res.status(201).json({ ok: true });
});

app.delete("/api/library/:id", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  qLibDel.run(sess.orcid, String(req.params.id));
  res.status(204).end();
});

app.delete("/api/library", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  qLibClear.run(sess.orcid);
  res.status(204).end();
});

// ------------------------------
// SPA-friendly fallback
// ------------------------------
app.get("*", (req, res, next) => {
  if (req.method === "GET" && req.accepts("html")) {
    return res.sendFile(path.join(staticRoot, "index.html"));
  }
  next();
});

app.listen(PORT, () => {
  const host = NODE_ENV === "production" ? "https://scienceecosystem.org" : `http://localhost:${PORT}`;
  console.log(`ScienceEcosystem server running at ${host}`);
});


const qClaimList = db.prepare(`SELECT author_id, verified, created_at FROM claimed_authors WHERE orcid=? ORDER BY created_at DESC`);
const qClaimAdd  = db.prepare(`INSERT OR IGNORE INTO claimed_authors (orcid, author_id, verified) VALUES (?, ?, 0)`);
const qClaimDel  = db.prepare(`DELETE FROM claimed_authors WHERE orcid=? AND author_id=?`);

const qMergeList = db.prepare(`SELECT primary_author_id, merged_author_id, created_at FROM merged_claims WHERE orcid=? ORDER BY created_at DESC`);
const qMergeAdd  = db.prepare(`INSERT OR IGNORE INTO merged_claims (orcid, primary_author_id, merged_author_id) VALUES (?, ?, ?)`);
const qMergeDel  = db.prepare(`DELETE FROM merged_claims WHERE orcid=? AND primary_author_id=? AND merged_author_id=?`);

// List my claims
app.get("/api/claims", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  res.json({
    claims: qClaimList.all(sess.orcid),
    merges: qMergeList.all(sess.orcid)
  });
});

// Claim an OpenAlex author id
app.post("/api/claims", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { author_id } = req.body || {};
  if (!author_id || !/^A\d+$/.test(String(author_id))) {
    return res.status(400).json({ error: "author_id must look like A123..." });
  }
  qClaimAdd.run(sess.orcid, String(author_id));
  res.status(201).json({ ok: true });
});

// Remove a claimed author id
app.delete("/api/claims/:author_id", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  qClaimDel.run(sess.orcid, String(req.params.author_id));
  res.status(204).end();
});

// Merge: attach another author id under a primary id
app.post("/api/claims/merge", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { primary_author_id, merged_author_id } = req.body || {};
  if (!/^A\d+$/.test(String(primary_author_id)) || !/^A\d+$/.test(String(merged_author_id))) {
    return res.status(400).json({ error: "author ids must look like A123..." });
  }
  qMergeAdd.run(sess.orcid, String(primary_author_id), String(merged_author_id));
  res.status(201).json({ ok: true });
});

// Unmerge
app.delete("/api/claims/merge", (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });
  const { primary_author_id, merged_author_id } = req.query || {};
  if (!primary_author_id || !merged_author_id) return res.status(400).json({ error: "both ids required" });
  qMergeDel.run(sess.orcid, String(primary_author_id), String(merged_author_id));
  res.status(204).end();
});
