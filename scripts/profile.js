// scripts/profile.js

/* ==============================
   Utilities & Globals
============================== */

const getParam = (name) => new URLSearchParams(location.search).get(name);
const $ = (id) => document.getElementById(id);

const API = "https://api.openalex.org";
const PAGE_SIZE = 50;       // works per page (OpenAlex uses per_page)
let authorObj = null;
let currentPage = 1;
let totalWorksCount = 0;
let accumulatedWorks = [];

/** Escape HTML to prevent injection in dynamic text nodes/attrs. */
function escapeHtml(str = "") {
  return String(str).replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}

/** Normalize incoming author id:
 *  Accepts:
 *   - "A123456789"
 *   - "https://api.openalex.org/authors/A123456789"
 *   - "https%3A%2F%2Fapi.openalex.org%2Fauthors%2FA123456789"
 *   - "ORCID:0000-0002-1825-0097" or "0000-0002-1825-0097"
 * Returns: string suitable for /authors/{id}
 */
function normalizeAuthorId(raw) {
  if (!raw) return "";
  let s = raw;
  try { s = decodeURIComponent(s); } catch {}
  s = s.trim();

  // If it's a full URL, take the last path segment
  if (s.includes("/")) s = s.split("/").filter(Boolean).pop();

  // If it's a bare ORCID, prefix "ORCID:" (OpenAlex accepts that)
  const orcidLike = /^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/i.test(s);
  if (orcidLike && !s.toUpperCase().startsWith("ORCID:")) {
    s = `ORCID:${s}`;
  }
  return s;
}

/** Safe fetch -> JSON with consistent error handling */
async function fetchJSON(url, onErrorMessageElId = null) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error("Fetch failed:", url, err);
    if (onErrorMessageElId) {
      const el = $(onErrorMessageElId);
      if (el) el.innerHTML = `<p class="muted">Could not load data.</p>`;
    }
    return null;
  }
}

/* ==============================
   Badges / Provenance chips
============================== */

function provenanceChips(w) {
  // OpenAlex work fields vary; be permissive
  const doiRaw = w.doi || w.ids?.doi;
  const doi = doiRaw
    ? (doiRaw.startsWith("http") ? doiRaw : `https://doi.org/${encodeURIComponent(doiRaw.replace(/^doi:/i,""))}`)
    : null;

  const openAlexUrl = w.id || null;
  const oaUrl =
    w.open_access?.oa_url ||
    w.primary_location?.pdf_url ||
    w.best_oa_location?.url ||
    null;

  const venueUrl =
    w.primary_location?.source?.homepage_url ||
    w.primary_location?.landing_page_url ||
    null;

  const parts = [];
  if (doi) parts.push(`<a class="badge" href="${doi}" target="_blank" rel="noopener">DOI</a>`);
  if (oaUrl) parts.push(`<a class="badge badge-oa" href="${oaUrl}" target="_blank" rel="noopener">Open access</a>`);
  if (venueUrl) parts.push(`<a class="badge" href="${venueUrl}" target="_blank" rel="noopener">Source</a>`);
  if (openAlexUrl) parts.push(`<a class="badge" href="${openAlexUrl}" target="_blank" rel="noopener">OpenAlex</a>`);
  return parts.join(" ");
}

/* ==============================
   Charts (simple SVG)
============================== */

function barChartSVG({ years, series, color, label }) {
  if (!years?.length || !series?.length) return "";
  const h = 120, bw = 18, bs = 8, w = years.length * (bw + bs) + 60;
  const max = Math.max(...series, 1);

  // y-axis ticks
  let axis = "";
  const step = Math.ceil(max / 4);
  for (let i = 0; i < 5; i++) {
    const val = i * step;
    const y = h - (val / max) * h + 20;
    axis += `<text x="0" y="${y}" font-size="10" fill="#999">${val}</text>`;
  }

  // bars
  let bars = "";
  for (let i = 0; i < series.length; i++) {
    const x = i * (bw + bs) + 30;
    const hh = (series[i] / max) * h;
    bars += `<rect x="${x}" y="${h - hh + 20}" width="${bw}" height="${hh}" rx="3" fill="${color}"></rect>`;
  }

  // x labels
  let labels = "";
  for (let i = 0; i < years.length; i++) {
    const x = i * (bw + bs) + 40;
    labels += `<text x="${x}" y="${h + 35}" font-size="10" text-anchor="middle">${years[i]}</text>`;
  }

  return `
    <div class="chart-block">
      <h4>${escapeHtml(label)}</h4>
      <svg width="${w}" height="${h + 50}" role="img" aria-label="${escapeHtml(label)}">
        ${axis}${bars}${labels}
      </svg>
    </div>
  `;
}

