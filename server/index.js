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
  STATIC_DIR = "../"
} = process.env;

if (!ORCID_CLIENT_ID || !ORCID_CLIENT_SECRET || !ORCID_REDIRECT_URI) {
  console.error("Missing ORCID env vars in .env");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// --- Very light session using a signed cookie containing a random session id mapped in-memory ---
// For production you might use Redis; here we keep it simple.
const sessions = new Map();
function setSession(res, data) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, { ...data, createdAt: Date.now() });
  res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", signed: true });
}
function getSession(req) {
  const sid = req.signedCookies?.sid;
  return sid ? sessions.get(sid) : null;
}
function clearSession(res, req) {
  const sid = req.signedCookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie("sid");
}

// --- SQLite setup (file scienceecosystem.sqlite in server folder) ---
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
`);

// Helpers
const qUserUpsert = db.prepare(`
  INSERT INTO users (orcid, name, affiliation) VALUES (@orcid, @name, @affiliation)
  ON CONFLICT(orcid) DO UPDATE SET name=excluded.name, affiliation=excluded.affiliation
`);
const qLibList = db.prepare(`SELECT id, title FROM library_items WHERE orcid=? ORDER BY title`);
const qLibAdd = db.prepare(`INSERT OR IGNORE INTO library_items (orcid, id, title) VALUES (?, ?, ?)`);
const qLibDel = db.prepare(`DELETE FROM library_items WHERE orcid=? AND id=?`);
const qLibClear = db.prepare(`DELETE FROM library_items WHERE orcid=?`);

// --- Static site ---
app.use(express.static(path.resolve(__dirname, STATIC_DIR)));

// --- OAuth: start login ---
app.get("/auth/orcid/login", (req, res) => {
  const params = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    response_type: "code",
    scope: "/authenticate", // public scope for sign-in
    redirect_uri: ORCID_REDIRECT_URI
  });
  return res.redirect(`${ORCID_BASE}/oauth/authorize?${params.toString()}`);
});

// --- OAuth: callback (server exchanges code for token) ---
app.get("/auth/orcid/callback", async (req, res) => {
  const { code, error, error_description } = req.query;
  if (error) {
    return res.status(400).send(`ORCID error: ${String(error_description || error)}`);
  }
  if (!code) return res.status(400).send("Missing authorization code");

  // Exchange code for token (must be server-side) per ORCID docs
  // POST { client_id, client_secret, grant_type=authorization_code, code, redirect_uri }
  // Response contains access_token and orcid iD
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

  // Fetch public profile data
  const recRes = await fetch(`${ORCID_API_BASE}/${orcid}/record`, {
    headers: { Accept: "application/json" }
  });
  // Tolerate failures (user might be empty); default to minimal profile
  let name = null, affiliation = null;
  if (recRes.ok) {
    const rec = await recRes.json();
    // Extract a display name
    const person = rec?.person;
    const given = person?.name?.["given-names"]?.value || "";
    const family = person?.name?.["family-name"]?.value || "";
    const credit = person?.name?.["credit-name"]?.value || "";
    name = (credit || `${given} ${family}`).trim() || null;

    // Extract first employment affiliation if present
    const emp = rec?.["activities-summary"]?.employments?.["employment-summary"]?.[0];
    const org = emp?.organization?.name;
    affiliation = org || null;
  }

  qUserUpsert.run({ orcid, name, affiliation });

  // Minimal session
  setSession(res, { orcid });
  // Send back to profile page
  res.redirect("/user-profile.html");
});

// --- Logout ---
app.post("/auth/logout", (req, res) => {
  clearSession(res, req);
  res.status(204).end();
});

// --- API: who am I ---
app.get("/api/me", async (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: "Not signed in" });

  const row = db.prepare("SELECT orcid, name, affiliation FROM users WHERE orcid=?").get(sess.orcid);
  if (!row) return res.status(404).json({ error: "User not found" });

  res.json(row);
});

// --- API: library list/add/remove/clear ---
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

// Fallback to index if route not found (optional)
app.use((req, res, next) => {
  if (req.method === "GET" && req.accepts("html")) {
    return res.sendFile(path.resolve(__dirname, STATIC_DIR, "index.html"));
  }
  next();
});

app.listen(PORT, () => {
  console.log(`ScienceEcosystem auth server running on http://localhost:${PORT}`);
});
