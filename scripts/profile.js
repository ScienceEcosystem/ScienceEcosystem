// scripts/profile.js

const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("profileMain");
const sidebar = document.getElementById("profileSidebar");

// Small helper
function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])
  );
}

/* ---------- Chips for provenance ---------- */
function provenanceChips(w) {
  const doi = w.doi ? `https://doi.org/${encodeURIComponent(w.doi)}` : null;
  const openAlexUrl = w.id || null;
  const oaUrl = w.open_access?.oa_url || w.primary_location?.pdf_url || null;
  const venueUrl = w.primary_location?.source?.homepage_url || w.primary_location?.landing_page_url || null;

  const parts = [];
  if (doi) parts.push(`<a class="badge" href="${doi}" target="_blank" rel="noopener">DOI</a>`);
  if (oaUrl) parts.push(`<a class="badge badge-oa" href="${oaUrl}" target="_blank" rel="noopener">Open access</a>`);
  if (venueUrl) parts.push(`<a class="badge" href="${venueUrl}" target="_blank" rel="noopener">Source</a>`);
  if (openAlexUrl) parts.push(`<a class="badge" href="${openAlexUrl}" target="_blank" rel="noopener">OpenAlex</a>`);
  return parts.join(" ");
}

/* ---------- Co-author mini-graph (simple radial) ---------- */
function renderCoAuthorGraph(coAuthors) {
  if (!coAuthors.length) return "<p class=\"muted\">No co-authors available.</p>";

  const nodes = coAuthors.map((c, i) => ({
    id: c.name,
    size: Math.min(12, 5 + c.count * 2),
    link: `profile.html?id=${encodeURIComponent(c.id)}`
  }));

  const SVG_W = 260, SVG_H = 260, CX = 130, CY = 130, R = 95;

  return `
    <svg width="${SVG_W}" height="${SVG_H}" role="img" aria-label="Top co-authors">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#e5e7eb"></circle>
      ${nodes.map((n, i) => {
        const angle = (i / nodes.length) * 2 * Math.PI;
        const x = CX + R * Math.cos(angle);
        const y = CY + R * Math.sin(angle);
        const label = escapeHtml(n.id.split(" ")[0]);
        return `
          <a href="${n.link}">
            <circle cx="${x}" cy="${y}" r="${n.size}" fill="#0ea5e9">
              <title>${escapeHtml(n.id)} (${coAuthors[i].count} co-authored works)</title>
            </circle>
            <text x="${x}" y="${y + 3}" font-size="10" text-anchor="middle" fill="#ffffff">${label}</text>
          </a>
        `;
      }).join("")}
    </svg>
  `;
}

/* ---------- Sort & render publications ---------- */
function sortWorks(works, by) {
  if (by === "citations") {
    return [...works].sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
  }
  // default: date (year)
  return [...works].sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0));
}

function renderPublications(works, authorId, sortBy = "date") {
  const container = document.getElementById("publicationsList");
  if (!container) return;

  const sorted = sortWorks(works, sortBy === "date" ? "date" : "citations");

  if (!sorted.length) {
    container.innerHTML = `<p class="muted">No publications available.</p>`;
    return;
  }

  const items = sorted.map((w) => {
    const title = w.display_name || w.title || "Untitled work";
    const pid = w.doi ? `doi:${encodeURIComponent(w.doi)}` : (w.id ? w.id.split("/").pop() : "");
    const year = w.publication_year || "N/A";
    const venue = w.host_venue?.display_name || "Unknown venue";
    const cites = w.cited_by_count || 0;

    const authorsHtml = (w.authorships || [])
      .map((a) => {
        const aid = a.author?.id ? a.author.id.split("/").pop() : null;
        const name = escapeHtml(a.author?.display_name || "Unknown");
        return aid ? `<a href="profile.html?id=${aid}">${name}</a>` : name;
      })
      .join(", ") || "Unknown authors";

    return `
      <article class="result-card">
        <h3><a href="paper.html?id=${pid}">${escapeHtml(title)}</a></h3>
        <p class="meta"><span class="muted">${year}</span> · <strong>Published in:</strong> ${escapeHtml(venue)} · <strong>Citations:</strong> ${cites}</p>
        <p><strong>Authors:</strong> ${authorsHtml}</p>
        <p class="chips">${provenanceChips(w)}</p>
      </article>
    `;
  }).join("");

  container.innerHTML = items;
}

