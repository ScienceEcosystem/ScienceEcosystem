// scripts/profile.js

const getParam = (name) => new URLSearchParams(location.search).get(name);
const $ = (id) => document.getElementById(id);

const API = "https://api.openalex.org";
const PAGE_SIZE = 50; // works per page

let authorObj = null;
let currentPage = 1;
let totalWorksCount = 0;
let accumulatedWorks = [];

/* ========= Utilities ========= */
function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}

/* ========= Provenance chips ========= */
function provenanceChips(w) {
  const doi = w.doi ? `https://doi.org/${encodeURIComponent(w.doi)}` : null;
  const openAlexUrl = w.id || null;
  const oaUrl = w.open_access?.oa_url || w.primary_location?.pdf_url || null;
  const venueUrl = w.primary_location?.source?.homepage_url || w.primary_location?.landing_page_url || null;

  const parts = [];
  if (doi) parts.push(`<a class="badge" href="${doi}" target="_blank" rel="noopener">DOI</a>`);
  if (oaUrl) parts.push(`<a class="badge badge-oa" href="${oaUrl}" target="_blank" rel="noopener">Open access</a>`);
  if (venueUrl) parts.push(`<a class="badge" href="${venueUrl}" target="_blank" rel="noopener">Source</a>`);
  if (openAlexUrl) parts.push(`<a class="badge" href="${openAlexUrl}" target="_blank" rel="noopener">OpenAlex</a>`);
  return parts.join(" ");
}

/* ========= Charts (no replaceAll, color param) ========= */
function barChartSVG({ years, series, color, label }) {
  if (!years.length || !series.length) return "";
  const h = 120, bw = 18, bs = 8, w = years.length * (bw + bs) + 60;
  const max = Math.max(...series, 1);

  const axis = (() => {
    const step = Math.ceil(max / 4);
    let out = "";
    for (let i = 0; i < 5; i++) {
      const val = i * step;
      const y = h - (val / max) * h + 20;
      out += `<text x="0" y="${y}" font-size="10" fill="#999">${val}</text>`;
    }
    return out;
  })();

  let bars = "";
  for (let i = 0; i < series.length; i++) {
    const x = i * (bw + bs) + 30;
    const hh = (series[i] / max) * h;
    bars += `<rect x="${x}" y="${h - hh + 20}" width="${bw}" height="${hh}" rx="3" fill="${color}"></rect>`;
  }

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

/* ========= Sidebar timeline ========= */
function renderTimeline(affiliations = []) {
  const el = $("careerTimeline");
  if (!el) return;

  if (!affiliations.length) {
    el.innerHTML = "<li>No affiliations listed.</li>";
    return;
  }

  el.innerHTML = affiliations.map(a => {
    const inst = a.institution?.display_name || "Institution";
    const years = a.years?.length ? a.years.join(", ") : "N/A";
    return `<li><span class="dot"></span><div><div class="title">${escapeHtml(inst)}</div><div class="muted">${escapeHtml(years)}</div></div></li>`;
  }).join("");
}

/* ========= Publications ========= */
function sortWorks(works, by) {
  if (by === "citations") return [...works].sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
  return [...works].sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0));
}

function renderWorksChunk(works) {
  const list = $("publicationsList");
  if (!list) return;

  // Clear placeholder once
  if (list.textContent.includes("Loading publications")) list.innerHTML = "";

  works.forEach((w) => {
    const title = w.display_name || w.title || "Untitled work";
    const pid = w.doi ? `doi:${encodeURIComponent(w.doi)}` : (w.id ? w.id.split("/").pop() : "");
    const year = w.publication_year || "N/A";
    const venue = w.host_venue?.display_name || "Unknown venue";
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
  });

  const shown = accumulatedWorks.length;
  const pag = $("pubsPagination");
  if (!pag) return;

  if (shown < totalWorksCount) {
    pag.innerHTML = `<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>`;
    $("loadMoreBtn").onclick = async () => {
      currentPage += 1;
      await fetchWorksPage(currentPage, /*clear*/ false);
    };
  } else {
    pag.innerHTML = `<p class="muted">All results loaded.</p>`;
  }
}

