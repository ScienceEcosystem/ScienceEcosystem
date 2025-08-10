// paper.js
// Fetch and display detailed paper information from OpenAlex

document.addEventListener("DOMContentLoaded", async () => {
    const paperId = getPaperIdFromURL();
    if (!paperId) {
        document.getElementById("paper-container").innerHTML =
            "<p>No paper specified.</p>";
        return;
    }

    try {
        const paperData = await fetchPaperData(paperId);
        renderPaperDetails(paperData);
        const relatedPapers = await fetchRelatedPapers(paperData);
        renderRelatedPapers(relatedPapers);
    } catch (error) {
        console.error(error);
        document.getElementById("paper-container").innerHTML =
            "<p>Error loading paper details.</p>";
    }
});

// Extracts paper ID (DOI or OpenAlex ID) from URL query parameter
function getPaperIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
}

// Fetch paper data from OpenAlex
async function fetchPaperData(paperId) {
    let url;
    if (paperId.startsWith("10.")) {
        // It's a DOI
        url = `https://api.openalex.org/works/doi:${encodeURIComponent(paperId)}`;
    } else {
        // It's an OpenAlex ID
        url = `https://api.openalex.org/works/${encodeURIComponent(paperId)}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch paper data");
    return await res.json();
}

// Render main paper details
function renderPaperDetails(paper) {
    const container = document.getElementById("paper-container");
    container.innerHTML = `
        <h1>${paper.title}</h1>
        <p><strong>Published:</strong> ${paper.publication_year}</p>
        <p><strong>Authors:</strong> ${formatAuthors(paper.authorships)}</p>
        <p><strong>Affiliations:</strong> ${formatAffiliations(paper.authorships)}</p>
        ${paper.abstract_inverted_index ? `<p>${formatAbstract(paper.abstract_inverted_index)}</p>` : "<p><em>No abstract available.</em></p>"}
        <p><a href="${paper.id}" target="_blank">View on OpenAlex</a></p>
    `;
}

// Format authors list
function formatAuthors(authorships) {
    return authorships.map(a => a.author.display_name).join(", ");
}

// Format affiliations
function formatAffiliations(authorships) {
    const affiliations = authorships.flatMap(a => a.institutions.map(i => i.display_name));
    return [...new Set(affiliations)].join(", ");
}

// Convert OpenAlex's abstract_inverted_index to readable text
function formatAbstract(invertedIndex) {
    const words = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
        positions.forEach(pos => {
            words[pos] = word;
        });
    }
    return words.join(" ");
}

// Fetch related papers based on concepts
async function fetchRelatedPapers(paper) {
    if (!paper.concepts || paper.concepts.length === 0) return [];
    const topConcept = paper.concepts[0].id;
    const url = `https://api.openalex.org/works?filter=concepts.id:${topConcept}&per-page=5&sort=cited_by_count:desc`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch related papers");
    const data = await res.json();
    return data.results.filter(p => p.id !== paper.id);
}

// Render related papers list
function renderRelatedPapers(papers) {
    const container = document.getElementById("related-papers");
    if (papers.length === 0) {
        container.innerHTML = "<p>No related papers found.</p>";
        return;
    }

    container.innerHTML = `
        <h2>Related Papers</h2>
        <ul>
            ${papers
                .map(
                    p => `
                <li>
                    <a href="paper.html?id=${encodeURIComponent(p.id.replace('https://openalex.org/', ''))}">
                        ${p.title}
                    </a> (${p.publication_year})
                </li>
            `
                )
                .join("")}
        </ul>
    `;
}
