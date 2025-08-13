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

async function renderAuthors(authors) {
  const resultsContainer = $("unifiedSearchResults");
  if (!authors.length) return;

  const html = authors
    .map(
      (a) => `
      <div class="result-card" onclick="location.href='profile.html?id=${a.id}'">
        <h3>${escapeHtml(a.display_name)}</h3>
        <p>${escapeHtml(a.last_known_institution?.display_name || "No affiliation")}</p>
      </div>
    `
    )
    .join("");

  resultsContainer.innerHTML += `<h2>Authors</h2>${html}`;
}

async function fetchPapers(query, authorIds = []) {
  try {
    let works = [];

    // If we have author IDs, fetch papers by those authors
    for (const authorId of authorIds) {
      const res = await fetch(`${API_BASE}/works?filter=author.id:${encodeURIComponent(authorId)}&per-page=5`);
      const data = await res.json();
      works = works.concat(data.results || []);
    }

    // Fetch normal works search
    const res = await fetch(`${API_BASE}/works?search=${encodeURIComponent(query)}&per-page=10`);
    const data = await res.json();
    const generalWorks = data.results || [];

    // Merge and remove duplicates
    const seen = new Set();
    const merged = [...works, ...generalWorks].filter((w) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });

    return merged;
  } catch (err) {
    console.error("Work fetch failed", err);
    return [];
  }
}

async function renderPapers(works) {
  const resultsContainer = $("unifiedSearchResults");
  if (!works.length) return;

  const html = works
    .map(
      (w) => `
      <div class="result-card" onclick="location.href='paper.html?id=${w.id}'">
        <h3>${escapeHtml(w.display_name)}</h3>
        <p>${escapeHtml(w.authorships?.map(a => a.author.display_name).join(", ") || "Unknown authors")}</p>
      </div>
    `
    )
    .join("");

  resultsContainer.innerHTML += `<h2>Papers</h2>${html}`;
}

async function fetchAndRenderTopics(query) {
  const sidebar = $("suggestedTopics");

  try {
    const res = await fetch(`${API_BASE}/concepts?search=${encodeURIComponent(query)}&per-page=5`);
    const data = await res.json();

    if (data.results?.length) {
      sidebar.innerHTML = data.results
        .map(
          (t) => `
          <li style="background:#fff; padding:0.5rem; border-radius:8px; margin-bottom:0.5rem; cursor:pointer;"
              onclick="location.href='topic.html?id=${t.id}'">
            ${escapeHtml(t.display_name)}
          </li>
        `
        )
        .join("");
    } else {
      sidebar.innerHTML = "<li>No suggested topics found</li>";
    }
  } catch (err) {
    console.error("Topic fetch failed", err);
    sidebar.innerHTML = "<li>Error loading topics</li>";
  }
}

async function handleUnifiedSearch() {
  const query = $("unifiedSearchInput").value.trim();
  if (!query) return;

  $("unifiedSearchResults").innerHTML = "";
  $("suggestedTopics").innerHTML = "<li>Loading topics...</li>";

  // 1. Fetch authors first
  const authors = await fetchAuthors(query);
  renderAuthors(authors);

  // 2. Fetch papers, prioritizing those by found authors
  const authorIds = authors.map((a) => a.id);
  const works = await fetchPapers(query, authorIds);
  renderPapers(works);

  // 3. Fetch suggested topics
  fetchAndRenderTopics(query);
}

// Event listener
document.addEventListener("DOMContentLoaded", () => {
  const input = $("unifiedSearchInput");

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleUnifiedSearch();
    }
  });

  // Optional: load results if query in URL
  const params = new URLSearchParams(window.location.search);
  if (params.has("q")) {
    input.value = params.get("q");
    handleUnifiedSearch();
  }
});
