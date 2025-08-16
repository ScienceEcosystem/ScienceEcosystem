const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("profileMain");
const sidebar = document.getElementById("profileSidebar");

/* --- Helper: Bar charts for citations/works --- */
function renderBarChart(counts) {
  if (!counts?.length) return "";
  const sorted = [...counts].sort((a,b)=>a.year-b.year);
  const years = sorted.map(c=>c.year);
  const works = sorted.map(c=>c.works_count);
  const cites = sorted.map(c=>c.cited_by_count);

  const maxW = Math.max(...works), maxC = Math.max(...cites);
  const h=120, bw=20, bs=10, w=years.length*(bw+bs)+60;

  const renderY=(max)=>{
    const step = Math.ceil(max/4);
    return Array.from({length:5},(_,i)=>{
      const val = i*step;
      const y = h-(val/max)*h+20;
      return `<text x="0" y="${y}" font-size="10" fill="#999">${val}</text>`;
    }).join("");
  };

  const renderBars=(data,color,max)=>data.map((v,i)=>{
    const x=i*(bw+bs)+30, hh=(v/max)*h;
    return `<rect x="${x}" y="${h-hh+20}" width="${bw}" height="${hh}" fill="${color}" />`;
  }).join("");

  const renderLabels=()=>years.map((yr,i)=>{
    const x=i*(bw+bs)+40;
    return `<text x="${x}" y="${h+35}" font-size="10" text-anchor="middle">${yr}</text>`;
  }).join("");

  return `
  <div style="max-width:100%;overflow-x:auto;margin-bottom:2rem;">
    <h4>Works per Year</h4>
    <svg width="${w}" height="${h+50}">
      ${renderY(maxW)}${renderBars(works,"#2563eb",maxW)}${renderLabels()}
    </svg>
  </div>
  <div style="max-width:100%;overflow-x:auto;margin-bottom:2rem;">
    <h4>Citations per Year</h4>
    <svg width="${w}" height="${h+50}">
      ${renderY(maxC)}${renderBars(cites,"#16a34a",maxC)}${renderLabels()}
    </svg>
  </div>`;
}

/* --- Sort works --- */
function sortWorks(works, by) {
  return by==="year"
    ? [...works].sort((a,b)=>(b.publication_year||0)-(a.publication_year||0))
    : [...works].sort((a,b)=>(b.cited_by_count||0)-(a.cited_by_count||0));
}

/* --- Publications rendering --- */
function renderPublications(works, authorId, filterFirstAuthor=false) {
  return works
    .filter(w=>{
      if (!filterFirstAuthor) return true;
      return w.authorships?.[0]?.author?.id === authorId;
    })
    .map(w=>{
      const authors = w.authorships?.map(a=>{
        return a.author.id && a.author.id!==authorId
          ? `<a href="profile.html?id=${encodeURIComponent(a.author.id)}" style="color:#0d9488;">${a.author.display_name}</a>`
          : a.author.display_name;
      }).join(", ")||"Unknown authors";
      const journal = w.host_venue?.display_name || "Unknown journal";
      const year = w.publication_year || "N/A";
      const pid = w.id.split("/").pop();
      const link = `paper.html?id=${pid}`;
      return `<li style="margin-bottom:1rem;">
        <p style="font-weight:bold;"><a href="${link}" style="color:#2563eb;">${w.title}</a></p>
        <p><strong>Authors:</strong> ${authors}</p>
        <p><strong>Journal:</strong> ${journal} | <strong>Year:</strong> ${year} | <strong>Citations:</strong> ${w.cited_by_count||0}</p>
      </li>`;
    }).join("");
}

/* --- NEW: Co-author graph --- */
function renderCoAuthorGraph(coAuthors) {
  if (!coAuthors.length) return "<p>No co-authors available.</p>";
  const nodes = coAuthors.map((c,i)=>({
    id: c.name,
    size: 5 + c.count*2,
    link: `profile.html?id=${encodeURIComponent(c.id)}`
  }));
  // Simplified inline SVG "graph"
  return `
    <svg width="250" height="250" style="border:1px solid #ccc; border-radius:8px;">
      ${nodes.map((n,i)=>{
        const angle = (i/nodes.length)*2*Math.PI;
        const x = 120 + 90*Math.cos(angle);
        const y = 120 + 90*Math.sin(angle);
        return `
          <circle cx="${x}" cy="${y}" r="${n.size}" fill="#0d9488">
            <title>${n.id}</title>
          </circle>
          <a href="${n.link}">
            <text x="${x}" y="${y}" font-size="10" text-anchor="middle" dy="3" fill="white">${n.id.split(" ")[0]}</text>
          </a>`;
      }).join("")}
    </svg>`;
}

