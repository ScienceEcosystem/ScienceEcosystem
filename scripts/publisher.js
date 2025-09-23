// scripts/publisher.js
(function () {
  if (!document.body || document.body.dataset.page !== "publisher") return;

  var API = "https://api.openalex.org";
  var MAILTO = "info@scienceecosystem.org";
  var PAGE_SIZE = 50;

  var worksApiBaseUrl = null;   // from publisher.works_api_url if present
  var sourcesApiBaseUrl = null; // from publisher.sources_api_url if present
  var currentPage = 1;
  var totalWorksCount = 0;
  var accumulated = [];
  var currentSort = "date";
  var abortCtrl = null;

  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function esc(s){ s=(s==null?"":String(s)); return s.replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function get(o,p,fb){ try{ var a=p.split("."),cur=o; for(var i=0;i<a.length;i++){ if(cur==null) return fb; cur=cur[a[i]]; } return cur==null?fb:cur; }catch(e){ return fb; } }
  function addMailto(u){ var url = new URL(u, API); if(!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO); return url.toString(); }
  async function getJSON(url){
    var withMt = addMailto(url);
    for (var attempt=1; attempt<=2; attempt++){
      try{
        var res = await fetch(withMt, { headers:{ "Accept":"application/json" }, signal: abortCtrl ? abortCtrl.signal : undefined });
        if (res.status===429){
          var ra=parseInt(res.headers.get("Retry-After")||"1",10);
          await new Promise(r=>setTimeout(r, Math.min(ra,5)*1000));
          continue;
        }
        if (!res.ok) throw new Error(res.status+" "+res.statusText);
        return await res.json();
      }catch(e){
        if (e.name==="AbortError") throw e;
        if (attempt===2) throw e;
      }
    }
    throw new Error("Unreachable");
  }

  // charts helpers (same as journal.js)
  function niceTicks(maxValue, count){
    count = count || 4;
    if (maxValue <= 0) return [0, 1];
    var exp = Math.floor(Math.log10(maxValue));
    var base = Math.pow(10, exp);
    var niceMax = Math.ceil(maxValue / base) * base;
    var steps=[1,2,5,10], step=base;
    for (var i=0;i<steps.length;i++){ var s=steps[i]*base; if (niceMax / s <= count){ step=s; break; } }
    var ticks=[];
    for (var v=0; v<=niceMax+1e-9; v+=step){ ticks.push(Math.round(v)); }
    if (ticks[ticks.length-1]!==niceMax) ticks.push(niceMax);
    return ticks;
  }
  function renderBarChartSVG(opts){
    var title=opts.title||"", id=opts.id||("c"+Math.random().toString(36).slice(2));
    var series=Array.isArray(opts.series)?opts.series:[];
    var H=220,W=600,padL=56,padR=10,padT=14,padB=40,innerW=W-padL-padR,innerH=H-padT-padB;
    if (!series.length) return '<div class="chart-block"><h4>'+esc(title)+'</h4><p class="muted">No data.</p></div>';
    var n=series.length, maxVal=Math.max(1,...series.map(s=>s.value||0));
    var ticks=niceTicks(maxVal,4), maxTick=ticks[ticks.length-1];
    var step=innerW/n, barW=Math.max(5, Math.min(24, step*0.6));
    var y0=padT+innerH; function y(v){return padT+innerH-(v/maxTick)*innerH;}
    var bars = series.map(function(s,i){
      var bx=padL+i*step+(step-barW)/2, by=y(s.value||0), h=Math.max(0, y0-by);
      return '<rect x="'+bx.toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" ry="3"><title>'+esc(String(s.year))+': '+esc(String(s.value||0))+'</title></rect>';
    });
    var years=series.map(s=>s.year);
    var xLabels=[
      '<text x="'+padL+'" y="'+(H-10)+'" class="xlabel">'+esc(String(years[0]))+'</text>',
      '<text x="'+(padL+innerW/2)+'" y="'+(H-10)+'" class="xlabel" text-anchor="middle">'+esc(String(years[Math.floor(n/2)]))+'</text>',
      '<text x="'+(W-padR)+'" y="'+(H-10)+'" class="xlabel" text-anchor="end">'+esc(String(years[n-1]))+'</text>'
    ];
    var grid=[],yLabels=[];
    for (var t=0;t<ticks.length;t++){
      var val=ticks[t], gy=y(val);
      grid.push('<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+gy.toFixed(1)+'" y2="'+gy.toFixed(1)+'" class="grid"/>');
      yLabels.push('<text x="'+(padL-8)+'" y="'+(gy+4).toFixed(1)+'" class="ylabel" text-anchor="end">'+esc(val.toLocaleString())+'</text>');
    }
    return ''+
      '<div class="chart-block">'+
      '<h4>'+esc(title)+'</h4>'+
      '<svg class="chart-svg" viewBox="0 0 '+W+' '+H+'" width="100%" height="220" role="img" aria-labelledby="'+id+'-title">'+
        '<title id="'+id+'-title">'+esc(title)+'</title>'+
        '<g fill="none" stroke="currentColor" stroke-opacity=".08" stroke-width="1">'+grid.join("")+'</g>'+
        '<g class="axis" fill="currentColor" fill-opacity=".85" font-size="12">'+yLabels.join("")+'</g>'+
        '<g class="bars" fill="currentColor" fill-opacity=".78">'+bars.join("")+'</g>'+
        '<g class="axis" fill="currentColor" fill-opacity=".85" font-size="12">'+xLabels.join("")+'</g>'+
      '</svg>'+
      '</div>';
  }
  function buildYearSeries(entity){
    var rows = Array.isArray(entity.counts_by_year) ? entity.counts_by_year.slice() : [];
    if (!rows.length) return [];
    rows.sort((a,b)=>a.year-b.year);
    var map={}; rows.forEach(r=>{ map[r.year]={ year:r.year, works:Number(r.works_count||0), cites:Number(r.cited_by_count||0) }; });
    var minY = rows[0].year, maxY = rows[rows.length-1].year, out=[];
    for (var y=minY; y<=maxY; y++){ out.push(map[y] || {year:y, works:0, cites:0}); }
    return out;
  }

  // ---- Rendering ----
  function renderHeader(pub){
    if ($("pubName")) $("pubName").textContent = pub.display_name || "Unknown publisher";

    var homepage = get(pub,"homepage_url",null);
    if ($("pubLinks")){
      var bits=[];
      bits.push('<a href="'+esc(get(pub,"id","#"))+'" target="_blank" rel="noopener">OpenAlex</a>');
      if (homepage) bits.push('<a href="'+esc(homepage)+'" target="_blank" rel="noopener">Homepage</a>');
      $("pubLinks").innerHTML = bits.join(" · ");
    }

    if ($("totalWorks")) $("totalWorks").textContent = (get(pub,"works_count",0)||0).toLocaleString();
    if ($("totalCitations")) $("totalCitations").textContent = (get(pub,"cited_by_count",0)||0).toLocaleString();

    if ($("pubSummary")){
      var parts=[];
      parts.push((pub.display_name||"This publisher")+" has "+(get(pub,"works_count",0)||0).toLocaleString()+" works");
      var cit = get(pub,"cited_by_count",0)||0;
      if (cit) parts.push("and "+cit.toLocaleString()+" total citations");
      if (homepage) parts.push(". Homepage available.");
      $("pubSummary").textContent = parts.join("");
    }
  }

  function renderTrends(pub){
    var wrap = $("trendCharts");
    if (!wrap) return;
    var s = buildYearSeries(pub);
    if (!s.length){ wrap.innerHTML = '<p class="muted">No trend data available.</p>'; return; }
    var cites = s.map(r=>({year:r.year, value:r.cites}));
    var works = s.map(r=>({year:r.year, value:r.works}));
    wrap.innerHTML = renderBarChartSVG({ title:"Citations per year", series:cites, id:"cites"}) +
                     renderBarChartSVG({ title:"Works per year",     series:works, id:"works"});
  }

  // ---- Works ----
  function clearWorks(){
    var list=$("publicationsList"); if (list) list.innerHTML="";
    var pag=$("pubsPagination"); if (pag) pag.innerHTML="";
  }
  function sortParam(){ return currentSort==="citations" ? "cited_by_count:desc" : "publication_year:desc"; }

  async function fetchWorksPage(page, replace){
    if (!worksApiBaseUrl) return;
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    var u = new URL(worksApiBaseUrl);
    u.searchParams.set("page", String(page));
    u.searchParams.set("per_page", String(PAGE_SIZE));
    u.searchParams.set("sort", sortParam());

    try{
      var data = await getJSON(u.toString());
      var results = Array.isArray(data.results) ? data.results : [];
      totalWorksCount = get(data,"meta.count", totalWorksCount || results.length || 0);

      if (replace){ accumulated = results.slice(); clearWorks(); }
      else { accumulated = accumulated.concat(results); }

      var list = $("publicationsList");
      if (list && /Loading works/i.test(list.textContent)) list.innerHTML = "";
      for (var i=0;i<results.length;i++){
        list.insertAdjacentHTML("beforeend", SE.components.renderPaperCard(results[i], { compact: true }));
      }
      SE.components.enhancePaperCards(list);

      var pag = $("pubsPagination");
      var shown = accumulated.length;
      if (pag){
        if (shown < totalWorksCount){
          pag.innerHTML = '<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>';
          var btn = $("loadMoreBtn");
          btn.onclick = async function(){
            btn.disabled = true; btn.textContent="Loading…";
            currentPage += 1;
            await fetchWorksPage(currentPage, false);
            btn.disabled = false; btn.textContent="Load more";
          };
        } else {
          pag.innerHTML = '<p class="muted">All results loaded.</p>';
        }
      }
    }catch(e){
      if (e.name==="AbortError") return;
      var list=$("publicationsList");
      if (list) list.innerHTML = '<div class="notice error"><strong>Error:</strong> '+esc(e.message||String(e))+'</div>';
      console.error(e);
    }
  }

  // ---- Journals list under publisher ----
  async function fetchJournalsList(pubTail){
    // Prefer an API pointer if present on the entity
    var url = sourcesApiBaseUrl || (API + "/sources?filter=publisher.id:" + encodeURIComponent(pubTail) + "&per_page=50&sort=works_count:desc");
    try{
      var data = await getJSON(url);
      var results = Array.isArray(data.results) ? data.results : [];
      var box = $("journalsList");
      if (!box) return;
      if (!results.length){
        box.innerHTML = '<li class="muted">No journals found for this publisher.</li>';
        return;
      }
      box.innerHTML = results.slice(0,50).map(function(s){
        var tail = String(s.id||"").replace(/^https?:\/\/openalex\.org\//i,"");
        var metaBits = [];
        var issn_l = get(s,"issn_l",null);
        if (issn_l) metaBits.push("ISSN-L: "+esc(issn_l));
        var oa = !!get(s,"is_oa",false);
        if (oa) metaBits.push("OA");
        return '<li class="list-item list-card" style="display:flex; justify-content:space-between; align-items:center;">' +
                 '<a href="journal.html?id='+encodeURIComponent(tail)+'">'+esc(s.display_name||"Journal")+'</a>' +
                 '<span class="muted">'+esc(metaBits.join(" · "))+'</span>' +
               '</li>';
      }).join("");
    }catch(e){
      var box = $("journalsList");
      if (box) box.innerHTML = '<li class="muted">Could not load journals.</li>';
      console.error(e);
    }
  }

  async function boot(){
    try{
      var raw = getParam("id");
      var tail = (raw||"").trim();
      try{ tail = decodeURIComponent(tail); }catch(_){}
      if (tail.indexOf("/")!==-1){ var seg=tail.split("/").filter(Boolean); tail=seg[seg.length-1]; }
      if (!tail){ $("pubName").textContent = "No publisher specified."; return; }

      var pub = await getJSON(API + "/publishers/" + encodeURIComponent(tail));
      renderHeader(pub);
      renderTrends(pub);

      // Preferred: OpenAlex usually exposes these API helper URLs
      worksApiBaseUrl   = get(pub, "works_api_url", null)   || (API + "/works?filter=host_venue.publisher_id:" + encodeURIComponent(tail));
      sourcesApiBaseUrl = get(pub, "sources_api_url", null) || null;

      // Works
      var list = $("publicationsList");
      if (list) list.innerHTML = '<p class="muted">Loading works…</p>';
      currentPage = 1; accumulated = []; totalWorksCount = 0;
      await fetchWorksPage(currentPage, true);

      var sortSel = $("pubSort");
      if (sortSel){
        sortSel.value = "date";
        sortSel.addEventListener("change", async function(){
          currentSort = this.value === "citations" ? "citations" : "date";
          currentPage = 1; accumulated = [];
          await fetchWorksPage(currentPage, true);
        });
      }

      // Journals under this publisher
      await fetchJournalsList(tail);

      try { await getJSON(API + "/works?per_page=1"); } catch(_){}
    }catch(e){
      console.error(e);
      var list = $("publicationsList");
      if (list) list.innerHTML = '<div class="notice error"><strong>Error:</strong> '+esc(e.message||String(e))+'</div>';
      var box = $("journalsList");
      if (box) box.innerHTML = '<li class="muted">Could not load journals.</li>';
      var wrap = $("trendCharts");
      if (wrap) wrap.innerHTML = '<p class="muted">Could not load trends.</p>';
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
