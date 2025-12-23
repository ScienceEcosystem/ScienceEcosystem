// scripts/components.js
(function () {
  // Avoid redefining if included twice
  if (globalThis.SE?.components) return;

  var UNPAYWALL_EMAIL = "info@scienceecosystem.org"; // for Unpaywall compliance

  // ---------- helpers ----------
  function escapeHtml(str){
    str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, function(c){
      return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c];
    });
  }
  function get(obj, path, fb){
    try{ var p=path.split("."), cur=obj;
      for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; }
      return cur==null?fb:cur;
    } catch(e){ return fb; }
  }
  function idTailFrom(anyId){
    if (!anyId) return "";
    return String(anyId).replace(/^https?:\/\/openalex\.org\//i,"");
  }
  function doiFrom(work){ return work.doi || get(work,"ids.doi",null); }
  function doiUrl(doi){
    if (!doi) return null;
    var d = String(doi).replace(/^doi:/i,"");
    return (d.indexOf("http")===0) ? d : ("https://doi.org/" + d);
  }
  function journalFrom(work){
    return get(work,"host_venue.display_name",null)
        || get(work,"primary_location.source.display_name","Unknown venue");
  }
  // NEW: resolve source tail and build a journal link HTML for cards (keeps old text helpers untouched)
  function sourceTailFrom(work){
    var srcId = get(work,"host_venue.id",null) || get(work,"primary_location.source.id",null);
    return srcId ? idTailFrom(srcId) : "";
  }
  function journalLinkHTML(work){
    var name = journalFrom(work) || "Unknown venue";
    var tail = sourceTailFrom(work);
    return tail
      ? '<a href="journal.html?id='+encodeURIComponent(tail)+'">'+escapeHtml(name)+'</a>'
      : escapeHtml(name);
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
    var m = s.match(/[^.!?]*[.!?]/);
    return m ? m[0].trim() : s.trim();
  }
  function maybeHighlight(text, q){
    try{
      if (globalThis.SE?.search?.highlight) return globalThis.SE.search.highlight(text, q);
    } catch(_){}
    return escapeHtml(text || "");
  }

  // ---------- name utils (for citation formatting) ----------
  function splitName(full){
    if (!full) return { given:"", family:"" };
    var parts = String(full).trim().split(/\s+/);
    if (parts.length === 1) return { given:"", family:parts[0] };
    var family = parts.pop(); var given = parts.join(" ");
    return { given: given, family: family };
  }
  function initials(given){
    if (!given) return "";
    return given.split(/\s+/).filter(Boolean).map(function(p){ return p[0].toUpperCase() + "."; }).join(" ");
  }
  function titleSentenceCase(t){
    try{
      if (!t) return "";
      var s = String(t);
      var upperRatio = (s.match(/[A-Z]/g)||[]).length / Math.max(1, s.replace(/[^A-Za-z]/g,"").length);
      if (upperRatio < 0.2) return s;
      s = s.toLowerCase();
      return s.charAt(0).toUpperCase() + s.slice(1);
    }catch(_){ return t || ""; }
  }

  // ---------- Collect per-work citation data ----------
  function collectCiteData(work){
    var authors = (get(work,"authorships",[]) || [])
      .map(function(a){ return get(a,"author.display_name",""); })
      .filter(Boolean);

    var venue = journalFrom(work);
    var doi = doiFrom(work);
    var doi_href = doiUrl(doi);
    var landing = get(work,"primary_location.landing_page_url", null) || doi_href || (work.id || null);

    var first_page = get(work,"biblio.first_page", "") || "";
    var last_page  = get(work,"biblio.last_page", "") || "";
    var pages = (first_page && last_page) ? (first_page + "-" + last_page) : (first_page || last_page || "");

    return {
      title: work.display_name || work.title || "Untitled",
      year: (work.publication_year != null ? String(work.publication_year) : "n.d."),
      venue: venue || "",
      volume: get(work,"biblio.volume","") || "",
      issue: get(work,"biblio.issue","") || "",
      pages: pages,
      doi: doi ? String(doi).replace(/^doi:/i,"") : "",
      doi_url: doi_href || "",
      url: landing || "",
      authors: authors
    };
  }

  // ---------- Formatters ----------
  function fmtAuthorsAPA(list){
    if (!list || !list.length) return "";
    var arr = list.map(function(full){
      var p = splitName(full);
      var init = initials(p.given);
      return (p.family ? p.family : full) + (init ? ", " + init : "");
    });
    if (arr.length <= 20){
      if (arr.length === 1) return arr[0];
      if (arr.length === 2) return arr[0] + " & " + arr[1];
      return arr.slice(0, -1).join(", ") + ", & " + arr[arr.length - 1];
    }else{
      var first19 = arr.slice(0,19).join(", ");
      var last = arr[arr.length-1];
      return first19 + ", …, " + last;
    }
  }
  function fmtAuthorsMLA(list){
    if (!list || !list.length) return "";
    if (list.length === 1){
      var one = splitName(list[0]);
      return (one.family || list[0]) + ", " + (one.given || "");
    }
    if (list.length === 2){
      var a = splitName(list[0]), b = splitName(list[1]);
      return (a.family||list[0]) + ", " + (a.given||"") + ", and " + (b.given||"") + " " + (b.family||"");
    }
    var first = splitName(list[0]);
    return (first.family||list[0]) + ", " + (first.given||"") + ", et al.";
  }
  function fmtAuthorsChicago(list){
    if (!list || !list.length) return "";
    if (list.length === 1){
      var a = splitName(list[0]);
      return (a.family||list[0]) + ", " + (a.given||"");
    }
    if (list.length === 2){
      var b0 = splitName(list[0]), b1 = splitName(list[1]);
      return (b0.family||list[0]) + ", " + (b0.given||"") + ", and " + (b1.given||"") + " " + (b1.family||"");
    }
    var first = splitName(list[0]), second = splitName(list[1]);
    return (first.family||list[0]) + ", " + (first.given||"") + ", " + (second.given||"") + " " + (second.family||"") + ", et al.";
  }
  function fmtAuthorsHarvard(list){
    if (!list || !list.length) return "";
    var parts = list.map(function(full){
      var p = splitName(full);
      var init = initials(p.given).replace(/\s+/g,"");
      return (p.family||full) + (init ? ", " + init : "");
    });
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] + " and " + parts[1];
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }
  function fmtAuthorsVancouver(list){
    if (!list || !list.length) return "";
    var parts = list.slice(0,6).map(function(full){
      var p = splitName(full);
      var init = initials(p.given).replace(/\s+/g,"");
      return (p.family||full) + (init ? " " + init : "");
    });
    if (list.length > 6) parts.push("et al.");
    return parts.join(", ");
  }
  function joinVolIssue(vol, iss){
    var v = vol ? String(vol) : "";
    var i = iss ? String(iss) : "";
    if (v && i) return v + "(" + i + ")";
    return v || (i ? "(" + i + ")" : "");
  }
  function fmtAPA(d){
    var a = fmtAuthorsAPA(d.authors);
    var y = d.year || "n.d.";
    var t = titleSentenceCase(d.title || "");
    var vi = joinVolIssue(d.volume, d.issue);
    var pages = d.pages ? (", " + d.pages) : "";
    var tail = d.doi_url || d.url || "";
    return (a ? a + ". " : "") + "(" + y + "). " + t + ". " + (d.venue||"")
           + (vi ? ", " + vi : "") + pages + (tail ? ". " + tail : ".");
  }
  function fmtMLA(d){
    var a = fmtAuthorsMLA(d.authors);
    var pieces = [];
    if (a) pieces.push(a + ".");
    pieces.push('"' + (d.title||"") + '."');
    if (d.venue) pieces.push(d.venue + ",");
    if (d.volume) pieces.push("vol. " + d.volume + ",");
    if (d.issue) pieces.push("no. " + d.issue + ",");
    if (d.year) pieces.push(d.year + ",");
    if (d.pages) pieces.push("pp. " + d.pages + ",");
    var tail = d.doi_url || d.url || "";
    if (tail) pieces.push(tail);
    var out = pieces.join(" ").replace(/,\s*$/,"");
    if (!/[.!?]$/.test(out)) out += ".";
    return out;
  }
  function fmtChicago(d){
    var a = fmtAuthorsChicago(d.authors);
    var vi = d.volume ? d.volume : "";
    var issue = d.issue ? ", no. " + d.issue : "";
    var year = d.year ? " (" + d.year + ")" : "";
    var pages = d.pages ? ": " + d.pages : "";
    var tail = d.doi_url || d.url || "";
    var core = (a ? a + ". " : "") + '"' + (d.title||"") + '." ' + (d.venue||"");
    core += (vi ? " " + vi : "") + issue + year + pages + (tail ? ". " + tail : ".");
    return core;
  }
  function fmtHarvard(d){
    var a = fmtAuthorsHarvard(d.authors);
    var vi = joinVolIssue(d.volume, d.issue);
    var pages = d.pages ? ", pp. " + d.pages : "";
    var tail = d.doi_url || d.url || "";
    return (a ? a + " " : "") + "(" + (d.year || "n.d.") + ") '" + (d.title||"") + "', "
           + (d.venue||"") + (vi ? ", " + vi : "") + pages + (tail ? ". " + tail : ".");
  }
  function fmtVancouver(d){
    var a = fmtAuthorsVancouver(d.authors);
    var vi = joinVolIssue(d.volume, d.issue);
    var year = d.year || "";
    var pages = d.pages ? ":" + d.pages : "";
    var doiPart = d.doi ? " doi:" + d.doi : (d.doi_url ? " " + d.doi_url : (d.url ? " " + d.url : ""));
    var out = (a ? a + ". " : "") + (d.title||"") + ". " + (d.venue||"") + ". "
              + (year ? year + ";" : "") + (vi ? vi : "") + pages + "." + (doiPart ? doiPart : "");
    return out.replace(/\s+\./g,".");
  }
  function bibtexKey(d){
    var first = d.authors && d.authors.length ? splitName(d.authors[0]).family || d.authors[0] : "key";
    var year = d.year && /^\d{4}$/.test(d.year) ? d.year : "n.d.";
    var shortTitle = (d.title||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().split(/\s+/).slice(0,3).join("");
    return (first + year + shortTitle).replace(/\s+/g,"");
  }
  function fmtBibTeX(d){
    var key = bibtexKey(d);
    var pages = d.pages && d.pages.includes("-") ? d.pages : (d.pages || "");
    var lines = [
      "@article{" + key + ",",
      "  title={" + (d.title||"") + "},",
      d.authors && d.authors.length ? "  author={" + d.authors.map(function(full){ var p = splitName(full); return (p.family||full) + ", " + (p.given||""); }).join(" and ") + "}," : "",
      d.venue ? "  journal={" + d.venue + "}," : "",
      d.year ? "  year={" + d.year + "}," : "",
      d.volume ? "  volume={" + d.volume + "}," : "",
      d.issue ? "  number={" + d.issue + "}," : "",
      pages ? "  pages={" + pages + "}," : "",
      d.doi ? "  doi={" + d.doi + "}," : (d.doi_url ? "  url={" + d.doi_url + "}," : (d.url ? "  url={" + d.url + "}," : "")),
      "}"
    ].filter(Boolean);
    return lines.join("\n");
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
    var titleRaw = work.display_name || work.title || "Untitled";
    var authors = authorLinks(work.authorships, 10);
    var cited = get(work,"cited_by_count",0) || 0;

    var title = opts.highlightQuery ? maybeHighlight(titleRaw, opts.highlightQuery) : escapeHtml(titleRaw);

    var abs = abstractTextFrom(work);
    var shortRaw = firstSentence(abs);
    var short = opts.highlightQuery ? maybeHighlight(shortRaw, opts.highlightQuery) : escapeHtml(shortRaw);
    var full = escapeHtml(abs);
    var hasMore = !!abs && abs.length > shortRaw.length + 1;

    var chips = [];
    var doiHref = doiUrl(doi);
    if (doiHref) chips.push('<a class="badge" href="'+doiHref+'" target="_blank" rel="noopener">DOI</a>');
    if (work.id) chips.push('<a class="badge" href="'+work.id+'" target="_blank" rel="noopener">OpenAlex</a>');

    var oaPDF = get(work,"best_oa_location.url_for_pdf",null) || get(work,"primary_location.pdf_url",null) || get(work,"open_access.oa_url",null);
    if (oaPDF) chips.unshift('<a class="badge badge-oa" href="'+oaPDF+'" target="_blank" rel="noopener">PDF</a>');

    var citeData = collectCiteData(work);
    function attr(v){ return v ? escapeHtml(String(v)) : ""; }

    return ''+
    '<article class="result-card paper-card" ' +
      'data-paper-id="'+escapeHtml(idTail)+'" '+
      (doi?'data-doi="'+escapeHtml(String(doi).replace(/^doi:/i,""))+'"':'')+
      'data-cite-title="'+attr(citeData.title)+'" '+
      'data-cite-year="'+attr(citeData.year)+'" '+
      'data-cite-venue="'+attr(citeData.venue)+'" '+
      'data-cite-volume="'+attr(citeData.volume)+'" '+
      'data-cite-issue="'+attr(citeData.issue)+'" '+
      'data-cite-pages="'+attr(citeData.pages)+'" '+
      'data-cite-doi="'+attr(citeData.doi)+'" '+
      'data-cite-doiurl="'+attr(citeData.doi_url)+'" '+
      'data-cite-url="'+attr(citeData.url)+'" '+
      'data-cite-authors="'+attr((citeData.authors||[]).join(' | '))+'">'+
      '<h3 class="card-title"><a href="paper.html?id='+encodeURIComponent(idTail)+'">'+title+'</a></h3>'+
      '<p class="meta"><span class="muted">'+escapeHtml(String(year))+'</span> · <strong>Published in:</strong> '+journalLinkHTML(work)+
        ' · <span title="Times this work has been cited">Cited by '+escapeHtml(String(cited))+'</span></p>'+
      '<p class="authors"><strong>Authors:</strong> '+authors+'</p>'+
      '<p class="abstract">'+
        (short ? '<span class="abs-short">'+short+'</span>' : '<span class="muted">No summary available.</span>')+
        (hasMore ? ' <button class="link-btn" data-role="toggle-abs">Show more</button>' : '')+
        (hasMore ? '<span class="abs-full">'+full+'</span>' : '')+
      '</p>'+
      '<p class="chips" data-chips>'+chips.join(" ")+'</p>'+
      '<div class="card-actions">'+
        '<button class="btn btn-secondary btn-save" title="Add to Library" data-action="save-paper" aria-label="Add to Library">Add to Library</button>'+
        '<button class="btn btn-secondary btn-cite" title="Cite this paper" data-action="open-cite" aria-haspopup="dialog" aria-expanded="false">Cite</button>'+
      '</div>'+
      '<div class="cite-popover" role="dialog" aria-label="Cite this paper" hidden '+
        'style="position:absolute; z-index:9999; max-width:640px; width:min(92vw,640px); box-shadow:0 8px 24px rgba(0,0,0,.18); border:1px solid #e5e7eb; border-radius:12px; background:#fff; padding:12px;"></div>'+
    '</article>';
  }

  // ---------- Cite popover ----------
  function buildCitePopover(card){
    var getAttr = function(k){ return (card.getAttribute(k) || "").trim(); };
    var d = {
      title: getAttr("data-cite-title"),
      year:  getAttr("data-cite-year"),
      venue: getAttr("data-cite-venue"),
      volume: getAttr("data-cite-volume"),
      issue: getAttr("data-cite-issue"),
      pages: getAttr("data-cite-pages"),
      doi:   getAttr("data-cite-doi"),
      doi_url: getAttr("data-cite-doiurl"),
      url:   getAttr("data-cite-url"),
      authors: (getAttr("data-cite-authors") ? getAttr("data-cite-authors").split(" | ") : [])
    };

    var apa = fmtAPA(d);
    var mla = fmtMLA(d);
    var chi = fmtChicago(d);
    var har = fmtHarvard(d);
    var van = fmtVancouver(d);
    var bib = fmtBibTeX(d);

    var tpl = ''+
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">' +
        '<strong style="font-size:1rem;">Cite this</strong>' +
        '<div style="display:flex; gap:8px; align-items:center;">' +
          '<button class="btn btn-secondary" data-action="copy-all" title="Copy all formats">Copy All</button>' +
          '<button class="btn btn-secondary" data-action="close-cite" aria-label="Close">Close</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid; grid-template-columns: 1fr; gap:10px; max-height:55vh; overflow:auto;">' +
        citeRow("APA (7th)", apa) +
        citeRow("MLA (9th)", mla) +
        citeRow("Chicago (Notes & Bib)", chi) +
        citeRow("Harvard", har) +
        citeRow("Vancouver", van) +
        citeRowTextarea("BibTeX", bib) +
      '</div>';

    function citeRow(label, text){
      return '' +
        '<div class="cite-row" data-cite-text="'+escapeHtml(text)+'">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px;">' +
            '<span class="muted" style="font-weight:600;">'+escapeHtml(label)+'</span>' +
            '<button class="btn btn-secondary" data-role="copy-cite" aria-label="Copy '+escapeHtml(label)+'">Copy</button>' +
          '</div>' +
          '<div style="font-size:.95rem; line-height:1.4;">'+escapeHtml(text)+'</div>' +
        '</div>';
    }
    function citeRowTextarea(label, text){
      return '' +
        '<div class="cite-row-bibtex">' +
          '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px;">' +
            '<span class="muted" style="font-weight:600;">'+escapeHtml(label)+'</span>' +
            '<button class="btn btn-secondary" data-role="copy-bibtex" aria-label="Copy BibTeX">Copy</button>' +
          '</div>' +
          '<textarea readonly style="width:100%; min-height:140px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:.9rem; padding:8px; border:1px solid #e5e7eb; border-radius:8px;">'+escapeHtml(text)+'</textarea>' +
        '</div>';
    }

    return tpl;
  }

  function positionPopover(card, popover, button){
    var btnRect = button.getBoundingClientRect();
    var cardRect = card.getBoundingClientRect();
    var top = (btnRect.bottom - cardRect.top) + 8;
    var left = (btnRect.left - cardRect.left);
    var maxLeft = card.clientWidth - popover.clientWidth - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    if (left < 8) left = 8;
    if (top + popover.clientHeight > card.clientHeight) {
      top = card.clientHeight - popover.clientHeight - 12;
      if (top < 8) top = 8;
    }
    popover.style.left = left + "px";
    popover.style.top  = top + "px";
  }

  // ---------- Add-to-Library helpers ----------
  function markSavedButton(btn){
    if (!btn) return;
    btn.textContent = "Saved ✓";
    btn.classList.add("btn-success");
    btn.disabled = true;
  }

  // ---------- Enhance after insertion ----------
  async function enhancePaperCards(container){
    var root = container || document;

    // Try to build saved cache (non-fatal if not present)
    try { await globalThis.SE_LIB?.loadLibraryOnce?.(); } catch(e){ console.warn("SE_LIB preload:", e); }

    // 1) Add Unpaywall PDF chips asynchronously
    var cards = Array.prototype.slice.call(root.querySelectorAll(".paper-card[data-doi]"));
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

    // 2) If we have a cache, mark already-saved buttons
    try {
      if (globalThis.SE_LIB?.isSaved) {
        root.querySelectorAll('[data-action="save-paper"]').forEach(function(btn){
          var card = btn.closest(".paper-card, .header-card, .result-card, article");
          var id = card?.getAttribute("data-paper-id");
          if (id && globalThis.SE_LIB.isSaved(id)) markSavedButton(btn);
        });
      }
    } catch(e){ console.warn("Mark saved failed:", e); }

    // 3) Abstract expand/collapse
    root.addEventListener("click", function(e){
      var t = e.target.closest('[data-role="toggle-abs"]');
      if (!t) return;
      var abs = t.closest(".abstract");
      if (!abs) return;
      abs.classList.toggle("expanded");
      t.textContent = abs.classList.contains("expanded") ? "Show less" : "Show more";
    });

    // 4) Save button behavior
    root.addEventListener("click", function(e){
      var btn = e.target.closest('[data-action="save-paper"]');
      if (!btn) return;

      var card = btn.closest(".paper-card, .header-card, .result-card, article");
      var id = card?.getAttribute("data-paper-id");
      var title = card?.getAttribute("data-cite-title")
              || card?.querySelector(".paper-title")?.textContent?.trim()
              || card?.querySelector(".card-title")?.textContent?.trim()
              || "Untitled";

      if (!id){ alert("Cannot determine paper id."); return; }

      // Already saved? reflect and bail
      if (globalThis.SE_LIB?.isSaved?.(id)) { markSavedButton(btn); return; }

      if (typeof globalThis.savePaper === "function") {
        globalThis.savePaper({ id, title }, btn);
      } else {
        console.warn("savePaper() missing. Include scripts/library.js first.");
        alert("Please sign in to save papers.");
      }
    }, { passive: true });

    // 5) Cite popover open/close/copy
    function closeAllPopovers(){
      root.querySelectorAll(".paper-card .cite-popover").forEach(function(pop){
        pop.hidden = true;
        var card = pop.closest(".paper-card, .header-card, .result-card, article");
        var openBtn = card && card.querySelector('[data-action="open-cite"]');
        if (openBtn) openBtn.setAttribute("aria-expanded","false");
      });
    }

    root.addEventListener("click", function(e){
      var open = e.target.closest('[data-action="open-cite"]');
      if (open){
        var card = open.closest(".paper-card, .header-card, .result-card, article");
        if (!card) return;
        var pop = card.querySelector(".cite-popover");
        if (!pop) return;

        if (!pop.innerHTML) pop.innerHTML = buildCitePopover(card);
        if (!pop.hidden) {
          pop.hidden = true;
          open.setAttribute("aria-expanded","false");
          return;
        }
        closeAllPopovers();
        pop.hidden = false;
        open.setAttribute("aria-expanded","true");
        requestAnimationFrame(function(){ positionPopover(card, pop, open); });
        return;
      }

      var close = e.target.closest('[data-action="close-cite"]');
      if (close){
        var cardC = close.closest(".paper-card, .header-card, .result-card, article");
        var popC = cardC && cardC.querySelector(".cite-popover");
        if (popC){ popC.hidden = true; }
        var openBtn = cardC && cardC.querySelector('[data-action="open-cite"]');
        if (openBtn) openBtn.setAttribute("aria-expanded","false");
        return;
      }

      var copyBtn = e.target.closest('[data-role="copy-cite"]');
      if (copyBtn){
        var row = copyBtn.closest(".cite-row");
        if (!row) return;
        var text = row.getAttribute("data-cite-text") || "";
        if (navigator.clipboard?.writeText){
          navigator.clipboard.writeText(text).then(function(){
            copyBtn.textContent = "Copied ✓";
            setTimeout(function(){ copyBtn.textContent = "Copy"; }, 1200);
          }).catch(function(){});
        }
        return;
      }

      var copyBib = e.target.closest('[data-role="copy-bibtex"]');
      if (copyBib){
        var wrap = copyBib.closest(".cite-row-bibtex");
        if (!wrap) return;
        var ta = wrap.querySelector("textarea");
        if (!ta) return;
        ta.select();
        try { document.execCommand("copy"); } catch(_){}
        copyBib.textContent = "Copied ✓";
        setTimeout(function(){ copyBib.textContent = "Copy"; }, 1200);
        return;
      }

      var copyAll = e.target.closest('[data-action="copy-all"]');
      if (copyAll){
        var cardA = copyAll.closest(".paper-card, .header-card, .result-card, article");
        var popA = cardA && cardA.querySelector(".cite-popover");
        if (!popA) return;
        var parts = [];
        popA.querySelectorAll(".cite-row").forEach(function(r){
          var labelEl = r.querySelector(".muted");
          var label = labelEl ? labelEl.textContent : "";
          var text = r.getAttribute("data-cite-text") || "";
          if (label && text) parts.push(label + ":\n" + text);
        });
        var bibTA = popA.querySelector(".cite-row-bibtex textarea");
        if (bibTA){ parts.push("BibTeX:\n" + bibTA.value); }
        var bundle = parts.join("\n\n");
        if (navigator.clipboard?.writeText){
          navigator.clipboard.writeText(bundle).then(function(){
            copyAll.textContent = "Copied ✓";
            setTimeout(function(){ copyAll.textContent = "Copy All"; }, 1200);
          }).catch(function(){});
        }
      }
    });

    // 6) Close cite popovers on Escape / outside click
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape") closeAllPopovers();
    });
    document.addEventListener("click", function(e){
      var pop = e.target.closest(".cite-popover");
      var btn = e.target.closest('[data-action="open-cite"]');
      if (pop || btn) return;
      closeAllPopovers();
    }, true);
  }

  // ---------- nav dropdowns ----------
  function setupNavDropdowns(){
    var dropdowns = Array.from(document.querySelectorAll(".nav-dropdown"));
    if (!dropdowns.length) return;

    function close(dd){
      dd.classList.remove("open");
      var btn = dd.querySelector(".nav-dropdown-toggle");
      if (btn) btn.setAttribute("aria-expanded", "false");
    }

    dropdowns.forEach(function(dd){
      var btn = dd.querySelector(".nav-dropdown-toggle");
      if (!btn) return;
      btn.addEventListener("click", function(e){
        e.preventDefault();
        var isOpen = dd.classList.toggle("open");
        btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
      dd.addEventListener("keydown", function(e){
        if (e.key === "Escape"){
          close(dd);
          btn.focus();
        }
      });
    });

    document.addEventListener("click", function(e){
      dropdowns.forEach(function(dd){
        if (!dd.classList.contains("open")) return;
        if (dd.contains(e.target)) return;
        close(dd);
      });
    });
  }
  setupNavDropdowns();

  // ---------- export ----------
  (globalThis.SE ??= {}).components = {
    renderPaperCard: renderPaperCard,
    enhancePaperCards: enhancePaperCards
  };
})();
