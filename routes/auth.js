const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch");
const db = require("../db");

const router = express.Router();

const ORCID_BASE = process.env.ORCID_BASE || "https://orcid.org";
const ORCID_API_BASE = process.env.ORCID_API_BASE || "https://api.orcid.org/v3.0";
const ORCID_CLIENT_ID = process.env.ORCID_CLIENT_ID || "";
const ORCID_CLIENT_SECRET = process.env.ORCID_CLIENT_SECRET || "";
const ORCID_REDIRECT_URI = process.env.ORCID_REDIRECT_URI || "";

const SCOPE = "/authenticate"; // minimal scope to identify user

function base64url(input) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

router.get("/auth/orcid/login", async (req, res) => {
  if (!ORCID_CLIENT_ID || !ORCID_REDIRECT_URI) {
    return res.status(500).send("ORCID not configured");
  }
  const state = base64url(crypto.randomBytes(24));
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());

  req.session.oauth = { state, codeVerifier };

  const params = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: ORCID_REDIRECT_URI,
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  return res.redirect(`${ORCID_BASE}/oauth/authorize?${params.toString()}`);
});

router.get("/auth/orcid/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Missing code/state");
    if (!req.session.oauth || req.session.oauth.state !== state) {
      return res.status(400).send("Invalid state");
    }
    const codeVerifier = req.session.oauth.codeVerifier;
    delete req.session.oauth;

    const tokenParams = new URLSearchParams({
      client_id: ORCID_CLIENT_ID,
      client_secret: ORCID_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: ORCID_REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    const tokenRes = await fetch(`${ORCID_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return res.status(400).send(`ORCID token error: ${text}`);
    }
    const tokenData = await tokenRes.json();
    const orcid = tokenData.orcid;
    if (!orcid) return res.status(400).send("No ORCID returned");

    // Basic upsert; name can be filled later by user.
    await db.upsertUser(orcid, { name: tokenData.name || null });

    req.session.user = { orcid };
    return res.redirect("/user-profile.html");
  } catch (e) {
    console.error("ORCID callback error:", e);
    return res.status(500).send("Auth failed");
  }
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sid");
    res.status(204).end();
  });
});

module.exports = router;
