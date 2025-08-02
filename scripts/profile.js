const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("profileMain");
const sidebar = document.getElementById("profileSidebar");

function renderBarChart(counts) {
  const years = counts.map(c => c.year);
  const works = counts.map(c => c.works_count);
  const cites = counts.map(c => c.cited_by_count);
  const max = Math.max(...works, ...cites);

  return `
    <svg width="100%" height="220">
      ${counts.map((c, i) => {
        const barWidth = 20;
        const spacing = 30;
        const x = i * spacing;
        const workHeight = (c.works_count / max) * 150;
        const citeHeight = (c.cited_by_count / max) * 150;
        return `
          <rect x="${x}" y="${170 - workHeight}" width="8" height="${workHeight}" fill="#2563eb" />
          <rect x="${x + 10}" y="${170 - citeHeight}" width="8" height="${citeHeight}" fill="#e11d48" />
          <text x="${x + 10}" y="200" font-size="10" text-anchor="middle">${c.year}</text>
        `;
      }).join("")}
      <text x="10" y="15" fill="#2563eb" font-size="12">Works</text>
      <text x="100" y="15" fill="#e11d48" font-size="12">Citations</text>
    </svg>
  `;
}

function sortWorks(works, criteria) {
  if (criteria === "year") {
    return [...works].sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0));
  }
  if (criteria === "citations") {
    return [...works].sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
  }
  return works;
}

function renderPublications(works, authorId) {
  return works.map(w => {
    const authors = w.authorships?.map(a => {
      if (a.author.id && a.author.id !== authorId) {
        return `<a href="profile.html?id=${a.author.id}" style="color: #0d9488;">${a.author.display_name}</a>`;
      }
      return a.author.display_name;
    }).join(", ") || "Unknown authors";

    const journal = w.host_venue?.display_name || "Unknown journal";
    const year = w.publication_year || "N/A";
    const link = w.id || "#";

    return `
      <li style="margin-bottom: 1rem;">
        <p style="font-weight: bold;">
          <a href="${link}" target="_blank" rel="noopener" style="color: #2563eb;">${w.title}</a>
        </p>
        <p><strong>Authors:</strong> ${authors}</p>
        <p><strong>Journal:</strong> ${journal} | <strong>Year:</strong> ${year} | <strong>Citations:</strong> ${w.cited_by_count || 0}</p>
      </li>
    `;
  }).join("");
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
    let works = worksData.results || [];

    const coAuthorMap = {};
    works.forEach(w => {
      w.authorships.forEach(a => {
        if (a.author.id && a.author.id !== author.id) {
          coAuthorMap[a.author] = coAuthorMap[a.author] || { count: 0, id: a.author.id };
          coAuthorMap[a.author].count += 1;
        }
      });
    });

    const topCoauthors = Object.entries(coAuthorMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([author, info]) => `<li><a href="profile.html?id=${info.id}">${author.display_name}</a> (${info.count})</li>`)
      .join("");

    const affiliations = (author.affiliations || [])
      .map(a => `<li>${a.institution.display_name} (${a.years.join(", ")})</li>`)
      .join("");

    const updatePublications = (sortBy) => {
      const sortedWorks = sortWorks(works, sortBy);
      document.getElementById("pubList").innerHTML = renderPublications(sortedWorks, author.id);
    };

    main.innerHTML = `
      <section style="margin-bottom: 2rem;">
        <h1>${author.display_name}</h1>
        <p><strong>ORCID:</strong> ${author.orcid || "N/A"}</p>
        <p><strong>Affiliation:</strong> ${author.last_known_institution?.display_name || "N/A"}</p>
        <p><a href="${author.id}" target="_blank">View on OpenAlex</a></p>
      </section>

      <section>
        <h2>Publications (${works.length})</h2>
        <div style="margin-bottom: 1rem;">
          <label>Sort by: </label>
          <select onchange="updatePublications(this.value)">
            <option value="year">Year (newest first)</option>
            <option value="citations">Citations (highest first)</option>
          </select>
        </div>
        <ul id="pubList" style="padding-left: 1rem; list-style: disc;">
          ${renderPublications(sortWorks(works, "year"), author.id)}
        </ul>
      </section>
    `;

    window.updatePublications = updatePublications;

    sidebar.innerHTML = `
      <section style="margin-bottom: 2rem;">
        <h3>Citation & Work Trend</h3>
        ${renderBarChart(author.counts_by_year || [])}
      </section>

      <section style="margin-bottom: 2rem;">
        <h3>Top Co-authors</h3>
        <ul style="padding-left: 1rem; list-style: disc;">
          ${topCoauthors}
        </ul>
      </section>

      <section style="margin-bottom: 2rem;">
        <h3>Past Affiliations</h3>
        <ul style="padding-left: 1rem; list-style: disc;">
          ${affiliations}
        </ul>
      </section>

      <section>
        <h3>Researcher Index</h3>
        <p>Coming soon: A combined metric based on citations, impact, and collaboration.</p>
      </section>
    `;
  } catch (err) {
    console.error(err);
    main.innerHTML = "<p>Error loading profile.</p>";
  }
}

loadProfile();
