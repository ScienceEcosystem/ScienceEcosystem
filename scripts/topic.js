// scripts/topic.js
(function () {
  if (!document.body || document.body.dataset.page !== "topic") return;

  // ---------- Constants ----------
  const API_OA = "https://api.openalex.org";
  const API_WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
  const API_WIKI_ACTION = "https://en.wikipedia.org/w/api.php";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const topicTitle = $("topicTitle");
  const topicSubtitle = $("topicSubtitle");
  const topicMeta = $("topicMeta");
  const wikiArticle = $("wikiArticle");
  const wikiAttribution = $("wikiAttribution");
  const tocBlock = $("tocBlock");
  const tocNav = $("tocNav");
  const referencesList = $("referencesList");
  const referencesWhy = $("referencesWhy");
  const papersCards = $("papersCards");
  const infoboxDom = $("infobox");
  const topicPeople = $("topicPeople");
  const relatedBlock = $("relatedBlock");
  const trendSparkline = $("trendSparkline");

  // ---------- Utils ----------
  const getParam = (name) => new URLSearchParams(location.search).get(name);
  const tail = (id) => id ? String(id).replace(/^https?:\/\/openalex\.org\//i, "") : "";
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function escapeHtml(str){
    str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c]));
  }

  async function fetchJSON(url, opts){
    const res = await fetch(url, Object.assign({ headers: { "Accept":"application/json" }}, opts||{}));
    if (!res.ok) throw new Error(res.status + " " + res.statusText + " — " + url);
    return await res.json();
  }

  // ---------- Local cache ----------
  function cacheKey(topicId, key){ return `topic:${topicId}:${key}`; }
  function cacheRead(topicId, key){
    try{
      const raw = localStorage.getItem(cacheKey(topicId, key));
      if(!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > CACHE_TTL_MS) return null;
      return v;
    }catch(_){ return null; }
  }
  function cacheWrite(topicId, key, value){
    try{ localStorage.setItem(cacheKey(topicId, key), JSON.stringify({ t: Date.now(), v: value })); }catch(_){}
  }

  // ---------- Wikipedia fetch (mobile-html) ----------
  async function loadWikipediaArticle(title){
    const url = `${API_WIKI_REST}/page/mobile-html/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { "Accept": "text/html" }});
    if(!res.ok) throw new Error(`Wikipedia mobile-html failed: ${res.status}`);
    return await res.text();
  }
  async function loadWikipediaRevisionMeta(title){
    const u = new URL(API_WIKI_ACTION);
    u.searchParams.set("action","query");
    u.searchParams.set("prop","revisions|info");
    u.searchParams.set("rvprop","ids|timestamp");
    u.searchParams.set("inprop","url");
    u.searchParams.set("titles", title);
    u.searchParams.set("format","json");
    u.searchParams.set("origin","*");
    const data = await fetchJSON(u.toString());
    const pages = data?.query?.pages || {};
    const first = Object.values(pages)[0];
    const rev = first?.revisions?.[0];
    const ts = rev?.timestamp ? new Date(rev.timestamp) : null;
    const fullurl = first?.fullurl || null;
    return { lastRev: ts, url: fullurl };
  }

  // ---------- Sanitiser: keep SE look, strip Wikipedia styles ----------
  const ALLOWED_TAGS = new Set([
    "P","H2","H3","H4","UL","OL","LI","B","STRONG","I","EM","A","IMG",
    "BLOCKQUOTE","CODE","PRE","TABLE","THEAD","TBODY","TR","TH","TD","SUP","SUB"
  ]);
  function makeIdFromText(t){
    return "sec-" + t.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,64);
  }
  function sanitiseWikipediaHTML(html){
    const src = document.createElement("div");
    src.innerHTML = html;

    // Remove all styles/scripts/links that would restyle the page
    src.querySelectorAll("style, link, script, noscript").forEach(n => n.remove());

    // Find main content container candidates; fallback to entire html
    // Mobile HTML often uses sections; we’ll take the whole body content
    const contentRoot = src;

    const out = document.createElement("div");
    out.className = "se-wiki-clean";

    function cloneNodeSafe(node){
      if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.nodeValue);
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = node.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        // Recurse into children for unsupported wrappers
        const frag = document.createDocumentFragment();
        node.childNodes.forEach(ch => {
          const c = cloneNodeSafe(ch);
          if (c) frag.appendChild(c);
        });
        return frag;
      }
      const el = document.createElement(tag.toLowerCase());

      // Allowed attributes per tag
      if (tag === "A") {
        const href = node.getAttribute("href") || "";
        if (href && /^https?:\/\//i.test(href)) {
          el.setAttribute("href", href);
          el.setAttribute("target","_blank");
          el.setAttribute("rel","noopener");
        }
      } else if (tag === "IMG") {
        // Keep only safe images (Wikimedia uploads); downscale via width
        let srcAttr = node.getAttribute("src") || "";
        if (/^https?:\/\/upload\.wikimedia\.org\//i.test(srcAttr)) {
          el.setAttribute("src", srcAttr);
          const alt = node.getAttribute("alt") || "";
          if (alt) el.setAttribute("alt", alt);
          el.setAttribute("loading","lazy");
          el.style.maxWidth = "100%";
          el.style.height = "auto";
        } else {
          // skip non-wikimedia images
          return document.createTextNode(""); 
        }
      }
      // Never copy class/style/id from Wikipedia
      node.childNodes.forEach(ch => {
        const c = cloneNodeSafe(ch);
        if (c) el.appendChild(c);
      });
      return el;
    }

    // Build output: only the sequence of allowed content nodes (no site chrome)
    contentRoot.childNodes.forEach(n => {
      const c = cloneNodeSafe(n);
      if (c) out.appendChild(c);
    });

    // Assign stable ids to headings we keep
    out.querySelectorAll("h2, h3, h4").forEach(h => {
      if (!h.id || /^sec-\d+/.test(h.id)) {
        const txt = h.textContent || "";
        const gen = makeIdFromText(txt) || ("sec-" + Math.random().toString(36).slice(2,8));
        h.id = gen;
      }
    });

    return out;
  }

  // ---------- ToC ----------
  function buildTOC(container){
    const headings = container.querySelectorAll("h2, h3");
    if (!headings.length) { tocBlock.style.display = "none"; return; }
    const items = [];
    headings.forEach((h) => {
      const level = h.tagName.toLowerCase() === "h2" ? 2 : 3;
      items.push({ id: h.id, text: (h.textContent||"").trim(), level });
    });
    tocNav.innerHTML = items.map(it => {
      const pad = it.level === 3 ? ' style="padding-left:1rem;"' : "";
      return `<div class="toc-item"${pad}><a href="#${escapeHtml(it.id)}">${escapeHtml(it.text)}</a></div>`;
    }).join("");
    tocBlock.style.display = "";
  }

  // ---------- OpenAlex helpers ----------
  async function fetchOpenAlexJSON(url, retries=2){
    for (let i=0;i<=retries;i++){
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429 && i < retries) { await sleep(500*(i+1)); continue; }
      throw new Error(`OpenAlex error ${res.status}: ${url}`);
    }
  }
  function pickYear(val){
    if (!val) return null;
    const m = String(val).match(/^(\d{4})/);
    return m ? m[1] : null;
  }
  function formatAuthors(authors){
    if (!authors || !authors.length) return "";
    const names = authors.slice(0,3).map(a => a?.author?.display_name || "").filter(Boolean);
    if (authors.length > 3) names.push("et al.");
    return names.join(", ");
  }
  function citeLine(w){
    const authors = formatAuthors(w.authorships || []);
    const year = pickYear(w.publication_year || w.published_date || w.from_publication_date);
    const title = w.title || "Untitled";
    const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "";
    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i,"") : null;
    const doiHref = doi ? `https://doi.org/${encodeURIComponent(doi)}` : (w.primary_location?.landing_page_url || w.id);
    const parts = [];
    if (authors) parts.push(`${escapeHtml(authors)}`);
    if (year) parts.push(`(${year})`);
    parts.push(`${escapeHtml(title)}.`);
    if (venue) parts.push(`<i>${escapeHtml(venue)}</i>.`);
    if (doiHref) parts.push(`<a href="${doiHref}" target="_blank" rel="noopener">${doi ? "https://doi.org/" + escapeHtml(doi) : "Link"}</a>`);
    return parts.join(" ");
  }
  function dedupByDOI(arr){
    const seen = new Set(); const out = [];
    for (const w of arr){
      const key = (w.doi || w.id || "").toLowerCase();
      if (seen.has(key)) continue; seen.add(key); out.push(w);
    }
    return out;
  }

  // ---------- Load sections ----------
  async function loadReferences(conceptIdTail){
    const nowY = new Date().getUTCFullYear();
    const reviewURL = `${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)},type:review&sort=cited_by_count:desc&per_page=10`;
    const recentURL = `${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)},from_publication_date:${nowY-2}-01-01&sort=cited_by_count:desc&per_page=10`;
    const [rev, rec] = await Promise.all([ fetchOpenAlexJSON(reviewURL), fetchOpenAlexJSON(recentURL) ]);
    const works = dedupByDOI([...(rev.results||[]), ...(rec.results||[])]).slice(0,15);
    referencesList.innerHTML = works.length ? works.map(w => `<li>${citeLine(w)}</li>`).join("") : `<p class="muted">No references available.</p>`;
    referencesWhy.textContent = "Selected via OpenAlex: citation impact (reviews) and recent influential works (last two years).";
  }

  async function loadTopPapers(conceptIdTail){
    try{
      const data = await fetchOpenAlexJSON(`${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)}&sort=cited_by_count:desc&per_page=12`);
      const works = Array.isArray(data.results) ? data.results : [];
      if (!works.length) { papersCards.innerHTML = '<p class="muted">No papers found.</p>'; return; }
      if (window.SE?.components?.renderPaperCard) {
        papersCards.innerHTML = works.map(w => SE.components.renderPaperCard(w, { compact: true })).join("");
        if (SE.components.enhancePaperCards) SE.components.enhancePaperCards(papersCards);
      } else {
        papersCards.innerHTML = `<ul class="list-reset">${works.map(w =>
          `<li class="list-item"><a href="paper.html?id=${encodeURIComponent(tail(w.id))}">${escapeHtml(w.title || "Untitled")}</a></li>`
        ).join("")}</ul>`;
      }
    }catch(_){ papersCards.innerHTML = '<p class="muted">Failed to load papers.</p>'; }
  }

  async function loadTopAuthors(conceptIdTail){
    try{
      const u = new URL(`${API_OA}/authors`);
      u.searchParams.set("filter", `x_concepts.id:${conceptIdTail}`);
      u.searchParams.set("sort", "cited_by_count:desc");
      u.searchParams.set("per_page", "10");
      const data = await fetchJSON(u.toString());
      const results = Array.isArray(data.results) ? data.results : [];
      if (!results.length) { topicPeople.innerHTML = '<li class="muted">No people listed</li>'; return; }
      topicPeople.innerHTML = results.map(a => {
        const idT = tail(a.id);
        const name = a.display_name || "Unknown";
        const cits = a.cited_by_count || 0;
        return `<li class="list-item list-card" style="display:flex;justify-content:space-between;align-items:center;">
          <a href="profile.html?id=${encodeURIComponent(idT)}">${escapeHtml(name)}</a>
          <span class="badge" title="Total citations">${cits.toLocaleString()}</span>
        </li>`;
      }).join("");
    }catch(_){ topicPeople.innerHTML = '<li class="muted">No people listed</li>'; }
  }

  function renderRelated(concept){
    const rel = Array.isArray(concept.related_concepts) ? concept.related_concepts.slice(0, 12) : [];
    relatedBlock.innerHTML = rel.length
      ? rel.map(r => `<li class="list-item"><a href="topic.html?id=${encodeURIComponent(tail(r.id))}">${escapeHtml(r.display_name)}</a></li>`).join("")
      : '<li class="muted">No related topics.</li>';
  }

  async function loadInfobox(topic){
    let html = "";
    html += `<div class="stat"><div class="stat-value" style="font-weight:700;">${escapeHtml(topic.display_name || "—")}</div></div>`;
    if (topic.description) html += `<div class="muted" style="margin-top:.25rem;">${escapeHtml(topic.description)}</div>`;
    const links = [];
    if (topic.id) links.push(`<a href="${topic.id}" target="_blank" rel="noopener">OpenAlex</a>`);
    const wp = topic.wikipedia || topic.wikipedia_url || topic?.ids?.wikipedia || null;
    if (wp) links.push(`<a href="${wp}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (topic.wikidata || topic.wikidata_id) {
      const wd = String(topic.wikidata || topic.wikidata_id);
      links.push(`<a href="${wd.startsWith('http') ? wd : 'https://www.wikidata.org/wiki/'+wd}" target="_blank" rel="noopener">Wikidata</a>`);
    }
    if (links.length) html += `<div style="margin-top:.5rem;">${links.join(" · ")}</div>`;
    infoboxDom.innerHTML = html;
  }

  function renderSparkline(points){
    if (!points.length) { trendSparkline.innerHTML = '<div class="muted">No data.</div>'; return; }
    const w = trendSparkline.clientWidth || 260;
    const h = trendSparkline.clientHeight || 56;
    const pad = 6;
    const ys = points.map(p => p.count);
    const maxY = Math.max(1, ...ys);
    const minYear = Math.min(...points.map(p=>p.year));
    const maxYear = Math.max(...points.map(p=>p.year));
    const span = Math.max(1, maxYear - minYear);
    const xy = points.map(p => {
      const x = pad + (w - 2*pad) * (span ? (p.year - minYear) / span : 0);
      const y = h - pad - (h - 2*pad) * (p.count / maxY);
      return `${Math.round(x)},${Math.round(y)}`;
    }).join(" ");
    trendSparkline.innerHTML = `
      <svg width="${w}" height="${h}" role="img" aria-label="Papers per year">
        <polyline points="${xy}" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
    `;
  }
  async function loadTrend(conceptIdTail){
    try{
      const url = `${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)}&group_by=publication_year&per_page=200`;
      const data = await fetchOpenAlexJSON(url);
      const byYear = Array.isArray(data.group_by) ? data.group_by.map(g => ({ year: Number(g.key), count: g.count })) : [];
      byYear.sort((a,b)=>a.year-b.year);
      renderSparkline(byYear);
    }catch(_){ trendSparkline.innerHTML = '<div class="muted">No data.</div>'; }
  }

  // ---------- Main ----------
  async function loadTopic(){
    const idParam = getParam("id");
    if(!idParam) { topicTitle.textContent = "Missing topic ID."; return; }
    const idTail = idParam.includes("openalex.org") ? idParam.split("/").pop() : idParam;

    try {
      // OpenAlex concept
      const topicCache = cacheRead(idTail, "concept");
      const topic = topicCache || await (await fetch(`${API_OA}/concepts/${encodeURIComponent(idTail)}`)).json();
      if (!topicCache) cacheWrite(idTail, "concept", topic);

      document.title = `${topic.display_name} | Topic | ScienceEcosystem`;
      topicTitle.textContent = topic.display_name || "Topic";
      topicMeta.textContent = "Loading article…";

      // Wikipedia article (full), sanitised to keep SE look
      const wpTitle = (topic?.display_name || "").trim();
      let articleHTML = cacheRead(idTail, "wp_html");
      let revMeta = cacheRead(idTail, "wp_rev");
      if (!articleHTML) {
        articleHTML = await loadWikipediaArticle(wpTitle);
        cacheWrite(idTail, "wp_html", articleHTML);
      }
      if (!revMeta) {
        revMeta = await loadWikipediaRevisionMeta(wpTitle);
        cacheWrite(idTail, "wp_rev", revMeta);
      }

      // Sanitise & mount
      const clean = sanitiseWikipediaHTML(articleHTML);
      wikiArticle.innerHTML = "";
      wikiArticle.appendChild(clean);

      // ToC from cleaned headings
      buildTOC(clean);

      // Attribution/meta (keeps SE branding)
      const lastUpdated = revMeta?.lastRev ? new Date(revMeta.lastRev) : null;
      const updatedStr = lastUpdated ? lastUpdated.toISOString().slice(0,10) : "unknown";
      topicMeta.textContent = `Overview sourced from Wikipedia • Last revision: ${updatedStr}`;
      const wpURL = revMeta?.url ? `<a href="${revMeta.url}" target="_blank" rel="noopener">Wikipedia article & history</a>` : "Wikipedia";
      wikiAttribution.innerHTML = `Text in this section is from ${wpURL} and is available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Images may have separate licences.`;

      // Related topics, References, Top papers, People, Infobox, Trend
      renderRelated(topic);
      await loadReferences(idTail);
      await loadTopPapers(idTail);
      await loadTopAuthors(idTail);
      await loadInfobox(topic);
      await loadTrend(idTail);

    } catch (e){
      console.error(e);
      topicTitle.textContent = "Error loading topic";
      wikiArticle.innerHTML = "<p class='muted'>We could not load the article at this time.</p>";
      referencesList.innerHTML = "";
      topicPeople.innerHTML = '<li class="muted">—</li>';
      relatedBlock.innerHTML = '<li class="muted">—</li>';
      infoboxDom.textContent = "—";
      trendSparkline.innerHTML = '<div class="muted">—</div>';
    }
  }

  document.addEventListener("DOMContentLoaded", loadTopic);
})();