/* ---------- Load profile ---------- */
async function loadProfile() {
  const param = getParam("id");
  if (!param) {
    main.innerHTML = "<p>Missing researcher ID.</p>";
    return;
  }

  const authorId = param.split("/").pop();

  try {
    // Author
    const authorRes = await fetch(`https://api.openalex.org/authors/${authorId}`);
    const author = await authorRes.json();

    // Works (ensure correct per-page param)
    let worksUrl;
    try {
      worksUrl = new URL(author.works_api_url);
    } catch {
      worksUrl = new URL(author.works_api_url, "https://api.openalex.org");
    }
    worksUrl.searchParams.set("per-page", "100");
    const worksData = await (await fetch(worksUrl.toString())).json();
    const works = worksData.results || [];

    // Header
    const nameEl = document.getElementById("profileName");
    const affEl = document.getElementById("profileAffiliation");
    const orcidLink = document.getElementById("profileOrcid");
    const photoEl = document.getElementById("profilePhoto");

    nameEl.textContent = author.display_name || "Unknown researcher";
    const affiliation = author.last_known_institution?.display_name
      || author.last_known_institutions?.[0]?.display_name
      || "Unknown affiliation";
    affEl.textContent = affiliation;

    if (author.orcid) {
      orcidLink.href = author.orcid;
      orcidLink.style.display = "inline";
    } else {
      orcidLink.style.display = "none";
    }

    if (author.display_picture) {
      photoEl.src = author.display_picture;
    }

    // Bio
    const h = author.summary_stats?.h_index || 0;
    const totalCitations = author.cited_by_count || 0;
    const topics = (author.x_concepts || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((c) => c.display_name);

    const bioEl = document.getElementById("aiBio");
    bioEl.textContent =
      `${author.display_name} studies ${topics.join(", ")}. `
      + `They have ${works.length} works and ${totalCitations.toLocaleString()} citations. `
      + `Current h-index is ${h} and their latest affiliation is ${affiliation}.`;

    // Topics tags
    const tagsContainer = document.getElementById("tagsContainer");
    tagsContainer.innerHTML = (author.x_concepts || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((c) => {
        const tid = c.id.split("/").pop();
        return `<a class="topic-tag" href="topic.html?id=${tid}" title="Open topic">${escapeHtml(c.display_name)}</a>`;
      }).join("");

    // Metrics
    document.getElementById("totalWorks").textContent = works.length.toLocaleString();
    document.getElementById("totalCitations").textContent = totalCitations.toLocaleString();
    document.getElementById("hIndex").textContent = h.toLocaleString();

    // Career timeline
    const timeline = document.getElementById("careerTimeline");
    const affs = (author.affiliations || []).map((a) => {
      const inst = a.institution?.display_name || "Institution";
      const years = a.years?.length ? a.years.join(", ") : "N/A";
      return `<li>${escapeHtml(inst)} (${escapeHtml(years)})</li>`;
    });
    timeline.innerHTML = affs.length ? affs.join("") : "<li>No affiliations listed.</li>";

    // Co-authors
    const coMap = {};
    works.forEach((w) => {
      (w.authorships || []).forEach((a) => {
        if (a.author?.id && a.author.id !== author.id) {
          if (!coMap[a.author.id]) {
            coMap[a.author.id] = { count: 0, name: a.author.display_name, id: a.author.id };
          }
          coMap[a.author.id].count++;
        }
      });
    });
    const topCo = Object.values(coMap).sort((a, b) => b.count - a.count).slice(0, 10);
    document.getElementById("coAuthorGraph").innerHTML = renderCoAuthorGraph(topCo);

    // Publications
    const sortSelect = document.getElementById("pubSort");
    const sortMap = { date: "date", citations: "citations" };
    const initialSort = sortMap[sortSelect?.value] || "date";
    renderPublications(works, author.id, initialSort);
    if (sortSelect) {
      sortSelect.addEventListener("change", () => {
        const by = sortMap[sortSelect.value] || "date";
        renderPublications(works, author.id, by);
      });
    }
  } catch (err) {
    console.error(err);
    main.innerHTML = "<p>Error loading profile.</p>";
  }
}

document.addEventListener("DOMContentLoaded", loadProfile);
