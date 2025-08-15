document.addEventListener("DOMContentLoaded", async () => {
    const paperId = getPaperIdFromURL();
    if (!paperId) {
        document.getElementById("paper-container").innerHTML = "<p>No paper specified.</p>";
        return;
    }

    try {
        const paperData = await fetchPaperData(paperId);
        renderPaperDetails(paperData);

        const [citedPapers, citingPapers] = await Promise.all([
            fetchCitedPapers(paperData.referenced_works || []),
            fetchCitingPapers(paperId)
        ]);

        renderClusterGraph(paperData, citedPapers, citingPapers);
    } catch (error) {
        console.error(error);
        document.getElementById("paper-container").innerHTML = "<p>Error loading paper details.</p>";
    }
});

function getPaperIdFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id");
}

async function fetchPaperData(paperId) {
    let url;
    if (paperId.startsWith("10.")) {
        url = `https://api.openalex.org/works/doi:${encodeURIComponent(paperId)}`;
    } else {
        url = `https://api.openalex.org/works/${encodeURIComponent(paperId)}`;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch paper data");
    return await res.json();
}

function renderPaperDetails(paper) {
    const container = document.getElementById("paper-container");
    container.innerHTML = `
        <h1>${paper.display_name}</h1>
        <p><strong>Published:</strong> ${paper.publication_year}</p>
        <p><strong>Authors:</strong> ${formatAuthors(paper.authorships)}</p>
        <p><strong>Affiliations:</strong> ${formatAffiliations(paper.authorships)}</p>
        ${paper.abstract_inverted_index ? `<p>${formatAbstract(paper.abstract_inverted_index)}</p>` : "<p><em>No abstract available.</em></p>"}
        <p><a href="${paper.id}" target="_blank">View on OpenAlex</a></p>
    `;
}

function formatAuthors(authorships) {
    return authorships.map(a => `<a href="profile.html?id=${a.author.id.split('/').pop()}">${a.author.display_name}</a>`).join(", ");
}

function formatAffiliations(authorships) {
    const affiliations = authorships.flatMap(a => a.institutions.map(i => i.display_name));
    return [...new Set(affiliations)].join(", ");
}

function formatAbstract(invertedIndex) {
    const words = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
        positions.forEach(pos => {
            words[pos] = word;
        });
    }
    return words.join(" ");
}

async function fetchCitedPapers(referencedWorks) {
    if (!referencedWorks.length) return [];
    const ids = referencedWorks.slice(0, 20).map(id => id.split('/').pop()).join('|');
    const res = await fetch(`https://api.openalex.org/works?filter=ids.openalex:${ids}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
}

async function fetchCitingPapers(paperId) {
    const res = await fetch(`https://api.openalex.org/works?filter=cites:${paperId}&per-page=20`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
}

function renderClusterGraph(mainPaper, cited, citing) {
    const container = document.getElementById("graphContainer");
    container.innerHTML = "<h2>Connected Papers</h2><div id='paperGraph' style='height:600px;'></div>";

    const nodes = [
        { id: mainPaper.id, label: mainPaper.display_name, group: 'main' },
        ...cited.map(p => ({ id: p.id, label: p.display_name, group: 'cited' })),
        ...citing.map(p => ({ id: p.id, label: p.display_name, group: 'citing' }))
    ];

    const edges = [
        ...cited.map(p => ({ from: mainPaper.id, to: p.id })),
        ...citing.map(p => ({ from: p.id, to: mainPaper.id }))
    ];

    const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
    const options = {
        nodes: { shape: 'dot', size: 15, font: { size: 14 }, borderWidth: 2 },
        edges: { arrows: 'to' },
        physics: { stabilization: true }
    };

    new vis.Network(document.getElementById('paperGraph'), data, options);
}
