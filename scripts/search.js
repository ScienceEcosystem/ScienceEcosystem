// scripts/search.js
const $ = (id) => document.getElementById(id);
const API_BASE = "https://api.openalex.org";
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

    throw new Error(`${res.status} ${res.statusText}`);
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
  const m = s.match(/10\.\d{4,9}\/\S+/i);
  return !!m;
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
    const url = `${API_BASE}/concepts?search=${encodeURIComponent(query)}&per_page=5`;
    const data = await fetchJSON(url, signal);
    return data.results || [];
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

/* ---------- Papers (authors + general query) ---------- */
async function fetchPapers(query, authorIds = [], page = 1, signal) {
  let works = [];
  try {
    for (const authorId of authorIds) {
      const urlA = `${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}${buildFilter()}&per_page=100&page=${page}${serverSortParam()}`;
      const dataA = await fetchJSON(urlA, signal);
      works = works.concat(dataA.results || []);
    }

    const urlG = `${API_BASE}/works?search=${encodeURIComponent(query)}${buildFilter()}&per_page=100&page=${page}${serverSortParam()}`;
    const dataG = await fetchJSON(urlG, signal);
    const generalWorks = dataG.results || [];

    if (page === 1) totalResults = dataG.meta?.count || generalWorks.length || 0;

    const seen = new Set();
    let merged = [...works, ...generalWorks].filter(w => {
      const id = w.id || w.doi || w.display_name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    merged = applyAdvancedFilters(merged);
    if (advancedActive && page === 1) totalResults = merged.length;

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
          <li class="list-item list-card" onclick="location.href='topic.html?id=${encodeURIComponent(id)}'" tabindex="0" role="button" aria-label="${escapeHtml(t.display_name)}">
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
        const id = inst.id.split("/").pop();
        const country = inst.country_code ? inst.country_code.toUpperCase() : null;
        const works = Number.isFinite(inst.works_count) ? `${inst.works_count.toLocaleString()} works` : null;
        const sub = [country, works].filter(Boolean).join(" · ") || "-";
        return `
          <li class="list-item list-card" onclick="location.href='institute.html?id=${encodeURIComponent(id)}'" tabindex="0" role="button" aria-label="${escapeHtml(inst.display_name)}">
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
          <li class="list-item list-card" onclick="location.href='journal.html?id=${encodeURIComponent(srcId)}'" tabindex="0" role="button" aria-label="${escapeHtml(j.display_name)}">
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
        const id = p.id.split("/").pop();
        const works = Number.isFinite(p.works_count) ? `${p.works_count.toLocaleString()} works` : null;
        const sources = Number.isFinite(p.sources_count) ? `${p.sources_count.toLocaleString()} sources` : null;
        const sub = [works, sources].filter(Boolean).join(" · ") || "Publisher";
        return `
          <li class="list-item list-card" onclick="location.href='publisher.html?id=${encodeURIComponent(id)}'" tabindex="0" role="button" aria-label="${escapeHtml(p.display_name)}">
            <div class="title">${escapeHtml(p.display_name)}</div>
            <div class="muted">${escapeHtml(sub)}</div>
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
          <li class="list-item list-card" onclick="location.href='funders.html?id=${id}'" tabindex="0" role="button" aria-label="${escapeHtml(f.display_name)}">
            <div class="title">${escapeHtml(f.display_name)}</div>
            <div class="muted">${escapeHtml(sub)}</div>
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

  if (results) results.innerHTML = skeletonBlock();
  if (rList) rList.innerHTML = `<li class="muted">Loading authors...</li>`;
  if (tList) tList.innerHTML = `<li class="muted">Loading topics...</li>`;
  if (iList) iList.innerHTML = `<li class="muted">Loading institutions...</li>`;
  if (jList) jList.innerHTML = `<li class="muted">Loading journals...</li>`;
  if (pList) pList.innerHTML = `<li class="muted">Loading publishers...</li>`;
  if (fList) fList.innerHTML = `<li class="muted">Loading funders...</li>`;
  setBusy(true);

  try {
    const doiOverride = advanced.doi || (isDoiQuery(query) ? query : "");
    if (doiOverride) {
      const papers = await fetchPaperByDoi(doiOverride, searchAbort.signal);
      totalResults = papers.length;
      renderPapers(papers);
      if (rList) rList.innerHTML = `<li class="muted">Skipped for DOI search.</li>`;
      if (tList) tList.innerHTML = `<li class="muted">Skipped for DOI search.</li>`;
      if (iList) iList.innerHTML = `<li class="muted">Skipped for DOI search.</li>`;
      if (jList) jList.innerHTML = `<li class="muted">Skipped for DOI search.</li>`;
      if (pList) pList.innerHTML = `<li class="muted">Skipped for DOI search.</li>`;
      if (fList) fList.innerHTML = `<li class="muted">Skipped for DOI search.</li>`;
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
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const input = $("unifiedSearchInput");

  const pf = $("paperFilter");
  if (params.has("sort")) {
    const s = params.get("sort");
    if (["relevance","citations","year"].includes(s)) {
      currentFilter = s;
    }
  }
  const of = $("orderFilter");
  if (params.has("order")) {
    const o = params.get("order");
    if (["asc","desc"].includes(o)) currentOrder = o;
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

  $("applyAdvancedFilters")?.addEventListener("click", () => handleUnifiedSearch(true));
  $("clearAdvancedFilters")?.addEventListener("click", () => { clearAdvancedFilters(); handleUnifiedSearch(true); });
});

// Expose highlight to components (optional)
window.SE = window.SE || {};
window.SE.search = window.SE.search || {};
window.SE.search.highlight = highlight;
