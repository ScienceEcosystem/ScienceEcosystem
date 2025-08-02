const $ = (id) => document.getElementById(id);

function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;

  // Very basic DOI check
  if (query.startsWith("10.")) {
    window.location.href = `paper.html?id=${encodeURIComponent(query)}`;
  } else if (query.includes(",")) {
    // For now we assume "Lastname, Firstname" is a researcher
    window.location.href = `profile.html?name=${encodeURIComponent(query)}`;
  } else {
    window.location.href = `paper.html?title=${encodeURIComponent(query)}`;
  }
}

function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[c]));
}

async function handleUnifiedSearch() {
  const input = $("unifiedSearchInput").value.trim();
  const results = $("unifiedSearchResults");
  results.innerHTML = "";

  if (!input) {
    results.innerHTML = "<p>Please enter a search term.</p>";
    return;
  }

  // Simple DOI check for redirect
  if (input.startsWith("10.")) {
    window.location.href = `paper.html?id=${encodeURIComponent(input)}`;
    return;
  }

  results.innerHTML = `<p>Searching: <strong>${escapeHtml(input)}</strong></p>`;

  try {
    // Search authors and works concurrently
    const [authorRes, paperRes] = await Promise.all([
      fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(input)}&per_page=5`),
      fetch(`https://api.openalex.org/works?search=${encodeURIComponent(input)}&per_page=5`)
    ]);

    const authorsData = await authorRes.json();
    const papersData = await paperRes.json();

    let html = "";

    // Authors
    if (authorsData.results?.length > 0) {
      html += "<h3>Researchers</h3><ul>";
      for (const person of authorsData.results) {
        const encodedId = encodeURIComponent(person.id);
        html += `
          <li style="margin-bottom:1rem;">
            <a href="profile.html?id=${encodedId}" style="font-weight: bold;">${escapeHtml(person.display_name)}</a><br/>
            Affiliation: ${person.last_known_institution?.display_name || "N/A"}<br/>
            ORCID: ${person.orcid || "N/A"}
          </li>
        `;
      }
      html += "</ul>";
    }

    // Papers
    if (papersData.results?.length > 0) {
      html += "<h3>Papers</h3><ul>";
      for (const paper of papersData.results) {
        const paperId = encodeURIComponent(paper.doi || paper.id);
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

    if (!html) {
      html = "<p>No results found.</p>";
    }

    results.innerHTML = html;
  } catch (error) {
    console.error(error);
    results.innerHTML = "<p>Error fetching results.</p>";
  }
}
