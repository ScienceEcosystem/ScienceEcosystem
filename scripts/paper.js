document.addEventListener("DOMContentLoaded", async () => {
    const paperId = getPaperIdFromURL();
    if (!paperId) return document.getElementById("paper-container").innerHTML = "<p>No paper specified.</p>";

    try {
        const paperData = await fetchPaperData(paperId);
        renderPaperDetails(paperData);
        renderSidebarExtras(paperData);

        const [citedPapers, citingPapers] = await Promise.all([
            fetchCitedPapers(paperData.referenced_works || []),
            fetchCitingPapers(paperId)
        ]);
        renderClusterGraph(paperData, citedPapers, citingPapers);
    } catch (e) {
        console.error(e);
        document.getElementById("paper-container").innerHTML = "<p>Error loading paper details.</p>";
    }
});

function getPaperIdFromURL() {
    return new URLSearchParams(window.location.search).get("id");
}

async function fetchPaperData(paperId) {
    const url = paperId.startsWith("10.") 
        ? `https://api.openalex.org/works/doi:${encodeURIComponent(paperId)}`
        : `https://api.openalex.org/works/${encodeURIComponent(paperId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch paper data");
    return await res.json();
}

function renderPaperDetails(paper) {
    const container = document.getElementById("paper-container");

    // AI summary placeholder
    const topics = (paper.concepts || []).map(t => t.display_name).slice(0,5).join(", ");
    const aiSummary = `This paper focuses on ${topics}. It has ${paper.cited_by_count || 0} citations and is published in ${paper.primary_location?.source?.display_name || 'Unknown journal'}.`;

    // Datasets & code links
    const researchObjects = [];
    if (paper.sources?.length) {
        paper.sources.forEach(s => {
            if(s.type && (s.type.includes('dataset') || s.type.includes('software'))) {
                researchObjects.push(`<li><a href="${s.url}" target="_blank">${s.display_name || s.type}</a></li>`);
            }
        });
    }

    container.innerHTML = `
    <section>
        <h1>${paper.display_name}</h1>
        <p><strong>Published:</strong> ${paper.publication_year}</p>
        <p><strong>Authors:</strong> ${formatAuthors(paper.authorships)}</p>
        <p><strong>Affiliations:</strong> ${formatAffiliations(paper.authorships)}</p>
        ${paper.abstract_inverted_index ? `<p>${formatAbstract(paper.abstract_inverted_index)}</p>` : "<p><em>No abstract available.</em></p>"}
        <p><strong>AI Summary:</strong> ${aiSummary}</p>
    </section>

    <section>
        <h3>Research Objects</h3>
        <ul>${researchObjects.length ? researchObjects.join("") : "<li>None listed</li>"}</ul>
    </section>

    <section>
        <button id="saveLibraryBtn">Save to Library (login required)</button>
        <p><a href="${paper.id}" target="_blank">View on OpenAlex</a></p>
    </section>
`;
}

function formatAuthors(authorships) {
    return authorships.map(a => `<a href="profile.html?id=${a.author.id.split('/').pop()}">${a.author.display_name}</a>`).join(", ");
}

function formatAffiliations(authorships) {
    const affs = authorships.flatMap(a => a.institutions.map(i => i.display_name));
    return [...new Set(affs)].join(", ");
}

function formatAbstract(idx) {
    const words = [];
    for (const [word, positions] of Object.entries(idx)) positions.forEach(pos => words[pos]=word);
    return words.join(" ");
}

async function fetchCitedPapers(refs) {
    if (!refs.length) return [];
    const ids = refs.slice(0,20).map(id=>id.split('/').pop()).join('|');
    const res = await fetch(`https://api.openalex.org/works?filter=ids.openalex:${ids}`);
    if (!res.ok) return [];
    return (await res.json()).results || [];
}

async function fetchCitingPapers(paperId) {
    const res = await fetch(`https://api.openalex.org/works?filter=cites:${paperId}&per_page=20`);
    if (!res.ok) return [];
    return (await res.json()).results || [];
}

function renderClusterGraph(main, cited, citing) {
    const container = document.getElementById("graphContainer");
    container.innerHTML = `
        <section>
            <h2>Connected Papers</h2>
            <div id='paperGraph' style='height:600px;'></div>
        </section>
    `;

    const shortCitation = (p) => {
        const firstAuthor = p.authorships?.[0]?.author.display_name.split(" ").slice(-1)[0] || "Unknown";
        return `${firstAuthor} et al., ${p.publication_year || "n.d."}`;
    };

    const nodes = [
        { id: main.id, label: shortCitation(main), title: main.display_name, group: 'main', paperId: main.id },
        ...cited.map(p => ({ id: p.id, label: shortCitation(p), title: p.display_name, group: 'cited', paperId: p.id })),
        ...citing.map(p => ({ id: p.id, label: shortCitation(p), title: p.display_name, group: 'citing', paperId: p.id }))
    ];

    const edges = [
        ...cited.map(p => ({ from: main.id, to: p.id })),
        ...citing.map(p => ({ from: p.id, to: main.id }))
    ];

    const network = new vis.Network(
        document.getElementById('paperGraph'),
        { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
        { 
            nodes: { shape: 'dot', size: 15, font: { size: 14 } },
            edges: { arrows: 'to' },
            physics: { stabilization: true },
            interaction: { hover: true }
        }
    );

    network.on("click", function (params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodes.find(n => n.id === nodeId);
            if (node?.paperId) {
                const shortId = node.paperId.replace("https://openalex.org/", "");
                window.location.href = `paper.html?id=${encodeURIComponent(shortId)}`;
            }
        }
    });
}


function renderSidebarExtras(paper) {
    const doi = paper.doi;
    const pdfUrl = doi ? `https://api.unpaywall.org/v2/${doi}?email=info@scienceecosystem.com` : null;
    document.getElementById("pdf-link").innerHTML = pdfUrl ? `<p><strong>PDF:</strong> <a href="${doi}" target="_blank">Open PDF</a></p>` : "";

    const topics = paper.concepts || [];
    document.getElementById("keywords").innerHTML = topics.length ? `<p><strong>Topics:</strong> ${topics.map(t=>`<a href="topic.html?id=${t.id.split('/').pop()}">${t.display_name}</a>`).join(", ")}</p>` : "";

    const apaFull = formatAPA(paper);
    const apaText = formatAPAInText(paper);
    document.getElementById("citations").innerHTML = `
        <p><strong>APA Citation:</strong> <span id="apaFull">${apaFull}</span> <button onclick="copyText('apaFull')">Copy</button></p>
        <p><strong>In-text Citation:</strong> <span id="apaIn">${apaText}</span> <button onclick="copyText('apaIn')">Copy</button></p>
    `;
}

function formatAPA(p) {
    const authors = p.authorships.map(a=>a.author.display_name).join(", ");
    return `${authors} (${p.publication_year}). ${p.display_name}. ${p.primary_location?.source?.display_name || ''}. ${p.doi || ''}`;
}

function formatAPAInText(p) {
    const firstAuthor = p.authorships[0]?.author.display_name.split(" ").slice(-1)[0] || '';
    return `(${firstAuthor}, ${p.publication_year})`;
}

function copyText(id) {
    const text = document.getElementById(id).innerText;
    navigator.clipboard.writeText(text);
}
