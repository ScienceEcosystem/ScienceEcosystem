// scripts/search.js
const $ = (id) => document.getElementById(id);
const API_BASE = "https://api.openalex.org";

let currentPage = 1;
let currentQuery = "";
let currentAuthorIds = [];
let totalResults = 0;

function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}

/* ---------- Fetch helpers ---------- */

// Authors
async function fetchAuthors(query) {
  try {
    const res = await fetch(`${API_BASE}/authors?search=${encodeURIComponent(query)}&per-page=5`);
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error("Author fetch failed", err);
    return [];
  }
}

// Works (with optional author filters) + pagination
async function fetchPapers(query, authorIds = [], page = 1) {
  let works = [];
  try {
    // Author-constrained works
    for (const authorId of authorIds) {
      const res = await fetch(`${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}&per-page=5&page=${page}`);
      const data = await res.json();
      works = works.concat(data.results || []);
    }

    // General search
    const res = await fetch(`${API_BASE}/works?search=${encodeURIComponent(query)}&per-page=100&page=${page}`);
    const data = await res.json();
    const generalWorks = data.results || [];

    if (page === 1) totalResults = data.meta?.count || generalWorks.length;

    // Deduplicate by OpenAlex id
    const seen = new Set();
    return [...works, ...generalWorks].filter(w => {
      const id = w.id || w.doi || w.title;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch (err) {
    console.error("Paper fetch failed", err);
    return [];
  }
}

// Topics
async function fetchTopics(query) {
  try {
    const res = await fetch(`${API_BASE}/concepts?search=${encodeURIComponent(query)}&per-page=5`);
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error("Topic fetch failed", err);
    return [];
  }
}

/* ---------- Render helpers ---------- */

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

function renderPapers(works, append = false) {
  const results = $("unifiedSearchResults");
  if (!results) return;

  if (!append) {
    results.innerHTML = `
      <h2>Papers <span class="muted">(${totalResults.toLocaleString()} results)</span></h2>
      <div id="papersList"></div>
      <div id="pagination"></div>
    `;
  }

  const papersList = $("papersList");
  if (!papersList) return;

  works.forEach((w, index) => {
    const paperId = w.doi ? `doi:${encodeURIComponent(w.doi)}` : (w.id ? w.id.split("/").pop() : "");
    const authorsHtml = (w.authorships || [])
      .map(a => `<a href="profile.html?id=${a.author.id.split('/').pop()}">${escapeHtml(a.author.display_name)}</a>`)
      .join(", ");

    const venue = w.host_venue?.display_name || "Unknown venue";
    const citations = w.cited_by_count || 0;
    const year = w.publication_year || "";

    const number = ((currentPage - 1) * 100) + index + 1;

    papersList.insertAdjacentHTML("beforeend", `
      <article class="result-card">
        <h3>${number}. <a href="paper.html?id=${paperId}">${escapeHtml(w.display_name || "Untitled work")}</a></h3>
        <p class="meta">
          ${year ? `<span class="muted">${year}</span> · ` : ""}
          <strong>Published in:</strong> ${escapeHtml(venue)} ·
          <strong>Citations:</strong> ${citations}
        </p>
        <p><strong>Authors:</strong> ${authorsHtml || "Unknown authors"}</p>
        <p class="chips">${provenanceChips(w)}</p>
      </article>
    `);
  });

  // Pagination
  const pagination = $("pagination");
  const resultsShown = currentPage * 100;
  if (pagination) {
    if (resultsShown < totalResults) {
      pagination.innerHTML = `<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>`;
      $("loadMoreBtn").onclick = async () => {
        currentPage++;
        const more = await fetchPapers(currentQuery, currentAuthorIds, currentPage);
        renderPapers(more, true);
      };
    } else {
      pagination.innerHTML = `<p class="muted">All results loaded.</p>`;
    }
  }
}

/* ---------- Unified search flow ---------- */

async function handleUnifiedSearch() {
  const input = $("unifiedSearchInput");
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;

  currentQuery = query;
  currentPage = 1;

  const results = $("unifiedSearchResults");
  const rList = $("researcherList");
  const tList = $("topicList");
  if (results) results.innerHTML = "<p>Loading papers...</p>";
  if (rList) rList.innerHTML = `<li class="muted">Loading authors...</li>`;
  if (tList) tList.innerHTML = `<li class="muted">Loading topics...</li>`;

  // Authors
  const authors = await fetchAuthors(query);
  renderAuthors(authors);

  // Papers
  currentAuthorIds = authors.map(a => a.id);
  const papers = await fetchPapers(query, currentAuthorIds, currentPage);
  renderPapers(papers);

  // Topics
  const topics = await fetchTopics(query);
  renderTopics(topics);
}

// Redirector from any nav search box
function handleSearch(inputId) {
  const input = $(inputId);
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;
  window.location.href = `search.html?q=${encodeURIComponent(query)}`;
}

/* ---------- Init ---------- */

document.addEventListener("DOMContentLoaded", () => {
  // Run unified search if there is a query param
  const params = new URLSearchParams(window.location.search);
  const input = $("unifiedSearchInput");

  if (params.has("q") && input) {
    input.value = params.get("q") || "";
    handleUnifiedSearch();
  }

  // Enter key on the on-page input
  if (input) {
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleUnifiedSearch();
      }
    });
  }
});
