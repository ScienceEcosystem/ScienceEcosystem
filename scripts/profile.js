const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("profileMain");
const sidebar = document.getElementById("profileSidebar");

function renderBarChart(counts) {
  const years = counts.map(c => c.year);
  const works = counts.map(c => c.works_count);
  const cites = counts.map(c => c.cited_by_count);
  const maxWorks = Math.max(...works);
  const maxCites = Math.max(...cites);
  const height = 180;
  const width = counts.length * 40 + 40;

  const yTicks = (max) => {
    const step = Math.ceil(max / 5);
    return Array.from({ length: 6 }, (_, i) => i * step);
  };

  const renderYAxis = (max) =>
    yTicks(max).map(t => {
      const y = height - (t / max) * height + 20;
      return `<text x="0" y="${y}" font-size="10" fill="#999">${t}</text>`;
    }).join("");

  const renderBars = (data, color, max) =>
    data.map((val, i) => {
      const barHeight = (val / max) * height;
      const x = i * 40 + 30;
      return `<rect x="${x}" y="${height - barHeight + 20}" width="20" height="${barHeight}" fill="${color}" />`;
    }).join("");

  const renderLabels = () =>
    years.map((year, i) => {
      const x = i * 40 + 40;
      return `<text x="${x}" y="${height + 35}" font-size="10" text-anchor="middle">${year}</text>`;
    }).join("");

  return `
    <div style="margin-bottom: 2rem;">
      <h4 style="margin-bottom: 0.5rem;">Works per Year</h4>
      <svg width="${width}" height="${height + 50}">
        ${renderYAxis(maxWorks)}
        ${renderBars(works, "#2563eb", maxWorks)}
        ${renderLabels()}
      </svg>
    </div>

    <div>
      <h4 style="margin-bottom: 0.5rem;">Citations per Year</h4>
      <svg width="${width}" height="${height + 50}">
        ${renderYAxis(maxCites)}
        ${renderBars(cites, "#e11d48", maxCites)}
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

    // ✅ Updated link to go to your paper page
    const openalexId = w.id?.split("/").pop(); // get just the paper ID, e.g., "W123456"
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
