// scripts/search.js
const $ = (id) => document.getElementById(id);
const API_BASE = "https://api.openalex.org";
const OPENALEX_MAILTO = "info@scienceecosystem.org";

// State
let currentPage = 1;
let currentQuery = "";
let currentAuthorIds = [];
let currentInstitutionIds = [];  // kept for sidebar; not used to filter works (for now)
let currentJournalIds = [];      // kept for sidebar; not used to filter works (for now)
let currentPublisherIds = [];    // kept for sidebar; not used to filter works (for now)
let totalResults = 0;
let currentFilter = "relevance"; // relevance | citations | year
let searchAbort = null;

// Facets
let facet = { oa:false, types: new Set(), yearMin:null, yearMax:null };

// Utils
function escapeHtml(str = "") {
  return (str || "").replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
function debounce(fn, ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
function toId(x){ return String(x||"").split("/").pop(); } // OpenAlex short id

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

/* ---------- Filters ---------- */
function filterCSV() {
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

/* ---------- Lookups ---------- */
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

async function fetchInstitutions(query, signal) {
  try {
    const url = `${API_BASE}/institutions?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
  } catch (err) {
    if (err.name !== "AbortError") console.error("Institution fetch failed", err);
    return [];
  }
}

async function fetchJournals(query, signal) {
  try {
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

/* ---------- Papers fetching (known-good: authors + general search only) ---------- */
async function fetchPapers(query, authorIds = [], page = 1, signal) {
  let works = [];
  try {
    // Author-constrained works (merge results)
    const aIds = (authorIds || []).map(toId);
    if (aIds.length) {
      const urlA = `${API_BASE}/works?filter=${encodeURIComponent(`author.id:${aIds.join("|")}`)}${filterCSV()}&per_page=100&page=${page}${serverSortParam()}`;
      const dataA = await fetchJSON(urlA, signal);
      works = works.concat(dataA.results || []);
    }

    // General search (always)
    const urlG = `${API_BASE}/works?search=${encodeURIComponent(query)}${filterCSV()}&per_page=100&page=${page}${serverSortParam()}`;
    const dataG = await fetchJSON(urlG, signal);
    const generalWorks = dataG.results || [];

    if (page === 1) totalResults = dataG.meta?.count ?? generalWorks.length ?? 0;

    // De-dup (OpenAlex id/doi/title fallback)
    const seen = new Set();
    const merged = [...works, ...generalWorks].filter(w => {
      const id = w.id || w.doi || w.display_name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Client-side sort if needed
    if (currentFilter === "citations") merged.sort((a,b)=> (b.cited_by_count||0)-(a.cited_by_count||0));
    else if (currentFilter === "year") merged.sort((a,b)=> (b.publication_year||0)-(a.publication_year||0));

    return merged;
  } catch (err) {
    if (err.name !== "AbortError") console.error("Paper fetch failed", err);
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

// Fallback paper card (if SE.components isn’t ready)
function fallbackPaperCard(w){
  const title = escapeHtml(w.display_name || "Untitled");
  const year = w.publication_year ? ` (${w.publication_year})` : "";
  const venue = w.primary_location?.source?.display_name || w.host_venue?.display_name || "";
  const authors = (w.authorships||[]).map(a=>a.author?.display_name).filter(Boolean).slice(0,6).join(", ");
  const id = w.id || "";
  return `
    <article class="result-card">
      <h3 class="result-title"><a href="paper.html?id=${encodeURIComponent(toId(id))}">${title}</a>${year}</h3>
      <p class="muted">${escapeHtml(authors)}${authors && venue ? " — " : ""}${escapeHtml(venue)}</p>
      <p class="chips">${provenanceChips(w)}</p>
    </article>
  `;
}

// Highlight for components (if used)
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
        const id = toId(a.id);
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
        const id = toId(t.id);
        return `
          <li class="list-item list-card" onclick="location.href='topic.html?id=${id}'" tabindex="0" role="button" aria-label="${escapeHtml(t.display_name)}">
            ${escapeHtml(t.display_name)}
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
        const id = toId(inst.id);
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
        const srcId = toId(j.id);
        const abbrev = j.abbreviated_title || null;
        const works = Number.isFinite(j.works_count) ? `${j.works_count.toLocaleString()} works` : null;
        const pubIdFull = j.host_organization || null;
        const pubId = pubIdFull ? toId(pubIdFull) : null;
        const pubName = j.host_organization_name || j.host_organization_lineage?.[0]?.display_name || null;
        const subLeft = [abbrev, works].filter(Boolean).join(" · ") || "Journal";
        const pubLink = (pubId && pubName)
          ? `<a href="publisher.html?id=${pubId}" class="muted" onclick="event.stopPropagation();" aria-label="Go to publisher ${escapeHtml(pubName)}">Publisher: ${escapeHtml(pubName)}</a>`
          : `<span class="muted">Publisher: ${escapeHtml(pubName || "Unknown")}</span>`;

        return `
          <li class="list-item list-card" onclick="location.href='journal.html?id=${srcId}'" tabindex="0" role="button" aria-label="${escapeHtml(j.display_name)}">
            <div class="title">${escapeHtml(j.display_name)}</div>
            <div class="muted">${escapeHtml(subLeft)}</div>
            <div>${pubLink}</div>
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
        const id = toId(p.id);
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

  if (!works || works.length === 0) {
    papersList.innerHTML = `<p class="muted">No papers found for this search.</p>`;
    return;
  }

  works.forEach(w => {
    const cardHtml = (window.SE?.components?.renderPaperCard)
      ? window.SE.components.renderPaperCard(w, { compact: true, highlightQuery: currentQuery })
      : fallbackPaperCard(w);
    papersList.insertAdjacentHTML("beforeend", cardHtml);
  });

  if (window.SE?.components?.enhancePaperCards) {
    window.SE.components.enhancePaperCards(papersList);
  }

  // Pagination & Infinite Scroll
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
        const more = await fetchPapers(
          currentQuery,
          currentAuthorIds,
          currentPage,
          searchAbort?.signal
        );
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

  // Facet handlers
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
  const query = input.value.trim();
  if (!query) return;

  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();

  currentQuery = query;
  currentPage = 1;
  setURLState(currentQuery, currentFilter);

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
    const [authors, topics, institutions, journals, publishers] = await Promise.all([
      fetchAuthors(query, searchAbort.signal),
      fetchTopics(query, searchAbort.signal),
      fetchInstitutions(query, searchAbort.signal),
      fetchJournals(query, searchAbort.signal),
      fetchPublishers(query, searchAbort.signal),
    ]);

    renderAuthors(authors);
    renderTopics(topics);
    renderInstitutions(institutions);
    renderJournals(journals);
    renderPublishers(publishers);

    // Store IDs (authors used for works; others for sidebar only for now)
    currentAuthorIds      = authors.map(a => a.id);
    currentInstitutionIds = institutions.map(i => i.id);
    currentJournalIds     = journals.map(j => j.id);
    currentPublisherIds   = publishers.map(p => p.id);

    const papers = await fetchPapers(
      query,
      currentAuthorIds,
      1,
      searchAbort.signal
    );
    renderPapers(papers);
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

// Expose highlight to components (optional)
window.SE = window.SE || {};
window.SE.search = window.SE.search || {};
window.SE.search.highlight = highlight;
