// scripts/profile.js

const getParam = (name) => new URLSearchParams(location.search).get(name);
const $ = (id) => document.getElementById(id);

const API = "https://api.openalex.org";
const PER_PAGE = 50; // publications per page for the list

let currentPage = 1;
let totalWorksCount = 0;
let accumulatedWorks = [];
let authorObj = null;

/* ---------- Utilities ---------- */
function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}

function yearsActiveFromWorks(works) {
  const years = works.map(w => w.publication_year).filter(Boolean);
  if (!years.length) return 0;
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  return Math.max(0, maxY - minY + 1);
}

/* ---------- Chips for provenance ---------- */
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

/* ---------- Result card (same look as search) ---------- */
function renderWorks(works, append = false) {
  const list = $("publicationsList");
  if (!list) return;

  if (!append) list.innerHTML = "";

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
  const pagEl = $("pubsPagination");
  if (!pagEl) return;

  if (shown < totalWorksCount) {
    pagEl.innerHTML = `<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>`;
    $("loadMoreBtn").onclick = async () => {
      currentPage += 1;
      await loadWorksPage(currentPage);
    };
  } else {
    pagEl.innerHTML = `<p class="muted">All results loaded.</p>`;
  }
}

/* ---------- Charts (simple SVGs) ---------- */
function renderBarChart(counts) {
  if (!counts?.length) return "";
  const sorted = [...counts].sort((a, b) => a.year - b.year);
  const years = sorted.map(c => c.year);
  const works = sorted.map(c => c.works_count);
  const cites = sorted.map(c => c.cited_by_count);

  const maxW = Math.max(...works, 1);
  const maxC = Math.max(...cites, 1);
  const h = 120, bw = 18, bs = 8, w = years.length * (bw + bs) + 60;

  const axis = (max) => {
    const step = Math.ceil(max / 4);
    return Array.from({ length: 5 }, (_, i) => {
      const val = i * step;
      const y = h - (val / max) * h + 20;
      return `<text x="0" y="${y}" font-size="10" fill="#999">${val}</text>`;
    }).join("");
  };
  const bars = (data) => data.map((v, i) => {
    const x = i * (bw + bs) + 30, hh = (v / (Math.max(...data, 1))) * h;
    return `<rect x="${x}" y="${h - hh + 20}" width="${bw}" height="${hh}" rx="3" fill="#2563eb" />`;
  }).join("");
  const labels = () => years.map((yr, i) => {
    const x = i * (bw + bs) + 40;
    return `<text x="${x}" y="${h + 35}" font-size="10" text-anchor="middle">${yr}</text>`;
  }).join("");

  return `
  <div class="chart-block">
    <h4>Works per year</h4>
    <svg width="${w}" height="${h + 50}" role="img" aria-label="Works per year">
      ${axis(maxW)}${bars(works)}${labels()}
    </svg>
  </div>
  <div class="chart-block">
    <h4>Citations per year</h4>
    <svg width="${w}" height="${h + 50}" role="img" aria-label="Citations per year">
      ${axis(maxC)}${bars(cites).replaceAll('#2563eb', '#16a34a')}${labels()}
    </svg>
  </div>`;
}

/* ---------- Sidebar render ---------- */
function renderSidebar(author) {
  // Charts
  $("trendCharts").innerHTML = renderBarChart(author.counts_by_year || []);

  // Affiliations timeline
  const affs = (author.affiliations || []).map((a) => {
    const inst = a.institution?.display_name || "Institution";
    const years = a.years?.length ? a.years.join(", ") : "N/A";
    return `<li><span class="dot"></span><div><div class="title">${escapeHtml(inst)}</div><div class="muted">${escapeHtml(years)}</div></div></li>`;
  });
  $("careerTimeline").innerHTML = affs.length ? affs.join("") : "<li>No affiliations listed.</li>";
}

/* ---------- Works fetching with total count ---------- */
async function loadWorksPage(page) {
  let worksUrl;
  try {
    worksUrl = new URL(authorObj.works_api_url);
  } catch {
    worksUrl = new URL(authorObj.works_api_url, API);
  }
  worksUrl.searchParams.set("per-page", String(PER_PAGE));
  worksUrl.searchParams.set("page", String(page));

  const res = await fetch(worksUrl.toString());
  const data = await res.json();

  // total
  if (!totalWorksCount) totalWorksCount = data.meta?.count || 0;
  // append
  const newWorks = data.results || [];
  accumulatedWorks = accumulatedWorks.concat(newWorks);

  // render chunk
  renderWorks(newWorks, true);
}

