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

// Triggered when user presses Enter in search bar
function handleSearch() {
  const input = $("unifiedSearchInput").value.trim();
  if (!input) return;
  // Update URL and reload results
  window.history.replaceState(null, "", `?q=${encodeURIComponent(input)}`);
  handleUnifiedSearch();
}

// Load results on page load and when search is triggered
async function handleUnifiedSearch() {
  const urlParams = new URLSearchParams(window.location.search);
  const input = urlParams.get("q")?.trim() || "";
  const results = $("unifiedSearchResults");
  const sidebar = $("suggestedTopics");

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
      // Just display a note; links below will be clickable
      results.innerHTML += `<p>Detected DOI. Please click on paper titles to view details.</p>`;
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

document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("unifiedSearchInput");
  if (searchInput) {
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        handleSearch();
      }
    });
  }

  // Run initial search if query present in URL
  handleUnifiedSearch();
});



// Run search if query param present on page load
if (window.location.pathname.endsWith("search.html")) {
  handleUnifiedSearch();
}
