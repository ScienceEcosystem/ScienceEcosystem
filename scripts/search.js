// scripts/search.js
const $ = (id) => document.getElementById(id);
// Routed through our own server, not api.openalex.org directly, so the
// OpenAlex API key (raises the anonymous rate-limit ceiling) can stay
// server-side instead of being shipped to every browser. Server attaches
// the key/mailto and passes the upstream status/Retry-After through
// unchanged, so the retry logic below needs no further changes.
// Absolute (via location.origin), not a bare relative path — fetchJSON()
// below builds a real URL object out of this and a relative string isn't
// a valid base/input for that.
const API_BASE = location.origin + "/api/openalex";
const OPENALEX_MAILTO = "info@scienceecosystem.org";

/* --------------------------------------------------------------------------------
   RATE LIMIT + RETRY: prevent 429s/401s by throttling and backing off when needed
---------------------------------------------------------------------------------*/
const RATE_LIMIT_MS = 400; // one request ~ every 400ms (≈2.5 req/s) – gentle for browser clients
let lastRequestAt = 0;

async function rateLimitGate() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + RATE_LIMIT_MS - now);
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getRetryAfterSeconds(res) {
  const ra = res.headers?.get?.("Retry-After");
  const n = ra ? parseInt(ra, 10) : NaN;
  return Number.isFinite(n) ? Math.max(1, n) : null;
}

/* Robust fetch with retries for 429/5xx and gentle handling of 401 */
async function fetchJSON(url, signal, { maxRetries = 4 } = {}) {
  const u = new URL(url);
  if (!u.searchParams.has("mailto")) u.searchParams.set("mailto", OPENALEX_MAILTO);

  let attempt = 0;
  while (true) {
    await rateLimitGate();
    let res;
    try {
      res = await fetch(u.toString(), { signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (attempt++ < maxRetries) { await sleep(300 * attempt); continue; }
      throw err;
    }

    if (res.ok) return res.json();

    if (res.status === 429 && attempt < maxRetries) {
      const ra = getRetryAfterSeconds(res);
      await sleep((ra ? ra * 1000 : 500 * (attempt + 1)) + Math.floor(Math.random() * 200));
      attempt++;
      continue;
    }

    if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
      await sleep(400 * (attempt + 1));
      attempt++;
      continue;
    }

    if (res.status === 401 && attempt < maxRetries) {
      await sleep(800 * (attempt + 1));
      attempt++;
      continue;
    }

    // A 4xx here (other than the retried 401/429 above) means the query
    // itself was rejected, not "no matches" — OpenAlex's own error body
    // usually explains exactly why (e.g. invalid search syntax). Surface
    // that instead of just the status code, so callers can show the real
    // reason rather than treating this the same as zero results.
    let detail = "";
    if (res.status >= 400 && res.status < 500) {
      try { detail = (await res.json())?.message || ""; } catch (_) {}
    }
    const err = new Error(detail || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.isQueryError = res.status >= 400 && res.status < 500;
    throw err;
  }
}

// State
let currentPage = 1;
let currentQuery = "";
let currentAuthorIds = [];
let totalResults = 0;
let currentFilter = "relevance"; // relevance | citations | year
let currentOrder = "desc";       // desc | asc
let searchAbort = null;

// Facets
let facet = { oa:false, types: new Set(), yearMin:null, yearMax:null };
let advanced = {
  doi: "",
  title: "",
  author: "",
  journal: "",
  publisher: "",
  institution: "",
  funder: "",
  citedMin: null,
  hasPdf: false,
  literature: ""
};
let advancedActive = false;

// Utils
function escapeHtml(str = "") {
  return (str || "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}
function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }

function setURLState(q, sort){
  const params = new URLSearchParams(location.search);
  if (q) params.set("q", q); else params.delete("q");
  if (sort) params.set("sort", sort); else params.delete("sort");
  if (currentOrder && currentOrder !== "desc") params.set("order", currentOrder); else params.delete("order");
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function setBusy(busy){
  const region = $("resultsRegion");
  if (!region) return;
  region.setAttribute("aria-busy", busy ? "true" : "false");
}

function readAdvancedFilters() {
  advanced.doi = ($("filterDoi")?.value || "").trim();
  advanced.title = ($("filterTitle")?.value || "").trim();
  advanced.author = ($("filterAuthor")?.value || "").trim();
  advanced.journal = ($("filterJournal")?.value || "").trim();
  advanced.publisher = ($("filterPublisher")?.value || "").trim();
  advanced.institution = ($("filterInstitution")?.value || "").trim();
  advanced.funder = ($("filterFunder")?.value || "").trim();
  const cmin = parseInt(($("filterCitedMin")?.value || "").trim(), 10);
  advanced.citedMin = Number.isFinite(cmin) ? cmin : null;
  advanced.hasPdf = !!$("filterHasPdf")?.checked;
  advanced.literature = ($("filterLiterature")?.value || "").trim();
  advancedActive = !!(
    advanced.doi || advanced.title || advanced.author || advanced.journal ||
    advanced.publisher || advanced.institution || advanced.funder ||
    advanced.citedMin != null || advanced.hasPdf || advanced.literature
  );
}

function clearAdvancedFilters() {
  ["filterDoi","filterTitle","filterAuthor","filterJournal","filterPublisher","filterInstitution","filterFunder","filterCitedMin"].forEach(id=>{
    const el = $(id); if (el) el.value = "";
  });
  const lit = $("filterLiterature"); if (lit) lit.value = "";
  const hp = $("filterHasPdf"); if (hp) hp.checked = false;
  readAdvancedFilters();
}

function isDoiQuery(q) {
  const s = (q || "").trim();
  if (!s) return false;
  return /10\.\d{4,9}\/\S+/i.test(s);
}

// Extract the DOI from any string — works for bare DOIs, doi.org URLs,
// and full citation strings that contain a DOI somewhere in the text.
function extractDoi(s) {
  const str = String(s || "").trim();
  // Full URL: https://doi.org/10.xxxx/...
  const urlMatch = str.match(/https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)/i);
  if (urlMatch) return urlMatch[1].replace(/[.,;)\]]+$/, "");
  // doi: prefix
  const prefixMatch = str.match(/doi:\s*(10\.\d{4,9}\/\S+)/i);
  if (prefixMatch) return prefixMatch[1].replace(/[.,;)\]]+$/, "");
  // Bare DOI anywhere in the string
  const bareMatch = str.match(/10\.\d{4,9}\/\S+/i);
  if (bareMatch) return bareMatch[0].replace(/[.,;)\]]+$/, "");
  return "";
}

