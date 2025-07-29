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
    const pubHtml = works.map(w => `
    <li>
    <strong>${w.title}</strong> (${w.publication_year}) — cited by ${w.cited_by_count || 0}
    </li>`).join("");

    // Co-authors html
    const coHtml = topCo.map(([name,c])=>`<li>${name} (${c} shared papers)</li>`).join("");

    // Affiliations html
    const affHtml = affs.map(a=>`
      <li>${a.institution.display_name} (${a.years.join(", ")})</li>`).join("");

    profileContainer.innerHTML = `
      <h1>${author.display_name}</h1>
      <p><strong>Affiliation:</strong> ${author.last_known_institutions?.map(i=>i.display_name).join(", ") || "N/A"}</p>
      <p><strong>Works:</strong> ${author.works_count} | <strong>Citations:</strong> ${author.cited_by_count}</p>
      <p><strong>H‑index:</strong> ${author.summary_stats?.h_index || "N/A"}</p>
      <p><strong>Topics:</strong> ${author.x_concepts?.slice(0,5).map(c=>c.display_name).join(", ") || "None"}</p>

      <h2>Citation & Publication Trend (last ~10 years)</h2>
      ${trendHtml}

      <h2>Recent Publications</h2>
      <ul>${pubHtml}</ul>

      <h2>Top Co‑authors</h2>
      <ul>${coHtml}</ul>

      <h2>Affiliations Over Time</h2>
      <ul>${affHtml}</ul>

      <p><a href="${author.id}" target="_blank">View full profile on OpenAlex</a></p>
    `;
  } catch (err) {
    console.error(err);
    profileContainer.innerHTML = "<p>Error loading detailed profile.</p>";
  }
}

loadProfile();