/* --- Profile loader --- */
async function loadProfile() {
  const param = getParam("id");
  if (!param) {
    main.innerHTML = "<p>Missing researcher ID.</p>";
    return;
  }
  const authorId = param.split("/").pop();

  try {
    const author = await (await fetch(`https://api.openalex.org/authors/${authorId}`)).json();
    const works = (await (await fetch(author.works_api_url + "&per_page=100")).json()).results || [];

    const affiliation = author.last_known_institutions?.[0]?.display_name || "Unknown";
    const h = author.summary_stats?.h_index || 0;
    const i10 = author.summary_stats?.i10_index || 0;

    /* Topics */
    const topics = (author.x_concepts || [])
      .sort((a,b)=>b.score-a.score)
      .slice(0,5)
      .map(c=>c.display_name);
    const topicTags = (author.x_concepts || [])
      .sort((a,b)=>b.score-a.score)
      .slice(0,5)
      .map(c=>{
        const tid = c.id.split("/").pop();
        return `<a class="topic-tag" href="topic.html?id=${tid}" title="Go to topic page">${c.display_name}</a>`;
      }).join(" ");

    /* Years active for RIS metric */
    const years = works.map(w=>w.publication_year).filter(Boolean);
    const minYear = years.length? Math.min(...years): new Date().getFullYear();
    const maxYear = years.length? Math.max(...years): new Date().getFullYear();
    const yearsActive = maxYear - minYear + 1;

    const RIS = ((author.cited_by_count || 0) * h) / (yearsActive+1);

    /* AI bio */
    const bio = `
      ${author.display_name} is a researcher focusing on ${topics.join(", ")}.
      They have published ${works.length} works with ${author.cited_by_count.toLocaleString()} citations.
      Their current h-index is ${h}, and they are affiliated with ${affiliation}.
    `;

    /* Co-authors */
    const coMap = {};
    works.forEach(w=>{
      w.authorships.forEach(a=>{
        if (a.author.id && a.author.id !== author.id) {
          if (!coMap[a.author.id]) {
            coMap[a.author.id] = { count: 0, name: a.author.display_name, id: a.author.id };
          }
          coMap[a.author.id].count++;
        }
      });
    });
    const topCo = Object.values(coMap).sort((a,b)=>b.count-a.count).slice(0,10);

    /* Affiliations */
    const affiliationsHtml = (author.affiliations || []).length
      ? author.affiliations.map(a=>`<li>${a.institution.display_name} (${a.years?.join(", ") || "N/A"})</li>`).join("")
      : "<li>None listed</li>";

    /* Update publications dynamically */
    const updatePubs = (by,filterFirst=false) => {
      document.getElementById("pubList").innerHTML = renderPublications(sortWorks(works, by), author.id, filterFirst);
    };
    window.updatePubs = updatePubs;

    /* Main content */
    main.innerHTML = `
      <section style="margin-bottom:2rem;">
        <h1>${author.display_name}</h1>
        <p><a href="${author.orcid}" target="_blank">ORCID Profile</a></p>
        <p><strong>Affiliation:</strong> ${affiliation}</p>
        <div style="display:flex; flex-wrap:wrap; gap:1rem; margin:1rem 0;">
          <div><strong>Publications:</strong> ${works.length}</div>
          <div><strong>h-index:</strong> ${h}</div>
          <div><strong>i10-index:</strong> ${i10}</div>
          <div><strong>Citations:</strong> ${author.cited_by_count.toLocaleString()}</div>
          <div><strong>Research Impact Score (RIS):</strong> ${RIS.toFixed(1)}</div>
        </div>
        <p><strong>Topics:</strong> ${topicTags}</p>
        <p class="ai-bio">${bio}</p>
        <p><a href="${author.id}" target="_blank">View on OpenAlex</a></p>
      </section>

      <section>
        <h2>Publications (${works.length})</h2>
        <div style="margin-bottom:1rem;">
          <label>Sort by:</label>
          <select onchange="updatePubs(this.value)">
            <option value="year">Year</option>
            <option value="citations">Citations</option>
          </select>
          <label style="margin-left:1rem;">
            <input type="checkbox" onchange="updatePubs(document.querySelector('select').value,this.checked)"> First author only
          </label>
        </div>
        <ul id="pubList">${renderPublications(sortWorks(works,"year"), author.id)}</ul>
      </section>`;
    
    /* Sidebar */
    sidebar.innerHTML = `
      <section style="margin-bottom:2rem;">
        <h3>Citation & Work Trend</h3>
        ${renderBarChart(author.counts_by_year || [])}
      </section>
      <section style="margin-bottom:2rem;">
        <h3>Top Co-authors</h3>
        ${renderCoAuthorGraph(topCo)}
        <ul>${topCo.map(c=>`<li><a href="profile.html?id=${encodeURIComponent(c.id)}">${c.name}</a> (${c.count})</li>`).join("")}</ul>
      </section>
      <section style="margin-bottom:2rem;">
        <h3>Past Affiliations</h3><ul>${affiliationsHtml}</ul>
      </section>
      <section>
        <h3>Contact</h3>
        <button style="padding:0.5rem 1rem;background:#2563eb;color:white;border:none;border-radius:5px;">Message Researcher</button>
      </section>
    `;
  } catch(err) {
    console.error(err);
    main.innerHTML = "<p>Error loading profile.</p>";
  }
}

loadProfile();
