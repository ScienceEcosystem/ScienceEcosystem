// scripts/search.js
const $ = (id) => document.getElementById(id);
const API_BASE = "https://api.openalex.org";
const OPENALEX_MAILTO = "info@scienceecosystem.org";

// State
let currentPage = 1;
let currentQuery = "";
let currentAuthorIds = [];
let totalResults = 0;
let currentFilter = "relevance"; // relevance | citations | year
let searchAbort = null;

// Facets
let facet = { oa:false, types: new Set(), yearMin:null, yearMax:null };

// Utils
function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }

function setURLState(q, sort){
  const params = new URLSearchParams(location.search);
  if (q) params.set("q", q); else params.delete("q");
  if (sort) params.set("sort", sort); else params.delete("sort");
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function setBusy(busy){
  const region = $("resultsRegion");
  if (!region) return;
  region.setAttribute("aria-busy", busy ? "true" : "false");
}

/* ---------- Fetch helpers with Abort + polite mailto ---------- */
async function fetchJSON(url, signal){
  const u = new URL(url);
  if (!u.searchParams.has("mailto")) u.searchParams.set("mailto", OPENALEX_MAILTO);
  const res = await fetch(u.toString(), { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ---------- Entity fetchers ---------- */
async function fetchAuthors(query, signal) {
  try {
    const url = `${API_BASE}/authors?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.error("Author fetch failed", err);
    return [];
  }
}

function buildFilter(){
  const parts = [];
  if (facet.oa) parts.push("is_oa:true");
  if (facet.types.size) parts.push("type:" + Array.from(facet.types).join("|"));
  if (facet.yearMin) parts.push(`from_publication_date:${facet.yearMin}-01-01`);
  if (facet.yearMax) parts.push(`to_publication_date:${facet.yearMax}-12-31`);
  return parts.length ? `&filter=${encodeURIComponent(parts.join(","))}` : "";
}

function serverSortParam(){
  if (currentFilter === "citations") return "&sort=cited_by_count:desc";
  if (currentFilter === "year") return "&sort=publication_year:desc";
  return ""; // relevance = default
}

/* ---------- Citation & intent parsing ---------- */
function extractDOI(q) {
  if (!q) return null;
  const s = q.trim();
  const m = s.match(/(?:10\.\d{4,9}\/[^\s"<>]+)|(?:doi\.org\/(10\.\d{4,9}\/[^\s"<>]+))/i);
  if (!m) return null;
  return m[1] ? m[1] : m[0].replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

function extractArXiv(q){
  if (!q) return null;
  const m = q.match(/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)|arxiv:([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/i);
  if (!m) return null;
  return m[1] || m[2];
}

function extractLikelyTitle(q){
  if (!q) return null;
  const quoted = q.match(/"([^"]{6,})"|“([^”]{6,})”/);
  if (quoted) return (quoted[1] || quoted[2]).trim();
  const yr = q.match(/\b(19|20)\d{2}\b/);
  if (yr) {
    const after = q.split(yr[0]).pop();
    if (after) {
      const cleaned = after
        .replace(/[\.\(\)\[\]]/g, " ")
        .replace(/\bVol\.?\s*\d+.*$/i, "")
        .replace(/\bpp?\.\s*\d+.*$/i, "")
        .replace(/\bdoi:.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned.length >= 6) return cleaned;
    }
  }
  if (q.length > 20) {
    const slice = q.replace(/\s+/g, " ").trim();
    return slice.length > 120 ? slice.slice(0, 120) : slice;
  }
  return null;
}

// journal:, source:, issn:, institution:, inst:, ror:, publisher:, author:, orcid:
function parseIntent(qRaw){
  const q = (qRaw || "").trim();
  const lower = q.toLowerCase();

  const doi = extractDOI(q);
  const arx = extractArXiv(q);
  if (doi || arx) {
    return { kind: "citation", doi, arx, title: null, raw: q };
  }
  if ((q.match(/,/g)||[]).length >= 2 && /\b(19|20)\d{2}\b/.test(q)) {
    const title = extractLikelyTitle(q);
    if (title) return { kind: "citation", doi: null, arx: null, title, raw: q };
  }

  const prefix = (p)=> lower.startsWith(p);
  const after = (p)=> q.slice(p.length).trim();

  if (prefix("journal:") || prefix("source:")) return { kind:"journal", query: after(prefix("journal:") ? "journal:" : "source:"), raw:q };
  if (prefix("issn:")) return { kind:"journal", issn: after("issn:"), raw:q };

  if (prefix("institution:") || prefix("inst:")) return { kind:"institution", query: after(prefix("institution:") ? "institution:" : "inst:"), raw:q };
  if (prefix("ror:")) return { kind:"institution", ror: after("ror:"), raw:q };

  if (prefix("publisher:")) return { kind:"publisher", query: after("publisher:"), raw:q };

  if (prefix("author:")) return { kind:"author", query: after("author:"), raw:q };
  if (prefix("orcid:")) return { kind:"author", orcid: after("orcid:"), raw:q };

  return { kind:"auto", query:q };
}

/* ---------- Works (papers) ---------- */
async function fetchPapers(query, authorIds = [], page = 1, signal, citationIntent = null) {
  let works = [];
  try {
    // Precise citation resolution if present
    if (citationIntent) {
      if (citationIntent.doi) {
        const url = `${API_BASE}/works?filter=${encodeURIComponent("doi:" + citationIntent.doi)}${buildFilter()}&per_page=25&page=${page}${serverSortParam()}`;
        const data = await fetchJSON(url, signal);
        const w = data.results || [];
        if (w.length) return w;
      }
      if (citationIntent.arx) {
        const url = `${API_BASE}/works?filter=${encodeURIComponent("host_venue.id:arXiv,primary_location.source.host_venue.id:arXiv")}&search=${encodeURIComponent(citationIntent.arx)}${buildFilter()}&per_page=25&page=${page}${serverSortParam()}`;
        const data = await fetchJSON(url, signal);
        const w = data.results || [];
        if (w.length) return w;
      }
      if (citationIntent.title) {
        const urlT = `${API_BASE}/works?search=${encodeURIComponent(citationIntent.title)}${buildFilter()}&per_page=25&page=${page}${serverSortParam()}`;
        const dataT = await fetchJSON(urlT, signal);
        const resultsT = (dataT.results || []).sort((a,b)=>{
          const at = (a.display_name||"").toLowerCase();
          const bt = (b.display_name||"").toLowerCase();
          const tt = citationIntent.title.toLowerCase();
          const as = at.startsWith(tt) ? -1 : 0;
          const bs = bt.startsWith(tt) ? -1 : 0;
          if (as !== bs) return as - bs;
          return (b.publication_year||0) - (a.publication_year||0);
        });
        if (resultsT.length) return resultsT;
      }
    }

    // Author-constrained works (merge)
    for (const authorId of authorIds) {
      const urlA = `${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}${buildFilter()}&per_page=100&page=${page}${serverSortParam()}`;
      const data = await fetchJSON(urlA, signal);
      works = works.concat(data.results || []);
    }

    // General search
    const urlG = `${API_BASE}/works?search=${encodeURIComponent(query)}${buildFilter()}&per_page=100&page=${page}${serverSortParam()}`;
    const data = await fetchJSON(urlG, signal);
    const generalWorks = data.results || [];

    if (page === 1) totalResults = data.meta?.count || generalWorks.length;

    // Deduplicate
    const seen = new Set();
    const merged = [...works, ...generalWorks].filter(w => {
      const id = w.id || w.doi || w.display_name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Client-side sort if requested
    if (currentFilter === "citations") merged.sort((a,b)=> (b.cited_by_count||0)-(a.cited_by_count||0));
    else if (currentFilter === "year") merged.sort((a,b)=> (b.publication_year||0)-(a.publication_year||0));

    return merged;
  } catch (err) {
    if (err.name !== "AbortError") console.error("Paper fetch failed", err);
    return [];
  }
}

/* ---------- Concepts / Institutions / Journals / Publishers ---------- */
async function fetchTopics(query, signal) {
  try {
    const url = `${API_BASE}/concepts?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.error("Topic fetch failed", err);
    return [];
  }
}

async function fetchInstitutions(query, signal, opts = {}) {
  try {
    if (opts.ror) {
      const urlR = `${API_BASE}/institutions?filter=${encodeURIComponent("ror:" + opts.ror)}&per_page=5`;
      const dataR = await fetchJSON(urlR, signal);
      return dataR.results || [];
    }
    const url = `${API_BASE}/institutions?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.error("Institution fetch failed", err);
    return [];
  }
}

async function fetchJournals(query, signal, opts = {}) {
  try {
    if (opts.issn) {
      const urlI = `${API_BASE}/sources?filter=${encodeURIComponent("issn:" + opts.issn)}&per_page=5`;
      const dataI = await fetchJSON(urlI, signal);
      return dataI.results || [];
    }
    const url = `${API_BASE}/sources?search=${encodeURIComponent(query)}&filter=type:journal&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.error("Journal fetch failed", err);
    return [];
  }
}

async function fetchPublishers(query, signal) {
  try {
    const url = `${API_BASE}/publishers?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.error("Publisher fetch failed", err);
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

function highlight(text, q){
  if (!text || !q) return escapeHtml(text||"");
  const terms = q.split(/\s+/).filter(Boolean).map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
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
        const inst = a.last_known_institution?.display_name || "No affiliation";
        return `
          <li class="list-item list-card" onclick="location.href='profile.html?id=${id}'" tabindex="0" role="button" aria-label="${escapeHtml(a.display_name)}">
            <div class="title">${escapeHtml(a.display_name)}</div>
            <div class="muted">${escapeHtml(inst)}</div>
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
        const id = t.id.split("/").pop();
        return `
          <li class="list-item list-card" onclick="location.href='topic.html?id=${id}'" tabindex="0" role="button" aria-label="${escapeHtml(t.display_name)}">
            ${escapeHtml(t.display_name)}
          </li>
        `;
      }).join("")
    : `<li class="muted">No topics found.</li>`;
}

/* ---------- Sidebar renders for institutions, journals, publishers ---------- */
function renderInstitutions(items) {
  const el = $("institutionList");
  if (!el) return;
  el.innerHTML = items.length
    ? items.map(inst => {
        const id = inst.id.split("/").pop();
        const country = inst.country_code ? inst.country_code.toUpperCase() : null;
        const works = Number.isFinite(inst.works_count) ? `${inst.works_count.toLocaleString()} works` : null;
        const sub = [country, works].filter(Boolean).join(" · ") || "—";
        return `
          <li class="list-item list-card" onclick="location.href='institution.html?id=${id}'" tabindex="0" role="button" aria-label="${escapeHtml(inst.display_name)}">
            <div class="title">${escapeHtml(inst.display_name)}</div>
            <div class="muted">${escapeHtml(sub)}</div>
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
        const id = j.id.split("/").pop();
        const abbrev = j.abbreviated_title || null;
        const works = Number.isFinite(j.works_count) ? `${j.works_count.toLocaleString()} works` : null;
        const sub = [abbrev, works].filter(Boolean).join(" · ") || "Journal";
        return `
          <li class="list-item list-card" onclick="location.href='journal.html?id=${id}'" tabindex="0" role="button" aria-label="${escapeHtml(j.display_name)}">
            <div class="title">${escapeHtml(j.display_name)}</div>
            <div class="muted">${escapeHtml(sub)}</div>
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
          <li class="list-item list-card" onclick="location.href='publisher.html?id=${id}'" tabindex="0" role="button" aria-label="${escapeHtml(p.display_name)}">
            <div class="title">${escapeHtml(p.display_name)}</div>
            <div class="muted">${escapeHtml(sub)}</div>
          </li>
        `;
      }).join("")
    : `<li class="muted">No publishers found.</li>`;
}

/* ---------- Focused results block (non-destructive) ---------- */
function renderFocusedBlock(kind, items){
  const results = $("unifiedSearchResults");
  if (!results || !items || !items.length) return;

  const titleMap = {
    journal: "Matching journals",
    institution: "Matching institutions",
    publisher: "Matching publishers",
    author: "Matching researchers",
    citation: "Likely paper match"
  };
  const head = titleMap[kind] || "Matches";

  const list = items.slice(0, 5).map((it)=>{
    const id = it.id?.split("/").pop() || "";
    if (kind === "journal") {
      const works = Number.isFinite(it.works_count) ? `${it.works_count.toLocaleString()} works` : "";
      return `<li class="list-item list-card" onclick="location.href='journal.html?id=${id}'"><div class="title">${escapeHtml(it.display_name||"")}</div><div class="muted">${escapeHtml(works)}</div></li>`;
    }
    if (kind === "institution") {
      const country = it.country_code ? it.country_code.toUpperCase() : "";
      return `<li class="list-item list-card" onclick="location.href='institution.html?id=${id}'"><div class="title">${escapeHtml(it.display_name||"")}</div><div class="muted">${escapeHtml(country)}</div></li>`;
    }
    if (kind === "publisher") {
      const sources = Number.isFinite(it.sources_count) ? `${it.sources_count.toLocaleString()} sources` : "";
      return `<li class="list-item list-card" onclick="location.href='publisher.html?id=${id}'"><div class="title">${escapeHtml(it.display_name||"")}</div><div class="muted">${escapeHtml(sources)}</div></li>`;
    }
    if (kind === "author") {
      return `<li class="list-item list-card" onclick="location.href='profile.html?id=${id}'"><div class="title">${escapeHtml(it.display_name||"")}</div><div class="muted">${escapeHtml(it.last_known_institution?.display_name||"No affiliation")}</div></li>`;
    }
    if (kind === "citation") {
      const w = it;
      const wId = (w.id||"").split("/").pop();
      const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "";
      const year = w.publication_year || "";
      return `<li class="list-item list-card" onclick="location.href='paper.html?id=${wId}'"><div class="title">${escapeHtml(w.display_name||"")}</div><div class="muted">${escapeHtml([venue, year].filter(Boolean).join(" · "))}</div></li>`;
    }
    return "";
  }).join("");

  const block = `
    <div class="result-card">
      <h2 style="margin-bottom:.25rem;">${escapeHtml(head)}</h2>
      <ul class="list-reset">
        ${list || `<li class="muted">No matches.</li>`}
      </ul>
      <hr class="divider" />
    </div>
  `;

  results.insertAdjacentHTML("afterbegin", block);
}

/* ---------- Papers list render ---------- */
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
      <div id="papersList"></div>
      <div id="pagination"></div>
    `;
  }

  const papersList = $("papersList");
  if (!papersList) return;

  works.forEach(w => {
    const cardHtml = SE.components.renderPaperCard(w, { compact: true, highlightQuery: currentQuery });
    papersList.insertAdjacentHTML("beforeend", cardHtml);
  });

  SE.components.enhancePaperCards(papersList);

  const pagination = $("pagination");
  const resultsShown = currentPage * 100;
  if (pagination) {
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

/* ---------- Library (placeholder) ---------- */
function addToLibrary(paperId) {
  alert(`Paper ${paperId} added to your library.`);
}

/* ---------- Unified search flow (debounced + cancelable) ---------- */
const debouncedUnified = debounce(runUnifiedSearch, 300);

async function handleUnifiedSearch(skipDebounce=false) {
  if (skipDebounce) return runUnifiedSearch();
  return debouncedUnified();
}

async function runUnifiedSearch(){
  const input = $("unifiedSearchInput");
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;

  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();

  const intent = parseIntent(raw);
  currentQuery = intent.query || raw;
  currentPage = 1;
  setURLState(raw, currentFilter);

  const results = $("unifiedSearchResults");
  const rList = $("researcherList");
  const tList = $("topicList");
  const iList = $("institutionList");
  const jList = $("journalList");
  const pList = $("publisherList");

  if (results) results.innerHTML = skeletonBlock();
  if (rList) rList.innerHTML = `<li class="muted">Loading authors...</li>`;
  if (tList) tList.innerHTML = `<li class="muted">Loading topics...</li>`;
  if (iList) iList.innerHTML = `<li class="muted">Loading institutions...</li>`;
  if (jList) jList.innerHTML = `<li class="muted">Loading journals...</li>`;
  if (pList) pList.innerHTML = `<li class="muted">Loading publishers...</li>`;
  setBusy(true);

  try {
    const authorPromise = (async ()=>{
      if (intent.kind === "author" && intent.orcid) {
        try {
          const data = await fetchJSON(`${API_BASE}/authors?filter=${encodeURIComponent("orcid:" + intent.orcid)}&per_page=5`, searchAbort.signal);
          return data.results || [];
        } catch { return []; }
      }
      const q = intent.kind === "author" && intent.query ? intent.query : raw;
      return fetchAuthors(q, searchAbort.signal);
    })();

    const topicPromise = fetchTopics(raw, searchAbort.signal);

    const instPromise = (async ()=>{
      if (intent.kind === "institution" && intent.ror) {
        return fetchInstitutions("", searchAbort.signal, { ror:intent.ror });
      }
      const q = intent.kind === "institution" && intent.query ? intent.query : raw;
      return fetchInstitutions(q, searchAbort.signal);
    })();

    const jourPromise = (async ()=>{
      if (intent.kind === "journal" && intent.issn) {
        return fetchJournals("", searchAbort.signal, { issn:intent.issn });
      }
      const q = intent.kind === "journal" && intent.query ? intent.query : raw;
      return fetchJournals(q, searchAbort.signal);
    })();

    const publPromise = (async ()=>{
      const q = intent.kind === "publisher" && intent.query ? intent.query : raw;
      return fetchPublishers(q, searchAbort.signal);
    })();

    const [authors, topics, institutions, journals, publishers] = await Promise.all([
      authorPromise, topicPromise, instPromise, jourPromise, publPromise
    ]);

    renderAuthors(authors);
    renderTopics(topics);
    renderInstitutions(institutions);
    renderJournals(journals);
    renderPublishers(publishers);

    currentAuthorIds = authors.map(a => a.id);

    const citationIntent = intent.kind === "citation" ? intent : null;
    const papers = await fetchPapers(currentQuery, currentAuthorIds, currentPage, searchAbort.signal, citationIntent);
    renderPapers(papers);

    if (intent.kind === "journal" && journals.length) renderFocusedBlock("journal", journals);
    if (intent.kind === "institution" && institutions.length) renderFocusedBlock("institution", institutions);
    if (intent.kind === "publisher" && publishers.length) renderFocusedBlock("publisher", publishers);
    if (intent.kind === "author" && authors.length) renderFocusedBlock("author", authors);
    if (intent.kind === "citation" && papers.length) renderFocusedBlock("citation", papers.slice(0,3));

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
  window.location.href = `search.html?q=${encodeURIComponent(query)}&sort=${encodeURIComponent(currentFilter)}`;
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const input = $("unifiedSearchInput");

  const pf = $("paperFilter");
  if (params.has("sort")) {
    const s = params.get("sort");
    if (["relevance","citations","year"].includes(s)) {
      currentFilter = s;
      if (pf) pf.value = s;
    }
  }

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
});

// Expose highlight to components
window.SE = window.SE || {};
window.SE.search = window.SE.search || {};
window.SE.search.highlight = highlight;
