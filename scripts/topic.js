// scripts/topic.js
(function(){
  if (!document.body || document.body.dataset.page !== "topic") return;

  const API_OA = "https://api.openalex.org";
  const API_WD = "https://www.wikidata.org/w/api.php"; // wbgetentities
  const API_WD_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData"; // JSON per entity
  const OAUTH = {}; // kept for future; all endpoints used here are open

  // ---- DOM ----
  const topicHeader    = document.getElementById("topicHeader");
  const wikiBlock      = document.getElementById("wikiBlock");
  const resourcesBlock = document.getElementById("resourcesBlock");
  const topPapersBlock = document.getElementById("topPapersBlock");
  const infoboxPanel   = document.getElementById("infoboxPanel");
  const infoboxDom     = document.getElementById("infobox");
  const topicPeople    = document.getElementById("topicPeople");

  // ---- Utils ----
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

  // ---- Networking helpers with CORS ----
  async function fetchJSON(url){
    const res = await fetch(url, { headers: { "Accept":"application/json" }});
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return await res.json();
  }
  function wdURL(params){
    const u = new URL(API_WD);
    Object.keys(params).forEach(k => u.searchParams.set(k, params[k]));
    // CORS for wikidata
    u.searchParams.set("origin", "*");
    return u.toString();
  }

  // ---- Wikipedia ----
  async function getWikipediaExtract(title){
    try {
      const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if(!resp.ok) throw new Error("Wikipedia fetch failed");
      const data = await resp.json();
      return { html: data.extract_html, url: data.content_urls?.desktop?.page, lang: data.lang || "en" };
    } catch(e){
      return { html: null, url: null, lang: "en" };
    }
  }

  // ---- Wikidata lookup ----
  function qFromAny(wdField){
    if (!wdField) return null;
    const m = String(wdField).match(/Q\d+/i);
    return m ? m[0] : null;
  }

  async function getQidFromConcept(concept){
    // prefer concept.wikidata / wikidata_id
    const direct = qFromAny(concept.wikidata || concept.wikidata_id);
    if (direct) return direct;

    // try via Wikipedia sitelink if present
    const wp = concept.wikipedia || concept.wikipedia_url || get(concept, "ids.wikipedia", null);
    if (wp){
      try{
        // Extract title and site (assume English if not obvious)
        const match = String(wp).match(/https?:\/\/([a-z\-]+)\.wikipedia\.org\/wiki\/(.+)$/i);
        const site = match ? (match[1] + "wiki") : "enwiki";
        const title = match ? decodeURIComponent(match[2]) : concept.display_name;
        const url = wdURL({
          action: "wbgetentities",
          sites: site,
          titles: title,
          format: "json",
          props: "info"
        });
        const data = await fetchJSON(url);
        const ids = Object.keys(data.entities || {}).filter(k => k !== "undefined");
        return ids.length ? ids[0] : null;
      }catch(_){}
    }
    return null;
  }

  async function fetchWikidataEntity(qid, props){
    const url = wdURL({
      action: "wbgetentities",
      ids: qid,
      format: "json",
      props: props || "labels|descriptions|claims|sitelinks|aliases|datatype"
    });
    const data = await fetchJSON(url);
    return data.entities && data.entities[qid] ? data.entities[qid] : null;
  }

  async function fetchWikidataProperties(propIds){
    if (!propIds.length) return {};
    const url = wdURL({
      action: "wbgetentities",
      ids: propIds.join("|"),
      format: "json",
      props: "labels|claims|datatype"
    });
    const data = await fetchJSON(url);
    return data.entities || {};
  }

  // ---- Class inference from Wikidata (P31/P279) ----
  const CLASS_Q = {
    TAXON: "Q16521",            // taxon
    CHEMICAL: "Q11173",         // chemical compound
    DISEASE: "Q12136",          // disease
    ORG: "Q43229",              // organization
    UNIVERSITY: "Q3918",        // university
    DATASET: "Q1172284",        // dataset
    ALGORITHM: "Q8366",         // algorithm
    STANDARD: "Q21502408"       // standard
  };

  function hasQ(entities, qid){
    return entities.some(e => e?.mainsnak?.datavalue?.value?.id === qid);
  }

  function inferClass(entity){
    const P31 = get(entity, "claims.P31", []);
    const P279 = get(entity, "claims.P279", []);
    const tags = [];

    if (hasQ(P31, CLASS_Q.TAXON) || hasQ(P279, CLASS_Q.TAXON)) tags.push("taxon");
    if (hasQ(P31, CLASS_Q.CHEMICAL) || hasQ(P279, CLASS_Q.CHEMICAL)) tags.push("chemical");
    if (hasQ(P31, CLASS_Q.DISEASE) || hasQ(P279, CLASS_Q.DISEASE)) tags.push("disease");
    if (hasQ(P31, CLASS_Q.DATASET) || hasQ(P279, CLASS_Q.DATASET)) tags.push("dataset");
    if (hasQ(P31, CLASS_Q.ALGORITHM) || hasQ(P279, CLASS_Q.ALGORITHM)) tags.push("algorithm");
    if (hasQ(P31, CLASS_Q.STANDARD) || hasQ(P279, CLASS_Q.STANDARD)) tags.push("standard");
    if (hasQ(P31, CLASS_Q.UNIVERSITY)) tags.push("university");
    if (hasQ(P31, CLASS_Q.ORG) || hasQ(P279, CLASS_Q.ORG)) tags.push("organization");

    if (!tags.length) tags.push("generic");
    return tags;
  }

  // ---- External identifiers (generic, using formatter URL P1630) ----
  function collectExternalIdClaims(entity){
    const claims = entity.claims || {};
    const out = []; // { pid, value }
    for (const pid in claims){
      const rows = claims[pid] || [];
      for (let i=0;i<rows.length;i++){
        const snak = rows[i].mainsnak;
        const dt = snak?.datavalue?.type;
        if (dt === "string"){
          const val = snak.datavalue.value;
          out.push({ pid, value: String(val) });
        }
      }
    }
    return out;
  }

  async function buildAuthorityList(entity){
    const ids = collectExternalIdClaims(entity);
    if (!ids.length) return '<p class="muted">No identifiers found.</p>';

    // unique properties
    const pids = Array.from(new Set(ids.map(i => i.pid)));
    const propEntities = await fetchWikidataProperties(pids);

    // Group by property label + formatter URL
    const items = [];
    for (const it of ids){
      const prop = propEntities[it.pid];
      if (!prop) continue;
      const label = get(prop, "labels.en.value", it.pid);
      let link = null;

      // find formatter URL P1630 on property
      const fmts = get(prop, "claims.P1630", []);
      if (fmts.length){
        const fmt = fmts[0]?.mainsnak?.datavalue?.value;
        if (fmt && typeof fmt === "string"){
          link = fmt.replace("$1", encodeURIComponent(it.value));
        }
      }
      // Make list item
      items.push(
        `<li><strong>${escapeHtml(label)}:</strong> ${
          link ? `<a href="${link}" target="_blank" rel="noopener">${escapeHtml(it.value)}</a>` : escapeHtml(it.value)
        }</li>`
      );
    }

    // De-duplicate visually by label+value (some props repeat)
    const seen = new Set();
    const unique = items.filter(li => {
      const key = li.replace(/<[^>]+>/g,"");
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    return `<ul class="list-reset" style="margin:0; padding-left:0.9rem;">${unique.join("")}</ul>`;
  }

  // ---- Typed infobox fields (pull from Wikidata claims) ----
  function pickItemLabel(snak, entitiesCache){
    const id = snak?.mainsnak?.datavalue?.value?.id;
    if (!id) return null;
    const lbl = get(entitiesCache[id], "labels.en.value", null);
    return { id, label: lbl || id };
  }

  function claimValString(claim){
    return claim?.mainsnak?.datavalue?.value || null;
  }

  async function buildInfobox(entity, classTags){
    // For any wikibase-item values we want labels -> include the item entities
    // We can re-use the "Special:EntityData" which returns all linked entities too,
    // but to keep requests small we’ll just render IDs if labels aren’t available.
    // For compactness, we rely on labels present in this entity’s sitelinks/labels where possible.

    const claims = entity.claims || {};
    const labelOf = (id) => get(entity, "labels.en.value", null) && id; // (We keep generic; we only need this entity's own label for header)

    const rows = [];
    function addRow(key, valueHTML){
      if (!valueHTML) return;
      rows.push(`<div class="stat" style="min-width:140px;max-width:220px;padding:.55rem .7rem;border:1px solid #e5e7eb;border-radius:9px;margin:.25rem 0;">
        <div class="stat-label" style="font-size:.8rem;color:#475569;">${escapeHtml(key)}</div>
        <div class="stat-value" style="font-weight:700;">${valueHTML}</div>
      </div>`);
    }

    // Helpers for common property IDs
    const P = (pid) => get(claims, pid + ".0", null);      // take first claim
    const PV = (pid) => claimValString(P(pid));             // string datavalue
    const PITEM = (pid) => P(pid)?.mainsnak?.datavalue?.value?.id || null;

    // TAXON fields
    if (classTags.includes("taxon")){
      const rank = PITEM("P105");         // taxon rank
      const parent = PITEM("P171");       // parent taxon
      const iucn = PITEM("P141");         // IUCN status
      const commonNames = (claims["P1843"] || []).slice(0,3).map(c => claimValString(c)).filter(Boolean); // taxon common name
      addRow("Rank", rank ? `<a href="topic.html?id=${encodeURIComponent(rank)}">${escapeHtml(rank)}</a>` : null);
      addRow("Parent taxon", parent ? `<a href="topic.html?id=${encodeURIComponent(parent)}">${escapeHtml(parent)}</a>` : null);
      addRow("IUCN status", iucn ? escapeHtml(iucn) : null);
      if (commonNames.length) addRow("Common names", commonNames.map(escapeHtml).join(", "));
    }

    // CHEMICAL fields
    if (classTags.includes("chemical")){
      const formula = PV("P274");         // chemical formula
      const cas = PV("P231");             // CAS
      const inchi = PV("P234");           // InChI
      const inchikey = PV("P235");        // InChIKey
      addRow("Formula", formula);
      addRow("CAS", cas);
      addRow("InChI", inchi);
      addRow("InChIKey", inchikey);
    }

    // DISEASE fields (best-effort)
    if (classTags.includes("disease")){
      const cause = PITEM("P828");         // has cause
      const symptom = PITEM("P780");       // symptoms (first)
      addRow("Cause", cause ? escapeHtml(cause) : null);
      addRow("Common symptom", symptom ? escapeHtml(symptom) : null);
    }

    // ORGANIZATION / UNIVERSITY fields
    if (classTags.includes("university") || classTags.includes("organization")){
      const country = PITEM("P17");        // country
      const city = PITEM("P131");          // located in the admin. territorial entity
      addRow("Type", classTags.includes("university") ? "University" : "Organization");
      addRow("Country", country ? escapeHtml(country) : null);
      addRow("Location", city ? escapeHtml(city) : null);
    }

    // DATASET fields
    if (classTags.includes("dataset")){
      const license = PITEM("P275");       // license
      const doi = PV("P356");              // DOI (also in OpenAlex)
      addRow("License", license ? escapeHtml(license) : null);
      addRow("DOI", doi ? `<a href="https://doi.org/${encodeURIComponent(doi)}" target="_blank" rel="noopener">${escapeHtml(doi)}</a>` : null);
    }

    // STANDARD fields
    if (classTags.includes("standard")){
      const version = PV("P348");          // version
      const developer = PITEM("P178");     // developer(s)
      addRow("Version", version);
      addRow("Developer", developer ? escapeHtml(developer) : null);
    }

    // Fallback: show instance-of
    if (!rows.length){
      const inst = PITEM("P31");
      if (inst) addRow("Instance of", escapeHtml(inst));
    }

    // Authority control / identifiers
    const idsList = await buildAuthorityList(entity);

    return `
      <div class="header-stats stats-grid" style="display:grid;grid-template-columns:1fr;justify-items:end;gap:.5rem;">
        ${rows.join("") || '<div class="muted">No key facts available.</div>'}
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:.75rem 0;" />
      <h4 style="margin:.25rem 0 .25rem;">Identifiers</h4>
      ${idsList}
    `;
  }

  // ---- Auto-linking (ancestors + related + frequent concepts from top works) ----
  function regexEscape(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function buildLinkMapFromConcept(concept, extraTerms){
    const pairs = [];
    const seen = Object.create(null);
    function add(name, id){
      if (!name || !id) return;
      const key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      const t = tail(id);
      if (!t) return;
      pairs.push({ term: name, idTail: t });
    }
    (Array.isArray(concept.ancestors) ? concept.ancestors : []).forEach(a => add(a.display_name, a.id));
    (Array.isArray(concept.related_concepts) ? concept.related_concepts : []).forEach(r => add(r.display_name, r.id));
    (extraTerms || []).forEach(x => add(x.name, x.id));
    // don't self-link
    return pairs.filter(p => p.term.toLowerCase() !== String(concept.display_name||"").toLowerCase());
  }

  function linkifyHTML(htmlString, linkPairs){
    if (!htmlString || !linkPairs.length) return htmlString;
    const sorted = linkPairs.slice().sort((a,b)=> b.term.length - a.term.length);
    const pattern = "\\b(" + sorted.map(p => regexEscape(p.term)).join("|") + ")\\b";
    const rx = new RegExp(pattern, "gi");

    const container = document.createElement("div");
    container.innerHTML = htmlString;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        if (node.parentElement && node.parentElement.closest("a")) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(node => {
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

  async function frequentConceptsFromTopWorks(conceptIdTail){
    try{
      const u = new URL(`${API_OA}/works`);
      u.searchParams.set("filter", `concepts.id:${conceptIdTail}`);
      u.searchParams.set("sort", "cited_by_count:desc");
      u.searchParams.set("per_page", "50");
      const data = await fetchJSON(u.toString());
      const results = Array.isArray(data.results) ? data.results : [];
      const counts = Object.create(null);
      results.forEach(w => {
        (w.concepts || []).forEach(c => {
          const name = c.display_name;
          const id = c.id;
          const idTail = tail(id);
          if (!name || !idTail) return;
          if (idTail === conceptIdTail) return; // skip self
          const key = idTail;
          counts[key] = counts[key] || { name, id, n: 0 };
          counts[key].n += 1;
        });
      });
      const arr = Object.keys(counts).map(k => counts[k]);
      arr.sort((a,b)=> b.n - a.n);
      return arr.slice(0, 20);
    }catch(_){ return []; }
  }

  // ---- People (top authors) ----
  async function loadTopAuthors(conceptIdTail){
    try{
      const u = new URL(`${API_OA}/authors`);
      u.searchParams.set("filter", `x_concepts.id:${conceptIdTail}`);
      u.searchParams.set("sort", "cited_by_count:desc");
      u.searchParams.set("per_page", "10");
      const data = await fetchJSON(u.toString());
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
      return '<li class="muted">No people listed</li>';
    }
  }

  // ---- Top papers as shared cards ----
  async function loadTopPapers(conceptIdTail){
    const worksResp = await fetch(`${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)}&sort=cited_by_count:desc&per_page=12`);
    const works = (await worksResp.json()).results || [];
    if (!works.length) return '<p class="muted">No papers found.</p>';
    const html = works.map(w => SE.components.renderPaperCard(w, { compact: true })).join("");
    return html;
  }

  function buildResources(concept, wikiURL){
    const bits = [];
    const openalexURL = concept.id || "";
    const wikidata = concept.wikidata || concept.wikidata_id || null;
    if (wikiURL)    bits.push(`<li><a href="${wikiURL}" target="_blank" rel="noopener">Wikipedia article</a></li>`);
    if (wikidata)   bits.push(`<li><a href="${String(wikidata).startsWith("http") ? wikidata : "https://www.wikidata.org/wiki/"+wikidata}" target="_blank" rel="noopener">Wikidata item</a></li>`);
    if (openalexURL)bits.push(`<li><a href="${openalexURL}" target="_blank" rel="noopener">OpenAlex concept</a></li>`);
    if (!bits.length) return '<p class="muted">No external resources.</p>';
    return `<ul class="list-reset">${bits.join("")}</ul>`;
  }

  // ---- Main loader ----
  async function loadTopic(){
    const idParam = getParam("id");
    if(!idParam) { topicHeader.innerHTML = "<p>Missing topic ID.</p>"; return; }
    const idTail = idParam.includes("openalex.org") ? idParam.split("/").pop() : idParam;
    try {
      // OpenAlex concept
      const topic = await (await fetch(`${API_OA}/concepts/${idTail}`)).json();
      document.title = `${topic.display_name} | Topic | ScienceEcosystem`;
      const yearEl = document.getElementById("year");
      if (yearEl) yearEl.textContent = new Date().getFullYear();

      // Wikipedia lead
      const { html: wikiHTML, url: wikiURL } = await getWikipediaExtract(topic.display_name);

      // Frequent concepts from top works (for better auto-linking)
      const extraLinkTerms = await frequentConceptsFromTopWorks(idTail);

      // Link map & linked overview
      const linkPairs = buildLinkMapFromConcept(topic, extraLinkTerms.map(x => ({ name: x.name, id: x.id })));
      const baseIntro = wikiHTML || `<p>${escapeHtml(topic.description || "No description available.")}</p>`;
      const linkedIntro = linkPairs.length ? linkifyHTML(baseIntro, linkPairs) : baseIntro;

      // Header (clean, not duplicating sidebar)
      topicHeader.innerHTML = `
        <h1>${escapeHtml(topic.display_name)}</h1>
        <p class="muted" style="margin:.25rem 0 0;">A living, research-grounded overview. Updated from Wikipedia, Wikidata, and OpenAlex.</p>
      `;

      // Overview
      wikiBlock.innerHTML = `
        <h2>Overview</h2>
        ${linkedIntro}
        ${wikiURL ? `<p style="font-size:0.9em;">Source: <a href="${wikiURL}" target="_blank" rel="noopener">Wikipedia</a></p>` : ""}
      `;

      // Resources
      resourcesBlock.innerHTML = `
        <h2>External resources</h2>
        ${buildResources(topic, wikiURL)}
      `;

      // Top papers
      const papersHTML = await loadTopPapers(idTail);
      topPapersBlock.innerHTML = `<h2>Influential papers</h2>${papersHTML}`;
      if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
        SE.components.enhancePaperCards(topPapersBlock);
      }

      // People (top authors)
      topicPeople.innerHTML = await loadTopAuthors(idTail);

      // Infobox via Wikidata
      let qid = await getQidFromConcept(topic);
      if (!qid){
        // last resort: try by title
        const url = wdURL({ action:"wbsearchentities", format:"json", language:"en", type:"item", search:String(topic.display_name||"") });
        const sr = await fetchJSON(url);
        qid = (sr.search && sr.search[0] && sr.search[0].id) ? sr.search[0].id : null;
      }

      if (qid){
        const entity = await fetchWikidataEntity(qid, "labels|descriptions|claims|sitelinks|aliases|datatype");
        const tags = inferClass(entity);
        infoboxDom.innerHTML = await buildInfobox(entity, tags);
      } else {
        infoboxDom.innerHTML = '<p class="muted">No Wikidata record found.</p>';
      }

    } catch(e){
      console.error(e);
      topicHeader.innerHTML = "<p>Error loading topic data.</p>";
      wikiBlock.innerHTML = "";
      resourcesBlock.innerHTML = "";
      topPapersBlock.innerHTML = "";
      infoboxDom.innerHTML = "—";
      topicPeople.innerHTML = '<li class="muted">No people listed</li>';
    }
  }

  document.addEventListener("DOMContentLoaded", loadTopic);
})();
