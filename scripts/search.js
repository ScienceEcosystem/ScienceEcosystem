// Utility to get element by ID
const $ = (id) => document.getElementById(id);

function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[c]));
}

/**
 * Runs when user presses Enter or clicks search.
 * On homepage: redirects to search.html?q=query
 * On search page: updates URL and loads results
 */
function handleSearch(inputId) {
  const inputEl = $(inputId);
  if (!inputEl) return;

  const query = inputEl.value.trim();
  if (!query) return;

  if (inputId === "searchInput") {
    // Homepage → redirect to search.html
    window.location.href = `search.html?q=${encodeURIComponent(query)}`;
  } else {
    // Search page → update URL and load results
    window.history.replaceState(null, "", `?q=${encodeURIComponent(query)}`);
    handleUnifiedSearch();
  }
}

/**
 * Fetch results from OpenAlex and update DOM
 */
async function handleUnifiedSearch() {
  const results = $("unifiedSearchResults");
  const sidebar = $("suggestedTopics");

  if (!results || !sidebar) return; // Not on search page

  const urlParams = new URLSearchParams(window.location.search);
  const input = urlParams.get("q")?.trim() || "";

  $("unifiedSearchInput").value = input;

  if (!input) {
    results.innerHTML = "<p>Please enter a search term.</p>";
    sidebar.innerHTML = "";
    return;
  }

  results.innerHTML = `<p>Searching: <strong>${escapeHtml(input)}</strong></p>`;
  sidebar.innerHTML = "";

  try {
    if (input.startsWith("10.")) {
      // DOI detected
      window.location.href = `paper.html?id=${encodeURIComponent(input)}`;
      return;
    }

    const [authorRes, paperRes, topicRes] = await Promise.all([
      fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(input)}&per_page=5`),
      fetch(`https://api.openalex.org/works?search=${encodeURIComponent(input)}&per_page=5`),
      fetch(`https://api.openalex.org/concepts?search=${encodeURIComponent(input)}&per_page=5`)
    ]);

    const authors = (await authorRes.json()).results || [];
    const papers = (await paperRes.json()).results || [];
    const topics = (await topicRes.json()).results || [];

    let html = "";

    // Researchers
    if (authors.length > 0) {
      html += "<h2>Researchers</h2><ul>";
      for (const person of authors) {
        const id = person.id.split("/").pop();
        html += `
          <li style="margin-bottom:1rem;">
            <a href="profile.html?id=${id}">${escapeHtml(person.display_name)}</a><br/>
            Affiliation: ${person.last_known_institution?.display_name || "N/A"}<br/>
            ORCID: ${person.orcid || "N/A"}
          </li>`;
      }
      html += "</ul>";
    }

    // Papers
    if (papers.length > 0) {
      html += "<h2>Papers</h2><ul>";
      for (const paper of papers) {
        const paperId = paper.doi
          ? `doi:${encodeURIComponent(paper.doi)}`
          : paper.id.split("/").pop();

        html += `
          <li style="margin-bottom:1rem;">
            <a href="paper.html?id=${paperId}">${escapeHtml(paper.title)}</a><br/>
            Authors: ${escapeHtml(paper.authorships.map(a => a.author.display_name).join(", "))}<br/>
            Venue: ${paper.host_venue?.display_name || "N/A"} (${paper.publication_year || "N/A"})
          </li>`;
      }
      html += "</ul>";
    }

    // Suggested topics
    if (topics.length > 0) {
      sidebar.innerHTML = "<ul>";
      for (const topic of topics) {
        const tid = topic.id.split("/").pop();
        sidebar.innerHTML += `
          <li style="margin-bottom: 0.5rem;">
            <a href="topic.html?id=${tid}" title="${escapeHtml(topic.description || '')}">
              ${escapeHtml(topic.display_name)}
            </a>
          </li>`;
      }
      sidebar.innerHTML += "</ul>";
    } else {
      sidebar.innerHTML = "<p>No suggested topics found.</p>";
    }

    if (!html) html = "<p>No results found.</p>";
    results.innerHTML = html;

  } catch (error) {
    console.error(error);
    results.innerHTML = "<p>Error loading results.</p>";
    sidebar.innerHTML = "";
  }
}

/**
 * Initialize search bar events for homepage and search page
 */
function initSearchBar() {
  const homepageInput = $("searchInput");
  const searchPageInput = $("unifiedSearchInput");

  if (homepageInput) {
    homepageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSearch("searchInput");
    });
  }

  if (searchPageInput) {
    searchPageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSearch("unifiedSearchInput");
    });

    // Auto-load results if ?q= exists
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) handleUnifiedSearch();
  }
}

// Run setup
initSearchBar();





