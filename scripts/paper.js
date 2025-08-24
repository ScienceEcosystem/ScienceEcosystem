// scripts/paper.js
(function () {
  if (!document.body || document.body.dataset.page !== "paper") return;

  // ---------- Constants & helpers ----------
  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";

  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function escapeHtml(str){ str = (str==null?"":String(str)); return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; }); }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; } catch(e){ return fb; } }

  function addMailto(u){
    var url = new URL(u, API);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }

  async function getJSON(url){
    var withMt = addMailto(url);
    for (var attempt = 1; attempt <= 2; attempt++){
      try {
        var res = await fetch(withMt, { headers: { "Accept": "application/json" } });
        if (res.status === 429){
          var ra = parseInt(res.headers.get("Retry-After") || "1", 10);
          await new Promise(function(r){ setTimeout(r, Math.min(ra,5)*1000); });
          continue;
        }
        if (!res.ok) throw new Error(res.status + " " + res.statusText);
        return await res.json();
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    throw new Error("Unreachable");
  }

  function normalizePaperId(raw){
    if (!raw) return "";
    var s = raw;
    try { s = decodeURIComponent(s); } catch(e){}
    s = s.trim();
    if (s.indexOf("/") !== -1 && s.indexOf("openalex.org/") !== -1) {
      s = s.split("/").filter(Boolean).pop(); // W...
    }
    var doiMatch = s.match(/10\.\d{4,9}\/\S+/i);
    if (doiMatch) {
      var doi = doiMatch[0].replace(/[">)\]]+$/g, "");
      return "doi:" + doi;
    }
    if (/^doi:/i.test(s)) return s;
    if (/^10\.\d{4,9}\/\S+/i.test(s)) return "doi:" + s;
    return s;
  }

  // ---------- Data fetchers ----------
  async function fetchPaperData(paperId){
    var id = normalizePaperId(paperId);
    var url = API + "/works/" + encodeURIComponent(id);
    return await getJSON(url);
  }

  async function fetchCitedPapers(refs){
    if (!Array.isArray(refs) || !refs.length) return [];
    var ids = refs.slice(0, 20).map(function(id){
      var tail = id.split("/").pop();
      return "https://openalex.org/" + tail;
    }).join("|");
    var url = API + "/works?filter=ids.openalex:" + encodeURIComponent(ids) + "&per_page=20";
    var data = await getJSON(url);
    return Array.isArray(data.results) ? data.results : [];
  }

 async function fetchCitingPapers(paperOpenAlexIdOrUrl){
  // expects something like "https://openalex.org/W2741809807" or "W2741809807"
  var s = String(paperOpenAlexIdOrUrl || "");
  // strip URL prefix if present
  var idTail = s.replace(/^https?:\/\/openalex\.org\//i, "");
  var url = API + "/works?filter=cites:" + encodeURIComponent(idTail) + "&per_page=20";
  var data = await getJSON(url);
  return Array.isArray(data.results) ? data.results : [];
}


  // ---------- Formatting helpers ----------
  function authorLinks(authorships, limit){
    if (!Array.isArray(authorships) || !authorships.length) return "Unknown authors";
    var out = [];
    for (var i=0;i<authorships.length;i++){
      if (limit && i >= limit) break;
      var id = get(authorships[i],"author.id",null);
      var name = escapeHtml(get(authorships[i],"author.display_name","Unknown"));
      if (!id) { out.push(name); continue; }
      var aid = id.split("/").pop();
      out.push('<a href="profile.html?id='+aid+'">'+name+'</a>');
    }
    var more = (limit && authorships.length > limit) ? ' <span class="muted">+'+(authorships.length - limit)+' more</span>' : '';
    return out.join(", ") + more;
  }

  function uniqueAffiliations(authorships, limit){
    var set = [];
    if (Array.isArray(authorships)){
      for (var i=0;i<authorships.length;i++){
        var insts = Array.isArray(authorships[i].institutions)?authorships[i].institutions:[];
        for (var j=0;j<insts.length;j++){
          var nm = get(insts[j],"display_name",null);
          if (nm && set.indexOf(nm) === -1) set.push(nm);
        }
      }
    }
    var more = (limit && set.length > limit) ? ' <span class="muted">+'+(set.length - limit)+' more</span>' : '';
    return (limit ? set.slice(0,limit) : set).join(", ") + more || "—";
  }

  function formatAbstract(idx){
    if (!idx || typeof idx !== "object") return "<em>No abstract available.</em>";
    var words = [];
    Object.keys(idx).forEach(function(word){
      var positions = idx[word] || [];
      for (var i=0;i<positions.length;i++){ words[positions[i]] = word; }
    });
    return escapeHtml(words.join(" ") || "");
  }

  function badge(href, text, className){
    if (!href) return "";
    return '<a class="badge ' + (className||"") + '" href="'+href+'" target="_blank" rel="noopener">'+escapeHtml(text)+'</a>';
  }

  // ---------- Rendering ----------
  function buildHeader(p){
    var title = p.display_name || "Untitled";
    var year  = (p.publication_year != null ? p.publication_year : "n.d.");
    var venue = get(p, "host_venue.display_name", null) || get(p, "primary_location.source.display_name", null) || "Unknown venue";

    var doiRaw = p.doi || get(p,"ids.doi",null);
    var doiUrl = doiRaw ? (String(doiRaw).indexOf("http")===0 ? doiRaw : ("https://doi.org/" + doiRaw.replace(/^doi:/i,""))) : null;

    var oaPdf = get(p,"best_oa_location.url_for_pdf",null) || get(p,"primary_location.pdf_url",null);
    var oaLanding = get(p,"open_access.oa_url",null) || get(p,"best_oa_location.url",null) || get(p,"primary_location.landing_page_url",null);

    var chips = [
      badge(doiUrl, "DOI"),
      badge(oaPdf, "PDF", "badge-oa"),
      badge(oaLanding, "Open access", "badge-oa"),
      badge(p.id, "OpenAlex")
    ].filter(Boolean).join(" ");

    // NEW: Authors + Affiliations shown in header (trimmed but linked)
    var authorsLine = authorLinks(p.authorships, 8);
    var affLine = uniqueAffiliations(p.authorships, 6);

    return (
      '<h1 class="paper-title">'+escapeHtml(title)+'</h1>' +
      '<p class="meta"><span class="muted">'+escapeHtml(String(year))+'</span> · <strong>Published in:</strong> '+escapeHtml(venue)+'</p>' +
      '<p class="meta-row"><strong>Authors:</strong> <span class="wrap-text">'+authorsLine+'</span></p>' +
      '<p class="meta-row"><strong>Affiliations:</strong> <span class="wrap-text">'+escapeHtml(affLine)+'</span></p>' +
      '<p class="chips">'+chips+'</p>'
    );
  }

  function renderPaper(p){
    // Header
    $("paperHeader").innerHTML = buildHeader(p);

    // Abstract
    $("abstractBlock").innerHTML = (
      '<h2>Abstract</h2>' +
      '<p>' + formatAbstract(p.abstract_inverted_index) + '</p>'
    );

    // Research objects (datasets / software) from locations/sources when available
    var items = [];
    var locs = Array.isArray(p.locations) ? p.locations : [];
    for (var i=0;i<locs.length;i++){
      var type = get(locs[i], "source.type", "") || get(locs[i], "type", "");
      var url = get(locs[i], "landing_page_url", null) || get(locs[i], "pdf_url", null);
      var label = get(locs[i], "source.display_name", null) || type || "Link";
      if (type && (type.indexOf("dataset") !== -1 || type.indexOf("software") !== -1) && url){
        items.push('<li><a href="'+url+'" target="_blank" rel="noopener">'+escapeHtml(label)+'</a></li>');
      }
    }
    $("objectsBlock").innerHTML = (
      '<h2>Research Objects</h2>' +
      (items.length ? '<ul>'+items.join("")+'</ul>' : '<p class="muted">None listed.</p>')
    );

    // Access block (PDF, OA, DOI)
    var doiRaw = p.doi || get(p,"ids.doi",null);
    var doiUrl = doiRaw ? (String(doiRaw).indexOf("http")===0 ? doiRaw : ("https://doi.org/" + doiRaw.replace(/^doi:/i,""))) : null;
    var oaPdf = get(p,"best_oa_location.url_for_pdf",null) || get(p,"primary_location.pdf_url",null);
    var oaLanding = get(p,"open_access.oa_url",null) || get(p,"best_oa_location.url",null) || get(p,"primary_location.landing_page_url",null);
    var access = [
      oaPdf ? ('<p><strong>PDF:</strong> <a href="'+oaPdf+'" target="_blank" rel="noopener">Open PDF</a></p>') : "",
      oaLanding ? ('<p><strong>Open Access:</strong> <a href="'+oaLanding+'" target="_blank" rel="noopener">View</a></p>') : "",
      doiUrl ? ('<p><strong>DOI:</strong> <a href="'+doiUrl+'" target="_blank" rel="noopener">'+escapeHtml(doiUrl)+'</a></p>') : ""
    ].filter(Boolean).join("");
    $("accessBlock").innerHTML = access || "<p class='muted'>No direct access links.</p>";

    // Topics chips
    var concepts = Array.isArray(p.concepts) ? p.concepts.slice() : [];
    concepts.sort(function(x,y){ return (y.score||0)-(x.score||0); });
    $("topicsBlock").innerHTML = concepts.length
      ? concepts.slice(0,12).map(function(c){
          var tid = (c.id ? c.id.split("/").pop() : "");
          return '<a class="topic-card" href="topic.html?id='+tid+'"><span class="topic-name">'+escapeHtml(c.display_name||"Topic")+'</span></a>';
        }).join("")
      : "<p class='muted'>No topics listed.</p>";

    // Citation (APA-ish)
    $("citationBlock").innerHTML = buildCitationBlock(p);
  }

  function buildCitationBlock(p){
    var year = (p.publication_year != null ? p.publication_year : "n.d.");
    var authorships = Array.isArray(p.authorships) ? p.authorships : [];
    var authors = authorships.map(function(a){ return get(a,"author.display_name",""); }).filter(Boolean);
    var firstAuthorLast = authors.length ? (authors[0].split(" ").slice(-1)[0]) : "Author";
    var venue = get(p,"host_venue.display_name",null) || get(p,"primary_location.source.display_name","");

    var apaFull = (authors.join(", ")) + " ("+year+"). " + (p.display_name||"") + ". " + (venue||"") + (p.doi ? ". https://doi.org/" + p.doi.replace(/^doi:/i,"") : "");
    var inText = "(" + firstAuthorLast + ", " + year + ")";

    return '' +
      '<p><strong>APA:</strong> <span id="apaFull">'+escapeHtml(apaFull)+'</span> <button class="btn btn-secondary btn-xs" data-copy="#apaFull">Copy</button></p>' +
      '<p><strong>In-text:</strong> <span id="apaIn">'+escapeHtml(inText)+'</span> <button class="btn btn-secondary btn-xs" data-copy="#apaIn">Copy</button></p>';
  }

  function enableCopyButtons(){
    document.addEventListener("click", function(e){
      var btn = e.target.closest("button[data-copy]");
      if (!btn) return;
      var sel = btn.getAttribute("data-copy");
      var el = document.querySelector(sel);
      if (!el) return;
      var text = el.innerText || el.textContent || "";
      navigator.clipboard.writeText(text).catch(function(){});
      btn.textContent = "Copied!";
      setTimeout(function(){ btn.textContent = "Copy"; }, 1200);
    });
  }

  function shortCitation(p){
    var first = get(p,"authorships.0.author.display_name","Unknown");
    var last = first.split(" ").slice(-1)[0] || first || "Unknown";
    var yr = (p.publication_year != null ? p.publication_year : "n.d.");
    return last + " et al., " + yr;
  }

  function renderGraph(main, cited, citing){
    var block = $("graphBlock");
    block.innerHTML = '<h2>Connected Papers</h2><div id="paperGraph" class="panel" style="height:600px"></div>';

    if (!window.vis || !vis.Network){
      block.insertAdjacentHTML("beforeend", "<p class='muted'>Graph library not loaded.</p>");
      return;
    }

    var nodes = [{ id: main.id, label: shortCitation(main), title: main.display_name, group: "main", paperId: main.id }];
    for (var i=0;i<cited.length;i++)  nodes.push({ id: cited[i].id,  label: shortCitation(cited[i]),  title: cited[i].display_name,  group: "cited",  paperId: cited[i].id });
    for (var j=0;j<citing.length;j++) nodes.push({ id: citing[j].id, label: shortCitation(citing[j]), title: citing[j].display_name, group: "citing", paperId: citing[j].id });

    var edges = [];
    for (var k=0;k<cited.length;k++)  edges.push({ from: main.id, to: cited[k].id });
    for (var m=0;m<citing.length;m++) edges.push({ from: citing[m].id, to: main.id });

    var network = new vis.Network(
      document.getElementById("paperGraph"),
      { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) },
      {
        nodes: { shape: "dot", size: 15, font: { size: 14 } },
        edges: { arrows: "to" },
        physics: { stabilization: true },
        interaction: { hover: true }
      }
    );

    network.on("click", function (params) {
      if (!params.nodes || !params.nodes.length) return;
      var nodeId = params.nodes[0];
      var found = null;
      for (var i=0;i<nodes.length;i++){ if (nodes[i].id === nodeId){ found = nodes[i]; break; } }
      if (found && found.paperId){
        var shortId = String(found.paperId).replace(/^https?:\/\/openalex\.org\//i, "");
        window.location.href = "paper.html?id=" + encodeURIComponent(shortId);
      }
    });
  }

  // ---------- Boot ----------
 async function boot(){
  var rawId = getParam("id");
  if (!rawId) {
    $("paperHeader").innerHTML = "<p class='muted'>No paper specified.</p>";
    return;
  }

  try {
    var paper = await fetchPaperData(rawId);
    renderPaper(paper);

    // fetch extras, but never let failures kill the page
    var cited = [], citing = [];
    try { cited = await fetchCitedPapers(paper.referenced_works || []); }
    catch(e){ console.warn("cited fetch failed:", e); }

    try { citing = await fetchCitingPapers(paper.id); }  // <-- use OpenAlex id, not the raw URL param
    catch(e){ console.warn("citing fetch failed:", e); }

    // Graph (resilient even if one list is empty)
    renderGraph(paper, cited, citing);

    // Related block (full-width) using shared card
var relatedHtml = [];
var joinFew = (cited.slice(0,8).concat(citing.slice(0,8))).slice(0,16);
for (var i=0;i<joinFew.length;i++){
  var w = joinFew[i];
  relatedHtml.push(SE.components.renderPaperCard(w, { compact: true }));
}
$("relatedBlock").innerHTML = '<h2>Related papers</h2>' + (relatedHtml.length ? relatedHtml.join("") : "<p class='muted'>No related papers found.</p>");
// Enhance (Unpaywall + toggle + save)
SE.components.enhancePaperCards($("relatedBlock"));

    // enable copy buttons
    enableCopyButtons();
  } catch (e) {
    console.error(e);
    // Only show a soft message; keep whatever rendered
    $("paperHeader").innerHTML = "<p class='muted'>Error loading paper details.</p>";
    // Do NOT clear the main content here anymore
  }
}


  document.addEventListener("DOMContentLoaded", boot);
})();
