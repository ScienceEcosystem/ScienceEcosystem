// scripts/search.js
(function () {
  // ---------- globals used across the site ----------
  // Keep handleSearch global for the top nav on every page.
  window.handleSearch = function (inputId) {
    var el = document.getElementById(inputId);
    if (!el) return;
    var q = (el.value || "").trim();
    if (!q) return;
    window.location.href = "search.html?q=" + encodeURIComponent(q);
  };

  // Only auto-run the unified search code on the search page
  if (!document.body || document.body.dataset.page !== "search") return;

  // ---------- constants & helpers ----------
  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";
  var PAGE_SIZE = 25; // per page for works

  function $(id) { return document.getElementById(id); }
  function escapeHtml(str) {
    str = (str == null ? "" : String(str));
    return str.replace(/[&<>'"]/g, function (c) { return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" })[c]; });
  }
  function get(obj, path, fb) {
    try { var p = path.split("."), cur = obj;
      for (var i=0;i<p.length;i++){ if (cur == null) return fb; cur = cur[p[i]]; }
      return (cur == null ? fb : cur);
    } catch(e) { return fb; }
  }
  function addMailto(u) {
    var url = new URL(u, API);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }
  async function getJSON(url) {
    var withMt = addMailto(url);
    for (var attempt=1; attempt<=2; attempt++){
      try{
        var res = await fetch(withMt, { headers: { "Accept": "application/json" } });
        if (res.status === 429){
          var ra = parseInt(res.headers.get("Retry-After") || "1", 10);
          await new Promise(function(r){ setTimeout(r, Math.min(ra,5)*1000); });
          continue;
        }
        if (!res.ok) throw new Error(res.status + " " + res.statusText);
        return await res.json();
      } catch (e){
        if (attempt === 2) throw e;
      }
    }
    throw new Error("Unreachable");
  }

  // ---------- state ----------
  var currentPage = 1;
  var currentQuery = "";
  var currentAuthorIds = [];
  var totalResults = 0;
  var seenIds = Object.create(null); // for dedupe by OpenAlex id

  // ---------- fetchers ----------
  async function fetchAuthors(query) {
    try {
      var url = API + "/authors?search=" + encodeURIComponent(query)
        + "&per_page=5"
        + "&select=id,display_name,last_known_institution";
      var data = await getJSON(url);
      return data.results || [];
    } catch (e) {
      console.warn("Author fetch failed", e);
      return [];
    }
  }

  async function fetchTopics(query) {
    try {
      var url = API + "/concepts?search=" + encodeURIComponent(query)
        + "&per_page=5"
        + "&select=id,display_name";
      var data = await getJSON(url);
      return data.results || [];
    } catch (e) {
      console.warn("Topic fetch failed", e);
      return [];
    }
  }

  // Works with optional author filters, pagination, dedupe, and fields for card rendering
  async function fetchPapers(query, authorIds, page) {
    var all = [];
    try {
      // 1) Author-constrained pulls (loop OR; OpenAlex filter doesn't allow pipe-union for author.id directly)
      if (Array.isArray(authorIds) && authorIds.length) {
        for (var i=0;i<authorIds.length;i++){
          var aid = authorIds[i];
          var urlA = API + "/works?filter=author.id:" + encodeURIComponent(aid)
            + "&per_page=" + String(PAGE_SIZE)
            + "&page=" + String(page)
            + "&select=" + [
              "id","ids","doi","display_name","publication_year",
              "host_venue","primary_location","best_oa_location","open_access",
              "authorships","abstract_inverted_index","cited_by_count"
            ].join(",");
          var dataA = await getJSON(urlA);
          if (Array.isArray(dataA.results)) all = all.concat(dataA.results);
        }
      }

      // 2) General search
      var url = API + "/works?search=" + encodeURIComponent(query)
        + "&per_page=" + String(PAGE_SIZE)
        + "&page=" + String(page)
        + "&select=" + [
          "id","ids","doi","display_name","publication_year",
          "host_venue","primary_location","best_oa_location","open_access",
          "authorships","abstract_inverted_index","cited_by_count"
        ].join(",");
      var data = await getJSON(url);
      var general = Array.isArray(data.results) ? data.results : [];
      if (page === 1) totalResults = get(data, "meta.count", general.length) || general.length;

      // 3) Dedupe by OpenAlex id (fall back to doi/title hash if needed)
      var out = [];
      for (var j=0;j<all.concat(general).length;j++){
        var w = all.concat(general)[j];
        var key = (w.id || get(w,"ids.openalex","") || get(w,"doi","") || get(w,"display_name","")) + "";
        if (seenIds[key]) continue;
        seenIds[key] = 1;
        out.push(w);
      }
      return out;
    } catch (e) {
      console.warn("Paper fetch failed", e);
      return [];
    }
  }

  // ---------- renderers ----------
  function renderAuthors(authors) {
    var el = $("researcherList");
    if (!el) return;
    if (!authors.length) {
      el.innerHTML = '<li class="muted">No authors found.</li>';
      return;
    }
    el.innerHTML = authors.map(function(a){
      var id = (a.id || "").split("/").pop();
      var inst = get(a, "last_known_institution.display_name", "No affiliation");
      return '' +
        '<li class="list-item list-card" onclick="location.href=\'profile.html?id='+id+'\'" tabindex="0" role="button" aria-label="'+escapeHtml(a.display_name)+'">' +
          '<div class="title">'+escapeHtml(a.display_name)+'</div>' +
          '<div class="muted">'+escapeHtml(inst)+'</div>' +
        '</li>';
    }).join("");
  }

  function renderTopics(topics) {
    var el = $("topicList");
    if (!el) return;
    if (!topics.length) {
      el.innerHTML = '<li class="muted">No topics found.</li>';
      return;
    }
    el.innerHTML = topics.map(function(t){
      var id = (t.id || "").split("/").pop();
      return '' +
        '<li class="list-item list-card" onclick="location.href=\'topic.html?id='+id+'\'" tabindex="0" role="button" aria-label="'+escapeHtml(t.display_name)+'">' +
          escapeHtml(t.display_name) +
        '</li>';
    }).join("");
  }

  function ensureResultsShell() {
    var results = $("unifiedSearchResults");
    if (!results) return null;
    if (!/Papers/.test(results.innerHTML)) {
      results.innerHTML = '' +
        '<h2>Papers <span class="muted">(<span id="paperCount">0</span> results)</span></h2>' +
        '<div id="papersList"></div>' +
        '<div id="pagination"></div>';
    }
    return results;
  }

  function renderPapers(works, append) {
    var shell = ensureResultsShell();
    if (!shell) return;

    var papersList = $("papersList");
    if (!papersList) return;

    if (!append) papersList.innerHTML = "";

    // Prefer shared paper card if available
    var useComponent = (window.SE && SE.components && typeof SE.components.renderPaperCard === "function");
    for (var i=0;i<works.length;i++){
      if (useComponent) {
        papersList.insertAdjacentHTML("beforeend", SE.components.renderPaperCard(works[i]));
      } else {
        // Fallback simple card (should rarely be used)
        var w = works[i];
        var idTail = (w.id||"").split("/").pop();
        var title = w.display_name || "Untitled work";
        var venue = get(w,"host_venue.display_name","Unknown venue");
        var year = (w.publication_year != null ? w.publication_year : "");
        var authors = Array.isArray(w.authorships) ? w.authorships.map(function(a){
          var aid = get(a,"author.id","").split("/").pop();
          var name = escapeHtml(get(a,"author.display_name","Unknown"));
          return '<a href="profile.html?id='+aid+'">'+name+'</a>';
        }).join(", ") : "Unknown authors";
        papersList.insertAdjacentHTML("beforeend",
          '<article class="result-card">' +
            '<h3><a href="paper.html?id='+idTail+'">'+escapeHtml(title)+'</a></h3>' +
            '<p class="meta">'+(year?'<span class="muted">'+year+'</span> · ':'')+'<strong>Published in:</strong> '+escapeHtml(venue)+'</p>' +
            '<p><strong>Authors:</strong> '+authors+'</p>' +
          '</article>'
        );
      }
    }

    // Enhance cards (Unpaywall badge + abstract toggle + Save)
    if (useComponent) SE.components.enhancePaperCards(papersList);

    // Count + pagination
    var countEl = $("paperCount");
    if (countEl) countEl.textContent = (totalResults || 0).toLocaleString();

    var pagination = $("pagination");
    if (!pagination) return;
    var shownEstimate = currentPage * PAGE_SIZE;
    if (shownEstimate < totalResults) {
      pagination.innerHTML = '<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>';
      var btn = $("loadMoreBtn");
      if (btn) {
        btn.onclick = async function () {
          btn.disabled = true; btn.textContent = "Loading…";
          currentPage += 1;
          var more = await fetchPapers(currentQuery, currentAuthorIds, currentPage);
          renderPapers(more, true);
          btn.disabled = false; btn.textContent = "Load more";
          if (currentPage * PAGE_SIZE >= totalResults) pagination.innerHTML = '<p class="muted">All results loaded.</p>';
        };
      }
    } else {
      pagination.innerHTML = '<p class="muted">All results loaded.</p>';
    }
  }

  // ---------- unified search flow ----------
  async function handleUnifiedSearch() {
    var input = $("unifiedSearchInput");
    if (!input) return;
    var query = (input.value || "").trim();
    if (!query) return;

    currentQuery = query;
    currentPage = 1;
    seenIds = Object.create(null);

    var results = $("unifiedSearchResults");
    var rList = $("researcherList");
    var tList = $("topicList");
    if (results) results.innerHTML = "<p>Loading papers...</p>";
    if (rList) rList.innerHTML = '<li class="muted">Loading authors...</li>';
    if (tList) tList.innerHTML = '<li class="muted">Loading topics...</li>';

    // 1) Authors first (so we can filter works by relevant author IDs)
    var authors = await fetchAuthors(query);
    renderAuthors(authors);
    currentAuthorIds = authors.map(function(a){ return a.id; });

    // 2) Papers (page 1)
    var papers = await fetchPapers(query, currentAuthorIds, currentPage);
    renderPapers(papers, false);

    // 3) Topics in parallel (doesn’t affect papers)
    var topics = await fetchTopics(query);
    renderTopics(topics);
  }

  // expose on window for the page button/enter to use
  window.handleUnifiedSearch = handleUnifiedSearch;

  // ---------- init on page load ----------
  document.addEventListener("DOMContentLoaded", function () {
    var params = new URLSearchParams(window.location.search);
    var input = $("unifiedSearchInput");

    if (params.has("q") && input) {
      input.value = params.get("q") || "";
      handleUnifiedSearch();
    }

    if (input) {
      input.addEventListener("keypress", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleUnifiedSearch();
        }
      });
    }
  });
})();

