// scripts/components.js
(function () {
  // Expose under window.SE so all pages can reuse
  if (window.SE && window.SE.components) return;

  var API = "https://api.openalex.org";
  var OPENALEX_MAILTO = "scienceecosystem@icloud.com";
  var UNPAYWALL_EMAIL = "scienceecosystem@icloud.com"; // your email for Unpaywall compliance

  // ---------- helpers ----------
  function escapeHtml(str){ str = (str==null?"":String(str)); return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; }); }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; } catch(e){ return fb; } }
  function idTailFrom(anyId){
    if (!anyId) return "";
    var s = String(anyId);
    return s.replace(/^https?:\/\/openalex\.org\//i,"");
  }
  function doiFrom(work){
    return work.doi || get(work,"ids.doi",null);
  }
  function doiUrl(doi){
    if (!doi) return null;
    var d = String(doi).replace(/^doi:/i,"");
    return (d.indexOf("http")===0) ? d : ("https://doi.org/" + d);
  }
  function journalFrom(work){
    return get(work,"host_venue.display_name",null) || get(work,"primary_location.source.display_name","Unknown venue");
  }
  function abstractTextFrom(work){
    var idx = work.abstract_inverted_index;
    if (!idx || typeof idx !== "object") return "";
    var words = [];
    Object.keys(idx).forEach(function(word){
      var pos = idx[word] || [];
      for (var i=0;i<pos.length;i++){ words[pos[i]] = word; }
    });
    return (words.join(" ") || "");
  }
  function firstSentence(s){
    if (!s) return "";
    // basic first sentence split (handles ., !, ?)
    var m = s.match(/[^.!?]*[.!?]/);
    return m ? m[0].trim() : s.trim();
  }

  // ---------- Unpaywall (adds "downloadable" PDF info) ----------
  var oaCache = Object.create(null);
  async function fetchUnpaywall(doi){
    if (!doi) return null;
    var key = String(doi).toLowerCase().replace(/^doi:/,"");
    if (oaCache[key]) return oaCache[key];
    var url = "https://api.unpaywall.org/v2/" + encodeURIComponent(key) + "?email=" + encodeURIComponent(UNPAYWALL_EMAIL);
    try{
      var res = await fetch(url);
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      var data = await res.json();
      var best = data.best_oa_location || null;
      var pdfUrl = best && (best.url_for_pdf || best.url);
      var isOa = !!pdfUrl;
      var out = { isOa: isOa, pdfUrl: pdfUrl || null, license: best ? best.license : null, source: "unpaywall" };
      oaCache[key] = out;
      return out;
    }catch(e){
      oaCache[key] = { isOa:false, pdfUrl:null, source:"unpaywall" };
      return oaCache[key];
    }
  }

  // ---------- Authors ----------
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

  // ---------- Card HTML ----------
  function renderPaperCard(work, opts){
    opts = opts || {};
    var idTail = idTailFrom(work.id || "");
    var doi = doiFrom(work);
    var year = (work.publication_year != null ? work.publication_year : "n.d.");
    var venue = journalFrom(work);
    var title = work.display_name || work.title || "Untitled";
    var authors = authorLinks(work.authorships, 10);

    // abstract (first sentence + full)
    var abs = abstractTextFrom(work);
    var short = firstSentence(abs);
    var hasMore = !!abs && abs.length > short.length + 1;

    // chips we know synchronously (OpenAlex, DOI if present)
    var chips = [];
    var doiHref = doiUrl(doi);
    if (doiHref) chips.push('<a class="badge" href="'+doiHref+'" target="_blank" rel="noopener">DOI</a>');
    if (work.id) chips.push('<a class="badge" href="'+work.id+'" target="_blank" rel="noopener">OpenAlex</a>');

    // OA from OpenAlex fields (best_oa_location/open_access)
    var oaPDF = get(work,"best_oa_location.url_for_pdf",null) || get(work,"primary_location.pdf_url",null) || get(work,"open_access.oa_url",null);
    if (oaPDF) chips.unshift('<a class="badge badge-oa" href="'+oaPDF+'" target="_blank" rel="noopener">PDF</a>');

    return ''+
    '<article class="result-card paper-card" data-paper-id="'+escapeHtml(idTail)+'" '+(doi?'data-doi="'+escapeHtml(String(doi).replace(/^doi:/i,""))+'"':'')+'>'+
      '<button class="btn btn-secondary btn-save" title="Add to Library" data-action="save-paper" aria-label="Add to Library">Add to Library</button>'+
      '<h3 class="card-title"><a href="paper.html?id='+encodeURIComponent(idTail)+'">'+escapeHtml(title)+'</a></h3>'+
      '<p class="meta"><span class="muted">'+escapeHtml(String(year))+'</span> · <strong>Published in:</strong> '+escapeHtml(venue)+'</p>'+
      '<p class="authors"><strong>Authors:</strong> '+authors+'</p>'+
      '<p class="abstract">'+
        (short ? '<span class="abs-short">'+escapeHtml(short)+'</span>' : '<span class="muted">No summary available.</span>')+
        (hasMore ? ' <button class="link-btn" data-role="toggle-abs">Show more</button>' : '')+
        (hasMore ? '<span class="abs-full" hidden>'+escapeHtml(abs)+'</span>' : '')+
      '</p>'+
      '<p class="chips" data-chips>'+chips.join(" ")+'</p>'+
    '</article>';
  }

  // Enhance cards after insertion: Unpaywall + interactions
  async function enhancePaperCards(container){
    container = container || document;
    // 1) Unpaywall PDF indicator
    var cards = Array.prototype.slice.call(container.querySelectorAll(".paper-card[data-doi]"));
    for (var i=0;i<cards.length;i++){
      (async function(card){
        var doi = card.getAttribute("data-doi");
        try{
          var info = await fetchUnpaywall(doi);
          if (info && info.isOa && info.pdfUrl){
            var chips = card.querySelector("[data-chips]");
            if (chips && !chips.querySelector('[data-src="unpaywall"]')){
              var a = document.createElement("a");
              a.className = "badge badge-oa";
              a.href = info.pdfUrl;
              a.target = "_blank";
              a.rel = "noopener";
              a.setAttribute("data-src","unpaywall");
              a.textContent = "PDF (Unpaywall)";
              chips.prepend(a);
            }
          }
        }catch(e){}
      })(cards[i]);
    }

    // 2) Expand/collapse abstract
    container.addEventListener("click", function(e){
      var btn = e.target.closest('[data-role="toggle-abs"]');
      if (!btn) return;
      var card = btn.closest(".paper-card");
      if (!card) return;
      var full = card.querySelector(".abs-full");
      var short = card.querySelector(".abs-short");
      if (!full || !short) return;
      var hidden = full.hasAttribute("hidden");
      if (hidden){
        full.removeAttribute("hidden");
        short.style.display = "none";
        btn.textContent = "Show less";
      } else {
        full.setAttribute("hidden","hidden");
        short.style.display = "";
        btn.textContent = "Show more";
      }
    });

    // 3) Add to Library (localStorage stub)
    container.addEventListener("click", function(e){
      var btn = e.target.closest('[data-action="save-paper"]');
      if (!btn) return;
      var card = btn.closest(".paper-card");
      if (!card) return;
      var id = card.getAttribute("data-paper-id");
      try{
        var key = "se_library";
        var cur = [];
        try { cur = JSON.parse(localStorage.getItem(key) || "[]"); } catch(_){}
        if (cur.indexOf(id) === -1) cur.push(id);
        localStorage.setItem(key, JSON.stringify(cur));
        btn.textContent = "Saved ✓";
        setTimeout(function(){ btn.textContent = "Add to Library"; }, 1500);
      }catch(_){}
    });
  }

  // expose
  window.SE = window.SE || {};
  window.SE.components = {
    renderPaperCard: renderPaperCard,
    enhancePaperCards: enhancePaperCards
  };
})();
