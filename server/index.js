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
  NODE_ENV = "development"
} = process.env;

if (!ORCID_CLIENT_ID || !ORCID_CLIENT_SECRET || !ORCID_REDIRECT_URI) {
  console.error("Missing ORCID env vars in .env");
  process.exit(1);
}

const app = express();

// If you're behind a proxy/edge TLS (most hosts), this lets Express see req.secure
app.set("trust proxy", 1);

app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// --- Very light session using a signed cookie containing a random session id mapped in-memory ---
// For production you might use Redis; here we keep it simple.
const sessions = new Map();
function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    // secure cookies in production; ok plain over http for local dev
    secure: NODE_ENV === "production",
  };
}
function setSession(req, res, data) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, { ...data, createdAt: Date.now() });
  res.cookie("sid", sid, cookieOptions(req));
}
function getSession(req) {
  const sid = req.signedCookies?.sid;
  return sid ? sessions.get(sid) : null;
}
function clearSession(req, res) {
  const sid = req.signedCookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie("sid", cookieOptions(req));
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

// --- Health check (useful for uptime monitors) ---
app.get("/health", (_req, res) => res.type("text").send("ok"));

// --- Static site (serve your HTML/CSS/JS) ---
const staticRoot = path.resolve(__dirname, STATIC_DIR);
app.use(express.static(staticRoot, {
  extensions: ["html"], // so /about resolves to about.html if you like
  maxAge: NODE_ENV === "production" ? "1h" : 0
}));

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
  let name = null, affiliation = null;
  try {
    const recRes = await fetch(`${ORCID_API_BASE}/${orcid}/record`, {
      headers: { Accept: "application/json" }
    });
    if (recRes.ok) {
      const rec = await recRes.json();
      const person = rec?.person;
      const given = person?.name?.["given-names"]?.value || "";
      const family = person?.name?.["family-name"]?.value || "";
      const credit = person?.name?.["credit-name"]?.value || "";
      name = (credit || `${given} ${family}`).trim() || null;
      const emp = rec?.["activities-summary"]?.employments?.["employment-summary"]?.[0];
      const org = emp?.organization?.name;
      affiliation = org || null;
    }
  } catch {}

  qUserUpsert.run({ orcid, name, affiliation });

  // Minimal session
  setSession(req, res, { orcid });

  // Send back to profile page
  res.redirect("/user-profile.html");
});

// --- Logout ---
app.post("/auth/logout", (req, res) => {
  clearSession(req, res);
  res.status(204).end();
});

// --- API: who am I ---
app.get("/api/me", (req, res) => {
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

// --- Fallback: serve index.html for unknown GET routes (SPA-friendly) ---
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
