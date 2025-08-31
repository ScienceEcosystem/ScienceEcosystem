// scripts/profile.js
(function () {
  if (!document.body || document.body.dataset.page !== "profile") return;

  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";
  var PAGE_SIZE = 50;

  // ---- State (publications) ----
  var currentPage = 1;
  var totalWorksCount = 0;
  var accumulatedWorks = [];
  var currentSort = "date"; // "date" | "citations"
  var worksApiBaseUrl = null;
  var abortCtrl = null;

  // ---- Small utils ----
  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function escapeHtml(str){ str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; });
  }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; } catch(e){ return fb; } }
  function normalizeAuthorId(raw){
    if(!raw) return "";
    var s=raw; try{ s=decodeURIComponent(s);}catch(e){}
    s=s.trim();
    if(s.indexOf("/")!==-1){ var seg=s.split("/").filter(Boolean); s=seg[seg.length-1]; }
    var orcidLike=/^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/i.test(s);
    if(orcidLike && s.toUpperCase().indexOf("ORCID:")!==0) s="ORCID:"+s;
    return s;
  }
  function addMailto(u){
    var url=new URL(u, API);
    if(!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }
  async function getJSON(url){
    var withMt = addMailto(url);
    // simple retry on 429
    for (var attempt=1; attempt<=2; attempt++){
      try{
        var res = await fetch(withMt, { headers: { "Accept":"application/json" }, signal: abortCtrl ? abortCtrl.signal : undefined });
        if (res.status===429){
          var ra=parseInt(res.headers.get("Retry-After")||"1",10);
          await new Promise(function(r){ setTimeout(r, Math.min(ra,5)*1000); });
          continue;
        }
        if (!res.ok) throw new Error(res.status+" "+res.statusText);
        return await res.json();
      }catch(e){
        if (e.name === "AbortError") throw e;
        if (attempt===2) throw e;
      }
    }
    throw new Error("Unreachable");
  }
  function hardError(msg){
    var box=$("publicationsList");
    if(box) box.innerHTML='<div class="notice error"><strong>Error:</strong> '+escapeHtml(msg)+'</div>';
  }

  // ---- Header / metrics ----
  function renderAuthorHeader(a){
    if ($("profileName")) $("profileName").textContent = a.display_name || "Unknown researcher";
    var aff = get(a,"last_known_institution.display_name",null) || get(a,"last_known_institutions.0.display_name",null) || "Unknown affiliation";
    if ($("profileAffiliation")) $("profileAffiliation").textContent = aff;

    var alt = (Array.isArray(a.display_name_alternatives)&&a.display_name_alternatives.length)?a.display_name_alternatives:(Array.isArray(a.alternate_names)?a.alternate_names:[]);
    if ($("otherNames")) $("otherNames").innerHTML = alt.length ? '<strong>Also published as:</strong> '+alt.map(escapeHtml).join(", ") : "";

    if (a.orcid && $("profileOrcid")){
      var orcidHref = (a.orcid.indexOf("http")===0 ? a.orcid : ("https://orcid.org/"+a.orcid.replace(/^ORCID:/i,"")));
      $("profileOrcid").href = orcidHref;
      $("profileOrcid").textContent = "ORCID: "+orcidHref.split("/").pop();
      $("profileOrcid").style.display = "inline-block";
    }
    if (a.display_picture && $("profilePhoto")) $("profilePhoto").src = a.display_picture;

    var h = get(a,"summary_stats.h_index",0) || 0;
    var i10 = get(a,"summary_stats.i10_index",0) || 0;
    var totalCitations = a.cited_by_count || 0;
    var yearsArr = Array.isArray(a.counts_by_year) ? a.counts_by_year.map(function(c){return c.year;}) : [];
    var now = (new Date()).getFullYear();
    var minY = yearsArr.length ? Math.min.apply(null, yearsArr) : now;
    var maxY = yearsArr.length ? Math.max.apply(null, yearsArr) : now;
    var yearsActive = Math.max(1, maxY - minY + 1);
    var ris = (totalCitations * h) / (yearsActive + 1);

    if ($("hIndex")) $("hIndex").textContent = h.toLocaleString();
    if ($("i10Index")) $("i10Index").textContent = i10.toLocaleString();
    if ($("totalCitations")) $("totalCitations").textContent = totalCitations.toLocaleString();
    if ($("risValue")) $("risValue").textContent = ris.toFixed(1);

    var concepts = Array.isArray(a.x_concepts) ? a.x_concepts.slice() : [];
    concepts.sort(function(x,y){ return (y.score||0)-(x.score||0); });
    if ($("tagsContainer")){
      $("tagsContainer").innerHTML = concepts.slice(0,12).map(function(c){
        var tid = c.id ? c.id.split("/").pop() : "";
        return '<a class="topic-card" href="topic.html?id='+tid+'" title="Open topic"><span class="topic-name">'+escapeHtml(c.display_name||"Topic")+'</span></a>';
      }).join("");
    }

    if ($("aiBio")){
      var topTopics = concepts.slice(0,5).map(function(c){return c.display_name;}).filter(Boolean);
      $("aiBio").textContent =
        (a.display_name||"This researcher")+" studies "+(topTopics.join(", ")||"various topics")+". "+
        "They have "+((a.works_count||0).toLocaleString())+" works and "+(totalCitations.toLocaleString())+" citations. "+
        "Current h-index is "+h+". Latest affiliation is "+aff+".";
    }

    // simple timeline
    var names = [];
    var lki = get(a,"last_known_institution.display_name",null); if (lki) names.push(lki);
    var lkis = Array.isArray(a.last_known_institutions)?a.last_known_institutions:[];
    for (var i=0;i<lkis.length;i++){ var nm=get(lkis[i],"display_name",null); if(nm) names.push(nm); }
    if ($("careerTimeline")){
      $("careerTimeline").innerHTML = names.length
        ? names.map(function(name){ return '<li><span class="dot"></span><div><div class="title">'+escapeHtml(name)+'</div><div class="muted">Affiliation</div></div></li>'; }).join("")
        : "<li>No affiliations listed.</li>";
    }
  }

  // ---- Publications rendering (uses components.js) ----
  function clearPublications(){
    var list = $("publicationsList");
    if (list) list.innerHTML = "";
    var pag = $("pubsPagination");
    if (pag) pag.innerHTML = "";
  }

  function renderWorksChunk(works){
    var list = $("publicationsList");
    if (!list) return;
    if (/Loading publications/i.test(list.textContent)) list.innerHTML = "";

    for (var i=0;i<works.length;i++){
      // Use the shared card renderer
      list.insertAdjacentHTML("beforeend", SE.components.renderPaperCard(works[i], { compact: true }));
    }
    // Enhance cards (Unpaywall, abstract toggle, save, cite popover)
    SE.components.enhancePaperCards(list);

    // Pagination UI
    var pag = $("pubsPagination");
    if (!pag) return;
    var shown = accumulatedWorks.length;
    if (shown < totalWorksCount) {
      pag.innerHTML = '<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>';
      var btn = $("loadMoreBtn");
      if (btn) {
        btn.onclick = async function(){
          btn.disabled = true; btn.textContent = "Loading…";
          currentPage += 1;
          await fetchWorksPage(currentPage, false);
          btn.disabled = false; btn.textContent = "Load more";
        };
      }
    } else {
      pag.innerHTML = '<p class="muted">All results loaded.</p>';
    }
  }

  function sortParam(){
    if (currentSort === "citations") return "cited_by_count:desc";
    // default date sort
    return "publication_year:desc";
  }

  async function fetchWorksPage(page, replace){
    if (!worksApiBaseUrl) return;
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    // Build URL from works_api_url (can be absolute)
    var u = new URL(worksApiBaseUrl);
    u.searchParams.set("page", String(page));
    u.searchParams.set("per_page", String(PAGE_SIZE));
    u.searchParams.set("sort", sortParam());

    try{
      var data = await getJSON(u.toString());
      var results = Array.isArray(data.results) ? data.results : [];
      totalWorksCount = get(data, "meta.count", totalWorksCount || results.length || 0);

      if (replace) {
        accumulatedWorks = results.slice();
        clearPublications();
      } else {
        accumulatedWorks = accumulatedWorks.concat(results);
      }

      renderWorksChunk(results);
    }catch(e){
      if (e.name === "AbortError") return;
      hardError(e.message || String(e));
      console.error(e);
    }
  }

  async function loadWorks(author){
    var worksApi = author && author.works_api_url;
    var list = $("publicationsList");
    if (!worksApi){
      if (list) list.innerHTML = '<p class="muted">No publications endpoint provided.</p>';
      return;
    }
    worksApiBaseUrl = worksApi; // keep as-is; add mailto later via getJSON
    currentPage = 1;
    accumulatedWorks = [];

    if (list) list.innerHTML = '<p class="muted">Loading publications…</p>';
    await fetchWorksPage(currentPage, true);

    // Update total works stat (prefer author.works_count if present)
    var total = author.works_count != null ? author.works_count : totalWorksCount;
    if ($("totalWorks")) $("totalWorks").textContent = (total || 0).toLocaleString();
  }

  // ---- Boot ----
  async function boot(){
    try{
      var raw = getParam("id");
      var id = normalizeAuthorId(raw);
      var authorId = id || "A1969205033"; // fallback example
      var authorUrl = API + "/authors/" + encodeURIComponent(authorId);

      var author = await getJSON(authorUrl);
      renderAuthorHeader(author);
      await loadWorks(author);

      // Wire up sort control (date/citations)
      var sortSel = $("pubSort");
      if (sortSel) {
        sortSel.value = "date";
        sortSel.addEventListener("change", async function(){
          currentSort = this.value === "citations" ? "citations" : "date";
          currentPage = 1;
          accumulatedWorks = [];
          await fetchWorksPage(currentPage, true);
        });
      }

      // Optional: micro-ping to surface network in console (no UI change)
      try { await getJSON(API + "/works?per_page=1"); } catch(_){}

    }catch(e){
      hardError(e.message || String(e));
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
