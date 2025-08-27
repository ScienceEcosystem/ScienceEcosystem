// scripts/search.js
(function () {
  const API = "https://api.openalex.org";
  const MAILTO = "scienceecosystem@icloud.com";
  const PAGE_SIZE = 25;

  let currentPage = 1;
  let currentQuery = "";
  let currentAuthorIds = [];
  let totalResults = 0;
  let seen = Object.create(null);

  function $(id){ return document.getElementById(id); }
  function escapeHtml(str){ str=(str==null?"":String(str)); return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; }); }
  function idTail(anyId){ if(!anyId) return ""; var s=String(anyId); var parts=s.split("/"); return parts[parts.length-1]; }
  function addMailto(u){ try { var url = new URL(u, API); if(!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO); return url.toString(); } catch(_) { return u; } }
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  async function getJSON(url){
    const withMt = addMailto(url);
    for (let attempt=1; attempt<=2; attempt++){
      try{
        const res = await fetch(withMt, { headers:{ "Accept":"application/json" }});
        if (res.status === 429){
          const ra = parseInt(res.headers.get("Retry-After")||"1",10);
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

  async function fetchAuthors(query){
    try {
      const url = API + "/authors?search=" + encodeURIComponent(query)
        + "&per_page=5&select=id,display_name,last_known_institution";
      const data = await getJSON(url);
      return data.results || [];
    } catch(e){ console.error("fetchAuthors failed", e); return []; }
  }

  async function fetchTopics(query){
    try {
      const url = API + "/concepts?search=" + encodeURIComponent(query)
        + "&per_page=5&select=id,display_name";
      const data = await getJSON(url);
      return data.results || [];
    } catch(e){ console.error("fetchTopics failed", e); return []; }
  }

  async function fetchPapers(query, authorIds, page){
    let collated = [];
    try {
      // author-scoped works
      if (Array.isArray(authorIds) && authorIds.length){
        for (let i=0;i<authorIds.length;i++){
          const aidTail = idTail(authorIds[i]);
          if (!aidTail) continue;
          const urlA = API + "/works?filter=author.id:" + encodeURIComponent(aidTail)
            + "&per_page=" + PAGE_SIZE + "&page=" + page
            + "&select=id,ids,doi,display_name,publication_year,host_venue,primary_location,best_oa_location,open_access,authorships,cited_by_count";
          try{
            const dataA = await getJSON(urlA);
            if (Array.isArray(dataA.results)) collated = collated.concat(dataA.results);
          }catch(e){ console.warn("author-scoped works failed for", aidTail, e); }
        }
      }

      // general search
      const url = API + "/works?search=" + encodeURIComponent(query)
        + "&per_page=" + PAGE_SIZE + "&page=" + page
        + "&select=id,ids,doi,display_name,publication_year,host_venue,primary_location,best_oa_location,open_access,authorships,cited_by_count";
      const data = await getJSON(url);
      const general = Array.isArray(data.results) ? data.results : [];

      if (page === 1) totalResults = get(data,"meta.count",general.length) || general.length;

      // dedupe
      const merged = collated.concat(general);
      const out = [];
      for (let w of merged){
        const key = (w.id || get(w,"ids.openalex","") || get(w,"doi","") || get(w,"display_name","")) + "";
        if (!key || seen[key]) continue;
        seen[key] = 1;
        out.push(w);
      }
      return out;
    } catch(e){ console.error("fetchPapers failed", e); return []; }
  }

  function get(obj, path, fb){ try{ const p=path.split("."), cur=obj; for(let i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; }catch(_){ return fb; } }

  function ensureResultsShell(){
    let results = $("unifiedSearchResults");
    if (!results) return;
    if (!/id="papersList"/.test(results.innerHTML)){
      results.innerHTML =
        '<h2>Papers <span class="muted">(<span id="paperCount">0</span> results)</span></h2>' +
        '<div id="papersList"><p class="muted">Enter a search term above.</p></div>' +
        '<div id="pagination"></div>';
    }
    return results;
  }

  function renderAuthorsList(authors){
    const el = $("researcherList"); if (!el) return;
    el.innerHTML = authors.length ? authors.map(a=>{
      const tail = idTail(a.id);
      const inst = get(a,"last_known_institution.display_name","No affiliation");
      return '<li class="list-item list-card" onclick="location.href=\'profile.html?id='+encodeURIComponent(tail)+'\'" tabindex="0" role="button" aria-label="'+escapeHtml(a.display_name)+'">' +
        '<div class="title">'+escapeHtml(a.display_name||"Unknown")+'</div>' +
        '<div class="muted">'+escapeHtml(inst)+'</div></li>';
    }).join("") : '<li class="muted">No authors found.</li>';
  }

  function renderTopicsList(topics){
    const el = $("topicList"); if (!el) return;
    el.innerHTML = topics.length ? topics.map(t=>{
      const tail = idTail(t.id);
      return '<li class="list-item list-card" onclick="location.href=\'topic.html?id='+encodeURIComponent(tail)+'\'" tabindex="0" role="button" aria-label="'+escapeHtml(t.display_name)+'">'+escapeHtml(t.display_name)+'</li>';
    }).join("") : '<li class="muted">No topics found.</li>';
  }

  function renderPapers(works, append){
    ensureResultsShell();
    const list = $("papersList"); if (!list) return;
    if (!append) list.innerHTML = "";

    for (let w of works){
      const idTailWork = idTail(w.id);
      const title = w.display_name || "Untitled work";
      const venue = get(w,"host_venue.display_name","Unknown venue");
      const year = (w.publication_year!=null?w.publication_year:"");
      const authors = Array.isArray(w.authorships)?w.authorships.map(a=>{
        const aid = idTail(get(a,"author.id",""));
        const name = escapeHtml(get(a,"author.display_name","Unknown"));
        return aid ? '<a href="profile.html?id='+encodeURIComponent(aid)+'">'+name+'</a>' : name;
      }).join(", ") : "Unknown authors";

      const oaLink = get(w,"best_oa_location.url",null);
      list.insertAdjacentHTML("beforeend",
        '<article class="result-card">' +
          '<h3><a href="paper.html?id='+encodeURIComponent(idTailWork)+'">'+escapeHtml(title)+'</a></h3>' +
          '<p class="meta">'+(year?'<span class="muted">'+escapeHtml(String(year))+'</span> · ':'')+'<strong>Published in:</strong> '+escapeHtml(venue)+'</p>' +
          '<p><strong>Authors:</strong> '+authors+'</p>' +
          (oaLink?'<p><a href="'+oaLink+'" target="_blank">Open Access PDF</a></p>':'')+
        '</article>'
      );
    }

    const countEl = $("paperCount"); if(countEl) countEl.textContent = (totalResults||0).toLocaleString();

    const pagination = $("pagination"); if (!pagination) return;
    const shown = Math.min(currentPage * PAGE_SIZE, totalResults || 0);
    if ((totalResults || 0) > shown){
      pagination.innerHTML = '<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>';
      const btn = $("loadMoreBtn");
      if (btn){
        btn.onclick = async function(){
          btn.disabled = true; btn.textContent = "Loading…";
          currentPage += 1;
          try{
            const more = await fetchPapers(currentQuery, currentAuthorIds, currentPage);
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

  async function runUnifiedSearch(query){
    currentQuery = query;
    currentPage = 1;
    totalResults = 0;
    seen = Object.create(null);

    ensureResultsShell();
    $("papersList").innerHTML = "<p>Loading papers...</p>";
    $("researcherList").innerHTML = '<li class="muted">Loading authors...</li>';
    $("topicList").innerHTML = '<li class="muted">Loading topics...</li>';

    try{
      const authors = await fetchAuthors(query);
      renderAuthorsList(authors);
      currentAuthorIds = authors.map(a=>idTail(a.id)).filter(Boolean);

      const papers = await fetchPapers(query, currentAuthorIds, currentPage);
      renderPapers(papers,false);

      const topics = await fetchTopics(query);
      renderTopicsList(topics);
    } catch(e){
      console.error("runUnifiedSearch failed", e);
      $("papersList").innerHTML = '<p class="muted">Could not load papers.</p>';
      $("researcherList").innerHTML = '<li class="muted">Could not load authors.</li>';
      $("topicList").innerHTML = '<li class="muted">Could not load topics.</li>';
    }
  }

  window.handleUnifiedSearch = function(){
    const input = $("unifiedSearchInput");
    const q = input ? (input.value || "").trim() : "";
    if (!q) return;
    runUnifiedSearch(q);
  };

  document.addEventListener("DOMContentLoaded", function(){
    const params = new URLSearchParams(location.search);
    const q = (params.get("q") || "").trim();
    const input = $("unifiedSearchInput");
    if (q && input){ input.value = q; runUnifiedSearch(q); }

    if (input){
      input.addEventListener("keypress", function(e){
        if (e.key === "Enter"){ e.preventDefault(); window.handleUnifiedSearch(); }
      });
    }
  });
})();

