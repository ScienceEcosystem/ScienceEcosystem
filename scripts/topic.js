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
    if (!res.ok) throw new Error(res.status + " " + res.statusText + " - " + url);
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
  // Neutralise resource-loading attributes before any HTML parsing.
  // Safari (WebKit) eagerly fetches src/srcset/poster even inside a DOMParser
  // document that is never attached to the main document.
  function neutralizeResourceAttrs(html) {
    return html
      .replace(/(\s)src=/g, "$1data-src=")
      .replace(/(\s)srcset=/g, "$1data-srcset=")
      .replace(/(\s)poster=/g, "$1data-poster=");
  }

  function sanitiseWikipediaHTML(html, lang) {
    const wikiLang = lang || "en";

    // Neutralise before parsing so WebKit never sees a live src/srcset/poster
    const parser = new DOMParser();
    const doc = parser.parseFromString(neutralizeResourceAttrs(html), "text/html");
    const src = doc.body || doc.createElement("div");

    // Strip elements we never want before the clone walk
    src.querySelectorAll([
      "style", "link", "script", "noscript", "meta",
      "video", "audio", "source", "track",
      'figure[typeof*="Video"]', 'figure[typeof*="Audio"]',
      ".mw-editsection", ".mw-editsection-bracket",
      ".pcs-edit-section", ".pcs-edit-section-link",  // mobile HTML edit buttons
      ".sistersitebox", ".sister-wikipedia", ".sister-inline-image", ".noprint",
      ".navbox", ".mbox-small", ".ambox", ".tmbox",
      ".mw-authority-control", ".mw-pb-wikibase-link"
    ].join(",")).forEach((n) => n.remove());

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
        let asTopicLink = false;
        if (/^\/wiki\//i.test(rawHref)) {
          const title = decodeURIComponent(rawHref.replace(/^\/wiki\//i, "").split(/[?#]/)[0]);
          href = `topic.html?id=${encodeURIComponent(title)}`;
          asTopicLink = true;
        } else if (/^\.\/([^#?]+)$/.test(rawHref)) {
          // Wikipedia mobile-html uses ./Pagename format for internal links (no anchor = pure page)
          const title = decodeURIComponent(rawHref.slice(2));
          href = `topic.html?id=${encodeURIComponent(title)}`;
          asTopicLink = true;
        } else if (/^\/\/([a-z-]+\.wikipedia\.org)/i.test(rawHref)) {
          href = "https:" + rawHref;
        } else if (/^https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\//i.test(rawHref)) {
          // keep external wiki links but prefer SE topic if possible
          const m = rawHref.match(/^https?:\/\/[a-z-]+\.wikipedia\.org\/wiki\/(.+)/i);
          if (m && m[1]) {
            const title = decodeURIComponent(m[1]);
            href = `topic.html?id=${encodeURIComponent(title)}`;
            asTopicLink = true;
          }
        }
        if (/^#/.test(href) || /^https?:\/\//i.test(href) || href.startsWith("topic.html")) {
          el.setAttribute("href", href);
          if (!asTopicLink && !/^#/.test(href)) {
            // External links (non-topic) open in new tab; topic links stay in same tab
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener");
          }
          if (asTopicLink) {
            el.classList.add("se-topic-link");
            const topicId = decodeURIComponent(href.split("id=").pop() || "");
            el.setAttribute("data-topic-id", topicId);
            // Image/file links often wrap a thumbnail with no link text —
            // give them an accessible name derived from the filename.
            if (/^File:/i.test(topicId)) {
              const fileName = topicId.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
              el.setAttribute("aria-label", `Image: ${fileName}`);
            }
          }
        }
      } else if (tag === "IMG") {
        // Read data-src (neutralized from src before parsing)
        let srcAttr = node.getAttribute("data-src") || "";
        if (/^(https?:)?\/\/upload\.wikimedia\.org\//i.test(srcAttr)) {
          if (srcAttr.startsWith("//")) srcAttr = "https:" + srcAttr;
          const alt = node.getAttribute("alt") || "";
          // Drop UI icons and sister-site logos regardless of alt text —
          // alt is sometimes set (e.g. "Edit this classification") but these
          // images are never meaningful content and always cause 408 timeouts
          const uiIcon = /\/(OOjs_UI_|Commons-logo|Wikibooks-logo|Wikiquote|Wikisource|Wiktionary|Wikinews|Wikiversity|Wikivoyage|Wikipedia-logo|Powered_by_MediaWiki|File:OOjs|sister|noviewer)/i;
          if (uiIcon.test(srcAttr)) return document.createTextNode("");
          el.setAttribute("src", srcAttr);
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
    // Also include the concept itself and any siblings if available
    if (concept.display_name && concept.id) add(concept.display_name, concept.id);
    return pairs;
  }

  // Collect additional link pairs from existing <a class="se-topic-link"> elements
  // already embedded in the sanitised Wikipedia HTML — their text and data-topic-id
  // give us the full set of concepts Wikipedia already linked.
  function collectExistingTopicLinks(container) {
    const pairs = [];
    const seen = new Set();
    container.querySelectorAll("a.se-topic-link[data-topic-id]").forEach(a => {
      const term = (a.textContent || "").trim();
      const idTail = a.getAttribute("data-topic-id") || "";
      if (!term || !idTail) return;
      const key = term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ term, idTail });
    });
    return pairs;
  }

  function linkifyContainer(container, linkPairs) {
    if (!linkPairs.length) return;
    const sorted = linkPairs.slice().sort((a, b) => b.term.length - a.term.length);
    const pattern = "\\b(" + sorted.map((p) => p.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b";
    const rx = new RegExp(pattern, "gi");

    // Track first-mention-only: each term linked at most once per container
    const linked = new Set();

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
      let changed = false;
      txt.replace(rx, (match, p1, idx) => {
        const key = p1.toLowerCase();
        if (linked.has(key)) {
          // Already linked once — leave as plain text
          return p1;
        }
        const found = sorted.find((p) => p.term.toLowerCase() === key);
        if (!found) return p1;
        const pre = txt.slice(last, idx);
        if (pre) frag.appendChild(document.createTextNode(pre));
        const a = document.createElement("a");
        a.href = "topic.html?id=" + encodeURIComponent(found.idTail);
        a.textContent = p1;
        a.className = "se-topic-link";
        a.setAttribute("data-topic-id", found.idTail);
        frag.appendChild(a);
        linked.add(key);
        last = idx + p1.length;
        changed = true;
        return p1;
      });
      if (!changed) return;
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
    if (workIdTail) parts.push(` · <a href="paper.html?id=${encodeURIComponent(workIdTail)}">Paper page</a>`);
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

  // Fetch Wikipedia's own reference list for a page title + lang
  async function fetchWikiReferences(title, lang) {
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/references/${encodeURIComponent(title)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" }, mode: "cors", credentials: "omit" });
      if (!res.ok) return [];
      const data = await res.json();
      // References are in data.references_by_id (object keyed by ref id) or data.references (array)
      const raw = data.references_by_id
        ? Object.values(data.references_by_id)
        : (Array.isArray(data.references) ? data.references : []);
      return raw;
    } catch (_) { return []; }
  }

  function extractDoiFromWikiRef(ref) {
    // doi field, or inside content/text
    if (ref.doi) return String(ref.doi).trim();
    const text = ref.content || ref.text || ref.html || "";
    const m = String(text).match(/10\.\d{4,9}\/[^\s"<>]+/);
    return m ? m[0].replace(/[.,;]$/, "") : null;
  }

  // Parse reference items directly from the mobile-html (fallback when REST API returns 404)
  function extractRefsFromMobileHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(neutralizeResourceAttrs(html), "text/html");
    const items = Array.from(doc.querySelectorAll('li[id^="cite_note-"]'));
    return items.map((li, i) => {
      const refEl = li.querySelector(".reference-text, .mw-reference-text");
      const text = (refEl || li).textContent.trim();
      const doiEl = li.querySelector('a[href*="doi.org"], a[href*="doi:"]');
      const doiRaw = doiEl ? (doiEl.getAttribute("href") || "") : "";
      const doi = doiRaw
        ? doiRaw
            .replace(/^https?:\/\/doi\.org\//i, "")  // https://doi.org/
            .replace(/^\/\/doi\.org\//i, "")          // //doi.org/ (protocol-relative)
            .replace(/^doi:/i, "")                    // doi: prefix
            .replace(/%2F/gi, "/")                    // decode encoded slashes
            .trim()
        : null;
      return { text, doi, idx: i + 1 };
    }).filter(r => r.text.length > 5);
  }

  async function loadReferences(conceptIdTail, wpTitle, wpLang, articleHTML) {
    // Tier 1: Wikipedia REST references API
    const wikiRefs = await fetchWikiReferences(wpTitle, wpLang || "en");

    // Tier 2: parse cite_note items from the mobile HTML we already fetched
    // (pass directly to avoid localStorage size limits killing the cache write)
    const mobileRefs = (!wikiRefs.length && articleHTML)
      ? extractRefsFromMobileHTML(articleHTML)
      : [];

    const refs = wikiRefs.length ? wikiRefs : null;
    const mobile = mobileRefs.length ? mobileRefs : null;

    if (!refs && !mobile) {
      // No Wikipedia references found — hide section cleanly, no fake fallback
      referencesList.innerHTML = '<li class="muted">No references available for this article.</li>';
      referencesWhy.textContent = "";
      return;
    }

    async function batchDoiLookup(dois) {
      if (!dois.length) return {};
      try {
        const batch = dois.slice(0, 50).map(d => encodeURIComponent(d)).join("|");
        const res = await fetchOpenAlexJSON(`${API_OA}/works?filter=doi:${batch}&per_page=50&select=id,doi`);
        const map = {};
        (res.results || []).forEach(w => {
          const d = (w.doi || "").replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
          if (d) map[d] = tail(w.id);
        });
        return map;
      } catch (_) { return {}; }
    }

    if (refs) {
      const dois = refs.map(r => extractDoiFromWikiRef(r)).filter(Boolean);
      const doiToWorkId = await batchDoiLookup(dois);
      referencesList.innerHTML = refs.slice(0, 80).map((ref, i) => {
        const idx = i + 1;
        const tmp = document.createElement("div");
        tmp.innerHTML = ref.content || ref.text || ref.html || "";
        const inner = escapeHtml(tmp.textContent || tmp.innerText || "") || "(Reference details unavailable)";
        const doi = extractDoiFromWikiRef(ref);
        const workId = doi ? doiToWorkId[doi.toLowerCase()] : null;
        const doiLink = doi
          ? workId
            ? ` · <a href="paper.html?id=${encodeURIComponent(workId)}">DOI</a>`
            : ` · <a href="https://doi.org/${encodeURIComponent(doi)}" target="_blank" rel="noopener">DOI</a>`
          : "";
        return `<li id="se-ref-li-${idx}" value="${idx}"><a id="se-ref-${idx}" class="ref-anchor"></a>${inner}${doiLink}</li>`;
      }).join("");
    } else {
      const dois = mobile.map(r => r.doi).filter(Boolean);
      const doiToWorkId = await batchDoiLookup(dois);
      referencesList.innerHTML = mobile.map(ref => {
        const idx = ref.idx;
        const inner = escapeHtml(ref.text);
        const workId = ref.doi ? doiToWorkId[ref.doi.toLowerCase()] : null;
        const doiLink = ref.doi
          ? workId
            ? ` · <a href="paper.html?id=${encodeURIComponent(workId)}">DOI</a>`
            : ` · <a href="https://doi.org/${encodeURIComponent(ref.doi)}" target="_blank" rel="noopener">DOI</a>`
          : "";
        return `<li id="se-ref-li-${idx}" value="${idx}"><a id="se-ref-${idx}" class="ref-anchor"></a>${inner}${doiLink}</li>`;
      }).join("");
    }
    referencesWhy.textContent = "References from the Wikipedia article. Links to Paper pages added where a DOI match was found.";
  }

  // ── iNaturalist citizen science data ─────────────────────────────────────────
  // ── Shared species map (GBIF owns it, WoC adds EOO polygon on top) ───────────
  var _leafletMap = null;       // shared Leaflet instance
  var _pendingEoo = null;       // WoC EOO geojson waiting for map to be ready

  function addEooToMap(map, eooGeoJSON) {
    if (!map || !eooGeoJSON) return;
    // Blue, not orange — the occurrence density layer is now an orange
    // heatmap (orangeHeat.point), so an orange boundary line would blend
    // straight into it instead of standing out.
    L.geoJSON(eooGeoJSON, {
      style: {
        color: "#1d4ed8",
        weight: 2,
        fillColor: "transparent",
        fillOpacity: 0,
        dashArray: "5 4",
      }
    }).addTo(map);
    const label = $("speciesMapLabel");
    if (label) label.textContent = "(GBIF occurrences · WoC native range boundary)";
  }

  async function initSpeciesMap(taxonKey, speciesName) {
    const mapEl = $("speciesMapContainer");
    if (!mapEl) return null;
    mapEl.setAttribute("role", "img");
    mapEl.setAttribute("aria-label", speciesName
      ? `Map of ${speciesName} occurrence records and native range`
      : "Map of species occurrence records and native range");

    // Load Leaflet on demand
    if (typeof L === "undefined") {
      await new Promise(resolve => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/assets/vendor/leaflet.min.css";
        document.head.appendChild(link);
        const script = document.createElement("script");
        script.src = "/assets/vendor/leaflet.min.js";
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }

    // Reveal the (until now display:none) map section BEFORE creating the
    // Leaflet map — Leaflet computes its SVG overlay size and tile grid
    // from the container's on-screen dimensions at the moment each layer
    // is added. Doing this after building the map left the container at
    // zero size for all of that setup, so the country-outline SVG
    // permanently ended up width="0" height="0" (invisible despite having
    // real paths in it) and the GBIF tile requests came out wrong — live-
    // tested on the Tūī page and reproduced exactly this.
    const mapSection = $("speciesMapSection");
    if (mapSection) mapSection.style.display = "";

    const map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false, attributionControl: false });
    _leafletMap = map;

    // Self-hosted world countries background
    try {
      const worldResp = await fetch("/assets/vendor/world-countries.geojson");
      if (worldResp.ok) {
        const worldData = await worldResp.json();
        L.geoJSON(worldData, {
          style: { color: "#adb5bd", weight: 0.5, fillColor: "#dee2e6", fillOpacity: 1 },
          interactive: false
        }).addTo(map);
      }
    } catch (_) {}

    // GBIF occurrence density tiles. orangeHeat renders smooth density
    // blobs (closer to iNaturalist's own grid-heatmap look) instead of
    // classic.point's sparse individual dots, which read as hard-to-see
    // scattered specks at the world/continent zoom this map opens at —
    // compared side-by-side against classic.point, purpleHeat.point, and
    // classic.poly (empty at low zoom — GBIF's poly styles only kick in
    // much closer in) before picking this one.
    //
    // GBIF is not a separate data source from iNaturalist/eBird — it's the
    // aggregator. Live-checked the tūī's own dataset breakdown: its two
    // largest contributing sources are literally "EOD – eBird Observation
    // Dataset" (241,679 of 273,849 records) and "iNaturalist Research-grade
    // Observations" (11,106). So instead of three separate, overlapping
    // panels, this single map can filter to a specific source using GBIF's
    // own datasetKey — these two keys are GBIF-wide constants, not specific
    // to this species.
    const SOURCE_DATASETS = {
      ebird: { key: "4fa7b334-ce0d-4e88-aaae-2e0c138d049e", label: "eBird" },
      inat:  { key: "50c9509d-22c7-4a22-a47d-8c48425ef4a7", label: "iNaturalist" },
    };
    let activeSource = "all";

    // GBIF's density-tile endpoint does NOT reliably support datasetKey
    // filtering — live-tested and confirmed every single filtered tile
    // request 503s (consistently, not a rate-limit flake: 3/3 attempts
    // failed for both eBird's and iNaturalist's dataset keys, while the
    // unfiltered endpoint succeeded 3/3). GBIF's 503 response is itself a
    // valid PNG with "503" rendered into the pixels as their own visual
    // error tile — since it's real image bytes just wrapped in a non-2xx
    // status, the browser displays it like any other tile instead of
    // triggering Leaflet's errorTileUrl fallback, tiling "503" text across
    // the whole map. So the heatmap always shows all sources combined;
    // only the marker layer below (which uses the JSON search API, already
    // confirmed reliable with datasetKey) actually reflects the toggle.
    if (taxonKey) {
      L.tileLayer(
        `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@2x.png?taxonKey=${taxonKey}&style=orangeHeat.point`,
        {
          opacity: 0.85,
          maxZoom: 10,
          errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        }
      ).addTo(map);
    }

    // Individual, clickable observation markers — only loaded in once
    // zoomed in past a threshold, since a common species can have hundreds
    // of thousands of occurrence points and there's no marker-clustering
    // library in play here. Below the threshold this stays an empty layer
    // and the density tiles above are the whole picture, same as before.
    const MARKER_ZOOM_THRESHOLD = 8;
    const markersLayer = L.layerGroup().addTo(map);
    const hintEl = $("speciesMapHint");
    let markerFetchToken = 0;

    async function refreshMarkers() {
      if (!taxonKey) return;
      const zoom = map.getZoom();
      if (zoom < MARKER_ZOOM_THRESHOLD) {
        markersLayer.clearLayers();
        if (hintEl) hintEl.textContent = "Zoom in to see individual observations — click one for details.";
        return;
      }
      const myToken = ++markerFetchToken;
      const b = map.getBounds();
      const dsFilter = activeSource !== "all" && SOURCE_DATASETS[activeSource] ? `&datasetKey=${SOURCE_DATASETS[activeSource].key}` : "";
      const url = `https://api.gbif.org/v1/occurrence/search?taxonKey=${taxonKey}&hasCoordinate=true&limit=200${dsFilter}`
        + `&decimalLatitude=${b.getSouth().toFixed(4)},${b.getNorth().toFixed(4)}`
        + `&decimalLongitude=${b.getWest().toFixed(4)},${b.getEast().toFixed(4)}`;
      try {
        const data = await fetchJSON(url);
        if (myToken !== markerFetchToken) return; // a newer request superseded this one
        markersLayer.clearLayers();
        const results = data?.results || [];
        for (const r of results) {
          const lat = r.decimalLatitude, lon = r.decimalLongitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const marker = L.circleMarker([lat, lon], {
            radius: 6, weight: 1, color: "#9a3412", fillColor: "#f97316", fillOpacity: 0.85,
          });
          const photo = (r.media || []).find(m => m.type === "StillImage");
          const sourceLabel = r.datasetKey === SOURCE_DATASETS.ebird.key ? "eBird"
            : r.datasetKey === SOURCE_DATASETS.inat.key ? "iNaturalist" : (r.institutionCode || "GBIF");
          const link = r.references || `https://www.gbif.org/occurrence/${r.key}`;
          marker.bindPopup(`
            <div style="max-width:200px;font-size:.82rem;">
              ${photo ? `<img src="${escapeHtml(photo.identifier)}" alt="" style="width:100%;border-radius:4px;margin-bottom:.35rem;display:block;">` : ""}
              ${r.eventDate ? `<div>${escapeHtml(String(r.eventDate).slice(0, 10))}</div>` : ""}
              ${r.recordedBy ? `<div class="muted" style="font-size:.75rem;">${escapeHtml(r.recordedBy)}</div>` : ""}
              <div style="margin-top:.3rem;">
                <span class="badge" style="font-size:.68rem;">${escapeHtml(sourceLabel)}</span>
                <a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="font-size:.75rem;margin-left:.3rem;">View record →</a>
              </div>
            </div>
          `);
          markersLayer.addLayer(marker);
        }
        if (hintEl) {
          hintEl.textContent = data?.count > results.length
            ? `Showing ${results.length} of ${data.count.toLocaleString()} observations in view — zoom in further to narrow it down.`
            : `${results.length.toLocaleString()} observation${results.length !== 1 ? "s" : ""} in view — click one for details.`;
        }
      } catch (_) {}
    }

    let moveendTimer = null;
    map.on("moveend", () => {
      clearTimeout(moveendTimer);
      moveendTimer = setTimeout(refreshMarkers, 400); // debounce rapid pan/zoom
    });

    // Source toggle — filters the individual-observation markers only (see
    // note above on why the heatmap tiles can't be filtered the same way).
    if (taxonKey) {
      const toggleEl = $("speciesMapSourceToggle");
      if (toggleEl) {
        const sources = [{ id: "all", label: "All sources" }, { id: "ebird", label: "eBird" }, { id: "inat", label: "iNaturalist" }];
        toggleEl.innerHTML = sources.map(s =>
          `<button type="button" class="btn btn-secondary btn-xs species-source-btn" data-source="${s.id}" style="${s.id === activeSource ? "" : "opacity:.6;"}" title="Filters individual observation markers (zoom in to see them) — the heatmap always shows all sources combined">${escapeHtml(s.label)}</button>`
        ).join("");
        toggleEl.querySelectorAll(".species-source-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            activeSource = btn.getAttribute("data-source");
            toggleEl.querySelectorAll(".species-source-btn").forEach(b => {
              b.style.opacity = b.getAttribute("data-source") === activeSource ? "1" : ".6";
            });
            refreshMarkers();
          });
        });
      }
    }

    // Add any WoC EOO that arrived before the map was ready
    if (_pendingEoo) { addEooToMap(map, _pendingEoo); _pendingEoo = null; }

    L.control.attribution({ prefix: false })
      .addAttribution('© <a href="https://www.naturalearthdata.com/">Natural Earth</a> | <a href="https://www.gbif.org">GBIF</a>')
      .addTo(map);

    map.setView([20, 10], 2);
    map.invalidateSize(); // cheap safety net in case layout hadn't settled yet

    // Auto-zoom to where the species actually occurs, same as iNaturalist's
    // own species maps do — opening on a fixed world view made a range-
    // restricted species (e.g. a NZ-only bird) look like a handful of
    // barely-visible specks on the far edge of the map instead of a
    // readable distribution.
    if (taxonKey) {
      try {
        const occData = await fetchJSON(
          `https://api.gbif.org/v1/occurrence/search?taxonKey=${taxonKey}&hasCoordinate=true&limit=300`
        );
        const pts = (occData?.results || [])
          .map(r => [r.decimalLatitude, r.decimalLongitude])
          .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

        if (pts.length) {
          // A naive min/max bounding box breaks for any species whose range
          // crosses the antimeridian (±180° longitude) — New Zealand is a
          // real-world example: its main islands sit around +166 to +179°,
          // but its own Chatham Islands are at ~-176°, just past the
          // dateline. A plain bbox over both reads that as a ~360°-wide
          // span and zooms out to fit nearly the whole planet, live-tested
          // and reproduced exactly on the tūī page. iNaturalist's own map
          // doesn't try to fit every last outlying point either — it zooms
          // to the main cluster and leaves far-flung ones visible off to
          // the side. Replicated that here: trim to the 90% of points
          // closest to the median center before computing bounds, rather
          // than attempting proper antimeridian-aware bbox math for what's
          // ultimately just a "pick a reasonable starting view" heuristic.
          const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
          const medLat = median(pts.map(p => p[0]));
          const medLon = median(pts.map(p => p[1]));
          const withDist = pts.map(p => ({
            p,
            d: Math.hypot(p[0] - medLat, Math.min(Math.abs(p[1] - medLon), 360 - Math.abs(p[1] - medLon)))
          })).sort((a, b) => a.d - b.d);
          const kept = withDist.slice(0, Math.ceil(withDist.length * 0.9)).map(x => x.p);

          map.fitBounds(kept, { padding: [20, 20], maxZoom: 6 });
        }
      } catch (_) {}
    }

    return map;
  }

  // ── GBIF occurrence data + map tiles ─────────────────────────────────────────
  async function loadGbifData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;

    try {
      const resp = await fetch("/api/field-data/gbif?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.total_occurrences) return;

      // Show field data block and initialize the shared species map
      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      initSpeciesMap(d.taxon_key, displayName); // non-blocking — map loads while panel renders

      // Build GBIF panel and insert into inatContent (after iNat panel)
      const container = $("inatContent");
      if (!container) return;

      // Year sparkline
      const trend = d.year_trend || [];
      const maxCount = Math.max(...trend.map(r => r.count), 1);
      const barW = 100 / Math.max(trend.length, 1);
      const sparkBars = trend.map(r => {
        const h = Math.round(r.count / maxCount * 100);
        return `<div class="inat-spark-bar" style="width:${barW}%;height:${h}%;background:#1fb8cd;" title="${r.year}: ${r.count.toLocaleString()} records"></div>`;
      }).join("");

      const newest = trend[trend.length - 1];
      const oldest = trend[0];
      const growthStr = (newest && oldest && oldest.count > 0)
        ? `${Math.round(newest.count / oldest.count)}× growth over ${newest.year - oldest.year} years`
        : "";

      const vernStr = d.vernacular_names?.length
        ? `<div class="inat-title" style="color:#6b7280;font-weight:400;font-size:.78rem;margin-bottom:.4rem;">${d.vernacular_names.join(" · ")}</div>`
        : "";

      const gbifDiv = document.createElement("div");
      gbifDiv.className = "inat-panel";
      gbifDiv.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#1fb8cd"/><text x="10" y="14" text-anchor="middle" font-size="8" font-family="sans-serif" font-weight="bold" fill="white">GBIF</text></svg>
          <span class="inat-title">GBIF · Global Biodiversity Information Facility</span>
        </div>
        ${vernStr}
        <div class="woc-stats-grid">
          <div class="woc-stat">
            <div class="woc-stat-value">${d.total_occurrences.toLocaleString()}</div>
            <div class="woc-stat-label">Occurrence records</div>
          </div>
          <div class="woc-stat">
            <div class="woc-stat-value">${d.countries_count}</div>
            <div class="woc-stat-label">Countries</div>
          </div>
        </div>

        ${d.top_countries?.length ? `
        <p class="woc-section-label" style="margin-top:.75rem;">Records by country (top 10)</p>
        <div class="woc-bars">
          ${(()=>{
            const mx = d.top_countries[0].count;
            return d.top_countries.map(c => {
              const pct = Math.round(c.count / mx * 100);
              return `<div class="woc-bar-row">
                <span class="woc-bar-label">${escapeHtml(c.name)}</span>
                <div class="woc-bar-track"><div class="woc-bar-fill" style="width:${pct}%;background:#1fb8cd;"></div></div>
                <span class="woc-bar-count">${c.count.toLocaleString()}</span>
              </div>`;
            }).join("");
          })()}
        </div>` : ""}

        ${trend.length ? `
        <p class="woc-section-label" style="margin-top:.75rem;">Records per year (last ${trend.length} years)</p>
        <div class="inat-sparkline">${sparkBars}</div>
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:#6b7280;margin-top:.2rem;">
          <span>${oldest?.year || ""}</span>
          ${growthStr ? `<span style="color:#0e7490;font-weight:500;">${escapeHtml(growthStr)}</span>` : ""}
          <span>${newest?.year || ""}</span>
        </div>` : ""}

        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.gbif_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on GBIF →
          </a>
          <span class="muted" style="font-size:.75rem;margin-left:.75rem;">
            Aggregated from ${d.total_occurrences.toLocaleString()} records worldwide
          </span>
        </div>
      `;
      container.appendChild(gbifDiv);

    } catch (_) {}
  }

  // OBIS — marine occurrence stats, same role as GBIF above but
  // marine-specific. Its checklist endpoint also embeds an IUCN
  // conservation category for free, ahead of the dedicated IUCN
  // integration — shown as a bonus badge when present.
  async function loadObisData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;

    try {
      const resp = await fetch("/api/field-data/obis?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.total_records) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";

      const container = $("inatContent");
      if (!container) return;

      const trend = d.year_trend || [];
      const maxCount = Math.max(...trend.map(r => r.count), 1);
      const barW = 100 / Math.max(trend.length, 1);
      const sparkBars = trend.map(r => {
        const h = Math.round(r.count / maxCount * 100);
        return `<div class="inat-spark-bar" style="width:${barW}%;height:${h}%;background:#0e7490;" title="${r.year}: ${r.count.toLocaleString()} records"></div>`;
      }).join("");

      const newest = trend[trend.length - 1];
      const oldest = trend[0];

      const iucnLabels = { EX:"Extinct", EW:"Extinct in the Wild", CR:"Critically Endangered", EN:"Endangered",
        VU:"Vulnerable", NT:"Near Threatened", LC:"Least Concern", DD:"Data Deficient", NE:"Not Evaluated" };
      const iucnColors = { EX:"#1f2937", EW:"#1f2937", CR:"#b91c1c", EN:"#b45309", VU:"#b45309",
        NT:"#a16207", LC:"#15803d", DD:"#475569", NE:"#475569" };
      const iucnBadge = d.iucn_category
        ? `<span class="badge" style="font-size:.72rem;color:${iucnColors[d.iucn_category] || "#374151"};border-color:${iucnColors[d.iucn_category] || "#374151"};">IUCN: ${escapeHtml(iucnLabels[d.iucn_category] || d.iucn_category)}</span>`
        : "";

      const obisDiv = document.createElement("div");
      obisDiv.className = "inat-panel";
      obisDiv.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#0e7490"/><text x="10" y="14" text-anchor="middle" font-size="7" font-family="sans-serif" font-weight="bold" fill="white">OBIS</text></svg>
          <span class="inat-title">OBIS · Ocean Biodiversity Information System</span>
        </div>
        ${iucnBadge ? `<div style="margin-bottom:.4rem;">${iucnBadge}</div>` : ""}
        <div class="woc-stats-grid">
          <div class="woc-stat">
            <div class="woc-stat-value">${d.total_records.toLocaleString()}</div>
            <div class="woc-stat-label">Marine occurrence records</div>
          </div>
        </div>

        ${trend.length ? `
        <p class="woc-section-label" style="margin-top:.75rem;">Records per year (last ${trend.length} years)</p>
        <div class="inat-sparkline">${sparkBars}</div>
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:#6b7280;margin-top:.2rem;">
          <span>${oldest?.year || ""}</span>
          <span>${newest?.year || ""}</span>
        </div>` : ""}

        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.obis_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on OBIS →
          </a>
        </div>
      `;
      container.appendChild(obisDiv);

    } catch (_) {}
  }

  // Renders as a small sidebar Infobox item (same footprint as the CoL/WoRMS
  // classification boxes), not a full-width Field Data panel — it's a
  // single status fact, not occurrence data, so it doesn't need that much
  // space.
  async function loadIucnData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;
    const wrap = $("iucnStatus");
    if (!wrap) return;

    try {
      const resp = await fetch("/api/field-data/iucn?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.category_code) return;

      const iucnLabels = { EX:"Extinct", EW:"Extinct in the Wild", CR:"Critically Endangered", EN:"Endangered",
        VU:"Vulnerable", NT:"Near Threatened", LC:"Least Concern", DD:"Data Deficient", NE:"Not Evaluated" };
      const iucnColors = { EX:"#1f2937", EW:"#1f2937", CR:"#b91c1c", EN:"#b45309", VU:"#b45309",
        NT:"#a16207", LC:"#15803d", DD:"#475569", NE:"#475569" };
      const color = iucnColors[d.category_code] || "#374151";
      const label = iucnLabels[d.category_code] || d.category_code;

      wrap.innerHTML = `
        <h4 style="margin-bottom:.35rem;">IUCN Red List</h4>
        <span class="badge" style="font-size:.85rem;color:${color};border-color:${color};font-weight:600;">${escapeHtml(label)}</span>
        ${d.year_published ? `<p class="muted" style="font-size:.75rem;margin:.3rem 0 0;">Assessed ${escapeHtml(String(d.year_published))}</p>` : ""}
        <div style="margin-top:.5rem;">
          <a href="${escapeHtml(d.assessment_url)}" target="_blank" rel="noopener" style="font-size:.78rem;">View assessment →</a>
        </div>
      `;
      wrap.style.display = "";
    } catch (_) {}
  }

  async function loadEbirdData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;

    try {
      const resp = await fetch("/api/field-data/ebird?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.species_code) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#0f766e"/><text x="10" y="14" text-anchor="middle" font-size="7" font-family="sans-serif" font-weight="bold" fill="white">eBird</text></svg>
          <span class="inat-title">eBird · ${escapeHtml(d.com_name)}</span>
        </div>
        ${d.family_com_name ? `<p class="muted" style="font-size:.82rem;margin:.25rem 0 .5rem;">${escapeHtml(d.family_com_name)} (${escapeHtml(d.family_sci_name || "")})</p>` : ""}
        <div class="woc-footer" style="margin-top:.5rem;">
          <a href="${escapeHtml(d.ebird_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on eBird →
          </a>
        </div>
      `;
      container.appendChild(div);

    } catch (_) {}
  }

  async function loadXenoCantoData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;

    try {
      const resp = await fetch("/api/field-data/xenocanto?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.total_recordings || !(d.recordings || []).length) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const items = d.recordings.map(r => {
        const meta = [r.type, r.loc || r.cnt, r.date].filter(Boolean).join(" · ");
        return `
          <div style="margin-bottom:.6rem;padding-bottom:.6rem;border-bottom:1px solid #f1f5f9;">
            ${r.sono_url ? `<img src="${escapeHtml(r.sono_url)}" alt="Sonogram" style="width:100%;max-width:280px;border-radius:4px;display:block;margin-bottom:.3rem;" loading="lazy">` : ""}
            <audio controls preload="none" style="width:100%;max-width:280px;height:32px;" src="${escapeHtml(r.file_url)}"></audio>
            <p class="muted" style="font-size:.75rem;margin:.25rem 0 0;">
              ${escapeHtml(meta)}${r.rec ? ` · rec. ${escapeHtml(r.rec)}` : ""}
              ${r.page_url ? ` · <a href="${escapeHtml(r.page_url)}" target="_blank" rel="noopener">XC${escapeHtml(String(r.id))}</a>` : ""}
            </p>
          </div>`;
      }).join("");

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#ca8a04"/><text x="10" y="14" text-anchor="middle" font-size="6" font-family="sans-serif" font-weight="bold" fill="white">XC</text></svg>
          <span class="inat-title">Xeno-canto · ${d.total_recordings.toLocaleString()} recordings</span>
        </div>
        ${items}
        <div class="woc-footer" style="margin-top:.25rem;">
          <a href="${escapeHtml(d.xenocanto_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View all on Xeno-canto →
          </a>
        </div>
      `;
      container.appendChild(div);

    } catch (_) {}
  }

  // Resolves a topic display name to a scientific binomial name when it
  // isn't one already — e.g. a page titled with a common/vernacular name
  // like "Tūī" would otherwise never trigger any of the species-gated
  // panels above, even though the species is fully documented in all of
  // them under its scientific name (see server/index.js resolve-species
  // for how the match is verified against GBIF's real vernacular-names
  // list before being trusted). Falls back to the original name — and
  // every species panel just stays hidden, same as before this existed —
  // if nothing resolves.
  async function resolveSpeciesName(displayName) {
    const trimmed = displayName.trim();
    if (/^[A-Z][a-z]+ [a-z]+/.test(trimmed)) return trimmed;
    try {
      const resp = await fetch("/api/field-data/resolve-species?name=" + encodeURIComponent(trimmed));
      if (!resp.ok) return trimmed;
      const d = await resp.json();
      return d.scientific_name || trimmed;
    } catch (_) {
      return trimmed;
    }
  }

  // ---- Tier 3: beyond species pages ----
  // No structural pre-filter like the binomial-name regex above exists for
  // these (a compound, protein, or planet name doesn't have a fixed shape),
  // and OpenAlex's legacy Concepts API no longer returns useful `ancestors`
  // data to gate by field. Each of these fires on every topic page and
  // relies on the backend endpoint's own precision (exact-match lookups,
  // title verification, or a score floor — see server/index.js) to stay
  // silent on irrelevant topics.

  async function loadChemblData(displayName) {
    try {
      const resp = await fetch("/api/field-data/chembl?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.chembl_id) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const phaseLabels = { "4": "Approved drug", "3": "Phase 3 trials", "2": "Phase 2 trials", "1": "Phase 1 trials", "0.5": "Early phase 1", "0": "Preclinical" };
      const phaseBadge = d.max_phase != null
        ? `<span class="badge" style="font-size:.72rem;">${escapeHtml(phaseLabels[String(d.max_phase)] || ("Phase " + d.max_phase))}</span>`
        : "";

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#7c3aed"/><text x="10" y="14" text-anchor="middle" font-size="6" font-family="sans-serif" font-weight="bold" fill="white">ChEMBL</text></svg>
          <span class="inat-title">ChEMBL · Bioactive Molecule Database</span>
        </div>
        ${phaseBadge ? `<div style="margin-bottom:.4rem;">${phaseBadge}</div>` : ""}
        <div class="woc-stats-grid">
          ${d.molecular_formula ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(d.molecular_formula)}</div><div class="woc-stat-label">Molecular formula</div></div>` : ""}
          ${d.molecular_weight ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.molecular_weight))}</div><div class="woc-stat-label">Molecular weight (g/mol)</div></div>` : ""}
          ${d.first_approval ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.first_approval))}</div><div class="woc-stat-label">First approved</div></div>` : ""}
        </div>
        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.chembl_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on ChEMBL →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadPdbData(displayName) {
    try {
      const resp = await fetch("/api/field-data/pdb?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.pdb_id) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#1d4ed8"/><text x="10" y="14" text-anchor="middle" font-size="7" font-family="sans-serif" font-weight="bold" fill="white">PDB</text></svg>
          <span class="inat-title">Protein Data Bank · ${escapeHtml(d.pdb_id)}</span>
        </div>
        <p style="font-size:.85rem;color:#374151;margin:.25rem 0 .5rem;">${escapeHtml(d.title)}</p>
        <div class="woc-stats-grid">
          ${d.method ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(d.method)}</div><div class="woc-stat-label">Method</div></div>` : ""}
          ${d.resolution ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.resolution))} Å</div><div class="woc-stat-label">Resolution</div></div>` : ""}
          ${d.total_count > 1 ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${d.total_count.toLocaleString()}</div><div class="woc-stat-label">Related structures</div></div>` : ""}
        </div>
        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.pdb_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on RCSB PDB →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadExoplanetData(displayName) {
    try {
      const resp = await fetch("/api/field-data/exoplanet?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.pl_name) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#0f172a"/><text x="10" y="14" text-anchor="middle" font-size="6" font-family="sans-serif" font-weight="bold" fill="white">NASA</text></svg>
          <span class="inat-title">NASA Exoplanet Archive</span>
        </div>
        <div class="woc-stats-grid">
          ${d.hostname ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(d.hostname)}</div><div class="woc-stat-label">Host star</div></div>` : ""}
          ${d.disc_year ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.disc_year))}</div><div class="woc-stat-label">Discovered</div></div>` : ""}
          ${d.discoverymethod ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(d.discoverymethod)}</div><div class="woc-stat-label">Detection method</div></div>` : ""}
          ${d.radius_earth != null ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.radius_earth))}× Earth</div><div class="woc-stat-label">Radius</div></div>` : ""}
          ${d.mass_earth != null ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.mass_earth))}× Earth</div><div class="woc-stat-label">Mass</div></div>` : ""}
          ${d.eq_temp_k != null ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(Math.round(d.eq_temp_k)))} K</div><div class="woc-stat-label">Equilibrium temp</div></div>` : ""}
          ${d.distance_pc != null ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(Math.round(d.distance_pc)))} pc</div><div class="woc-stat-label">Distance</div></div>` : ""}
        </div>
        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.exoplanet_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on NASA Exoplanet Archive →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadPangaeaData(displayName) {
    try {
      const resp = await fetch("/api/field-data/pangaea?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.total_count) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const items = (d.datasets || []).map(ds => `
        <li style="margin-bottom:.4rem;font-size:.83rem;">
          ${ds.url ? `<a href="${escapeHtml(ds.url)}" target="_blank" rel="noopener">${escapeHtml(ds.citation)}</a>` : escapeHtml(ds.citation)}
        </li>`).join("");

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#0369a1"/><text x="10" y="14" text-anchor="middle" font-size="6" font-family="sans-serif" font-weight="bold" fill="white">PANG</text></svg>
          <span class="inat-title">PANGAEA · Earth &amp; Environmental Datasets</span>
        </div>
        <ul style="margin:.4rem 0 0;padding-left:1.1rem;">${items}</ul>
        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.pangaea_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            Search PANGAEA →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadMaterialsData(displayName) {
    try {
      const resp = await fetch("/api/field-data/materials?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.material_id) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#4338ca"/><text x="10" y="14" text-anchor="middle" font-size="5.5" font-family="sans-serif" font-weight="bold" fill="white">MP</text></svg>
          <span class="inat-title">Materials Project · ${escapeHtml(d.formula)}</span>
        </div>
        <div class="woc-stats-grid">
          ${d.crystal_system ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(d.crystal_system)}</div><div class="woc-stat-label">Crystal system</div></div>` : ""}
          ${d.space_group ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(d.space_group)}</div><div class="woc-stat-label">Space group</div></div>` : ""}
          ${d.density != null ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.density))} g/cm³</div><div class="woc-stat-label">Density</div></div>` : ""}
          ${d.band_gap_ev != null ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${escapeHtml(String(d.band_gap_ev))} eV</div><div class="woc-stat-label">Band gap</div></div>` : ""}
        </div>
        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.materials_project_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on Materials Project →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadUniprotData(displayName) {
    try {
      const resp = await fetch("/api/field-data/uniprot?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.accession) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#166534"/><text x="10" y="14" text-anchor="middle" font-size="5.5" font-family="sans-serif" font-weight="bold" fill="white">UniProt</text></svg>
          <span class="inat-title">UniProt · ${escapeHtml(d.protein_name)}</span>
        </div>
        ${d.organism ? `<p class="muted" style="font-size:.82rem;margin:.25rem 0 .4rem;">${escapeHtml(d.organism)}${d.gene_name ? ` · gene ${escapeHtml(d.gene_name)}` : ""}</p>` : ""}
        ${d.function_text ? `<p style="font-size:.85rem;color:#374151;margin:0 0 .5rem;">${escapeHtml(d.function_text)}</p>` : ""}
        ${d.length_aa ? `<div class="woc-stats-grid"><div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${d.length_aa.toLocaleString()}</div><div class="woc-stat-label">Amino acids</div></div></div>` : ""}
        <div class="woc-footer" style="margin-top:.5rem;">
          <a href="${escapeHtml(d.uniprot_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on UniProt →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadWikidataData(displayName) {
    try {
      const resp = await fetch("/api/field-data/wikidata?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.qid) return;

      // Chain into the earthquake and GeoNames panels when this entity has
      // real-world coordinates — i.e. only after Wikidata has already
      // independently confirmed this topic IS a place. GeoNames used to
      // fire unconditionally on name alone, but live-tested "Tūī" (the NZ
      // bird) matched a same-named Spanish town — a real place, just not
      // what the topic is about. No string-matching fix solves that class
      // of error; requiring independent confirmation from another source
      // does.
      if (d.coords) {
        loadEarthquakeData(d.coords.lat, d.coords.lon);
        loadGeonamesData(displayName);
      }

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const idBadges = (d.identifiers || []).map(idf => idf.url
        ? `<a href="${escapeHtml(idf.url)}" target="_blank" rel="noopener" class="badge" style="font-size:.72rem;">${escapeHtml(idf.label)}: ${escapeHtml(idf.value)}</a>`
        : `<span class="badge" style="font-size:.72rem;">${escapeHtml(idf.label)}: ${escapeHtml(idf.value)}</span>`
      ).join(" ");

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#14532d"/><text x="10" y="15" text-anchor="middle" font-size="12" font-family="sans-serif" font-weight="bold" fill="white">W</text></svg>
          <span class="inat-title">Wikidata</span>
        </div>
        ${d.image_url ? `<img src="${escapeHtml(d.image_url)}" alt="" style="width:100%;max-width:240px;border-radius:4px;display:block;margin-bottom:.4rem;" loading="lazy">` : ""}
        <div class="woc-stats-grid">
          ${d.population ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${Number(d.population).toLocaleString()}</div><div class="woc-stat-label">Population</div></div>` : ""}
          ${d.coords ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1rem;">${d.coords.lat.toFixed(2)}, ${d.coords.lon.toFixed(2)}</div><div class="woc-stat-label">Coordinates</div></div>` : ""}
        </div>
        ${idBadges ? `<div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.3rem;">${idBadges}</div>` : ""}
        <div class="woc-footer" style="margin-top:.5rem;">
          <a href="${escapeHtml(d.wikidata_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on Wikidata →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadEarthquakeData(lat, lon) {
    try {
      const resp = await fetch(`/api/field-data/earthquakes?lat=${lat}&lon=${lon}`);
      if (!resp.ok) return;
      const d = await resp.json();
      if (!(d.quakes || []).length) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const rows = d.quakes.map(q => `
        <li style="margin-bottom:.3rem;font-size:.83rem;">
          <a href="${escapeHtml(q.url)}" target="_blank" rel="noopener">M${q.mag.toFixed(1)} — ${escapeHtml(q.place)}</a>
          <span class="muted" style="font-size:.75rem;"> · ${new Date(q.time).toLocaleDateString()}</span>
        </li>`).join("");

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#b91c1c"/><text x="10" y="14" text-anchor="middle" font-size="6" font-family="sans-serif" font-weight="bold" fill="white">USGS</text></svg>
          <span class="inat-title">Recent earthquakes within ${d.radius_km} km</span>
        </div>
        <ul style="margin:.4rem 0 0;padding-left:1.1rem;">${rows}</ul>
        <p class="muted" style="font-size:.72rem;margin-top:.4rem;">Magnitude ≥4.5, since ${escapeHtml(d.since)} · USGS Earthquake Hazards Program</p>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadWorldBankData(displayName) {
    try {
      const resp = await fetch("/api/field-data/worldbank?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.indicators) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const ind = d.indicators;
      const fmtMoney = v => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString()}`;

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#1e3a8a"/><text x="10" y="14" text-anchor="middle" font-size="5" font-family="sans-serif" font-weight="bold" fill="white">World Bank</text></svg>
          <span class="inat-title">World Bank · ${escapeHtml(d.country)}</span>
        </div>
        <div class="woc-stats-grid">
          ${ind.gdp_usd ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${fmtMoney(ind.gdp_usd.value)}</div><div class="woc-stat-label">GDP (${escapeHtml(ind.gdp_usd.year)})</div></div>` : ""}
          ${ind.population ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${Number(ind.population.value).toLocaleString()}</div><div class="woc-stat-label">Population (${escapeHtml(ind.population.year)})</div></div>` : ""}
          ${ind.life_expectancy ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${Number(ind.life_expectancy.value).toFixed(1)}</div><div class="woc-stat-label">Life expectancy (${escapeHtml(ind.life_expectancy.year)})</div></div>` : ""}
        </div>
        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.worldbank_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on World Bank →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadGeonamesData(displayName) {
    try {
      const resp = await fetch("/api/field-data/geonames?name=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.name) return;

      const block = $("fieldDataBlock");
      if (block) block.style.display = "";
      const container = $("inatContent");
      if (!container) return;

      const div = document.createElement("div");
      div.className = "inat-panel";
      div.innerHTML = `
        <div class="inat-header">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#0e7490"/><text x="10" y="14" text-anchor="middle" font-size="5.5" font-family="sans-serif" font-weight="bold" fill="white">GEO</text></svg>
          <span class="inat-title">GeoNames · ${escapeHtml(d.feature_type || "place")}</span>
        </div>
        <p class="muted" style="font-size:.82rem;margin:.25rem 0 .5rem;">${[d.admin_area, d.country].filter(Boolean).map(escapeHtml).join(", ")}</p>
        <div class="woc-stats-grid">
          ${d.population ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${d.population.toLocaleString()}</div><div class="woc-stat-label">Population</div></div>` : ""}
          ${d.elevation_m != null ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1.1rem;">${d.elevation_m.toLocaleString()} m</div><div class="woc-stat-label">Elevation</div></div>` : ""}
          ${d.timezone ? `<div class="woc-stat"><div class="woc-stat-value" style="font-size:1rem;">${escapeHtml(d.timezone)}</div><div class="woc-stat-label">Timezone</div></div>` : ""}
        </div>
        <div class="woc-footer" style="margin-top:.75rem;">
          <a href="${escapeHtml(d.geonames_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View on GeoNames →
          </a>
        </div>
      `;
      container.appendChild(div);
    } catch (_) {}
  }

  async function loadInatData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;
    const container = $("inatContent");
    if (!container) return;

    try {
      const resp = await fetch("/api/field-data/inat?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.total_observations) return;

      // Ensure parent field data block is visible
      const block = $("fieldDataBlock");
      if (block) block.style.display = "";

      // Sparkline from year_trend
      const trend = d.year_trend || [];
      const maxCount = Math.max(...trend.map(r => r.count), 1);
      const barW = 100 / Math.max(trend.length, 1);
      const sparkBars = trend.map(r => {
        const h = Math.round(r.count / maxCount * 100);
        return `<div class="inat-spark-bar" style="width:${barW}%;height:${h}%" title="${r.year}: ${r.count.toLocaleString()} obs"></div>`;
      }).join("");

      // Recent growth label
      const newest = trend[trend.length - 1];
      const oldest = trend[0];
      const growthStr = (newest && oldest && oldest.count > 0)
        ? `${Math.round(newest.count / oldest.count)}× growth over ${newest.year - oldest.year} years`
        : "";

      container.innerHTML = `
        <div class="inat-panel">
          <div class="inat-header">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;border-radius:3px;" aria-hidden="true"><rect width="20" height="20" rx="3" fill="#74ac00"/><text x="10" y="14" text-anchor="middle" font-size="11" font-family="sans-serif" font-weight="bold" fill="white">iN</text></svg>
            <span class="inat-title">iNaturalist · Citizen Science Observations</span>
          </div>

          ${d.photo ? `
          <div class="inat-photo-row">
            <img src="${escapeHtml(d.photo.url)}" class="inat-photo" alt="${escapeHtml(displayName)}">
            <span class="inat-photo-credit">${escapeHtml(d.photo.attribution)}</span>
          </div>` : ""}

          <div class="woc-stats-grid" style="margin-top:.75rem;">
            <div class="woc-stat">
              <div class="woc-stat-value">${d.total_observations.toLocaleString()}</div>
              <div class="woc-stat-label">Total observations</div>
            </div>
            <div class="woc-stat">
              <div class="woc-stat-value">${d.research_grade.toLocaleString()}</div>
              <div class="woc-stat-label">Research grade</div>
            </div>
            <div class="woc-stat">
              <div class="woc-stat-value">${d.observers_count.toLocaleString()}</div>
              <div class="woc-stat-label">Observers</div>
            </div>
          </div>

          ${trend.length ? `
          <p class="woc-section-label" style="margin-top:.75rem;">Observations per year (research grade)</p>
          <div class="inat-sparkline">${sparkBars}</div>
          <div style="display:flex;justify-content:space-between;font-size:.72rem;color:#6b7280;margin-top:.2rem;">
            <span>${oldest?.year || ""}</span>
            ${growthStr ? `<span style="color:#15803d;font-weight:500;">${escapeHtml(growthStr)}</span>` : ""}
            <span>${newest?.year || ""}</span>
          </div>` : ""}

          <div class="woc-footer" style="margin-top:.75rem;">
            <a href="${escapeHtml(d.inat_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
              View on iNaturalist →
            </a>
          </div>
        </div>
      `;
    } catch (_) {}
  }

  // ── Catalogue of Life classification ──────────────────────────────────────────
  async function loadColData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;
    const wrap = $("colClassification");
    if (!wrap) return;

    const rankLabels = {
      kingdom: "Kingdom", phylum: "Phylum", subphylum: "Subphylum",
      class: "Class", order: "Order", family: "Family", genus: "Genus",
    };

    try {
      const resp = await fetch("/api/field-data/col?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.classification?.length) return;

      const rows = d.classification.map(c => `
        <div style="display:flex;justify-content:space-between;font-size:.82rem;padding:.15rem 0;">
          <span class="muted">${escapeHtml(rankLabels[c.rank] || c.rank)}</span>
          <span style="font-style:${c.rank === "genus" ? "italic" : "normal"};">${escapeHtml(c.name)}</span>
        </div>`).join("");

      const synonymNote = d.status && d.status !== "accepted"
        ? `<p class="muted" style="font-size:.75rem;margin-top:.35rem;">Status: ${escapeHtml(d.status)}</p>`
        : "";

      wrap.innerHTML = `
        <h4 style="margin-bottom:.35rem;">Classification</h4>
        ${rows}
        ${synonymNote}
        <div style="margin-top:.5rem;">
          <a href="${escapeHtml(d.col_url)}" target="_blank" rel="noopener" style="font-size:.78rem;">View on Catalogue of Life →</a>
        </div>
      `;
      wrap.style.display = "";
    } catch (_) {}
  }

  // WoRMS — authoritative name register for marine/aquatic taxa. Same role
  // as Catalogue of Life above (taxonomy reference, not occurrence stats) —
  // shown only when the species actually has a WoRMS record (most
  // terrestrial species correctly won't, and that's not an error).
  async function loadWormsData(displayName) {
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;
    const wrap = $("wormsClassification");
    if (!wrap) return;

    const rankLabels = { kingdom: "Kingdom", phylum: "Phylum", class: "Class", order: "Order", family: "Family", genus: "Genus" };

    try {
      const resp = await fetch("/api/field-data/worms?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.classification?.length) return;

      const rows = d.classification.map(c => `
        <div style="display:flex;justify-content:space-between;font-size:.82rem;padding:.15rem 0;">
          <span class="muted">${escapeHtml(rankLabels[c.rank] || c.rank)}</span>
          <span style="font-style:${c.rank === "genus" ? "italic" : "normal"};">${escapeHtml(c.name)}</span>
        </div>`).join("");

      const envBadges = [
        d.is_marine && "Marine", d.is_brackish && "Brackish",
        d.is_freshwater && "Freshwater", d.is_terrestrial && "Terrestrial",
      ].filter(Boolean).map(label => `<span class="badge" style="font-size:.72rem;margin-right:.25rem;">${label}</span>`).join("");

      wrap.innerHTML = `
        <h4 style="margin-bottom:.35rem;">WoRMS classification</h4>
        ${rows}
        ${envBadges ? `<div style="margin-top:.35rem;">${envBadges}</div>` : ""}
        <div style="margin-top:.5rem;">
          <a href="${escapeHtml(d.worms_url)}" target="_blank" rel="noopener" style="font-size:.78rem;">View on WoRMS →</a>
        </div>
      `;
      wrap.style.display = "";
    } catch (_) {}
  }

  // ── Claude topic synthesis ────────────────────────────────────────────────────
  async function loadTopicSynthesis(conceptIdTail) {
    if (!conceptIdTail) return;
    const block   = $("synthBlock");
    const content = $("synthContent");
    const refresh = $("synthRefresh");
    if (!block || !content) return;

    async function fetch_synthesis(bust) {
      const url = "/api/topic/synthesis?id=" + encodeURIComponent(conceptIdTail) + (bust ? "&bust=1" : "");
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return resp.json();
    }

    try {
      const data = await fetch_synthesis(false);
      if (!data?.synthesis) return;
      content.innerHTML = data.synthesis.split("\n\n").map(p =>
        `<p style="margin:.5rem 0;font-size:.9rem;line-height:1.6;color:#1f2937;">${escapeHtml(p.trim())}</p>`
      ).join("");
      block.style.display = "";
      if (refresh) refresh.addEventListener("click", async e => {
        e.preventDefault();
        content.innerHTML = '<p class="muted">Regenerating…</p>';
        const fresh = await fetch_synthesis(true);
        if (fresh?.synthesis) {
          content.innerHTML = fresh.synthesis.split("\n\n").map(p =>
            `<p style="margin:.5rem 0;font-size:.9rem;line-height:1.6;color:#1f2937;">${escapeHtml(p.trim())}</p>`
          ).join("");
        }
      });
    } catch (_) {}
  }

  // ── World of Crayfish field data integration ─────────────────────────────────
  async function loadFieldData(displayName) {
    // Only try for binomial species names (two words, first capitalised)
    if (!/^[A-Z][a-z]+ [a-z]+/.test(displayName.trim())) return;

    const block   = $("fieldDataBlock");
    const content = $("fieldDataContent");
    const source  = $("fieldDataSource");
    if (!block || !content) return;

    try {
      const resp = await fetch("/api/field-data/woc?species=" + encodeURIComponent(displayName));
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.total_records) return;

      // ── Stats row ────────────────────────────────────────────────────────────
      const native    = d.population_status?.indigenous   || 0;
      const nonNative = d.population_status?.["non-indigenous"] || 0;
      const total     = native + nonNative || 1;
      const nativePct = Math.round(native / total * 100);
      const yearFrom  = d.year_range?.[0] || "?";
      const yearTo    = d.year_range?.[1] || "?";
      const highAcc   = d.accuracy?.high || 0;
      const lowAcc    = d.accuracy?.low  || 0;
      const totalAcc  = highAcc + lowAcc || 1;
      const highPct   = Math.round(highAcc / totalAcc * 100);

      // ── Top countries bar chart ───────────────────────────────────────────────
      const maxCount  = d.top_countries?.[0]?.count || 1;
      const countryBars = (d.top_countries || []).map(c => {
        const pct = Math.round(c.count / maxCount * 100);
        return `<div class="woc-bar-row">
          <span class="woc-bar-label">${escapeHtml(c.name)}</span>
          <div class="woc-bar-track"><div class="woc-bar-fill" style="width:${pct}%"></div></div>
          <span class="woc-bar-count">${c.count.toLocaleString()}</span>
        </div>`;
      }).join("");

      // Render markdown narrative — bold, italic, line breaks only (no HTML injection)
      function renderWocMarkdown(md) {
        if (!md) return "";
        return md
          .split("\n\n").map(para => {
            const line = para.trim()
              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
              .replace(/\*([^*]+)\*/g, "<em>$1</em>");
            return `<p style="margin:.45rem 0;font-size:.875rem;line-height:1.6;color:#1f2937;">${line}</p>`;
          }).join("");
      }

      content.innerHTML = `
        <div class="woc-stats-grid">
          <div class="woc-stat">
            <div class="woc-stat-value">${d.total_records.toLocaleString()}</div>
            <div class="woc-stat-label">Validated occurrence records</div>
          </div>
          <div class="woc-stat">
            <div class="woc-stat-value">${d.total_hexagons.toLocaleString()}</div>
            <div class="woc-stat-label">Hexagonal grid cells</div>
          </div>
          <div class="woc-stat">
            <div class="woc-stat-value">${d.countries_count}</div>
            <div class="woc-stat-label">Countries</div>
          </div>
          <div class="woc-stat">
            <div class="woc-stat-value">${yearFrom}–${yearTo}</div>
            <div class="woc-stat-label">Observation period</div>
          </div>
        </div>

        <div class="woc-two-col">
          <div>
            <p class="woc-section-label">Population status</p>
            <div class="woc-split-bar">
              <div class="woc-split-native" style="width:${nativePct}%" title="Native: ${native.toLocaleString()} records"></div>
              <div class="woc-split-nonnative" style="width:${100 - nativePct}%" title="Non-indigenous: ${nonNative.toLocaleString()} records"></div>
            </div>
            <div class="woc-split-legend">
              <span class="woc-dot woc-dot-native"></span> Native (${nativePct}%)
              &nbsp;&nbsp;
              <span class="woc-dot woc-dot-nonnative"></span> Non-indigenous (${100 - nativePct}%)
            </div>
          </div>
          <div>
            <p class="woc-section-label">Data quality</p>
            <div class="woc-split-bar">
              <div class="woc-split-high" style="width:${highPct}%" title="High accuracy: ${highAcc.toLocaleString()}"></div>
              <div class="woc-split-low" style="width:${100 - highPct}%" title="Low accuracy: ${lowAcc.toLocaleString()}"></div>
            </div>
            <div class="woc-split-legend">
              <span class="woc-dot woc-dot-high"></span> High accuracy (${highPct}%)
              &nbsp;&nbsp;
              <span class="woc-dot woc-dot-low"></span> Lower accuracy (${100 - highPct}%)
            </div>
          </div>
        </div>

        <p class="woc-section-label" style="margin-top:1rem;">Records by country (top 10)</p>
        <div class="woc-bars">${countryBars}</div>

        <!-- Map is owned by GBIF panel (speciesMapContainer in topic.html) -->

        ${d.geo_narrative ? `
        <p class="woc-section-label" style="margin-top:1rem;">Biogeographical overview</p>
        <div class="woc-narrative-block" id="wocNarrativeBlock"></div>
        ` : ""}

        <div class="woc-footer">
          <a href="${escapeHtml(d.woc_url)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:.82rem;">
            View full distribution map →
          </a>
          <span class="muted" style="font-size:.75rem; margin-left:.75rem;">
            Data: <a href="https://world.crayfish.ro" target="_blank" rel="noopener">World of Crayfish®</a>
            ${d.citation ? " · " + escapeHtml(d.citation) : ""}
          </span>
        </div>
      `;

      // Render expandable narrative
      if (d.geo_narrative) {
        const narrativeEl = document.getElementById("wocNarrativeBlock");
        if (narrativeEl) {
          const paragraphs = d.geo_narrative.split("\n\n").map(p => p.trim()).filter(Boolean);
          const previewCount = 2;
          const hasMore = paragraphs.length > previewCount;

          function renderParagraphs(paras) {
            return paras.map(p => {
              const html = p
                .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
                .replace(/\*([^*]+)\*/g, "<em>$1</em>");
              return `<p style="margin:.45rem 0;font-size:.875rem;line-height:1.6;color:#1f2937;">${html}</p>`;
            }).join("");
          }

          if (hasMore) {
            narrativeEl.innerHTML = renderParagraphs(paragraphs.slice(0, previewCount))
              + `<p><button id="wocNarrativeToggle" class="link-btn" style="font-size:.85rem;">Read full overview ↓</button></p>`;
            document.getElementById("wocNarrativeToggle").addEventListener("click", function() {
              narrativeEl.innerHTML = renderParagraphs(paragraphs)
                + `<p><button id="wocNarrativeToggle" class="link-btn" style="font-size:.85rem;">Show less ↑</button></p>`;
              document.getElementById("wocNarrativeToggle").addEventListener("click", function() {
                narrativeEl.innerHTML = renderParagraphs(paragraphs.slice(0, previewCount))
                  + `<p><button id="wocNarrativeToggle" class="link-btn" style="font-size:.85rem;">Read full overview ↓</button></p>`;
                document.getElementById("wocNarrativeToggle").addEventListener("click", arguments.callee);
              });
            });
          } else {
            narrativeEl.innerHTML = renderParagraphs(paragraphs);
          }
        }
      }

      // Show block FIRST so Leaflet can measure the container dimensions
      source.textContent = "· World of Crayfish®";
      block.style.display = "";

      // Add WoC EOO polygon to the shared species map (owned by GBIF)
      if (d.eoo_geojson) {
        if (_leafletMap) {
          addEooToMap(_leafletMap, d.eoo_geojson);
        } else {
          _pendingEoo = d.eoo_geojson; // GBIF map not ready yet — stored for when it initialises
        }
      }
    } catch (_) {
      // No WoC data — panel stays hidden
    }
  }

  async function loadTopPapers(conceptIdTail) {
    if (!conceptIdTail) { papersCards.innerHTML = '<p class="muted">No papers found.</p>'; return; }
    const sortSel = $("topicSort");
    const orderSel = $("topicOrder");
    const sortField = (sortSel && sortSel.value === "date") ? "publication_year" : "cited_by_count";
    const dir = (orderSel && orderSel.value === "asc") ? "asc" : "desc";
    try {
      const data = await fetchOpenAlexJSON(`${API_OA}/works?filter=concepts.id:${encodeURIComponent(conceptIdTail)}&sort=${sortField}:${dir}&per_page=12`);
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
    if (!conceptIdTail) { if (topicPeople) topicPeople.innerHTML = '<li class="muted">No people listed</li>'; return; }
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
    html += `<div class="stat"><div class="stat-value" style="font-weight:700;">${escapeHtml(topic.display_name || "-")}</div></div>`;
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
    if (!conceptIdTail) return;
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
      let data = null;
      // Try direct fetch (works for C-prefixed OpenAlex IDs)
      try {
        const res = await fetchJSON(`${API_OA}/concepts/${encodeURIComponent(idTail)}`);
        if (res && res.id) data = res;
      } catch (_) {}
      // Fallback: search by name (Wikipedia slugs use underscores instead of spaces)
      if (!data) {
        try {
          const searchTerm = idTail.replace(/_/g, " ");
          const res = await fetchOpenAlexJSON(`${API_OA}/concepts?search=${encodeURIComponent(searchTerm)}&per_page=1`);
          const c = res.results?.[0];
          if (c?.id) data = c;
        } catch (_) {}
      }
      const item = data
        ? {
            title: data.display_name || idTail.replace(/_/g, " "),
            desc: (data.description || "").split(/\.\s/).slice(0, 2).join(". ") + (data.description ? "." : ""),
            count: data.works_count || 0
          }
        : { title: idTail.replace(/_/g, " "), desc: "", count: 0 };
      cache.set(idTail, item);
      return item;
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
    let idTail = idParam.includes("openalex.org") ? idParam.split("/").pop() : idParam;

    // Detect Wikipedia-slug style IDs (underscores as spaces, not a C+digits concept ID)
    const isWikiSlug = idTail && !/^C\d+$/i.test(idTail);
    // Human-readable name: replace underscores with spaces
    const humanName = idTail.replace(/_/g, " ");

    async function fetchConceptByIdOrSearch(idOrName) {
      // Try direct fetch (works for C-prefixed OpenAlex IDs)
      try {
        const res = await fetch(`${API_OA}/concepts/${encodeURIComponent(idOrName)}`);
        if (res.ok) return await res.json();
      } catch (_) {}

      const searchTerm = idOrName.replace(/_/g, " ");

      // Resolve the canonical title via Wikipedia FIRST, then use THAT to
      // query OpenAlex — not the other way around. OpenAlex's own legacy
      // concept search is frozen/unmaintained and frequently returns a
      // confidently-wrong match instead of nothing (live-tested: "Japan" →
      // "Japanese encephalitis", "Chile" → "Very Large Telescope", "Turkey"
      // → "Turkish", "Australia" → "Australian English"). Trying it first
      // meant the Wikipedia fallback below almost never ran, since OpenAlex
      // search nearly always returns SOMETHING — just often the wrong
      // thing. OpenAlex concept IDs are still required downstream (top
      // papers/authors are queried by concept ID, which Wikipedia has no
      // equivalent for), but querying it with a Wikipedia-verified
      // canonical title lands on the right concept far more reliably than
      // querying it with the raw, possibly-ambiguous user input directly.
      let canonicalTitle = searchTerm;
      try {
        const wpUrl = "https://en.wikipedia.org/w/api.php?action=query&list=search"
          + "&srsearch=" + encodeURIComponent(searchTerm)
          + "&srlimit=1&format=json&origin=*";
        const wpData = await fetchOpenAlexJSON(wpUrl);
        const wpTitle = wpData?.query?.search?.[0]?.title;
        if (wpTitle) canonicalTitle = wpTitle;
      } catch (_) {}

      // Even given the verified-correct title, OpenAlex's own concept
      // search still doesn't reliably return a real match — live-tested
      // querying it with the exact right term "Japan" and it still
      // returned "Japanese encephalitis". Its Concepts vocabulary is a
      // scientific/academic-subject taxonomy, not a general entity index —
      // plain countries/places often aren't in there as concepts at all,
      // and the search falls back to loosely matching on any substring
      // instead of admitting no match. So the returned concept's own name
      // is checked against what was actually searched for (case-
      // insensitive, punctuation-insensitive) before it's trusted — same
      // "verify, don't just trust the API's top hit" lesson as the
      // Wikidata/GeoNames Field Data fixes.
      const normalize = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const verifiedConceptSearch = async (term) => {
        const data = await fetchOpenAlexJSON(`${API_OA}/concepts?search=${encodeURIComponent(term)}&per_page=1`);
        const c = data.results?.[0];
        if (c?.id && normalize(c.display_name) === normalize(term)) return c;
        return null;
      };

      try {
        const c = await verifiedConceptSearch(canonicalTitle);
        if (c) { idTail = tail(c.id); return c; }
      } catch (_) {}

      // Wikipedia-corrected title found nothing verified in OpenAlex — try
      // the raw original term too, in case the correction wasn't needed.
      if (canonicalTitle !== searchTerm) {
        try {
          const c = await verifiedConceptSearch(searchTerm);
          if (c) { idTail = tail(c.id); return c; }
        } catch (_) {}
      }

      // Last resort: return a stub so the Wikipedia article still loads
      // (using the Wikipedia-verified title when we have one — it's more
      // likely correct than the raw slug-derived humanName).
      if (isWikiSlug) {
        return { display_name: canonicalTitle || humanName, description: "", id: "", related_concepts: [], ancestors: [] };
      }
      throw new Error("Concept not found");
    }

    try {
      // OpenAlex concept
      const topicCache = cacheRead(idTail, "concept");
      const topic = topicCache || (await fetchConceptByIdOrSearch(idTail));
      if (!topicCache) cacheWrite(idTail, "concept", topic);
      // If stub was returned (no OpenAlex concept found), clear idTail so all
      // downstream OpenAlex API calls skip gracefully instead of sending invalid queries
      if (!topic.id) idTail = "";

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

      // Internal linkify (blue words) for both lead and body.
      // Seed with OpenAlex ancestors/related, then extend with every concept
      // already linked by Wikipedia itself (extracted from the sanitised DOM).
      const linkPairs = buildLinkPairsFromConcept(topic);
      const wikiLinked = collectExistingTopicLinks(bodyWrap);
      const seen = new Set(linkPairs.map(p => p.term.toLowerCase()));
      wikiLinked.forEach(p => { if (!seen.has(p.term.toLowerCase())) { seen.add(p.term.toLowerCase()); linkPairs.push(p); } });
      linkifyContainer(leadWrap, linkPairs);
      linkifyContainer(bodyWrap, linkPairs);

      // Mount into header + overview
      topicSubtitle.innerHTML = leadNodes.length ? leadWrap.innerHTML : `<p>${escapeHtml(topic.description || "No summary available.")}</p>`;
      wikiArticle.innerHTML = bodyWrap.innerHTML || "<p>No further details available.</p>";

      // ToC (from body only)
      buildTOC(bodyWrap);

      // Field data (non-blocking, fires in background). Species-gated
      // panels need a binomial-shaped name to fire at all — resolve one
      // first for topics titled with a common name (e.g. "Tūī" →
      // "Prosthemadera novaeseelandiae") so those panels aren't silently
      // skipped just because the page title happens to use the common name.
      const baseTopicName = topic.display_name || humanName;
      const speciesName = await resolveSpeciesName(baseTopicName);
      loadFieldData(speciesName);
      loadGbifData(speciesName);
      loadInatData(speciesName);
      loadColData(speciesName);
      loadWormsData(speciesName);
      loadObisData(speciesName);
      loadIucnData(speciesName);
      loadEbirdData(speciesName);
      loadXenoCantoData(speciesName);
      // Tier 3 — beyond species pages (compounds, structures, exoplanets,
      // datasets) — these key off the page's own title, not the resolved
      // scientific name, since they're not species-specific.
      loadChemblData(baseTopicName);
      loadPdbData(baseTopicName);
      loadExoplanetData(baseTopicName);
      loadPangaeaData(baseTopicName);
      loadMaterialsData(baseTopicName);
      loadUniprotData(baseTopicName);
      loadWikidataData(baseTopicName); // also chains into loadEarthquakeData + loadGeonamesData when the entity has coordinates
      loadWorldBankData(baseTopicName);
      // Topic synthesis (non-blocking — only fires when Anthropic key is configured)
      loadTopicSynthesis(idTail);

      // References / people / infobox / trend
      renderRelated(topic);
      await loadReferences(idTail, wpTitle, lang, articleHTML);
      await loadTopPapers(idTail);
      await loadTopAuthors(idTail);
      const sortSel = $("topicSort");
      const orderSel = $("topicOrder");
      if (sortSel){ sortSel.addEventListener("change", ()=>loadTopPapers(idTail)); }
      if (orderSel){ orderSel.addEventListener("change", ()=>loadTopPapers(idTail)); }
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
      topicPeople.innerHTML = '<li class="muted">-</li>';
      relatedBlock.innerHTML = '<li class="muted">-</li>';
      infoboxDom.textContent = "-";
      trendSparkline.innerHTML = '<div class="muted">-</div>';
    }
  }

  loadTopic();
})();
