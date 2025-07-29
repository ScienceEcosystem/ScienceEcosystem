const getParam = (name) => new URLSearchParams(location.search).get(name);
const profileContainer = document.getElementById("profileContent");

// Simple in-page chart rendering
function renderTrend(counts) {
  const years = counts.map(c => c.year);
  const works = counts.map(c => c.works_count);
  const cites = counts.map(c => c.cited_by_count);
  const maxC = Math.max(...cites);
  return `
    <svg width="100%" height="200">
      ${counts.map((c,i) => {
        const x = (i / (counts.length-1))*100;
        const wy = 150 - (c.works_count/maxC)*150;
        const cy = 150 - (c.cited_by_count/maxC)*150;
        return `
          <circle cx="${x}%" cy="${wy}" r="3" fill="#2563eb" />
          <circle cx="${x}%" cy="${cy}" r="3" fill="#e11d48" />
        `;
      }).join("")}
      <!-- axis labels -->
      ${counts.map((c,i)=>
        `<text x="${(i/(counts.length-1))*100}%" y="180" font-size="10" text-anchor="middle">${c.year}</text>`
      ).join("")}
      <text x="5%" y="15" fill="#2563eb" font-size="12">Works</text>
      <text x="90%" y="15" fill="#e11d48" font-size="12">Citations</text>
    </svg>
  `;
}

async function loadProfile() {
  const param = getParam("id");
  if (!param) { profileContainer.innerHTML = "<p>Missing researcher ID.</p>"; return; }
  const authorId = param.split("/").pop();

  try {
    const resp = await fetch(`https://api.openalex.org/authors/${authorId}`);
    const author = await resp.json();

    // Get works list
    const worksRes = await fetch(author.works_api_url + "&per_page=100");
    const worksData = await worksRes.json();
    const works = worksData.results || [];

    // Build co-author counts
    const coAuthorMap = {};
    works.forEach(w => {
      w.authorships.forEach(a => {
        if (a.author.id !== author.id) {
          coAuthorMap[a.author.display_name] = (coAuthorMap[a.author.display_name] || 0) + 1;
        }
      });
    });
    const topCo = Object.entries(coAuthorMap)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10);

    // Affiliations history
    const affs = author.affiliations || [];

    // Trends
    const trendHtml = renderTrend(author.counts_by_year || []);

    // Publications html (all works)
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

    // Co-authors html
    const coHtml = topCo.map(([name,c])=>`<li>${name} (${c} shared papers)</li>`).join("");

    // Affiliations html
    const affHtml = affs.map(a=>`
      <li>${a.institution.display_name} (${a.years.join(", ")})</li>`).join("");

    profileContainer.innerHTML = `
  <section style="margin-bottom: 2rem;">
    <h1 style="font-size: 2rem; margin-bottom: 0.5rem;">${data.display_name}</h1>
    <p><strong>ORCID:</strong> ${data.orcid || "N/A"}</p>
    <p><strong>Affiliation:</strong> ${data.last_known_institution?.display_name || "N/A"}</p>
    <p><strong>Works count:</strong> ${data.works_count}</p>
    <p><strong>Citation count:</strong> ${data.cited_by_count}</p>
    <p><strong>Topics:</strong> ${data.x_concepts?.slice(0, 5).map(c => c.display_name).join(", ") || "None listed"}</p>
    <p><a href="${data.id}" target="_blank" rel="noopener">View on OpenAlex</a></p>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.5rem;">Top Co-authors</h2>
    <ul style="padding-left: 1rem; list-style: disc;">
      ${topCoauthors.map(c => `<li>${c.name} (${c.count} collaborations)</li>`).join("")}
    </ul>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.5rem;">Past Affiliations</h2>
    <ul style="padding-left: 1rem; list-style: disc;">
      ${affiliations.map(a => `<li>${a}</li>`).join("")}
    </ul>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.5rem;">Citation Trend</h2>
    <div style="max-width: 600px;">
      <canvas id="citationChart"></canvas>
    </div>
  </section>

  <section style="margin-bottom: 2rem;">
    <h2 style="font-size: 1.5rem;">Publications (${works.length})</h2>
    <ul style="padding-left: 1rem; list-style: disc;">
      ${pubHtml}
    </ul>
  </section>
`;

  } catch (err) {
    console.error(err);
    profileContainer.innerHTML = "<p>Error loading detailed profile.</p>";
  }
}

loadProfile();
