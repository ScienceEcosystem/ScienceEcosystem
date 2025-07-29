const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("profileMain");
const sidebar = document.getElementById("profileSidebar");

function renderTrend(counts) {
  const years = counts.map(c => c.year);
  const works = counts.map(c => c.works_count);
  const cites = counts.map(c => c.cited_by_count);
  const maxC = Math.max(...cites);
  return `
    <svg width="100%" height="200">
      ${counts.map((c, i) => {
        const x = (i / (counts.length - 1)) * 100;
        const wy = 150 - (c.works_count / maxC) * 150;
        const cy = 150 - (c.cited_by_count / maxC) * 150;
        return `
          <circle cx="${x}%" cy="${wy}" r="3" fill="#2563eb" />
          <circle cx="${x}%" cy="${cy}" r="3" fill="#e11d48" />
        `;
      }).join("")}
      ${counts.map((c, i) =>
        `<text x="${(i / (counts.length - 1)) * 100}%" y="180" font-size="10" text-anchor="middle">${c.year}</text>`
      ).join("")}
      <text x="5%" y="15" fill="#2563eb" font-size="12">Works</text>
      <text x="90%" y="15" fill="#e11d48" font-size="12">Citations</text>
    </svg>
  `;
}

async function loadProfile() {
  const param = getParam("id");
  if (!param) {
    main.innerHTML = "<p>Missing researcher ID.</p>";
    return;
  }
  const authorId = param.split("/").pop();

  try {
    const resp = await fetch(`https://api.openalex.org/authors/${authorId}`);
    const author = await resp.json();

    const worksRes = await fetch(author.works_api_url + "&per_page=100");
    const worksData = await worksRes.json();
    const works = worksData.results || [];

    const coAuthorMap = {};
    works.forEach(w => {
      w.authorships.forEach(a => {
        if (a.author.id !== author.id) {
          coAuthorMap[a.author.display_name] = (coAuthorMap[a.author.display_name] || 0) + 1;
        }
      });
    });
    const topCoauthors = Object.entries(coAuthorMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => `<li>${name} (${count} collaborations)</li>`)
      .join("");

    const affiliations = (author.affiliations || [])
      .map(a => `<li>${a.institution.display_name} (${a.years.join(", ")})</li>`)
      .join("");

    const pubHtml = works.map(w => {
      const authors = w.authorships?.map(a => a.author.display_name).join(", ") || "Unknown authors";
      const journal = w.host_venue?.display_name || "Unknown journal";
      const year = w.publication_year || "N/A";
      const link = w.id || "#";

      return `
        <li style="margin-bottom: 1rem;">
          <p style="font-weight: bold; margin-bottom: 0.2rem;">
            <a href="${link}" target="_blank" rel="noopener" style="color: #2563eb;">${w.title}</a>
          </p>
          <p style="margin: 0.2rem 0;"><strong>Authors:</strong> ${authors}</p>
          <p style="margin: 0.2rem 0;"><strong>Journal:</strong> ${journal}</p>
          <p style="margin: 0.2rem 0;"><strong>Year:</strong> ${year}</p>
        </li>
      `;
    }).join("");

    const trendHtml = renderTrend(author.counts_by_year || []);

    // Top section
    main.innerHTML = `
      <section style="margin-bottom: 2rem;">
        <h1 style="font-size: 2rem;">${author.display_name}</h1>
        <p><strong>ORCID:</strong> ${author.orcid || "N/A"}</p>
        <p><strong>Affiliation:</strong> ${author.last_known_institution?.display_name || "N/A"}</p>
        <p><a href="${author.id}" target="_blank" rel="noopener">View on OpenAlex</a></p>
      </section>

      <section>
        <h2 style="font-size: 1.5rem; margin-top: 2rem;">Publications (${works.length})</h2>
        <ul style="padding-left: 1rem; list-style: disc;">
          ${pubHtml}
        </ul>
      </section>
    `;

    sidebar.innerHTML = `
      <section style="margin-bottom: 2rem;">
        <h3>Citation & Work Trend</h3>
        ${trendHtml}
      </section>

      <section style="margin-bottom: 2rem;">
        <h3>Top Co-authors</h3>
        <ul style="padding-left: 1rem; list-style: disc;">
          ${topCoauthors}
        </ul>
      </section>

      <section>
        <h3>Past Affiliations</h3>
        <ul style="padding-left: 1rem; list-style: disc;">
          ${affiliations}
        </ul>
      </section>
    `;
  } catch (err) {
    console.error(err);
    main.innerHTML = "<p>Error loading profile.</p>";
  }
}

loadProfile();