function normalizeDoi(s) {
  return String(s || "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i,"")
    .replace(/^doi:/i,"");
}

async function fetchPaperByDoi(doi, signal) {
  try {
    const clean = normalizeDoi(doi);
    if (!clean) return [];
    const url = `${API_BASE}/works?filter=doi:${encodeURIComponent(clean)}&per_page=1`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.warn("DOI fetch failed", err.message);
    return [];
  }
}

function applyAdvancedFilters(works) {
  if (!advancedActive) return works;
  const t = advanced.title.toLowerCase();
  const a = advanced.author.toLowerCase();
  const j = advanced.journal.toLowerCase();
  const p = advanced.publisher.toLowerCase();
  const inst = advanced.institution.toLowerCase();
  const f = advanced.funder.toLowerCase();
  const doiExact = normalizeDoi(advanced.doi);

  return (works || []).filter(w => {
    if (doiExact) {
      const wdoi = normalizeDoi(w.doi || w.ids?.doi || "");
      if (wdoi !== doiExact) return false;
    }
    if (t) {
      const title = (w.display_name || "").toLowerCase();
      if (!title.includes(t)) return false;
    }
    if (a) {
      const names = (w.authorships || []).map(x => x.author?.display_name || "").join(" ").toLowerCase();
      if (!names.includes(a)) return false;
    }
    if (j) {
      const venue = (w.primary_location?.source?.display_name || w.host_venue?.display_name || "").toLowerCase();
      if (!venue.includes(j)) return false;
    }
    if (p) {
      const pub = (w.host_organization_name || w.host_venue?.publisher || "").toLowerCase();
      if (!pub.includes(p)) return false;
    }
    if (inst) {
      const insts = (w.authorships || []).flatMap(x => x.institutions || []).map(i => i.display_name || "").join(" ").toLowerCase();
      if (!insts.includes(inst)) return false;
    }
    if (f) {
      const funds = (w.grants || []).map(g => g.funder?.display_name || "").join(" ").toLowerCase();
      if (!funds.includes(f)) return false;
    }
    if (advanced.citedMin != null) {
      const c = w.cited_by_count || 0;
      if (c < advanced.citedMin) return false;
    }
    if (advanced.hasPdf) {
      const hasPdf = !!(w.best_oa_location?.pdf_url || w.primary_location?.pdf_url);
      if (!hasPdf) return false;
    }
    if (advanced.literature) {
      const tpe = (w.type || "").toLowerCase();
      const src = (w.primary_location?.source?.type || w.host_venue?.type || "").toLowerCase();
      const isJournal = (src === "journal") || (tpe === "article");
      const isPreprint = (src === "repository") || (tpe === "posted-content") || (tpe === "preprint");
      const isConference = (src === "conference") || (tpe === "proceedings-article");
      const isBook = tpe.startsWith("book") || src === "book";
      const isThesis = (tpe === "dissertation") || (tpe === "thesis");
      const isReport = (tpe === "report") || (tpe === "working-paper");
      const isDataset = (tpe === "dataset");
      const isGray = isPreprint || isReport || isThesis;
      const map = {
        scholarly: isJournal,
        preprint: isPreprint,
        conference: isConference,
        book: isBook,
        thesis: isThesis,
        report: isReport,
        dataset: isDataset,
        gray: isGray
      };
      if (!map[advanced.literature]) return false;
    }
    return true;
  });
}

/* ---------- Lookups (each uses throttled, retrying fetchJSON) ---------- */
async function fetchAuthors(query, signal) {
  try {
    const url = `${API_BASE}/authors?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Author fetch failed", err.message);
    return [];
  }
}

async function fetchTopics(query, signal) {
  try {
    // 1. Direct OpenAlex concept search
    const url = `${API_BASE}/concepts?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    let results = data.results || [];

    // OpenAlex's concept search can return real but overly-specific results
    // while missing the single most obvious match — live example: searching
    // "gold" returns "Colloidal gold", "Gold mining", "Gold cluster", "Gold
    // alloys", "Gold standard (test)"... but never plain "Gold" itself
    // (confirmed directly: no exact "Gold" concept exists anywhere in
    // OpenAlex's vocabulary, checked with a 25-result display_name search).
    // Since OpenAlex DID return results here, the code used to stop and
    // never even check Wikipedia — same bug already found and fixed once in
    // topic.js's own concept resolver. Cross-check Wikipedia's canonical
    // title and prepend it (as the same Wikipedia-only stub used in the
    // zero-results fallback below) when it isn't already covered by name.
    try {
      const wpUrl = "https://en.wikipedia.org/w/api.php?action=query&list=search"
        + "&srsearch=" + encodeURIComponent(query)
        + "&srlimit=1&format=json&origin=*&srprop=snippet";
      const wpData = await fetchJSON(wpUrl, signal);
      const top = wpData?.query?.search?.[0];
      if (top?.title && !results.some(r => (r.display_name || "").toLowerCase() === top.title.toLowerCase())) {
        results = [{
          id: null,
          display_name: top.title,
          description: (top.snippet || "").replace(/<[^>]+>/g, "").slice(0, 120),
          works_count: null,
          _wikipedia_only: true,
        }, ...results].slice(0, 5);
      }
    } catch (_) {}

    if (results.length) return results;

    // 2. Wikipedia search — resolves common names, synonyms, species not in OpenAlex
    const wpUrl = "https://en.wikipedia.org/w/api.php?action=query&list=search"
      + "&srsearch=" + encodeURIComponent(query)
      + "&srlimit=5&format=json&origin=*&srprop=snippet";
    const wpData = await fetchJSON(wpUrl, signal);
    const wpResults = wpData?.query?.search || [];
    const wpTitles = wpResults.map(r => r.title).filter(Boolean);

    // 3. Try each Wikipedia title as an OpenAlex concept search
    for (const title of wpTitles) {
      if (title.toLowerCase() === query.toLowerCase()) continue;
      const altData = await fetchJSON(
        `${API_BASE}/concepts?search=${encodeURIComponent(title)}&per_page=5`, signal
      );
      if (altData.results?.length) return altData.results;
    }

    // 4. Final fallback: return Wikipedia results directly as topic stubs.
    //    topic.html already handles Wikipedia-only topics via the stub mechanism —
    //    it loads the Wikipedia article and any field data (WoC, iNaturalist) even
    //    when no OpenAlex concept exists.
    return wpResults.slice(0, 4).map(r => ({
      id: null,  // no OpenAlex ID
      display_name: r.title,
      description: (r.snippet || "").replace(/<[^>]+>/g, "").slice(0, 120),
      works_count: null,
      _wikipedia_only: true,
    }));
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Topic fetch failed", err.message);
    return [];
  }
}

async function fetchInstitutions(query, signal) {
  try {
    const url = `${API_BASE}/institutions?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Institution fetch failed", err.message);
    return [];
  }
}

async function fetchJournals(query, signal) {
  try {
    const url = `${API_BASE}/sources?search=${encodeURIComponent(query)}&filter=type:journal&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Journal fetch failed", err.message);
    return [];
  }
}

async function fetchPublishers(query, signal) {
  try {
    const url = `${API_BASE}/publishers?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Publisher fetch failed", err.message);
    return [];
  }
}

/* NEW: Funders */
async function fetchFunders(query, signal) {
  try {
    const url = `${API_BASE}/funders?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.warn("Funder fetch failed", err.message);
    return [];
  }
}

/* ---------- Filters ---------- */
function buildFilter(){
  const parts = [];
  if (facet.oa) parts.push("is_oa:true");
  if (facet.types.size) parts.push("type:" + Array.from(facet.types).join("|"));
  if (facet.yearMin) parts.push(`from_publication_date:${facet.yearMin}-01-01`);
  if (facet.yearMax) parts.push(`to_publication_date:${facet.yearMax}-12-31`);
  return parts.length ? `&filter=${encodeURIComponent(parts.join(","))}` : "";
}

function serverSortParam(){
  const dir = currentOrder === "asc" ? "asc" : "desc";
  if (currentFilter === "citations") return `&sort=cited_by_count:${dir}`;
  if (currentFilter === "year") return `&sort=publication_year:${dir}`;
  return ""; // relevance = default
}

// Citation-style query parser: "BACI Underwood 1994" → { year: 1994, search: "BACI Underwood" }
function parseCitationQuery(q) {
  const yearMatch = q.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const search = year ? q.replace(yearMatch[0], '').replace(/\s+/g, ' ').trim() : q;
  return { year, search };
}

/* ---------- Papers (authors + general query) ---------- */
// Set by fetchPapers() when OpenAlex rejects the query itself (bad syntax —
// e.g. a wildcard inside a quoted phrase, which is invalid to it) rather
// than just finding nothing. renderPapers() checks this to show the real
// reason instead of "No papers found," which was actively misleading: an
// invalid query and a genuinely empty result set rendered identically,
// so a syntax mistake looked exactly like "no such research exists."
let lastPaperSearchError = null;
// Set instead of lastPaperSearchError when the query was auto-recovered
// (see below) — a softer, informational note, not a warning, since
// nothing actually failed from the user's point of view.
let lastPaperSearchNotice = null;

// OpenAlex treats a bare ? or * as a wildcard character, not literal
// punctuation — so pasting a real paper title that happens to end in a
// question mark (not rare in science) or contain an asterisk fails with a
// syntax error, even though the user did nothing wrong. Confirmed live
// against a real title ("...Invasional Meltdown?") that exists in OpenAlex
// but couldn't be found by searching its own exact title for exactly this
// reason. Only used as a fallback retry after the literal query already
// failed — never applied up front, so intentional wildcard search syntax
// (e.g. "model*" in an advanced boolean query) still works normally.
function stripWildcardChars(str) {
  return String(str || '').replace(/[?*]/g, '').replace(/\s+/g, ' ').trim();
}

// Real wildcard support, built on top of OpenAlex rather than through it:
// OpenAlex rejects * / ? outright (see stripWildcardChars above), including
// — permanently, no server flag fixes it — a wildcard inside a quoted
// phrase. So the wildcard-stripped query goes to OpenAlex for broad,
// stemmed candidate retrieval (which already handles the AND/OR/quote
// structure natively), and this refines those candidates down to ones
// that genuinely satisfy every wildcard pattern the user actually wrote.
// * becomes "any word characters", ? becomes "one word character" —
// matched against title + abstract text, case-insensitively.
function wildcardToRegex(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).map(w => {
    // A trailing ? is overwhelmingly literal punctuation in real text — a
    // pasted title, a rhetorical-question title (confirmed live: exactly
    // this broke the "search a paper's own title" fix above before this
    // adjustment) — not a deliberate single-character wildcard. Dropped
    // rather than turned into a match requirement. A trailing/embedded *
    // and any mid-word ? are still treated as real wildcards.
    const trimmed = w.endsWith('?') ? w.slice(0, -1) : w;
    const escaped = trimmed.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
    return escaped.replace(/\\\*/g, '[\\w-]*').replace(/\\\?/g, '[\\w-]');
  }).filter(Boolean);
  return words.length ? new RegExp('\\b' + words.join('\\s+'), 'i') : null;
}

