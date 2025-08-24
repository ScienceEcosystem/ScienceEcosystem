// routes/search.js
const express = require('express');
const axios = require('axios');

const router = express.Router();

const OPENALEX_BASE = process.env.OPENALEX_BASE || 'https://api.openalex.org';
const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO || ''; // e.g. scienceecosystem@icloud.com
const TIMEOUT_MS = Number(process.env.OPENALEX_TIMEOUT_MS || 10000);
const CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || 60_000);

// Lightweight in-memory TTL cache
const cache = new Map();
const now = () => Date.now();
const cacheKey = (path, params) => {
  const usp = new URLSearchParams(params);
  return `${path}?${usp.toString()}`;
};
const getCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now() - hit.t > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.v;
};
const setCache = (key, value) => cache.set(key, { v: value, t: now() });

const http = axios.create({
  baseURL: OPENALEX_BASE,
  timeout: TIMEOUT_MS,
  headers: { 'User-Agent': 'ScienceEcosystem/1.0 (+https://scienceecosystem.org)' },
});

// Helper: GET with cache and polite mailto param
async function getOpenAlex(path, params = {}) {
  const finalParams = { ...params };
  if (OPENALEX_MAILTO) finalParams.mailto = OPENALEX_MAILTO;

  const key = cacheKey(path, finalParams);
  const cached = getCache(key);
  if (cached) return cached;

  const res = await http.get(path, { params: finalParams });
  const value = res.data;
  setCache(key, value);
  return value;
}

// GET /api/search?q=...&page=1&per_page=25&include_authors=true&include_works=true&include_concepts=true
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ meta: { q, page: 1, per_page: 25 }, authors: [], works: [], concepts: [] });
  }

  // clamp inputs
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const perPageRaw = parseInt(req.query.per_page || '25', 10) || 25;
  const perPage = Math.max(1, Math.min(perPageRaw, 100)); // keep modest

  const includeAuthors = req.query.include_authors !== 'false';
  const includeWorks = req.query.include_works !== 'false';
  const includeConcepts = req.query.include_concepts !== 'false';

  // Build requests (OpenAlex expects 'per_page')
  const tasks = [];
  if (includeAuthors) {
    tasks.push(
      getOpenAlex('/authors', { search: q, 'per_page': 5, page })
        .then(d => ({ ok: true, type: 'authors', data: d }))
        .catch(e => ({ ok: false, type: 'authors', error: e?.message || 'authors failed' }))
    );
  }
  if (includeWorks) {
    tasks.push(
      getOpenAlex('/works', { search: q, 'per_page': perPage, page })
        .then(d => ({ ok: true, type: 'works', data: d }))
        .catch(e => ({ ok: false, type: 'works', error: e?.message || 'works failed' }))
    );
  }
  if (includeConcepts) {
    tasks.push(
      getOpenAlex('/concepts', { search: q, 'per_page': 5, page })
        .then(d => ({ ok: true, type: 'concepts', data: d }))
        .catch(e => ({ ok: false, type: 'concepts', error: e?.message || 'concepts failed' }))
    );
  }

  const started = now();
  const results = await Promise.all(tasks);
  const took_ms = now() - started;

  const payload = {
    meta: { q, page, per_page: perPage, took_ms },
    authors: [],
    works: [],
    concepts: [],
    warnings: [],
  };

  for (const r of results) {
    if (!r.ok) {
      payload.warnings.push(`${r.type}: ${r.error}`);
      continue;
    }
    switch (r.type) {
      case 'authors':
        payload.authors = r.data.results || [];
        break;
      case 'works':
        payload.works = r.data.results || [];
        payload.meta.works_count = r.data.meta?.count || undefined;
        break;
      case 'concepts':
        payload.concepts = r.data.results || [];
        break;
      default:
        break;
    }
  }

  res.set('Cache-Control', 'public, max-age=60'); // let browsers cache for 60s
  return res.json(payload);
});

module.exports = router;
