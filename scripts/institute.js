// scripts/institute.js
(function () {
  if (!document.body || document.body.dataset.page !== "institution") return;

  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";
  var PAGE_SIZE = 50;

  // ---- Utils ----
  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function escapeHtml(str){ str = (str==null?"":String(str)); return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; }); }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; } catch(e){ return fb; } }
  function addMailto(u){ var url=new URL(u, API); if(!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO); return url.toString(); }

  async function getJSON(url){
    var withMt = addMailto(url);
    for (var attempt=1; attempt<=2; attempt++){
      try{
        var res = await fetch(withMt, { headers:{ "Accept":"application/json" }});
        if (res.status===429){
          var ra = parseInt(res.headers.get("Retry-After")||"1",10);
          await new Promise(function(r){ setTimeout(r, Math.min(ra,5)*1000); });
          continue;
        }
        if (!res.ok) throw new Error(res.status + " " + res.statusText);
        return await res.json();
      }catch(e){ if (attempt===2) throw e; }
    }
    throw new Error("Unreachable");
  }

  function normalizeInstitutionId(raw){
    if (!raw) return "";
    var s = raw; try{ s = decodeURIComponent(s); }catch(_){}
    s = s.trim();
    // If full OpenAlex URL
    if (/openalex\.org\/I/i.test(s)) return s.split("/").filter(Boolean).pop();
    // If plain OpenAlex ID like "I123456789"
    if (/^I\d+$/i.test(s)) return s;
    // If ROR link
    var r = s.match(/ror\.org\/([a-z0-9]+)$/i);
    if (r) return "ror:" + r[1];
    // If already ror:xyz
    if (/^ror:/i.test(s)) return s;
    return s; // let OpenAlex try to resolve typed IDs like GRID:... if ever needed
  }

  // ---- Charts (reuse approach from profile) ----
  function buildYearSeries(entity){
    var rows = Array.isArray(entity.counts_by_year) ? entity.counts_by_year.slice() : [];
    if (!rows.length) return [];
    rows.sort(function(a,b){ return a.year - b.year; });
    var minY = rows[0].year, maxY = rows[rows.length-1].year;
    var map = {};
    rows.forEach(function(r){
      map[r.year] = { year:r.year, works: Number(r.works_count || r.works || 0), cites: Number(r.cited_by_count || r.citations || 0) };
    });
    var out = [];
    for (var y=minY; y<=maxY; y++){ out.push(map[y] || { year:y, works:0, cites:0 }); }
    return out;
  }

  function renderBarChartSVG(opts){
    var title = opts.title || "";
    var series = Array.isArray(opts.series) ? opts.series : [];
    var id = opts.id || ("c" + Math.random().toString(36).slice(2));
    var H = 170, W = 560, padL = 36, padR = 8, padT = 10, padB = 26;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    if (!series.length) return '<div class="chart-block"><h4>'+escapeHtml(title)+'</h4><p class="muted">No data.</p></div>';

    var n=series.length, maxVal=1;
    for (var i=0;i<n;i++){ if (series[i].value > maxVal) maxVal = series[i].value; }
    var step = innerW / n, barW = Math.max(4, Math.min(22, step*0.6));
    function x(i){ return padL + i*step + (step-barW)/2; }
    function y(v){ return padT + innerH - (v/maxVal)*innerH; }
    var y0 = padT + innerH;

    var first = series[0].year, mid = series[Math.floor(n/2)].year, last = series[n-1].year;

    var bars = [];
    for (var i=0;i<n;i++){
      var s = series[i], bx = x(i), by = y(s.value), h = Math.max(0, y0-by);
      bars.push('<rect x="'+bx.toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" ry="3"><title>'+escapeHtml(String(s.year))+': '+escapeHtml(String(s.value))+'</title></rect>');
    }
    var grid = [0,0.5,1].map(function(t){ var gy = padT + innerH*(1-t); return '<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+gy.toFixed(1)+'" y2="'+gy.toFixed(1)+'" class="grid"/>'; });
    var labels = [
      '<text x="'+padL+'" y="'+(H-6)+'" class="xlabel">'+escapeHtml(String(first))+'</text>',
      '<text x="'+(padL+innerW/2)+'" y="'+(H-6)+'" class="xlabel" text-anchor="middle">'+escapeHtml(String(mid))+'</text>',
      '<text x="'+(W-padR)+'" y="'+(H-6)+'" class="xlabel" text-anchor="end">'+escapeHtml(String(last))+'</text>'
    ];

    return ''+
      '<div class="chart-block">' +
        '<h4>'+escapeHtml(title)+'</h4>' +
        '<svg class="chart-svg" role="img" aria-labelledby="'+id+'-title" viewBox="0 0 '+W+' '+H+'" width="100%" height="180">' +
          '<title id="'+id+'-title">'+escapeHtml(title)+'</title>' +
          '<g fill="none" stroke="currentColor" stroke-opacity=".08" stroke-width="1">'+grid.join("")+'</g>' +
          '<g class="bars" fill="currentColor" fill-opacity=".78">'+bars.join("")+'</g>' +
          '<g class="axis" fill="currentColor" fill-opacity=".66" font-size="11">'+labels.join("")+'</g>' +
        '</svg>' +
      '</div>';
  }

  function renderTrends(inst){
    var wrap = $("instTrends");
    if (!wrap) return;
    var series = buildYearSeries(inst);
    if (!series.length){ wrap.innerHTML = '<p class="muted">No trend data available.</p>'; return; }
    var cites = series.map(function(r){ return { year:r.year, value:r.cites }; });
    var works = series.map(function(r){ return { year:r.year, value:r.works }; });
    wrap.innerHTML =
  renderBarChartSVG({ title: "Citations per year", series: cites, id:"inst-cites", yLabel:"Citations" }) +
  renderBarChartSVG({ title: "Works per year", series: works, id:"inst-works", yLabel:"Works" });
  }

  // ---- Header ----
  function sectorLabel(type){
    var t = String(type||"").toLowerCase();
    if (t==="education") return "University / Education";
    if (t==="company") return "Private sector";
    if (t==="government") return "Government";
    if (t==="nonprofit") return "Non-profit";
    if (t==="healthcare") return "Healthcare";
    if (t==="facility") return "Research facility";
    return t ? (t.charAt(0).toUpperCase()+t.slice(1)) : "Institution";
  }

  function chips(inst){
    var out = [];
    var homepage = get(inst,"homepage_url",null);
    var ror = get(inst,"ids.ror",null);
    var wiki = get(inst,"ids.wikipedia",null);
    var openalex = inst.id;
    function badge(href, text, cls){ return href ? '<a class="badge '+(cls||"")+'" href="'+href+'" target="_blank" rel="noopener">'+escapeHtml(text)+'</a>' : ""; }
    if (homepage) out.push(badge(homepage, "Homepage"));
    if (ror) out.push(badge(ror, "ROR"));
    if (wiki) out.push(badge(wiki, "Wikipedia"));
    if (openalex) out.push(badge(openalex, "OpenAlex"));
    return out.join(" ");
  }

  function buildHeaderLeft(inst){
    var name = inst.display_name || "Institution";
    var type = sectorLabel(inst.type);
    var city = get(inst,"geo.city",null) || get(inst,"geo.city_name",null);
    var region = get(inst,"geo.region",null) || get(inst,"geo.state",null);
    var cc = get(inst,"country_code",null) || get(inst,"geo.country_code",null);
    var loc = [city, region, cc].filter(Boolean).join(", ");
    return ''+
      '<h1 class="paper-title">'+escapeHtml(name)+'</h1>'+
      '<p class="meta"><strong>Sector:</strong> '+escapeHtml(type)+(loc?(' · <strong>Location:</strong> '+escapeHtml(loc)):'')+'</p>'+
      '<p class="chips">'+chips(inst)+'</p>';
  }

  function buildHeaderStats(inst){
    var works = inst.works_count || 0;
    var cites = inst.cited_by_count || 0;
    var span = (function(){
      var arr = Array.isArray(inst.counts_by_year) ? inst.counts_by_year.slice().sort(function(a,b){return a.year-b.year;}) : [];
      if (!arr.length) return "—";
      var min = arr[0].year, max = arr[arr.length-1].year;
      return (max - min + 1) + " yrs active";
    })();

    function stat(label, value){ return '<div class="stat"><div class="stat-value">'+escapeHtml(String(value))+'</div><div class="stat-label">'+escapeHtml(label)+'</div></div>'; }
    return stat("Works", works.toLocaleString ? works.toLocaleString() : works)
         + stat("Citations", cites.toLocaleString ? cites.toLocaleString() : cites)
         + stat("Active span", span);
  }

  // ---- About box ----
  function renderAbout(inst){
    var lines = [];
    var ror = get(inst,"ids.ror",null);
    var grid = get(inst,"ids.grid",null);
    var mag = get(inst,"ids.mag",null);
    var wiki = get(inst,"ids.wikipedia",null);
    var wdid = get(inst,"ids.wikidata",null);
    if (inst.abbrev) lines.push('<p><strong>Acronym:</strong> '+escapeHtml(inst.abbrev)+'</p>');

    var addrBits = [];
    var city = get(inst,"geo.city",null) || get(inst,"geo.city_name",null);
    var region = get(inst,"geo.region",null) || get(inst,"geo.state",null);
    var country = get(inst,"geo.country",null) || get(inst,"country_code",null);
    if (city) addrBits.push(city);
    if (region) addrBits.push(region);
    if (country) addrBits.push(country);
    if (addrBits.length) lines.push('<p><strong>Address:</strong> '+escapeHtml(addrBits.join(", "))+'</p>');

    var ids = [];
    if (ror) ids.push('<a href="'+ror+'" target="_blank" rel="noopener">ROR</a>');
    if (grid) ids.push('<a href="'+grid+'" target="_blank" rel="noopener">GRID</a>');
    if (wdid) ids.push('<a href="'+wdid+'" target="_blank" rel="noopener">Wikidata</a>');
    if (wiki) ids.push('<a href="'+wiki+'" target="_blank" rel="noopener">Wikipedia</a>');
    if (ids.length) lines.push('<p><strong>Identifiers:</strong> '+ids.join(" · ")+'</p>');

    $("instAbout").innerHTML = lines.join("") || "—";
  }

  // ---- Works list (reusing components.js) ----
  var currentPage = 1, totalWorksCount = 0, accumulatedWorks = [], currentSort = "date", worksApiBaseUrl = null, abortCtrl = null;

  function sortParam(){ return currentSort==="citations" ? "cited_by_count:desc" : "publication_year:desc"; }

  async function fetchWorksPage(page, replace){
    if (!worksApiBaseUrl) return;
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    var u = new URL(worksApiBaseUrl);
    u.searchParams.set("page", String(page));
    u.searchParams.set("per_page", String(PAGE_SIZE));
    u.searchParams.set("sort", sortParam());

    var data = await getJSON(u.toString());
    var results = Array.isArray(data.results) ? data.results : [];
    totalWorksCount = get(data,"meta.count", totalWorksCount || results.length || 0);

    if (replace){ accumulatedWorks = results.slice(); $("instWorksList").innerHTML=""; }
    else { accumulatedWorks = accumulatedWorks.concat(results); }

    for (var i=0;i<results.length;i++){
      $("instWorksList").insertAdjacentHTML("beforeend", SE.components.renderPaperCard(results[i], { compact:true }));
    }
    SE.components.enhancePaperCards($("instWorksList"));

    var pag = $("instWorksPagination");
    if (!pag) return;
    var shown = accumulatedWorks.length;
    if (shown < totalWorksCount){
      pag.innerHTML = '<button id="instLoadMore" class="btn btn-secondary">Load more</button>';
      var btn = $("instLoadMore");
      if (btn){
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

  async function loadWorks(inst){
    var worksApi = inst && inst.works_api_url;
    if (!worksApi){ $("instWorksList").innerHTML = '<p class="muted">No publications endpoint provided.</p>'; return; }
    worksApiBaseUrl = worksApi;
    currentPage = 1; accumulatedWorks = [];
    $("instWorksList").innerHTML = '<p class="muted">Loading works…</p>';
    await fetchWorksPage(currentPage, true);
  }

  // ---- Boot ----
  async function boot(){
    try{
      var raw = getParam("id");
      var instId = normalizeInstitutionId(raw);
      if (!instId){ $("instHeaderMain").innerHTML = "<p class='muted'>No institution specified.</p>"; return; }

      var url = API + "/institutions/" + encodeURIComponent(instId);
      var inst = await getJSON(url);

      $("instHeaderMain").innerHTML = buildHeaderLeft(inst);
      $("instStats").innerHTML = buildHeaderStats(inst);
      renderAbout(inst);
      renderTrends(inst);
      await loadWorks(inst);

      var sortSel = $("instSort");
      if (sortSel){
        sortSel.value = "date";
        sortSel.addEventListener("change", async function(){
          currentSort = this.value==="citations" ? "citations" : "date";
          currentPage = 1; accumulatedWorks = [];
          await fetchWorksPage(currentPage, true);
        });
      }
    }catch(e){
      console.error(e);
      $("instHeaderMain").innerHTML = "<p class='muted'>Error loading institution.</p>";
      var tc = $("instTrends"); if (tc) tc.innerHTML = '<p class="muted">Could not load trends.</p>';
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
