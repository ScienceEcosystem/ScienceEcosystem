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

function handleSearch() {
  const input = $("searchInput").value.trim();
  if (!input) return;

  // Always redirect to search results page, no immediate profile or paper redirect
  window.location.href = `search.html?q=${encodeURIComponent(input)}`;
}

// 🧠 Results on a full search page (e.g. search.html)
async function handleUnifiedSearch() {
  const input = $("unifiedSearchInput").value.trim();
  const results = $("unifiedSearchResults");
  results.innerHTML = "";

  if (!input) {
    results.innerHTML = "<p>Please enter a search term.</p>";
    return;
  }

  if (input.startsWith("10.")) {
    window.location.href = `paper.html?id=${encodeURIComponent(input)}`;
    return;
  }

  results.innerHTML = `<p>Searching: <strong>${escapeHtml(input)}</strong></p>`;

  try {
    const [authorRes, paperRes] = await Promise.all([
      fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(input)}&per_page=5`),
      fetch(`https://api.openalex.org/works?search=${encodeURIComponent(input)}&per_page=5`)
    ]);

    const authors = (await authorRes.json()).results || [];
    const papers = (await paperRes.json()).results || [];

    let html = "";

    if (authors.length > 0) {
      html += "<h3>Researchers</h3><ul>";
      for (const person of authors) {
        const id = person.id.split("/").pop();
        html += `
          <li style="margin-bottom:1rem;">
            <a href="profile.html?id=${id}" style="font-weight: bold;">${escapeHtml(person.display_name)}</a><br/>
            Affiliation: ${person.last_known_institution?.display_name || "N/A"}<br/>
            ORCID: ${person.orcid || "N/A"}
          </li>
        `;
      }
      html += "</ul>";
    }

    if (papers.length > 0) {
      html += "<h3>Papers</h3><ul>";
      for (const paper of papers) {
        const paperId = paper.doi
          ? `doi:${encodeURIComponent(paper.doi)}`
          : paper.id.replace("https://openalex.org/", "");

        html += `
          <li style="margin-bottom:1rem;">
            <a href="paper.html?id=${paperId}" style="font-weight: bold;">${escapeHtml(paper.title)}</a><br/>
            Authors: ${escapeHtml(paper.authorships.map(a => a.author.display_name).join(", "))}<br/>
            Venue: ${paper.host_venue?.display_name || "N/A"} (${paper.publication_year || "N/A"})
          </li>
        `;
      }
      html += "</ul>";
    }

    if (!html) html = "<p>No results found.</p>";
    results.innerHTML = html;
  } catch (error) {
    console.error(error);
    results.innerHTML = "<p>Error fetching results.</p>";
  }
}
