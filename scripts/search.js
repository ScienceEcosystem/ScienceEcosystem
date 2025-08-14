// scripts/search.js
const $ = (id) => document.getElementById(id);
const API_BASE = "https://api.openalex.org";

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

// Fetch papers
async function fetchPapers(query, authorIds = []) {
  let works = [];
  try {
    for (const authorId of authorIds) {
      const res = await fetch(`${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}&per-page=5`);
      const data = await res.json();
      works = works.concat(data.results || []);
    }
    const res = await fetch(`${API_BASE}/works?search=${encodeURIComponent(query)}&per-page=10`);
    const data = await res.json();
    const generalWorks = data.results || [];

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
function renderPapers(works) {
  const results = $("unifiedSearchResults");
  if (!results) return;
  if (works.length === 0) {
    results.innerHTML = "<p>No papers found.</p>";
    return;
  }
  results.innerHTML = "<h2>Papers</h2>" + works.map(w => {
    const paperId = w.doi ? `doi:${encodeURIComponent(w.doi)}` : w.id.split("/").pop();
    return `
      <div class="result-card" onclick="location.href='paper.html?id=${paperId}'">
        <h3>${escapeHtml(w.display_name)}</h3>
        <p>${escapeHtml(w.authorships?.map(a => a.author.display_name).join(", ") || "Unknown authors")}</p>
      </div>
    `;
  }).join("");
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

  $("unifiedSearchResults").innerHTML = "<p>Loading papers...</p>";
  $("researcherList").innerHTML = "<li>Loading authors...</li>";
  $("topicList").innerHTML = "<li>Loading topics...</li>";

  const authors = await fetchAuthors(query);
  renderAuthors(authors);

  const authorIds = authors.map(a => a.id);
  const papers = await fetchPapers(query, authorIds);
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
