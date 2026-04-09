import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();
const OPENALEX_BASE = "https://api.openalex.org";
const OPENALEX_MAILTO = "info@scienceecosystem.org";

// Get paper with linked resources
router.get('/api/paper/:doi(*)', async (req, res, next) => {
  const raw = String(req.params.doi || "");
  if (raw.startsWith("artifacts")) return next();
  if (raw.startsWith("oa")) return next();
  if (raw.startsWith("links")) return next();
  if (raw.startsWith("citation-contexts")) return next();
  if (raw.startsWith("artifacts?")) return next();
  if (raw.startsWith("oa?")) return next();
  if (raw.startsWith("links?")) return next();
  if (raw.startsWith("citation-contexts?")) return next();
  const doi = decodeURIComponent(raw);
  
  try {
    const linkedResources = await findLinkedResources(doi);
    const reproducibilityScore = calculateReproducibilityScore(linkedResources);
    
    res.json({
      linkedResources,
      reproducibilityScore
    });
  } catch (error) {
    console.error('Error fetching paper resources:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/pdf/proxy?url=<encoded_pdf_url>
// Proxies external PDFs to bypass CORS restrictions
router.get('/api/pdf/proxy', async (req, res) => {
  const pdfUrl = req.query?.url;
  if (!pdfUrl) return res.status(400).json({ error: 'url parameter required' });

  let target;
  try {
    target = new URL(String(pdfUrl));
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ error: 'unsupported protocol' });
  }

  const host = target.hostname || '';
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return res.status(400).json({ error: 'disallowed host' });
  }

  try {
    const host = target.hostname || '';
    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/pdf,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': target.origin + '/',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0'
    };

    const hostHeaders = {
      'academic.oup.com': {
        'Accept': 'text/html,application/pdf,application/xhtml+xml,*/*',
        'Referer': target.origin + '/',
        'Sec-Fetch-Site': 'same-origin'
      },
      'arxiv.org': {
        'Accept': 'application/pdf,*/*',
        'Referer': 'https://arxiv.org/'
      },
      'doi.org': {
        'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*',
        'Referer': 'https://doi.org/'
      }
    };

    const mergedHeaders = Object.assign({}, baseHeaders, (hostHeaders[host] || {}));

    const response = await fetch(target.toString(), {
      headers: mergedHeaders,
      redirect: 'follow'
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch PDF' });
    }

    const contentType = response.headers.get('content-type') || 'application/pdf';
    const contentLength = response.headers.get('content-length');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('PDF proxy error:', e);
    res.status(500).json({ error: 'Failed to fetch PDF' });
  }
});

// POST /api/pdf/extract
// Extract structured data from PDF using GROBID cloud service
router.post('/api/pdf/extract', async (req, res) => {
  const { pdfUrl } = req.body || {};
  if (!pdfUrl) return res.status(400).json({ error: 'pdfUrl required' });

  try {
    const absoluteUrl = pdfUrl.startsWith('/')
      ? `${req.protocol}://${req.get('host')}${pdfUrl}`
      : pdfUrl;

    const pdfResponse = await fetch(absoluteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': (new URL(absoluteUrl)).origin + '/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    if (!pdfResponse.ok) throw new Error('Failed to fetch PDF');
    const pdfBuffer = await pdfResponse.arrayBuffer();

    const formData = new FormData();
    formData.append('input', new Blob([pdfBuffer]), 'paper.pdf');

    const grobidResponse = await fetch('https://cloud.science-miner.com/grobid/api/processFulltextDocument', {
      method: 'POST',
      body: formData
    });
    if (!grobidResponse.ok) throw new Error('GROBID processing failed');

    const teiXml = await grobidResponse.text();
    const parsed = parseGrobidTEI(teiXml);
    res.json(parsed);
  } catch (e) {
    console.error('PDF extraction error:', e);
    res.json({
      references: [],
      figures: [],
      tables: [],
      metadata: {
        totalReferences: 0,
        totalFigures: 0,
        totalTables: 0,
        message: 'Reference extraction failed for this PDF.'
      }
    });
  }
});

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Helper function to parse GROBID TEI XML
function parseGrobidTEI(teiXml) {
  const references = [];
  const figures = [];
  const tables = [];
  const supplementaryLinks = [];

  const refMatches = teiXml.matchAll(/<biblStruct[^>]*>(.*?)<\/biblStruct>/gs);
  let refNumber = 1;

  for (const match of refMatches) {
    const refXml = match[1] || '';

    const titleMatch = refXml.match(/<title[^>]*level="a"[^>]*>(.*?)<\/title>/s);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';

    const authorMatches = refXml.matchAll(/<author>(.*?)<\/author>/gs);
    const authors = [];
    for (const authorMatch of authorMatches) {
      const authorXml = authorMatch[1] || '';
      const forename = authorXml.match(/<forename[^>]*>(.*?)<\/forename>/s)?.[1] || '';
      const surname = authorXml.match(/<surname[^>]*>(.*?)<\/surname>/s)?.[1] || '';
      const name = stripTags(`${forename} ${surname}`);
      if (name) authors.push(name);
    }

    const doiMatch = refXml.match(/<idno[^>]*type="DOI"[^>]*>(.*?)<\/idno>/);
    const doi = doiMatch ? stripTags(doiMatch[1]) : null;

    const yearMatch = refXml.match(/<date[^>]*when="(\d{4})/);
    const year = yearMatch ? yearMatch[1] : null;

    references.push({
      number: refNumber++,
      title: title,
      authors: authors,
      doi: doi,
      year: year
    });
  }

  const figMatches = teiXml.matchAll(/<figure[^>]*>(.*?)<\/figure>/gs);
  let figNumber = 1;
  for (const match of figMatches) {
    const figXml = match[1] || '';
    const captionMatch = figXml.match(/<figDesc>(.*?)<\/figDesc>/s);
    const caption = captionMatch ? stripTags(captionMatch[1]) : '';
    figures.push({ number: figNumber++, caption: caption });
  }

  const tableFigureMatches = teiXml.matchAll(/<figure[^>]*type=\"table\"[^>]*>(.*?)<\/figure>/gs);
  let tableNumber = 1;
  for (const match of tableFigureMatches) {
    const tabXml = match[1] || '';
    const captionMatch = tabXml.match(/<figDesc>(.*?)<\/figDesc>/s) || tabXml.match(/<head>(.*?)<\/head>/s);
    const caption = captionMatch ? stripTags(captionMatch[1]) : '';
    tables.push({ number: tableNumber++, caption: caption });
  }

  const tableMatches = teiXml.matchAll(/<table[^>]*>(.*?)<\/table>/gs);
  for (const match of tableMatches) {
    const tabXml = match[1] || '';
    const captionMatch = tabXml.match(/<head>(.*?)<\/head>/s) || tabXml.match(/<figDesc>(.*?)<\/figDesc>/s);
    const caption = captionMatch ? stripTags(captionMatch[1]) : '';
    if (caption) {
      tables.push({ number: tableNumber++, caption: caption });
    }
  }

  try {
    const text = stripTags(teiXml);
    const urlRegex = /https?:\/\/[^\s)]+/g;
    const doiRegex = /10\.\d{4,9}\/[^\s)]+/g;
    const found = new Set();
    let match;

    function pushLink(rawUrl, context) {
      if (!rawUrl) return;
      const url = rawUrl.replace(/[).,;]+$/g, '');
      if (found.has(url)) return;
      found.add(url);
      const ctx = String(context || '').toLowerCase();
      let label = '';
      if (ctx.includes('peer review')) label = 'Peer review file';
      else if (ctx.includes('supplementary')) label = 'Supplementary material';
      else if (ctx.includes('reprints') || ctx.includes('permissions') || ctx.includes('correspondence')) label = 'Publisher info';
      if (!label) return;
      supplementaryLinks.push({ url, label });
    }

    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[0];
      const start = Math.max(0, match.index - 120);
      const end = Math.min(text.length, match.index + url.length + 120);
      const context = text.slice(start, end);
      pushLink(url, context);
    }

    while ((match = doiRegex.exec(text)) !== null) {
      const doi = match[0].replace(/[).,;]+$/g, '');
      const url = `https://doi.org/${doi}`;
      const start = Math.max(0, match.index - 120);
      const end = Math.min(text.length, match.index + doi.length + 120);
      const context = text.slice(start, end);
      pushLink(url, context);
    }
  } catch (_) {}

  return {
    references: references,
    figures: figures,
    tables: tables,
    supplementaryLinks,
    metadata: {
      totalReferences: references.length,
      totalFigures: figures.length,
      totalTables: tables.length
    }
  };
}