// Quoted phrases and bare words are extracted and turned into separate
// patterns — a wildcard inside quotes must match as an adjacent phrase,
// a bare wildcarded word just needs to appear anywhere.
function extractWildcardPatterns(rawQuery) {
  const raw = String(rawQuery || '');
  const patterns = [];
  raw.replace(/"([^"]+)"/g, (_, phrase) => {
    if (/[?*]/.test(phrase)) {
      const re = wildcardToRegex(phrase);
      if (re) patterns.push(re);
    }
    return '';
  });
  raw.replace(/"[^"]*"/g, ' ').split(/\s+/).forEach(tok => {
    if (/[?*]/.test(tok) && /[A-Za-z0-9]/.test(tok)) {
      const re = wildcardToRegex(tok);
      if (re) patterns.push(re);
    }
  });
  return patterns;
}

function abstractTextFrom(work) {
  const idx = work?.abstract_inverted_index;
  if (!idx || typeof idx !== 'object') return '';
  const words = [];
  Object.keys(idx).forEach(word => { (idx[word] || []).forEach(pos => { words[pos] = word; }); });
  return words.join(' ');
}

// Matches if ANY wildcard pattern the user wrote is satisfied — not a full
// boolean-tree evaluation of where each pattern sits relative to AND/OR/
// parens (OpenAlex's own de-wildcarded query already resolved the
// non-wildcard parts of that structure). Confirmed live this needs to be
// OR, not AND: multiple wildcard terms joined by OR (the common case —
// "either of these word-forms") were being wrongly required to ALL match,
// collapsing genuine results to zero. OR is the safer default either way:
// worst case for an AND-joined pair of wildcards is a slightly broader
// result set, not real matches silently disappearing.
function matchesAnyWildcardPattern(work, patterns) {
  if (!patterns.length) return true;
  const text = `${work?.display_name || ''} ${abstractTextFrom(work)}`;
  return patterns.some(re => re.test(text));
}

