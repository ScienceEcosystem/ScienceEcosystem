const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("paperContent");

async function loadPaper() {
  const id = getParam("id");
  if (!id) {
    main.innerHTML = "<p>No paper ID provided.</p>";
    return;
  }

  let apiUrl;
  if (id.startsWith("doi:")) {
    apiUrl = `https://api.openalex.org/works/${id}`;
  } else if (id.startsWith("10.")) {
    apiUrl = `https://api.openalex.org/works/doi:${encodeURIComponent(id)}`;
  } else {
    apiUrl = `https://api.openalex.org/works/${id}`;
  }

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error("Failed to fetch paper");
    const paper = await res.json();

    const authors = paper.authorships.map(a =>
      `<a href="profile.html?id=${a.author.id.split('/').pop()}" style="color:#2563eb;">${a.author.display_name}</a>`
    ).join(", ");

    const venue = paper.host_venue?.display_name || "Unknown Journal";
    const year = paper.publication_year || "N/A";
    const citations = paper.cited_by_count ?? "N/A";
    const abstract = paper.abstract_inverted_index
      ? Object.keys(paper.abstract_inverted_index).join(" ")
      : "No abstract available.";

    main.innerHTML = `
      <section style="max-width: 800px; margin: auto;">
        <h1 style="font-size: 1.8rem;">${paper.title}</h1>
        <p><strong>Authors:</strong> ${authors}</p>
        <p><strong>Venue:</strong> ${venue}</p>
        <p><strong>Year:</strong> ${year}</p>
        <p><strong>Citations:</strong> ${citations}</p>
        <p><strong>Abstract:</strong><br>${abstract}</p>
        <p><a href="${paper.id}" target="_blank" style="color: #16a34a;">View on OpenAlex ↗</a></p>
      </section>
    `;
  } catch (err) {
    console.error("Paper fetch error:", err);
    main.innerHTML = "<p>Error loading paper details. Check the ID or try again later.</p>";
  }
}

loadPaper();
