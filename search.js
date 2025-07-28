async function Search() {
  const query = document.getElementById("searchInput").value.trim();
  const resultsDiv = document.getElementById("searchResults");
  resultsDiv.innerHTML = "Searching…";

  if (!query) {
    resultsDiv.innerHTML = "<p>Please enter a search term.</p>";
    return;
  }

  try {
    const [authorData, workData] = await Promise.all([
      fetchOpenAlexAuthors(query),
      fetchOpenAlexWorks(query),
    ]);

    let html = `<p><strong>Results for:</strong> "${query}"</p>`;

    if (authorData.length) {
      html += renderAuthors(authorData);
      // Limit to first author for profile detail
      html += await renderAuthorProfile(authorData[0]);
    }

    if (workData.length) {
      html += `<h3>Papers</h3><ul>`;
      workData.slice(0, 5).forEach(w => {
        html += `<li>${renderWork(w)}</li>`;
      });
      html += `</ul>`;
    }

    if (!authorData.length && !workData.length) {
      html += "<p>No results found.</p>";
    }

    resultsDiv.innerHTML = html;
  } catch (err) {
    console.error(err);
    resultsDiv.innerHTML = "<p>Error loading data. Check console.</p>";
  }
}

async function fetchOpenAlexAuthors(query) {
  const res = await fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(query)}&per_page=3`);
  const data = await res.json();
  return data.results || [];
}

async function fetchOpenAlexWorks(queryOrId) {
  const url = queryOrId.startsWith("https://openalex.org/A")
    ? `https://api.openalex.org/works?filter=author.id:${encodeURIComponent(queryOrId)}&sort=publication_year:desc&per_page=10`
    : `https://api.openalex.org/works?search=${encodeURIComponent(queryOrId)}&per_page=5`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

function renderAuthors(authors) {
  let html = `<h3>Researchers</h3><ul>`;
  authors.forEach(a => {
    html += `
      <li>
        <strong>${a.display_name}</strong> — Affiliation: ${a.last_known_institution?.display_name || "Unknown"}<br/>
        Works: ${a.works_count}, Citations: ${a.cited_by_count}<br/>
        <a href="#" onclick="performSearch('${a.id}')" style="cursor:pointer;">View full profile</a>
      </li><br/>`;
  });
  html += `</ul>`;
  return html;
}

function renderWork(w) {
  const authors = (w.authorships || []).map(a => a.author.display_name).join(", ");
  const abs = w.abstract_inverted_index ? getAbstractFromIndex(w.abstract_inverted_index) : "";
  return `<strong>${w.display_name}</strong><br/>
    Authors: ${authors}<br/>
    Venue: ${w.host_venue?.display_name || "Unknown"} (${w.publication_year})<br/>
    ${abs ? `Abstract: ${abs.substring(0, 200)}…<br/>` : ""}
    <a href="${w.id}" target="_blank">OpenAlex</a>`;
}

function getAbstractFromIndex(index) {
  const words = Object.entries(index).flatMap(([w,pos]) => pos.map(p => [p,w]));
  return words.sort((a,b)=>a[0]-b[0]).map(w=>w[1]).join(" ");
}

async function renderAuthorProfile(author) {
  const works = await fetchOpenAlexWorks(author.id);
  const coauthors = getTopCoauthors(works, author.id);
  const affiliations = getPastAffiliations(works);
  
  let html = `<div class="card"><h3>Profile: ${author.display_name}</h3>
    Affiliation: ${author.last_known_institution?.display_name || "–"}<br/>
    Works: ${author.works_count}, Citations: ${author.cited_by_count}<br/>
    <p><strong>AI-generated bio:</strong> ${generateBio(author, affiliations, works)}</p>
    <p><strong>Past affiliations:</strong> ${affiliations.join(", ") || "None detected"}</p>
    <p><strong>Top collaborators:</strong></p><ul>`;
  coauthors.forEach(c => {
    html += `<li>${c.name} — ${c.count} joint papers</li>`;
  });
  html += `</ul></div>`;
  return html;
}

function getTopCoauthors(works, authorId) {
  const counts = {};
  works.forEach(w => {
    (w.authorships || []).forEach(a => {
      const id = a.author?.id;
      const name = a.author?.display_name;
      if (id && id !== authorId) {
        counts[id] = counts[id] || { name, count: 0 };
        counts[id].count++;
      }
    });
  });
  return Object.values(counts)
    .sort((a,b)=>b.count - a.count)
    .slice(0, 5);
}

function getPastAffiliations(works) {
  const insts = new Set();
  works.forEach(w => {
    w.authorships?.forEach(a => {
      if (a.institution?.display_name) insts.add(a.institution.display_name);
    });
  });
  return Array.from(insts);
}

function generateBio(author, affiliations, works) {
  const topFields = (author.x_concepts || []).slice(0,3).map(c=>c.display_name).join(", ");
  const papersN = author.works_count;
  const aff = author.last_known_institution?.display_name || "various institutions";
  return `Dr. ${author.display_name} is a researcher affiliated with ${aff}. Their work (${papersN} publications) focuses on ${topFields}. They’ve collaborated with several colleagues and worked at institutions including ${affiliations.slice(0,3).join(", ")}.`;
}