// Semantic Scholar API
const S2_API_BASE = "https://api.semanticscholar.org/graph/v1";

async function s2FetchJson(url) {
  const headers = { "Accept": "application/json" };
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY || "";
  if (key) headers["x-api-key"] = key;
  const res = await fetch(url, { headers });
  const text = await res.text().catch(() => "");
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) {}
  return { ok: res.ok, status: res.status, data, text };
}

async function getSemanticScholarCitations(doi) {
  try {
    const paperRes = await s2FetchJson(`${S2_API_BASE}/paper/DOI:${encodeURIComponent(doi)}?fields=paperId`);
    if (!paperRes.ok) return null;
    const { paperId } = paperRes.data || {};
    if (!paperId) return null;

    return getSemanticScholarCitationsByPaperId(paperId);
  } catch (e) {
    console.error('Semantic Scholar API error:', e);
    return null;
  }
}

async function getSemanticScholarCitationsByPaperId(paperId) {
  try {
    const citationsRes = await s2FetchJson(
      `${S2_API_BASE}/paper/${encodeURIComponent(paperId)}/citations?fields=contexts,intents,isInfluential,citingPaper&limit=100`
    );
    if (!citationsRes.ok) return { items: null, error: `s2 citations ${citationsRes.status}` };
    const data = citationsRes.data || {};

    const items = (data.data || [])
      .filter(c => c.citingPaper?.isOpenAccess && c.contexts?.length > 0)
      .map(c => ({
        source: 'semantic_scholar',
        title: c.citingPaper.title,
        year: c.citingPaper.year,
        authors: c.citingPaper.authors?.map(a => a.name).join(', ') || '',
        snippet: c.contexts[0],
        intent: c.intents?.[0] || 'background',
        isInfluential: c.isInfluential || false,
        url: c.citingPaper.url || (c.citingPaper.externalIds?.DOI ? `https://doi.org/${c.citingPaper.externalIds.DOI}` : null),
        openAccessPdf: c.citingPaper.openAccessPdf?.url || null
      }));
    return { items, error: null };
  } catch (e) {
    console.error('Semantic Scholar API error:', e);
    return { items: null, error: 's2 fetch error' };
  }
}