/* ---------- Main loader ---------- */
async function loadProfile() {
  const param = getParam("id");
  if (!param) {
    $("profileMain").innerHTML = "<p>Missing researcher ID.</p>";
    return;
  }
  const authorId = param.split("/").pop();

  try {
    const res = await fetch(`${API}/authors/${authorId}`);
    const author = await res.json();
    authorObj = author;

    // Header
    $("profileName").textContent = author.display_name || "Unknown researcher";
    const affiliation = author.last_known_institution?.display_name
      || author.last_known_institutions?.[0]?.display_name
      || "Unknown affiliation";
    $("profileAffiliation").textContent = affiliation;

    const alt = author.display_name_alternatives || author.alternate_names || [];
    $("otherNames").innerHTML = alt.length ? `<strong>Also published as:</strong> ${alt.map(escapeHtml).join(", ")}` : "";

    if (author.orcid) {
      $("profileOrcid").href = author.orcid;
      const code = author.orcid.split("/").pop();
      $("profileOrcid").textContent = `ORCID: ${code}`;
      $("profileOrcid").style.display = "inline-block";
    } else {
      $("profileOrcid").style.display = "none";
    }

    if (author.display_picture) $("profilePhoto").src = author.display_picture;

    // Metrics
    const h = author.summary_stats?.h_index || 0;
    const i10 = author.summary_stats?.i10_index || 0;
    const totalCitations = author.cited_by_count || 0;

    // We compute RIS using years active from all works; for startup use counts_by_year
    const yrs = author.counts_by_year?.map(c => c.year) || [];
    const minY = yrs.length ? Math.min(...yrs) : new Date().getFullYear();
    const maxY = yrs.length ? Math.max(...yrs) : new Date().getFullYear();
    const yearsActive = Math.max(0, maxY - minY + 1);
    const ris = ((totalCitations * h) / (yearsActive + 1)) || 0;

    $("hIndex").textContent = h.toLocaleString();
    $("i10Index").textContent = i10.toLocaleString();
    $("totalCitations").textContent = totalCitations.toLocaleString();
    $("risValue").textContent = ris.toFixed(1);

    // Topics
    $("tagsContainer").innerHTML = (author.x_concepts || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((c) => {
        const tid = c.id.split("/").pop();
        return `<a class="topic-pill" href="topic.html?id=${tid}" title="Open topic">${escapeHtml(c.display_name)}</a>`;
      }).join("");

    // Bio
    const topTopics = (author.x_concepts || []).sort((a,b)=>b.score-a.score).slice(0,5).map(c=>c.display_name);
    $("aiBio").textContent =
      `${author.display_name} studies ${topTopics.join(", ")}. `
      + `They have published works across ${yearsActive || "multiple"} years with ${totalCitations.toLocaleString()} citations. `
      + `Current h-index is ${h}. Latest affiliation is ${affiliation}.`;

    // Sidebar
    renderSidebar(author);

    // Publications: first page also sets total count
    currentPage = 1;
    accumulatedWorks = [];
    totalWorksCount = 0;

    // Load first page to get meta.count
    await loadWorksPage(currentPage);

    // Show total publications in stat tile
    $("totalWorks").textContent = totalWorksCount.toLocaleString();

    // Sorting
    const sortSelect = $("pubSort");
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        const by = sortSelect.value === "citations" ? "citations" : "date";
        const sorted = sortSelect.value === "citations"
          ? [...accumulatedWorks].sort((a,b)=>(b.cited_by_count||0)-(a.cited_by_count||0))
          : [...accumulatedWorks].sort((a,b)=>(b.publication_year||0)-(a.publication_year||0));
        $("publicationsList").innerHTML = "";
        renderWorks(sorted, true);
      });
    }
  } catch (err) {
    console.error(err);
    $("profileMain").innerHTML = "<p>Error loading profile.</p>";
  }
}

document.addEventListener("DOMContentLoaded", loadProfile);
