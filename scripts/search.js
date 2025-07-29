const $ = (id) => document.getElementById(id);
const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i;

function setLoading(isLoading) {
  const input = $("unifiedSearchInput");
  const button = input.nextElementSibling;
  if (isLoading) {
    input.disabled = true;
    button.disabled = true;
    button.textContent = "Searching...";
  } else {
    input.disabled = false;
    button.disabled = false;
    button.textContent = "Search";
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

  setLoading(true);

  try {
    // Simple heuristic: if input looks like a person name (2 capitalized words)
    const isProbablyPerson = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(input);

    if (isProbablyPerson) {
      results.innerHTML = `<p>Searching for researcher: <strong>${escapeHtml(input)}</strong></p>`;
      const res = await fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(input)}&per_page=5`);
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        results.innerHTML += "<h3>Researchers</h3><ul>";
        data.results.forEach(person => {
          results.innerHTML += `
            <li style="margin-bottom:0.5rem; cursor:pointer" onclick="window.open('${person.id}', '_blank')">
              <strong>${escapeHtml(person.display_name)}</strong> (${person.orcid ? `ORCID: ${person.orcid}` : "No ORCID"})<br/>
              ${escapeHtml(person.last_known_institution?.display_name || "No affiliation")}<br/>
              <a href="${person.id}" target="_blank" rel="noopener">OpenAlex Profile</a>
            </li>
          `;
        });
        results.innerHTML += "</ul>";
      } else {
        results.innerHTML = "<p>No researchers found.</p>";
      }
    } else {
      results.innerHTML = `<p>Searching for paper: <strong>${escapeHtml(input)}</strong></p>`;
      const res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(input)}&per_page=5`);
      const data = await res.json();

      if (data.results && data.results.length > 0) {
        results.innerHTML += "<h3>Papers</h3><ul>";
        data.results.forEach(paper => {
          results.innerHTML += `
            <li style="margin-bottom:0.5rem; cursor:pointer" onclick="window.open('${paper.id}', '_blank')">
              <strong>${escapeHtml(paper.title || paper.display_name || "Untitled")}</strong><br/>
              Authors: ${paper.authorships?.map(a => escapeHtml(a.author.display_name)).join(", ") || "Unknown"}<br/>
              Published: ${paper.publication_year || "N/A"}<br/>
              <a href="${paper.id}" target="_blank" rel="noopener">OpenAlex Link</a>
            </li>
          `;
        });
        results.innerHTML += "</ul>";
      } else {
        results.innerHTML = "<p>No papers found.</p>";
      }
    }
  } catch (err) {
    console.error(err);
    results.innerHTML = "<p>Error fetching results.</p>";
  } finally {
    setLoading(false);
  }
}

