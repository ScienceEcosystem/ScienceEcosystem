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
            el.setAttribute("data-topic-id", decodeURIComponent(href.split("id=").pop() || ""));
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
    L.geoJSON(eooGeoJSON, {
      style: {
        color: "#c05b00",
        weight: 2,
        fillColor: "transparent",
        fillOpacity: 0,
        dashArray: "5 4",
      }
    }).addTo(map);
    const label = $("speciesMapLabel");
    if (label) label.textContent = "(GBIF occurrences · WoC native range boundary)";
  }

  async function initSpeciesMap(taxonKey) {
    const mapEl = $("speciesMapContainer");
    if (!mapEl) return null;

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

    // GBIF occurrence density tiles
    if (taxonKey) {
      L.tileLayer(
        `https://api.gbif.org/v2/map/occurrence/density/{z}/{x}/{y}@1x.png?taxonKey=${taxonKey}&style=classic.point`,
        {
          opacity: 0.85,
          maxZoom: 10,
          errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        }
      ).addTo(map);
    }

    // Add any WoC EOO that arrived before the map was ready
    if (_pendingEoo) { addEooToMap(map, _pendingEoo); _pendingEoo = null; }

    L.control.attribution({ prefix: false })
      .addAttribution('© <a href="https://www.naturalearthdata.com/">Natural Earth</a> | <a href="https://www.gbif.org">GBIF</a>')
      .addTo(map);

    map.setView([20, 10], 2);

    const mapSection = $("speciesMapSection");
    if (mapSection) mapSection.style.display = "";

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
      initSpeciesMap(d.taxon_key); // non-blocking — map loads while panel renders

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
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:#9ca3af;margin-top:.2rem;">
          <span>${oldest?.year || ""}</span>
          ${growthStr ? `<span style="color:#1fb8cd;font-weight:500;">${escapeHtml(growthStr)}</span>` : ""}
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
          <div style="display:flex;justify-content:space-between;font-size:.72rem;color:#9ca3af;margin-top:.2rem;">
            <span>${oldest?.year || ""}</span>
            ${growthStr ? `<span style="color:#16a34a;font-weight:500;">${escapeHtml(growthStr)}</span>` : ""}
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
      // Fallback: search by name — replace underscores with spaces so Wikipedia slugs match
      const searchTerm = idOrName.replace(/_/g, " ");
      try {
        const searchURL = `${API_OA}/concepts?search=${encodeURIComponent(searchTerm)}&per_page=1`;
        const data = await fetchOpenAlexJSON(searchURL);
        const c = data.results?.[0];
        if (c?.id) { idTail = tail(c.id); return c; }
      } catch (_) {}
      // Second fallback: Wikipedia search resolves common names → scientific names
      // e.g. "Red swamp crayfish" → "Procambarus clarkii"
      try {
        const wpUrl = "https://en.wikipedia.org/w/api.php?action=query&list=search"
          + "&srsearch=" + encodeURIComponent(searchTerm)
          + "&srlimit=3&format=json&origin=*";
        const wpData = await fetchOpenAlexJSON(wpUrl);
        const wpTitles = (wpData?.query?.search || []).map(r => r.title).filter(Boolean);
        for (const title of wpTitles) {
          if (title.toLowerCase() === searchTerm.toLowerCase()) continue;
          const altData = await fetchOpenAlexJSON(`${API_OA}/concepts?search=${encodeURIComponent(title)}&per_page=1`);
          const c = altData.results?.[0];
          if (c?.id) { idTail = tail(c.id); return c; }
        }
      } catch (_) {}
      // Last resort: return a stub so the Wikipedia article still loads
      if (isWikiSlug) {
        return { display_name: humanName, description: "", id: "", related_concepts: [], ancestors: [] };
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

      // Field data (non-blocking, fires in background)
      loadFieldData(topic.display_name || humanName);
      loadGbifData(topic.display_name || humanName);
      loadInatData(topic.display_name || humanName);
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
