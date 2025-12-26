// scripts/journal.js
(function () {
  if (!document.body || document.body.dataset.page !== "journal") return;

  var API = "https://api.openalex.org";
  var MAILTO = "info@scienceecosystem.org";
  var PAGE_SIZE = 50;

  // ---- State ----
  var worksApiBaseUrl = null;
  var currentPage = 1;
  var accumulated = [];
  var totalWorksCount = 0;
  var currentSort = "date";
  var abortCtrl = null;

  // ---- Utils ----
  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function esc(s){ s = (s==null ? "" : String(s)); return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function get(o,p,fb){ try{ var a=p.split("."),cur=o; for(var i=0;i<a.length;i++){ if(cur==null) return fb; cur=cur[a[i]]; } return (cur==null?fb:cur);}catch(e){return fb;} }
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

  async function findSourceByName(name){
    var q = (name||"").trim();
    if (!q) return null;
    var url = new URL(API + "/sources");
    url.searchParams.set("search", q);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("sort", "relevance_score:desc");
    var data = await getJSON(url.toString());
    if (Array.isArray(data.results) && data.results.length) return data.results[0];
    return null;
  }

  // ---- Charts (reuse simple SVG bars like profile.js) ----
  function niceTicks(maxValue, count){
    count = count || 4;
    if (maxValue <= 0) return [0, 1];
    var exp = Math.floor(Math.log10(maxValue));
    var base = Math.pow(10, exp);
    var niceMax = Math.ceil(maxValue / base) * base;
    var steps = [1,2,5,10];
    var step = base;
    for (var i=0;i<steps.length;i++){
      var s = steps[i]*base;
      if (niceMax / s <= count) { step = s; break; }
    }
    var ticks = [];
    for (var v=0; v<=niceMax+1e-9; v+=step){ ticks.push(Math.round(v)); }
    if (ticks[ticks.length-1] !== niceMax) ticks.push(niceMax);
    return ticks;
  }

  function renderBarChartSVG(opts){
    var title = opts.title || "", id = opts.id || ("c"+Math.random().toString(36).slice(2));
    var series = Array.isArray(opts.series) ? opts.series : [];
    var H=220,W=600,padL=56,padR=10,padT=14,padB=40,innerW=W-padL-padR,innerH=H-padT-padB;
    if (!series.length) return '<div class="chart-block"><h4>'+esc(title)+'</h4><p class="muted">No data.</p></div>';

    var n=series.length, maxVal = Math.max(1, ...series.map(s=>s.value||0));
    var ticks = niceTicks(maxVal,4), maxTick = ticks[ticks.length-1];
    var step = innerW / n, barW = Math.max(5, Math.min(24, step*0.6));
    var y0 = padT + innerH;
    function y(v){ return padT + innerH - (v/maxTick)*innerH; }

    var bars = series.map(function(s,i){
      var bx = padL + i*step + (step-barW)/2;
      var by = y(s.value||0);
      var h = Math.max(0, y0 - by);
      return '<rect x="'+bx.toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" ry="3"><title>'+esc(String(s.year))+': '+esc(String(s.value||0))+'</title></rect>';
    });

    var years = series.map(s=>s.year);
    var xLabels = [
      '<text x="'+padL+'" y="'+(H-10)+'" class="xlabel">'+esc(String(years[0]))+'</text>',
      '<text x="'+(padL + innerW/2)+'" y="'+(H-10)+'" class="xlabel" text-anchor="middle">'+esc(String(years[Math.floor(n/2)]))+'</text>',
      '<text x="'+(W-padR)+'" y="'+(H-10)+'" class="xlabel" text-anchor="end">'+esc(String(years[n-1]))+'</text>'
    ];
    var grid=[], yLabels=[];
    for (var t=0;t<ticks.length;t++){
      var val=ticks[t], gy=y(val);
      grid.push('<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+gy.toFixed(1)+'" y2="'+gy.toFixed(1)+'" class="grid"/>');
      yLabels.push('<text x="'+(padL-8)+'" y="'+(gy+4).toFixed(1)+'" class="ylabel" text-anchor="end">'+esc(val.toLocaleString())+'</text>');
    }

    return ''+
      '<div class="chart-block">' +
        '<h4>'+esc(title)+'</h4>' +
        '<svg class="chart-svg" viewBox="0 0 '+W+' '+H+'" width="100%" height="220" role="img" aria-labelledby="'+id+'-title">' +
          '<title id="'+id+'-title">'+esc(title)+'</title>' +
          '<g fill="none" stroke="currentColor" stroke-opacity=".08" stroke-width="1">'+grid.join("")+'</g>' +
          '<g class="axis" fill="currentColor" fill-opacity=".85" font-size="12">'+yLabels.join("")+'</g>' +
          '<g class="bars" fill="currentColor" fill-opacity=".78">'+bars.join("")+'</g>' +
          '<g class="axis" fill="currentColor" fill-opacity=".85" font-size="12">'+xLabels.join("")+'</g>' +
        '</svg>' +
      '</div>';
  }

  function buildYearSeries(entity){
    var rows = Array.isArray(entity.counts_by_year) ? entity.counts_by_year.slice() : [];
    if (!rows.length) return [];
    rows.sort((a,b)=>a.year-b.year);
    var map = {};
    rows.forEach(r => { map[r.year] = { year:r.year, works:Number(r.works_count||0), cites:Number(r.cited_by_count||0) }; });
    var minY = rows[0].year, maxY = rows[rows.length-1].year, out=[];
    for (var y=minY; y<=maxY; y++){
      out.push(map[y] || { year:y, works:0, cites:0 });
    }
    return out;
  }

  // ---- Rendering ----
  function idTailFrom(url){
    if (!url) return "";
    var s = String(url);
    var parts = s.split("/").filter(Boolean);
    return parts[parts.length-1] || "";
  }

  async function populatePublisher(src){
    var el = $("journalPublisher");
    if (!el) return;

    var pubString = get(src,"publisher",null);
    var hostId = get(src,"host_organization",null);
    var hostName = get(src,"host_organization_name",null);

    // If we have no id but a string, just show the string.
    if (!hostId && pubString){
      el.textContent = pubString;
      return;
    }

    var tail = idTailFrom(hostId);
    // If we have id + name, link to publisher page.
    if (tail && (pubString || hostName)){
      el.innerHTML = '<a href="publisher.html?id='+esc(tail)+'">'+esc(pubString || hostName)+'</a>';
      return;
    }

    // Try to fetch the publisher entity for a display name if missing.
    if (tail){
      try{
        var pub = await getJSON(API + "/publishers/" + encodeURIComponent(tail));
        var name = pub.display_name || pubString || hostName || "Publisher";
        el.innerHTML = '<a href="publisher.html?id='+esc(tail)+'">'+esc(name)+'</a>';
        return;
      }catch(_){}
    }

    // Last resort
    el.textContent = pubString || "Unknown publisher";
  }

  function renderHeader(src){
    if ($("journalName")) $("journalName").textContent = src.display_name || "Unknown journal";

    if ($("journalPublisher")) $("journalPublisher").textContent = "Loading publisher…";

    var type = get(src,"type","-");
    var issn_l = get(src,"issn_l",null);
    var issns = Array.isArray(get(src,"issn",[])) ? get(src,"issn",[]) : [];
    if ($("journalTypeIssn")){
      var parts = [];
      parts.push("<strong>Type:</strong> "+esc(type));
      if (issn_l) parts.push("<strong>ISSN-L:</strong> "+esc(issn_l));
      if (issns.length) parts.push("<strong>ISSN:</strong> "+esc(issns.join(", ")));
      $("journalTypeIssn").innerHTML = parts.join(" · ");
    }

    var homepage = get(src,"homepage_url",null);
    var oa = !!get(src,"is_oa",false);
    var doaj = !!get(src,"is_in_doaj",false);
    if ($("journalLinks")){
      var bits = [];
      bits.push('<a href="'+esc(get(src,"id","#"))+'" target="_blank" rel="noopener">OpenAlex</a>');
      if (homepage) bits.push('<a href="'+esc(homepage)+'" target="_blank" rel="noopener">Homepage</a>');
      $("journalLinks").innerHTML = bits.join(" · ");
    }

    if ($("totalWorks")) $("totalWorks").textContent = (get(src,"works_count",0)||0).toLocaleString();
    if ($("totalCitations")) $("totalCitations").textContent = (get(src,"cited_by_count",0)||0).toLocaleString();
    if ($("oaStatus")) $("oaStatus").textContent = oa ? "Yes" : "No";
    if ($("doajStatus")) $("doajStatus").textContent = doaj ? "Yes" : "No";

    // Topics (x_concepts if present on source; may be absent)
    var xconcepts = Array.isArray(src.x_concepts) ? src.x_concepts.slice() : [];
    xconcepts.sort((a,b)=>(b.score||0)-(a.score||0));
    if ($("tagsContainer")){
      $("tagsContainer").innerHTML = xconcepts.slice(0,12).map(function(c){
        var tid = c.id ? String(c.id).split("/").pop() : "";
        return '<a class="topic-card" href="topic.html?id='+esc(tid)+'"><span class="topic-name">'+esc(c.display_name||"Topic")+'</span></a>';
      }).join("") || '<p class="muted">No topics listed.</p>';
    }

    if ($("journalSummary")){
      var parts = [];
      parts.push((src.display_name||"This journal")+" has "+(get(src,"works_count",0)||0).toLocaleString()+" works");
      var cit = get(src,"cited_by_count",0)||0;
      if (cit) parts.push(" and "+cit.toLocaleString()+" total citations");
      parts.push(". Type: "+(type||"-")+".");
      if (oa) parts.push(" Open Access journal.");
      if (doaj) parts.push(" Indexed in DOAJ.");
      var pubName = get(src,"publisher",null) || get(src,"host_organization_name",null);
      if (pubName) parts.push(" Publisher: "+pubName+".");
      $("journalSummary").textContent = parts.join("");
    }

    // Metadata list
    if ($("journalMeta")){
      var items = [];
      items.push('<li><span>Open Access</span><strong>'+(oa?"Yes":"No")+'</strong></li>');
      items.push('<li><span>DOAJ</span><strong>'+(doaj?"Yes":"No")+'</strong></li>');
      items.push('<li><span>Type</span><strong>'+esc(type||"-")+'</strong></li>');
      if (issn_l) items.push('<li><span>ISSN-L</span><strong>'+esc(issn_l)+'</strong></li>');
      if (issns.length) items.push('<li><span>ISSN</span><strong>'+esc(issns.join(", "))+'</strong></li>');
      if (homepage) items.push('<li><span>Homepage</span><strong><a href="'+esc(homepage)+'" target="_blank" rel="noopener">Visit</a></strong></li>');
      items.push('<li><span>OpenAlex</span><strong><a href="'+esc(get(src,"id","#"))+'" target="_blank" rel="noopener">View</a></strong></li>');
      $("journalMeta").innerHTML = items.join("");
    }
  }

  function renderTrends(src){
    var wrap = $("trendCharts");
    if (!wrap) return;
    var s = buildYearSeries(src);
    if (!s.length){ wrap.innerHTML = '<p class="muted">No trend data available.</p>'; return; }
    var cites = s.map(r=>({year:r.year, value:r.cites}));
    var works = s.map(r=>({year:r.year, value:r.works}));
    wrap.innerHTML = renderBarChartSVG({ title:"Citations per year", series:cites, id:"cites"}) +
                     renderBarChartSVG({ title:"Works per year",     series:works, id:"works"});
  }

  // ---- Works list ----
  function clearWorks(){
    var list = $("publicationsList"); if (list) list.innerHTML = "";
    var pag = $("pubsPagination"); if (pag) pag.innerHTML = "";
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

      if (replace) { accumulated = results.slice(); clearWorks(); }
      else { accumulated = accumulated.concat(results); }

      var list = $("publicationsList");
      if (list && /Loading articles/i.test(list.textContent)) list.innerHTML = "";
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
      var list = $("publicationsList");
      if (list) list.innerHTML = '<div class="notice error"><strong>Error:</strong> '+esc(e.message||String(e))+'</div>';
      console.error(e);
    }
  }

  async function boot(){
    try{
      var raw = getParam("id");
      var nameParam = getParam("name");
      var tail = (raw||"").trim();
      try{ tail = decodeURIComponent(tail); }catch(_){}
      if (tail.indexOf("/")!==-1){ var seg=tail.split("/").filter(Boolean); tail=seg[seg.length-1]; }

      var src = null;

      if (!tail && nameParam){
        src = await findSourceByName(nameParam);
        if (!src){
          if ($("journalName")) $("journalName").textContent = "Journal not found.";
          if ($("publicationsList")) $("publicationsList").innerHTML = '<p class="muted">No journal matched "'+esc(nameParam)+'".</p>';
          return;
        }
        tail = idTailFrom(get(src,"id",""));
      }

      if (!tail){
        if ($("journalName")) $("journalName").textContent = nameParam ? "Journal not found." : "No journal specified.";
        if ($("publicationsList")) $("publicationsList").innerHTML = '<p class="muted">Please open this page with a journal id or name.</p>';
        return;
      }

      if (!src){
        src = await getJSON(API + "/sources/" + encodeURIComponent(tail));
      }

      if (!src){
        if ($("journalName")) $("journalName").textContent = "Journal not found.";
        return;
      }
      renderHeader(src);
      populatePublisher(src);
      renderTrends(src);

      // Works API (OpenAlex usually provides this on the entity)
      worksApiBaseUrl = get(src, "works_api_url", null);
      if (!worksApiBaseUrl){
        // Fallback: build from id tail
        worksApiBaseUrl = API + "/works?filter=host_venue.id:" + encodeURIComponent(tail);
      }

      var list = $("publicationsList");
      if (list) list.innerHTML = '<p class="muted">Loading articles…</p>';
      currentPage = 1; accumulated = []; totalWorksCount = 0;
      await fetchWorksPage(currentPage, true);

      var sortSel = $("pubSort");
      if (sortSel){
        sortSel.value = "date";
        sortSel.addEventListener("change", async function(){
          currentSort = this.value === "citations" ? "citations" : "date";
          currentPage = 1; accumulated = []; await fetchWorksPage(currentPage, true);
        });
      }

      try { await getJSON(API + "/works?per_page=1"); } catch(_){}
    }catch(e){
      console.error(e);
      var list = $("publicationsList");
      if (list) list.innerHTML = '<div class="notice error"><strong>Error:</strong> '+esc(e.message||String(e))+'</div>';
      var wrap = $("trendCharts");
      if (wrap) wrap.innerHTML = '<p class="muted">Could not load trends.</p>';
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