async function fetchPapers(query, authorIds = [], page = 1, signal) {
  let works = [];
  lastPaperSearchError = null;
  lastPaperSearchNotice = null;
  try {
    // Parse citation-style queries: extract year so it becomes a filter not a search term
    const { year: queryYear, search: querySearch } = parseCitationQuery(query);
    const yearFilter = queryYear ? `,publication_year:${queryYear}` : '';
    const baseFilter = buildFilter();
    // Combine extracted year with any facet filters already active
    const combinedFilter = baseFilter
      ? baseFilter + encodeURIComponent(yearFilter)
      : (yearFilter ? `&filter=${encodeURIComponent(yearFilter.slice(1))}` : '');

    for (const authorId of authorIds) {
      const urlA = `${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}${baseFilter}&per_page=100&page=${page}${serverSortParam()}`;
      const dataA = await fetchJSON(urlA, signal);
      works = works.concat(dataA.results || []);
    }

    // Primary: relevance search with year filter applied
    let effectiveSearch = querySearch;
    const urlG = `${API_BASE}/works?search=${encodeURIComponent(effectiveSearch)}${combinedFilter}&per_page=100&page=${page}${serverSortParam()}`;
    let dataG;
    try {
      dataG = await fetchJSON(urlG, signal);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      const stripped = stripWildcardChars(querySearch);
      if (err.isQueryError && /wildcard/i.test(err.message) && stripped && stripped !== querySearch) {
        effectiveSearch = stripped;
        const urlRetry = `${API_BASE}/works?search=${encodeURIComponent(effectiveSearch)}${combinedFilter}&per_page=100&page=${page}${serverSortParam()}`;
        dataG = await fetchJSON(urlRetry, signal);
        lastPaperSearchNotice = `Searched for "${effectiveSearch}" — ? and * are treated as wildcard characters, not literal punctuation, so they were dropped from your query.`;
      } else {
        throw err;
      }
    }
    const generalWorks = dataG.results || [];

    // Secondary: title-specific search — catches papers where the query terms
    // appear in the title itself, which OpenAlex's general `search=` full-text
    // ranking under-weights relative to Google Scholar (it can rank a paper
    // with loose abstract mentions above one whose title is an exact match).
    let titleWorks = [];
    if (effectiveSearch) {
      try {
        const titleYearFilter = queryYear ? `,publication_year:${queryYear}` : '';
        // host_venue is a deprecated field OpenAlex no longer accepts in
        // select= (confirmed live: a 400 was silently swallowed by the
        // catch below, breaking this whole secondary query) — primary_
        // location.source is the current, valid replacement, already here.
        const urlT = `${API_BASE}/works?filter=display_name.search:${encodeURIComponent(effectiveSearch)}${titleYearFilter}&per_page=25&select=id,display_name,authorships,publication_year,doi,open_access,cited_by_count,primary_location,type`;
        const dataT = await fetchJSON(urlT, signal);
        titleWorks = dataT.results || [];
      } catch(_) {}
    }

    if (page === 1) totalResults = dataG.meta?.count || generalWorks.length || 0;

    // Title matches bubble to front, then general results
    const seen = new Set();
    let merged = [...titleWorks, ...works, ...generalWorks].filter(w => {
      const id = w.id || w.doi || w.display_name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    merged = applyAdvancedFilters(merged);

    // Real wildcard matching, refined on top of whatever OpenAlex's own
    // (de-wildcarded) query already found — see matchesAnyWildcardPattern.
    const wildcardPatterns = extractWildcardPatterns(query);
    if (wildcardPatterns.length) {
      const beforeCount = merged.length;
      merged = merged.filter(w => matchesAnyWildcardPattern(w, wildcardPatterns));
      lastPaperSearchNotice = `Showing ${merged.length} result${merged.length === 1 ? '' : 's'} that actually match your wildcard pattern, out of ${beforeCount} broader candidates OpenAlex returned for "${effectiveSearch}" — OpenAlex itself can't run wildcard search, so this checks each candidate's title/abstract text ourselves. Matches beyond what OpenAlex returned for the plain query aren't checked.`;
    }

    if ((advancedActive || wildcardPatterns.length) && page === 1) totalResults = merged.length;

    if (currentFilter === "citations") {
      merged.sort((a,b)=> {
        const diff = (b.cited_by_count||0)-(a.cited_by_count||0);
        return currentOrder === "asc" ? -diff : diff;
      });
    } else if (currentFilter === "year") {
      merged.sort((a,b)=> {
        const diff = (b.publication_year||0)-(a.publication_year||0);
        return currentOrder === "asc" ? -diff : diff;
      });
    }

    return merged;
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Paper fetch failed", err);
      if (err.isQueryError) lastPaperSearchError = err.message;
    }
    return [];
  }
}

/* ---------- Render helpers ---------- */
function provenanceChips(w) {
  const doi = w.doi ? `https://doi.org/${encodeURIComponent(w.doi)}` : null;
  const oaUrl = w.open_access?.oa_url || w.primary_location?.pdf_url || null;
  const venueUrl = w.primary_location?.source?.homepage_url || w.primary_location?.landing_page_url || null;

  const parts = [];
  if (doi) parts.push(`<a class="badge" href="${doi}" target="_blank" rel="noopener">DOI</a>`);
  if (oaUrl) parts.push(`<a class="badge badge-oa" href="${oaUrl}" target="_blank" rel="noopener">Open access</a>`);
  if (venueUrl) parts.push(`<a class="badge" href="${venueUrl}" target="_blank" rel="noopener">Source</a>`);
  return parts.join(" ");
}

function fallbackPaperCard(w){
  const title = escapeHtml(w.display_name || "Untitled");
  const year = w.publication_year ? ` (${w.publication_year})` : "";
  const venue = w.primary_location?.source?.display_name || w.host_venue?.display_name || "";
  const authors = (w.authorships||[]).map(a=>a.author?.display_name).filter(Boolean).slice(0,6).join(", ");
  const id = (w.id||"").split("/").pop();
  return `
    <article class="result-card">
      <h3 class="result-title"><a href="paper.html?id=${encodeURIComponent(id)}">${title}</a>${year}</h3>
      <p class="muted">${escapeHtml(authors)}${authors && venue ? " - " : ""}${escapeHtml(venue)}</p>
      <p class="chips">${provenanceChips(w)}</p>
    </article>
  `;
}

const BOOL_OPS = new Set(["AND","OR","NOT"]);
function highlight(text, q){
  if (!text || !q) return escapeHtml(text||"");
  const terms = q.replace(/[()]/g," ").split(/\s+/).filter(t=>t && !BOOL_OPS.has(t) && !/^".*"$/.test(t)).map(t=>t.replace(/^"|"$/g,"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).filter(Boolean);
  if (!terms.length) return escapeHtml(text);
  const re = new RegExp("(" + terms.join("|") + ")", "ig");
  return escapeHtml(text).replace(re, "<mark>$1</mark>");
}

// Sidebar renders
function renderAuthors(authors) {
  const el = $("researcherList");
  if (!el) return;
  el.innerHTML = authors.length
    ? authors.map(a => {
        const id = a.id.split("/").pop();
        const inst =
          a.last_known_institution?.display_name ||
          a.last_known_institutions?.[0]?.display_name ||
          "No affiliation";
        return `
          <li class="list-item-wrap">
            <div class="list-item list-card" onclick="location.href='profile.html?id=${id}'" tabindex="0" role="button">
              <div class="title">${escapeHtml(a.display_name)}</div>
              <div class="muted">${escapeHtml(inst)}</div>
            </div>
          </li>
        `;
      }).join("")
    : `<li class="muted">No authors found.</li>`;
}

function renderTopics(topics) {
  const el = $("topicList");
  if (!el) return;
  el.innerHTML = topics.length
    ? topics.map(t => {
        // OpenAlex topics use their concept ID; Wikipedia-only topics use the display name as slug
        const id = t.id ? t.id.split("/").pop() : t.display_name.replace(/ /g, "_");
        const sub = t.description
          ? `<div class="muted" style="font-size:.8rem;margin-top:.1rem;">${escapeHtml(t.description.slice(0, 100))}</div>`
          : "";
        const badge = t._wikipedia_only
          ? `<span style="font-size:.7rem;color:#6b7280;margin-left:.4rem;">Wikipedia</span>`
          : "";
        return `
          <li class="list-item-wrap">
            <div class="list-item list-card" onclick="location.href='topic.html?id=${encodeURIComponent(id)}'" tabindex="0" role="button">
              <div>${escapeHtml(t.display_name)}${badge}</div>${sub}
            </div>
          </li>
        `;
      }).join("")
    : `<li class="muted">No topics found.</li>`;
}

function renderInstitutions(items) {
  const el = $("institutionList");
  if (!el) return;
  el.innerHTML = items.length
    ? items.map(inst => {
        const id = inst.id.split("/").pop();
        const country = inst.country_code ? inst.country_code.toUpperCase() : null;
        const works = Number.isFinite(inst.works_count) ? `${inst.works_count.toLocaleString()} works` : null;
        const sub = [country, works].filter(Boolean).join(" · ") || "-";
        return `
          <li class="list-item-wrap">
            <div class="list-item list-card" onclick="location.href='institute.html?id=${encodeURIComponent(id)}'" tabindex="0" role="button">
              <div class="title">${escapeHtml(inst.display_name)}</div>
              <div class="muted">${escapeHtml(sub)}</div>
            </div>
          </li>
        `;
      }).join("")
    : `<li class="muted">No institutions found.</li>`;
}

function renderJournals(items) {
  const el = $("journalList");
  if (!el) return;
  el.innerHTML = items.length
    ? items.map(j => {
        const srcId = j.id.split("/").pop();
        const abbrev = j.abbreviated_title || null;
        const works = Number.isFinite(j.works_count) ? `${j.works_count.toLocaleString()} works` : null;
        const pubIdFull = j.host_organization || null;
        const pubId = pubIdFull ? pubIdFull.split("/").pop() : null;
        const pubName = j.host_organization_name || j.host_organization_lineage?.[0]?.display_name || null;
        const subLeft = [abbrev, works].filter(Boolean).join(" · ") || "Journal";
        const pubLink = (pubId && pubName)
          ? `<a href="publisher.html?id=${encodeURIComponent(pubId)}" class="muted" onclick="event.stopPropagation();" aria-label="Go to publisher ${escapeHtml(pubName)}">Publisher: ${escapeHtml(pubName)}</a>`
          : `<span class="muted">Publisher: ${escapeHtml(pubName || "Unknown")}</span>`;

        return `
          <li class="list-item-wrap">
            <div class="list-item list-card" onclick="location.href='journal.html?id=${encodeURIComponent(srcId)}'" tabindex="0" role="button">
              <div class="title">${escapeHtml(j.display_name)}</div>
              <div class="muted">${escapeHtml(subLeft)}</div>
              <div>${pubLink}</div>
            </div>
          </li>
        `;
      }).join("")
    : `<li class="muted">No journals found.</li>`;
}

function renderPublishers(items) {
  const el = $("publisherList");
  if (!el) return;
  el.innerHTML = items.length
    ? items.map(p => {
        const id = p.id.split("/").pop();
        const works = Number.isFinite(p.works_count) ? `${p.works_count.toLocaleString()} works` : null;
        const sources = Number.isFinite(p.sources_count) ? `${p.sources_count.toLocaleString()} sources` : null;
        const sub = [works, sources].filter(Boolean).join(" · ") || "Publisher";
        return `
          <li class="list-item-wrap">
            <div class="list-item list-card" onclick="location.href='publisher.html?id=${encodeURIComponent(id)}'" tabindex="0" role="button">
              <div class="title">${escapeHtml(p.display_name)}</div>
              <div class="muted">${escapeHtml(sub)}</div>
            </div>
          </li>
        `;
      }).join("")
    : `<li class="muted">No publishers found.</li>`;
}

/* NEW: Funders renderer */
function renderFunders(items) {
  const el = $("funders-list");
  if (!el) return;
  el.innerHTML = items.length
    ? items.map(f => {
        const id = f.id.split("/").pop(); // e.g., F4320301738
        const country = f.country_code ? f.country_code.toUpperCase() : null;
        const ftype = f.type || null;
        const works = Number.isFinite(f.works_count) ? `${f.works_count.toLocaleString()} works` : null;
        const sub = [country, ftype, works].filter(Boolean).join(" · ") || "Funder";
        return `
          <li class="list-item-wrap">
            <div class="list-item list-card" onclick="location.href='funders.html?id=${id}'" tabindex="0" role="button">
              <div class="title">${escapeHtml(f.display_name)}</div>
              <div class="muted">${escapeHtml(sub)}</div>
            </div>
          </li>
        `;
      }).join("")
    : `<li class="muted">No funders found.</li>`;
}

function skeletonBlock(){
  return `
    <div class="result-card">
      <div class="skel skel-title"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line" style="width:60%"></div>
    </div>
    <div class="result-card">
      <div class="skel skel-title"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line"></div>
      <div class="skel skel-line" style="width:50%"></div>
    </div>`;
}

// Shows the skeleton immediately, same as before, but if it's still sitting
// there 5s later — e.g. mid OpenAlex retry/backoff under real rate-limiting —
// adds one muted line saying so. A bare skeleton reads as "loading" for a
// couple seconds and "broken" past that; this is the difference between the
// two without needing the caller to know anything retried. Self-cleans:
// renderPapers() below replaces `el`'s entire innerHTML once results are in,
// which removes the hint along with the skeleton — no manual clearing needed
// on the success path, only guarded here against a stale timer firing late.
function showSkeleton(el) {
  el.innerHTML = skeletonBlock();
  clearTimeout(el._skelHintTimer);
  el._skelHintTimer = setTimeout(() => {
    if (!el.querySelector(".skel")) return; // real content already rendered
    const hint = document.createElement("p");
    hint.className = "muted skel-retry-hint";
    hint.textContent = "Taking longer than usual — retrying…";
    el.appendChild(hint);
  }, 5000);
}

/* ----------- SAFE paper rendering ----------- */
function renderPapers(works, append = false) {
  const results = $("unifiedSearchResults");
  if (!results) return;

  if (!append) {
    results.innerHTML = `
      <h2 style="display:flex; align-items:center; justify-content:space-between; gap:.75rem;">
        <span>Papers <span class="muted">(${totalResults.toLocaleString()})</span></span>
        <div id="filters" style="display:flex; align-items:center; gap:.75rem; flex-wrap:wrap;">
          <label>Sort by:
            <select id="paperFilter" onchange="changeFilter(this.value)">
              <option value="relevance"${currentFilter==='relevance'?' selected':''}>Relevance</option>
              <option value="citations"${currentFilter==='citations'?' selected':''}>Citations</option>
              <option value="year"${currentFilter==='year'?' selected':''}>Year</option>
            </select>
          </label>
          <label>Order:
            <select id="orderFilter" onchange="changeOrder(this.value)">
              <option value="desc"${currentOrder==='desc'?' selected':''}>High to low / Newest</option>
              <option value="asc"${currentOrder==='asc'?' selected':''}>Low to high / Oldest</option>
            </select>
          </label>
          <div class="chips" id="facetChips" role="group" aria-label="Filters">
            <button class="chip${facet.oa?' active':''}" data-facet="oa" aria-pressed="${facet.oa}">Open access</button>
            <button class="chip${facet.types.has('article')?' active':''}" data-facet="type-article" aria-pressed="${facet.types.has('article')}">Articles</button>
            <button class="chip${facet.types.has('posted-content')?' active':''}" data-facet="type-preprint" aria-pressed="${facet.types.has('posted-content')}">Preprints</button>
            <input type="number" id="yearMin" class="input" placeholder="From year" style="width:120px; padding:.4rem .6rem; font-size:.9rem;" value="${facet.yearMin??''}" aria-label="From year">
            <input type="number" id="yearMax" class="input" placeholder="To year" style="width:120px; padding:.4rem .6rem; font-size:.9rem;" value="${facet.yearMax??''}" aria-label="To year">
            <button class="btn btn-secondary" id="applyYears" title="Apply year range">Apply</button>
          </div>
        </div>
      </h2>
      ${lastPaperSearchNotice ? `<p class="muted" style="font-size:.85rem;">ℹ ${escapeHtml(lastPaperSearchNotice)}</p>` : ""}
      <div id="papersList"></div>
      <div id="pagination"></div>
    `;
  }

  const papersList = $("papersList");
  if (!papersList) return;

  if (!works || works.length === 0) {
    papersList.innerHTML = lastPaperSearchError
      ? `<p class="muted">⚠ Search couldn't run as written: ${escapeHtml(lastPaperSearchError)}</p>`
      : `<p class="muted">No papers found for this search.</p>`;
    return;
  }

  for (const w of works) {
    try {
      const cardHtml = (window.SE && SE.components && typeof SE.components.renderPaperCard === "function")
        ? SE.components.renderPaperCard(w, { compact: true, highlightQuery: currentQuery })
        : fallbackPaperCard(w);
      papersList.insertAdjacentHTML("beforeend", cardHtml);
    } catch (err) {
      console.warn("renderPaperCard failed, using fallback:", err);
      papersList.insertAdjacentHTML("beforeend", fallbackPaperCard(w));
    }
  }

  try {
    if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
      SE.components.enhancePaperCards(papersList);
    }
  } catch (err) {
    console.warn("enhancePaperCards failed:", err);
  }

  const pagination = $("pagination");
  const resultsShown = currentPage * 100;
  if (pagination) {
    if (advancedActive) {
      pagination.innerHTML = `<p class="muted">Advanced filters applied to current page results.</p>`;
      return;
    }
    if (resultsShown < totalResults) {
      pagination.innerHTML = `<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>`;
      const loadMoreBtn = $("loadMoreBtn");
      let loadingMore = false;

      async function loadMore(){
        if (loadingMore) return;
        loadingMore = true;
        loadMoreBtn.disabled = true;
        currentPage++;
        const more = await fetchPapers(currentQuery, currentAuthorIds, currentPage, searchAbort?.signal);
        renderPapers(more, true);
        loadMoreBtn.disabled = false;
        loadingMore = false;
      }

      loadMoreBtn.onclick = loadMore;

      const io = new IntersectionObserver(async (entries)=>{
        if (entries.some(e=>e.isIntersecting)) { await loadMore(); }
      }, { rootMargin: "600px" });
      io.observe(loadMoreBtn);
    } else {
      pagination.innerHTML = `<p class="muted">All results loaded.</p>`;
    }
  }

  const chips = document.getElementById("facetChips");
  if (chips) {
    chips.onclick = (e)=>{
      const c = e.target.closest(".chip");
      if (!c) return;
      const f = c.getAttribute("data-facet");
      if (f==="oa") facet.oa = !facet.oa;
      if (f==="type-article") toggleType("article");
      if (f==="type-preprint") toggleType("posted-content");
      c.classList.toggle("active");
      c.setAttribute("aria-pressed", c.classList.contains("active") ? "true" : "false");
      handleUnifiedSearch(true);
    };
    const applyBtn = $("applyYears");
    if (applyBtn) applyBtn.onclick = ()=>{
      const yMin = parseInt(($("yearMin")?.value||"").trim(),10);
      const yMax = parseInt(($("yearMax")?.value||"").trim(),10);
      facet.yearMin = Number.isFinite(yMin) ? yMin : null;
      facet.yearMax = Number.isFinite(yMax) ? yMax : null;
      handleUnifiedSearch(true);
    };
  }
}

function toggleType(t){ if (facet.types.has(t)) facet.types.delete(t); else facet.types.add(t); }

/* ---------- Filters ---------- */
function changeFilter(filter) {
  currentFilter = filter;
  setURLState(currentQuery, currentFilter);
  handleUnifiedSearch(true);
}
function changeOrder(order){
  currentOrder = (order === "asc" ? "asc" : "desc");
  setURLState(currentQuery, currentFilter);
  handleUnifiedSearch(true);
}

/* ---------- Unified search flow (papers FIRST, sidebars AFTER) ---------- */
const debouncedUnified = debounce(runUnifiedSearch, 300);

async function handleUnifiedSearch(skipDebounce=false) {
  if (skipDebounce) return runUnifiedSearch();
  return debouncedUnified();
}

async function runUnifiedSearch(){
  const input = $("unifiedSearchInput");
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;

  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();

  readAdvancedFilters();
  currentQuery = query;
  currentPage = 1;
  setURLState(currentQuery, currentFilter);

  const results = $("unifiedSearchResults");
  const rList = $("researcherList");
  const tList = $("topicList");
  const iList = $("institutionList");
  const jList = $("journalList");
  const pList = $("publisherList");
  const fList = $("funders-list");

  if (results) showSkeleton(results);
  if (rList) rList.innerHTML = `<li class="muted">Loading authors...</li>`;
  if (tList) tList.innerHTML = `<li class="muted">Loading topics...</li>`;
  if (iList) iList.innerHTML = `<li class="muted">Loading institutions...</li>`;
  if (jList) jList.innerHTML = `<li class="muted">Loading journals...</li>`;
  if (pList) pList.innerHTML = `<li class="muted">Loading publishers...</li>`;
  if (fList) fList.innerHTML = `<li class="muted">Loading funders...</li>`;
  setBusy(true);

  try {
    const doiOverride = advanced.doi || (isDoiQuery(query) ? extractDoi(query) : "");
    if (doiOverride) {
      const papers = await fetchPaperByDoi(doiOverride, searchAbort.signal);
      totalResults = papers.length;
      renderPapers(papers);
      // If the paper was found, show its authors in the sidebar
      if (papers.length && papers[0].authorships?.length) {
        const paperAuthors = papers[0].authorships
          .map(a => a.author)
          .filter(a => a?.id)
          .slice(0, 5);
        renderAuthors(paperAuthors);
      } else if (rList) {
        rList.innerHTML = `<li class="muted">No authors found.</li>`;
      }
      if (tList) tList.innerHTML = `<li class="muted">-</li>`;
      if (iList) iList.innerHTML = `<li class="muted">-</li>`;
      if (jList) jList.innerHTML = `<li class="muted">-</li>`;
      if (pList) pList.innerHTML = `<li class="muted">-</li>`;
      if (fList) fList.innerHTML = `<li class="muted">-</li>`;
      return;
    }

    // 1) Authors (for bias) → Papers
    const authors = await fetchAuthors(query, searchAbort.signal);
    renderAuthors(authors);
    currentAuthorIds = authors.map(a => a.id);

    const papers = await fetchPapers(query, currentAuthorIds, currentPage, searchAbort.signal);
    renderPapers(papers);

    // 2) The rest - sequential to avoid burst 429s
    const topics = await fetchTopics(query, searchAbort.signal);
    renderTopics(topics);

    const institutions = await fetchInstitutions(query, searchAbort.signal);
    renderInstitutions(institutions);

    const journals = await fetchJournals(query, searchAbort.signal);
    renderJournals(journals);

    const publishers = await fetchPublishers(query, searchAbort.signal);
    renderPublishers(publishers);

    const funders = await fetchFunders(query, searchAbort.signal);
    renderFunders(funders);

  } catch (e) {
    if (e.name === "AbortError") return;
    if (results) results.innerHTML = `<p class="error">Couldn’t load results. Please try again.</p>`;
  } finally {
    setBusy(false);
  }
}

/* ---------- Redirect from nav search box ---------- */
function handleSearch(inputId) {
  const input = $(inputId);
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;
  window.location.href = `search.html?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(currentFilter)}&order=${encodeURIComponent(currentOrder)}`;
}

/* ---------- Init ---------- */
const SEARCH_STATE_KEY = "se_search_state";

function saveSearchState() {
  try {
    sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify({
      q: currentQuery,
      filter: currentFilter,
      order: currentOrder,
      facet: { oa: facet.oa, types: Array.from(facet.types), yearMin: facet.yearMin, yearMax: facet.yearMax },
      page: currentPage
    }));
  } catch(_) {}
}

function restoreSearchState() {
  try {
    const raw = sessionStorage.getItem(SEARCH_STATE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (s.q) currentQuery = s.q;
    if (s.filter) currentFilter = s.filter;
    if (s.order) currentOrder = s.order;
    if (s.facet) {
      facet.oa = !!s.facet.oa;
      facet.types = new Set(Array.isArray(s.facet.types) ? s.facet.types : []);
      facet.yearMin = s.facet.yearMin || null;
      facet.yearMax = s.facet.yearMax || null;
    }
    if (s.page) currentPage = s.page;
    return true;
  } catch(_) { return false; }
}

/* ---------- Query builder: concept groups → real boolean/wildcard query ----------
   Terms in the same group are OR'd; groups are AND'd. Assembles the exact
   syntax the search box already accepts (quoted phrases, AND/OR, trailing
   * for word variations) so a user never has to hand-type parens/quotes —
   this is purely a query-string generator, the actual search still runs
   through the normal runUnifiedSearch()/fetchPapers() pipeline (wildcard
   filtering included) once built. */
function queryTermRowHtml() {
  return `
    <div class="query-term-row" style="display:flex; gap:.4rem; align-items:center; margin-bottom:.4rem;">
      <input type="text" class="input query-term-input" placeholder="term or phrase" style="flex:1; padding:.35rem .5rem; font-size:.85rem;">
      <label style="display:flex; align-items:center; gap:.25rem; font-size:.75rem; color:#475569; white-space:nowrap;">
        <input type="checkbox" class="query-term-wildcard"> match variations
      </label>
      <button type="button" class="query-term-remove btn-icon" title="Remove term" style="border:none; background:none; color:#94a3b8; cursor:pointer; font-size:1rem; line-height:1; padding:0 .25rem;">×</button>
    </div>`;
}

function addQueryTerm(groupBody) {
  groupBody.insertAdjacentHTML("beforeend", queryTermRowHtml());
  wireQueryTermRemove(groupBody);
}

function wireQueryTermRemove(groupBody) {
  groupBody.querySelectorAll(".query-term-remove").forEach(btn => {
    btn.onclick = () => {
      // Never remove the last term in a group — a group needs at least
      // one input to mean anything; clearing its text is how you empty it.
      if (groupBody.querySelectorAll(".query-term-row").length > 1) {
        btn.closest(".query-term-row")?.remove();
      }
    };
  });
}

function addQueryGroup() {
  const container = $("queryGroups");
  if (!container) return;
  const isFirst = container.children.length === 0;
  const group = document.createElement("div");
  group.className = "query-group";
  group.style.cssText = "margin-bottom:.6rem; padding:.6rem; background:#fff; border:1px solid #e2e8f0; border-radius:6px;";
  group.innerHTML = `
    ${isFirst ? "" : '<p class="muted" style="margin:0 0 .4rem; font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em;">AND</p>'}
    <div class="query-group-body"></div>
    <button type="button" class="query-group-add-term btn-secondary btn-xs" style="margin-top:.2rem;">+ Add OR term</button>
  `;
  container.appendChild(group);
  const body = group.querySelector(".query-group-body");
  addQueryTerm(body);
  group.querySelector(".query-group-add-term").addEventListener("click", () => addQueryTerm(body));
}

// A single-word term needs no quotes; a multi-word term is wrapped as a
// phrase (adjacency, not "any of these words") since that's what writing
// several words together normally means. Wildcard appends * before the
// closing quote (or directly, for a bare single word).
function formatQueryTerm(text, wildcard) {
  const t = text.trim();
  if (!t) return "";
  const withWildcard = wildcard ? `${t}*` : t;
  return /\s/.test(t) ? `"${withWildcard}"` : withWildcard;
}

function buildQueryFromGroups() {
  const groups = Array.from(document.querySelectorAll(".query-group")).map(group => {
    const terms = Array.from(group.querySelectorAll(".query-term-row"))
      .map(row => formatQueryTerm(
        row.querySelector(".query-term-input")?.value || "",
        !!row.querySelector(".query-term-wildcard")?.checked
      ))
      .filter(Boolean);
    if (!terms.length) return "";
    return terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0];
  }).filter(Boolean);
  return groups.join(" AND ");
}

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const input = $("unifiedSearchInput");

  const pf = $("paperFilter");
  if (params.has("sort")) {
    const s = params.get("sort");
    if (["relevance","citations","year"].includes(s)) currentFilter = s;
  }
  const of = $("orderFilter");
  if (params.has("order")) {
    const o = params.get("order");
    if (["asc","desc"].includes(o)) currentOrder = o;
  }

  // Restore state when navigating back from a paper page
  const fromPaper = document.referrer && document.referrer.includes("paper.html");
  const hasQuery  = params.has("q");
  if (!hasQuery && fromPaper) {
    const restored = restoreSearchState();
    if (restored && currentQuery) {
      if (input) input.value = currentQuery;
      if (pf) pf.value = currentFilter;
      if (of) of.value = currentOrder;
      handleUnifiedSearch(false);
      return;
    }
  }

  if (pf) pf.value = currentFilter;
  if (of) of.value = currentOrder;

  if (params.has("q") && input) {
    input.value = params.get("q") || "";
    handleUnifiedSearch(true);
  }

  if (input) {
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleUnifiedSearch(true);
      }
    });
  }

  // Save state before leaving for a paper
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href*="paper.html"]');
    if (link) saveSearchState();
  });

  $("applyAdvancedFilters")?.addEventListener("click", () => handleUnifiedSearch(true));
  $("clearAdvancedFilters")?.addEventListener("click", () => { clearAdvancedFilters(); handleUnifiedSearch(true); });

  // Query builder
  if ($("queryGroups")) {
    addQueryGroup();
    $("addQueryGroup")?.addEventListener("click", addQueryGroup);
    const preview = $("queryBuilderPreview");
    const updatePreview = () => { if (preview) preview.textContent = buildQueryFromGroups(); };
    $("queryGroups").addEventListener("input", updatePreview);
    $("queryGroups").addEventListener("change", updatePreview);
    updatePreview();
    $("runQueryBuilder")?.addEventListener("click", () => {
      const built = buildQueryFromGroups();
      if (!built) return;
      const searchInput = $("unifiedSearchInput");
      if (searchInput) searchInput.value = built;
      handleUnifiedSearch(true);
    });
  }
});

// Expose highlight to components (optional)
window.SE = window.SE || {};
window.SE.search = window.SE.search || {};
window.SE.search.highlight = highlight;