function renderCharts(counts) {
  const el = $("trendCharts");
  if (!el) return;
  if (!counts?.length) {
    el.innerHTML = `<p class="muted">No trend data.</p>`;
    return;
  }
  const sorted = [...counts].sort((a, b) => a.year - b.year);
  const years = sorted.map(c => c.year);
  const works = sorted.map(c => c.works_count || 0);
  const cites = sorted.map(c => c.cited_by_count || 0);

  const worksChart = barChartSVG({ years, series: works, color: "#2563eb", label: "Works per year" });
  const citesChart = barChartSVG({ years, series: cites, color: "#16a34a", label: "Citations per year" });
  el.innerHTML = worksChart + citesChart;
}

/* ==============================
   Sidebar Timeline
============================== */

function renderTimeline(author) {
  const el = $("careerTimeline");
  if (!el) return;

  // OpenAlex doesn't provide a neat historical "affiliations" array on the author.
  // We'll show last_known_institution + last_known_institutions as a lightweight timeline.
  const items = [];

  const lki = author?.last_known_institution;
  if (lki?.display_name) {
    items.push({ name: lki.display_name, years: "Most recent" });
  }

  const lkis = Array.isArray(author?.last_known_institutions) ? author.last_known_institutions : [];
  for (const inst of lkis) {
    if (inst?.display_name) items.push({ name: inst.display_name, years: "Affiliation" });
  }

  if (!items.length) {
    el.innerHTML = "<li>No affiliations listed.</li>";
    return;
  }

  el.innerHTML = items.map(a => {
    return `<li><span class="dot"></span><div><div class="title">${escapeHtml(a.name)}</div><div class="muted">${escapeHtml(a.years)}</div></div></li>`;
  }).join("");
}

/* ==============================
   Publications rendering
============================== */

function sortWorks(works, by) {
  if (by === "citations") {
    return [...works].sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
  }
  return [...works].sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0));
}

function renderWorksChunk(works) {
  const list = $("publicationsList");
  if (!list) return;

  if (/Loading publications/i.test(list.textContent)) list.innerHTML = "";

  for (const w of works) {
    const title = w.display_name || w.title || "Untitled work";
    const idTail = w.id ? w.id.split("/").pop() : "";
    const doiRaw = w.doi || w.ids?.doi || "";
    // paper route: pass either doi: or OpenAlex ID
    const pid = doiRaw
      ? `doi:${encodeURIComponent(doiRaw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""))}`
      : idTail;

    const year = w.publication_year ?? "N/A";
    const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "Unknown venue";
    const cites = w.cited_by_count || 0;

    const authorsHtml = (w.authorships || [])
      .map((a) => {
        const aid = a.author?.id ? a.author.id.split("/").pop() : null;
        const name = escapeHtml(a.author?.display_name || "Unknown");
        return aid ? `<a href="profile.html?id=${aid}">${name}</a>` : name;
      })
      .join(", ") || "Unknown authors";

    list.insertAdjacentHTML("beforeend", `
      <article class="result-card">
        <h3><a href="paper.html?id=${pid}">${escapeHtml(title)}</a></h3>
        <p class="meta"><span class="muted">${year}</span> · <strong>Published in:</strong> ${escapeHtml(venue)} · <strong>Citations:</strong> ${cites}</p>
        <p><strong>Authors:</strong> ${authorsHtml}</p>
        <p class="chips">${provenanceChips(w)}</p>
      </article>
    `);
  }

  const shown = accumulatedWorks.length;
  const pag = $("pubsPagination");
  if (!pag) return;

  if (shown < totalWorksCount) {
    pag.innerHTML = `<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>`;
    const btn = $("loadMoreBtn");
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Loading…";
        currentPage += 1;
        await fetchWorksPage(currentPage, false);
      };
    }
  } else {
    pag.innerHTML = `<p class="muted">All results loaded.</p>`;
  }
}

/** Fetch a page of works, track meta.count, append, then render */
async function fetchWorksPage(page, clear) {
  if (!authorObj?.works_api_url) {
    $("publicationsList").innerHTML = `<p class="muted">No publications endpoint provided.</p>`;
    return;
  }

  let url;
  try {
    url = new URL(authorObj.works_api_url);
  } catch {
    // If OpenAlex ever returns a path-only URL (rare), anchor it
    url = new URL(authorObj.works_api_url, API);
  }

  // IMPORTANT: OpenAlex uses per_page (underscore)
  url.searchParams.set("per_page", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));

  const data = await fetchJSON(url.toString(), "publicationsList");
  if (!data) return;

  if (!totalWorksCount) totalWorksCount = data.meta?.count || 0;

  const chunk = Array.isArray(data.results) ? data.results : [];
  accumulatedWorks = accumulatedWorks.concat(chunk);

  const sortBy = ($("pubSort")?.value === "citations") ? "citations" : "date";
  const toRender = sortWorks(chunk, sortBy);

  if (clear) $("publicationsList").innerHTML = "";
  renderWorksChunk(toRender);
}

