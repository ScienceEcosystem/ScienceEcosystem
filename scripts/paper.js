(function () {
  if (!document.body || document.body.dataset.page !== "paper") return;

  // ---------- Constants & helpers ----------
  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";

  // Small allow-list of journals that publish open peer review routinely (you can tune this)
  var OPEN_PEER_REVIEW_JOURNALS = [
    "eLife",
    "F1000Research",
    "PeerJ",
    "Royal Society Open Science",
    "BMJ",
    "BMC",                   // many BMC titles have open peer review
    "Nature Communications", // some have open peer review or transparent peer review packages
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

  function addMailto(u){
    var url = new URL(u, API);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }

  async function getJSON(url){
    var withMt = addMailto(url);
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

  // Paper-mill heuristic
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
    return { text: "Low (heuristic)", cls: "risk-low" };
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

  // ---------- Header content ----------
  function buildHeaderMain(p){
    var title = p.display_name || "Untitled";
    var year  = (p.publication_year != null ? p.publication_year : "n.d.");
    var venue = get(p, "host_venue.display_name", null) || get(p, "primary_location.source.display_name", null) || "Unknown venue";

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

    // PubPeer badge if DOI present
    var doiClean = doiFromWork(p);
    var pp = pubPeerLink(doiClean);
    if (pp) chips.push(badge(pp, "PubPeer", "badge-neutral"));

    // quick retraction search link
    var rw = retractionSearchLinks(doiClean, p.display_name || "");
    if (rw.length) chips.push(badge(rw[0].href, "Retraction search", "badge-warn"));

    var aList = authorLinksList(p.authorships);
    var affList = institutionsLinksHTML(p.authorships);

    return (
      '<h1 class="paper-title">'+escapeHtml(title)+'</h1>' +
      '<p class="meta"><span class="muted">'+escapeHtml(String(year))+'</span> · <strong>Published in:</strong> '+escapeHtml(venue)+'</p>' +
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
    var socialOrNews = "—"; // placeholder for future altmetrics

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
    var worksCount = +get(source, 'works_count', 0) || 0;

    var citedBy    = get(p, 'cited_by_count', 0);
    var refCount   = Array.isArray(p.referenced_works) ? p.referenced_works.length : 0;
    var isRetracted= !!get(p, 'is_retracted', false);

    // Scan locations for research objects (datasets/software)
    var locs = Array.isArray(p.locations) ? p.locations : [];
    var dataCount = 0, codeCount = 0;
    for (var i=0;i<locs.length;i++){
      var t = (get(locs[i], 'source.type', '') || '').toLowerCase();
      if (t.indexOf('dataset') !== -1) dataCount++;
      if (t.indexOf('software') !== -1) codeCount++;
    }

    // Heuristic signals we can compute locally
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

    // Peer review availability (guess)
    var isPreprint = isPreprintVenue(journalName, venueType);
    var peerReviewText = isPreprint
      ? "Preprint / repository — typically not peer reviewed yet"
      : (hasOpenPeerReview(journalName)
          ? "Journal with open/transparent peer review"
          : "Journal article — peer review likely (not verified)");
    
    // PubPeer + Retraction search
    var doi = doiFromWork(p);
    var pubpeer = pubPeerLink(doi);
    var rwLinks = retractionSearchLinks(doi, title);

    // Journal score (beta)
    var score = computeJournalScore(source || {});
    var scoreExplain = scoreExplanation(source || {});

    // Paper-mill risk & expected quality
    var pmScore = computePaperMillRiskScore(source || {}, p || {});
    var pm = riskLabel(pmScore);
    var exp = computeExpectedPaperQuality(source || {}, p || {});

    var lines = [];
    // Header
    lines.push(
      '<p><strong>Journal:</strong> '+escapeHtml(journalName)
      + (homepage?(' · <a href="'+homepage+'" target="_blank" rel="noopener">Homepage</a>'):'')
      + (srcOpenAlex?(' · <a href="'+srcOpenAlex+'" target="_blank" rel="noopener">OpenAlex</a>'):'')
      + '</p>'
    );

    lines.push('<p class="meta"><strong>Type:</strong> '+escapeHtml(String(venueType||'—'))+' · <strong>Publisher:</strong> '+escapeHtml(String(publisher||'—'))+'</p>');

    var issnBits = [];
    if (issn_l) issnBits.push('ISSN-L: '+escapeHtml(issn_l));
    if (issns && issns.length) issnBits.push('ISSN: '+escapeHtml(issns.join(', ')));
    if (issnBits.length) lines.push('<p class="meta">'+issnBits.join(' · ')+'</p>');

    // Badges row
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

    // Quality indicators list
    lines.push('<ul class="kv-list">');
    lines.push('<li><span>Citations</span><strong>'+escapeHtml(String(citedBy))+'</strong></li>');
    lines.push('<li><span>References</span><strong>'+escapeHtml(String(refCount))+'</strong></li>');
    lines.push('<li><span>Datasets linked</span><strong>'+escapeHtml(String(dataCount))+'</strong></li>');
    lines.push('<li><span>Code linked</span><strong>'+escapeHtml(String(codeCount))+'</strong></li>');
    lines.push('<li><span>Peer review</span><strong>'+escapeHtml(peerReviewText)+'</strong></li>');
    lines.push('<li><span>Corrections/Errata</span><strong>'+(hasCorrection ? "Mentioned in title" : "None detected in title")+'</strong></li>');
    lines.push('<li><span>Replication signal</span><strong>'+(hasReplication ? "Likely replication/reproducibility study" : "Not detected (heuristic)")+'</strong></li>');
    if (rwLinks.length > 1) {
      lines.push('<li><span>Retraction check</span><strong><a href="'+rwLinks[1].href+'" target="_blank" rel="noopener">Search by title</a></strong></li>');
    }
    lines.push('</ul>');

    // Journal score (visual)
    lines.push(
      '<div class="panel light" style="margin-top:.5rem;">' +
        '<div style="display:flex; align-items:center; gap:.5rem; flex-wrap:wrap;">' +
          '<strong>Journal score (beta):</strong> ' +
          '<span aria-label="Journal score" title="'+escapeHtml(scoreExplain)+'">' + '★'.repeat(score) + '☆'.repeat(5-score) + '</span>' +
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

    // Small footer note
    var isPreprint = isPreprintVenue(journalName, venueType);
    var peerReviewNote = isPreprint
      ? 'Preprints are valuable for speed but typically lack formal peer review. Check PubPeer for discussion.'
      : (hasOpenPeerReview(journalName) ? 'This journal often exposes peer-review reports (open/transparent peer review).' : 'Peer-review details vary by journal.');
    lines.push('<p class="muted" style="margin-top:.25rem;">'+escapeHtml(peerReviewNote)+'</p>');

    // Inline styles for risk badges
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

  // ---------- Graph helpers (Connected-style) ----------

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
    if (!year || !minY || !maxY || minY===maxY) return "#6b7280"; // gray
    var t = (year - minY) / (maxY - minY);
    var h = (1 - t) * 220; // blue->green range
    return hsvToHex(h, 0.55, 0.95);
  }

  function jaccard(aSet, bSet){
    var inter = 0;
    aSet.forEach(function(x){ if (bSet.has(x)) inter++; });
    var uni = aSet.size + bSet.size - inter;
    return uni ? inter / uni : 0;
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

    // Reference sets for candidates
    var refMap = await fetchRefsFor(candTails);

    // Pairwise Jaccard on references
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
          coCounts[key] = (coCounts[key]||0) + 1;
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

  // Dijkstra shortest path on the current graph
  function shortestPath(nodesData, edgesData, fromId, toId){
    var nodes = nodesData.getIds();
    var dist = Object.create(null);
    var prev = Object.create(null);
    var visited = new Set();
    nodes.forEach(function(n){ dist[n] = Infinity; });
    dist[fromId] = 0;

    function edgeWeight(e){
      var w = e.value || e.width || 1;
      // higher similarity → smaller cost
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

      // neighbors
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

  // ---------- Graph renderers ----------

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
          '<input id="minSim" type="number" step="0.01" min="0" max="1" value="0.08" />'+
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
        '<button id="applyGraphFilters" class="btn btn-secondary">Apply</button>'+
        '<span class="muted" style="margin-left:auto;">Tip: double-click a node to expand its neighbors</span>'+
      '</div>';
    return el;
  }

  function baseNetworkOptions(){
    return {
      nodes: { shape:"dot", scaling:{min:4,max:28}, font:{size:14} },
      edges: { smooth:true },
      physics: { stabilization:true, barnesHut:{ gravitationalConstant:-6000 } },
      interaction: { hover:true }
    };
  }

  async function renderCitationGraph(main, cited, citing){
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

    // Build original cited/citing graph
    var nodes = [{ id: main.id, label: shortCitation(main), title: main.display_name, group: "main", paperId: main.id }];
    for (var i=0;i<cited.length;i++)  nodes.push({ id: cited[i].id,  label: shortCitation(cited[i]),  title: cited[i].display_name,  group: "cited",  paperId: cited[i].id });
    for (var j=0;j<citing.length;j++) nodes.push({ id: citing[j].id, label: shortCitation(citing[j]), title: citing[j].display_name, group: "citing", paperId: citing[j].id });

    var edges = [];
    for (var k=0;k<cited.length;k++)  edges.push({ from: main.id, to: cited[k].id, value: 1, width: 1 });
    for (var m=0;m<citing.length;m++) edges.push({ from: citing[m].id, to: main.id, value: 1, width: 1 });

    var network = new vis.Network(graphDiv, { nodes:new vis.DataSet(nodes), edges:new vis.DataSet(edges) }, baseNetworkOptions());

    // Click → navigate (keep original behavior)
    network.on("click", function (params) {
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var shortId = String(nodeId).replace(/^https?:\/\/openalex\.org\//i, "");
      window.location.href = "paper.html?id=" + encodeURIComponent(shortId);
    });

    // Mode switch: rebuild as connected map if selected
    $("#applyGraphFilters").onclick = async function(){
      var mode = $("#graphMode").value;
      if (mode === "connected"){
        await renderConnectedGraph(main, cited, citing);
      } else {
        await renderCitationGraph(main, cited, citing); // re-render to clear filters
      }
    };
  }

  async function renderConnectedGraph(main, cited, citing){
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

    // Read filter inputs
    var minSimInput = $("#minSim");
    var minCitesInput = $("#minCites");
    var minYearInput = $("#minYear");
    var maxYearInput = $("#maxYear");
    var coCiteChk = $("#useCoCite");
    if (minSimInput) minSimInput.value = minSimInput.value || "0.08";

    var MIN_SIM = parseFloat(minSimInput ? (minSimInput.value || "0.08") : "0.08") || 0.08;
    var MIN_CITES = parseInt(minCitesInput ? (minCitesInput.value || "0") : "0", 10) || 0;
    var MIN_YEAR = parseInt(minYearInput ? (minYearInput.value || "0") : "0", 10) || 0;
    var MAX_YEAR = parseInt(maxYearInput ? (maxYearInput.value || "0") : "0", 10) || 0;
    var USE_COCIT = !!(coCiteChk && coCiteChk.checked);

    // Build similarity graph
    var base = await buildConnectedLikeGraph(main, cited, citing, { maxReferences:180, maxCiters:180, jaccardThreshold:MIN_SIM });
    var edgesWeighted = base.edges;
    if (USE_COCIT){
      edgesWeighted = await coCitationBoost(citing.slice(0,200), base.candidateIds, edgesWeighted);
    }

    // Fetch metadata for candidates
    var candIdsFull = base.candidateIds.map(function(t){ return "https://openalex.org/"+t; });
    var meta = [];
    for (var i=0;i<candIdsFull.length;i+=50){
      var chunk = candIdsFull.slice(i, i+50).join("|");
      var data = await getJSON(API + "/works?filter=ids.openalex:" + encodeURIComponent(chunk) + "&per_page=50");
      meta = meta.concat(data.results || []);
    }

    // Build nodes with filters
    var all = [main].concat(meta);
    var years = all.map(function(w){ return +get(w,"publication_year",0) || 0; }).filter(Boolean);
    var minY = years.length ? Math.min.apply(null, years) : 0;
    var maxY = years.length ? Math.max.apply(null, years) : 0;

    var nodes = [];
    var idToWork = Object.create(null);
    var keepSet = new Set(); // ids kept after filters
    // Seed forced in
    nodes.push({
      id: main.id, label: shortCitation(main), title: main.display_name,
      group: "main", paperId: main.id,
      value: Math.max(1, +get(main,'cited_by_count',0)),
      color: { background: "#111827", border: "#111827" }
    });
    keepSet.add(String(main.id));

    meta.forEach(function(w){
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
      idToWork[String(w.id).split("/").pop()] = w;
    });

    // Filter edges by kept nodes and min similarity
    var edges = [];
    edgesWeighted.forEach(function(e){
      var a = "https://openalex.org/"+e.a;
      var b = "https://openalex.org/"+e.b;
      if (!keepSet.has(a) || !keepSet.has(b)) return;
      if (e.w < MIN_SIM) return;
      edges.push({ from:a, to:b, value:e.w, width: Math.max(1, 6*e.w) });
    });

    var nodesDS = new vis.DataSet(nodes);
    var edgesDS = new vis.DataSet(edges);
    var network = new vis.Network(graphDiv, { nodes:nodesDS, edges:edgesDS }, baseNetworkOptions());

    // Click → navigate
    network.on("click", function (params) {
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var shortId = String(nodeId).replace(/^https?:\/\/openalex\.org\//i, "");
      window.location.href = "paper.html?id=" + encodeURIComponent(shortId);
    });

    // Shortest path highlight from seed to selected node
    network.on("selectNode", function(params){
      if (!params.nodes || !params.nodes.length) return;
      var target = params.nodes[0];
      var seed = main.id;
      if (target === seed) return;

      // Reset edge colors
      edgesDS.forEach(function(e){ edgesDS.update({id:e.id, color:{}, width: Math.max(1, 6*(e.value||0.1)) }); });

      var path = shortestPath(nodesDS, edgesDS, seed, target);
      if (path.length >= 2){
        for (var i=0;i<path.length-1;i++){
          var a = path[i], b = path[i+1];
          // find the matching edge (either direction)
          var match = edgesDS.get({
            filter: function(e){ return (e.from===a && e.to===b) || (e.from===b && e.to===a); }
          });
          match.forEach(function(e){
            edgesDS.update({ id:e.id, color:{ color:"#111827" }, width: Math.max(3, (e.width||2)+2) });
          });
        }
      }
    });

    // Progressive expansion on double-click
    var knownIds = new Set(nodes.map(function(n){ return String(n.id).split("/").pop(); }));
    network.on("doubleClick", async function(params){
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var tail = String(nodeId).split("/").pop();
      await expandNode(tail, network, knownIds);
    });

    // Apply button re-renders with current selections
    $("#applyGraphFilters").onclick = async function(){
      var mode = $("#graphMode").value;
      if (mode === "citation"){
        await renderCitationGraph(main, cited, citing);
      } else {
        await renderConnectedGraph(main, cited, citing);
      }
    };
    // Keep current mode in the selector
    $("#graphMode").value = "connected";
  }

  // Expand-on-click: fetch neighbors and add to graph incrementally (basic)
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

  // ---------- Render ----------
  function renderPaper(p, source){
    $("paperHeaderMain").innerHTML = buildHeaderMain(p);
    $("paperActions").innerHTML   = buildActionsBar(p);
    $("paperStats").innerHTML     = buildStatsHeader(p);

    wireHeaderToggles();

    if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
      SE.components.enhancePaperCards($("paperActions"));
    }

    $("abstractBlock").innerHTML = '<h2>Abstract</h2><p>' + formatAbstract(p.abstract_inverted_index) + '</p>';

    // Research objects (datasets/software)
    var items = [];
    var locs = Array.isArray(p.locations) ? p.locations : [];
    for (var i=0;i<locs.length;i++){
      var type = get(locs[i], "source.type", "") || get(locs[i], "type", "");
      var url = get(locs[i], "landing_page_url", null) || get(locs[i], "pdf_url", null);
      var label = get(locs[i], "source.display_name", null) || type || "Link";
      if (type && (type.toLowerCase().includes("dataset") || type.toLowerCase().includes("software")) && url){
        items.push('<li><a href="'+url+'" target="_blank" rel="noopener">'+escapeHtml(label)+'</a></li>');
      }
    }
    $("objectsBlock").innerHTML = '<h2>Research Objects</h2>' + (items.length ? '<ul>'+items.join("")+'</ul>' : '<p class="muted">None listed.</p>');

    // Journal & Quality in sidebar
    renderJournalBlock(p, source);
  }

  // Render graphs (with toggle + filters)
  async function renderGraphs(main, cited, citing){
    // default to connected map renderer
    await renderConnectedGraph(main, cited, citing);
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

      // Graphs (new connected-style with toggle)
      await renderGraphs(paper, cited, citing);

      // Related block
      var relatedHtml = [];
      var joinFew = (cited.slice(0,8).concat(citing.slice(0,8))).slice(0,16);
      for (var i=0;i<joinFew.length;i++){
        var w = joinFew[i];
        if (window.SE && SE.components && typeof SE.components.renderPaperCard === "function") {
          relatedHtml.push(SE.components.renderPaperCard(w, { compact: true }));
        } else {
          var title = escapeHtml(w.display_name || "Untitled");
          var idTail = String(w.id || "").replace(/^https?:\/\/openalex\.org\//i, "");
          relatedHtml.push('<article class="paper-card"><a href="paper.html?id='+encodeURIComponent(idTail)+'">'+title+'</a></article>');
        }
      }
      $("relatedBlock").innerHTML = '<h2>Related papers</h2>' + (relatedHtml.length ? relatedHtml.join("") : "<p class='muted'>No related papers found.</p>");
      if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
        SE.components.enhancePaperCards($("relatedBlock"));
      }
    } catch (e) {
      console.error(e);
      $("paperHeaderMain").innerHTML = "<p class='muted'>Error loading paper details.</p>";
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
