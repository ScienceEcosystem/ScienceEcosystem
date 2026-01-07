// scripts/paper.js
(function () {
  if (!document.body || document.body.dataset.page !== "paper") return;

  // ---------- Constants ----------
  var API = "https://api.openalex.org";
  var MAILTO = "info@scienceecosystem.org";

  var OPEN_PEER_REVIEW_JOURNALS = [
    "eLife","F1000Research","PeerJ","Royal Society Open Science","BMJ","BMC","Nature Communications","PLOS ONE","PLOS Biology"
  ];
  var PREPRINT_VENUES = [
    "arXiv","bioRxiv","medRxiv","ChemRxiv","SSRN","OSF Preprints","PsyArXiv","EarthArXiv","Research Square"
  ];

  // ---------- Globals ----------
  var __CURRENT_PAPER__ = null;
  var __HEADER_HTML_SNAPSHOT__ = null;
  window.__GRAPH_CTX__ = { main: null, cited: [], citing: [] };
  var __HEADER_OBSERVER__ = null;

  // ---------- Helpers ----------
  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function escapeHtml(str){
    str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, function(c){
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"})[c];
    });
  }
  function get(obj, path, fb){
    try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; }
    catch(e){ return fb; }
  }
  function idTailFrom(anyId){ return anyId ? String(anyId).replace(/^https?:\/\/openalex\.org\//i,"") : ""; }

  function addMailto(u){
    var url = new URL(u, API);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }

  async function getJSON(url){
    var withMt = url.indexOf(API) === 0 ? addMailto(url) : url;
    for (var attempt = 1; attempt <= 4; attempt++){
      try {
        var res = await fetch(withMt, { headers: { "Accept": "application/json" } });
        if (res.status === 429){
          var ra = parseInt(res.headers.get("Retry-After") || "1", 10);
          await new Promise(r=>setTimeout(r, Math.min(ra,6)*1000));
          continue;
        }
        if (res.status === 401 && attempt < 4){
          await new Promise(r=>setTimeout(r, 600*attempt));
          continue;
        }
        if (!res.ok) throw new Error(res.status + " " + res.statusText);
        return await res.json();
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise(r=>setTimeout(r, 350*attempt));
      }
    }
    throw new Error("Unreachable");
  }

  function normalizePaperId(raw){
    if (!raw) return "";
    var s = raw;
    try { s = decodeURIComponent(s); } catch(e){}
    s = s.trim();
    if (s.indexOf("/") !== -1 && s.indexOf("openalex.org/") !== -1) s = s.split("/").filter(Boolean).pop();
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
  function doiFromWork(p){
    var doiRaw = p.doi || get(p,"ids.doi",null);
    if (!doiRaw) return null;
    return String(doiRaw).replace(/^doi:/i,"");
  }

  // ---------- Fetchers ----------
  async function fetchPaperData(paperId){
    var id = normalizePaperId(paperId);
    return await getJSON(API + "/works/" + encodeURIComponent(id));
  }
  async function fetchSourceFromPaper(p){
    var srcId = get(p, "host_venue.id", null) || get(p, "primary_location.source.id", null);
    if (!srcId) return null;
    var tail = srcId.split("/").pop();
    try { return await getJSON(API + "/sources/" + encodeURIComponent(tail)); } catch(e){ return null; }
  }
  async function fetchCitedPapers(refs){
    if (!Array.isArray(refs) || !refs.length) return [];
    var ids = refs.slice(0, 200).map(function(id){
      var tail = id.split("/").pop();
      return "https://openalex.org/" + tail;
    }).join("|");
    var url = API + "/works?filter=ids.openalex:" + encodeURIComponent(ids) + "&per_page=200";
    var data = await getJSON(url);
    return Array.isArray(data.results) ? data.results : [];
  }
  async function fetchCitingPapers(paperOpenAlexIdOrUrl){
    var s = String(paperOpenAlexIdOrUrl || "");
    var idTail = s.replace(/^https?:\/\/openalex\.org\//i, "");
    var url = API + "/works?filter=cites:" + encodeURIComponent(idTail) + "&per_page=200&sort=cited_by_count:desc";
    var data = await getJSON(url);
    return Array.isArray(data.results) ? data.results : [];
  }

  // ---------- Research Objects ----------
  async function fetchCrossrefRelations(doi){
    if (!doi) return [];
    try{
      var data = await getJSON("https://api.crossref.org/works/" + encodeURIComponent(doi));
      var rel = get(data, "message.relation", {}) || {};
      var out = [];
      Object.keys(rel).forEach(function(k){
        var arr = Array.isArray(rel[k]) ? rel[k] : [];
        arr.forEach(function(r){
          var rid = r.DOI || r.id || "";
          var url = r.url || (rid ? ("https://doi.org/"+rid) : "");
          out.push({
            provenance: "Crossref",
            typeHint: k || "",
            title: rid || k || "Related item",
            doi: rid || "",
            url: url
          });
        });
      });
      return out;
    }catch(e){ return []; }
  }
  async function fetchDataCiteBacklinks(doi){
    if (!doi) return [];
    var q = 'relatedIdentifiers.identifier:"' + doi.replace(/"/g,'\\"') + '"';
    try{
      var data = await getJSON("https://api.datacite.org/works?query="+encodeURIComponent(q)+"&page[size]=200");
      var hits = Array.isArray(get(data,"data",[])) ? data.data : [];
      return hits.map(function(rec){
        var a = rec.attributes || {};
        var t = (Array.isArray(a.titles) && a.titles[0] && a.titles[0].title) ? a.titles[0].title : (a.title || "");
        var typeGen = (get(a,"types.resourceTypeGeneral","") || "").toLowerCase();
        var kind = typeGen.includes("software") ? "Software" : (typeGen.includes("dataset") ? "Dataset" : "Other");
        return {
          provenance: "DataCite",
          type: kind,
          title: t,
          doi: a.doi || "",
          url: a.url || (a.doi ? "https://doi.org/"+a.doi : ""),
          repository: (a.publisher || "")
        };
      });
    }catch(e){ return []; }
  }
  async function fetchZenodoBacklinks(doi){
    if (!doi) return [];
    try{
      var q1 = 'related.identifiers.identifier:"' + doi.replace(/"/g,'\\"') + '"';
      var a = await getJSON("https://zenodo.org/api/records/?q="+encodeURIComponent(q1)+"&size=200");
      var hits = Array.isArray(a.hits && a.hits.hits) ? a.hits.hits : [];
      if (!hits.length){
        var q2 = 'metadata.related_identifiers.identifier:"' + doi.replace(/"/g,'\\"') + '"';
        var b = await getJSON("https://zenodo.org/api/records/?q="+encodeURIComponent(q2)+"&size=200");
        hits = Array.isArray(b.hits && b.hits.hits) ? b.hits.hits : [];
      }
      return hits.map(function(h){
        var md = h.metadata || {};
        var typeGen = (get(md,"resource_type.type","") || "").toLowerCase();
        var kind = typeGen.includes("software") ? "Software" : (typeGen.includes("dataset") ? "Dataset" : "Other");
        var title = md.title || "";
        var doiZ = md.doi || (h.doi) || "";
        var urlZ = h.links && h.links.html ? h.links.html : (doiZ ? "https://doi.org/"+doiZ : "");
        return {
          provenance: "Zenodo",
          type: kind,
          title: title,
          doi: doiZ || "",
          url: urlZ,
          repository: "Zenodo",
          version: md.version || "",
          licence: (md.license && (md.license.id || md.license)) || ""
        };
      });
    }catch(e){ return []; }
  }
  function tokenize(s){
    return String(s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean);
  }
  function jaccardTokens(a, b){
    var A = new Set(tokenize(a));
    var B = new Set(tokenize(b));
    var inter = 0; A.forEach(function(x){ if (B.has(x)) inter++; });
    var uni = A.size + B.size - inter;
    return uni ? inter/uni : 0;
  }
  function classifyROKind(str){
    var s = String(str||"").toLowerCase();
    if (s.includes("software") || s.includes("code")) return "Software";
    if (s.includes("dataset") || s.includes("data")) return "Dataset";
    return "Other";
  }
  function uniqueByKey(arr, keyFn){
    var seen = Object.create(null), out = [];
    for (var i=0;i<arr.length;i++){
      var k = keyFn(arr[i]);
      if (!k || seen[k]) continue;
      seen[k] = true;
      out.push(arr[i]);
    }
    return out;
  }
  function uniqueNodes(nodes){
    var seen = new Set();
    var out = [];
    for (var i=0;i<nodes.length;i++){
      var id = String(nodes[i].id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(nodes[i]);
    }
    return out;
  }
  async function harvestAndFilterResearchObjects(paper){
    var doi = normalizeDOI(paper.doi || get(paper,"ids.doi",""));
    var title = paper.display_name || "";
    var all = [];
    // Backend-backed artifacts to avoid browser CORS and catch Zenodo/DataCite quickly
    if (doi) {
      try {
        var back = await fetch("/api/paper/artifacts?doi="+encodeURIComponent(doi));
        if (back.ok) {
          var arr = await back.json();
          if (Array.isArray(arr)) arr.forEach(function(x){ all.push(x); });
        }
      } catch(_) {}
    }
    try { (await fetchCrossrefRelations(doi)).forEach(function(r){
      all.push({
        provenance:"Crossref",
        type: classifyROKind(r.typeHint || ""),
        title: r.title || r.doi || "",
        doi: r.doi || "",
        url: r.url || (r.doi ? ("https://doi.org/"+r.doi) : "")
      });
    }); } catch(e){}
    try { (await fetchDataCiteBacklinks(doi)).forEach(function(r){ all.push(r); }); } catch(e){}
    try { (await fetchZenodoBacklinks(doi)).forEach(function(r){ all.push(r); }); } catch(e){}
    // Publisher page scrape for code/data hosts
    try {
      var landing = paper.primary_location?.landing_page_url || paper.open_access?.oa_url || null;
      var scrapeUrl = landing || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : null);
      if (scrapeUrl){
        var resp = await fetch(`/api/paper/links?${doi ? ("doi="+encodeURIComponent(doi)) : ("url="+encodeURIComponent(scrapeUrl))}`);
        if (resp.ok){
          var links = await resp.json();
          links.forEach(function(h){
            all.push({
              provenance: h.provenance || "Publisher page",
              type: classifyROKind(h.url || ""),
              title: h.url,
              url: h.url
            });
          });
        }
      }
    } catch(_) {}

    var dedup = uniqueByKey(all, function(x){
      return (x.doi && x.doi.toLowerCase()) || (String(x.title||"").toLowerCase()+"|"+String(x.url||"").toLowerCase());
    });

    var filtered = dedup.filter(function(x){
      if (!x) return false;
      if (x.doi && doi && normalizeDOI(x.doi) === doi) return true;
      var sim = jaccardTokens(title, x.title || "");
      if (x.type === "Other") return sim >= 0.28;
      return sim >= 0.18;
    });

    var provRank = { DataCite:3, Zenodo:2, Crossref:1 };
    filtered.sort(function(a,b){
      var ta = (a.type==="Dataset"||a.type==="Software") ? 1 : 0;
      var tb = (b.type==="Dataset"||b.type==="Software") ? 1 : 0;
      if (ta!==tb) return tb - ta;
      var pa = provRank[a.provenance] || 0;
      var pb = provRank[b.provenance] || 0;
      if (pa!==pb) return pb - pa;
      return (a.title||"").localeCompare(b.title||"");
    });

    return filtered;
  }

  // ---------- Header & Funding ----------
  function badge(href, text, className){
    if (!href) return "";
    return '<a class="badge ' + (className||"") + '" href="'+escapeHtml(href)+'" target="_blank" rel="noopener">'+escapeHtml(text)+'</a>';
  }
  function authorLinksList(authorships){
    if (!Array.isArray(authorships) || !authorships.length) return { allHtml:"Unknown authors", shortHtml:"Unknown authors", moreCount:0 };
    var out = [];
    for (var i=0;i<authorships.length;i++){
      var id = get(authorships[i],"author.id",null);
      var name = escapeHtml(get(authorships[i],"author.display_name","Unknown"));
      if (!id) { out.push(name); continue; }
      var aid = id.split("/").pop();
      out.push('<a href="profile.html?id='+encodeURIComponent(aid)+'">'+name+'</a>');
    }
    var short = out.slice(0,8);
    return { allHtml: out.join(", "), shortHtml: short.join(", "), moreCount: Math.max(0, out.length - short.length) };
  }
  function collectInstitutions(authorships){
    var map = Object.create(null), out = [];
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
    if (!list.length) return { shortHtml: "-", allHtml: "-", moreCount: 0 };
    function render(item){
      if (item.idTail) return '<a href="institution.html?id='+encodeURIComponent(item.idTail)+'">'+escapeHtml(item.name)+'</a>';
      return escapeHtml(item.name);
    }
    var short = list.slice(0,8).map(render).join(", ");
    var full  = list.map(render).join(", ");
    return { shortHtml: short, allHtml: full, moreCount: Math.max(0, list.length - 8) };
  }
  function sourceTailFromPaper(p){
    var srcId = get(p, "host_venue.id", null) || get(p, "primary_location.source.id", null);
    return srcId ? idTailFrom(srcId) : "";
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
  function computeJournalScore(src){
    var score = 3;
    if (get(src, "is_in_doaj", false)) score += 1;
    if (get(src, "is_oa", false)) score += 1;
    var works = +get(src, "works_count", 0) || 0;
    if (works > 10000) score += 1;
    if (works < 100) score -= 1;
    var type = String(get(src, "type", "") || "").toLowerCase();
    if (type.includes("repository") || type.includes("preprint")) score = Math.max(1, score - 2);
    return Math.max(1, Math.min(5, score));
  }

  function buildFundingRow(p){
    var grants = Array.isArray(p.grants) ? p.grants : [];
    var funderNames = Array.isArray(p.funder_display_names) ? p.funder_display_names : [];
    var items = [];

    if (grants.length){
      for (var i=0;i<grants.length;i++){
        var g = grants[i];
        var fIdTail = g.funder ? idTailFrom(g.funder) : "";
        var name = g.funder_display_name || (fIdTail ? fIdTail : "Funder");
        var label = escapeHtml(name) + (g.award_id ? (" - " + escapeHtml(g.award_id)) : "");
        if (fIdTail) items.push('<a href="funders.html?id='+encodeURIComponent(fIdTail)+'">'+label+'</a>');
        else items.push(label);
      }
    } else if (funderNames.length){
      for (var j=0;j<funderNames.length;j++){
        items.push(escapeHtml(funderNames[j]));
      }
    }

    if (!items.length) return "";
    return '<p class="meta-row"><strong>Funding:</strong> <span class="wrap-text">'+ items.join(" · ") +'</span></p>';
  }

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

    var aList = authorLinksList(p.authorships);
    var affList = institutionsLinksHTML(p.authorships);
    var fundingRow = buildFundingRow(p);

    return ''
      + '<h1 class="paper-title">'+escapeHtml(title)+'</h1>'
      + '<p class="meta"><span class="muted">'+escapeHtml(String(year))+'</span> · <strong>Published in:</strong> '+venueHtml+'</p>'
      + '<p class="meta-row"><strong>Authors:</strong> '
        + '<span class="wrap-text" id="authorsShort">'+aList.shortHtml+(aList.moreCount?(' <button class="link-btn" id="authorsShowMore">Show more</button>'):'')+'</span>'
        + '<span class="wrap-text" id="authorsFull" style="display:none;">'+aList.allHtml+' <button class="link-btn" id="authorsShowLess">Show less</button></span>'
      + '</p>'
      + '<p class="meta-row"><strong>Affiliations:</strong> '
        + '<span class="wrap-text" id="affShort">'+affList.shortHtml+(affList.moreCount?(' <button class="link-btn" id="affShowMore">Show more</button>'):'')+'</span>'
        + '<span class="wrap-text" id="affFull" style="display:none;">'+affList.allHtml+' <button class="link-btn" id="affShowLess">Show less</button></span>'
      + '</p>'
      + (fundingRow || "")
      + '<p class="chips">'+chips.filter(Boolean).join(" ")+'</p>';
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
    return {
      title: work.display_name || "Untitled",
      year: (work.publication_year != null ? String(work.publication_year) : "n.d."),
      venue: venue,
      volume: get(work,"biblio.volume","") || "",
      issue: get(work,"biblio.issue","") || "",
      pages: pages,
      doi: doiClean,
      doi_url: doiHref,
      url: get(work,"primary_location.landing_page_url","") || doiHref || (work.id || ""),
      authors: authors
    };
  }
  function buildActionsBar(p){
    var idTail = String(p.id||"").replace(/^https?:\/\/openalex\.org\//i,"");
    var doi = p.doi || get(p,"ids.doi",null) || "";
    var cite = collectCiteDataForHeader(p);
    function attr(v){ return v ? escapeHtml(String(v)) : ""; }
    return ''
      + '<article class="paper-card header-card" data-paper-id="'+attr(idTail)+'" '+(doi ? 'data-doi="'+attr(String(doi).replace(/^doi:/i,""))+'"' : '')+''
      + ' data-cite-title="'+attr(cite.title)+'" data-cite-year="'+attr(cite.year)+'" data-cite-venue="'+attr(cite.venue)+'"'
      + ' data-cite-volume="'+attr(cite.volume)+'" data-cite-issue="'+attr(cite.issue)+'" data-cite-pages="'+attr(cite.pages)+'"'
      + ' data-cite-doi="'+attr(cite.doi)+'" data-cite-doiurl="'+attr(cite.doi_url)+'" data-cite-url="'+attr(cite.url)+'"'
      + ' data-cite-authors="'+attr((cite.authors||[]).join(" | "))+'">'
        + '<div class="header-actions-inner">'
          + '<button class="btn btn-secondary btn-save" data-action="save-paper" aria-label="Add to Library">Add to Library</button>'
          + '<button class="btn btn-secondary btn-cite" data-action="open-cite" aria-haspopup="dialog" aria-expanded="false">Cite</button>'
          + '<div class="cite-popover" role="dialog" aria-label="Cite this paper" hidden '
            + 'style="position:absolute; z-index:9999; max-width:640px; width:min(92vw,640px); box-shadow:0 8px 24px rgba(0,0,0,.18); border:1px solid #e5e7eb; border-radius:12px; background:#fff; padding:12px;"></div>'
        + '</div>'
      + '</article>';
  }
  function buildStatsHeader(p){
    var citedBy = get(p,'cited_by_count',0) || 0;
    var refCount = Array.isArray(p.referenced_works) ? p.referenced_works.length : 0;
    function stat(label, value){
      return '<div class="stat"><div class="stat-value">'+escapeHtml(String(value))+'</div><div class="stat-label">'+escapeHtml(label)+'</div></div>';
    }
    return stat('Citations', citedBy) + stat('References used', refCount) + stat('Altmetric', '-');
  }

  // ---------- Journal & Quality (simplified + PubPeer/RW) ----------
  function renderJournalBlockSimple(p, source){
    var journalName = get(source, 'display_name', null) || get(p, 'host_venue.display_name', null) || get(p, 'primary_location.source.display_name', '-');
    var venueType  = get(source, 'type', get(p, 'primary_location.source.type', '-'));
    var sourceTail = source ? idTailFrom(source.id) : sourceTailFromPaper(p);
    var journalLinkHtml = sourceTail
      ? '<a href="journal.html?id='+encodeURIComponent(sourceTail)+'">'+escapeHtml(journalName)+'</a>'
      : escapeHtml(journalName);

    var isPreprint = isPreprintVenue(journalName, venueType);
    var peerText = isPreprint ? "Preprint / repository (not peer reviewed)" :
      (hasOpenPeerReview(journalName) ? "Peer reviewed (open/transparent)" : "Peer reviewed");

    var stars = computeJournalScore(source || {});
    var starStr = "★".repeat(stars) + "☆".repeat(5 - stars);

    var doi = doiFromWork(p);
    var pubpeerHref = doi ? ("https://pubpeer.com/search?q=" + encodeURIComponent(doi)) : "";
    var rwHrefTitle = "https://retractionwatch.com/?s=" + encodeURIComponent(p.display_name || "");

    var checks = '';
    checks += '<div class="panel light" style="margin-top:.5rem;">';
    checks += '<strong>Quality checks:</strong> ';
    if (pubpeerHref) checks += '<a href="'+escapeHtml(pubpeerHref)+'" target="_blank" rel="noopener">PubPeer</a>';
    else checks += '<span class="muted">PubPeer (no DOI)</span>';
    checks += ' · <a href="'+escapeHtml(rwHrefTitle)+'" target="_blank" rel="noopener">Retraction Watch</a>';
    checks += '</div>';

    $("journalBlock").innerHTML =
      '<p><strong>Published in:</strong> '+journalLinkHtml+'</p>' +
      '<p class="meta"><strong>Peer review:</strong> '+escapeHtml(peerText)+'</p>' +
      '<div class="panel light" style="margin-top:.5rem;"><strong>Journal rating:</strong> '+
        '<span aria-label="Journal rating">'+starStr+'</span> <span class="muted">('+stars+'/5)</span>'+
      '</div>' +
      checks;
  }

  // ---------- Abstract ----------
  function formatAbstract(idx){
    if (!idx || typeof idx !== "object") return "<em>No abstract available.</em>";
    var words = [];
    var keys = Object.keys(idx);
    for (var i=0;i<keys.length;i++){
      var word = keys[i], positions = idx[word] || [];
      for (var j=0;j<positions.length;j++) words[positions[j]] = word;
    }
    return escapeHtml(words.join(" ") || "");
  }

  // ---------- Graph ----------
  function shortCitation(p){
    var first = get(p,"authorships.0.author.display_name","Unknown");
    var last = first.split(" ").slice(-1)[0] || first || "Unknown";
    var yr = (p.publication_year != null ? p.publication_year : "n.d.");
    return last + " et al., " + yr;
  }
  function hsvToHex(h, s, v){
    var c = v * s, x = c * (1 - Math.abs(((h/60)%2) - 1)), m = v - c, r=0,g=0,b=0;
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
    var h = (1 - t) * 220;
    return hsvToHex(h, 0.55, 0.95);
  }

  function refSetFromIds(idList){
    var s = new Set();
    for (var i=0;i<idList.length;i++){
      var tail = String(idList[i]).split("/").pop();
      if (tail) s.add(tail);
    }
    return s;
  }
  var CACHE_PREFIX = "se_refmap_v1:", CACHE_TTL_MS = 1000*60*60*24*7;
  function cacheKey(idTail){ return CACHE_PREFIX + idTail; }
  function cacheSet(idTail, setArr){
    try{ localStorage.setItem(cacheKey(idTail), JSON.stringify({ t: Date.now(), refs:Array.from(setArr||[]) })); }catch(e){}
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
      var data = await getJSON(API + "/works?filter=ids.openalex:" + encodeURIComponent(ids) + "&per_page=" + slice.length);
      var results = data && Array.isArray(data.results) ? data.results : [];
      for (var k=0;k<results.length;k++){
        var w = results[k];
        var tailW = String(w.id).split("/").pop();
        var refs = Array.isArray(w.referenced_works) ? w.referenced_works.map(function(r){ return String(r).split("/").pop(); }) : [];
        var set = new Set(refs);
        out[tailW] = set;
        cacheSet(tailW, set);
      }
    }
    return out;
  }
  function jaccardSets(aSet, bSet){
    var inter = 0; aSet.forEach(function(x){ if (bSet.has(x)) inter++; });
    var uni = aSet.size + bSet.size - inter;
    return uni ? inter/uni : 0;
  }
  async function buildConnectedLikeGraph(seed, cited, citing, opts){
    opts = opts || {};
    var MAX_REF = opts.maxReferences || 180;
    var MAX_CIT = opts.maxCiters || 180;
    var THRESH = opts.jaccardThreshold || 0.08;

    var refs = Array.isArray(seed.referenced_works) ? seed.referenced_works.slice(0, MAX_REF) : [];
    var candTails = refs.map(function(x){ return String(x).split("/").pop(); });

    var citingTrim = (citing||[]).slice(0, MAX_CIT);
    for (var i=0;i<citingTrim.length;i++){
      var tail = String(citingTrim[i].id||"").split("/").pop();
      if (tail && candTails.indexOf(tail) === -1) candTails.push(tail);
    }

    var refMap = await fetchRefsFor(candTails);
    var edges = [];
    for (var a=0;a<candTails.length;a++){
      for (var b=a+1;b<candTails.length;b++){
        var A = candTails[a], B = candTails[b];
        var sA = refMap[A], sB = refMap[B];
        if (!sA || !sB) continue;
        var sim = jaccardSets(sA, sB);
        if (sim >= THRESH) edges.push({ a:A, b:B, w:sim });
      }
    }
    var seedRefSet = refSetFromIds(refs);
    for (var c=0;c<candTails.length;c++){
      var t = candTails[c];
      var sCand = refMap[t];
      if (!sCand || seedRefSet.size === 0) continue;
      var simSeed = jaccardSets(seedRefSet, sCand);
      if (simSeed >= Math.max(0.04, THRESH * 0.6)){ edges.push({ a: idTailFrom(seed.id), b: t, w: simSeed }); }
    }
    return { candidateIds: candTails, edges: edges };
  }
  function filterToSeedComponent(edgesWeighted, allNodeIds, seedIdFull){
    var adj = Object.create(null);
    for (var i=0;i<allNodeIds.length;i++){ adj[allNodeIds[i]] = []; }
    for (var j=0;j<edgesWeighted.length;j++){
      var e = edgesWeighted[j];
      var a = "https://openalex.org/" + e.a;
      var b = "https://openalex.org/" + e.b;
      (adj[a] = adj[a] || []).push(b);
      (adj[b] = adj[b] || []).push(a);
    }
    var visited = new Set([seedIdFull]);
    var queue = [seedIdFull];
    while (queue.length){
      var u = queue.shift();
      var nbrs = adj[u] || [];
      for (var k=0;k<nbrs.length;k++){
        var v = nbrs[k];
        if (!visited.has(v)){ visited.add(v); queue.push(v); }
      }
    }
    return visited;
  }

  function baseNetworkOptions(){
    return {
      nodes: { shape:"dot", scaling:{min:6,max:28}, font:{size:14} },
      edges: { smooth:true },
      physics: { stabilization:true, barnesHut:{ gravitationalConstant:-6500, springConstant:0.02, avoidOverlap:0.2 } },
      interaction: { hover:true }
    };
  }

  function renderGraphControls(){
    var el = document.createElement("div");
    el.id = "graphControls";
    el.className = "panel light";
    el.style.marginBottom = "8px";
    el.style.padding = "10px";
    el.innerHTML = ''
      + '<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:end;">'
        + '<label style="display:flex; flex-direction:column; font-size:12px;">Mode'
          + '<select id="graphMode" style="min-width:180px;">'
            + '<option value="connected">Connected Map (similarity)</option>'
            + '<option value="citation">Cited/Citing</option>'
          + '</select>'
        + '</label>'
        + '<label style="display:flex; flex-direction:column; font-size:12px;">Min similarity'
          + '<input id="minSim" type="number" step="0.01" min="0" max="1" value="0.10" />'
        + '</label>'
        + '<label style="display:flex; flex-direction:column; font-size:12px;">Min citations'
          + '<input id="minCites" type="number" min="0" value="0" />'
        + '</label>'
        + '<label style="display:flex; flex-direction:column; font-size:12px;">Year range'
          + '<div style="display:flex; gap:6px; align-items:center;">'
            + '<input id="minYear" type="number" placeholder="min" style="width:90px;" />'
            + '<span>–</span>'
            + '<input id="maxYear" type="number" placeholder="max" style="width:90px;" />'
          + '</div>'
        + '</label>'
        + '<button id="applyGraphFilters" class="btn btn-secondary" type="button">Apply</button>'
      + '</div>'
      + '<p class="muted small" style="margin-top:6px;">Connected Map uses similarity + year/citation filters. Citation mode shows direct references and citations; similarity is ignored there.</p>';
    return el;
  }

  function updateGraphControlState(){
    var mode = $("#graphMode") ? $("#graphMode").value : "citation";
    var simInput = $("#minSim");
    if (simInput){
      simInput.disabled = (mode !== "connected");
      simInput.title = mode === "connected" ? "Keep edges above this similarity" : "Only used in Connected Map";
    }
  }

  async function renderCitationGraph(main, cited, citing){
    window.__GRAPH_CTX__ = { main: main, cited: cited, citing: citing };
    var block = $("graphBlock");
    block.innerHTML = '<h2>Connected Papers</h2>';
    block.appendChild(renderGraphControls());
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
    for (var i=0;i<cited.length;i++){ nodes.push({ id: cited[i].id,  label: shortCitation(cited[i]),  title: cited[i].display_name,  group: "cited",  paperId: cited[i].id }); }
    for (var j=0;j<citing.length;j++){ nodes.push({ id: citing[j].id, label: shortCitation(citing[j]), title: citing[j].display_name, group: "citing", paperId: citing[j].id }); }
    nodes = uniqueNodes(nodes);

    var edges = [];
    for (var k=0;k<cited.length;k++){ edges.push({ from: main.id, to: cited[k].id, value: 1, width: 1 }); }
    for (var m=0;m<citing.length;m++){ edges.push({ from: citing[m].id, to: main.id, value: 1, width: 1 }); }

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
        if (mode === "connected") await renderConnectedGraph(main, cited, citing);
        else await renderCitationGraph(main, cited, citing);
      };
    }
    var modeSel = $("#graphMode");
    if (modeSel) {
      modeSel.value = "citation";
      modeSel.onchange = updateGraphControlState;
    }
    updateGraphControlState();

    repopulateHeaderIfEmpty(); restoreHeaderIfNeeded();
    renderBelowGraphLists(cited, citing);
  }

  async function renderConnectedGraph(main, cited, citing){
    window.__GRAPH_CTX__ = { main: main, cited: cited, citing: citing };
    var block = $("graphBlock");
    block.innerHTML = '<h2>Connected Papers</h2>';
    block.appendChild(renderGraphControls());
    var graphDiv = document.createElement("div");
    graphDiv.id = "paperGraph";
    graphDiv.className = "panel";
    graphDiv.style.height = "680px";
    block.appendChild(graphDiv);

    if (!window.vis || !vis.Network){
      block.insertAdjacentHTML("beforeend", "<p class='muted'>Graph library not loaded.</p>");
      return;
    }

    var minSimInput = $("#minSim"), minCitesInput = $("#minCites"), minYearInput = $("#minYear"), maxYearInput = $("#maxYear");
    var MIN_SIM = parseFloat(minSimInput ? (minSimInput.value || "0.10") : "0.10") || 0.10;
    var MIN_CITES = parseInt(minCitesInput ? (minCitesInput.value || "0") : "0", 10) || 0;
    var MIN_YEAR = parseInt(minYearInput ? (minYearInput.value || "0") : "0", 10) || 0;
    var MAX_YEAR = parseInt(maxYearInput ? (maxYearInput.value || "0") : "0", 10) || 0;

    var base = await buildConnectedLikeGraph(main, cited, citing, { maxReferences:220, maxCiters:220, jaccardThreshold:Math.max(0.04, MIN_SIM) });

    var candIdsFull = base.candidateIds.map(function(t){ return "https://openalex.org/"+t; });
    var meta = [];
    for (var i=0;i<candIdsFull.length;i+=50){
      var chunk = candIdsFull.slice(i, i+50).join("|");
      var data = await getJSON(API + "/works?filter=ids.openalex:" + encodeURIComponent(chunk) + "&per_page=50");
      if (data && Array.isArray(data.results)) meta = meta.concat(data.results);
    }

    var all = [main].concat(meta);
    var years = [];
    for (var y=0;y<all.length;y++){ var py = +get(all[y],"publication_year",0) || 0; if (py) years.push(py); }
    var minY = years.length ? Math.min.apply(null, years) : 0;
    var maxY = years.length ? Math.max.apply(null, years) : 0;

    var nodes = [];
    var keepSet = new Set();

    nodes.push({ id: main.id, label: shortCitation(main), title: main.display_name, group:"main", paperId: main.id,
      value: Math.max(1, +get(main,'cited_by_count',0)), color:{ background:"#111827", border:"#111827" } });
    keepSet.add(String(main.id));

    var metaByTail = Object.create(null);
    for (var mb=0;mb<meta.length;mb++){ metaByTail[String(meta[mb].id).split("/").pop()] = meta[mb]; }

    var tails = Object.keys(metaByTail);
    for (var t=0;t<tails.length;t++){
      var tail = tails[t], w = metaByTail[tail];
      var yr = +get(w,"publication_year",0) || 0;
      var cites = +get(w,"cited_by_count",0) || 0;
      if (MIN_CITES && cites < MIN_CITES) continue;
      if (MIN_YEAR && yr && yr < MIN_YEAR) continue;
      if (MAX_YEAR && yr && yr > MAX_YEAR) continue;
      var colorHex = yearColor(yr || minY, MIN_YEAR||minY, MAX_YEAR||maxY || maxY);
      nodes.push({ id:w.id, label:shortCitation(w), title:w.display_name, group:"candidate", paperId:w.id, value:Math.max(1,cites),
        year:yr, color:{ background:colorHex, border:colorHex } });
      keepSet.add(String(w.id));
    }

    var edges = [];
    for (var e=0;e<base.edges.length;e++){
      var E = base.edges[e];
      var aFull = E.a.indexOf("http")===0 ? E.a : ("https://openalex.org/"+E.a);
      var bFull = E.b.indexOf("http")===0 ? E.b : ("https://openalex.org/"+E.b);
      if (!keepSet.has(aFull) || !keepSet.has(bFull)) continue;
      if (E.w < MIN_SIM) continue;
      edges.push({ from:aFull, to:bFull, value:E.w, width: Math.max(1, 6*E.w) });
    }

    if (edges.length < 20 && base.edges.length){
      var top = base.edges.slice().sort(function(a,b){ return b.w - a.w; }).slice(0, 30);
      edges = [];
      for (var q=0;q<top.length;q++){
        var EE = top[q];
        var aF = EE.a.indexOf("http")===0 ? EE.a : ("https://openalex.org/"+EE.a);
        var bF = EE.b.indexOf("http")===0 ? EE.b : ("https://openalex.org/"+EE.b);
        edges.push({ from:aF, to:bF, value:EE.w, width: Math.max(1, 6*EE.w) });
      }
    }

    nodes = uniqueNodes(nodes);

    var allIds = [];
    for (var n=0;n<nodes.length;n++){ allIds.push(String(nodes[n].id)); }
    var reachable = filterToSeedComponent(
      base.edges.map(function(eX){ return { a: idTailFrom(eX.a.indexOf("http")===0 ? eX.a : ("https://openalex.org/"+eX.a)), b: idTailFrom(eX.b.indexOf("http")===0 ? eX.b : ("https://openalex.org/"+eX.b)), w:eX.w }; }),
      allIds, String(main.id)
    );
    var nodesFiltered = nodes.filter(function(n){ return reachable.has(String(n.id)); });
    var nodeIdsKept = new Set(nodesFiltered.map(function(n){ return String(n.id); }));
    var edgesFiltered = edges.filter(function(ed){ return nodeIdsKept.has(String(ed.from)) && nodeIdsKept.has(String(ed.to)); });

    var network = new vis.Network(graphDiv, { nodes:new vis.DataSet(nodesFiltered), edges:new vis.DataSet(edgesFiltered) }, baseNetworkOptions());
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
        if (mode === "citation") await renderCitationGraph(main, cited, citing);
        else await renderConnectedGraph(main, cited, citing);
      };
    }
    var gm = $("#graphMode");
    if (gm) {
      gm.value = "connected";
      gm.onchange = updateGraphControlState;
    }
    updateGraphControlState();

    repopulateHeaderIfEmpty(); restoreHeaderIfNeeded();
    renderBelowGraphLists(cited, citing);
  }

  // ---------- Below-graph lists ----------
  // Fallback compact card (used only if SE.components is unavailable)
  function paperCardCompact(w, badgeText){
    var title = escapeHtml(w.display_name || "Untitled");
    var idTail = String(w.id || "").replace(/^https?:\/\/openalex\.org\//i, "");
    var yr = (w.publication_year != null ? " ("+w.publication_year+")" : "");
    var venue = get(w,"host_venue.display_name", get(w,"primary_location.source.display_name","")) || "";
    var authors = ((w.authorships||[]).map(function(a){ return get(a,"author.display_name",""); }).filter(Boolean).slice(0,6).join(", "));
    var badge = badgeText ? ('<span class="badge">'+escapeHtml(badgeText)+'</span>') : '';
    return ''
      + '<article class="result-card">'
        + '<h3 class="result-title"><a href="paper.html?id='+encodeURIComponent(idTail)+'">'+title+'</a>'+yr+'</h3>'
        + '<p class="muted">'+escapeHtml(authors)+(authors && venue ? " - " : "")+escapeHtml(venue)+'</p>'
        + '<p class="chips">'+badge+'</p>'
      + '</article>';
  }

  function renderBelowGraphLists(citedPapers, citingPapers){
    var block = $("relatedBlock");
    if (!block) return;

    // Containers
    var html = [];
    html.push('<h2>References & Citations</h2>');

    // Referenced
    html.push('<section class="panel light" style="margin-bottom:12px;">');
    html.push('<h3>Papers this work <em>cites</em></h3>');
    html.push('<div id="refsList" class="cards-wrap"></div>');
    html.push('</section>');

    // Cited-by
    html.push('<section class="panel light">');
    html.push('<h3>Papers that <em>cite</em> this work</h3>');
    html.push('<div id="citedByList" class="cards-wrap"></div>');
    html.push('</section>');

    block.innerHTML = html.join("");

    // Render with shared component if available
    var hasComponent = !!(window.SE && SE.components && typeof SE.components.renderPaperCard === "function");
    var refsWrap = $("refsList");
    var citedByWrap = $("citedByList");

    if (hasComponent){
      if (Array.isArray(citedPapers) && citedPapers.length){
        for (var i=0;i<citedPapers.length;i++){
          refsWrap.insertAdjacentHTML("beforeend", SE.components.renderPaperCard(citedPapers[i], { compact: true }));
        }
        if (typeof SE.components.enhancePaperCards === "function") SE.components.enhancePaperCards(refsWrap);
      } else {
        refsWrap.innerHTML = '<p class="muted">No referenced papers found.</p>';
      }

      if (Array.isArray(citingPapers) && citingPapers.length){
        for (var j=0;j<citingPapers.length;j++){
          citedByWrap.insertAdjacentHTML("beforeend", SE.components.renderPaperCard(citingPapers[j], { compact: true }));
        }
        if (typeof SE.components.enhancePaperCards === "function") SE.components.enhancePaperCards(citedByWrap);
      } else {
        citedByWrap.innerHTML = '<p class="muted">No citing papers found.</p>';
      }
    } else {
      // Fallback to legacy compact card
      if (Array.isArray(citedPapers) && citedPapers.length){
        for (var i2=0;i2<citedPapers.length;i2++){ refsWrap.insertAdjacentHTML("beforeend", paperCardCompact(citedPapers[i2], "Referenced")); }
      } else {
        refsWrap.innerHTML = '<p class="muted">No referenced papers found.</p>';
      }
      if (Array.isArray(citingPapers) && citingPapers.length){
        for (var j2=0;j2<citingPapers.length;j2++){ citedByWrap.insertAdjacentHTML("beforeend", paperCardCompact(citingPapers[j2], "Cited-by")); }
      } else {
        citedByWrap.innerHTML = '<p class="muted">No citing papers found.</p>';
      }
    }
  }

  // ---------- Header guards ----------
  function repopulateHeaderIfEmpty(){
    try{
      var hdr = $("paperHeaderMain");
      if (!hdr) return;
      var empty = (!hdr.firstElementChild && (hdr.textContent || "").trim() === "");
      if (empty){
        if (__CURRENT_PAPER__){
          hdr.innerHTML = buildHeaderMain(__CURRENT_PAPER__);
          $("paperActions").innerHTML = buildActionsBar(__CURRENT_PAPER__);
          $("paperStats").innerHTML   = buildStatsHeader(__CURRENT_PAPER__);
          wireHeaderToggles();
          if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
            SE.components.enhancePaperCards($("paperActions"));
          }
        } else if (__HEADER_HTML_SNAPSHOT__) {
          hdr.innerHTML = __HEADER_HTML_SNAPSHOT__;
          wireHeaderToggles();
        }
      }
    }catch(e){}
  }
  function restoreHeaderIfNeeded() {
    var hdr = document.getElementById("paperHeaderMain");
    if (!hdr) {
      var grid = document.querySelector(".paper-header-grid");
      if (!grid) return;
      var newDiv = document.createElement("div");
      newDiv.id = "paperHeaderMain";
      grid.prepend(newDiv);
      hdr = newDiv;
    }
    var isEmpty = !hdr.firstElementChild && (!hdr.textContent || hdr.textContent.trim()==="");
    if (isEmpty && __HEADER_HTML_SNAPSHOT__) {
      hdr.innerHTML = __HEADER_HTML_SNAPSHOT__;
      wireHeaderToggles();
    }
  }
  function startHeaderObserver(){
    if (__HEADER_OBSERVER__) return;
    var hdr = document.getElementById("paperHeaderMain");
    if (!hdr) return;
    __HEADER_OBSERVER__ = new MutationObserver(function(){
      restoreHeaderIfNeeded();
      repopulateHeaderIfEmpty();
    });
    __HEADER_OBSERVER__.observe(hdr, { childList:true, subtree:true });
  }

  // ---------- Research Objects UI ----------
  function renderResearchObjectsUI(items){
    if (!Array.isArray(items) || !items.length){
      $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">No code/data records matched this paper.</p>';
      return;
    }
    var rows = [];
    for (var i=0;i<items.length;i++){
      var x = items[i];
      var prov = x.provenance ? ('<span class="badge badge-neutral" title="Source">'+escapeHtml(x.provenance)+'</span>') : '';
      var typ  = x.type ? ('<span class="badge">'+escapeHtml(x.type)+'</span>') : '';
      var repo = x.repository ? ('<span class="muted" style="margin-left:.25rem;">'+escapeHtml(x.repository)+'</span>') : '';
      var doi  = x.doi ? (' · <a href="https://doi.org/'+escapeHtml(x.doi)+'" target="_blank" rel="noopener">DOI</a>') : '';
      var ver  = x.version ? (' <span class="muted">v'+escapeHtml(x.version)+'</span>') : '';
      var lic  = x.licence ? (' <span class="muted">('+escapeHtml(x.licence)+')</span>') : '';
      var url  = x.url || (x.doi ? ("https://doi.org/"+x.doi) : "");
      rows.push('<li class="ro-item">'+typ+' <a href="'+escapeHtml(url)+'" target="_blank" rel="noopener">'+escapeHtml(x.title || x.doi || "Item")+'</a>'+ver+lic+doi+' '+prov+repo+'</li>');
    }
    $("objectsBlock").innerHTML = '<h2>Research Objects</h2><ul>'+rows.join("")+'</ul>';
  }

  // ---------- Render pipeline ----------
  async function renderPaper(p, source){
    __CURRENT_PAPER__ = p;

    $("paperHeaderMain").innerHTML = buildHeaderMain(p);
    $("paperActions").innerHTML   = buildActionsBar(p);
    $("paperStats").innerHTML     = buildStatsHeader(p);
    __HEADER_HTML_SNAPSHOT__ = $("paperHeaderMain").innerHTML;
    wireHeaderToggles();
    startHeaderObserver();

    var guardUntil = Date.now() + 15000;
    (function loopGuard(){
      restoreHeaderIfNeeded();
      if (Date.now() < guardUntil) requestAnimationFrame(loopGuard);
    })();

    if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
      SE.components.enhancePaperCards($("paperActions"));
    }

    $("abstractBlock").innerHTML = '<h2>Abstract</h2><p>' + formatAbstract(p.abstract_inverted_index) + '</p>';

    $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">Looking for code & data…</p>';
    try{
      var ros = await harvestAndFilterResearchObjects(p);
      renderResearchObjectsUI(ros);
    }catch(e){
      $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">Could not retrieve links.</p>';
    }

    renderJournalBlockSimple(p, source);
  }

  async function renderGraphs(main, cited, citing){
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
      await renderPaper(paper, source);

      var cited=[], citing=[];
      try { cited = await fetchCitedPapers(paper.referenced_works || []); } catch(e){}
      try { citing = await fetchCitingPapers(paper.id); } catch(e){}

      window.__GRAPH_CTX__ = { main: paper, cited: cited, citing: citing };
      await renderGraphs(paper, cited, citing);

    } catch (e) {
      console.error(e);
      $("paperHeaderMain").innerHTML = "<p class='muted'>Error loading paper details.</p>";
      restoreHeaderIfNeeded();
    }

    // Keep "Apply" working across re-renders
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