function normalizeTitleForSearch(input) {
  return String(input || "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function jaccardTitle(a, b) {
  const toks = s => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const A = toks(a), B = toks(b);
  let inter = 0;
  A.forEach(t => { if (B.has(t)) inter++; });
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}

function invertAbstract(idx) {
  const words = [];
  Object.keys(idx || {}).forEach(word => {
    const positions = idx[word] || [];
    for (const pos of positions) words[pos] = word;
  });
  return words.join(" ").replace(/\s+/g, " ").trim();
}
function firstSentences(text, maxSentences = 2) {
  const parts = String(text || "").split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, maxSentences).join(" ").trim();
}

async function getOpenAlexCitingAbstractSnippets(doi) {
  if (!doi) return [];
  try {
    const workRes = await fetch(`${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}?mailto=${encodeURIComponent(OPENALEX_MAILTO)}`);
    if (!workRes.ok) return [];
    const work = await workRes.json();
    const idTail = String(work?.id || "").replace(/^https?:\/\/openalex\.org\//i, "");
    if (!idTail) return [];

    const citeRes = await fetch(`${OPENALEX_BASE}/works?filter=cites:${encodeURIComponent(idTail)}&per_page=20&select=id,display_name,authorships,publication_year,open_access,primary_location,best_oa_location,doi,ids,abstract_inverted_index&mailto=${encodeURIComponent(OPENALEX_MAILTO)}`);
    if (!citeRes.ok) return [];
    const data = await citeRes.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    const items = [];
    for (const r of results) {
      if (!r?.open_access?.is_oa) continue;
      const abstract = r.abstract_inverted_index ? invertAbstract(r.abstract_inverted_index) : "";
      if (!abstract) continue;
      const snippet = firstSentences(abstract, 2);
      if (!snippet) continue;
      const doiC = String(r.doi || r?.ids?.doi || "").replace(/^doi:/i, "");
      const pdfUrl = r?.best_oa_location?.pdf_url || r?.primary_location?.pdf_url || r?.best_oa_location?.url_for_pdf || null;
      const authors = Array.isArray(r.authorships) ? r.authorships.map(a => a?.author?.display_name).filter(Boolean).join(", ") : "";
      const url = r?.primary_location?.landing_page_url || (doiC ? `https://doi.org/${doiC}` : null);
      items.push({
        source: "openalex_abstract",
        title: r.display_name || "OpenAlex work",
        year: r.publication_year || null,
        authors,
        snippet,
        intent: "background",
        isInfluential: false,
        url,
        openAccessPdf: pdfUrl
      });
      if (items.length >= 5) break;
    }
    return items;
  } catch (e) {
    console.error("OpenAlex citing abstracts error:", e);
    return [];
  }
}

async function resolveSemanticScholarPaperId({ doi, title, s2url, s2id }) {
  // 1) DOI lookup
  if (doi) {
    const paperRes = await s2FetchJson(`${S2_API_BASE}/paper/DOI:${encodeURIComponent(doi)}?fields=paperId,title,externalIds`);
    if (paperRes.ok) {
      const data = paperRes.data || {};
      if (data?.paperId) return { paperId: data.paperId, source: "doi" };
    }
  }

  // 2) Try direct ID
  if (s2id) {
    const paperRes = await s2FetchJson(`${S2_API_BASE}/paper/${encodeURIComponent(String(s2id))}?fields=paperId,title,externalIds`);
    if (paperRes.ok) {
      const data = paperRes.data || {};
      if (data?.paperId) return { paperId: data.paperId, source: "id" };
    }
    // Try CorpusID if numeric
    if (/^\d+$/.test(String(s2id))) {
      const corpRes = await s2FetchJson(`${S2_API_BASE}/paper/CorpusID:${encodeURIComponent(String(s2id))}?fields=paperId,title,externalIds`);
      if (corpRes.ok) {
        const data = corpRes.data || {};
        if (data?.paperId) return { paperId: data.paperId, source: "corpus" };
      }
    }
  }

  // 3) Search by title or URL slug
  let query = "";
  if (title) query = String(title);
  if (!query && s2url) {
    try {
      const u = new URL(String(s2url));
      const parts = u.pathname.split("/").filter(Boolean);
      const slug = parts.length >= 2 ? parts[1] : "";
      query = normalizeTitleForSearch(slug);
    } catch (_) {}
  }
  if (!query) return { paperId: null, source: "none" };

  const searchRes = await s2FetchJson(`${S2_API_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=5&fields=paperId,title,externalIds`);
  if (!searchRes.ok) return { paperId: null, source: `search_error_${searchRes.status}` };
  const search = searchRes.data || {};
  const items = Array.isArray(search?.data) ? search.data : [];
  if (!items.length) return { paperId: null, source: "search_empty" };

  let best = null;
  let bestScore = 0;
  for (const it of items) {
    const score = jaccardTitle(query, it.title || "");
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  if (best && bestScore >= 0.35) return { paperId: best.paperId, source: "search" };
  return { paperId: null, source: "search_low" };
}

// OpenCitations API
async function getOpenCitations(doi) {
  try {
    const cleanDoi = doi.replace(/^doi:/i, '');
    const res = await fetch(`https://opencitations.net/index/coci/api/v1/citations/${encodeURIComponent(cleanDoi)}`);
    if (!res.ok) return null;
    const citations = await res.json();
    return citations.map(c => ({
      source: 'opencitations',
      citingDoi: c.citing,
      citedDoi: c.cited,
      year: c.creation?.split('-')[0] || null
    }));
  } catch (e) {
    console.error('OpenCitations API error:', e);
    return null;
  }
}

// CORE API (optional)
async function getCORECitations(doi, apiKey) {
  if (!apiKey) return null;
  try {
    const query = `doi:"${doi.replace(/^doi:/i, '')}"`;
    const res = await fetch(
      `https://core.ac.uk/api-v2/articles/search/${encodeURIComponent(query)}?apiKey=${apiKey}&metadata=true&fulltext=false&citations=false&similar=false&duplicate=false&urls=true&faithfulMetadata=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.map(paper => ({
      source: 'core',
      title: paper.title,
      year: paper.yearPublished,
      authors: paper.authors?.join(', ') || '',
      url: paper.downloadUrl || paper.urls?.[0] || null
    })) || [];
  } catch (e) {
    console.error('CORE API error:', e);
    return null;
  }
}

// ScienceOpen API (peer review data)
async function getScienceOpenReviews(doi) {
  try {
    const cleanDoi = doi.replace(/^doi:/i, '');
    const res = await fetch(`https://www.scienceopen.com/api/document/doi/${encodeURIComponent(cleanDoi)}/reviews`);
    if (!res.ok) return null;
    const reviews = await res.json();
    return reviews.map(r => ({
      source: 'scienceopen',
      reviewer: r.author?.name || 'Anonymous',
      date: r.created,
      rating: r.rating,
      comment: r.comment,
      url: `https://www.scienceopen.com/document?doi=${cleanDoi}`
    }));
  } catch (e) {
    console.error('ScienceOpen API error:', e);
    return null;
  }
}

// Lens.org API (optional)
async function getLensImpact(doi, apiKey) {
  if (!apiKey) return null;
  try {
    const cleanDoi = doi.replace(/^doi:/i, '');
    const res = await fetch('https://api.lens.org/scholarly/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: { match: { doi: cleanDoi } },
        include: ['scholarly_citations', 'patent_citations', 'clinical_trials']
      })
    });
    if (!res.ok) return null;
    const data = await res.json();

    const paper = data.data?.[0];
    if (!paper) return null;

    return {
      source: 'lens',
      patentCitations: paper.patent_citation_count || 0,
      patents: paper.citing_patents?.slice(0, 5) || [],
      clinicalTrials: paper.clinical_trials?.slice(0, 5) || [],
      scholarCitations: paper.scholarly_citation_count || 0
    };
  } catch (e) {
    console.error('Lens.org API error:', e);
    return null;
  }
}

