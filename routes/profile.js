const express = require("express");
const db = require("../db");

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session?.user?.orcid) return res.status(401).json({ error: "Not signed in" });
  return next();
}

// GET /api/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const orcid = req.session.user.orcid;
    let user = await db.getUser(orcid);
    if (!user) {
      await db.upsertUser(orcid, {});
      user = await db.getUser(orcid);
    }
    return res.json(user);
  } catch (e) {
    console.error("GET /api/me error:", e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

// PATCH /api/settings/profile
router.patch("/settings/profile", requireAuth, async (req, res) => {
  const orcid = req.session.user.orcid;
  const body = req.body || {};
  try {
    const payload = {
      name: body.name || null,
      affiliation: body.affiliation || null,
      bio: body.bio || null,
      keywords: Array.isArray(body.keywords) ? body.keywords : [],
      languages: Array.isArray(body.languages) ? body.languages : [],
      links: Array.isArray(body.links) ? body.links : [],
      visibility: body.visibility || "public",
    };
    const updated = await db.updateProfile(orcid, payload);
    return res.json(updated || payload);
  } catch (e) {
    console.error("PATCH /api/settings/profile error:", e);
    return res.status(500).json({ error: "Failed to save profile" });
  }
});

module.exports = router;
