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
    var url = API + "/works?filter=cites:" + encodeURIComponent(idTail) + "&per_page=20";
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

  // ---------- NEW: Quality helper utilities ----------
  function doiFromWork(p){
    var doiRaw = p.doi || get(p,"ids.doi",null);
    if (!doiRaw) return null;
    return String(doiRaw).replace(/^doi:/i,"");
  }

  function pubPeerLink(doi){
    return doi ? ("https://pubpeer.com/search?q=" + encodeURIComponent(doi)) : null;
  }

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

  function computeJournalScore(src){
    // Transparent, adjustable heuristic:
    // Start at 3; adjust with observable metadata.
    var score = 3;

    if (get(src, "is_in_doaj", false)) score += 1;      // indexed in DOAJ
    if (get(src, "is_oa", false)) score += 1;           // OA journal

    var works = +get(src, "works_count", 0) || 0;
    if (works > 10000) score += 1;
    if (works < 100) score -= 1;

    var type = String(get(src, "type", "") || "").toLowerCase();
    if (type.includes("repository") || type.includes("preprint")) score = Math.max(1, score - 2);

    // Clamp 1–5
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

    // NEW: PubPeer badge if DOI present
    var doiClean = doiFromWork(p);
    var pp = pubPeerLink(doiClean);
    if (pp) chips.push(badge(pp, "PubPeer", "badge-neutral"));

    // NEW: quick retraction search link (non-invasive small badge)
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
    // PubPeer badge
    if (pubpeer) badges.push('<a class="badge" href="'+pubpeer+'" target="_blank" rel="noopener">PubPeer</a>');
    // Retraction search (first link)
    if (rwLinks.length) badges.push('<a class="badge badge-warn" href="'+rwLinks[0].href+'" target="_blank" rel="noopener">Retraction search</a>');

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

    // Journal score (1–5)
    lines.push(
      '<div class="panel light" style="margin-top:.5rem;">' +
        '<div style="display:flex; align-items:center; gap:.5rem;">' +
          '<strong>Journal score (beta):</strong> ' +
          '<span aria-label="Journal score" title="'+escapeHtml(scoreExplain)+'">' + '★'.repeat(score) + '☆'.repeat(5-score) + '</span>' +
          '<span class="muted">('+score+'/5)</span>' +
        '</div>' +
        '<p class="muted" style="margin:.25rem 0 0 .1rem;">' +
          'Heuristic based on DOAJ/OA status, venue type, and size. Hover to see factors. Treat as a quick orientation, not a definitive judgment.' +
        '</p>' +
      '</div>'
    );

    // Small footer note for transparency
    var vt = String(venueType||'').toLowerCase();
    var peerReviewNote = isPreprint
      ? 'Preprints are valuable for speed but typically lack formal peer review. Check PubPeer for discussion.'
      : (hasOpenPeerReview(journalName) ? 'This journal often exposes peer-review reports (open/transparent peer review).' : 'Peer-review details vary by journal.');
    lines.push('<p class="muted" style="margin-top:.25rem;">'+escapeHtml(peerReviewNote)+'</p>');

    $("journalBlock").innerHTML = lines.join("");
  }

  // ---------- Graph ----------
  function shortCitation(p){
    var first = get(p,"authorships.0.author.display_name","Unknown");
    var last = first.split(" ").slice(-1)[0] || first || "Unknown";
    var yr = (p.publication_year != null ? p.publication_year : "n.d.");
    return last + " et al., " + yr;
  }

  function renderGraph(main, cited, citing){
    var block = $("graphBlock");
    block.innerHTML = '<h2>Connected Papers</h2><div id="paperGraph" class="panel" style="height:600px"></div>';

    if (!window.vis || !vis.Network){
      block.insertAdjacentHTML("beforeend", "<p class='muted'>Graph library not loaded.</p>");
      return;
    }

    var nodes = [{ id: main.id, label: shortCitation(main), title: main.display_name, group: "main", paperId: main.id }];
    for (var i=0;i<cited.length;i++)  nodes.push({ id: cited[i].id,  label: shortCitation(cited[i]),  title: cited[i].display_name,  group: "cited",  paperId: cited[i].id });
    for (var j=0;j<citing.length;j++) nodes.push({ id: citing[j].id, label: shortCitation(citing[j]), title: citing[j].display_name, group: "citing", paperId: citing[j].id });

    var edges = [];
    for (var k=0;k<cited.length;k++)  edges.push({ from: main.id, to: cited[k].id });
    for (var m=0;m<citing.length;m++) edges.push({ from: citing[m].id, to: main.id });

    var network = new vis.Network(
      document.getElementById("paperGraph"),
      { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
      { nodes: { shape: "dot", size: 15, font: { size: 14 } }, edges: { arrows: "to" }, physics: { stabilization: true }, interaction: { hover: true } }
    );

    network.on("click", function (params) {
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var found = null;
      for (var i=0;i<nodes.length;i++){ if (nodes[i].id === nodeId){ found = nodes[i]; break; } }
      if (found && found.paperId){
        var shortId = String(found.paperId).replace(/^https?:\/\/openalex\.org\//i, "");
        window.location.href = "paper.html?id=" + encodeURIComponent(shortId);
      }
    });
  }

  // ---------- Render ----------
  function renderPaper(p, source){
    // Header main (title/meta/authors/affiliations/chips)
    $("paperHeaderMain").innerHTML = buildHeaderMain(p);

    // Right column: actions + stat boxes
    $("paperActions").innerHTML   = buildActionsBar(p);
    $("paperStats").innerHTML     = buildStatsHeader(p);

    wireHeaderToggles();

    // Hook your shared behaviors (save/cite) on header card
    if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
      SE.components.enhancePaperCards($("paperActions"));
    }

    // Abstract
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

    // Topics
    var concepts = Array.isArray(p.concepts) ? p.concepts.slice() : [];
    concepts.sort(function(x,y){ return (y.score||0)-(x.score||0); });
    $("topicsBlock").innerHTML = concepts.length
      ? concepts.slice(0,12).map(function(c){
          var tid = (c.id ? c.id.split("/").pop() : "");
          return '<a class="topic-card" href="topic.html?id='+tid+'"><span class="topic-name">'+escapeHtml(c.display_name||"Topic")+'</span></a>';
        }).join("")
      : "<p class='muted'>No topics listed.</p>";
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

      // Graph (resilient)
      renderGraph(paper, cited, citing);

      // Related block
      var relatedHtml = [];
      var joinFew = (cited.slice(0,8).concat(citing.slice(0,8))).slice(0,16);
      for (var i=0;i<joinFew.length;i++){
        var w = joinFew[i];
        if (window.SE && SE.components && typeof SE.components.renderPaperCard === "function") {
          relatedHtml.push(SE.components.renderPaperCard(w, { compact: true }));
        } else {
          // Simple fallback
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
