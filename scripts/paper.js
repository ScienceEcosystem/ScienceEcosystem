// scripts/paper.js
(function () {
  if (!document.body || document.body.dataset.page !== "paper") return;

  // ---------- Constants & helpers ----------
  var API = "https://api.openalex.org";
  var MAILTO = "info@scienceecosystem.org";

  // Small allow-list of journals that publish open peer review routinely (you can tune this)
  var OPEN_PEER_REVIEW_JOURNALS = [
    "eLife",
    "F1000Research",
    "PeerJ",
    "Royal Society Open Science",
    "BMJ",
    "BMC",                   // many BMC titles have open peer review
    "Nature Communications", // some have open or transparent peer review
    "PLOS ONE",
    "PLOS Biology"
  ];

  // Repository/preprint indicators (peer review usually not done yet)
  var PREPRINT_VENUES = [
    "arXiv", "bioRxiv", "medRxiv", "ChemRxiv", "SSRN", "OSF Preprints", "PsyArXiv", "EarthArXiv", "Research Square"
  ];

  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function escapeHtml(str){ str = (str==null?"":String(str)); return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"})[c]; }); }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; } catch(e){ return fb; } }
  function idTailFrom(anyId){ return anyId ? String(anyId).replace(/^https?:\/\/openalex\.org\//i,"") : ""; }

  function addMailto(u){
    var url = new URL(u, API);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }

  async function getJSON(url){
    var withMt = url.indexOf(API) === 0 ? addMailto(url) : url;
    for (var attempt = 1; attempt <= 2; attempt++){
      try {
        var res = await fetch(withMt, { headers: { "Accept": "application/json" } });
        if (res.status === 429){
          var ra = parseInt(res.headers.get("Retry-After") || "1", 10);
          await new Promise(function(r){ setTimeout(r, Math.min(ra,5)*1000); });
          continue;
        }
        if (!res.ok) throw new Error(res.status + " " + res.statusText);
        return await res.json();
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise(function(r){ setTimeout(r, 500); });
      }
    }
    throw new Error("Unreachable");
  }

  function normalizePaperId(raw){
    if (!raw) return "";
    var s = raw;
    try { s = decodeURIComponent(s); } catch(e){}
    s = s.trim();
    if (s.indexOf("/") !== -1 && s.indexOf("openalex.org/") !== -1) {
      s = s.split("/").filter(Boolean).pop(); // W...
    }
    var doiMatch = s.match(/10\.\d{4,9}\/\S+/i);
    if (doiMatch) {
      var doi = doiMatch[0].replace(/[">)\]]+$/g, "");
      return "doi:" + doi;
    }
    if (/^doi:/i.test(s)) return s;
    if (/^10\.\d{4,9}\/\S+/i.test(s)) return "doi:" + s;
    return s;
  }

  function normalizeDOI(input){
    if (!input) return "";
    var x = String(input).trim();
    x = x.replace(/^https?:\/\/(dx\.)?doi\.org\//i,"");
    x = x.replace(/^doi:/i,"");
    return x;
  }

  // ---------- Tiny cache (localStorage) ----------
  var CACHE_PREFIX = "se_refmap_v1:";
  var CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

  function cacheKey(idTail){ return CACHE_PREFIX + idTail; }
  function cacheSet(idTail, setArr){
    try{
      var payload = { t: Date.now(), refs: Array.from(setArr||[]) };
      localStorage.setItem(cacheKey(idTail), JSON.stringify(payload));
    }catch(e){}
  }
  function cacheGet(idTail){
    try{
      var raw = localStorage.getItem(cacheKey(idTail));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.t || !Array.isArray(parsed.refs)) return null;
      if (Date.now() - parsed.t > CACHE_TTL_MS) return null;
      return new Set(parsed.refs);
    }catch(e){ return null; }
  }

  // ---------- Data fetchers ----------
  async function fetchPaperData(paperId){
    var id = normalizePaperId(paperId);
    var url = API + "/works/" + encodeURIComponent(id);
    return await getJSON(url);
  }

  async function fetchCitedPapers(refs){
    if (!Array.isArray(refs) || !refs.length) return [];
    var ids = refs.slice(0, 20).map(function(id){
      var tail = id.split("/").pop();
      return "https://openalex.org/" + tail;
    }).join("|");
    var url = API + "/works?filter=ids.openalex:" + encodeURIComponent(ids) + "&per_page=20";
    var data = await getJSON(url);
    return Array.isArray(data.results) ? data.results : [];
  }

  async function fetchCitingPapers(paperOpenAlexIdOrUrl){
    var s = String(paperOpenAlexIdOrUrl || "");
    var idTail = s.replace(/^https?:\/\/openalex\.org\//i, "");
    var url = API + "/works?filter=cites:" + encodeURIComponent(idTail) + "&per_page=200";
    var data = await getJSON(url);
    return Array.isArray(data.results) ? data.results : [];
  }

  async function fetchSourceFromPaper(p){
    var srcId = get(p, "host_venue.id", null) || get(p, "primary_location.source.id", null);
    if (!srcId) return null;
    var tail = srcId.split("/").pop();
    var url = API + "/sources/" + encodeURIComponent(tail);
    try { return await getJSON(url); } catch(e){ console.warn("source fetch failed", e); return null; }
  }

  // ---------- Phase 1: Deterministic Research-Object harvesters ----------
  async function fetchCrossrefRelations(doi){
    if (!doi) return [];
    var url = "https://api.crossref.org/works/" + encodeURIComponent(doi);
    try{
      var data = await getJSON(url);
      var rel = get(data, "message.relation", {}) || {};
      var out = [];
      Object.keys(rel).forEach(function(k){
        var arr = Array.isArray(rel[k]) ? rel[k] : [];
        arr.forEach(function(r){
          out.push({
            provenance: "Crossref",
            relationType: k,
            id: get(r,"id", null) || get(r,"id-type", null) || null,
            "id-type": get(r,"id-type", null) || null,
            "asserted-by": get(r,"asserted-by", null) || null,
            "DOI": get(r,"DOI", null) || null,
            "url": get(r,"url", null) || null
          });
        });
      });
      return out;
    }catch(e){
      console.warn("Crossref failed", e);
      return [];
    }
  }

  async function fetchDataCiteBacklinks(doi){
    if (!doi) return [];
    var q = 'relatedIdentifiers.identifier:"' + doi.replace(/"/g,'\\"') + '"';
    var url = "https://api.datacite.org/works?query=" + encodeURIComponent(q) + "&page[size]=100";
    try{
      var data = await getJSON(url);
      var hits = Array.isArray(get(data,"data",[])) ? data.data : [];
      return hits.map(function(rec){
        var attrs = rec.attributes || {};
        var typeGen = get(attrs,"types.resourceTypeGeneral","") || "";
        var title = (Array.isArray(attrs.titles) && attrs.titles[0] && attrs.titles[0].title) ? attrs.titles[0].title : (attrs.title || "Untitled");
        var doiR = attrs.doi || attrs.identifier || "";
        var urlR = attrs.url || (attrs.doi ? ("https://doi.org/"+attrs.doi) : "");
        return {
          provenance: "DataCite",
          type: typeGen,
          title: title,
          doi: doiR,
          url: urlR,
          repository: (attrs.publisher || attrs.container || get(attrs,"container.title","") || "").toString()
        };
      });
    }catch(e){
      console.warn("DataCite failed", e);
      return [];
    }
  }

  async function fetchZenodoBacklinks(doi){
    if (!doi) return [];
    var es = 'related.identifiers.identifier:"' + doi.replace(/"/g,'\\"') + '"';
    var url1 = "https://zenodo.org/api/records/?q=" + encodeURIComponent(es) + "&size=100";
    var url2 = "https://zenodo.org/api/records/?q=" + encodeURIComponent('metadata.related_identifiers.identifier:"'+doi.replace(/"/g,'\\"')+'"') + "&size=100";
    try{
      var a = await getJSON(url1);
      var hits = Array.isArray(a.hits && a.hits.hits) ? a.hits.hits : [];
      if (!hits.length){
        var b = await getJSON(url2);
        hits = Array.isArray(b.hits && b.hits.hits) ? b.hits.hits : [];
      }
      return hits.map(function(h){
        var md = h.metadata || {};
        var typeGen = (get(md,"resource_type.type","") || "").toLowerCase();
        var guessType = typeGen.includes("software") ? "Software" : (typeGen.includes("dataset") ? "Dataset" : (get(md,"resource_type.title","") || "Other"));
        var title = md.title || "Untitled";
        var doiZ = md.doi || (h.doi) || "";
        var urlZ = h.links && h.links.html ? h.links.html : (doiZ ? "https://doi.org/"+doiZ : "");
        return {
          provenance: "Zenodo",
          type: guessType,
          title: title,
          doi: doiZ || "",
          url: urlZ,
          repository: "Zenodo",
          version: md.version || "",
          licence: (md.license && (md.license.id || md.license)) || ""
        };
      });
    }catch(e){
      console.warn("Zenodo failed", e);
      return [];
    }
  }

  function classifyROKind(str){
    var s = String(str||"").toLowerCase();
    if (s.includes("software")) return "Software";
    if (s.includes("code")) return "Software";
    if (s.includes("dataset")) return "Dataset";
    if (s.includes("data")) return "Dataset";
    return "Other";
  }

  function uniqueByKey(arr, keyFn){
    var seen = Object.create(null);
    var out = [];
    for (var i=0;i<arr.length;i++){
      var k = keyFn(arr[i]);
      if (!k || seen[k]) continue;
      seen[k] = true;
      out.push(arr[i]);
    }
    return out;
  }

  async function harvestDeterministicResearchObjects(paper){
    var doi = normalizeDOI(paper.doi || get(paper,"ids.doi",""));
    if (!doi) return { items: [], errors: [] };

    var errors = [];
    var all = [];

    try{
      var cr = await fetchCrossrefRelations(doi);
      cr.forEach(function(r){
        var rid = r.DOI || r.id || "";
        var url = r.url || (rid ? ("https://doi.org/"+rid) : "");
        var kind = classifyROKind(r.relationType || r["id-type"] || "");
        if (!rid && !url) return;
        all.push({
          provenance: "Crossref",
          type: kind,
          title: rid || (r.relationType+" item"),
          doi: rid || "",
          url: url || "",
          repository: "",
          relationType: r.relationType
        });
      });
    }catch(e){ errors.push("Crossref: "+e.message); }

    try{
      var dc = await fetchDataCiteBacklinks(doi);
      dc.forEach(function(r){
        all.push({
          provenance: r.provenance,
          type: classifyROKind(r.type),
          title: r.title,
          doi: r.doi || "",
          url: r.url || (r.doi ? "https://doi.org/"+r.doi : ""),
          repository: r.repository || "DataCite"
        });
      });
    }catch(e){ errors.push("DataCite: "+e.message); }

    try{
      var z = await fetchZenodoBacklinks(doi);
      z.forEach(function(r){
        all.push({
          provenance: r.provenance,
          type: classifyROKind(r.type),
          title: r.title,
          doi: r.doi || "",
          url: r.url || (r.doi ? "https://doi.org/"+r.doi : ""),
          repository: r.repository || "Zenodo",
          version: r.version || "",
          licence: r.licence || ""
        });
      });
    }catch(e){ errors.push("Zenodo: "+e.message); }

    var dedup = uniqueByKey(all, function(x){
      return (x.doi && x.doi.toLowerCase()) || (x.title.toLowerCase()+"|"+(x.url||"").toLowerCase());
    });

    var provRank = { DataCite: 3, Zenodo: 2, Crossref: 1 };
    dedup.sort(function(a,b){
      var ta = (a.type==="Dataset"||a.type==="Software") ? 1 : 0;
      var tb = (b.type==="Dataset"||b.type==="Software") ? 1 : 0;
      if (ta!==tb) return tb - ta;
      var pa = provRank[a.provenance] || 0;
      var pb = provRank[b.provenance] || 0;
      if (pa!==pb) return pb - pa;
      return (a.title||"").localeCompare(b.title||"");
    });

    return { items: dedup, errors: errors };
  }

  // ---------- Formatting helpers ----------
  function authorLinksList(authorships){
    if (!Array.isArray(authorships) || !authorships.length) return { allHtml:"Unknown authors", shortHtml:"Unknown authors", moreCount:0 };
    var out = [];
    for (var i=0;i<authorships.length;i++){
      var id = get(authorships[i],"author.id",null);
      var name = escapeHtml(get(authorships[i],"author.display_name","Unknown"));
      if (!id) { out.push(name); continue; }
      var aid = id.split("/").pop();
      out.push('<a href="profile.html?id='+aid+'">'+name+'</a>');
    }
    var short = out.slice(0,8);
    return { allHtml: out.join(", "), shortHtml: short.join(", "), moreCount: Math.max(0, out.length - short.length) };
  }

  function collectInstitutions(authorships){
    var map = Object.create(null);
    var out = [];
    if (!Array.isArray(authorships)) return out;

    for (var i=0;i<authorships.length;i++){
      var insts = Array.isArray(authorships[i].institutions) ? authorships[i].institutions : [];
      for (var j=0;j<insts.length;j++){
        var nm = get(insts[j], "display_name", null);
        if (!nm) continue;
        var id = get(insts[j], "id", null);
        var tail = id ? String(id).replace(/^https?:\/\/openalex\.org\//i, "") : null;
        var key = tail || ("name:" + nm.toLowerCase());
        if (!map[key]){
          map[key] = true;
          out.push({ name: nm, idTail: tail });
        }
      }
    }
    return out;
  }
  function institutionsLinksHTML(authorships){
    var list = collectInstitutions(authorships);
    if (!list.length) {
      return { shortHtml: "—", allHtml: "—", moreCount: 0 };
    }
    function render(item){
      if (item.idTail) return '<a href="institute.html?id='+encodeURIComponent(item.idTail)+'">'+escapeHtml(item.name)+'</a>';
      return escapeHtml(item.name);
    }
    var short = list.slice(0,8).map(render).join(", ");
    var full  = list.map(render).join(", ");
    return { shortHtml: short, allHtml: full, moreCount: Math.max(0, list.length - 8) };
  }

  function formatAbstract(idx){
    if (!idx || typeof idx !== "object") return "<em>No abstract available.</em>";
    var words = [];
    Object.keys(idx).forEach(function(word){
      var positions = idx[word] || [];
      for (var i=0;i<positions.length;i++){ words[positions[i]] = word; }
    });
    return escapeHtml(words.join(" ") || "");
  }

  function badge(href, text, className){
    if (!href) return "";
    return '<a class="badge ' + (className||"") + '" href="'+href+'" target="_blank" rel="noopener">'+escapeHtml(text)+'</a>';
  }

  var __CURRENT_PAPER__ = null;
  var __HEADER_HTML_SNAPSHOT__ = null;
  window.__GRAPH_CTX__ = { main: null, cited: [], citing: [] };

  function restoreHeaderIfNeeded() {
    var hdr = document.getElementById("paperHeaderMain");
    if (!hdr) {
      var mount = document.getElementById("paperHeader");
      if (!mount) return;
      var newDiv = document.createElement("div");
      newDiv.id = "paperHeaderMain";
      mount.prepend(newDiv);
      hdr = newDiv;
    }
    var isEmpty = !hdr.firstElementChild && (!hdr.textContent || hdr.textContent.trim()==="");
    if (isEmpty && __HEADER_HTML_SNAPSHOT__) {
      hdr.innerHTML = __HEADER_HTML_SNAPSHOT__;
      wireHeaderToggles();
    }
  }

  // ---------- Quality helper utilities ----------
  function doiFromWork(p){
    var doiRaw = p.doi || get(p,"ids.doi",null);
    if (!doiRaw) return null;
    return String(doiRaw).replace(/^doi:/i,"");
  }
  function pubPeerLink(doi){ return doi ? ("https://pubpeer.com/search?q=" + encodeURIComponent(doi)) : null; }
  function retractionSearchLinks(doi, title){
    var links = [];
    if (doi) links.push({ label: "Search Retraction Watch", href: "https://retractionwatch.com/?s=" + encodeURIComponent(doi) });
    if (title) links.push({ label: "Search by title", href: "https://retractionwatch.com/?s=" + encodeURIComponent(title) });
    return links;
  }
  function isPreprintVenue(name, type){
    name = String(name || "").toLowerCase();
    type = String(type || "").toLowerCase();
    if (type.includes("repository") || type.includes("preprint")) return true;
    for (var i=0;i<PREPRINT_VENUES.length;i++){
      if (name.includes(PREPRINT_VENUES[i].toLowerCase())) return true;
    }
    return false;
  }
  function hasOpenPeerReview(journalName){
    var nm = String(journalName || "").toLowerCase();
    for (var i=0;i<OPEN_PEER_REVIEW_JOURNALS.length;i++){
      if (nm.includes(OPEN_PEER_REVIEW_JOURNALS[i].toLowerCase())) return true;
    }
    return false;
  }
  function detectCorrections(title){
    var t = String(title || "").toLowerCase();
    return /(correction|corrigendum|erratum)/i.test(t);
  }
  function detectReplicationSignals(title, abstractText){
    var t = (String(title || "") + " " + String(abstractText || "")).toLowerCase();
    return /(replication|reproduc(?:e|ibility)|reanalysis|robustness check)/i.test(t);
  }

  // Conservative journal scoring (1–5)
  function computeJournalScore(src){
    var score = 3;
    if (get(src, "is_in_doaj", false)) score += 1;
    if (get(src, "is_oa", false)) score += 1;

    var works = +get(src, "works_count", 0) || 0;
    if (works > 10000) score += 1;
    if (works < 100) score -= 1;

    var type = String(get(src, "type", "") || "").toLowerCase();
    if (type.includes("repository") || type.includes("preprint")) score = Math.max(1, score - 2);

    if (score < 1) score = 1;
    if (score > 5) score = 5;
    return score;
  }
  function scoreExplanation(src){
    var bits = [];
    if (get(src, "is_in_doaj", false)) bits.push("Indexed in DOAJ (+1)");
    if (get(src, "is_oa", false)) bits.push("Open access journal (+1)");
    var works = +get(src, "works_count", 0) || 0;
    if (works > 10000) bits.push("Large output (>10k works) (+1)");
    if (works < 100) bits.push("Very small output (<100 works) (−1)");
    var type = String(get(src, "type", "") || "").toLowerCase();
    if (type.includes("repository") || type.includes("preprint")) bits.push("Repository/preprint venue (−2)");
    if (!bits.length) bits.push("Neutral baseline");
    return bits.join(" · ");
  }

  // NEW: star HTML with hover tooltip explaining the heuristic
  function journalScoreStarsHTML(score, src){
    const bullets = [
      get(src, "is_in_doaj", false) ? "In DOAJ (+1)" : null,
      get(src, "is_oa", false) ? "OA journal (+1)" : null,
      (+get(src,"works_count",0) > 10000) ? "Large output (+1)" : null,
      (String(get(src,"type","")).toLowerCase().includes("repository") || String(get(src,"type","")).toLowerCase().includes("preprint")) ? "Repository/preprint (−2)" : null
    ].filter(Boolean).join(" · ");
    const base = bullets || "Neutral baseline";
    const how = "Heuristic: DOAJ/OA, venue size, repository/preprint penalty.";
    const title = `Journal score: ${score}/5\n${base}\n${how}`;
    return `<span class="stars" aria-label="Journal score ${score} out of 5" title="${escapeHtml(title)}">
      ${"★".repeat(score)}${"☆".repeat(5-score)}
    </span>`;
  }

  function computePaperMillRiskScore(source, p){
    var score = 0;
    var venueType = String(get(source, "type", get(p, "primary_location.source.type", "")) || "").toLowerCase();
    var journalLike = venueType.includes("journal");
    var works = +get(source, "works_count", 0) || 0;
    var doaj = !!get(source, "is_in_doaj", false);
    var oaJournal = !!get(source, "is_oa", false);
    var homepage = get(source, "homepage_url", null) || "";

    if (journalLike && oaJournal && !doaj) score += 1;
    if (journalLike && works > 0 && works < 150) score += 1;
    if (journalLike && !homepage) score += 1;

    var pubYear = +get(p, "publication_year", 0) || 0;
    var citedBy = +get(p, "cited_by_count", 0) || 0;
    var refCount = Array.isArray(p.referenced_works) ? p.referenced_works.length : 0;
    var nowYear = (new Date()).getFullYear();
    if (refCount > 0 && refCount < 10) score += 1;
    if (pubYear && (nowYear - pubYear) >= 3 && citedBy === 0) score += 1;

    var title = String(p.display_name || "").toLowerCase();
    if (title.includes("special issue")) score += 1;

    if (score < 0) score = 0;
    if (score > 5) score = 5;
    return score;
  }
  function riskLabel(score){
    if (score >= 4) return { text: "High (heuristic)", cls: "risk-high" };
    if (score >= 2) return { text: "Medium (heuristic)", cls: "risk-med" };
    return { text: "Low (heuristic)" , cls: "risk-low" };
  }
  function computeExpectedPaperQuality(source, p){
    var isRetracted = !!get(p, "is_retracted", false);
    var journalScore = computeJournalScore(source || {});
    var doaj = !!get(source, "is_in_doaj", false);
    var oaJournal = !!get(source, "is_oa", false);
    var venueName = get(source, "display_name", get(p, "host_venue.display_name", ""));
    var hasOPR = hasOpenPeerReview(venueName);
    var citedBy = +get(p, "cited_by_count", 0) || 0;
    var refCount = Array.isArray(p.referenced_works) ? p.referenced_works.length : 0;

    var locs = Array.isArray(p.locations) ? p.locations : [];
    var dataCount = 0, codeCount = 0;
    for (var i=0;i<locs.length;i++){
      var t = (get(locs[i], 'source.type', '') || '').toLowerCase();
      if (t.indexOf('dataset') !== -1) dataCount++;
      if (t.indexOf('software') !== -1) codeCount++;
    }

    var title = p.display_name || "";
    var abstractPlain = (function(idx){
      if (!idx || typeof idx !== "object") return "";
      var words = [];
      Object.keys(idx).forEach(function(word){
        var positions = idx[word] || [];
        for (var i=0;i<positions.length;i++){ words[positions[i]] = word; }
      });
      return (words.join(" ") || "");
    })(p.abstract_inverted_index);

    var isPreprint = isPreprintVenue(venueName, get(source,'type',''));
    var hasReplication = detectReplicationSignals(title, abstractPlain);

    if (isRetracted) return { level: "Low", explain: "Retracted article." };
    if (isPreprint)  return { level: "Unrated", explain: "Preprint: typically not yet peer reviewed." };

    var points = 0;
    if (journalScore >= 4) points += 2;
    if (doaj) points += 1;
    if (oaJournal) points += 0;
    if (hasOPR) points += 1;
    if (citedBy >= 20) points += 1;
    var pubYear = +get(p,"publication_year",0) || 0;
    var nowYear = (new Date()).getFullYear();
    if (pubYear && (nowYear - pubYear) >= 2 && citedBy >= 5) points += 1;
    if ((dataCount + codeCount) > 0) points += 1;
    if (hasReplication) points += 1;
    if (refCount >= 30) points += 1;
    if (refCount > 0 && refCount < 10) points -= 1;

    var pmScore = computePaperMillRiskScore(source, p);
    if (pmScore >= 4) points -= 3;
    else if (pmScore >= 2) points -= 1;

    var level = "Medium";
    if (points >= 3) level = "High";
    if (points <= -1) level = "Low";

    var parts = [];
    parts.push("Journal score: " + journalScore + "/5");
    if (doaj) parts.push("DOAJ indexed");
    if (hasOPR) parts.push("Open/transparent peer review");
    if ((dataCount + codeCount) > 0) parts.push("Research objects linked");
    if (hasReplication) parts.push("Replication/reanalysis signal");
    parts.push("Citations: " + citedBy);
    parts.push("References: " + refCount);
    parts.push("Paper-mill risk: " + riskLabel(pmScore).text);

    return { level: level, explain: parts.join(" · ") };
  }

  function sourceTailFromPaper(p){
    var srcId = get(p, "host_venue.id", null) || get(p, "primary_location.source.id", null);
    return srcId ? idTailFrom(srcId) : "";
  }

  // ---------- Header content ----------
  function buildHeaderMain(p){
    var title = p.display_name || "Untitled";
    var year  = (p.publication_year != null ? p.publication_year : "n.d.");
    var venue = get(p, "host_venue.display_name", null) || get(p, "primary_location.source.display_name", null) || "Unknown venue";
    var sourceTail = sourceTailFromPaper(p);
    var venueHtml = sourceTail
      ? '<a href="journal.html?id='+encodeURIComponent(sourceTail)+'">'+escapeHtml(venue)+'</a>'
      : escapeHtml(venue);

    var doiRaw = p.doi || get(p,"ids.doi",null);
    var doiUrl = doiRaw ? (String(doiRaw).indexOf("http")===0 ? doiRaw : ("https://doi.org/" + String(doiRaw).replace(/^doi:/i,""))) : null;

    var oaPdf = get(p,"best_oa_location.url_for_pdf",null) || get(p,"primary_location.pdf_url",null);
    var oaLanding = get(p,"open_access.oa_url",null) || get(p,"best_oa_location.url",null) || get(p,"primary_location.landing_page_url",null);

    var chips = [
      badge(doiUrl, "DOI"),
      badge(oaPdf, "PDF", "badge-oa"),
      badge(oaLanding, "Open access", "badge-oa"),
      badge(p.id, "OpenAlex")
    ];

    var doiClean = doiFromWork(p);
    var pp = pubPeerLink(doiClean);
    if (pp) chips.push(badge(pp, "PubPeer", "badge-neutral"));

    var rw = retractionSearchLinks(doiClean, p.display_name || "");
    if (rw.length) chips.push(badge(rw[0].href, "Retraction search", "badge-warn"));

    var aList = authorLinksList(p.authorships);
    var affList = institutionsLinksHTML(p.authorships);

    return (
      '<h1 class="paper-title">'+escapeHtml(title)+'</h1>' +
      '<p class="meta"><span class="muted">'+escapeHtml(String(year))+'</span> · <strong>Published in:</strong> '+venueHtml+'</p>' +
      '<p class="meta-row"><strong>Authors:</strong> ' +
        '<span class="wrap-text" id="authorsShort">'+aList.shortHtml+(aList.moreCount?(' <button class="link-btn" id="authorsShowMore">Show more</button>'):'')+'</span>' +
        '<span class="wrap-text" id="authorsFull" style="display:none;">'+aList.allHtml+' <button class="link-btn" id="authorsShowLess">Show less</button></span>' +
      '</p>' +
      '<p class="meta-row"><strong>Affiliations:</strong> ' +
        '<span class="wrap-text" id="affShort">'+affList.shortHtml+(affList.moreCount?(' <button class="link-btn" id="affShowMore">Show more</button>'):'')+'</span>' +
        '<span class="wrap-text" id="affFull" style="display:none;">'+affList.allHtml+' <button class="link-btn" id="affShowLess">Show less</button></span>' +
      '</p>' +
      '<p class="chips">'+chips.filter(Boolean).join(" ")+'</p>'
    );
  }

  function wireHeaderToggles(){
    var asMore = $("authorsShowMore"), asLess = $("authorsShowLess");
    var afMore = $("affShowMore"), afLess = $("affShowLess");
    if (asMore) asMore.onclick = function(){ $("authorsShort").style.display="none"; $("authorsFull").style.display="inline"; };
    if (asLess) asLess.onclick = function(){ $("authorsFull").style.display="none"; $("authorsShort").style.display="inline"; };
    if (afMore) afMore.onclick = function(){ $("affShort").style.display="none"; $("affFull").style.display="inline"; };
    if (afLess) afLess.onclick = function(){ $("affFull").style.display="none"; $("affShort").style.display="inline"; };
  }

  function collectCiteDataForHeader(work){
    var venue = get(work,"host_venue.display_name",null) || get(work,"primary_location.source.display_name","") || "";
    var doiRaw = work.doi || get(work,"ids.doi",null);
    var doiClean = doiRaw ? String(doiRaw).replace(/^doi:/i,"") : "";
    var doiHref = doiClean ? (doiClean.indexOf("http")===0 ? doiClean : ("https://doi.org/" + doiClean)) : "";
    var first_page = get(work,"biblio.first_page","") || "";
    var last_page  = get(work,"biblio.last_page","") || "";
    var pages = (first_page && last_page) ? (first_page + "-" + last_page) : (first_page || last_page || "");
    var authors = (get(work,"authorships",[])||[]).map(function(a){ return get(a,"author.display_name",""); }).filter(Boolean);
    return { title: work.display_name || work.title || "Untitled", year: (work.publication_year != null ? String(work.publication_year) : "n.d."),
      venue: venue, volume: get(work,"biblio.volume","") || "", issue: get(work,"biblio.issue","") || "", pages: pages,
      doi: doiClean, doi_url: doiHref, url: get(work,"primary_location.landing_page_url","") || doiHref || (work.id || ""), authors: authors };
  }

  function buildActionsBar(p){
    var idTail = String(p.id||"").replace(/^https?:\/\/openalex\.org\//i,"");
    var doi = p.doi || get(p,"ids.doi",null) || "";
    var citeData = collectCiteDataForHeader(p);
    function attr(v){ return v ? escapeHtml(String(v)) : ""; }

    return ''+
      '<article class="paper-card header-card" ' +
        'data-paper-id="'+attr(idTail)+'" '+
        (doi ? 'data-doi="'+attr(String(doi).replace(/^doi:/i,""))+'"' : '') +
        'data-cite-title="'+attr(citeData.title)+'" '+
        'data-cite-year="'+attr(citeData.year)+'" '+
        'data-cite-venue="'+attr(citeData.venue)+'" '+
        'data-cite-volume="'+attr(citeData.volume)+'" '+
        'data-cite-issue="'+attr(citeData.issue)+'" '+
        'data-cite-pages="'+attr(citeData.pages)+'" '+
        'data-cite-doi="'+attr(citeData.doi)+'" '+
        'data-cite-doiurl="'+attr(citeData.doi_url)+'" '+
        'data-cite-url="'+attr(citeData.url)+'" '+
        'data-cite-authors="'+attr((citeData.authors||[]).join(' | '))+'">'+
          '<div class="header-actions-inner">'+
            '<button class="btn btn-secondary btn-save" data-action="save-paper" aria-label="Add to Library">Add to Library</button>'+
            '<button class="btn btn-secondary btn-cite" data-action="open-cite" aria-haspopup="dialog" aria-expanded="false">Cite</button>'+
            '<div class="cite-popover" role="dialog" aria-label="Cite this paper" hidden '+
              'style="position:absolute; z-index:9999; max-width:640px; width:min(92vw,640px); box-shadow:0 8px 24px rgba(0,0,0,.18); border:1px solid #e5e7eb; border-radius:12px; background:#fff; padding:12px;"></div>'+
          '</div>'+
      '</article>';
  }

  function buildStatsHeader(p){
    var citedBy = get(p,'cited_by_count',0) || 0;
    var refCount = Array.isArray(p.referenced_works) ? p.referenced_works.length : 0;
    var socialOrNews = "—";

    function stat(label, value){
      return '<div class="stat"><div class="stat-value">'+escapeHtml(String(value))+'</div><div class="stat-label">'+escapeHtml(label)+'</div></div>';
    }
    return stat('Cited by', citedBy) + stat('References used', refCount) + stat('Shared in news / social', socialOrNews);
  }

  // ---------- Journal & Quality block ----------
  function renderJournalBlock(p, source){
    var journalName = get(source, 'display_name', null) || get(p, 'host_venue.display_name', null) || get(p, 'primary_location.source.display_name', '—');
    var venueType  = get(source, 'type', get(p, 'primary_location.source.type', '—'));
    var publisher  = get(source, 'publisher', '—');
    var issn_l     = get(source, 'issn_l', null);
    var issns      = Array.isArray(get(source, 'issn', [])) ? get(source, 'issn', []) : [];
    var doaj       = !!get(source, 'is_in_doaj', false);
    var oaJournal  = !!get(source, 'is_oa', false);
    var homepage   = get(source, 'homepage_url', null);
    var srcOpenAlex= get(source, 'id', null);

    var citedBy    = get(p, 'cited_by_count', 0);
    var refCount   = Array.isArray(p.referenced_works) ? p.referenced_works.length : 0;
    var isRetracted= !!get(p, 'is_retracted', false);

    var locs = Array.isArray(p.locations) ? p.locations : [];
    var dataCount = 0, codeCount = 0;
    for (var i=0;i<locs.length;i++){
      var t = (get(locs[i], 'source.type', '') || '').toLowerCase();
      if (t.indexOf('dataset') !== -1) dataCount++;
      if (t.indexOf('software') !== -1) codeCount++;
    }

    var title = p.display_name || "";
    var abstractPlain = (function(idx){
      if (!idx || typeof idx !== "object") return "";
      var words = [];
      Object.keys(idx).forEach(function(word){
        var positions = idx[word] || [];
        for (var i=0;i<positions.length;i++){ words[positions[i]] = word; }
      });
      return (words.join(" ") || "");
    })(p.abstract_inverted_index);

    var hasCorrection = detectCorrections(title);
    var hasReplication = detectReplicationSignals(title, abstractPlain);

    var isPreprint = isPreprintVenue(journalName, venueType);
    var peerReviewText = isPreprint
      ? "Preprint / repository — typically not peer reviewed yet"
      : (hasOpenPeerReview(journalName)
          ? "Journal with open/transparent peer review"
          : "Journal article — peer review likely (not verified)");

    var doi = doiFromWork(p);
    var pubpeer = pubPeerLink(doi);
    var rwLinks = retractionSearchLinks(doi, title);

    var score = computeJournalScore(source || {});
    var scoreExplain = scoreExplanation(source || {});

    var pmScore = computePaperMillRiskScore(source || {}, p || {});
    var pm = riskLabel(pmScore);
    var exp = computeExpectedPaperQuality(source || {}, p || {});

    var sourceTail = source ? idTailFrom(source.id) : sourceTailFromPaper(p);
    var journalLinkHtml = sourceTail
      ? '<a href="journal.html?id='+encodeURIComponent(sourceTail)+'">'+escapeHtml(journalName)+'</a>'
      : escapeHtml(journalName);

    var lines = [];
    lines.push(
      '<p><strong>Journal:</strong> '+journalLinkHtml
      + (homepage?(' · <a href="'+homepage+'" target="_blank" rel="noopener">Homepage</a>'):'')
      + (srcOpenAlex?(' · <a href="'+srcOpenAlex+'" target="_blank" rel="noopener">OpenAlex</a>'):'')
      + '</p>'
    );

    lines.push('<p class="meta"><strong>Type:</strong> '+escapeHtml(String(venueType||'—'))+' · <strong>Publisher:</strong> '+escapeHtml(String(publisher||'—'))+'</p>');

    // Badges row (keep PubPeer & Retraction Watch)
    var badges = [];
    badges.push('<span class="badge '+(oaJournal?'badge-oa':'')+'">'+(oaJournal?'OA journal':'Closed / Hybrid')+'</span>');
    badges.push('<span class="badge">'+(doaj?'In DOAJ':'Not in DOAJ')+'</span>');
    if (get(p,'host_venue.is_oa',false)) badges.push('<span class="badge badge-oa">This article OA</span>');
    if (isRetracted) badges.push('<span class="badge badge-warn">Retracted</span>');
    if (pubpeer) badges.push('<a class="badge" href="'+pubpeer+'" target="_blank" rel="noopener">PubPeer</a>');
    if (rwLinks.length) badges.push('<a class="badge badge-warn" href="'+rwLinks[0].href+'" target="_blank" rel="noopener">Retraction search</a>');
    badges.push('<span class="badge" title="'+escapeHtml(scoreExplain)+'">Journal score: '+score+'/5</span>');
    badges.push('<span class="badge '+escapeHtml(pm.cls)+'" title="Screening signals only; not a definitive claim.">Paper-mill risk: '+escapeHtml(pm.text)+'</span>');
    badges.push('<span class="badge" title="'+escapeHtml(exp.explain)+'">Expected quality: '+escapeHtml(exp.level)+'</span>');
    lines.push('<p class="chips">'+badges.join(' ')+'</p>');

    // Visual row with stars (now with tooltip) + notes
    lines.push(
      '<div class="panel light" style="margin-top:.5rem;">' +
        '<div style="display:flex; align-items:center; gap:.5rem; flex-wrap:wrap;">' +
          '<strong>Journal score (beta):</strong> ' +
            journalScoreStarsHTML(score, source || {}) +
          '<span class="muted">('+score+'/5)</span>' +
          '<span style="margin-left:.5rem;">·</span>' +
          '<strong>Paper-mill screen:</strong> <span class="'+escapeHtml(pm.cls)+'" title="Screening signals only; not a definitive claim.">'+escapeHtml(pm.text)+'</span>' +
          '<span style="margin-left:.5rem;">·</span>' +
          '<strong>Expected quality:</strong> <span title="'+escapeHtml(exp.explain)+'">'+escapeHtml(exp.level)+'</span>' +
        '</div>' +
        '<p class="muted" style="margin:.25rem 0 0 .1rem;">' +
          'These are heuristics for orientation. Use PubPeer and Retraction Watch searches above for community and editorial signals.' +
        '</p>' +
      '</div>'
    );

    var peerReviewNote = isPreprint
      ? 'Preprints are valuable for speed but typically lack formal peer review. Check PubPeer for discussion.'
      : (hasOpenPeerReview(journalName) ? 'This journal often exposes peer-review reports (open/transparent peer review).' : 'Peer-review details vary by journal.');
    lines.push('<p class="muted" style="margin-top:.25rem;">'+escapeHtml(peerReviewNote)+'</p>');

    var styleId = "se-quality-inline-style";
    if (!document.getElementById(styleId)){
      var st = document.createElement("style");
      st.id = styleId;
      st.textContent = ''+
        '.badge.risk-low{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}' +
        '.badge.risk-med{background:#fffbeb;color:#92400e;border:1px solid #fde68a}' +
        '.badge.risk-high{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}';
      document.head.appendChild(st);
    }

    $("journalBlock").innerHTML = lines.join("");
  }

  // ---------- Graph helpers ----------
  function shortCitation(p){
    var first = get(p,"authorships.0.author.display_name","Unknown");
    var last = first.split(" ").slice(-1)[0] || first || "Unknown";
    var yr = (p.publication_year != null ? p.publication_year : "n.d.");
    return last + " et al., " + yr;
  }

  function hsvToHex(h, s, v){
    var c = v * s;
    var x = c * (1 - Math.abs(((h/60)%2) - 1));
    var m = v - c;
    var r=0,g=0,b=0;
    if (0<=h && h<60){ r=c; g=x; b=0; }
    else if (60<=h && h<120){ r=x; g=c; b=0; }
    else if (120<=h && h<180){ r=0; g=c; b=x; }
    else if (180<=h && h<240){ r=0; g=x; b=c; }
    else if (240<=h && h<300){ r=x; g=0; b=c; }
    else { r=c; g=0; b=x; }
    var R = Math.round((r+m)*255).toString(16).padStart(2,"0");
    var G = Math.round((g+m)*255).toString(16).padStart(2,"0");
    var B = Math.round((b+m)*255).toString(16).padStart(2,"0");
    return "#" + R + G + B;
  }

  function yearColor(year, minY, maxY){
    if (!year || !minY || !maxY || minY===maxY) return "#6b7280";
    var t = (year - minY) / (maxY - minY);
    var h = (1 - t) * 220; // blue->green
    return hsvToHex(h, 0.55, 0.95);
  }

  function jaccard(aSet, bSet){
    var inter = 0;
    aSet.forEach(function(x){ if (bSet.has(x)) inter++; });
    var uni = aSet.size + bSet.size - inter;
    return uni ? inter / uni : 0;
  }

  function refSetFromIds(idList){
    var s = new Set();
    for (var i=0;i<idList.length;i++){
      var tail = String(idList[i]).split("/").pop();
      if (tail) s.add(tail);
    }
    return s;
  }

  async function fetchRefsFor(workIdTails){
    var out = Object.create(null);
    var idsToFetch = [];

    for (var i=0;i<workIdTails.length;i++){
      var tail = workIdTails[i];
      var cached = cacheGet(tail);
      if (cached){ out[tail] = cached; }
      else { idsToFetch.push(tail); }
    }

    if (!idsToFetch.length) return out;

    var BATCH = 25;
    for (var j=0;j<idsToFetch.length;j+=BATCH){
      var slice = idsToFetch.slice(j, j+BATCH);
      var ids = slice.map(function(t){ return "https://openalex.org/" + t; }).join("|");
      var url = API + "/works?filter=ids.openalex:" + encodeURIComponent(ids) + "&per_page=" + slice.length;
      var data = await getJSON(url);
      (data.results||[]).forEach(function(w){
        var tail = String(w.id).split("/").pop();
        var refs = Array.isArray(w.referenced_works) ? w.referenced_works.map(function(r){ return String(r).split("/").pop(); }) : [];
        var set = new Set(refs);
        out[tail] = set;
        cacheSet(tail, set);
      });
    }
    return out;
  }

  async function buildConnectedLikeGraph(seed, cited, citing, opts){
    opts = opts || {};
    var MAX_REF = opts.maxReferences || 180;
    var MAX_CIT = opts.maxCiters || 180;
    var THRESH = opts.jaccardThreshold || 0.08;

    var refs = Array.isArray(seed.referenced_works) ? seed.referenced_works.slice(0, MAX_REF) : [];
    var candTails = refs.map(function(x){ return String(x).split("/").pop(); });

    (citing||[]).slice(0, MAX_CIT).forEach(function(w){
      var tail = String(w.id||"").split("/").pop();
      if (tail && candTails.indexOf(tail) === -1) candTails.push(tail);
    });

    var refMap = await fetchRefsFor(candTails);

    var edges = [];
    for (var i=0;i<candTails.length;i++){
      for (var j=i+1;j<candTails.length;j++){
        var a = candTails[i], b = candTails[j];
        var sA = refMap[a], sB = refMap[b];
        if (!sA || !sB) continue;
        var sim = jaccard(sA, sB);
        if (sim >= THRESH){
          edges.push({ a:a, b:b, w:sim });
        }
      }
    }

    var seedRefSet = refSetFromIds(refs);
    for (var k=0;k<candTails.length;k++){
      var t = candTails[k];
      var sCand = refMap[t];
      if (!sCand || seedRefSet.size === 0) continue;
      var simSeed = jaccard(seedRefSet, sCand);
      if (simSeed >= Math.max(0.04, THRESH * 0.6)){
        edges.push({ a: idTailFrom(seed.id), b: t, w: simSeed });
      }
    }

    return { candidateIds: candTails, edges: edges };
  }

  async function coCitationBoost(seedCiting, candidateIds, existingEdges){
    var candSet = new Set(candidateIds);
    var coCounts = Object.create(null);

    for (var i=0;i<seedCiting.length;i++){
      var cw = seedCiting[i];
      var refs = Array.isArray(cw.referenced_works) ? cw.referenced_works.map(function(r){ return String(r).split("/").pop(); }) : [];
      var present = refs.filter(function(t){ return candSet.has(t); });
      for (var x=0;x<present.length;x++){
        for (var y=x+1;y<present.length;y++){
          var a = present[x], b = present[y];
          var key = a < b ? (a+"|"+b) : (b+"|"+a);
          coCounts[key] = (coCounts[key] || 0) + 1;
        }
      }
    }
    var max = 0; Object.keys(coCounts).forEach(function(k){ if (coCounts[k] > max) max = coCounts[k]; });
    var norm = function(k){ return max ? (coCounts[k] / max) : 0; };

    var merged = existingEdges.map(function(e){
      var key = e.a < e.b ? (e.a+"|"+e.b) : (e.b+"|"+e.a);
      var co = norm(key);
      return { a:e.a, b:e.b, w: (0.7*e.w + 0.3*co) };
    });
    return merged;
  }

  function filterToSeedComponent(edgesWeighted, allNodeIds, seedIdFull){
    var adj = Object.create(null);
    allNodeIds.forEach(function(id){ adj[id] = []; });
    edgesWeighted.forEach(function(e){
      var a = "https://openalex.org/" + e.a;
      var b = "https://openalex.org/" + e.b;
      if (!adj[a]) adj[a] = [];
      if (!adj[b]) adj[b] = [];
      adj[a].push(b);
      adj[b].push(a);
    });
    var visited = new Set();
    var queue = [seedIdFull];
    visited.add(seedIdFull);
    while (queue.length){
      var u = queue.shift();
      var nbrs = adj[u] || [];
      for (var i=0;i<nbrs.length;i++){
        var v = nbrs[i];
        if (!visited.has(v)){
          visited.add(v);
          queue.push(v);
        }
      }
    }
    return visited;
  }

  function shortestPath(nodesData, edgesData, fromId, toId){
    var nodes = nodesData.getIds();
    var dist = Object.create(null);
    var prev = Object.create(null);
    var visited = new Set();
    nodes.forEach(function(n){ dist[n] = Infinity; });
    dist[fromId] = 0;

    function edgeWeight(e){
      var w = e.value || e.width || 1;
      return 1 / Math.max(1e-6, w);
    }

    while (visited.size < nodes.length){
      var u = null, best = Infinity;
      for (var i=0;i<nodes.length;i++){
        var nid = nodes[i];
        if (visited.has(nid)) continue;
        if (dist[nid] < best){ best = dist[nid]; u = nid; }
      }
      if (u == null) break;
      if (u === toId) break;
      visited.add(u);

      var connected = edgesData.get({
        filter: function(e){ return (e.from===u || e.to===u); }
      });
      for (var k=0;k<connected.length;k++){
        var e = connected[k];
        var v = (e.from===u) ? e.to : e.from;
        if (visited.has(v)) continue;
        var alt = dist[u] + edgeWeight(e);
        if (alt < dist[v]){
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }

    if (dist[toId]===Infinity) return [];
    var path = [toId];
    var cur = toId;
    while (prev[cur] != null){
      cur = prev[cur];
      path.unshift(cur);
    }
    return path;
  }

  function renderGraphControls(){
    var el = document.createElement("div");
    el.id = "graphControls";
    el.className = "panel light";
    el.style.marginBottom = "8px";
    el.style.padding = "10px";
    el.innerHTML = ''+
      '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:end;">'+
        '<label style="display:flex; flex-direction:column; font-size:12px;">Mode'+
          '<select id="graphMode" style="min-width:180px;">'+
            '<option value="connected">Connected Map (similarity)</option>'+
            '<option value="citation">Cited/Citing (original)</option>'+
          '</select>'+
        '</label>'+
        '<label style="display:flex; flex-direction:column; font-size:12px;">Min similarity'+
          '<input id="minSim" type="number" step="0.01" min="0" max="1" value="0.10" />'+
        '</label>'+
        '<label style="display:flex; flex-direction:column; font-size:12px;">Min citations'+
          '<input id="minCites" type="number" min="0" value="0" />'+
        '</label>'+
        '<label style="display:flex; flex-direction:column; font-size:12px;">Year range'+
          '<div style="display:flex; gap:6px; align-items:center;">'+
            '<input id="minYear" type="number" placeholder="min" style="width:90px;" />'+
            '<span>–</span>'+
            '<input id="maxYear" type="number" placeholder="max" style="width:90px;" />'+
          '</div>'+
        '</label>'+
        '<label style="display:flex; gap:6px; align-items:center; font-size:12px;">'+
          '<input id="useCoCite" type="checkbox" />'+
          '<span>Co-citation boost</span>'+
        '</label>'+
        '<button id="applyGraphFilters" class="btn btn-secondary" type="button">Apply</button>'+
        '<span class="muted" style="margin-left:auto;">Tip: double-click a node to expand its neighbors</span>'+
      '</div>';
    return el;
  }

  function baseNetworkOptions(){
    return {
      nodes: { shape:"dot", scaling:{min:6,max:28}, font:{size:14} },
      edges: { smooth:true },
      physics: { stabilization:true, barnesHut:{ gravitationalConstant:-6500, springConstant:0.02, avoidOverlap:0.2 } },
      interaction: { hover:true }
    };
  }

  // Keep graph context up to date
  window.__GRAPH_CTX__ = window.__GRAPH_CTX__ || { main: null, cited: [], citing: [] };

  async function renderCitationGraph(main, cited, citing){
    window.__GRAPH_CTX__ = { main: main, cited: cited, citing: citing };

    var block = $("graphBlock");
    block.innerHTML = '<h2>Connected Papers</h2>';

    var controls = renderGraphControls();
    block.appendChild(controls);
    var graphDiv = document.createElement("div");
    graphDiv.id = "paperGraph";
    graphDiv.className = "panel";
    graphDiv.style.height = "680px";
    block.appendChild(graphDiv);

    if (!window.vis || !vis.Network){
      block.insertAdjacentHTML("beforeend", "<p class='muted'>Graph library not loaded.</p>");
      return;
    }

    var nodes = [{ id: main.id, label: shortCitation(main), title: main.display_name, group: "main", paperId: main.id }];
    for (var i=0;i<cited.length;i++)  nodes.push({ id: cited[i].id,  label: shortCitation(cited[i]),  title: cited[i].display_name,  group: "cited",  paperId: cited[i].id });
    for (var j=0;j<citing.length;j++) nodes.push({ id: citing[j].id, label: shortCitation(citing[j]), title: citing[j].display_name, group: "citing", paperId: citing[j].id });

    var edges = [];
    for (var k=0;k<cited.length;k++)  edges.push({ from: main.id, to: cited[k].id, value: 1, width: 1 });
    for (var m=0;m<citing.length;m++) edges.push({ from: citing[m].id, to: main.id, value: 1, width: 1 });

    var network = new vis.Network(graphDiv, { nodes:new vis.DataSet(nodes), edges:new vis.DataSet(edges) }, baseNetworkOptions());

    network.on("click", function (params) {
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var shortId = String(nodeId).replace(/^https?:\/\/openalex\.org\//i, "");
      window.location.href = "paper.html?id=" + encodeURIComponent(shortId);
    });

    var applyBtn = $("#applyGraphFilters");
    if (applyBtn){
      applyBtn.onclick = async function(){
        var mode = $("#graphMode").value;
        if (mode === "connected"){
          await renderConnectedGraph(main, cited, citing);
        } else {
          await renderCitationGraph(main, cited, citing);
        }
      };
    }
    var modeSel = $("#graphMode");
    if (modeSel) modeSel.value = "citation";

    repopulateHeaderIfEmpty();
    restoreHeaderIfNeeded();
  }

  async function renderConnectedGraph(main, cited, citing){
    window.__GRAPH_CTX__ = { main: main, cited: cited, citing: citing };

    var block = $("graphBlock");
    block.innerHTML = '<h2>Connected Papers</h2>';

    var controls = renderGraphControls();
    block.appendChild(controls);
    var graphDiv = document.createElement("div");
    graphDiv.id = "paperGraph";
    graphDiv.className = "panel";
    graphDiv.style.height = "680px";
    block.appendChild(graphDiv);

    if (!window.vis || !vis.Network){
      block.insertAdjacentHTML("beforeend", "<p class='muted'>Graph library not loaded.</p>");
      return;
    }

    var minSimInput = $("#minSim");
    var minCitesInput = $("#minCites");
    var minYearInput = $("#minYear");
    var maxYearInput = $("#maxYear");
    var coCiteChk = $("#useCoCite");
    if (minSimInput) minSimInput.value = minSimInput.value || "0.10";

    var MIN_SIM = parseFloat(minSimInput ? (minSimInput.value || "0.10") : "0.10") || 0.10;
    var MIN_CITES = parseInt(minCitesInput ? (minCitesInput.value || "0") : "0", 10) || 0;
    var MIN_YEAR = parseInt(minYearInput ? (minYearInput.value || "0") : "0", 10) || 0;
    var MAX_YEAR = parseInt(maxYearInput ? (maxYearInput.value || "0") : "0", 10) || 0;
    var USE_COCIT = !!(coCiteChk && coCiteChk.checked);

    var base = await buildConnectedLikeGraph(main, cited, citing, { maxReferences:220, maxCiters:220, jaccardThreshold:Math.max(0.04, MIN_SIM) });
    var edgesWeighted = base.edges;

    if (USE_COCIT){
      edgesWeighted = await coCitationBoost(citing.slice(0,200), base.candidateIds, edgesWeighted);
    }

    var K_PER_NODE = 6;
    var bucket = Object.create(null);
    edgesWeighted.forEach(function(e){
      var keyA = e.a; var keyB = e.b;
      (bucket[keyA] = bucket[keyA] || []).push(e);
      (bucket[keyB] = bucket[keyB] || []).push(e);
    });
    var keepEdgeSet = new Set();
    Object.keys(bucket).forEach(function(node){
      var arr = bucket[node].slice().sort(function(a,b){ return b.w - a.w; }).slice(0, K_PER_NODE);
      arr.forEach(function(e){
        keepEdgeSet.add(e.a+"|"+e.b);
      });
    });
    edgesWeighted = edgesWeighted.filter(function(e){ return keepEdgeSet.has(e.a+"|"+e.b); });

    var candIdsFull = base.candidateIds.map(function(t){ return "https://openalex.org/"+t; });
    var meta = [];
    for (var i=0;i<candIdsFull.length;i+=50){
      var chunk = candIdsFull.slice(i, i+50).join("|");
      var data = await getJSON(API + "/works?filter=ids.openalex:" + encodeURIComponent(chunk) + "&per_page=50");
      meta = meta.concat(data.results || []);
    }

    var all = [main].concat(meta);
    var years = all.map(function(w){ return +get(w,"publication_year",0) || 0; }).filter(Boolean);
    var minY = years.length ? Math.min.apply(null, years) : 0;
    var maxY = years.length ? Math.max.apply(null, years) : 0;

    var nodes = [];
    var keepSet = new Set();

    nodes.push({
      id: main.id, label: shortCitation(main), title: main.display_name,
      group: "main", paperId: main.id,
      value: Math.max(1, +get(main,'cited_by_count',0)),
      color: { background: "#111827", border: "#111827" }
    });
    keepSet.add(String(main.id));

    var metaByTail = Object.create(null);
    meta.forEach(function(w){
      var tail = String(w.id).split("/").pop();
      metaByTail[tail] = w;
    });

    Object.keys(metaByTail).forEach(function(tail){
      var w = metaByTail[tail];
      var yr = +get(w,"publication_year",0) || 0;
      var cites = +get(w,"cited_by_count",0) || 0;
      if (MIN_CITES && cites < MIN_CITES) return;
      if (MIN_YEAR && yr && yr < MIN_YEAR) return;
      if (MAX_YEAR && yr && yr > MAX_YEAR) return;

      var colorHex = yearColor(yr || minY, MIN_YEAR||minY, MAX_YEAR||maxY || maxY);
      nodes.push({
        id: w.id, label: shortCitation(w), title: w.display_name,
        group: "candidate", paperId: w.id,
        value: Math.max(1, cites),
        year: yr,
        color: { background: colorHex, border: colorHex }
      });
      keepSet.add(String(w.id));
    });

    var edges = [];
    edgesWeighted.forEach(function(e){
      var aFull = (e.a.indexOf("http")===0) ? e.a : ("https://openalex.org/"+e.a);
      var bFull = (e.b.indexOf("http")===0) ? e.b : ("https://openalex.org/"+e.b);
      if (!keepSet.has(aFull) || !keepSet.has(bFull)) return;
      if (e.w < MIN_SIM) return;
      edges.push({ from:aFull, to:bFull, value:e.w, width: Math.max(1, 6*e.w) });
    });

    if (edges.length < 20 && edgesWeighted.length){
      var top = edgesWeighted.slice().sort(function(a,b){ return b.w - a.w; }).slice(0, 30);
      edges = top.map(function(e){
        var aFull = (e.a.indexOf("http")===0) ? e.a : ("https://openalex.org/"+e.a);
        var bFull = (e.b.indexOf("http")===0) ? e.b : ("https://openalex.org/"+e.b);
        return { from:aFull, to:bFull, value:e.w, width: Math.max(1, 6*e.w) };
      });
    }

    var allIds = nodes.map(function(n){ return String(n.id); });
    var seedIdFull = String(main.id);
    var reachable = filterToSeedComponent(edges.map(function(e){
      return { a: idTailFrom(e.from), b: idTailFrom(e.to), w: e.value };
    }), allIds, seedIdFull);

    var nodesFiltered = nodes.filter(function(n){ return reachable.has(String(n.id)); });
    var nodeIdsKept = new Set(nodesFiltered.map(function(n){ return String(n.id); }));
    var edgesFiltered = edges.filter(function(e){ return nodeIdsKept.has(String(e.from)) && nodeIdsKept.has(String(e.to)); });

    var nodesDS = new vis.DataSet(nodesFiltered);
    var edgesDS = new vis.DataSet(edgesFiltered);
    var network = new vis.Network(graphDiv, { nodes:nodesDS, edges:edgesDS }, baseNetworkOptions());

    network.on("click", function (params) {
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var shortId = String(nodeId).replace(/^https?:\/\/openalex\.org\//i, "");
      window.location.href = "paper.html?id=" + encodeURIComponent(shortId);
    });

    network.on("selectNode", function(params){
      if (!params.nodes || !params.nodes.length) return;
      var target = params.nodes[0];
      var seed = main.id;
      if (target === seed) return;

      edgesDS.forEach(function(e){ edgesDS.update({id:e.id, color:{}, width: Math.max(1, 6*(e.value||0.1)) }); });

      var path = shortestPath(nodesDS, edgesDS, seed, target);
      if (path.length >= 2){
        for (var i=0;i<path.length-1;i++){
          var a = path[i], b = path[i+1];
          var match = edgesDS.get({
            filter: function(e){ return (e.from===a && e.to===b) || (e.from===b && e.to===a); }
          });
          match.forEach(function(e){
            edgesDS.update({ id:e.id, color:{ color:"#111827" }, width: Math.max(3, (e.width||2)+2) });
          });
        }
      }
    });

    var knownIds = new Set(nodesFiltered.map(function(n){ return String(n.id).split("/").pop(); }));
    network.on("doubleClick", async function(params){
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var tail = String(nodeId).split("/").pop();
      await expandNode(tail, network, knownIds);
      repopulateHeaderIfEmpty();
      restoreHeaderIfNeeded();
    });

    var applyBtn = $("#applyGraphFilters");
    if (applyBtn){
      applyBtn.onclick = async function(){
        var mode = $("#graphMode").value;
        if (mode === "citation"){
          await renderCitationGraph(main, cited, citing);
        } else {
          await renderConnectedGraph(main, cited, citing);
        }
      };
    }
    $("#graphMode").value = "connected";

    repopulateHeaderIfEmpty();
    restoreHeaderIfNeeded();
  }

  async function expandNode(nodeTail, network, knownIds){
    try{
      var url = API + "/works/" + encodeURIComponent(nodeTail);
      var w = await getJSON(url);

      var refs = Array.isArray(w.referenced_works) ? w.referenced_works.slice(0, 50) : [];
      var citing = await fetchCitingPapers(w.id);

      var newNodes = [];
      refs.forEach(function(r){
        var tid = String(r).split("/").pop();
        if (!knownIds.has(tid)){
          knownIds.add(tid);
          newNodes.push({ id: "https://openalex.org/"+tid, label: shortCitation({authorships:[{author:{display_name:""}}], publication_year:get(w,'publication_year','n.d.')}), title: "(loading…)", group: "cited", paperId: "https://openalex.org/"+tid });
        }
      });
      (citing||[]).slice(0,50).forEach(function(cw){
        var tid = String(cw.id).split("/").pop();
        if (!knownIds.has(tid)){
          knownIds.add(tid);
          newNodes.push({ id: cw.id, label: shortCitation(cw), title: cw.display_name, group: "citing", paperId: cw.id, value: Math.max(1, +get(cw,'cited_by_count',0)) });
        }
      });

      network.body.data.nodes.add(newNodes);
    }catch(e){
      console.warn("Expand failed", e);
    }
  }

  // ---------- Header guards ----------
  var __CURRENT_SOURCE__ = null;
  var __HEADER_GUARD_INSTALLED__ = false;

  function repopulateHeaderIfEmpty(){
    try{
      var hdr = $("paperHeaderMain");
      if (!hdr) return;
      var empty = (!hdr.firstElementChild && (hdr.textContent || "").trim() === "");
      if (empty){
        if (__CURRENT_PAPER__){
          $("paperHeaderMain").innerHTML = buildHeaderMain(__CURRENT_PAPER__);
          $("paperActions").innerHTML    = buildActionsBar(__CURRENT_PAPER__);
          $("paperStats").innerHTML      = buildStatsHeader(__CURRENT_PAPER__);
          wireHeaderToggles();
          if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
            SE.components.enhancePaperCards($("paperActions"));
          }
        } else if (__HEADER_HTML_SNAPSHOT__) {
          $("paperHeaderMain").innerHTML = __HEADER_HTML_SNAPSHOT__;
          wireHeaderToggles();
        }
      }
    }catch(e){
      console.warn("Header repopulate failed:", e);
    }
  }

  function installHeaderGuard(){
    if (__HEADER_GUARD_INSTALLED__) return;
    var hdr = $("paperHeaderMain");
    if (!hdr) return;

    hdr.setAttribute("data-sticky-header","true");

    var mo = new MutationObserver(function(){ repopulateHeaderIfEmpty(); });
    mo.observe(hdr, { childList:true, subtree:false });

    var moBody = new MutationObserver(function(){
      var stillThere = document.getElementById("paperHeaderMain");
      if (!stillThere) restoreHeaderIfNeeded();
      repopulateHeaderIfEmpty();
    });
    moBody.observe(document.body, { childList:true, subtree:true });

    var t0 = Date.now();
    var tick = function(){
      repopulateHeaderIfEmpty();
      if (Date.now() - t0 < 15000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    __HEADER_GUARD_INSTALLED__ = true;
  }

  function renderResearchObjectsUI(items){
    if (!Array.isArray(items) || !items.length){
      $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">None listed via Crossref/DataCite/Zenodo.</p>';
      return;
    }
    var rows = items.map(function(x){
      var prov = x.provenance ? ('<span class="badge badge-neutral" title="Source">'+escapeHtml(x.provenance)+'</span>') : '';
      var typ  = x.type ? ('<span class="badge">'+escapeHtml(x.type)+'</span>') : '';
      var repo = x.repository ? ('<span class="muted" style="margin-left:.25rem;">'+escapeHtml(x.repository)+'</span>') : '';
      var doi  = x.doi ? (' · <a href="https://doi.org/'+escapeHtml(x.doi)+'" target="_blank" rel="noopener">DOI</a>') : '';
      var ver  = x.version ? (' <span class="muted">v'+escapeHtml(x.version)+'</span>') : '';
      var lic  = x.licence ? (' <span class="muted">('+escapeHtml(x.licence)+')</span>') : '';
      var url  = x.url || (x.doi ? ("https://doi.org/"+x.doi) : "");
      return '<li class="ro-item">'+typ+' <a href="'+escapeHtml(url)+'" target="_blank" rel="noopener">'+escapeHtml(x.title || x.doi || "Item")+'</a>'+ver+lic+doi+' '+prov+repo+'</li>';
    });
    $("objectsBlock").innerHTML = '<h2>Research Objects</h2><ul>'+rows.join("")+'</ul>';
  }

  // NEW: render proper paper cards below the graph, split by relationship
  function renderRefCiteLists(citedArr, citingArr){
    const wrap = $("relatedBlock");
    if (!wrap) return;

    function renderGroup(title, items, tagText){
      const count = (items||[]).length;
      const h = `<h2>${escapeHtml(title)} <span class="muted">(${count.toLocaleString()})</span></h2>`;
      if (!count) return h + `<p class="muted">None found.</p>`;

      const cards = items.map(w=>{
        try{
          const html = (window.SE && SE.components && typeof SE.components.renderPaperCard==="function")
            ? SE.components.renderPaperCard(w, { compact:true })
            : (function fallback(){
                const t = escapeHtml(w.display_name||"Untitled");
                const idTail = String(w.id||"").replace(/^https?:\/\/openalex\.org\//i,"");
                return `<article class="paper-card"><a href="paper.html?id=${encodeURIComponent(idTail)}">${t}</a></article>`;
              })();

          return html + `<div class="chips" style="margin-top:.25rem;">
              <span class="badge">${escapeHtml(tagText)}</span>
            </div>`;
        }catch(_){
          return "";
        }
      }).join("");

      return h + cards;
    }

    const html =
      renderGroup("References (works this article cites)", citedArr, "Cited by this paper") +
      renderGroup("Citations (works that cite this article)", citingArr, "Cites this paper");

    wrap.innerHTML = html;
    try{
      if (window.SE && SE.components && typeof SE.components.enhancePaperCards==="function"){
        SE.components.enhancePaperCards(wrap);
      }
    }catch(_){}
  }

  async function renderPaper(p, source){
    __CURRENT_PAPER__ = p;

    $("paperHeaderMain").innerHTML = buildHeaderMain(p);
    $("paperActions").innerHTML   = buildActionsBar(p);
    $("paperStats").innerHTML     = buildStatsHeader(p);

    __HEADER_HTML_SNAPSHOT__ = $("paperHeaderMain").innerHTML;

    wireHeaderToggles();

    let guardUntil = Date.now() + 15000;
    (function loopGuard(){
      restoreHeaderIfNeeded();
      if (Date.now() < guardUntil) requestAnimationFrame(loopGuard);
    })();

    if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
      SE.components.enhancePaperCards($("paperActions"));
    }

    $("abstractBlock").innerHTML = '<h2>Abstract</h2><p>' + formatAbstract(p.abstract_inverted_index) + '</p>';

    try{
      $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">Looking for code & data…</p>';
      var ro = await harvestDeterministicResearchObjects(p);
      renderResearchObjectsUI(ro.items);
    }catch(e){
      console.warn("RO harvest failed", e);
      $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">Could not retrieve links.</p>';
    }

    renderJournalBlock(p, source);
    installHeaderGuard();
  }

  async function renderGraphs(main, cited, citing){
    // default to connected graph initially
    await renderConnectedGraph(main, cited, citing);
    repopulateHeaderIfEmpty();
    restoreHeaderIfNeeded();
  }

  // ---------- Boot ----------
  async function boot(){
    var rawId = getParam("id");
    if (!rawId) {
      $("paperHeaderMain").innerHTML = "<p class='muted'>No paper specified.</p>";
      return;
    }

    try {
      var paper = await fetchPaperData(rawId);
      var source = await fetchSourceFromPaper(paper);
      renderPaper(paper, source);

      var cited=[], citing=[];
      try { cited = await fetchCitedPapers(paper.referenced_works || []); } catch(e){ console.warn("cited fetch failed:", e); }
      try { citing = await fetchCitingPapers(paper.id); } catch(e){ console.warn("citing fetch failed:", e); }

      window.__GRAPH_CTX__ = { main: paper, cited: cited, citing: citing };

      await renderGraphs(paper, cited, citing);

      // NEW: render “References” and “Citations” as proper cards like the journal page
      renderRefCiteLists(cited, citing);

      repopulateHeaderIfEmpty();
      restoreHeaderIfNeeded();

    } catch (e) {
      console.error(e);
      $("paperHeaderMain").innerHTML = "<p class='muted'>Error loading paper details.</p>";
      restoreHeaderIfNeeded();
    }

    // Global delegated apply (survives re-renders)
    document.addEventListener("click", function(e){
      var btn = e.target.closest("#applyGraphFilters");
      if (!btn) return;
      e.preventDefault();
      var modeSel = document.getElementById("graphMode");
      var mode = modeSel ? modeSel.value : "connected";
      if (window.__GRAPH_CTX__ && __GRAPH_CTX__.main) {
        if (mode === "citation"){
          renderCitationGraph(__GRAPH_CTX__.main, __GRAPH_CTX__.cited, __GRAPH_CTX__.citing);
        } else {
          renderConnectedGraph(__GRAPH_CTX__.main, __GRAPH_CTX__.cited, __GRAPH_CTX__.citing);
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
