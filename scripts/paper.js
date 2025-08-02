const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("paperContent");

async function loadPaper() {
  const doi = getParam("id");
  const title = getParam("title");

  try {
    let paper;

    if (doi) {
      const res = await fetch(`https://api.openalex.org/works/https://doi.org/${doi}`);
      paper = await res.json();
    } else if (title) {
      const res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=1`);
      const data = await res.json();
      paper = data.results[0];
    }

    if (!paper) {
      main.innerHTML = "<p>No paper found.</p>";
      return;
    }

    const authors = paper.authorships.map(a =>
      `<a href="profile.html?id=${a.author.id}" style="color:#2563eb;">${a.author.display_name}</a>`
    ).join(", ");
    const venue = paper.host_venue?.display_name || "Unknown Journal";
    const year = paper.publication_year || "N/A";
    const citations = paper.cited_by_count || 0;

    main.innerHTML = `
      <section style="max-width: 800px; margin: auto;">
        <h1 style="font-size: 1.8rem;">${paper.title}</h1>
        <p><strong>Authors:</strong> ${authors}</p>
        <p><strong>Venue:</strong> ${venue}</p>
        <p><strong>Year:</strong> ${year}</p>
        <p><strong>Citations:</strong> ${citations}</p>
        <p><a href="${paper.id}" target="_blank" style="color: #16a34a;">View on OpenAlex</a></p>
      </section>
    `;
  } catch (err) {
    console.error(err);
    main.innerHTML = "<p>Error loading paper.</p>";
  }
}

loadPaper();
