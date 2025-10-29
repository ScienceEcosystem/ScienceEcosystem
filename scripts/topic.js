// scripts/topic.js
(function () {
  if (!document.body || document.body.dataset.page !== "topic") return;

  // ---------- Constants ----------
  const API_OA = "https://api.openalex.org";
  const API_WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
  const API_WIKI_ACTION = "https://en.wikipedia.org/w/api.php"; // add origin=*
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);
  const topicHeader = el("topicHeader");
  const topicTitle = el("topicTitle");
  const topicSubtitle = el("topicSubtitle");
  const topicMeta = el("topicMeta");
  const wikiBlock = el("wikiBlock");
  const wikiArticle = el("wikiArticle");
  const wikiAttribution = el("wikiAttribution");
  const tocBlock = el("tocBlock");
  const tocNav = el("tocNav");
  const referencesList = el("referencesList");
  const referencesWhy = el("referencesWhy");
  const papersCards = el("papersCards");
  const infoboxDom = el("infobox");
  const topicPeople = el("topicPeople");
  const relatedBlock = el("relatedBlock");
  const trendSparkline = el("trendSparkline");

  // ---------- Utils ----------
  const getParam = (name) => new URLSearchParams(location.search).get(name);
  const tail = (id) => id ? String(id).replace(/^https?:\/\/openalex\.org\//i, "") : "";
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function escapeHtml(str){
    str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c]));
  }

  async function fetchJSON(url, opts){
    const res = await fetch(url, Object.assign({ headers: { "Accept": "application/json" } }, opts || {}));
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
    try{
      localStorage.setItem(cacheKey(topicId, key), JSON.stringify({ t: Date.now(), v: value }));
    }catch(_){}
  }

  // ---------- Wikipedia: fetch full mobile HTML + last revision ----------
  async function loadWikipediaArticle(title){
    const url = `${API_WIKI_REST}/page/mobile-html/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { "Accept": "text/html" }});
    if(!res.ok) throw new Error(`Wikipedia mobile-html failed: ${res.status}`);
    const html = await res.text();
    return html;
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

  function buildTOC(container){
    const headings = container.querySelectorAll("h2, h3");
    if (!headings.length) { tocBlock.style.display = "none"; return; }
    const items = [];
    headings.forEach((h, idx) => {
      if (!h.id) h.id = `sec-${idx+1}`;
      const level = h.tagName.toLowerCase() === "h2" ? 2 : 3;
      items.push({ id: h.id, text: h.textContent.trim(), level });
    });
    tocNav.innerHTML = items.map(it => {
      const pad = it.level === 3 ? ' style="padding-left:1rem;"' : "";
      return `<div class="toc-item"${pad}><a href="#${escapeHtml(it.id)}">${escapeHtml(it.text)}</a></div>`;
    }).join("");
    tocBlock.style.display = "";
  }

  // ---------- References from OpenAlex ----------
  async function fetchOpenAlexJSON(url, retries=2){
    for (let i=0;i<=retries;i++){
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429 && i < retries) {
        await sleep(500 * (i+1));
        continue;
      }
      throw new Error(`OpenAlex error ${res.status}: ${url}`);
    }
  }

  function pickYear(dateStr){
    if (!dateStr) return null;
    const m = String(dateStr).match(/^(\d{4})/);
    return m ? m[1] : null;
  }

  function formatAuthors(authors){
    if (!authors || !authors.length) return "";
    const names = authors.slice(0,3).map(a => a?.author?.display_name || a?.author?.id || "").filter(Boolean);
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
    const seen = new Set();
    const out = [];
    for (const w of arr){
      const key = (w.doi || w.id || "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); out.push(w);
    }
    return out;
  }

  async function loadReferences(conceptIdTail){
    const now = new Date();
    const fromYear = now.getUTCFullYear() - 2;
    const reviewURL = `${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)},type:review&sort=cited_by_count:desc&per_page=10`;
    const recentURL = `${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)},from_publication_date:${fromYear}-01-01&sort=cited_by_count:desc&per_page=10`;
    const [rev, rec] = await Promise.all([
      fetchOpenAlexJSON(reviewURL),
      fetchOpenAlexJSON(recentURL)
    ]);
    const works = dedupByDOI([...(rev.results||[]), ...(rec.results||[])]).slice(0, 15);
    referencesList.innerHTML = works.map(w => `<li>${citeLine(w)}</li>`).join("") || `<p class="muted">No references available.</p>`;
    referencesWhy.textContent = "Selected via OpenAlex: citation impact (reviews) and recent influential works (last two years).";
    return works;
  }

  // ---------- Influential papers cards (reuse your components if present) ----------
  async function loadTopPapers(conceptIdTail){
    try {
      const worksResp = await fetch(`${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)}&sort=cited_by_count:desc&per_page=12`);
      const data = await worksResp.json();
      const works = Array.isArray(data.results) ? data.results : [];
      if (!works.length) {
        papersCards.innerHTML = '<p class="muted">No papers found.</p>';
        return;
      }
      if (window.SE && window.SE.components && typeof SE.components.renderPaperCard === "function") {
        papersCards.innerHTML = works.map(w => SE.components.renderPaperCard(w, { compact: true })).join("");
        if (typeof SE.components.enhancePaperCards === "function") SE.components.enhancePaperCards(papersCards);
      } else {
        // Fallback minimal list
        papersCards.innerHTML = `<ul class="list-reset">${works.map(w =>
          `<li class="list-item"><a href="paper.html?id=${encodeURIComponent(tail(w.id))}">${escapeHtml(w.title || "Untitled")}</a></li>`
        ).join("")}</ul>`;
      }
    } catch(e){
      papersCards.innerHTML = '<p class="muted">Failed to load papers.</p>';
    }
  }

  // ---------- People (top authors) ----------
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
    }catch(_){
      topicPeople.innerHTML = '<li class="muted">No people listed</li>';
    }
  }

  // ---------- Related topics ----------
  function renderRelated(concept){
    const rel = Array.isArray(concept.related_concepts) ? concept.related_concepts.slice(0, 12) : [];
    relatedBlock.innerHTML = rel.length
      ? rel.map(r => `<li class="list-item"><a href="topic.html?id=${encodeURIComponent(tail(r.id))}">${escapeHtml(r.display_name)}</a></li>`).join("")
      : '<li class="muted">No related topics.</li>';
  }

  // ---------- Wikidata lite infobox ----------
  // We keep lightweight: show label/description, image (P18) if quickly available via OpenAlex.wikipedia or Wikidata sitelink
  async function loadWikidataInfobox(topic){
    // If topic has wikipedia_url, try a quick image via Wikimedia API from title
    const wp = topic.wikipedia || topic.wikipedia_url || topic?.ids?.wikipedia || null;
    let html = "";
    // Title & description
    html += `<div class="stat"><div class="stat-value" style="font-weight:700;">${escapeHtml(topic.display_name || "—")}</div></div>`;
    if (topic.description) html += `<div class="muted" style="margin-top:.25rem;">${escapeHtml(topic.description)}</div>`;

    // You already had a richer infobox before; to keep zero-cost/time we display identifiers quickly
    const links = [];
    if (topic.id) links.push(`<a href="${topic.id}" target="_blank" rel="noopener">OpenAlex</a>`);
    if (wp) links.push(`<a href="${wp}" target="_blank" rel="noopener">Wikipedia</a>`);
    if (topic.wikidata || topic.wikidata_id) {
      const wd = String(topic.wikidata || topic.wikidata_id);
      links.push(`<a href="${wd.startsWith('http') ? wd : 'https://www.wikidata.org/wiki/'+wd}" target="_blank" rel="noopener">Wikidata</a>`);
    }
    if (links.length) html += `<div style="margin-top:.5rem;">${links.join(" · ")}</div>`;
    infoboxDom.innerHTML = html;
  }

  // ---------- Trend sparkline ----------
  function renderSparkline(points){ // points: [{year, count}]
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
    }catch(_){
      trendSparkline.innerHTML = '<div class="muted">No data.</div>';
    }
  }

  // ---------- Main loader ----------
  async function loadTopic(){
    const idParam = getParam("id");
    if(!idParam) { topicTitle.textContent = "Missing topic ID."; return; }
    const idTail = idParam.includes("openalex.org") ? idParam.split("/").pop() : idParam;

    try {
      // 1) OpenAlex concept
      const topicCache = cacheRead(idTail, "concept");
      const topic = topicCache || await (await fetch(`${API_OA}/concepts/${encodeURIComponent(idTail)}`)).json();
      if (!topicCache) cacheWrite(idTail, "concept", topic);

      document.title = `${topic.display_name} | Topic | ScienceEcosystem`;
      topicTitle.textContent = topic.display_name || "Topic";
      topicSubtitle.textContent = "A neutral, research-grounded overview.";
      topicMeta.textContent = "Loading article…";

      // 2) Wikipedia article (mobile-html) + last revision
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

      // Insert article
      const container = document.createElement("div");
      container.className = "wiki-article";
      container.innerHTML = articleHTML;
      // Wikipedia mobile HTML includes lead sections; remove edit icons if present
      container.querySelectorAll('.pcs-edit-section-title, .mwe-math-fallback-image-inline').forEach(n => n.remove());

      // Build ToC
      buildTOC(container);

      // Mount article
      wikiArticle.innerHTML = "";
      wikiArticle.appendChild(container);

      // Attribution & meta
      const lastUpdated = revMeta?.lastRev ? new Date(revMeta.lastRev) : null;
      const updatedStr = lastUpdated ? lastUpdated.toISOString().slice(0,10) : "unknown";
      topicMeta.textContent = `Wikipedia-sourced overview • Last revision: ${updatedStr}`;
      const wpURL = revMeta?.url ? `<a href="${revMeta.url}" target="_blank" rel="noopener">Wikipedia article & history</a>` : "Wikipedia";
      wikiAttribution.innerHTML = `Text in this section is from ${wpURL} and is available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Images may have separate licences.`;

      // 3) Related topics
      renderRelated(topic);

      // 4) References (OpenAlex)
      await loadReferences(idTail);

      // 5) Influential papers (cards)
      await loadTopPapers(idTail);

      // 6) People (top authors)
      await loadTopAuthors(idTail);

      // 7) Infobox (lite) and trend sparkline
      await loadWikidataInfobox(topic);
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