/* Fetch a page of works, keep meta.count, and render chunk */
async function fetchWorksPage(page, clear) {
  let url;
  try {
    url = new URL(authorObj.works_api_url);
  } catch {
    url = new URL(authorObj.works_api_url, API);
  }
  url.searchParams.set("per-page", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!totalWorksCount) totalWorksCount = data.meta?.count || 0;

  const chunk = data.results || [];
  accumulatedWorks = accumulatedWorks.concat(chunk);

  // Sort according to UI state before rendering
  const sortBy = ($("pubSort")?.value === "citations") ? "citations" : "date";
  const toRender = sortWorks(chunk, sortBy);
  if (clear) $("publicationsList").innerHTML = "";
  renderWorksChunk(toRender);
}

/* ========= Load profile ========= */
async function loadProfile() {
  const param = getParam("id");
  if (!param) {
    $("publicationsList").innerHTML = "<p>Missing researcher ID.</p>";
    return;
  }
  const authorId = param.split("/").pop();

  try {
    // Author
    const author = await (await fetch(`${API}/authors/${authorId}`)).json();
    authorObj = author;

    // Identity
    $("profileName").textContent = author.display_name || "Unknown researcher";
    const affiliation = author.last_known_institution?.display_name
      || author.last_known_institutions?.[0]?.display_name
      || "Unknown affiliation";
    $("profileAffiliation").textContent = affiliation;

    const alt = author.display_name_alternatives || author.alternate_names || [];
    $("otherNames").innerHTML = alt.length ? `<strong>Also published as:</strong> ${alt.map(escapeHtml).join(", ")}` : "";

    if (author.orcid) {
      $("profileOrcid").href = author.orcid;
      $("profileOrcid").textContent = `ORCID: ${author.orcid.split("/").pop()}`;
      $("profileOrcid").style.display = "inline-block";
    }
    if (author.display_picture) $("profilePhoto").src = author.display_picture;

    // Metrics (use counts_by_year to estimate years active for RIS)
    const h = author.summary_stats?.h_index || 0;
    const i10 = author.summary_stats?.i10_index || 0;
    const totalCitations = author.cited_by_count || 0;

    const ys = (author.counts_by_year || []).map(c => c.year);
    const minY = ys.length ? Math.min(...ys) : new Date().getFullYear();
    const maxY = ys.length ? Math.max(...ys) : new Date().getFullYear();
    const yearsActive = Math.max(0, maxY - minY + 1);
    const ris = ((totalCitations * h) / (yearsActive + 1)) || 0;

    $("hIndex").textContent = h.toLocaleString();
    $("i10Index").textContent = i10.toLocaleString();
    $("totalCitations").textContent = totalCitations.toLocaleString();
    $("risValue").textContent = ris.toFixed(1);

    // Topics as cards
    $("tagsContainer").innerHTML = (author.x_concepts || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((c) => {
        const tid = c.id.split("/").pop();
        return `
          <a class="topic-card" href="topic.html?id=${tid}" title="Open topic">
            <span class="topic-name">${escapeHtml(c.display_name)}</span>
          </a>`;
      }).join("");

    // Bio
    const topTopics = (author.x_concepts || []).sort((a,b)=>b.score-a.score).slice(0,5).map(c=>c.display_name);
    $("aiBio").textContent =
      `${author.display_name} studies ${topTopics.join(", ")}. `
      + `They have ${author.works_count?.toLocaleString?.() || "many"} works and ${totalCitations.toLocaleString()} citations. `
      + `Current h-index is ${h}. Latest affiliation is ${affiliation}.`;

    // Sidebar
    renderCharts(author.counts_by_year || []);
    renderTimeline(author.affiliations || []);

    // Publications
    currentPage = 1;
    totalWorksCount = 0;
    accumulatedWorks = [];

    await fetchWorksPage(currentPage, /*clear*/ true);
    $("totalWorks").textContent = (author.works_count || totalWorksCount).toLocaleString();

    // Sort change
    const sortSelect = $("pubSort");
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        const by = sortSelect.value === "citations" ? "citations" : "date";
        const sortedAll = sortWorks(accumulatedWorks, by);
        $("publicationsList").innerHTML = "";
        renderWorksChunk(sortedAll);
      });
    }
  } catch (err) {
    console.error(err);
    $("publicationsList").innerHTML = "<p>Error loading profile.</p>";
  }
}

document.addEventListener("DOMContentLoaded", loadProfile);
