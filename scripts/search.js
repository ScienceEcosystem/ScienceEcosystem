// scripts/search.js
const $ = (id) => document.getElementById(id);
const API_BASE = "https://api.openalex.org";

let currentPage = 1;
let currentQuery = "";
let currentAuthorIds = [];
let totalResults = 0;

function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[c])
  );
}

// Fetch authors
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

// Render authors in researcherList
function renderAuthors(authors) {
  const researcherList = $("researcherList");
  if (!researcherList) return;
  researcherList.innerHTML = authors.length
    ? authors.map(a => `
      <li style="background:#fff; padding:0.5rem; border-radius:8px; margin-bottom:0.5rem; cursor:pointer;"
          onclick="location.href='profile.html?id=${a.id.split("/").pop()}'">
        ${escapeHtml(a.display_name)}<br/>
        ${escapeHtml(a.last_known_institution?.display_name || "No affiliation")}
      </li>
    `).join("")
    : "<li>No authors found.</li>";
}

// Fetch papers (with pagination)
async function fetchPapers(query, authorIds = [], page = 1) {
  let works = [];
  try {
    for (const authorId of authorIds) {
      const res = await fetch(`${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}&per-page=5&page=${page}`);
      const data = await res.json();
      works = works.concat(data.results || []);
    }

    const res = await fetch(`${API_BASE}/works?search=${encodeURIComponent(query)}&per-page=100&page=${page}`);
    const data = await res.json();
    const generalWorks = data.results || [];
    if (page === 1) {
      totalResults = data.meta?.count || generalWorks.length;
    }

    const seen = new Set();
    return [...works, ...generalWorks].filter(w => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });
  } catch (err) {
    console.error("Paper fetch failed", err);
    return [];
  }
}

// Render papers
function renderPapers(works, append = false) {
  const results = $("unifiedSearchResults");
  if (!results) return;

  if (!append) {
    results.innerHTML = `
      <h2>Papers (${totalResults.toLocaleString()} results)</h2>
      <div id="papersList"></div>
      <div id="pagination"></div>
    `;
  }

  const papersList = $("papersList");
  if (!papersList) return;

  works.forEach((w, index) => {
    const paperId = w.doi ? `doi:${encodeURIComponent(w.doi)}` : w.id.split("/").pop();
    const authorsHtml = (w.authorships || [])
      .map(a => `<a href="profile.html?id=${a.author.id.split('/').pop()}">${escapeHtml(a.author.display_name)}</a>`)
      .join(", ");

    const venue = w.host_venue?.display_name || "Unknown venue";
    const citations = w.cited_by_count || 0;

    const number = ((currentPage - 1) * 100) + index + 1;

    papersList.innerHTML += `
      <div class="result-card">
        <h3>${number}. <a href="paper.html?id=${paperId}">${escapeHtml(w.display_name)}</a></h3>
        <p><strong>Authors:</strong> ${authorsHtml || "Unknown authors"}</p>
        <p><strong>Published in:</strong> ${escapeHtml(venue)}</p>
        <p><strong>Citations:</strong> ${citations}</p>
      </div>
    `;
  });

  // Show "Load More" if more results remain
  const pagination = $("pagination");
  const resultsShown = currentPage * 100;
  if (resultsShown < totalResults) {
    pagination.innerHTML = `
      <button id="loadMoreBtn" style="margin-top:1rem; padding:0.5rem 1rem;">
        Load More
      </button>
    `;
    $("loadMoreBtn").onclick = async () => {
      currentPage++;
      const moreWorks = await fetchPapers(currentQuery, currentAuthorIds, currentPage);
      renderPapers(moreWorks, true);
    };
  } else {
    pagination.innerHTML = `<p>All results loaded.</p>`;
  }
}

// Fetch topics
async function fetchAndRenderTopics(query) {
  const topicList = $("topicList");
  if (!topicList) return;
  try {
    const res = await fetch(`${API_BASE}/concepts?search=${encodeURIComponent(query)}&per-page=5`);
    const data = await res.json();
    const topics = data.results || [];
    topicList.innerHTML = topics.length
      ? topics.map(t => `
        <li style="background:#fff; padding:0.5rem; border-radius:8px; margin-bottom:0.5rem; cursor:pointer;"
            onclick="location.href='topic.html?id=${t.id.split("/").pop()}'">
          ${escapeHtml(t.display_name)}
        </li>
      `).join("")
      : "<li>No topics found.</li>";
  } catch (err) {
    console.error("Topic fetch failed", err);
  }
}

// Unified search handler
async function handleUnifiedSearch() {
  const input = $("unifiedSearchInput");
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;

  currentQuery = query;
  currentPage = 1;

  $("unifiedSearchResults").innerHTML = "<p>Loading papers...</p>";
  $("researcherList").innerHTML = "<li>Loading authors...</li>";
  $("topicList").innerHTML = "<li>Loading topics...</li>";

  const authors = await fetchAuthors(query);
  renderAuthors(authors);

  currentAuthorIds = authors.map(a => a.id);
  const papers = await fetchPapers(query, currentAuthorIds, currentPage);
  renderPapers(papers);

  fetchAndRenderTopics(query);
}

// Homepage search redirect
function handleSearch(inputId) {
  const input = $(inputId);
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;
  window.location.href = `search.html?q=${encodeURIComponent(query)}`;
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  const input = $("unifiedSearchInput");
  if (input) {
    input.addEventListener("keypress", e => {
      if (e.key === "Enter") handleUnifiedSearch();
    });

    const params = new URLSearchParams(window.location.search);
    if (params.has("q")) {
      input.value = params.get("q");
      handleUnifiedSearch();
    }
  }
});
