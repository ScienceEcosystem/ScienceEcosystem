const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function getOrcid(req) {
  return req.session?.user?.orcid || null;
}

// Get user's library
router.get('/api/library', async (req, res) => {
  const orcid = getOrcid(req);
  if (!orcid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const result = await pool.query(
      `SELECT * FROM library 
       WHERE orcid = $1 
       ORDER BY added_at DESC`,
      [orcid]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Library fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add paper to library
router.post('/api/library', async (req, res) => {
  const orcid = getOrcid(req);
  if (!orcid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const { doi, title, authors, year, journal } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO library (orcid, doi, title, authors, year, journal, added_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (orcid, doi) DO UPDATE SET added_at = NOW()
       RETURNING *`,
      [orcid, doi, title, JSON.stringify(authors), year, journal]
    );
    
    res.json(result.rows[0] || { success: true });
  } catch (error) {
    console.error('Library add error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove from library
router.delete('/api/library/:doi(*)', async (req, res) => {
  const orcid = getOrcid(req);
  if (!orcid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const doi = decodeURIComponent(req.params.doi);
  
  try {
    await pool.query(
      'DELETE FROM library WHERE orcid = $1 AND doi = $2',
      [orcid, doi]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Library delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
