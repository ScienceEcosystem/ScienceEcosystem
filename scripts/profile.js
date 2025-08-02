const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("profileMain");
const sidebar = document.getElementById("profileSidebar");

function renderBarChart(counts) {
  if (!counts || counts.length === 0) return "";

  // Ensure data is sorted oldest to newest
  const sorted = [...counts].sort((a, b) => a.year - b.year);
  const years = sorted.map(c => c.year);
  const works = sorted.map(c => c.works_count);
  const cites = sorted.map(c => c.cited_by_count);

  const maxWorks = Math.max(...works);
  const maxCites = Math.max(...cites);
  const height = 120;
  const barWidth = 20;
  const barSpacing = 10;
  const chartWidth = years.length * (barWidth + barSpacing) + 50;

  const renderYAxis = (max) => {
    const step = Math.ceil(max / 4);
    return Array.from({ length: 5 }, (_, i) => {
      const val = i * step;
      const y = height - (val / max) * height + 20;
      return `<text x="0" y="${y}" font-size="10" fill="#999">${val}</text>`;
    }).join("");
  };

  const renderBars = (data, color, max) =>
    data.map((val, i) => {
      const x = i * (barWidth + barSpacing) + 30;
      const h = (val / max) * height;
      return `<rect x="${x}" y="${height - h + 20}" width="${barWidth}" height="${h}" fill="${color}" />`;
    }).join("");

  const renderLabels = () =>
    years.map((year, i) => {
      const x = i * (barWidth + barSpacing) + 40;
      return `<text x="${x}" y="${height + 35}" font-size="10" text-anchor="middle">${year}</text>`;
    }).join("");

  return `
    <div style="max-width: 100%; overflow-x: auto; margin-bottom: 2rem;">
      <h4 style="margin-bottom: 0.5rem;">Works per Year</h4>
      <svg width="${chartWidth}" height="${height + 50}">
        ${renderYAxis(maxWorks)}
        ${renderBars(works, "#2563eb", maxWorks)}
        ${renderLabels()}
      </svg>
    </div>

    <div style="max-width: 100%; overflow-x: auto; margin-bottom: 2rem;">
      <h4 style="margin-bottom: 0.5rem;">Citations per Year</h4>
      <svg width="${chartWidth}" height="${height + 50}">
        ${renderYAxis(maxCites)}
        ${renderBars(cites, "#16a34a", maxCites)}
        ${renderLabels()}
      </svg>
    </div>
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
    const openalexId = w.id?.split("/").pop();
    const link = `paper.html?id=${openalexId}`;

    return `
      <li style="margin-bottom: 1rem;">
        <p style="font-weight: bold;">
          <a href="${link}" style="color: #2563eb;">${w.title}</a>
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
          const key = a.author.id;
          if (!coAuthorMap[key]) {
            coAuthorMap[key] = {
              count: 0,
              name: a.author.display_name,
              id: a.author.id
            };
          }
          coAuthorMap[key].count += 1;
        }
      });
    });

    const topCoauthors = Object.values(coAuthorMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(info => `<li><a href="profile.html?id=${info.id}">${info.name}</a> (${info.count})</li>`)
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
