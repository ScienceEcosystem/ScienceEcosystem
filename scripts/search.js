const $ = (id) => document.getElementById(id);

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
    results.innerHTML = "<p>Please enter a researcher name.</p>";
    return;
  }

  results.innerHTML = `<p>Searching for researchers matching: <strong>${escapeHtml(input)}</strong></p>`;

  try {
    const response = await fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(input)}&per_page=5`);
    if (!response.ok) {
      results.innerHTML = "<p>Error fetching data from OpenAlex.</p>";
      return;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      results.innerHTML = "<p>No researchers found.</p>";
      return;
    }

    // Render researcher list
    let html = "<h3>Researchers Found</h3><ul>";
    data.results.forEach(person => {
      html += `
        <li style="margin-bottom:1rem;">
          <strong>${escapeHtml(person.display_name)}</strong><br/>
          ORCID: ${person.orcid ? escapeHtml(person.orcid) : "N/A"}<br/>
          Affiliation: ${person.last_known_institution?.display_name ? escapeHtml(person.last_known_institution.display_name) : "N/A"}<br/>
          <a href="${person.id}" target="_blank" rel="noopener">OpenAlex Profile</a>
        </li>
      `;
    });
    html += "</ul>";

    results.innerHTML = html;

  } catch (error) {
    console.error(error);
    results.innerHTML = "<p>There was an error processing your request.</p>";
  }
}