// Semantic Scholar abstract (fallback when OpenAlex abstract is missing)
async function getSemanticScholarAbstract(doi) {
  try {
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,abstract`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.abstract) return null;
    return { title: data.title || null, abstract: data.abstract };
  } catch (e) {
    console.error('Semantic Scholar abstract error:', e);
    return null;
  }
}

// GET /api/paper/abstract?doi=10.xxxx
router.get('/api/paper/abstract', async (req, res) => {
  const doi = req.query?.doi;
  if (!doi) return res.status(400).json({ error: 'doi required' });

  try {
    const ss = await getSemanticScholarAbstract(doi);
    if (!ss) return res.status(404).json({ error: 'No abstract found' });
    res.json({ source: 'semantic_scholar', title: ss.title, abstract: ss.abstract });
  } catch (e) {
    console.error('Abstract fallback error:', e);
    res.status(500).json({ error: 'Failed to fetch abstract' });
  }
});

// GET /api/paper/citation-contexts?doi=10.xxxx
router.get('/api/paper/citation-contexts', async (req, res) => {
  const doi = req.query?.doi;
  const s2id = req.query?.s2id;
  const s2url = req.query?.s2url;
  const title = req.query?.title;
  if (!doi && !s2id && !s2url && !title) return res.status(400).json({ error: 'doi, s2id, s2url, or title required' });

  try {
    let semanticScholar = null;
    let semanticError = null;
    if (s2id || s2url || title || doi) {
      const resolved = await resolveSemanticScholarPaperId({ doi, title, s2url, s2id });
      if (resolved.paperId) {
        const s2 = await getSemanticScholarCitationsByPaperId(resolved.paperId);
        semanticScholar = s2.items;
        semanticError = s2.error ? `${s2.error} (resolved via ${resolved.source})` : null;
      } else if (doi) {
        semanticScholar = await getSemanticScholarCitations(doi);
      } else {
        semanticError = `resolve_failed:${resolved.source}`;
      }
    }

    const [openCitations, core, scienceOpen, lensImpact] = await Promise.all([
      doi ? getOpenCitations(doi) : null,
      doi ? getCORECitations(doi, process.env.CORE_API_KEY) : null,
      doi ? getScienceOpenReviews(doi) : null,
      doi ? getLensImpact(doi, process.env.LENS_API_KEY) : null
    ]);

    if (semanticScholar && !Array.isArray(semanticScholar) && typeof semanticScholar === "object" && "items" in semanticScholar) {
      if (!semanticError && semanticScholar.error) semanticError = semanticScholar.error;
      semanticScholar = semanticScholar.items || [];
    }

    if ((!semanticScholar || semanticScholar.length === 0) && doi) {
      const oaFallback = await getOpenAlexCitingAbstractSnippets(doi);
      if (oaFallback.length) semanticScholar = oaFallback;
    }

    const result = {
      citationContexts: semanticScholar || [],
      citationLinks: openCitations || [],
      coreResults: core || [],
      peerReviews: scienceOpen || [],
      impact: lensImpact || null,
      sources: {
        semanticScholar: Array.isArray(semanticScholar) && semanticScholar.length > 0,
        openCitations: Array.isArray(openCitations) && openCitations.length > 0,
        core: Array.isArray(core) && core.length > 0,
        scienceOpen: Array.isArray(scienceOpen) && scienceOpen.length > 0,
        lens: !!lensImpact
      }
    };
    if (req.query?.debug === "1") {
      result.debug = { semanticError, s2HasKey: !!(process.env.SEMANTIC_SCHOLAR_API_KEY) };
    }

    res.json(result);
  } catch (e) {
    console.error('Citation contexts error:', e);
    res.status(500).json({ error: 'Failed to fetch citation data' });
  }
});

async function findLinkedResources(doi) {
  const resources = {
    osf: null,
    datasets: [],
    code: [],
    protocols: []
  };
  
  // Check OSF
  try {
    const osfUrl = `https://api.osf.io/v2/nodes/?filter[preprint_doi]=${doi}`;
    const osfResponse = await fetch(osfUrl);
    const osfData = await osfResponse.json();
    
    if (osfData.data && osfData.data.length > 0) {
      const project = osfData.data[0];
      resources.osf = {
        id: project.id,
        title: project.attributes.title,
        description: project.attributes.description,
        url: project.links.html,
        dateCreated: project.attributes.date_created
      };
    }
  } catch (error) {
    console.error('OSF API error:', error);
  }
  
  // Check CrossRef
  try {
    const crossrefUrl = `https://api.crossref.org/works/${doi}`;
    const crossrefResponse = await fetch(crossrefUrl);
    const crossrefData = await crossrefResponse.json();
    
    if (crossrefData.message?.relation) {
      const relations = crossrefData.message.relation;
      
      // Extract supplementary materials
      if (relations['is-supplemented-by']) {
        relations['is-supplemented-by'].forEach(item => {
          if (item.id && item['id-type'] === 'doi') {
            resources.datasets.push({
              doi: item.id,
              type: 'dataset',
              source: 'crossref',
              url: `https://doi.org/${item.id}`
            });
          }
        });
      }
    }
  } catch (error) {
    console.error('CrossRef API error:', error);
  }
  
  // Check DataCite
  try {
    const dataciteUrl = `https://api.datacite.org/dois?query=relatedIdentifiers.relatedIdentifier:${doi}`;
    const dataciteResponse = await fetch(dataciteUrl);
    const dataciteData = await dataciteResponse.json();
    
    if (dataciteData.data) {
      dataciteData.data.forEach(item => {
        resources.datasets.push({
          doi: item.id,
          title: item.attributes.titles?.[0]?.title,
          type: 'dataset',
          source: 'datacite',
          url: `https://doi.org/${item.id}`,
          publisher: item.attributes.publisher
        });
      });
    }
  } catch (error) {
    console.error('DataCite API error:', error);
  }
  
  return resources;
}

function calculateReproducibilityScore(resources) {
  let score = 0;
  const breakdown = {
    hasOSF: false,
    hasData: false,
    hasCode: false,
    hasProtocols: false
  };
  
  if (resources.osf) {
    score += 40;
    breakdown.hasOSF = true;
  }
  
  if (resources.datasets.length > 0) {
    score += 30;
    breakdown.hasData = true;
  }
  
  if (resources.code.length > 0) {
    score += 30;
    breakdown.hasCode = true;
  }
  
  return {
    score,
    percentage: score,
    breakdown
  };
}

export default router;
