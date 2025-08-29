(function(){
  if (!document.body || document.body.dataset.page !== "topic") return;

  const API = "https://api.openalex.org";

  const topicHeader = document.getElementById("topicHeader");
  const wikiBlock = document.getElementById("wikiBlock");
  const topPapersBlock = document.getElementById("topPapersBlock");
  const graphBlock = document.getElementById("graphBlock");
  const relatedBlock = document.getElementById("relatedBlock");
  const topicMeta = document.getElementById("topicMeta");
  const topicPeople = document.getElementById("topicPeople");

  const getParam = (name) => new URLSearchParams(location.search).get(name);

  async function getWikipediaExtract(title){
    try {
      const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if(!resp.ok) throw new Error("Wikipedia fetch failed");
      const data = await resp.json();
      return { html: data.extract_html, url: data.content_urls?.desktop?.page };
    } catch(e){ console.warn("Wikipedia summary not available:", e); return { html: null, url: null }; }
  }

  async function loadTopic(){
    const idParam = getParam("id");
    if(!idParam) { topicHeader.innerHTML = "<p>Missing topic ID.</p>"; return; }
    const id = idParam.includes("openalex.org") ? idParam.split("/").pop() : idParam;

    try {
      // Fetch topic
      const topic = await (await fetch(`${API}/concepts/${id}`)).json();
      document.title = `${topic.display_name} | Topic | ScienceEcosystem`;

      // Wikipedia extract
      const { html: wikiHTML, url: wikiURL } = await getWikipediaExtract(topic.display_name);

      // ---------- Header ----------
      topicHeader.innerHTML = `
        <h1>${topic.display_name}</h1>
        <p class="muted">Works: ${topic.works_count.toLocaleString()} · Level: ${topic.level} · Top ancestor: ${topic.ancestors?.[0]?.display_name || "N/A"}</p>
        <p>
          <a href="${topic.id}" target="_blank">View on OpenAlex</a>
        </p>
      `;

      // ---------- Wiki Block ----------
      wikiBlock.innerHTML = `
        <h2>About this topic</h2>
        ${wikiHTML || `<p>${topic.description || "No description available."}</p>`}
        ${wikiURL ? `<p style="font-size:0.9em;">Source: <a href="${wikiURL}" target="_blank">Wikipedia</a></p>` : ""}
      `;

      // ---------- Top Papers ----------
      const worksResp = await fetch(`${API}/works?filter=concepts.id:${id}&sort=cited_by_count:desc&per_page=10`);
      const works = (await worksResp.json()).results || [];
      topPapersBlock.innerHTML = `<h2>Top Papers</h2>` +
        (works.length ? '<ul>' + works.map(w => {
          const authors = (w.authorships||[]).map(a => a.author?.display_name || "Unknown").join(", ");
          const year = w.publication_year || "N/A";
          const shortId = w.id.split("/").pop();
          return `<li>
            <a href="paper.html?id=${shortId}">${w.title}</a><br>
            ${authors} — ${year}
          </li>`;
        }).join("") + '</ul>' : '<p class="muted">No papers found.</p>');

      // ---------- Related Topics ----------
      relatedBlock.innerHTML = `<h2>Related Topics</h2>` +
        (topic.related_concepts?.length ? '<ul>' + topic.related_concepts.map(t => {
          const tid = t.id.split("/").pop();
          return `<li><a href="topic.html?id=${tid}">${t.display_name}</a></li>`;
        }).join("") + '</ul>' : '<p class="muted">No related topics.</p>');

      // ---------- Sidebar Meta ----------
      topicMeta.innerHTML = `
        <p><strong>Works count:</strong> ${topic.works_count.toLocaleString()}</p>
        <p><strong>Level:</strong> ${topic.level}</p>
        <p><strong>Top ancestor:</strong> ${topic.ancestors?.[0]?.display_name || "N/A"}</p>
      `;

      // ---------- Sidebar People ----------
      topicPeople.innerHTML = (topic.related_authors?.length ? topic.related_authors.map(a => {
        return `<li>${a.display_name}</li>`;
      }).join("") : '<li class="muted">No people listed</li>');

      // ---------- Topic Graph ----------
      graphBlock.innerHTML = `<h2>Topic Graph</h2><div id="topicGraph" style="height:400px;"></div>`;
      if(window.vis && topicGraph) {
        const nodes = [{id: topic.id, label: topic.display_name}];
        const edges = [];
        (topic.related_concepts||[]).forEach(t=>{
          nodes.push({id: t.id, label: t.display_name});
          edges.push({from: topic.id, to: t.id});
        });
        new vis.Network(document.getElementById("topicGraph"), {nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges)}, {nodes:{shape:"dot", size:15}, edges:{arrows:"to"}});
      }

    } catch(e){
      console.error(e);
      topicHeader.innerHTML = "<p>Error loading topic data.</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", loadTopic);

})();
