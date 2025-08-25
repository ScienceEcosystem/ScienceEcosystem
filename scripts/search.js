// scripts/search.js
(function () {
  // ---------- global for top nav everywhere ----------
  window.handleSearch = function (inputId) {
    var el = document.getElementById(inputId);
    if (!el) return;
    var q = (el.value || "").trim();
    if (!q) return;
    window.location.href = "search.html?q=" + encodeURIComponent(q);
  };

  // ---------- decide if we should run on this page ----------
  var hasQParam = new URLSearchParams(location.search).has("q");
  var hasSearchInput = !!(document.getElementById("unifiedSearchInput") || document.getElementById("searchInput"));
  var shouldRun = hasQParam || hasSearchInput || !!document.getElementById("unifiedSearchResults");
  if (!shouldRun) return; // do not touch other pages

  // ---------- constants & helpers ----------
  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";
  var PAGE_SIZE = 25;

  function $(id){ return document.getElementById(id); }
  function escapeHtml(str){ str=(str==null?"":String(str)); return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; }); }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; }catch(_){ return fb; } }
  function addMailto(u){
    try {
      var url = new URL(u, API);
      if(!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
      return url.toString();
    } catch(_) { return u; }
  }
  async function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  async function getJSON(url){
    var withMt = addMailto(url);
    for (var attempt=1; attempt<=2; attempt++){
      try{
        var res = await fetch(withMt, { headers:{ "Accept":"application/json" }});
        if (res.status === 429){
          var ra = parseInt(res.headers.get("Retry-After")||"1",10);
          await sleep(Math.min(ra,5)*1000);
          continue;
        }
        if (!res.ok) throw new Error(res.status+" "+res.statusText);
        return await res.json();
      }catch(e){
        if (attempt===2) { console.error("getJSON failed", withMt, e); throw e; }
      }
    }
    throw new Error("Unreachable");
  }

  function idTail(anyId){
    if (!anyId) return "";
    var s = String(anyId);
    var parts = s.split("/");
    return parts[parts.length - 1];
  }

  function showBanner(kind, msg){
    var container = $("unifiedSearchResults") || $("main") || document.body;
    var box = document.createElement("div");
    box.className = "panel " + (kind === "error" ? "error" : "info");
    box.style.border = kind === "error" ? "1px solid #e33" : "1px solid #999";
    box.style.padding = "12px"; box.style.marginBottom = "12px";
    box.innerHTML = (kind === "error"
      ? '<strong>Search error</strong><br><span class="muted">'+escapeHtml(String(msg))+'</span>'
      : '<strong>Notice</strong><br><span class="muted">'+escapeHtml(String(msg))+'</span>');
    container.prepend(box);
  }
  function showFatal(msg){ showBanner("error", msg); }

  // ---------- state ----------
  var currentPage = 1;
  var currentQuery = "";
  var currentAuthorIds = [];
  var totalResults = 0;
  var seen = Object.create(null);

  // ---------- ensure containers ----------
  function ensureResultsShell(){
    var results = $("unifiedSearchResults");
    if (!results) {
      var host = $("main") || document.querySelector("main") || document.body;
      results = document.createElement("div");
      results.id = "unifiedSearchResults";
      host.appendChild(results);
    }
    if (!/id="papersList"/.test(results.innerHTML)) {
      results.innerHTML =
        '<h2>Papers <span class="muted">(<span id="paperCount">0</span> results)</span></h2>' +
        '<div id="papersList"><p class="muted">Enter a search term above.</p></div>' +
        '<div id="pagination"></div>';
    }
    return results;
  }

  // ---------- Fallback-friendly fetchers ----------
  async function fetchAuthors(query){
    // Try canonical search= first, then display_name.search= fallback
    var endpoints = [
      API + "/authors?search=" + encodeURIComponent(query) + "&per_page=5&select=id,display_name,last_known_institution",
      API + "/authors?filter=display_name.search:" + encodeURIComponent(query) + "&per_page=5&select=id,display_name,last_known_institution"
    ];
    for (var i=0;i<endpoints.length;i++){
      try{
        var data = await getJSON(endpoints[i]);
        var results = data && Array.isArray(data.results) ? data.results : [];
        console.log("[authors] endpoint", i, "count", results.length);
        if (results.length) return results;
        if (i === endpoints.length - 1) return results; // return empty if last try
      }catch(e){
        console.warn("fetchAuthors attempt", i, "failed", e);
        if (i === endpoints.length - 1) return [];
      }
    }
    return [];
  }

  async function fetchTopics(query){
    var endpoints = [
      API + "/concepts?search=" + encodeURIComponent(query) + "&per_page=5&select=id,display_name",
      API + "/concepts?filter=display_name.search:" + encodeURIComponent(query) + "&per_page=5&select=id,display_name"
    ];
    for (var i=0;i<endpoints.length;i++){
      try{
        var data = await getJSON(endpoints[i]);
        var results = data && Array.isArray(data.results) ? data.results : [];
        console.log("[topics] endpoint", i, "count", results.length);
        if (results.length) return results;
        if (i === endpoints.length - 1) return results;
      }catch(e){
        console.warn("fetchTopics attempt", i, "failed", e);
        if (i === endpoints.length - 1) return [];
      }
    }
    return [];
  }

  async function fetchPapers(query, authorIds, page){
    var collated = [];
    try {
      // author-scoped pulls
      if (Array.isArray(authorIds) && authorIds.length){
        for (var i=0;i<authorIds.length;i++){
          var aidTail = idTail(authorIds[i]);
          if (!aidTail) continue;
          var urlA = API + "/works?filter=author.id:" + encodeURIComponent(aidTail)
            + "&per_page=" + String(PAGE_SIZE)
            + "&page=" + String(page)
            + "&select=" + [
              "id","ids","doi","display_name","publication_year",
              "host_venue","primary_location","best_oa_location","open_access",
              "authorships","abstract_inverted_index","cited_by_count"
            ].join(",");
          try{
            var dataA = await getJSON(urlA);
            var resA = Array.isArray(dataA.results) ? dataA.results : [];
            console.log("[works by author]", aidTail, "page", page, "count", resA.length);
            collated = collated.concat(resA);
          }catch(e){
            console.warn("author-scoped works failed for", aidTail, e);
          }
        }
      }

      // general search (with fallback if needed)
      var endpoints = [
        API + "/works?search=" + encodeURIComponent(query)
          + "&per_page=" + String(PAGE_SIZE)
          + "&page=" + String(page)
          + "&select=" + [
            "id","ids","doi","display_name","publication_year",
            "host_venue","primary_location","best_oa_location","open_access",
            "authorships","abstract_inverted_index","cited_by_count"
          ].join(","),
        API + "/works?filter=title.search:" + encodeURIComponent(query)
          + "&per_page=" + String(PAGE_SIZE)
          + "&page=" + String(page)
          + "&select=" + [
            "id","ids","doi","display_name","publication_year",
            "host_venue","primary_location","best_oa_location","open_access",
            "authorships","abstract_inverted_index","cited_by_count"
          ].join(",")
      ];

      var general = [];
      var metaCount = null;
      for (var ei=0; ei<endpoints.length; ei++){
        try{
          var data = await getJSON(endpoints[ei]);
          general = Array.isArray(data.results) ? data.results : [];
          metaCount = get(data,"meta.count", null);
          console.log("[works general] endpoint", ei, "page", page, "count", general.length, "meta.count", metaCount);
          if (general.length || metaCount != null) break; // accept this attempt
        }catch(e){
          console.warn("works general attempt", ei, "failed", e);
          if (ei === endpoints.length - 1) general = [];
        }
      }

      if (page === 1) {
        totalResults = (metaCount != null ? metaCount : (general.length || 0));
      }

      // dedupe by stable key
      var merged = collated.concat(general);
      var out = [];
      for (var j=0;j<merged.length;j++){
        var w = merged[j] || {};
        var key = (w.id || get(w,"ids.openalex","") || get(w,"doi","") || get(w,"display_name","")) + "";
        if (!key) continue;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push(w);
      }
      return out;
    } catch(e){
      console.error("fetchPapers failed", e);
      return [];
    }
  }

  // ---------- renderers ----------
  function renderAuthorsList(authors){
    var el = $("researcherList");
    if (!el) return; // page might not have authors column
    el.innerHTML = authors.length ? authors.map(function(a){
      var tail = idTail(a.id);
      var inst = get(a,"last_known_institution.display_name","No affiliation");
      return (
        '<li class="list-item list-card" onclick="location.href=\'profile.html?id='+encodeURIComponent(tail)+'\'" tabindex="0" role="button" aria-label="'+escapeHtml(a.display_name)+'">' +
          '<div class="title">'+escapeHtml(a.display_name || "Unknown")+'</div>' +
          '<div class="muted">'+escapeHtml(inst)+'</div>' +
        '</li>'
      );
    }).join("") : '<li class="muted">No authors found.</li>';
  }

  function renderTopicsList(topics){
    var el = $("topicList");
    if (!el) return; // page might not have topics column
    el.innerHTML = topics.length ? topics.map(function(t){
      var tail = idTail(t.id);
      return '<li class="list-item list-card" onclick="location.href=\'topic.html?id='+encodeURIComponent(tail)+'\'" tabindex="0" role="button" aria-label="'+escapeHtml(t.display_name)+'">'+escapeHtml(t.display_name)+'</li>';
    }).join("") : '<li class="muted">No topics found.</li>';
  }

  function renderPapers(works, append){
    var shell = ensureResultsShell();
    var list = $("papersList");
    if (!list) return;

    if (!append) list.innerHTML = "";

    var useComp = (window.SE && SE.components && typeof SE.components.renderPaperCard === "function");
    for (var i=0;i<works.length;i++){
      if (useComp) {
        try{
          list.insertAdjacentHTML("beforeend", SE.components.renderPaperCard(works[i]));
        }catch(e){
          console.warn("renderPaperCard failed, falling back", e);
          useComp = false; i--; // retry this item with fallback
          continue;
        }
      } else {
        var w = works[i] || {};
        var idTailWork = idTail(w.id);
        var title = w.display_name || "Untitled work";
        var venue = get(w,"host_venue.display_name","Unknown venue");
        var year = (w.publication_year!=null?w.publication_year:"");
        var authors = Array.isArray(w.authorships)?w.authorships.map(function(a){
          var aid = idTail(get(a,"author.id",""));
          var name = escapeHtml(get(a,"author.display_name","Unknown"));
          return aid ? '<a href="profile.html?id='+encodeURIComponent(aid)+'">'+name+'</a>' : name;
        }).join(", "):"Unknown authors";
        list.insertAdjacentHTML("beforeend",
          '<article class="result-card">' +
            '<h3><a href="paper.html?id='+encodeURIComponent(idTailWork)+'">'+escapeHtml(title)+'</a></h3>' +
            '<p class="meta">'+(year?'<span class="muted">'+escapeHtml(String(year))+'</span> · ':'')+'<strong>Published in:</strong> '+escapeHtml(venue)+'</p>' +
            '<p><strong>Authors:</strong> '+authors+'</p>' +
          '</article>'
        );
      }
    }
    if (useComp && SE.components && typeof SE.components.enhancePaperCards === "function") {
      try { SE.components.enhancePaperCards(list); } catch(e){ console.warn("enhancePaperCards failed", e); }
    }

    var countEl = $("paperCount");
    if (countEl) countEl.textContent = (totalResults||0).toLocaleString();

    var pagination = $("pagination");
    if (!pagination) return;
    var shown = Math.min(currentPage * PAGE_SIZE, totalResults || 0);
    if ((totalResults || 0) > shown) {
      pagination.innerHTML = '<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>';
      var btn = $("loadMoreBtn");
      if (btn){
        btn.onclick = async function(){
          btn.disabled = true; btn.textContent = "Loading…";
          currentPage += 1;
          try{
            var more = await fetchPapers(currentQuery, currentAuthorIds, currentPage);
            renderPapers(more, true);
          } finally {
            if (currentPage * PAGE_SIZE >= (totalResults||0)) {
              pagination.innerHTML = '<p class="muted">All results loaded.</p>';
            } else {
              btn.disabled = false; btn.textContent = "Load more";
            }
          }
        };
      }
    } else {
      pagination.innerHTML = '<p class="muted">All results loaded.</p>';
    }
  }

  // ---------- flow ----------
  async function runSearch(query){
    currentQuery = query;
    currentPage = 1;
    totalResults = 0;
    seen = Object.create(null);

    ensureResultsShell();
    var list = $("papersList"); if (list) list.innerHTML = "<p>Loading papers...</p>";
    var rList = $("researcherList"); if (rList) rList.innerHTML = '<li class="muted">Loading authors...</li>';
    var tList = $("topicList"); if (tList) tList.innerHTML = '<li class="muted">Loading topics...</li>';

    // authors first so we can boost author-scoped pulls
    var authors = [];
    try { authors = await fetchAuthors(query); } catch(e){ console.error(e); }
    renderAuthorsList(authors);
    currentAuthorIds = authors.map(function(a){ return idTail(a.id); }).filter(Boolean);

    // papers
    try {
      var papers = await fetchPapers(query, currentAuthorIds, currentPage);
      if (!papers.length && !totalResults){
        showBanner("info", "No papers found for “"+query+"”. Try refining your keywords.");
      }
      renderPapers(papers, false);
    } catch(e){
      showFatal(e.message || e);
      ensureResultsShell();
      $("papersList").innerHTML = '<p class="muted">Could not load papers.</p>';
    }

    // topics
    try {
      var topics = await fetchTopics(query);
      renderTopicsList(topics);
    } catch(e){
      console.error(e);
      var t = $("topicList"); if (t) t.innerHTML = '<li class="muted">Could not load topics.</li>';
    }
  }

  // expose for the on-page button / Enter key
  window.handleUnifiedSearch = function(){
    var input = $("unifiedSearchInput") || $("searchInput");
    var q = input ? (input.value || "").trim() : "";
    if (!q) return;
    try { runSearch(q); }
    catch (e) { console.error(e); showFatal(e.message || e); }
  };

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", function(){
    var params = new URLSearchParams(location.search);
    var q = (params.get("q") || "").trim();
    var input = $("unifiedSearchInput") || $("searchInput");

    if (q) {
      if (input) input.value = q;
      try { runSearch(q); }
      catch (e) { console.error(e); showFatal(e.message || e); }
    }

    if (input) {
      input.addEventListener("keypress", function(e){
        if (e.key === "Enter"){ e.preventDefault(); window.handleUnifiedSearch(); }
      });
    }

    // Dev hint if running from file:// (some browsers restrict fetch from file origins)
    try {
      if (location.protocol === "file:") {
        console.warn("You are running from file:// — if you see CORS/network errors, serve the folder with a local web server (e.g. `python3 -m http.server`).");
      }
    } catch(_) {}
  });
})();
