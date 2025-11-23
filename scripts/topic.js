// scripts/topic.js
(function () {
  if (!document.body || document.body.dataset.page !== "topic") return;

  // ---------- Constants ----------
  const API_OA = "https://api.openalex.org";
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
  const tail = (id) => (id ? String(id).replace(/^https?:\/\/openalex\.org\//i, "") : "");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function escapeHtml(str) {
    str = str == null ? "" : String(str);
    return str.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  }
  async function fetchJSON(url, opts) {
    const res = await fetch(url, Object.assign({ headers: { Accept: "application/json" } }, opts || {}));
    if (!res.ok) throw new Error(res.status + " " + res.statusText + " — " + url);
    return await res.json();
  }

  // ---------- Local cache ----------
  function cacheKey(topicId, key) {
    return `topic:${topicId}:${key}`;
  }
  function cacheRead(topicId, key) {
    try {
      const raw = localStorage.getItem(cacheKey(topicId, key));
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > CACHE_TTL_MS) return null;
      return v;
    } catch (_) {
      return null;
    }
  }
  function cacheWrite(topicId, key, value) {
    try {
      localStorage.setItem(cacheKey(topicId, key), JSON.stringify({ t: Date.now(), v: value }));
    } catch (_) {}
  }

  // ---------- Wikipedia helpers ----------
  function detectWikiLangFromTopic(topic) {
    const wp =
      topic?.wikipedia_url ||
      topic?.wikipedia ||
      (topic?.ids && (topic.ids.wikipedia || topic.ids.wikipedia_url)) ||
      "";
    const m = String(wp).match(/^https?:\/\/([a-z-]+)\.wikipedia\.org\//i);
    return m ? m[1].toLowerCase() : "en";
  }

  async function loadWikipediaArticle(title, lang) {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/mobile-html/${encodeURIComponent(title)}`;
    const res = await fetch(url, { headers: { Accept: "text/html" }, mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`Wikipedia mobile-html failed: ${res.status}`);
    return await res.text();
  }

  async function loadWikipediaRevisionMeta(title, lang) {
    const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    u.searchParams.set("action", "query");
    u.searchParams.set("prop", "revisions|info");
    u.searchParams.set("rvprop", "ids|timestamp");
    u.searchParams.set("inprop", "url");
    u.searchParams.set("titles", title);
    u.searchParams.set("redirects", "1");
    u.searchParams.set("format", "json");
    u.searchParams.set("origin", "*");
    const data = await fetchJSON(u.toString(), { mode: "cors", credentials: "omit" });
    const pages = data?.query?.pages || {};
    const first = Object.values(pages)[0];
    const rev = first?.revisions?.[0];
    const ts = rev?.timestamp ? new Date(rev.timestamp) : null;
    const fullurl = first?.fullurl || null;
    return { lastRev: ts, url: fullurl };
  }

  // ---------- Sanitiser (keep SUP/A so [1] citations work) ----------
  const ALLOWED_TAGS = new Set([
    "P","H2","H3","H4","UL","OL","LI","B","STRONG","I","EM","A","IMG",
    "BLOCKQUOTE","CODE","PRE","TABLE","THEAD","TBODY","TR","TH","TD","SUP","SUB"
  ]);
  function makeIdFromText(t) {
    return ("sec-" + t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64));
  }
  function sanitiseWikipediaHTML(html, lang) {
    const wikiLang = lang || "en";
    const src = document.createElement("div");
    src.innerHTML = html;
    src.querySelectorAll("style, link, script, noscript").forEach((n) => n.remove());

    const out = document.createElement("div");
    out.className = "se-wiki-clean";

    function cloneNodeSafe(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const tag = node.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        const frag = document.createDocumentFragment();
        node.childNodes.forEach((ch) => {
          const c = cloneNodeSafe(ch);
          if (c) frag.appendChild(c);
        });
        return frag;
      }
      const el = document.createElement(tag.toLowerCase());
      if (tag === "A") {
        const rawHref = node.getAttribute("href") || "";
        let href = rawHref;
        if (/^\/wiki\//i.test(rawHref)) {
          href = `https://${wikiLang}.wikipedia.org${rawHref}`;
        } else if (/^\/\/([a-z-]+\.wikipedia\.org)/i.test(rawHref)) {
          href = "https:" + rawHref;
        }
        if (/^#/.test(href) || /^https?:\/\//i.test(href)) {
          el.setAttribute("href", href);
          if (!/^#/.test(href)) {
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener");
          }
        }
      } else if (tag === "IMG") {
        let srcAttr = node.getAttribute("src") || "";
        if (/^(https?:)?\/\/upload\.wikimedia\.org\//i.test(srcAttr)) {
          if (srcAttr.startsWith("//")) srcAttr = "https:" + srcAttr;
          el.setAttribute("src", srcAttr);
          const alt = node.getAttribute("alt") || "";
          if (alt) el.setAttribute("alt", alt);
          el.setAttribute("loading", "lazy");
          el.style.maxWidth = "100%";
          el.style.height = "auto";
        } else {
          return document.createTextNode("");
        }
      }
      node.childNodes.forEach((ch) => {
        const c = cloneNodeSafe(ch);
        if (c) el.appendChild(c);
      });
      return el;
    }

    src.childNodes.forEach((n) => {
      const c = cloneNodeSafe(n);
      if (c) out.appendChild(c);
    });

    out.querySelectorAll("h2, h3, h4").forEach((h) => {
      if (!h.id) h.id = makeIdFromText(h.textContent || "");
    });

    return out;
  }

  // ---------- Internal linkification (blue words -> SE topic pages) ----------
  function buildLinkPairsFromConcept(concept) {
    const pairs = [];
    const seen = new Set();
    function add(name, id) {
      if (!name || !id) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ term: name, idTail: tail(id) });
    }
    (concept.ancestors || []).forEach((a) => add(a.display_name, a.id));
    (concept.related_concepts || []).forEach((r) => add(r.display_name, r.id));
    return pairs;
  }
  function linkifyContainer(container, linkPairs) {
    if (!linkPairs.length) return;
    const sorted = linkPairs.slice().sort((a, b) => b.term.length - a.term.length);
    const pattern = "\\b(" + sorted.map((p) => p.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b";
    const rx = new RegExp(pattern, "gi");

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (parent && (parent.closest("a") || parent.closest("sup"))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach((node) => {
      const txt = node.nodeValue;
      if (!rx.test(txt)) return;
      rx.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      txt.replace(rx, (match, p1, idx) => {
        const pre = txt.slice(last, idx);
        if (pre) frag.appendChild(document.createTextNode(pre));
        const found = sorted.find((p) => p.term.toLowerCase() === p1.toLowerCase());
        const a = document.createElement("a");
        a.href = "topic.html?id=" + encodeURIComponent(found.idTail);
        a.textContent = p1;
        a.className = "se-topic-link";
        a.setAttribute("data-topic-id", found.idTail);
        frag.appendChild(a);
        last = idx + p1.length;
        return p1;
      });
      const rest = txt.slice(last);
      if (rest) frag.appendChild(document.createTextNode(rest));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function stripReferenceSections(root) {
    const refTitles = new Set(["references", "reference", "notes", "footnotes", "bibliography", "sources", "citations"]);
    const headings = Array.from(root.querySelectorAll("h2, h3, h4"));
    headings.forEach((h) => {
      const txt = (h.textContent || "").trim().toLowerCase();
      if (!refTitles.has(txt)) return;
      let node = h;
      while (node) {
        const next = node.nextSibling;
        node.parentNode?.removeChild(node);
        if (next && next.nodeType === 1 && /^h[2-4]$/i.test(next.tagName)) break;
        node = next;
      }
    });
  }

  // ---------- ToC ----------
  function buildTOC(container) {
    const headings = container.querySelectorAll("h2, h3");
    if (!headings.length) { tocBlock.style.display = "none"; return; }
    const items = [];
    headings.forEach((h) => {
      const level = h.tagName.toLowerCase() === "h2" ? 2 : 3;
      items.push({ id: h.id, text: (h.textContent || "").trim(), level });
    });
    tocNav.innerHTML = items.map(it => {
      const pad = it.level === 3 ? ' style="padding-left:1rem;"' : "";
      return `<div class="toc-item"${pad}><a href="#${escapeHtml(it.id)}">${escapeHtml(it.text)}</a></div>`;
    }).join("");
    tocBlock.style.display = "";
  }

  // ---------- OpenAlex helpers ----------
  async function fetchOpenAlexJSON(url, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429 && i < retries) { await sleep(500 * (i + 1)); continue; }
      throw new Error(`OpenAlex error ${res.status}: ${url}`);
    }
  }
  function pickYear(val) {
    const m = val ? String(val).match(/^(\d{4})/) : null;
    return m ? m[1] : null;
  }
  function formatAuthors(authors) {
    if (!authors || !authors.length) return "";
    const names = authors.slice(0, 3).map((a) => a?.author?.display_name || "").filter(Boolean);
    if (authors.length > 3) names.push("et al.");
    return names.join(", ");
  }
  function citeLine(w, i) {
    const authors = formatAuthors(w.authorships || []);
    const year = pickYear(w.publication_year || w.published_date || w.from_publication_date);
    const title = w.title || "Untitled";
    const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "";
    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : null;
    const doiHref = doi ? `https://doi.org/${encodeURIComponent(doi)}` : w.primary_location?.landing_page_url || w.id;
    const workIdTail = tail(w.id);
    const parts = [];
    parts.push(`<a id="se-ref-${i}" class="ref-anchor"></a>`);
    if (authors) parts.push(`${escapeHtml(authors)}`);
    if (year) parts.push(`(${year})`);
    parts.push(`${escapeHtml(title)}.`);
    if (venue) parts.push(`<i>${escapeHtml(venue)}</i>.`);
    if (doiHref) parts.push(`<a href="${doiHref}" target="_blank" rel="noopener">${doi ? "https://doi.org/" + escapeHtml(doi) : "Link"}</a>`);
    if (workIdTail) parts.push(` · <a href="paper.html?id=${encodeURIComponent(workIdTail)}">SE paper page</a>`);
    return parts.join(" ");
  }
  function dedupByDOI(arr) {
    const seen = new Set(); const out = [];
    for (const w of arr) {
      const key = (w.doi || w.id || "").toLowerCase();
      if (seen.has(key)) continue; seen.add(key); out.push(w);
    }
    return out;
  }

  // ---------- Sections ----------
  async function loadReferences(conceptIdTail) {
    const nowY = new Date().getUTCFullYear();
    const reviewURL = `${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)},type:review&sort=cited_by_count:desc&per_page=10`;
    const recentURL = `${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)},from_publication_date:${nowY - 2}-01-01&sort=cited_by_count:desc&per_page=10`;
    const [rev, rec] = await Promise.all([fetchOpenAlexJSON(reviewURL), fetchOpenAlexJSON(recentURL)]);
    const works = dedupByDOI([...(rev.results || []), ...(rec.results || [])]).slice(0, 15);
    if (!works.length) {
      referencesList.innerHTML = '<li class="muted">No references available.</li>';
      return;
    }

    function renderReferenceCard(w, idx) {
      const anchor = `<a id="se-ref-${idx}" class="ref-anchor"></a>`;
      const back = `<a class="se-ref-back muted" href="#" title="Back to text" aria-label="Back to text">↩︎</a>`;
      if (window.SE?.components?.renderPaperCard) {
        const card = SE.components.renderPaperCard(w, { compact: true });
        return `<li id="se-ref-li-${idx}" class="ref-card" style="list-style:none; margin:0 0 1rem; padding:0;">
          <div class="ref-card-inner" style="position:relative; border:1px solid var(--border-color,#e5e7eb); border-radius:12px; padding:.75rem; background:#fff;">
            ${anchor}
            <div class="ref-num" style="position:absolute; top:10px; right:12px; font-weight:700;">${idx}</div>
            ${card}
            <div style="margin-top:.35rem;">${back}</div>
          </div>
        </li>`;
      }
      return `<li id="se-ref-li-${idx}" style="list-style:none; margin:0 0 1rem; padding:0;">
        <div class="ref-card-inner" style="position:relative; border:1px solid var(--border-color,#e5e7eb); border-radius:12px; padding:.75rem; background:#fff;">
          ${anchor}
          <div class="ref-num" style="position:absolute; top:10px; right:12px; font-weight:700;">${idx}</div>
          <div>${citeLine(w, idx)}</div>
          <div style="margin-top:.35rem;">${back}</div>
        </div>
      </li>`;
    }

    referencesList.innerHTML = works.map((w, i) => renderReferenceCard(w, i + 1)).join("");
    referencesWhy.textContent = "Selected via OpenAlex: citation impact (reviews) and recent influential works (last two years).";
  }

  async function loadTopPapers(conceptIdTail) {
    try {
      const data = await fetchOpenAlexJSON(`${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)}&sort=cited_by_count:desc&per_page=12`);
      const works = Array.isArray(data.results) ? data.results : [];
      if (!works.length) { papersCards.innerHTML = '<p class="muted">No papers found.</p>'; return; }
      if (window.SE?.components?.renderPaperCard) {
        papersCards.innerHTML = works.map((w) => SE.components.renderPaperCard(w, { compact: true })).join("");
        if (SE.components.enhancePaperCards) SE.components.enhancePaperCards(papersCards);
      } else {
        papersCards.innerHTML = `<ul class="list-reset">${works.map((w) =>
          `<li class="list-item"><a href="paper.html?id=${encodeURIComponent(tail(w.id))}">${escapeHtml(w.title || "Untitled")}</a></li>`
        ).join("")}</ul>`;
      }
    } catch (_) { papersCards.innerHTML = '<p class="muted">Failed to load papers.</p>'; }
  }

  async function loadTopAuthors(conceptIdTail) {
    try {
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
    } catch (_) { topicPeople.innerHTML = '<li class="muted">No people listed</li>'; }
  }

  function renderRelated(concept) {
    const rel = Array.isArray(concept.related_concepts) ? concept.related_concepts.slice(0, 12) : [];
    relatedBlock.innerHTML = rel.length
      ? rel.map(r => `<li class="list-item"><a href="topic.html?id=${encodeURIComponent(tail(r.id))}">${escapeHtml(r.display_name)}</a></li>`).join("")
      : '<li class="muted">No related topics.</li>';
  }

  async function loadInfobox(topic) {
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

  function renderSparkline(points) {
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

  // ---------- Link previews (hover/focus) ----------
  function injectPreviewStyles() {
    if (document.getElementById("se-topic-preview-css")) return;
    const css = `
      .se-preview {
        position: fixed; z-index: 9999; max-width: 360px;
        background: var(--card-bg, #111); color: var(--card-fg, #fff);
        border: 1px solid rgba(128,128,128,.25); border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,.35);
        padding: 10px 12px; font-size: .9rem; line-height: 1.35;
        pointer-events: none; opacity: 0; transform: translateY(4px);
        transition: opacity .12s ease, transform .12s ease;
      }
      .se-preview[data-show="1"] { opacity: 1; transform: translateY(0); }
      .se-preview .se-p-title { font-weight: 700; margin-bottom: .25rem; }
      .se-preview .se-p-meta { font-size: .8rem; opacity: .75; margin-top: .25rem; }
    `;
    const style = document.createElement("style");
    style.id = "se-topic-preview-css";
    style.textContent = css;
    document.head.appendChild(style);
  }
  function initLinkPreviews(root) {
    injectPreviewStyles();
    let tip = document.getElementById("se-topic-preview");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "se-topic-preview";
      tip.className = "se-preview";
      tip.setAttribute("role", "status");
      tip.setAttribute("aria-live", "polite");
      document.body.appendChild(tip);
    }
    const cache = new Map(); // idTail -> {title, desc, count}
    let hideTO = null, showTO = null, anchorRect = null;

    function position(x, y) {
      const pad = 10;
      const rect = tip.getBoundingClientRect();
      let left = x + pad;
      let top = y + pad;
      if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
      if (top + rect.height > window.innerHeight - pad) top = y - rect.height - pad;
      if (top < pad) top = pad;
      tip.style.left = `${Math.max(pad, left)}px`;
      tip.style.top = `${Math.max(pad, top)}px`;
    }

    async function loadPreview(idTail) {
      if (cache.has(idTail)) return cache.get(idTail);
      try {
        const data = await fetchJSON(`${API_OA}/concepts/${encodeURIComponent(idTail)}`);
        const item = {
          title: data.display_name || "Topic",
          desc: (data.description || "").split(/\.\s/).slice(0,2).join(". ") + (data.description ? "." : ""),
          count: data.works_count || 0
        };
        cache.set(idTail, item);
        return item;
      } catch {
        const item = { title: "Topic", desc: "Preview unavailable.", count: 0 };
        cache.set(idTail, item);
        return item;
      }
    }

    function show(content, x, y) {
      tip.innerHTML = content;
      tip.dataset.show = "1";
      position(x, y);
    }
    function hide() {
      tip.dataset.show = "0";
    }

    function contentFor(item) {
      const meta = item.count ? `<div class="se-p-meta">${item.count.toLocaleString()} works in OpenAlex</div>` : "";
      return `<div class="se-p-title">${escapeHtml(item.title)}</div><div>${escapeHtml(item.desc || "")}</div>${meta}`;
    }

    function onEnter(e) {
      const a = e.currentTarget;
      const idTail = a.getAttribute("data-topic-id");
      if (!idTail) return;
      clearTimeout(hideTO);
      const [x, y] = [e.clientX || (anchorRect ? anchorRect.left : 0), e.clientY || (anchorRect ? anchorRect.bottom : 0)];
      showTO = setTimeout(async () => {
        const preview = await loadPreview(idTail);
        show(contentFor(preview), x, y);
      }, 160);
    }
    function onLeave() {
      clearTimeout(showTO);
      hideTO = setTimeout(hide, 80);
    }
    function onMove(e) {
      if (tip.dataset.show !== "1") return;
      position(e.clientX, e.clientY);
    }
    function onFocus(e) {
      // keyboard users: place near element
      anchorRect = e.currentTarget.getBoundingClientRect();
      onEnter({ currentTarget: e.currentTarget, clientX: anchorRect.left, clientY: anchorRect.bottom });
    }
    function onBlur() { onLeave(); }

    const links = root.querySelectorAll("a.se-topic-link");
    links.forEach(a => {
      a.addEventListener("mouseenter", onEnter);
      a.addEventListener("mouseleave", onLeave);
      a.addEventListener("mousemove", onMove);
      a.addEventListener("focus", onFocus);
      a.addEventListener("blur", onBlur);
    });
  }

  // ---------- Citations: link [n] → #se-ref-n ----------
  function attachCitationLinks(container) {
    const sups = container.querySelectorAll("sup");
    if (!sups.length) return;

    // Build a quick set of existing reference ids so we don't link to nowhere.
    const refIds = new Set(Array.from(referencesList.querySelectorAll(".ref-anchor")).map(a => a.id)); // se-ref-1, se-ref-2, ...

    // For back navigation, remember last clicked citation to mark a target.
    let lastAnchorFrom = null;

    sups.forEach(sup => {
      const text = sup.textContent || "";
      const m = text.match(/^\s*\[?(\d{1,3})\]?\s*$/); // [12] or 12
      if (!m) return;
      const n = m[1];
      const targetId = `se-ref-${n}`;
      if (!refIds.has(targetId)) return; // Do not rewire if no such ref exists

      // Replace sup content with a link
      const a = document.createElement("a");
      a.href = `#${targetId}`;
      a.className = "se-cite-link";
      a.textContent = `[${n}]`;
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        // Mark the parent paragraph to scroll back to
        const mark = sup.closest("p, li, h2, h3, h4") || sup;
        const markId = `se-cite-src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        mark.setAttribute("id", markId);
        lastAnchorFrom = `#${markId}`;
        const target = document.getElementById(targetId);
        if (target) {
          const li = target.closest("li") || target;
          li.scrollIntoView({ behavior: "smooth", block: "start" });
          // Also highlight briefly
          li.style.transition = "background-color .3s";
          const bg = getComputedStyle(li).backgroundColor;
          li.style.backgroundColor = "rgba(255,255,0,0.15)";
          setTimeout(() => (li.style.backgroundColor = bg), 450);
          // Wire the back link for this particular list item
          const back = li.querySelector(".se-ref-back");
          if (back) {
            back.onclick = (e2) => {
              e2.preventDefault();
              if (lastAnchorFrom) {
                const src = document.querySelector(lastAnchorFrom);
                if (src) src.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            };
          }
        }
      });
      sup.textContent = "";
      sup.appendChild(a);
    });
  }

  // ---------- Main ----------
  async function loadTopic() {
    const idParam = getParam("id");
    if (!idParam) { topicTitle.textContent = "Missing topic ID."; return; }
    const idTail = idParam.includes("openalex.org") ? idParam.split("/").pop() : idParam;

    try {
      // OpenAlex concept
      const topicCache = cacheRead(idTail, "concept");
      const topic = topicCache || (await (await fetch(`${API_OA}/concepts/${encodeURIComponent(idTail)}`)).json());
      if (!topicCache) cacheWrite(idTail, "concept", topic);

      const lang = detectWikiLangFromTopic(topic);
      document.title = `${topic.display_name} | Topic | ScienceEcosystem`;
      topicTitle.textContent = topic.display_name || "Topic";
      topicMeta.textContent = "Loading article…";

      // Wikipedia article & revision (language-aware)
      const wpTitle = (topic?.display_name || "").trim();
      let articleHTML = cacheRead(idTail, "wp_html");
      let revMeta = cacheRead(idTail, "wp_rev");
      if (!articleHTML) { articleHTML = await loadWikipediaArticle(wpTitle, lang); cacheWrite(idTail, "wp_html", articleHTML); }
      if (!revMeta) { revMeta = await loadWikipediaRevisionMeta(wpTitle, lang); cacheWrite(idTail, "wp_rev", revMeta); }

      // Sanitise & split lead vs rest
      const clean = sanitiseWikipediaHTML(articleHTML, lang);
      stripReferenceSections(clean);
      const firstHeading = clean.querySelector("h2, h3, h4");
      const leadNodes = [];
      const restNodes = [];
      let node = clean.firstChild;
      while (node) {
        if (node === firstHeading) break;
        if (node.nodeType === 1 && node.tagName === "P") leadNodes.push(node.cloneNode(true));
        node = node.nextSibling;
      }
      while (node) { restNodes.push(node.cloneNode(true)); node = node.nextSibling; }

      // Build containers
      const leadWrap = document.createElement("div");
      leadNodes.forEach((n) => leadWrap.appendChild(n));
      const bodyWrap = document.createElement("div");
      restNodes.forEach((n) => bodyWrap.appendChild(n));

      // Internal linkify (blue words) for both lead and body
      const linkPairs = buildLinkPairsFromConcept(topic);
      linkifyContainer(leadWrap, linkPairs);
      linkifyContainer(bodyWrap, linkPairs);

      // Mount into header + overview
      topicSubtitle.innerHTML = leadNodes.length ? leadWrap.innerHTML : `<p>${escapeHtml(topic.description || "No summary available.")}</p>`;
      wikiArticle.innerHTML = bodyWrap.innerHTML || "<p>No further details available.</p>";

      // ToC (from body only)
      buildTOC(bodyWrap);

      // References / people / infobox / trend
      renderRelated(topic);
      await loadReferences(idTail);
      await loadTopPapers(idTail);
      await loadTopAuthors(idTail);
      await loadInfobox(topic);
      await loadTrend(idTail);

      // Wire extras after DOM is filled:
      // - previews: pass the whole wikiArticle container (contains blue links)
      initLinkPreviews(wikiArticle);
      initLinkPreviews(topicSubtitle);
      // - citations: convert [n] to anchors, and set back-links in the list
      attachCitationLinks(wikiArticle);
      attachCitationLinks(topicSubtitle);

      // Attribution/meta
      const lastUpdated = revMeta?.lastRev ? new Date(revMeta.lastRev) : null;
      const updatedStr = lastUpdated ? lastUpdated.toISOString().slice(0, 10) : "unknown";
      topicMeta.textContent = `Overview sourced from Wikipedia • Last revision: ${updatedStr}`;
      const wpURL = revMeta?.url ? `<a href="${revMeta.url}" target="_blank" rel="noopener">Wikipedia article & history</a>` : "Wikipedia";
      wikiAttribution.innerHTML = `Text in this section is from ${wpURL} and is available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.`;

      // Smooth-scroll for internal hash links (#sec-*, #se-ref-*)
      document.addEventListener("click", (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;
        const id = a.getAttribute("href").slice(1);
        const t = document.getElementById(id);
        if (!t) return;
        e.preventDefault();
        t.scrollIntoView({ behavior: "smooth", block: "start" });
      });

    } catch (e) {
      console.error(e);
      topicTitle.textContent = "Error loading topic";
      topicSubtitle.textContent = "";
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