/* ==============================
   Profile Loader
============================== */

async function loadProfile() {
  const rawParam = getParam("id");
  const authorId = normalizeAuthorId(rawParam);

  if (!authorId) {
    $("publicationsList").innerHTML = "<p>Missing or invalid researcher ID.</p>";
    return;
  }

  // Pull the author record
  const authorUrl = `${API}/authors/${encodeURIComponent(authorId)}`;
  const author = await fetchJSON(authorUrl, "publicationsList");
  if (!author) {
    $("publicationsList").innerHTML = "<p>Profile not found.</p>";
    return;
  }
  authorObj = author;

  // Identity
  $("profileName").textContent = author.display_name || "Unknown researcher";

  const affiliation =
    author.last_known_institution?.display_name ||
    author.last_known_institutions?.[0]?.display_name ||
    "Unknown affiliation";
  $("profileAffiliation").textContent = affiliation;

  const alt =
    (Array.isArray(author.display_name_alternatives) && author.display_name_alternatives.length
      ? author.display_name_alternatives
      : (Array.isArray(author.alternate_names) ? author.alternate_names : [])
    );

  $("otherNames").innerHTML = alt.length
    ? `<strong>Also published as:</strong> ${alt.map(escapeHtml).join(", ")}`
    : "";

  // Profile image (handle multiple possible fields)
  const img =
    author.display_picture ||
    author.image_url ||
    author.orcid?.replace(/^ORCID:/i, "https://orcid.org/") ||
    null;
  if (author.display_picture || author.image_url) {
    $("profilePhoto").src = img;
  }

  if (author.orcid) {
    const orcidHref = author.orcid.startsWith("http")
      ? author.orcid
      : `https://orcid.org/${author.orcid.replace(/^ORCID:/i,"")}`;
    const orcidEl = $("profileOrcid");
    orcidEl.href = orcidHref;
    orcidEl.textContent = `ORCID: ${orcidHref.split("/").pop()}`;
    orcidEl.style.display = "inline-block";
  }

  // Metrics
  const h = author.summary_stats?.h_index || 0;
  const i10 = author.summary_stats?.i10_index || 0;
  const totalCitations = author.cited_by_count || 0;

  const yearsList = (author.counts_by_year || []).map(c => c.year);
  const nowYear = new Date().getFullYear();
  const minY = yearsList.length ? Math.min(...yearsList) : nowYear;
  const maxY = yearsList.length ? Math.max(...yearsList) : nowYear;
  const yearsActive = Math.max(1, maxY - minY + 1); // never 0 to avoid div by 0
  const ris = (totalCitations * h) / (yearsActive + 1);

  $("hIndex").textContent = h.toLocaleString();
  $("i10Index").textContent = i10.toLocaleString();
  $("totalCitations").textContent = totalCitations.toLocaleString();
  $("risValue").textContent = ris.toFixed(1);

  // Topics -> cards
  const concepts = Array.isArray(author.x_concepts) ? author.x_concepts : [];
  $("tagsContainer").innerHTML = concepts
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 12)
    .map((c) => {
      const tid = c.id?.split("/").pop() || "";
      return `
        <a class="topic-card" href="topic.html?id=${tid}" title="Open topic">
          <span class="topic-name">${escapeHtml(c.display_name || "Topic")}</span>
        </a>`;
    }).join("");

  // Short AI-ish bio text
  const topTopics = concepts
    .sort((a,b)=> (b.score||0)-(a.score||0))
    .slice(0,5)
    .map(c=>c.display_name)
    .filter(Boolean);

  $("aiBio").textContent =
    `${author.display_name || "This researcher"} studies ${topTopics.join(", ") || "various topics"}. `
    + `They have ${(author.works_count || 0).toLocaleString()} works and ${totalCitations.toLocaleString()} citations. `
    + `Current h-index is ${h}. Latest affiliation is ${affiliation}.`;

  // Sidebar
  renderCharts(author.counts_by_year || []);
  renderTimeline(author);

  // Publications
  currentPage = 1;
  totalWorksCount = 0;
  accumulatedWorks = [];

  // Load first page
  await fetchWorksPage(currentPage, true);

  // Backfill total works if API meta is more accurate than author.works_count
  $("totalWorks").textContent = (
    author.works_count || totalWorksCount || accumulatedWorks.length
  ).toLocaleString();

  // Sorting control
  const sortSelect = $("pubSort");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      const by = sortSelect.value === "citations" ? "citations" : "date";
      const sortedAll = sortWorks(accumulatedWorks, by);
      $("publicationsList").innerHTML = "";
      renderWorksChunk(sortedAll);
    });
  }
}

document.addEventListener("DOMContentLoaded", loadProfile);
