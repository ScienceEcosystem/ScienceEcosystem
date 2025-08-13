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

function handleSearch(inputId) {
  const inputEl = $(inputId);
  if (!inputEl) return;
  const query = inputEl.value.trim();
  if (!query) return;
  if (inputId === "searchInput") {
    window.location.href = `search.html?q=${encodeURIComponent(query)}`;
  } else {
    window.history.replaceState(null, "", `?q=${encodeURIComponent(query)}`);
    handleUnifiedSearch();
  }
}

async function handleUnifiedSearch() {
  const results = $("unifiedSearchResults");
  const researcherList = $("researcherList");
  const topicList = $("topicList");

  if (!results || !researcherList || !topicList) return;

  const urlParams = new URLSearchParams(window.location.search);
  const input = urlParams.get("q")?.trim() || "";

  $("unifiedSearchInput").value = input;

  if (!input) {
    results.innerHTML = "<p>Please enter a search term.</p>";
    researcherList.innerHTML = "";
    topicList.innerHTML = "";
    return;
  }

  results.innerHTML = `<p>Searching: <strong>${escapeHtml(input)}</strong></p>`;
  researcherList.innerHTML = "";
  topicList.innerHTML = "";

  try {
    if (input.startsWith("10.")) {
      window.location.href = `paper.html?id=${encodeURIComponent(input)}`;
      return;
    }

    const [paperRes, authorRes, topicRes] = await Promise.all([
      fetch(`https://api.openalex.org/works?search=${encodeURIComponent(input)}&per_page=100`),
      fetch(`https://api.openalex.org/authors?search=${encodeURIComponent(input)}&per_page=10`),
      fetch(`https://api.openalex.org/concepts?search=${encodeURIComponent(input)}&per_page=5`)
    ]);

    const papers = (await paperRes.json()).results || [];
    const authors = (await authorRes.json()).results || [];
    const topics = (await topicRes.json()).results || [];

    // Papers in main column
    let paperHtml = "";
    if (papers.length > 0) {
      paperHtml += "<h2>Papers</h2><ul>";
      for (const paper of papers) {
        const paperId = paper.doi
          ? `doi:${encodeURIComponent(paper.doi)}`
          : paper.id.split("/").pop();
        paperHtml += `
          <li style="margin-bottom:1rem;">
            <a href="paper.html?id=${paperId}">${escapeHtml(paper.title)}</a><br/>
            Authors: ${escapeHtml(paper.authorships.map(a => a.author.display_name).join(", "))}<br/>
            Venue: ${paper.host_venue?.display_name || "N/A"} (${paper.publication_year || "N/A"})
          </li>`;
      }
      paperHtml += "</ul>";
    } else {
      paperHtml = "<p>No papers found.</p>";
    }
    results.innerHTML = paperHtml;

    // Researchers in sidebar
    if (authors.length > 0) {
      for (const person of authors) {
        const id = person.id.split("/").pop();
        researcherList.innerHTML += `
          <li style="margin-bottom:0.75rem;">
            <a href="profile.html?id=${id}">${escapeHtml(person.display_name)}</a><br/>
            ${person.last_known_institution?.display_name || "N/A"}
          </li>`;
      }
    } else {
      researcherList.innerHTML = "<li>No researchers found.</li>";
    }

    // Topics in sidebar
    if (topics.length > 0) {
      for (const topic of topics) {
        const tid = topic.id.split("/").pop();
        topicList.innerHTML += `
          <li style="margin-bottom:0.5rem;">
            <a href="topic.html?id=${tid}" title="${escapeHtml(topic.description || '')}">
              ${escapeHtml(topic.display_name)}
            </a>
          </li>`;
      }
    } else {
      topicList.innerHTML = "<li>No suggested topics found.</li>";
    }

  } catch (error) {
    console.error(error);
    results.innerHTML = "<p>Error loading results.</p>";
    researcherList.innerHTML = "";
    topicList.innerHTML = "";
  }
}

function initSearchBar() {
  const homepageInput = $("searchInput");
  const searchPageInput = $("unifiedSearchInput");

  if (homepageInput) {
    homepageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSearch("searchInput");
    });
  }
  if (searchPageInput) {
    searchPageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSearch("unifiedSearchInput");
    });
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) handleUnifiedSearch();
  }
}

initSearchBar();
