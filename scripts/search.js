const $ = (id) => document.getElementById(id);

function escapeHtml(str = "") {
  return str.replace(/[&<>'"]/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[c]));
}

async function handleUnifiedSearch() {
  const input = $("unifiedSearchInput").value.trim();
  const results = $("unifiedSearchResults");
  const sidebar = $("suggestedTopics");
  results.innerHTML = "";
  sidebar.innerHTML = "";

  if (!input) {
    results.innerHTML = "<p>Please enter a search term.</p>";
    return;
  }

  results.innerHTML = `<p>Searching: <strong>${escapeHtml(input)}</strong></p>`;

  try {
    // Step 1: Search for author, topic, and works
    const [authorRes, topicRes, workRes] = await Promise.all([
      fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(input)}&per_page=1`),
      fetch(`https://api.openalex.org/concepts?search=${encodeURIComponent(input)}&per_page=1`),
      fetch(`https://api.openalex.org/works?search=${encodeURIComponent(input)}&per_page=10`)
    ]);

    const authorMatch = (await authorRes.json()).results[0] || null;
    const topicMatch = (await topicRes.json()).results[0] || null;
    const worksGeneral = (await workRes.json()).results || [];

    let html = "";

    // Step 2: If author match, fetch their papers
    if (authorMatch) {
      html += `<h3>Researcher: ${escapeHtml(authorMatch.display_name)}</h3>
        <p>Affiliation: ${authorMatch.last_known_institution?.display_name || "N/A"}</p>
        <p>ORCID: ${authorMatch.orcid || "N/A"}</p>`;

      const authorWorksRes = await fetch(
        `https://api.openalex.org/works?filter=author.id:${authorMatch.id.split("/").pop()}&per_page=10`
      );
      const authorWorks = (await authorWorksRes.json()).results || [];

      html += "<h4>Papers by this researcher</h4><ul>";
      for (const paper of authorWorks) {
        html += `<li>
          <a href="paper.html?id=${paper.id.replace('https://openalex.org/', '')}">${escapeHtml(paper.title)}</a>
          <br/>Venue: ${paper.host_venue?.display_name || "N/A"} (${paper.publication_year || "N/A"})
        </li>`;
      }
      html += "</ul>";

      // Sidebar: suggested topics from author's papers
      const topicCounts = {};
      authorWorks.forEach(work => {
        work.concepts.forEach(c => {
          topicCounts[c.display_name] = (topicCounts[c.display_name] || 0) + c.score;
        });
      });
      const sortedTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      sortedTopics.forEach(([name]) => {
        sidebar.innerHTML += `<li><a href="topic.html?q=${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`;
      });

    } 
    // Step 3: If topic match, fetch topic papers
    else if (topicMatch) {
      html += `<h3>Topic: ${escapeHtml(topicMatch.display_name)}</h3>
        <p>${escapeHtml(topicMatch.description || "")}</p>`;

      const topicWorksRes = await fetch(
        `https://api.openalex.org/works?filter=concepts.id:${topicMatch.id.split("/").pop()}&per_page=10`
      );
      const topicWorks = (await topicWorksRes.json()).results || [];

      html += "<h4>Papers in this topic</h4><ul>";
      for (const paper of topicWorks) {
        html += `<li>
          <a href="paper.html?id=${paper.id.replace('https://openalex.org/', '')}">${escapeHtml(paper.title)}</a>
          <br/>Authors: ${escapeHtml(paper.authorships.map(a => a.author.display_name).join(", "))}
        </li>`;
      }
      html += "</ul>";

      // Sidebar: related topics from topic's works
      const topicCounts = {};
      topicWorks.forEach(work => {
        work.concepts.forEach(c => {
          if (c.display_name !== topicMatch.display_name) {
            topicCounts[c.display_name] = (topicCounts[c.display_name] || 0) + c.score;
          }
        });
      });
      const sortedTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      sortedTopics.forEach(([name]) => {
        sidebar.innerHTML += `<li><a href="topic.html?q=${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`;
      });

    } 
    // Step 4: General search mode
    else {
      html += "<h3>Matching Papers</h3><ul>";
      for (const paper of worksGeneral) {
        html += `<li>
          <a href="paper.html?id=${paper.id.replace('https://openalex.org/', '')}">${escapeHtml(paper.title)}</a>
          <br/>Authors: ${escapeHtml(paper.authorships.map(a => a.author.display_name).join(", "))}
        </li>`;
      }
      html += "</ul>";

      // Sidebar: topics from these papers
      const topicCounts = {};
      worksGeneral.forEach(work => {
        work.concepts.forEach(c => {
          topicCounts[c.display_name] = (topicCounts[c.display_name] || 0) + c.score;
        });
      });
      const sortedTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      sortedTopics.forEach(([name]) => {
        sidebar.innerHTML += `<li><a href="topic.html?q=${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`;
      });
    }

    results.innerHTML = html || "<p>No results found.</p>";

  } catch (error) {
    console.error(error);
    results.innerHTML = "<p>Error fetching results.</p>";
  }
}

