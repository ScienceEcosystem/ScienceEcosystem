// search.js

let currentAuthorIds = [];
let currentPage = 1;

document.addEventListener("DOMContentLoaded", () => {
  const searchBtn = document.getElementById("searchBtn");
  const searchBox = document.getElementById("searchBox");

  if (searchBtn) {
    searchBtn.addEventListener("click", runSearch);
  }
  if (searchBox) {
    searchBox.addEventListener("keypress", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }
});

async function runSearch() {
  const query = document.getElementById("searchBox").value.trim();
  if (!query) return;

  try {
    console.log("Searching for:", query);
    const papers = await fetchPapers(query, currentAuthorIds, currentPage);

    if (!papers || !papers.results || papers.results.length === 0) {
      document.getElementById("results").innerHTML = "<p>No results found.</p>";
      return;
    }

    renderResults(papers.results);
  } catch (err) {
    console.error("Error in runSearch:", err);
    document.getElementById("results").innerHTML = "<p>Error loading results.</p>";
  }
}

async function fetchPapers(query, authorIds, page) {
  let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=10&page=${page}&sort=relevance_score:desc`;

  if (authorIds && authorIds.length > 0) {
    url += `&filter=authorships.author.id:${authorIds.join("|")}`;
  }

  console.log("Fetching URL:", url);

  try {
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`OpenAlex request failed: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    console.error("Error fetching papers:", err);
    throw err; // rethrow so runSearch() can handle it
  }
}

function renderResults(results) {
  const container = document.getElementById("results");
  container.innerHTML = "";

  results.forEach((paper) => {
    const div = document.createElement("div");
    div.classList.add("paper");

    const authors = paper.authorships
      ? paper.authorships.map((a) => a.author.display_name).join(", ")
      : "Unknown authors";

    div.innerHTML = `
      <p>
        <strong>${paper.display_name || "Untitled"}</strong>
        (${paper.publication_year || "n.d."})<br>
        ${authors}
      </p>
    `;

    container.appendChild(div);
  });
}

