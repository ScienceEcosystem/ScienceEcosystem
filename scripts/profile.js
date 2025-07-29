const getParam = (name) => new URLSearchParams(location.search).get(name);
const profileContainer = document.getElementById("profileContent");

async function loadProfile() {
  const openAlexId = getParam("id");
  if (!openAlexId) {
    profileContainer.innerHTML = "<p>Missing researcher ID.</p>";
    return;
  }

  try {
    const id = openAlexId.split("/").pop(); // Get just the short ID like "A123456789"
    const res = await fetch(`https://api.openalex.org/authors/${id}`);
    const data = await res.json();

    profileContainer.innerHTML = `
      <h1>${data.display_name}</h1>
      <p><strong>ORCID:</strong> ${data.orcid || "N/A"}</p>
      <p><strong>Affiliation:</strong> ${data.last_known_institution?.display_name || "N/A"}</p>
      <p><strong>Works count:</strong> ${data.works_count}</p>
      <p><strong>Citation count:</strong> ${data.cited_by_count}</p>
      <p><strong>Topics:</strong> ${data.x_concepts?.slice(0, 5).map(c => c.display_name).join(", ") || "None listed"}</p>
      <p><a href="${data.id}" target="_blank">View on OpenAlex</a></p>
    `;
  } catch (err) {
    console.error(err);
    profileContainer.innerHTML = "<p>Error loading profile.</p>";
  }
}

loadProfile();
