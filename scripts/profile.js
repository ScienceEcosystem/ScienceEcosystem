(function () {
  if (!document.body || document.body.dataset.page !== "profile") return;

  var API = "https://api.openalex.org";
  var MAILTO = "scienceecosystem@icloud.com";
  var PAGE_SIZE = 50;

  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function escapeHtml(str){ str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; });
  }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; } catch(e){ return fb; } }
  function normalizeAuthorId(raw){ if(!raw) return ""; var s=raw; try{ s=decodeURIComponent(s);}catch(e){} s=s.trim();
    if(s.indexOf("/")!==-1){ var seg=s.split("/").filter(Boolean); s=seg[seg.length-1]; }
    var orcidLike=/^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/i.test(s); if(orcidLike && s.toUpperCase().indexOf("ORCID:")!==0) s="ORCID:"+s; return s; }
  function addMailto(u){ var url=new URL(u, API); if(!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO); return url.toString(); }
  function hardError(msg){ var box=$("publicationsList"); if(box) box.innerHTML='<div class="notice error"><strong>Error:</strong> '+escapeHtml(msg)+'</div>'; }

  async function getJSON(url){
    var withMt = addMailto(url);
    for (var attempt=1; attempt<=2; attempt++){
      try{
        var res = await fetch(withMt, { headers: { "Accept":"application/json" } });
        if (res.status===429){
          var ra=parseInt(res.headers.get("Retry-After")||"1",10);
          await new Promise(function(r){ setTimeout(r, Math.min(ra,5)*1000); });
          continue;
        }
        if (!res.ok) throw new Error(res.status+" "+res.statusText);
        return await res.json();
      }catch(e){
        if (attempt===2) throw e;
      }
    }
    throw new Error("Unreachable");
  }

  function provenanceChips(w){
    var doiRaw = w.doi || get(w,"ids.doi",null);
    var doi = doiRaw ? (String(doiRaw).indexOf("http")===0 ? doiRaw : ("https://doi.org/"+encodeURIComponent(String(doiRaw).replace(/^doi:/i,"")))) : null;
    var openAlexUrl = w.id || null;
    var oaUrl = get(w,"open_access.oa_url",null) || get(w,"primary_location.pdf_url",null) || get(w,"best_oa_location.url",null);
    var venueUrl = get(w,"primary_location.source.homepage_url",null) || get(w,"primary_location.landing_page_url",null);
    var parts=[];
    if(doi) parts.push('<a class="badge" href="'+doi+'" target="_blank" rel="noopener">DOI</a>');
    if(oaUrl) parts.push('<a class="badge badge-oa" href="'+oaUrl+'" target="_blank" rel="noopener">Open access</a>');
    if(venueUrl) parts.push('<a class="badge" href="'+venueUrl+'" target="_blank" rel="noopener">Source</a>');
    if(openAlexUrl) parts.push('<a class="badge" href="'+openAlexUrl+'" target="_blank" rel="noopener">OpenAlex</a>');
    return parts.join(" ");
  }

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

  function renderWorksChunk(works){
    var list = $("publicationsList"); if (!list) return;
    if (/Loading publications/i.test(list.textContent)) list.innerHTML = "";
    for (var i=0;i<works.length;i++){
      var w = works[i];
      var title = w.display_name || w.title || "Untitled work";
      var idTail = w.id ? w.id.split("/").pop() : "";
      var doiRaw = w.doi || get(w,"ids.doi","") || "";
      var pid = doiRaw ? ("doi:"+encodeURIComponent(String(doiRaw).replace(/^https?:\/\/(dx\.)?doi\.org\//i,""))) : idTail;
      var year = (w.publication_year!=null ? w.publication_year : "N/A");
      var venue = get(w,"host_venue.display_name",null) || get(w,"primary_location.source.display_name",null) || "Unknown venue";
      var cites = w.cited_by_count || 0;

      var authorships = Array.isArray(w.authorships) ? w.authorships : [];
      var authorsHtml = authorships.map(function(a){
        var aid = get(a,"author.id",null); aid = (aid ? aid.split("/").pop() : null);
        var name = escapeHtml(get(a,"author.display_name","Unknown"));
        return (aid ? '<a href="profile.html?id='+aid+'">'+name+'</a>' : name);
      }).join(", ") || "Unknown authors";

      list.insertAdjacentHTML("beforeend",
        '<article class="result-card">'+
          '<h3><a href="paper.html?id='+pid+'">'+escapeHtml(title)+'</a></h3>'+
          '<p class="meta"><span class="muted">'+year+'</span> · <strong>Published in:</strong> '+escapeHtml(venue)+' · <strong>Citations:</strong> '+cites+'</p>'+
          '<p><strong>Authors:</strong> '+authorsHtml+'</p>'+
          '<p class="chips">'+provenanceChips(w)+'</p>'+
        '</article>'
      );
    }
  }

  async function loadWorks(author){
    var worksApi = author && author.works_api_url;
    if (!worksApi){ if ($("publicationsList")) $("publicationsList").innerHTML = '<p class="muted">No publications endpoint provided.</p>'; return; }
    var url = new URL(worksApi, API);
    url.searchParams.set("page","1");
    url.searchParams.set("per_page", String(PAGE_SIZE));
    var data = await getJSON(url.toString());
    var results = Array.isArray(data.results) ? data.results : [];
    if ($("totalWorks")) $("totalWorks").textContent = ((author.works_count || get(data,"meta.count",0) || results.length)).toLocaleString();
    if ($("pubsPagination")) $("pubsPagination").innerHTML = "";
    renderWorksChunk(results);
  }

  async function boot(){
    try{
      var raw = getParam("id");
      var id = normalizeAuthorId(raw);
      var authorId = id || "A1969205033";
      var authorUrl = API + "/authors/" + encodeURIComponent(authorId);

      var author = await getJSON(authorUrl);
      renderAuthorHeader(author);
      await loadWorks(author);

      // quick ping to surface network issues in console
      try { await getJSON(API + "/works?per_page=1"); } catch(e){}
    }catch(e){
      hardError(e.message || String(e));
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
