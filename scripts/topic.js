// scripts/topic.js
(function(){
  if (!document.body || document.body.dataset.page !== "topic") return;

  const API = "https://api.openalex.org";

  const topicHeader   = document.getElementById("topicHeader");
  const wikiBlock     = document.getElementById("wikiBlock");
  const resourcesBlock= document.getElementById("resourcesBlock");
  const topPapersBlock= document.getElementById("topPapersBlock");
  const topicMeta     = document.getElementById("topicMeta");
  const topicPeople   = document.getElementById("topicPeople");

  const getParam = (name) => new URLSearchParams(location.search).get(name);
  const tail = (id) => id ? String(id).replace(/^https?:\/\/openalex\.org\//i, "") : "";

  function escapeHtml(str){
    str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c]));
  }
  function get(obj, path, fb){
    try{
      const p = path.split(".");
      let cur = obj;
      for (let i=0;i<p.length;i++){ if(cur==null) return fb; cur = cur[p[i]]; }
      return cur==null ? fb : cur;
    }catch(e){ return fb; }
  }

  // ---------- Wikipedia summary ----------
  async function getWikipediaExtract(title){
    try {
      const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if(!resp.ok) throw new Error("Wikipedia fetch failed");
      const data = await resp.json();
      return { html: data.extract_html, url: data.content_urls?.desktop?.page, lang: data.lang || "en" };
    } catch(e){
      console.warn("Wikipedia summary not available:", e);
      return { html: null, url: null, lang: "en" };
    }
  }

  // ---------- Auto-linking like Wikipedia ----------
  function regexEscape(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function buildLinkMap(concept){
    // Use ancestors + related concepts to produce link targets
    const pairs = [];
    const seen = Object.create(null);

    const add = (name, id) => {
      if (!name || !id) return;
      const key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      const t = tail(id);
      if (!t) return;
      pairs.push({ term: name, idTail: t });
    };

    (Array.isArray(concept.ancestors) ? concept.ancestors : []).forEach(a => add(a.display_name, a.id));
    (Array.isArray(concept.related_concepts) ? concept.related_concepts : []).forEach(r => add(r.display_name, r.id));

    // Don’t self-link the current topic name
    const selfName = (concept.display_name || "").toLowerCase();
    return pairs.filter(p => p.term.toLowerCase() !== selfName);
  }

  function linkifyHTML(htmlString, linkPairs){
    if (!htmlString || !linkPairs.length) return htmlString;

    // Sort by term length (desc) to avoid partial overlaps
    const sorted = linkPairs.slice().sort((a,b)=> b.term.length - a.term.length);
    const pattern = "\\b(" + sorted.map(p => regexEscape(p.term)).join("|") + ")\\b";
    const rx = new RegExp(pattern, "gi");

    const container = document.createElement("div");
    container.innerHTML = htmlString;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        // Skip inside existing links
        if (node.parentElement && node.parentElement.closest("a")) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const toProcess = [];
    let n;
    while ((n = walker.nextNode())) toProcess.push(n);

    toProcess.forEach(node => {
      const txt = node.nodeValue;
      if (!rx.test(txt)) return;
      rx.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      txt.replace(rx, (match, p1, idx) => {
        const pre = txt.slice(last, idx);
        if (pre) frag.appendChild(document.createTextNode(pre));
        const found = sorted.find(p => p.term.toLowerCase() === p1.toLowerCase());
        const a = document.createElement("a");
        a.href = "topic.html?id=" + encodeURIComponent(found.idTail);
        a.textContent = p1;
        frag.appendChild(a);
        last = idx + p1.length;
        return p1;
      });
      const rest = txt.slice(last);
      if (rest) frag.appendChild(document.createTextNode(rest));
      node.parentNode.replaceChild(frag, node);
    });

    return container.innerHTML;
  }

  // ---------- People (top authors) ----------
  async function loadTopAuthors(conceptIdTail){
    try{
      // Prefer concept.related_authors if present (fewer requests)
      // Fallback: query authors endpoint by concept
      const u = new URL(`${API}/authors`);
      u.searchParams.set("filter", `x_concepts.id:${conceptIdTail}`);
      u.searchParams.set("sort", "cited_by_count:desc");
      u.searchParams.set("per_page", "10");
      const data = await (await fetch(u)).json();
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) return '<li class="muted">No people listed</li>';

      return results.map(a => {
        const idT = tail(a.id);
        const name = a.display_name || "Unknown";
        const cits = a.cited_by_count || 0;
        return `<li class="list-item list-card" style="display:flex;justify-content:space-between;align-items:center;">
                  <a href="profile.html?id=${encodeURIComponent(idT)}">${escapeHtml(name)}</a>
                  <span class="badge" title="Total citations">${cits.toLocaleString()}</span>
                </li>`;
      }).join("");
    }catch(e){
      console.warn("Top authors fetch failed", e);
      return '<li class="muted">No people listed</li>';
    }
  }

  // ---------- Top papers as shared cards ----------
  async function loadTopPapers(conceptIdTail){
    const worksResp = await fetch(`${API}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)}&sort=cited_by_count:desc&per_page=12`);
    const works = (await worksResp.json()).results || [];
    if (!works.length) {
      return '<p class="muted">No papers found.</p>';
    }
    const html = works.map(w => SE.components.renderPaperCard(w, { compact: true })).join("");
    return html;
  }

  function buildResources(concept, wikiURL){
    const bits = [];
    const openalexURL = concept.id || "";
    const wikidata = get(concept, "wikidata", null) || get(concept, "wikidata_id", null);
    if (wikiURL)    bits.push(`<li><a href="${wikiURL}" target="_blank" rel="noopener">Wikipedia article</a></li>`);
    if (wikidata)   bits.push(`<li><a href="https://www.wikidata.org/wiki/${encodeURIComponent(wikidata.replace(/^https?:\/\/www\.wikidata\.org\/entity\//,'').trim())}" target="_blank" rel="noopener">Wikidata item</a></li>`);
    if (openalexURL)bits.push(`<li><a href="${openalexURL}" target="_blank" rel="noopener">OpenAlex concept</a></li>`);
    if (!bits.length) return '<p class="muted">No external resources.</p>';
    return `<ul class="list-reset">${bits.join("")}</ul>`;
  }

  function ancestorLine(concept){
    const anc = Array.isArray(concept.ancestors) ? concept.ancestors : [];
    if (!anc.length) return "—";
    return anc.map(a => {
      const t = tail(a.id);
      return `<a href="topic.html?id=${encodeURIComponent(t)}">${escapeHtml(a.display_name || "Topic")}</a>`;
    }).join(" · ");
  }

  // ---------- Main loader ----------
  async function loadTopic(){
    const idParam = getParam("id");
    if(!idParam) { topicHeader.innerHTML = "<p>Missing topic ID.</p>"; return; }
    const idTail = idParam.includes("openalex.org") ? idParam.split("/").pop() : idParam;

    try {
      // Fetch topic
      const topic = await (await fetch(`${API}/concepts/${idTail}`)).json();
      document.title = `${topic.display_name} | Topic | ScienceEcosystem`;
      const yearEl = document.getElementById("year");
      if (yearEl) yearEl.textContent = new Date().getFullYear();

      // Wikipedia extract
      const { html: wikiHTML, url: wikiURL } = await getWikipediaExtract(topic.display_name);

      // Build link map for auto-linking
      const linkPairs = buildLinkMap(topic);
      const baseIntro = wikiHTML || `<p>${escapeHtml(topic.description || "No description available.")}</p>`;
      const linkedIntro = linkPairs.length ? linkifyHTML(baseIntro, linkPairs) : baseIntro;

      // ---------- Header ----------
      topicHeader.innerHTML = `
        <h1>${escapeHtml(topic.display_name)}</h1>
        <p class="muted">Works: ${Number(topic.works_count||0).toLocaleString()} · Level: ${escapeHtml(String(topic.level))} · Field: ${ancestorLine(topic)}</p>
        <p>
          <a href="${topic.id}" target="_blank" rel="noopener">View on OpenAlex</a>
        </p>
      `;

      // ---------- Wiki-like Overview (with auto-linked terms) ----------
      wikiBlock.innerHTML = `
        <h2>Overview</h2>
        ${linkedIntro}
        ${wikiURL ? `<p style="font-size:0.9em;">Source: <a href="${wikiURL}" target="_blank" rel="noopener">Wikipedia</a></p>` : ""}
      `;

      // ---------- External Resources ----------
      resourcesBlock.innerHTML = `
        <h2>External resources</h2>
        ${buildResources(topic, wikiURL)}
      `;

      // ---------- Top Papers (shared cards) ----------
      const papersHTML = await loadTopPapers(idTail);
      topPapersBlock.innerHTML = `<h2>Influential papers</h2>${papersHTML}`;
      // Enhance (Unpaywall + abstract toggle + save + cite)
      if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
        SE.components.enhancePaperCards(topPapersBlock);
      }

      // ---------- Sidebar Meta ----------
      const topAncestor = get(topic, "ancestors.0.display_name", "N/A");
      const topAncestorId = get(topic, "ancestors.0.id", null);
      const topAncHTML = topAncestorId
        ? `<a href="topic.html?id=${encodeURIComponent(tail(topAncestorId))}">${escapeHtml(topAncestor)}</a>`
        : escapeHtml(topAncestor);
      topicMeta.innerHTML = `
        <p><strong>Works:</strong> ${Number(topic.works_count||0).toLocaleString()}</p>
        <p><strong>Level:</strong> ${escapeHtml(String(topic.level))}</p>
        <p><strong>Top ancestor:</strong> ${topAncHTML}</p>
      `;

      // ---------- Sidebar People (top authors) ----------
      topicPeople.innerHTML = await loadTopAuthors(idTail);

    } catch(e){
      console.error(e);
      topicHeader.innerHTML = "<p>Error loading topic data.</p>";
      wikiBlock.innerHTML = "";
      resourcesBlock.innerHTML = "";
      topPapersBlock.innerHTML = "";
      topicMeta.innerHTML = "—";
      topicPeople.innerHTML = '<li class="muted">No people listed</li>';
    }
  }

  document.addEventListener("DOMContentLoaded", loadTopic);
})();
