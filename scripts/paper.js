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
  var __SUPP_LINKS__ = [];
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
    x = x.replace(/_\d+(\.[a-z0-9]+)$/i, "$1");
    return x;
  }
  function doiFromWork(p){
    var doiRaw = p.doi || get(p,"ids.doi",null);
    if (!doiRaw) return null;
    return String(doiRaw).replace(/^doi:/i,"");
  }
  function getOpenAccessPdf(p){
    return get(p,"best_oa_location.pdf_url",null)
      || get(p,"best_oa_location.url_for_pdf",null)
      || get(p,"primary_location.pdf_url",null)
      || get(p,"primary_location.url_for_pdf",null)
      || null;
  }
  function setSupplementaryLinks(list){
    __SUPP_LINKS__ = Array.isArray(list) ? list : [];
  }

  async function fetchOaResolver(doi, openalexId){
    if (!doi && !openalexId) return null;
    var qs = [];
    if (doi) qs.push("doi=" + encodeURIComponent(doi));
    if (openalexId) qs.push("openalex_id=" + encodeURIComponent(openalexId));
    var controller = new AbortController();
    var t = setTimeout(function(){ controller.abort(); }, 5000);
    try{
      var res = await fetch("/api/paper/oa?" + qs.join("&"), { signal: controller.signal });
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return await res.json();
    }catch(e){
      return null;
    }finally{
      clearTimeout(t);
    }
  }

  function addOaResolverToHeader(p, oa){
    if (!oa) return;
    var header = $("paperHeaderMain");
    if (!header) return;
    var chipsWrap = header.querySelector(".chips");
    if (!chipsWrap) return;

    if (oa.best_pdf_url && !chipsWrap.querySelector('[data-src="oa-resolver"]')){
      var idTail = idTailFrom(p.id);
      var pdfHref = idTail
        ? ("/pdf-viewer.html?id=" + encodeURIComponent(idTail) + "&pdf=" + encodeURIComponent(oa.best_pdf_url))
        : oa.best_pdf_url;
      var a = document.createElement("a");
      a.className = "badge badge-oa";
      a.href = pdfHref;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("data-src","oa-resolver");
      a.textContent = "PDF (Open Access)";
      chipsWrap.prepend(a);
    }

    if (Array.isArray(oa.sources) && oa.sources.length && !chipsWrap.querySelector(".oa-sources")){
      var details = document.createElement("details");
      details.className = "oa-sources";
      details.style.display = "inline-block";
      details.style.marginLeft = ".35rem";
      var summary = document.createElement("summary");
      summary.className = "badge badge-neutral";
      summary.textContent = "Sources";
      var menu = document.createElement("div");
      menu.style.marginTop = ".35rem";
      menu.style.padding = ".35rem .5rem";
      menu.style.border = "1px solid #e5e7eb";
      menu.style.borderRadius = "8px";
      menu.style.background = "#fff";
      menu.style.boxShadow = "0 8px 18px rgba(0,0,0,.12)";
      var links = oa.sources.map(function(s){
        var href = s.pdf_url || s.landing_url || "";
        if (!href) return "";
        return '<a href="'+escapeHtml(href)+'" target="_blank" rel="noopener">'+escapeHtml(s.source || "Source")+'</a>';
      }).filter(Boolean).join(" · ");
      menu.innerHTML = links || '<span class="muted">No sources found.</span>';
      details.appendChild(summary);
      details.appendChild(menu);
      chipsWrap.appendChild(details);
    }
  }

  // ---------- Fetchers ----------
  async function fetchPaperData(paperId){
    var id = normalizePaperId(paperId);
    if (!id) throw new Error("Missing paper id");
    try {
      return await getJSON(API + "/works/" + encodeURIComponent(id));
    } catch (e) {
      console.warn("OpenAlex work fetch failed:", e);
      throw e;
    }
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
    try {
      var data = await getJSON(url);
      return Array.isArray(data.results) ? data.results : [];
    } catch (e) {
      console.warn("OpenAlex cited works fetch failed:", e);
      return [];
    }
  }
  async function fetchCitingPapers(paperOpenAlexIdOrUrl){
    var s = String(paperOpenAlexIdOrUrl || "");
    var idTail = s.replace(/^https?:\/\/openalex\.org\//i, "");
    var url = API + "/works?filter=cites:" + encodeURIComponent(idTail) + "&per_page=200&sort=cited_by_count:desc";
    try {
      var data = await getJSON(url);
      return Array.isArray(data.results) ? data.results : [];
    } catch (e) {
      console.warn("OpenAlex citing works fetch failed:", e);
      return [];
    }
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
    doi = normalizeDOI(doi);
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
    doi = normalizeDOI(doi);
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
  async function fetchPdfReferenceDois(pdfUrl){
    if (!pdfUrl) return [];
    try{
      var resp = await fetch("/api/pdf/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfUrl: pdfUrl })
      });
      if (!resp.ok) return [];
      var data = await resp.json();
      var refs = Array.isArray(data.references) ? data.references : [];
      if (Array.isArray(data.supplementaryLinks)) setSupplementaryLinks(data.supplementaryLinks);
      return refs.filter(function(r){ return r && r.doi; });
    }catch(e){ return []; }
  }
  function isLikelyDataCodeRef(ref){
    var doi = String(ref?.doi || "").toLowerCase();
    var title = String(ref?.title || "").toLowerCase();
    var hostHints = ["zenodo","figshare","osf","dataverse","dryad"];
    if (hostHints.some(function(h){ return doi.includes(h) || title.includes(h); })) return true;
    if (title.includes("dataset") || title.includes("data set") || title.includes("data") || title.includes("source data")) return true;
    if (title.includes("code") || title.includes("software")) return true;
    return false;
  }
  function classifyRefType(ref){
    var title = String(ref?.title || "").toLowerCase();
    if (title.includes("code") || title.includes("software")) return "Software";
    if (title.includes("dataset") || title.includes("data set") || title.includes("data") || title.includes("source data")) return "Dataset";
    var doi = String(ref?.doi || "").toLowerCase();
    if (doi.includes("zenodo") || doi.includes("figshare") || doi.includes("dryad") || doi.includes("dataverse") || doi.includes("osf")) return "Dataset";
    return "Other";
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
    setSupplementaryLinks([]);
    var doi = normalizeDOI(paper.doi || get(paper,"ids.doi",""));
    var title = paper.display_name || "";
    var all = [];
    var pdfRefs = [];
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
    // Avoid direct Zenodo calls in the browser to prevent noisy 400s. Use /api/paper/artifacts instead.
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

    // Always attempt to extract supplementary/peer-review links from PDF text
    try {
      var pdfUrl = getOpenAccessPdf(paper) || get(paper, "best_oa_location.url_for_pdf", null) || get(paper, "primary_location.pdf_url", null);
      if (pdfUrl) {
        pdfRefs = await fetchPdfReferenceDois(pdfUrl);
      }
    } catch(_) {}

    // If we still don't have data/code, inspect PDF references for repository DOIs
    try {
      var hasDataOrCode = all.some(function(x){ return x && (x.type === "Dataset" || x.type === "Software"); });
      if (!hasDataOrCode) {
        pdfRefs.forEach(function(ref){
          if (!isLikelyDataCodeRef(ref)) return;
          var doiRef = String(ref.doi || "").replace(/^doi:/i, "");
          all.push({
            provenance: "PDF References",
            type: classifyRefType(ref),
            title: ref.title || doiRef,
            doi: doiRef,
            url: doiRef ? ("https://doi.org/" + doiRef) : ""
          });
        });
      }
    } catch(_) {}

    var dedup = uniqueByKey(all, function(x){
      return (x.doi && x.doi.toLowerCase()) || (String(x.title||"").toLowerCase()+"|"+String(x.url||"").toLowerCase());
    });

    var trustedHosts = ["zenodo.org","figshare.com","osf.io","github.com","gitlab.com","doi.org"];
    var filtered = dedup.filter(function(x){
      if (!x) return false;
      // Always keep direct DOI match
      if (x.doi && doi && normalizeDOI(x.doi) === doi) return true;
      // Prefer keeping known repositories even if title similarity is low
      try {
        var urlHost = x.url ? new URL(x.url, "https://example.org").hostname : "";
        if (trustedHosts.some(function(h){ return urlHost.includes(h); })) return true;
      } catch(_){}
      if (x.provenance === "Zenodo" || x.provenance === "DataCite") return true;

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
      var authorId = get(authorships[i],"author.id",null);
      var authorName = escapeHtml(get(authorships[i],"author.display_name","Unknown"));
      var authorHtml = authorId
        ? '<a href="profile.html?id='+encodeURIComponent(authorId.split("/").pop())+'">'+authorName+'</a>'
        : authorName;

        
      var insts = Array.isArray(authorships[i].institutions) ? authorships[i].institutions : [];
      var instParts = [];
      for (var j=0;j<insts.length;j++){
        var instName = get(insts[j], "display_name", null);
        if (!instName) continue;
        var instId = get(insts[j], "id", null);
        var instTail = instId ? String(instId).replace(/^https?:\/\/openalex\.org\//i, "") : null;
        if (instTail) instParts.push('<a href="institute.html?id='+encodeURIComponent(instTail)+'">'+escapeHtml(instName)+'</a>');
        else instParts.push(escapeHtml(instName));
      }

      var instHtml = instParts.length ? ' <span class="author-inst" style="color:#64748b; font-size:.9em;">('+instParts.join(", ")+')</span>' : "";
      out.push('<span class="author-affiliation">'+authorHtml+instHtml+'</span>');
    }
    var short = out.slice(0,8);
    return { allHtml: out.join(" · "), shortHtml: short.join(" · "), moreCount: Math.max(0, out.length - short.length) };
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
      if (item.idTail) return '<a href="institute.html?id='+encodeURIComponent(item.idTail)+'">'+escapeHtml(item.name)+'</a>';
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
    if (type.includes("journal") || type.includes("conference") || type.includes("book")) return false;
    for (var i=0;i<PREPRINT_VENUES.length;i++){
      if (name.includes(PREPRINT_VENUES[i].toLowerCase())) return true;
    }
    if (type.includes("preprint")) return true;
    if (type.includes("repository")) {
      if (!name) return true;
      if (name.includes("preprint") || name.includes("repository") || name.includes("arxiv") || name.includes("rxiv")) return true;
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

    var oaPdf = getOpenAccessPdf(p);
    var oaLanding = get(p,"open_access.oa_url",null) || get(p,"best_oa_location.url",null) || get(p,"primary_location.landing_page_url",null);
    var idTail = idTailFrom(p.id);
    var pdfViewer = oaPdf ? ("/pdf-viewer.html?id=" + encodeURIComponent(idTail) + "&pdf=" + encodeURIComponent(oaPdf)) : null;
    if (typeof console !== "undefined" && console.log) {
      console.log("DEBUG PDF URLs:", { oaPdf: oaPdf, idTail: idTail, pdfViewer: pdfViewer });
    }

    var chips = [
      badge(doiUrl, "DOI"),
      badge(pdfViewer, "Read PDF", "badge-oa"),
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
      + (fundingRow || "")
      + '<p class="chips">'+chips.filter(Boolean).join(" ")+'</p>';
  }
  function wireHeaderToggles(){
    var asMore = $("authorsShowMore"), asLess = $("authorsShowLess");
    if (asMore) asMore.onclick = function(){ $("authorsShort").style.display="none"; $("authorsFull").style.display="inline"; };
    if (asLess) asLess.onclick = function(){ $("authorsFull").style.display="none"; $("authorsShort").style.display="inline"; };
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
    // Weighted quality score (0-100)
    var peerReviewScore = 0;
    if (peerText === "Peer reviewed") peerReviewScore = 40;
    else if (peerText === "Editorial review only") peerReviewScore = 20;
    var journalRankScore = Math.round((stars / 5) * 40);
    var openAccessScore = get(p, "open_access.is_oa", false) ? 20 : 0;
    var percent = peerReviewScore + journalRankScore + openAccessScore;

    var grade = "Poor", color = "#c0392b";
    if (percent >= 90) { grade = "Excellent"; color = "#27ae60"; }
    else if (percent >= 70) { grade = "Good"; color = "#2e7f9f"; }
    else if (percent >= 50) { grade = "Fair"; color = "#f39c12"; }
    else if (percent >= 30) { grade = "Limited"; color = "#e67e22"; }

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

    // Build indicators
    var indicators = [];
    if (peerText === "Peer reviewed") indicators.push({ icon: "✅ ", label: "Peer reviewed", status: "yes" });
    else if (peerText === "Editorial review only") indicators.push({ icon: "~", label: "Editorial review only", status: "partial" });
    else indicators.push({ icon: "X", label: "Not peer reviewed", status: "no" });

    if (stars >= 4) indicators.push({ icon: "✅ ", label: "High-impact journal ("+stars+"/5)", status: "yes" });
    else if (stars >= 3) indicators.push({ icon: "~", label: "Mid-tier journal ("+stars+"/5)", status: "partial" });
    else if (stars > 0) indicators.push({ icon: "~", label: "Lower-tier journal ("+stars+"/5)", status: "partial" });
    else indicators.push({ icon: "X", label: "Journal rating unknown", status: "no" });

    if (get(p, "open_access.is_oa", false)) indicators.push({ icon: "✅ ", label: "Open access", status: "yes" });
    else indicators.push({ icon: "~", label: "Behind paywall", status: "partial" });

    var indicatorsHtml = indicators.map(function(ind){
      return '' +
        '<div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">' +
          '<span style="font-size:1.2rem;">'+ind.icon+'</span>' +
          '<span style="flex:1; color:'+(ind.status === "yes" ? "#333" : "#666")+';">'+escapeHtml(ind.label)+'</span>' +
        '</div>';
    }).join('');

    $("journalBlock").innerHTML =
      '<div class="repro-score" style="text-align:center; margin-bottom:1rem;">' +
        '<div style="font-size:3rem; font-weight:700; color:'+color+';">'+percent+'%</div>' +
        '<div style="font-size:1rem; font-weight:600; color:'+color+';">'+grade+'</div>' +
        '<div class="progress-bar" style="background:#eee; height:8px; border-radius:4px; margin-top:0.5rem; overflow:hidden;">' +
          '<div style="background:'+color+'; width:'+percent+'%; height:100%;"></div>' +
        '</div>' +
      '</div>' +
      '<div class="repro-checklist">' + indicatorsHtml + '</div>' +
      '<p style="margin-top:1rem; font-size:0.9rem; color:#666;"><strong>Journal:</strong> '+journalLinkHtml+'</p>' +
      '<details style="margin-top:1rem;">' +
        '<summary style="cursor:pointer; color:#2e7f9f; font-size:0.9rem;">How is this calculated?</summary>' +
        '<p style="font-size:0.85rem; color:#666; margin-top:0.5rem; line-height:1.5;">' +
          'Journal quality is based on:<br>' +
          '• Peer review process (40%)<br>' +
          '• Journal impact/ranking (40%)<br>' +
          '• Open access status (20%)<br><br>' +
          'This helps assess the credibility and accessibility of the publication venue.' +
        '</p>' +
      '</details>' +
      checks;
  }

  // ---------- Paper type detection ----------
  function detectPaperType(paper){
    var type = String(paper?.type || "").toLowerCase();
    var title = String(paper?.title || "").toLowerCase();
    var abstract = "";
    if (paper && paper.abstract_inverted_index && typeof paper.abstract_inverted_index === "object") {
      try { abstract = Object.keys(paper.abstract_inverted_index).join(" ").toLowerCase(); } catch(_e){}
    }

    if (type === "review" || type === "literature-review") {
      return { category: "review", label: "Literature Review" };
    }
    if (type === "editorial" || type === "letter") {
      return { category: "opinion", label: "Editorial/Opinion" };
    }

    var reviewKeywords = ["systematic review", "literature review", "scoping review", "meta-analysis", "review of"];
    var opinionKeywords = ["commentary", "perspective", "opinion", "editorial", "viewpoint"];
    var theoreticalKeywords = ["theoretical framework", "conceptual model", "mathematical proof"];
    var computationalKeywords = ["simulation", "computational model", "algorithm", "software"];

    var text = title + " " + abstract;

    if (reviewKeywords.some(function(kw){ return text.includes(kw); })) {
      return { category: "review", label: "Review Article" };
    }
    if (opinionKeywords.some(function(kw){ return text.includes(kw); })) {
      return { category: "opinion", label: "Opinion/Commentary" };
    }
    if (theoreticalKeywords.some(function(kw){ return text.includes(kw); })) {
      return { category: "theoretical", label: "Theoretical Work" };
    }
    if (computationalKeywords.some(function(kw){ return text.includes(kw); })) {
      return { category: "computational", label: "Computational Study" };
    }
    return { category: "empirical", label: "Research Article" };
  }

  function gradeFromPercent(percent){
    var grade = "Poor", color = "#c0392b";
    if (percent >= 90) { grade = "Excellent"; color = "#27ae60"; }
    else if (percent >= 70) { grade = "Good"; color = "#2e7f9f"; }
    else if (percent >= 50) { grade = "Fair"; color = "#f39c12"; }
    else if (percent >= 30) { grade = "Limited"; color = "#e67e22"; }
    return { grade: grade, color: color };
  }

  function getReproducibilityExplanation(paperType){
    var explanations = {
      "Review Article": "For review articles, we assess transparency and accessibility rather than data/code:<br>• Open access (50%)<br>• Citations available (50%)",
      "Literature Review": "For review articles, we assess transparency and accessibility rather than data/code:<br>• Open access (50%)<br>• Citations available (50%)",
      "Opinion/Commentary": "For opinion pieces, we assess accessibility:<br>• Open access (50%)<br>• Citations available (50%)",
      "Editorial/Opinion": "For opinion pieces, we assess accessibility:<br>• Open access (50%)<br>• Citations available (50%)",
      "Theoretical Work": "For theoretical work, we assess proof availability:<br>• Open access PDF (40%)<br>• Supplementary materials (60%)",
      "Computational Study": "For computational studies, code is critical:<br>• Open access PDF (15%)<br>• Code available (50%)<br>• Documentation (20%)<br>• Environment specs (15%)",
      "Research Article": "For empirical research:<br>• Open access PDF (20%)<br>• Public data (30%)<br>• Public code (30%)<br>• Documentation (10%)<br>• Environment specs (10%)"
    };
    return explanations[paperType] || explanations["Research Article"];
  }

  function calculateReproducibilityScore(paperData, researchObjects){
    var score = 0;
    var checks = [];
    var paperType = detectPaperType(paperData);
    var hasOpenAccess = !!(get(paperData,"open_access.is_oa",false) || getOpenAccessPdf(paperData));
    var datasets = Array.isArray(researchObjects) ? researchObjects.filter(function(r){ return String(r?.type || "").toLowerCase() === "dataset"; }) : [];
    var codeRepos = Array.isArray(researchObjects) ? researchObjects.filter(function(r){
      var t = String(r?.type || "").toLowerCase();
      var u = String(r?.url || "").toLowerCase();
      return t === "software" || t === "code" || u.includes("github.com") || u.includes("gitlab.com");
    }) : [];

    if (paperType.category === "review" || paperType.category === "opinion") {
      if (hasOpenAccess) { score += 50; checks.push({ label:"Open access", status:"yes", icon:"OK" }); }
      else { checks.push({ label:"Open access", status:"no", icon:"X" }); }
      var citedByCount = paperData?.cited_by_count || 0;
      if (citedByCount > 0) { score += 50; checks.push({ label:"Citations available", status:"yes", icon:"OK" }); }
      else { checks.push({ label:"Citations available", status:"no", icon:"X" }); }
      var g1 = gradeFromPercent(score);
      return { score: score, grade: g1.grade, color: g1.color, checks: checks, paperType: paperType.label, note: "This is a " + paperType.label.toLowerCase() + ". Data and code requirements do not apply." };
    }

    if (paperType.category === "theoretical") {
      if (hasOpenAccess) { score += 40; checks.push({ label:"Open access PDF", status:"yes", icon:"OK" }); }
      else { checks.push({ label:"Open access PDF", status:"no", icon:"X" }); }
      var hasSupplementary = Array.isArray(researchObjects) && researchObjects.length > 0;
      if (hasSupplementary) { score += 60; checks.push({ label:"Supplementary materials", status:"yes", icon:"OK" }); }
      else { checks.push({ label:"Supplementary materials", status:"no", icon:"X" }); }
      var g2 = gradeFromPercent(score);
      return { score: score, grade: g2.grade, color: g2.color, checks: checks, paperType: paperType.label, note: "This is theoretical work. Evaluated on proof and material availability." };
    }

    if (paperType.category === "computational") {
      if (hasOpenAccess) { score += 15; checks.push({ label:"Open access PDF", status:"yes", icon:"OK" }); }
      else { checks.push({ label:"Open access PDF", status:"no", icon:"X" }); }
      var hasCode = codeRepos.length > 0;
      if (hasCode) { score += 50; checks.push({ label:"Code available", status:"yes", icon:"OK" }); }
      else { checks.push({ label:"Code available", status:"no", icon:"X" }); }
      var hasReadme = codeRepos.some(function(r){
        var t = String(r?.title || "").toLowerCase();
        var u = String(r?.url || "").toLowerCase();
        return t.includes("readme") || u.includes("readme") || u.includes("documentation");
      });
      if (hasReadme) { score += 20; checks.push({ label:"Documentation", status:"yes", icon:"OK" }); }
      else if (hasCode) { checks.push({ label:"Documentation", status:"partial", icon:"~" }); }
      var hasEnv = codeRepos.some(function(r){
        var t = String(r?.title || "").toLowerCase();
        var u = String(r?.url || "").toLowerCase();
        return t.includes("docker") || t.includes("conda") || t.includes("requirements") || u.includes("docker") || u.includes("conda") || u.includes("requirements");
      });
      if (hasEnv) { score += 15; checks.push({ label:"Environment specs", status:"yes", icon:"OK" }); }
      else if (hasCode) { checks.push({ label:"Environment specs", status:"no", icon:"X" }); }
      var g3 = gradeFromPercent(score);
      return { score: score, grade: g3.grade, color: g3.color, checks: checks, paperType: paperType.label, note: "Computational study: code availability is critical." };
    }

    if (hasOpenAccess) { score += 20; checks.push({ label:"Open access PDF", status:"yes", icon:"OK" }); }
    else { checks.push({ label:"Open access PDF", status:"no", icon:"X" }); }

    var hasData = datasets.length > 0;
    if (hasData) { score += 30; checks.push({ label:"Data available", status:"yes", icon:"OK" }); }
    else { checks.push({ label:"Data available", status:"no", icon:"X" }); }

    var hasCode2 = codeRepos.length > 0;
    if (hasCode2) { score += 30; checks.push({ label:"Code available", status:"yes", icon:"OK" }); }
    else { checks.push({ label:"Code available", status:"no", icon:"X" }); }

    var hasDocs2 = codeRepos.some(function(r){
      var t = String(r?.title || "").toLowerCase();
      var u = String(r?.url || "").toLowerCase();
      return t.includes("readme") || u.includes("readme") || u.includes("documentation");
    });
    if (hasDocs2) { score += 10; checks.push({ label:"Documentation", status:"yes", icon:"OK" }); }

    var hasEnv2 = codeRepos.some(function(r){
      var t = String(r?.title || "").toLowerCase();
      var u = String(r?.url || "").toLowerCase();
      return t.includes("docker") || t.includes("conda") || t.includes("requirements") || u.includes("docker") || u.includes("conda") || u.includes("requirements");
    });
    if (hasEnv2) { score += 10; checks.push({ label:"Environment specs", status:"yes", icon:"OK" }); }

    var g4 = gradeFromPercent(score);
    return { score: score, grade: g4.grade, color: g4.color, checks: checks, paperType: paperType.label, note: null };
  }

  function renderReproducibilityScore(paperData, researchObjects){
    var block = $("reproducibilityBlock");
    if (!block) return;
    var result = calculateReproducibilityScore(paperData, researchObjects);

    block.innerHTML = '' +
      (result.paperType ? '<p style="font-size:0.85rem; color:#666; margin-bottom:0.5rem; text-align:center;"><strong>Paper type:</strong> '+escapeHtml(result.paperType)+'</p>' : '') +
      '<div class="repro-score" style="text-align:center; margin-bottom:1rem;">' +
        '<div style="font-size:3rem; font-weight:700; color:'+result.color+';">'+result.score+'%</div>' +
        '<div style="font-size:1rem; font-weight:600; color:'+result.color+';">'+escapeHtml(result.grade)+'</div>' +
        '<div class="progress-bar" style="background:#eee; height:8px; border-radius:4px; margin-top:0.5rem; overflow:hidden;">' +
          '<div style="background:'+result.color+'; width:'+result.score+'%; height:100%;"></div>' +
        '</div>' +
      '</div>' +
      (result.note ? '<p style="font-size:0.85rem; color:#2e7f9f; background:#f0f8ff; padding:0.75rem; border-radius:4px; margin-bottom:1rem;">'+escapeHtml(result.note)+'</p>' : '') +
      '<div class="repro-checklist">' +
        result.checks.map(function(check){ return '' +
          '<div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">' +
            '<span style="font-size:1.2rem;">'+escapeHtml(check.icon || (check.status==="yes" ? "OK" : (check.status==="partial" ? "~" : "X")))+'</span>' +
            '<span style="flex:1; color:'+(check.status==="yes" ? "#333" : "#999")+';">'+escapeHtml(check.label)+'</span>' +
          '</div>'; }).join('') +
      '</div>' +
      '<details style="margin-top:1rem;">' +
        '<summary style="cursor:pointer; color:#2e7f9f; font-size:0.9rem;">How is this calculated?</summary>' +
        '<p style="font-size:0.85rem; color:#666; margin-top:0.5rem;">' +
          getReproducibilityExplanation(result.paperType) +
        '</p>' +
      '</details>';
  }

  // ---------- Abstract ----------
  function formatAbstract(idx){
    if (!idx || typeof idx !== "object") return "";
    var words = [];
    var keys = Object.keys(idx);
    for (var i=0;i<keys.length;i++){
      var word = keys[i], positions = idx[word] || [];
      for (var j=0;j<positions.length;j++) words[positions[j]] = word;
    }
    return escapeHtml(words.join(" ") || "");
  }

  async function loadAbstractFallback(doi){
    if (!doi) return;
    try {
      const res = await fetch(`/api/paper/abstract?doi=${encodeURIComponent(doi)}`);
      if (!res.ok) throw new Error("No fallback abstract");
      const data = await res.json();
      if (data?.abstract) {
        $("abstractBlock").innerHTML = '<h2>Abstract</h2><p>' + escapeHtml(data.abstract) + '</p>';
      }
    } catch (e) {
      // keep default fallback text
    }
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
      var suppHtmlEmpty = "";
      if (Array.isArray(__SUPP_LINKS__) && __SUPP_LINKS__.length){
        var suppRows = __SUPP_LINKS__.map(function(s){
          return '<li class="ro-item"><span class="badge badge-neutral">'+escapeHtml(s.label || "Supplementary")+'</span> <a href="'+escapeHtml(s.url)+'" target="_blank" rel="noopener">'+escapeHtml(s.url)+'</a> <span class="muted">('+"PDF text"+')</span></li>';
        }).join("");
        suppHtmlEmpty = '<h3 style="margin-top:1rem;">Supplementary / Publisher Links</h3><ul>'+suppRows+'</ul>';
      }
      $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">No code/data records matched this paper.</p>' + suppHtmlEmpty;
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
    var suppHtml = "";
    if (Array.isArray(__SUPP_LINKS__) && __SUPP_LINKS__.length){
      var suppRows2 = __SUPP_LINKS__.map(function(s){
        return '<li class="ro-item"><span class="badge badge-neutral">'+escapeHtml(s.label || "Supplementary")+'</span> <a href="'+escapeHtml(s.url)+'" target="_blank" rel="noopener">'+escapeHtml(s.url)+'</a> <span class="muted">('+"PDF text"+')</span></li>';
      }).join("");
      suppHtml = '<h3 style="margin-top:1rem;">Supplementary / Publisher Links</h3><ul>'+suppRows2+'</ul>';
    }
    $("objectsBlock").innerHTML = '<h2>Research Objects</h2><ul>'+rows.join("")+'</ul>' + suppHtml;
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

    // Aggressive OA resolver (additive)
    try{
      var doiResolver = doiFromWork(p);
      var oaId = idTailFrom(p.id);
      fetchOaResolver(doiResolver, oaId).then(function(oa){
        if (!oa) return;
        addOaResolverToHeader(p, oa);
        __HEADER_HTML_SNAPSHOT__ = $("paperHeaderMain").innerHTML;
      }).catch(function(){});
    }catch(e){}

    var guardUntil = Date.now() + 15000;
    (function loopGuard(){
      restoreHeaderIfNeeded();
      if (Date.now() < guardUntil) requestAnimationFrame(loopGuard);
    })();

    if (window.SE && SE.components && typeof SE.components.enhancePaperCards === "function") {
      SE.components.enhancePaperCards($("paperActions"));
    }

    var abstractHtml = formatAbstract(p.abstract_inverted_index);
    if (abstractHtml) {
      $("abstractBlock").innerHTML = '<h2>Abstract</h2><p>' + abstractHtml + '</p>';
    } else {
      $("abstractBlock").innerHTML = '<h2>Abstract</h2><p class="muted">Looking for an abstract…</p>';
    }

    $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">Looking for code & data…</p>';
    var ros = [];
    try{
      ros = await harvestAndFilterResearchObjects(p);
      renderResearchObjectsUI(ros);
    }catch(e){
      $("objectsBlock").innerHTML = '<h2>Research Objects</h2><p class="muted">Could not retrieve links.</p>';
    }

    renderJournalBlockSimple(p, source);
    renderReproducibilityScore(p, ros);

    var doi = doiFromWork(p);
    if (doi) {
      if (!abstractHtml) loadAbstractFallback(doi);
      loadLinkedResources(doi);
      var oaPdf = getOpenAccessPdf(p);
      var hasOpenAccess = !!(get(p,"open_access.is_oa",false) || get(p,"best_oa_location.is_oa",false) || oaPdf);
      loadCitationContexts(doi, hasOpenAccess);
    }
  }

  // Load linked resources for a paper
  async function loadLinkedResources(doi) {
    const linkedSection = document.getElementById('linked-resources');
    if (!linkedSection) {
      // Create section if it doesn't exist
      const sidebar = document.querySelector('.paper-sidebar');
      if (sidebar) {
        const section = document.createElement('div');
        section.id = 'linked-resources';
        section.className = 'paper-section';
        sidebar.appendChild(section);
      }
    }
    
    try {
      const response = await fetch(`/api/paper/${encodeURIComponent(doi)}`);
      if (!response.ok) throw new Error('Failed to fetch resources');
      
      const data = await response.json();
      displayLinkedResources(data.linkedResources, data.reproducibilityScore);
    } catch (error) {
      console.error('Error loading linked resources:', error);
      const el = document.getElementById('linked-resources');
      if (el) {
        el.innerHTML = `
          <div class="error-message">
            <p>Could not load linked resources</p>
          </div>
        `;
      }
    }
  }
  
  function displayLinkedResources(resources, score) {
    const container = document.getElementById('linked-resources');
    if (!container) return;
    
    let html = '<h3>Linked Resources</h3>';
    
    // Reproducibility Score
    if (score) {
      const scoreColor = score.percentage >= 70 ? 'high' : score.percentage >= 40 ? 'medium' : 'low';
      html += `
        <div class="reproducibility-score ${scoreColor}">
          <div class="score-circle">
            <span class="score-number">${score.percentage}%</span>
            <span class="score-label">Reproducibility</span>
          </div>
          <div class="score-breakdown">
            <div class="score-item ${score.breakdown.hasOSF ? 'yes' : 'no'}">
              <span class="icon">${score.breakdown.hasOSF ? '✓' : '○'}</span>
              <span>OSF Project</span>
            </div>
            <div class="score-item ${score.breakdown.hasData ? 'yes' : 'no'}">
              <span class="icon">${score.breakdown.hasData ? '✓' : '○'}</span>
              <span>Data Available</span>
            </div>
            <div class="score-item ${score.breakdown.hasCode ? 'yes' : 'no'}">
              <span class="icon">${score.breakdown.hasCode ? '✓' : '○'}</span>
              <span>Code Available</span>
            </div>
          </div>
        </div>
      `;
    }
    
    // OSF Project
    if (resources.osf) {
      html += `
        <div class="resource-card osf-project">
          <div class="resource-header">
            <img src="https://osf.io/static/img/cos-white2.png" alt="OSF" class="resource-logo">
            <span class="resource-type">OSF Project</span>
          </div>
          <h4>${escapeHtml(resources.osf.title)}</h4>
          ${resources.osf.description ? `<p class="resource-description">${escapeHtml(resources.osf.description)}</p>` : ''}
          <a href="${resources.osf.url}" target="_blank" class="btn-resource">
            View Project Materials →
          </a>
        </div>
      `;
    }
    
    // Datasets
    if (resources.datasets.length > 0) {
      html += '<div class="resource-list">';
      html += `<h4>Datasets (${resources.datasets.length})</h4>`;
      resources.datasets.forEach(dataset => {
        html += `
          <div class="resource-item">
            <div class="resource-meta">
              <span class="resource-badge">${dataset.source}</span>
              ${dataset.publisher ? `<span class="resource-publisher">${escapeHtml(dataset.publisher)}</span>` : ''}
            </div>
            <a href="${dataset.url}" target="_blank" class="resource-link">
              ${dataset.title ? escapeHtml(dataset.title) : dataset.doi}
            </a>
          </div>
        `;
      });
      html += '</div>';
    }
    
    // Code
    if (resources.code.length > 0) {
      html += '<div class="resource-list">';
      html += `<h4>Code (${resources.code.length})</h4>`;
      resources.code.forEach(code => {
        html += `
          <div class="resource-item">
            <span class="resource-badge">GitHub</span>
            <a href="${code.url}" target="_blank" class="resource-link">
              ${code.name || code.url}
            </a>
          </div>
        `;
      });
      html += '</div>';
    }
    
    // No resources
    if (!resources.osf && resources.datasets.length === 0 && resources.code.length === 0) {
      html += `
        <div class="no-resources">
          <p>No linked materials found</p>
          <p class="help-text">
            Are you the author? 
            <a href="mailto:contact@scienceecosystem.org">Add your materials</a>
          </p>
        </div>
      `;
    }
    
    container.innerHTML = html;
  }

  // ---------- Citation contexts ----------
  async function loadCitationContexts(doi, hasOpenAccess) {
    const section = document.getElementById("citationContextsSection");
    if (!section || !doi) return;

    if (hasOpenAccess) {
      section.style.display = "none";
      return;
    }

    const list = document.getElementById("citationContextsList");
    if (list) list.innerHTML = "<p class='muted'>Loading citation contexts…</p>";

    try {
      const res = await fetch(`/api/paper/citation-contexts?doi=${encodeURIComponent(doi)}`);
      if (!res.ok) throw new Error("Failed to load citations");
      const data = await res.json();

      const contexts = data.citationContexts || [];
      const hasPeerReviews = data.peerReviews && data.peerReviews.length > 0;
      const hasImpact = data.impact && (data.impact.patentCitations > 0 || (data.impact.clinicalTrials && data.impact.clinicalTrials.length > 0));

      section.style.display = "block";
      document.getElementById("citationCount").textContent = contexts.length;
      document.getElementById("countAll").textContent = contexts.length;
      document.getElementById("countInfluential").textContent = contexts.filter(c => c.isInfluential).length;
      document.getElementById("countMethodology").textContent = contexts.filter(c => c.intent === "methodology").length;
      document.getElementById("countResult").textContent = contexts.filter(c => c.intent === "result").length;

      if (contexts.length > 0) {
        renderCitationContexts(contexts, "all");
      } else if (list) {
        list.innerHTML = "<p class='muted'>No open-access citation snippets available yet.</p>";
      }

      document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          const filter = btn.getAttribute("data-filter");
          renderCitationContexts(contexts, filter);
        });
      });

      if (hasPeerReviews) {
        renderPeerReviews(data.peerReviews);
      }

      if (hasImpact) {
        renderImpactData(data.impact);
      }
    } catch (e) {
      console.error("Citation contexts error:", e);
      section.style.display = "none";
    }
  }

  function renderCitationContexts(contexts, filter) {
    const list = document.getElementById("citationContextsList");
    if (!list) return;

    let filtered = contexts;
    if (filter === "influential") filtered = contexts.filter(c => c.isInfluential);
    else if (filter !== "all") filtered = contexts.filter(c => c.intent === filter);

    filtered.sort((a, b) => {
      if (a.isInfluential && !b.isInfluential) return -1;
      if (!a.isInfluential && b.isInfluential) return 1;
      return (b.year || 0) - (a.year || 0);
    });

    if (filtered.length === 0) {
      list.innerHTML = '<p class="muted">No citations found for this filter.</p>';
      return;
    }

    list.innerHTML = filtered.map(c => `
      <article class="citation-context">
        <p class="citation-snippet">
          "${escapeHtml(c.snippet)}"
        </p>
        <cite class="citation-meta">
          <strong>From:</strong> <a href="${c.url || "#"}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>
          ${c.authors ? ` by ${escapeHtml(c.authors)}` : ""}
          ${c.year ? ` (${escapeHtml(c.year)})` : ""}
          <div class="citation-tags">
            ${c.intent ? `<span class="badge">${escapeHtml(c.intent)}</span>` : ""}
            ${c.isInfluential ? '<span class="badge badge-warn">Influential</span>' : ""}
            ${c.openAccessPdf ? `<a href="/pdf-viewer.html?pdf=${encodeURIComponent(c.openAccessPdf)}" target="_blank" class="badge badge-ok">Read PDF</a>` : ""}
          </div>
        </cite>
      </article>
    `).join("");
  }

  function renderPeerReviews(reviews) {
    const section = document.getElementById("peerReviewsSection");
    const list = document.getElementById("peerReviewsList");
    if (!section || !list) return;

    section.style.display = "block";
    list.innerHTML = reviews.map(r => `
      <article class="peer-review">
        <div class="peer-review-head">
          <strong>${escapeHtml(r.reviewer)}</strong>
          <span>${r.rating ? `Rating: ${r.rating}/5` : ""}</span>
        </div>
        <p class="peer-review-text">${escapeHtml(r.comment || "No comment")}</p>
        <small class="muted">${r.date ? new Date(r.date).toLocaleDateString() : ""}</small>
      </article>
    `).join("");
  }

  function renderImpactData(impact) {
    const section = document.getElementById("impactSection");
    const data = document.getElementById("impactData");
    if (!section || !data) return;

    section.style.display = "block";

    const parts = [];
    if (impact.patentCitations > 0) {
      parts.push(`<p><strong>Cited in ${impact.patentCitations} patents</strong></p>`);
      if (impact.patents && impact.patents.length > 0) {
        parts.push('<ul>' + impact.patents.map(p =>
          `<li><a href="${p.url || "#"}" target="_blank">${escapeHtml(p.title || p.lens_id)}</a></li>`
        ).join("") + '</ul>');
      }
    }

    if (impact.clinicalTrials && impact.clinicalTrials.length > 0) {
      parts.push(`<p><strong>Referenced in ${impact.clinicalTrials.length} clinical trials</strong></p>`);
      parts.push('<ul>' + impact.clinicalTrials.map(t =>
        `<li><a href="${t.url || "#"}" target="_blank">${escapeHtml(t.title || t.trial_id)}</a></li>`
      ).join("") + '</ul>');
    }

    data.innerHTML = parts.join("");
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
