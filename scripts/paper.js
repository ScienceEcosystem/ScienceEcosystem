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

    const title = paper.title;
    const firstAuthor = paper.authorships?.[0]?.author?.display_name || "Unknown";
    const allAuthors = paper.authorships.map(a => a.author.display_name);
    const formattedAuthors = allAuthors.length === 1
      ? allAuthors[0]
      : allAuthors.length === 2
        ? `${allAuthors[0]} & ${allAuthors[1]}`
        : `${allAuthors[0]} et al.`;
    const venue = paper.host_venue?.display_name || "Unknown Journal";
    const year = paper.publication_year || "n.d.";
    const doi = paper.doi || "";

    const fullCitation = `${allAuthors.join(", ")} (${year}). ${title}. <i>${venue}</i>. https://doi.org/${doi}`;
    const inTextCitation = `(${formattedAuthors}, ${year})`;
    const presentationCitation = `${formattedAuthors}, ${venue}, ${year}`;

    const citations = paper.cited_by_count ?? "N/A";
    const abstract = paper.abstract_inverted_index
      ? Object.keys(paper.abstract_inverted_index).join(" ")
      : "No abstract available.";

    // 🔍 Check for PDF using Unpaywall if DOI is available
    let pdfLink = null;
    if (paper.doi) {
      try {
        const upwRes = await fetch(`https://api.unpaywall.org/v2/${paper.doi}?email=scienceecosystem@icloud.com`);
        if (upwRes.ok) {
          const upwData = await upwRes.json();
          pdfLink = upwData?.best_oa_location?.url_for_pdf || null;
        }
      } catch (e) {
        console.warn("Unpaywall fetch failed:", e);
      }
    }

    main.innerHTML = `
      <section style="max-width: 800px; margin: auto;">
        <h1 style="font-size: 1.8rem;">${paper.title}</h1>
        <p><strong>Authors:</strong> ${authors}</p>
        <p><strong>Venue:</strong> ${venue}</p>
        <p><strong>Year:</strong> ${year}</p>
        <p><strong>Citations:</strong> ${citations}</p>
        <div style="margin-top: 1rem; margin-bottom: 1rem;">
      <h3 style="margin-bottom: 0.3rem;">📚 How to cite</h3>
      <p><strong>Full citation:</strong><br><code style="user-select: all;">${fullCitation}</code></p>
      <p><strong>In-text citation:</strong><br><code style="user-select: all;">${inTextCitation}</code></p>
      <p><strong>For presentations:</strong><br><code style="user-select: all;">${presentationCitation}</code></p>
    </div>
        <p><strong>Abstract:</strong><br>${abstract}</p>
        ${pdfLink
          ? `<p><a href="${pdfLink}" target="_blank" style="color: #0ea5e9;">📄 Download PDF (Open Access)</a></p>`
          : `<p style="color: gray;">No PDF available from Unpaywall.</p>`
        }
        <p><a href="${paper.id}" target="_blank" style="color: #16a34a;">View on OpenAlex ↗</a></p>
      </section>
    `;
  } catch (err) {
    console.error("Paper fetch error:", err);
    main.innerHTML = "<p>Error loading paper details. Check the ID or try again later.</p>";
  }
}

loadPaper();
