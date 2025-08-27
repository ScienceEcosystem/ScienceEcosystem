// scripts/search.js
(function () {
  // ---------- global for top nav ----------
  window.handleSearch = function (inputId) {
    var el = document.getElementById(inputId);
    if (!el) return;
    var q = (el.value || "").trim();
    if (!q) return;
    window.location.href = "search.html?q=" + encodeURIComponent(q);
  };

  // ---------- constants ----------
  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";
  var PAGE_SIZE = 20;

  // state
  var currentPage = 1;
  var currentQuery = "";
  var currentAuthorIds = [];
  var totalResults = 0;
  var seen = Object.create(null);
  var currentSort = "relevance_score:desc"; // fixed default
  var currentYearFilter = "";

  // ---------- helpers ----------
  function $(id){ return document.getElementById(id); }
  function escapeHtml(str){ str=(str==null?"":String(str)); return str.replace(/[&<>'"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]); }
  function idTail(anyId){ if(!anyId) return ""; var s=String(anyId); var parts=s.split("/"); return parts[parts.length-1]; }
  async function getJSON(url){
    var withMt = url.includes("mailto") ? url : url + (url.includes("?")?"&":"?")+"mailto="+MAILTO;
    let res = await fetch(withMt); 
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }

  // ---------- ensure UI ----------
  function ensureResultsShell(){
    var results = $("unifiedSearchResults");
    if (!results) return;
    results.innerHTML =
      `<div class="filters">
        <label>Sort by:
          <select id="sortSelect">
            <option value="relevance_score:desc">Relevance</option>
            <option value="cited_by_count:desc">Most cited</option>
            <option value="publication_year:desc">Newest</option>
            <option value="publication_year:asc">Oldest</option>
          </select>
        </label>
        <label>Year:
          <input id="yearFilter" type="number" placeholder="e.g. 2020"/>
        </label>
        <button id="applyFilters" class="btn btn-small">Apply</button>
      </div>
      <h2>Papers <span class="muted">(<span id="paperCount">0</span> results)</span></h2>
      <div id="papersList"></div>
      <div id="pagination"></div>`;
    
    $("sortSelect").value = currentSort;
    $("applyFilters").onclick = function(){
      currentSort = $("sortSelect").value;
      currentYearFilter = $("yearFilter").value.trim();
      runSearch(currentQuery);
    };
  }

  // ---------- fetch ----------
  async function fetchAuthors(query){
    try {
      var url = API+"/authors?search="+encodeURIComponent(query)+"&per_page=5&select=id,display_name,last_known_institution";
      var data = await getJSON(url); return data.results || [];
    } catch(e){ return []; }
  }

  async function fetchTopics(query){
    try {
      var url = API+"/concepts?search="+encodeURIComponent(query)+"&per_page=5&select=id,display_name";
      var data = await getJSON(url); return data.results || [];
    } catch(e){ return []; }
  }

  async function fetchPapers(query, authorIds, page){
    var url = API+"/works?search="+encodeURIComponent(query)
      +"&per_page="+PAGE_SIZE+"&page="+page
      +"&sort="+encodeURIComponent(currentSort)
      +"&select=id,ids,doi,display_name,publication_year,host_venue,primary_location,best_oa_location,open_access,authorships,abstract_inverted_index,cited_by_count";

    // add filters only if present
    var filters = [];
    if (currentYearFilter) filters.push("publication_year:"+currentYearFilter);
    if (filters.length) url += "&filter=" + filters.join(",");

    var data = await getJSON(url);
    if (page===1) totalResults = data.meta.count || 0;
    return data.results || [];
  }

  // ---------- render ----------
  function renderAuthorsList(authors){
    $("researcherList").innerHTML = authors.length ? authors.map(a=>{
      var tail=idTail(a.id), inst=(a.last_known_institution||{}).display_name||"No affiliation";
      return `<li class="list-item list-card" onclick="location.href='profile.html?id=${encodeURIComponent(tail)}'" role="button">
        <div class="title">${escapeHtml(a.display_name||"Unknown")}</div>
        <div class="muted">${escapeHtml(inst)}</div>
      </li>`;
    }).join("") : '<li class="muted">No authors found.</li>';
  }

  function renderTopicsList(topics){
    $("topicList").innerHTML = topics.length ? topics.map(t=>{
      var tail=idTail(t.id);
      return `<li class="list-item list-card" onclick="location.href='topic.html?id=${encodeURIComponent(tail)}'" role="button">${escapeHtml(t.display_name)}</li>`;
    }).join("") : '<li class="muted">No topics found.</li>';
  }

  function renderPapers(works, append){
    var list = $("papersList"); if (!list) return;
    if (!append) list.innerHTML = "";
    works.forEach(w=>{
      var id = idTail(w.id);
      var title = escapeHtml(w.display_name||"Untitled work");
      var venue = escapeHtml((w.host_venue||{}).display_name||"Unknown venue");
      var year = w.publication_year || "";
      var authors = (w.authorships||[]).map(a=>{
        var aid=idTail((a.author||{}).id||""); 
        var name=escapeHtml((a.author||{}).display_name||"Unknown");
        return aid? `<a href="profile.html?id=${encodeURIComponent(aid)}">${name}</a>` : name;
      }).join(", ");
      var oa = w.best_oa_location ? `<a href="${w.best_oa_location.url}" target="_blank" class="btn btn-small">Free PDF</a>` : "";
      var saveBtn = `<button class="btn btn-small" onclick="saveToLibrary('${id}')">Save to Library</button>`;
      list.insertAdjacentHTML("beforeend",
        `<article class="result-card">
          <h3><a href="paper.html?id=${encodeURIComponent(id)}">${title}</a></h3>
          <p class="meta">${year? `<span class="muted">${year}</span> · `:""}<strong>Published in:</strong> ${venue}</p>
          <p><strong>Authors:</strong> ${authors}</p>
          <p><strong>Citations:</strong> ${w.cited_by_count||0}</p>
          <div class="actions">${oa} ${saveBtn}</div>
        </article>`);
    });
    $("paperCount").textContent = totalResults.toLocaleString();
    var pagination = $("pagination");
    var shown = Math.min(currentPage*PAGE_SIZE, totalResults);
    if (shown<totalResults){
      pagination.innerHTML = `<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>`;
      $("loadMoreBtn").onclick = async function(){
        currentPage++;
        var more = await fetchPapers(currentQuery, currentAuthorIds, currentPage);
        renderPapers(more,true);
      };
    } else {
      pagination.innerHTML = '<p class="muted">All results loaded.</p>';
    }
  }

  // Save button stub
  window.saveToLibrary = function(id){
    alert("Saved paper "+id+" to your library (demo)");
  };

  // ---------- flow ----------
  async function runSearch(query){
    currentQuery = query;
    currentPage = 1;
    seen = Object.create(null);
    ensureResultsShell();
    $("papersList").innerHTML="<p>Loading papers...</p>";
    $("researcherList").innerHTML="<li class='muted'>Loading authors...</li>";
    $("topicList").innerHTML="<li class='muted'>Loading topics...</li>";

    var authors = await fetchAuthors(query);
    renderAuthorsList(authors);
    currentAuthorIds = authors.map(a=>idTail(a.id));

    var papers = await fetchPapers(query,currentAuthorIds,currentPage);
    renderPapers(papers,false);

    var topics = await fetchTopics(query);
    renderTopicsList(topics);
  }

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", ()=>{
    var params = new URLSearchParams(location.search);
    var q = (params.get("q")||"").trim();
    var input = $("unifiedSearchInput")||$("searchInput");
    if (q){ if (input) input.value=q; runSearch(q); }
    if (input) input.addEventListener("keypress", e=>{ if (e.key==="Enter"){ e.preventDefault(); window.handleUnifiedSearch(); } });
  });

  window.handleUnifiedSearch = function(){
    var input=$("unifiedSearchInput")||$("searchInput");
    var q=input?(input.value||"").trim():""; if (!q) return;
    runSearch(q);
  };
})();
