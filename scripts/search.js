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

// Fetch authors matching the query
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

// Render authors in sidebar
function renderAuthors(authors) {
  const sidebar = $("topicSidebar");
  if (!sidebar) return;

  let html = "";
  if (authors.length > 0) {
    html += "<h3>Authors</h3><ul style='list-style:none; padding-left:0;'>";
    for (const a of authors) {
      const id = a.id.split("/").pop();
      html += `<li style="background:#fff; padding:0.5rem; border-radius:8px; margin-bottom:0.5rem; cursor:pointer;"
                   onclick="location.href='profile.html?id=${id}'">
                ${escapeHtml(a.display_name)}<br/>
                ${escapeHtml(a.last_known_institution?.display_name || "No affiliation")}
               </li>`;
    }
    html += "</ul>";
  }
  sidebar.innerHTML = html; // initialize with authors only, topics added later
}

// Fetch papers, prioritizing author IDs
async function fetchPapers(query, authorIds = []) {
  let works = [];
  try {
    // Fetch papers by authors
    for (const authorId of authorIds) {
      const res = await fetch(`${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}&per-page=5`);
      const data = await res.json();
      works = works.concat(data.results || []);
    }

    // Fetch general papers matching query
    const res = await fetch(`${API_BASE}/works?search=${encodeURIComponent(query)}&per-page=10`);
    const data = await res.json();
    const generalWorks = data.results || [];

    // Merge and remove duplicates
    const seen = new Set();
    const merged = [...works, ...generalWorks].filter(w => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });

    return merged;
  } catch (err) {
    console.error("Paper fetch failed", err);
    return [];
  }
}

// Render papers in main area
function renderPapers(works) {
  const results = $("unifiedSearchResults");
  if (!results) return;

  if (works.length === 0) {
    results.innerHTML = "<p>No papers found.</p>";
    return;
  }

  let html = "<h2>Papers</h2>";
  for (const w of works) {
    const paperId = w.doi ? `doi:${encodeURIComponent(w.doi)}` : w.id.split("/").pop();
    html += `<div class="result-card" onclick="location.href='paper.html?id=${paperId}'">
               <h3>${escapeHtml(w.display_name)}</h3>
               <p>${escapeHtml(w.authorships?.map(a => a.author.display_name).join(", ") || "Unknown authors")}</p>
             </div>`;
  }
  results.innerHTML = html;
}

// Fetch suggested topics
async function fetchAndRenderTopics(query) {
  const sidebar = $("topicSidebar");
  if (!sidebar) return;

  try {
    const res = await fetch(`${API_BASE}/concepts?search=${encodeURIComponent(query)}&per-page=5`);
    const data = await res.json();
    const topics = data.results || [];

    if (topics.length > 0) {
      let html = sidebar.innerHTML; // keep existing authors content
      html += "<h3>Suggested Topics</h3><ul style='list-style:none; padding-left:0;'>";
      for (const t of topics) {
        const tid = t.id.split("/").pop();
        html += `<li style="background:#fff; padding:0.5rem; border-radius:8px; margin-bottom:0.5rem; cursor:pointer;"
                    onclick="location.href='topic.html?id=${tid}'">
                  ${escapeHtml(t.display_name)}
                 </li>`;
      }
      html += "</ul>";
      sidebar.innerHTML = html;
    }
  } catch (err) {
    console.error("Topic fetch failed", err);
  }
}

// Handle unified search
async function handleUnifiedSearch() {
  const input = $("unifiedSearchInput");
  if (!input) return;
  const query = input.value.trim();
  if (!query) return;

  $("unifiedSearchResults").innerHTML = "<p>Loading papers...</p>";
  $("topicSidebar").innerHTML = "<p>Loading authors and topics...</p>";

  // Step 1: fetch authors
  const authors = await fetchAuthors(query);
  renderAuthors(authors);

  // Step 2: fetch papers, prioritize by authors
  const authorIds = authors.map(a => a.id);
  const papers = await fetchPapers(query, authorIds);
  renderPapers(papers);

  // Step 3: fetch suggested topics
  fetchAndRenderTopics(query);
}

// Initialize search bar
document.addEventListener("DOMContentLoaded", () => {
  const input = $("unifiedSearchInput");
  if (!input) return;

  input.addEventListener("keypress", e => {
    if (e.key === "Enter") handleUnifiedSearch();
  });

  // Auto-load if ?q= in URL
  const params = new URLSearchParams(window.location.search);
  if (params.has("q")) {
    input.value = params.get("q");
    handleUnifiedSearch();
  }
});

