// scripts/profile.js
(function () {
  if (!document.body || document.body.dataset.page !== "profile") return;

  var API = "https://api.openalex.org";
  var MAILTO = "info@scienceecosystem.org";
  var PAGE_SIZE = 50;
  var FOLLOW_KEY = "se_followed_authors";

  // ── ORCID profile data loaded from our server ──────────────────────────────
  var _seUser = null; // the SE user record (null if viewing unregistered researcher)

  // ── External platform definitions ────────────────────────────────────────────
  var PLATFORMS = [
    { key: "website_url",           label: "Website" },
    { key: "google_scholar_url",    label: "Google Scholar" },
    { key: "researchgate_url",      label: "ResearchGate" },
    { key: "semantic_scholar_url",  label: "Semantic Scholar" },
    { key: "github_url",            label: "GitHub" },
    { key: "linkedin_url",          label: "LinkedIn" },
    { key: "twitter_url",           label: "Twitter / X" },
    { key: "wos_url",               label: "Web of Science" },
  ];

  // ── Render external profile badges ───────────────────────────────────────────
  function renderExternalLinks(user) {
    var box = $("externalLinks");
    if (!box || !user) return;
    var html = PLATFORMS.map(function(p) {
      var url = user[p.key];
      // Guard: skip missing, null, or accidentally-saved "undefined"/"null" strings
      if (!url || url === "undefined" || url === "null") return "";
      return '<a href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer" '
        + 'style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;'
        + 'background:#f1f5f9;border:1px solid #e2e8f0;font-size:.75rem;text-decoration:none;color:#374151;" '
        + 'title="'+escapeHtml(p.label)+'">'
        + escapeHtml(p.label)+'</a>';
    }).join("");

    // ORCID badge always shown
    var orcidEl = $("profileOrcid");
    var orcidUrl = orcidEl && orcidEl.href && orcidEl.href !== "#" ? orcidEl.href : null;
    if (orcidUrl) {
      html = '<a href="'+escapeHtml(orcidUrl)+'" target="_blank" rel="noopener" '
        + 'style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;'
        + 'background:#a6ce39;color:#fff;font-size:.75rem;text-decoration:none;font-weight:600;" '
        + 'title="ORCID">ORCID</a> ' + html;
    }
    box.innerHTML = html || "";
  }

  // ── Render keywords as topic-page links where possible ───────────────────────
  function kwChip(label, conceptTail) {
    if (conceptTail) {
      return '<a class="topic-card" href="topic.html?id='+encodeURIComponent(conceptTail)+'">'
        + '<span class="topic-name">'+escapeHtml(label)+'</span></a>';
    }
    return '<span class="topic-card"><span class="topic-name">'+escapeHtml(label)+'</span></span>';
  }

  async function renderKeywordsWithLinks(keywords, container) {
    // First pass: render immediately using the concept map we already have
    container.innerHTML = keywords.map(function(kw) {
      var tail = _conceptNameMap[kw.toLowerCase()] || null;
      return kwChip(kw, tail);
    }).join("");

    // Second pass: for any keyword not yet matched, try the OpenAlex concepts API
    var unmatched = keywords.filter(function(kw){ return !_conceptNameMap[kw.toLowerCase()]; });
    if (!unmatched.length) return;

    await Promise.all(unmatched.map(async function(kw) {
      try {
        var res = await fetch(API + "/concepts?search=" + encodeURIComponent(kw) + "&per_page=1");
        if (!res.ok) return;
        var data = await res.json();
        var match = Array.isArray(data.results) && data.results[0];
        if (!match) return;
        // Only accept if display name matches closely (avoid false positives)
        if (match.display_name.toLowerCase() !== kw.toLowerCase()) return;
        var tail = String(match.id).replace(/^https?:\/\/openalex\.org\//i, "");
        _conceptNameMap[kw.toLowerCase()] = tail;
      } catch(_) {}
    }));

    // Re-render with any newly resolved IDs
    container.innerHTML = keywords.map(function(kw) {
      var tail = _conceptNameMap[kw.toLowerCase()] || null;
      return kwChip(kw, tail);
    }).join("");
  }

  // ── Render Open Science Portfolio ─────────────────────────────────────────────
  function renderOpenSciencePortfolio(works) {
    if (!works || !works.length) return;
    var panel = $("openSciencePanel");
    var box = $("openSciencePortfolio");
    if (!panel || !box) return;

    var total = works.length;
    var oaCount = 0, topCited = 0, withDoi = 0;
    var yearMin = 9999, yearMax = 0;

    for (var i = 0; i < works.length; i++) {
      var w = works[i];
      if (w.open_access && w.open_access.is_oa) oaCount++;
      if (w.doi) withDoi++;
      var pct = w.cited_by_percentile_year && w.cited_by_percentile_year.max;
      if (pct >= 75) topCited++;
      var yr = w.publication_year;
      if (yr && yr < yearMin) yearMin = yr;
      if (yr && yr > yearMax) yearMax = yr;
    }

    var oaPct  = total ? Math.round(oaCount / total * 100) : 0;
    var topPct = total ? Math.round(topCited / total * 100) : 0;
    var span   = (yearMax && yearMin && yearMax >= yearMin) ? (yearMax - yearMin + 1) : null;

    function bar(pct, color) {
      return '<div style="background:#e5e7eb;border-radius:4px;height:8px;margin:.25rem 0 .5rem;">'
        + '<div style="background:'+color+';width:'+pct+'%;height:100%;border-radius:4px;"></div></div>';
    }
    function row(label, value, pct, color, note) {
      return '<div style="margin-bottom:.75rem;">'
        + '<div style="display:flex;justify-content:space-between;font-size:.82rem;">'
          + '<span style="color:#374151;font-weight:600;">'+escapeHtml(label)+'</span>'
          + '<span style="color:'+color+';font-weight:700;">'+escapeHtml(String(value))+'</span>'
        + '</div>'
        + (pct !== null ? bar(pct, color) : "")
        + (note ? '<p style="font-size:.72rem;color:#64748b;margin:0;">'+escapeHtml(note)+'</p>' : "")
      + '</div>';
    }

    box.innerHTML =
      row("Open access", oaPct + "%", oaPct, oaPct >= 60 ? "#15803d" : oaPct >= 30 ? "#b45309" : "#dc2626",
          oaCount + " of " + total + " papers freely available")
      + row("Top 25% cited papers", topPct + "%", topPct, topPct >= 40 ? "#15803d" : "#0284c7",
            topCited + " papers in top quartile for their year (OpenAlex)")
      + '<div style="font-size:.82rem;color:#374151;display:flex;gap:1rem;flex-wrap:wrap;margin-top:.25rem;">'
        + (span ? '<span> '+span+' year career span ('+yearMin+'–'+yearMax+')</span>' : "")
        + '<span> '+withDoi+' papers with DOI</span>'
      + '</div>';

    panel.style.display = "";

    // Also update the OA % stat box
    var oaEl = $("oaPercent");
    if (oaEl) oaEl.textContent = oaPct + "%";
  }

  // ── CV Export (browser print) ─────────────────────────────────────────────────
  function setupCvExport(authorName) {
    var btn = $("exportCvBtn");
    if (!btn) return;
    btn.style.display = "inline-flex";
    btn.onclick = function(e) {
      e.preventDefault();
      var prev = document.title;
      document.title = "CV — " + (authorName || "Researcher") + " — ScienceEcosystem";
      window.print();
      document.title = prev;
    };
  }

  // ── BibTeX Export ─────────────────────────────────────────────────────────────
  function setupBibtexExport(authorName) {
    var btn = $("bibtexBtn");
    if (!btn) return;
    btn.style.display = "inline-flex";
    btn.onclick = function() {
      var works = accumulatedWorks;
      if (!works || !works.length) { alert("No publications loaded yet."); return; }

      var entries = works.map(function(w) {
        // Cite key: first author last name + year + first title word
        var firstAuthor = (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "Unknown";
        var lastName = firstAuthor.split(" ").pop().replace(/[^a-zA-Z]/g,"") || "Author";
        var year = w.publication_year || "n.d.";
        var titleWord = (w.title || w.display_name || "").split(/\s+/)[0].replace(/[^a-zA-Z]/g,"") || "work";
        var key = lastName.toLowerCase() + year + titleWord.toLowerCase();

        // Authors: "Family, Given and Family, Given …"
        var authors = (w.authorships || []).map(function(a) {
          return (a.author && a.author.display_name) ? a.author.display_name : "";
        }).filter(Boolean).join(" and ");

        // Type mapping
        var type = w.type || "article";
        var bibType = type === "dataset" ? "misc" : type === "book" ? "book" : type === "book-chapter" ? "incollection" : "article";

        var doi = (w.doi || "").replace(/^https?:\/\/doi\.org\//i,"").replace(/^doi:/i,"");
        var journal = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "";
        var vol = get(w,"biblio.volume","");
        var num = get(w,"biblio.issue","");
        var pages = [get(w,"biblio.first_page",""), get(w,"biblio.last_page","")].filter(Boolean).join("--");
        var url = doi ? "https://doi.org/" + doi : (w.id || "");

        var fields = [
          "  title     = {" + (w.title || w.display_name || "Untitled") + "}",
          "  author    = {" + (authors || "Unknown") + "}",
          "  year      = {" + year + "}",
          journal ? "  journal   = {" + journal + "}" : null,
          vol     ? "  volume    = {" + vol + "}" : null,
          num     ? "  number    = {" + num + "}" : null,
          pages   ? "  pages     = {" + pages + "}" : null,
          doi     ? "  doi       = {" + doi + "}" : null,
          url     ? "  url       = {" + url + "}" : null,
        ].filter(Boolean).join(",\n");

        return "@" + bibType + "{" + key + ",\n" + fields + "\n}";
      });

      var bib = "% BibTeX export from ScienceEcosystem\n% " + (authorName || "Researcher") + " — " + new Date().toISOString().slice(0,10) + "\n\n" + entries.join("\n\n");

      // Download
      var blob = new Blob([bib], { type:"text/plain" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (authorName || "publications").replace(/\s+/g,"_") + ".bib";
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }

  // ── initProfilePage: entry point ─────────────────────────────────────────────
  async function initProfilePage() {
    var orcidParam = getParam("orcid");
    var idParam    = getParam("id");

    // Load current user (for follow state + owner detection)
    var currentUser = await fetch("/api/me", { credentials: "include" })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });

    if (orcidParam) {
      // Load profile by ORCID — look up our DB first, then OpenAlex
      await loadProfileByOrcid(orcidParam, currentUser);
    } else if (!idParam && currentUser) {
      // No params + logged in → show own profile
      var ownOrcid = currentUser.orcid;
      if (currentUser.openalex_author_id) {
        await loadProfileByOrcid(ownOrcid, currentUser);
      } else {
        showPersonalDashboard(currentUser);
      }
    } else if (idParam) {
      // Check if this OpenAlex ID belongs to a known SE user → redirect to canonical ORCID profile
      try {
        var resolved = await fetch("/api/profile/openalex/" + encodeURIComponent(idParam))
          .then(function(r) { return r.ok ? r.json() : null; })
          .catch(function() { return null; });
        if (resolved && resolved.orcid) {
          window.location.replace("profile.html?orcid=" + encodeURIComponent(resolved.orcid));
          return;
        }
      } catch(_) {}
      showPublicProfile(idParam);
    }
  }

  async function loadProfileByOrcid(orcid, currentUser) {
    try {
      var seProfile = await fetch("/api/profile/orcid/" + encodeURIComponent(orcid))
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; });

      _seUser = seProfile;

      var primaryId = seProfile && seProfile.openalex_author_id
        ? seProfile.openalex_author_id.trim()
        : null;

      // Fetch all claimed additional IDs (only available to owner)
      var allIds = primaryId ? [primaryId] : [];
      var isOwner = !!(currentUser && currentUser.orcid === orcid);
      if (isOwner && primaryId) {
        try {
          var claims = await fetch("/api/claims", { credentials: "include" }).then(function(r){ return r.ok ? r.json() : {}; });
          var extras = (claims.claims || [])
            .map(function(c){ return c.author_id.trim(); })
            .filter(function(id){ return id && id !== primaryId; });
          allIds = allIds.concat(extras);
        } catch(_) {}
      }

      var opts = { enhanced: isOwner, user: currentUser, seUser: seProfile, allAuthorIds: allIds };

      if (primaryId) {
        showPublicProfile(primaryId, opts);
      } else {
        showSEOnlyProfile(seProfile || {}, isOwner);
      }
    } catch (e) {
      hardError("Could not load profile.");
    }
  }

  function showPersonalDashboard(user) {
    if ($("profileName")) $("profileName").textContent = user?.name || "Your Profile";
    if ($("profileAffiliation")) $("profileAffiliation").textContent = user?.affiliation || "Signed in with ORCID";
    if ($("otherNames")) $("otherNames").textContent = "";

    if ($("profileOrcid") && user?.orcid) {
      $("profileOrcid").href = "https://orcid.org/" + user.orcid;
      $("profileOrcid").textContent = "ORCID: " + user.orcid;
      $("profileOrcid").style.display = "inline-block";
    }

    if ($("followAuthorBtn")) $("followAuthorBtn").style.display = "none";
    var editBtn = $("editProfileBtn");
    if (editBtn) { editBtn.style.display = "inline-flex"; editBtn.onclick = function(){ location.href = "settings-profile.html"; }; }
    if ($("followStatus")) $("followStatus").textContent = "";

    renderExternalLinks(user);
    if (user && user.bio) {
      var bioSec = $("profileBio");
      var bioTxt = $("profileBioText");
      if (bioSec && bioTxt) { bioTxt.textContent = user.bio; bioSec.style.display = ""; }
    }

    var main = $("profileMain");
    var sidebar = $("profileSidebar");
    if (main) {
      main.innerHTML =
        '<div class="panel">'
          + '<h2>Your Public Profile</h2>'
          + '<p class="muted">Claim your OpenAlex author ID to show your publications and metrics here.</p>'
          + '<div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap;">'
            + '<a class="btn btn-primary" href="settings-profile.html">Set up profile</a>'
            + '<a class="btn btn-secondary" href="library.html">My library</a>'
          + '</div>'
          + '<div id="claimPrompt" style="margin-top:1rem;"></div>'
        + '</div>';
    }
    if (sidebar) {
      sidebar.innerHTML =
        '<section class="panel"><h3>Library</h3>'
          + '<div id="libraryQuickStats" class="muted">Loading…</div>'
          + '<div style="margin-top:.75rem;"><a class="btn btn-secondary" href="library.html">Open library</a></div>'
        + '</section>';
      fetch("/api/library", { credentials: "include" })
        .then(function(r) { return r.ok ? r.json() : []; })
        .then(function(items) {
          var el = $("libraryQuickStats");
          if (el) el.textContent = (Array.isArray(items) ? items.length : 0) + " papers saved.";
        }).catch(function(){});
    }

    // Claim prompt
    var claim = document.getElementById("claimPrompt");
    if (claim) {
      var needsClaim = !user?.name || (!user?.affiliation && !(user?.affiliations && user.affiliations.length));
      claim.innerHTML = needsClaim
        ? `Claim your ORCID profile to complete your public info. <a href="settings-profile.html">Add details</a>.`
        : "";
    }

    // Library stats
    fetch("/api/library", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(items => {
        const count = Array.isArray(items) ? items.length : 0;
        const stats = document.getElementById("personalStats");
        if (stats) {
          stats.innerHTML = `
            <div class="stat">
              <div class="stat-label">Saved papers</div>
              <div class="stat-value">${count}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Last saved</div>
              <div class="stat-value">${count ? "Recently" : "-"}</div>
            </div>
          `;
        }
        const lib = document.getElementById("libraryQuickStats");
        if (lib) {
          lib.textContent = count ? `${count} papers saved` : "No papers saved yet.";
        }
      })
      .catch(() => {
        const lib = document.getElementById("libraryQuickStats");
        if (lib) lib.textContent = "Library unavailable.";
      });
  }

  function showEnhancedProfile(authorId, user) {
    showPublicProfile(authorId, { enhanced: true, user });
  }

  function showPublicProfile(authorId, opts) {
    boot(authorId, opts || {});
  }

  // Registered user with no claimed OpenAlex ID yet
  function showSEOnlyProfile(seUser, isOwner) {
    if ($("profileName")) $("profileName").textContent = seUser.name || "Researcher";
    var _affs = (seUser.affiliations && seUser.affiliations.length) ? seUser.affiliations : (seUser.affiliation ? [seUser.affiliation] : []);
    if ($("profileAffiliation")) $("profileAffiliation").textContent = _affs.join(' · ');
    // Show uploaded avatar if available
    var photoEl = $("profilePhoto");
    if (photoEl && seUser.orcid && seUser.avatar_url) {
      var orcidClean = String(seUser.orcid).replace(/^https?:\/\/orcid\.org\//i, "");
      photoEl.src = "/api/avatar/" + encodeURIComponent(orcidClean);
      photoEl.onerror = function() { photoEl.style.display = "none"; };
      photoEl.style.display = "";
    }
    if ($("otherNames")) $("otherNames").textContent = "";
    if ($("followAuthorBtn")) $("followAuthorBtn").style.display = "none";
    if (isOwner) {
      var eb = $("editProfileBtn");
      if (eb) { eb.style.display = "inline-flex"; eb.onclick = function(){ location.href = "settings-profile.html"; }; }
    }
    renderExternalLinks(seUser);
    if (seUser.bio) {
      var s = $("profileBio"), t = $("profileBioText");
      if (s && t) { t.textContent = seUser.bio; s.style.display = ""; }
    }
    var box = $("publicationsList");
    if (box) box.innerHTML = isOwner
      ? '<div class="notice"><p>Add your OpenAlex author ID in <a href="settings-profile.html">profile settings</a> to display your publications automatically.</p></div>'
      : '<p class="muted">No publications linked yet.</p>';
    var trend = $("trendCharts");
    if (trend) trend.innerHTML = '<p class="muted">—</p>';
    var co = $("coauthorsList");
    if (co) co.innerHTML = '<li class="muted">—</li>';
    var tl = $("careerTimeline");
    if (tl) tl.innerHTML = '<li class="muted">—</li>';
  }

  // ---- State (publications) ----
  var currentPage = 1;
  var totalWorksCount = 0;
  var accumulatedWorks = [];
  var currentSort = "date"; // "date" | "citations"
  var currentOrder = "desc"; // "asc" | "desc"
  var worksApiBaseUrl = null;
  var abortCtrl = null;
  var isAuthed = false;
  var serverFollows = [];

  // ---- Sidebar derived state ----
  var authorTail  = null;                // "A12345" — primary ID
  var authorTails = Object.create(null); // set of all claimed author tails
  var _conceptNameMap = Object.create(null); // lowercase concept name → OpenAlex concept tail (C12345)
  var coauthors = Object.create(null);   // idTail -> { name, tail, count }
  var affYears  = Object.create(null);   // instTail -> { name, tail, min, max }

  // ---- Small utils ----
  function $(id){ return document.getElementById(id); }
  function getParam(name){ return new URLSearchParams(location.search).get(name); }
  function escapeHtml(str){ str = (str==null?"":String(str));
    return str.replace(/[&<>'"]/g, function(c){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]; });
  }
  function get(obj, path, fb){ try{ var p=path.split("."), cur=obj; for(var i=0;i<p.length;i++){ if(cur==null) return fb; cur=cur[p[i]]; } return cur==null?fb:cur; } catch(e){ return fb; } }
  function normalizeAuthorId(raw){
    if(!raw) return "";
    var s=raw; try{ s=decodeURIComponent(s);}catch(e){}
    s=s.trim();
    if(s.indexOf("/")!==-1){ var seg=s.split("/").filter(Boolean); s=seg[seg.length-1]; }
    var orcidLike=/^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/i.test(s);
    if(orcidLike && s.toUpperCase().indexOf("ORCID:")!==0) s="ORCID:"+s;
    return s;
  }
  function addMailto(u){
    var url=new URL(u, API);
    if(!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }
  function isFollowing(id){
    return serverFollows.some(function(f){ return f.id === id || f.author_id === id; });
  }
  async function getJSON(url){
    var withMt = addMailto(url);
    // simple retry on 429
    for (var attempt=1; attempt<=2; attempt++){
      try{
        var res = await fetch(withMt, { headers: { "Accept":"application/json" }, signal: abortCtrl ? abortCtrl.signal : undefined });
        if (res.status===429){
          var ra=parseInt(res.headers.get("Retry-After")||"1",10);
          await new Promise(function(r){ setTimeout(r, Math.min(ra,5)*1000); });
          continue;
        }
        if (!res.ok) throw new Error(res.status+" "+res.statusText);
        return await res.json();
      }catch(e){
        if (e.name === "AbortError") throw e;
        if (attempt===2) throw e;
      }
    }
    throw new Error("Unreachable");
  }
  function hardError(msg){
    var box=$("publicationsList");
    if(box) box.innerHTML='<div class="notice error"><strong>Error:</strong> '+escapeHtml(msg)+'</div>';
  }

  // ---- Header / metrics ----
  function setAffiliationNode(label, tail){
    var affNode = $("profileAffiliation");
    if (!affNode) return;
    if (label && tail){
      affNode.innerHTML = '<a href="institute.html?id='+encodeURIComponent(tail)+'">'+escapeHtml(label)+'</a>';
    } else if (label){
      affNode.textContent = label;
    } else {
      affNode.textContent = "Unknown affiliation";
    }
  }

  function renderAuthorHeader(a, seUser){
    if ($("profileName")) $("profileName").textContent = a.display_name || "Unknown researcher";

    // Main affiliation - link to institute page when possible
    var lki = get(a,"last_known_institution", null);
    var lkis = Array.isArray(a.last_known_institutions) ? a.last_known_institutions : [];
    var mainAff = lki || lkis[0] || null;
    if (mainAff && mainAff.display_name){
      var tailMain = (mainAff.id ? String(mainAff.id).replace(/^https?:\/\/openalex\.org\//i,"") : null);
      setAffiliationNode(mainAff.display_name, tailMain);
    } else {
      setAffiliationNode("Affiliation unavailable (deriving from publications…)", null);
    }

    var mainName = (a.display_name || "").toLowerCase().trim();
    var alt = (Array.isArray(a.display_name_alternatives)&&a.display_name_alternatives.length)?a.display_name_alternatives:(Array.isArray(a.alternate_names)?a.alternate_names:[]);
    // Filter out alternatives that are identical to the main display name
    alt = alt.filter(function(n){ return n && n.toLowerCase().trim() !== mainName; });
    if ($("otherNames")) $("otherNames").innerHTML = alt.length ? '<span class="muted" style="font-size:.85rem;">Also published as: '+alt.map(escapeHtml).join(", ")+'</span>' : "";

    if (a.orcid && $("profileOrcid")){
      var orcidHref = (a.orcid.indexOf("http")===0 ? a.orcid : ("https://orcid.org/"+a.orcid.replace(/^ORCID:/i,"")));
      $("profileOrcid").href = orcidHref;
      $("profileOrcid").textContent = "ORCID: "+orcidHref.split("/").pop();
      $("profileOrcid").style.display = "inline-block";
    }
    // Avatar: SE-uploaded photo takes priority over OpenAlex display_picture
    var photoEl = $("profilePhoto");
    if (photoEl) {
      var orcidForAvatar = a.orcid ? String(a.orcid).replace(/^https?:\/\/orcid\.org\//i,"") : null;
      // Fallback to SE user's ORCID if the OpenAlex author record has no ORCID
      if (!orcidForAvatar && seUser && seUser.orcid) {
        orcidForAvatar = String(seUser.orcid).replace(/^https?:\/\/orcid\.org\//i,"");
      }
      if (orcidForAvatar) {
        photoEl.src = "/api/avatar/" + encodeURIComponent(orcidForAvatar);
        photoEl.onerror = function() {
          if (a.display_picture) { photoEl.src = a.display_picture; photoEl.onerror = function(){ photoEl.style.display="none"; }; }
          else photoEl.style.display = "none";
        };
        photoEl.style.display = "";
      } else if (a.display_picture) {
        photoEl.src = a.display_picture;
        photoEl.onerror = function(){ photoEl.style.display="none"; };
        photoEl.style.display = "";
      }
    }

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
    concepts.forEach(function(c){
      if (c.display_name && c.id) {
        _conceptNameMap[c.display_name.toLowerCase()] = String(c.id).replace(/^https?:\/\/openalex\.org\//i,"");
      }
    });
    if ($("tagsContainer")){
      $("tagsContainer").innerHTML = concepts.slice(0,12).map(function(c){
        var tid = c.id ? c.id.split("/").pop() : "";
        return '<a class="topic-card" href="topic.html?id='+encodeURIComponent(tid)+'" title="Open topic"><span class="topic-name">'+escapeHtml(c.display_name||"Topic")+'</span></a>';
      }).join("");
    }

    if ($("aiBio")){
      // Prefer SE-set keywords over OpenAlex auto-assigned concepts
      var topTopics = (_seUser && _seUser.keywords && _seUser.keywords.length)
        ? _seUser.keywords.slice(0, 5)
        : concepts.slice(0,5).map(function(c){return c.display_name;}).filter(Boolean);
      // Prefer SE-saved affiliations over OpenAlex guesses for the auto-bio
      var affLabel = (_seUser && _seUser.affiliations && _seUser.affiliations[0])
        ? _seUser.affiliations[0]
        : (_seUser && _seUser.affiliation)
          ? _seUser.affiliation
          : (lki && lki.display_name ? lki.display_name : null);
      var wc0 = a.works_count || 0;
      $("aiBio").textContent =
        (a.display_name||"This researcher")+" studies "+(topTopics.join(", ")||"various topics")+". "+
        "They have "+(wc0.toLocaleString())+" "+(wc0 === 1 ? "work" : "works")+" and "+(totalCitations.toLocaleString())+" citations. "+
        "Current h-index is "+h+"."+(affLabel ? " Current affiliation: "+affLabel+"." : "");
    }

    // Past affiliations timeline: initial fallback to last_known_institutions
    var items = [];
    if (!lkis.length && lki) lkis = [lki];
    if ($("careerTimeline")){
      if (lkis.length){
        for (var i=0;i<lkis.length;i++){
          var nm = get(lkis[i], "display_name", null);
          if (!nm) continue;
          var tail = get(lkis[i], "id", null);
          tail = tail ? String(tail).replace(/^https?:\/\/openalex\.org\//i,"") : null;
          var label = tail ? '<a href="institute.html?id='+encodeURIComponent(tail)+'">'+escapeHtml(nm)+'</a>' : escapeHtml(nm);
          items.push('<li><span class="dot"></span><div><div class="title">'+label+'</div><div class="muted">Affiliation</div></div></li>');
        }
        $("careerTimeline").innerHTML = items.join("");
      } else {
        $("careerTimeline").innerHTML = "<li>No affiliations listed.</li>";
      }
    }
  }

  // ---- Trend charts (bigger text + Y ticks + full span) ----
  function niceTicks(maxValue, count){
    // produce "nice" ticks from 0..max, roughly count+1 lines
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
    // opts: { title, series:[{year, value}], id, yLabel }
    var title = opts.title || "";
    var series = Array.isArray(opts.series) ? opts.series : [];
    var yLabel = opts.yLabel || "";
    var id = opts.id || ("c" + Math.random().toString(36).slice(2));

    var H = 300, W = 640, padL = 76, padR = 16, padT = 20, padB = 54;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    if (!series.length){
      return '<div class="chart-block"><h4>'+escapeHtml(title)+'</h4><p class="muted">No data.</p></div>';
    }

    var n = series.length;
    var maxVal = 0;
    for (var i=0;i<n;i++){ if (series[i].value > maxVal) maxVal = series[i].value; }
    if (maxVal <= 0) maxVal = 1;

    var ticks = niceTicks(maxVal, 5);
    var maxTick = ticks[ticks.length-1];

    var step = innerW / n;
    var barW = Math.max(6, Math.min(28, step * 0.6));

    function x(i){ return padL + i*step + (step - barW)/2; }
    function y(v){ return padT + innerH - (v/maxTick)*innerH; }

    var y0 = padT + innerH;
    var first = series[0].year;
    var mid = series[Math.floor(n/2)].year;
    var last = series[n-1].year;

    var bars = [];
    for (var i=0;i<n;i++){
      var s = series[i];
      var bx = x(i), by = y(s.value), h = Math.max(0, y0 - by);
      bars.push('<rect x="'+bx.toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" ry="3" stroke="none"><title>'+escapeHtml(String(s.year))+": "+escapeHtml(String(s.value))+'</title></rect>');
    }

    var grid = [];
    var yLabels = [];
    for (var t=0; t<ticks.length; t++){
      var val = ticks[t];
      var gy = y(val);
      grid.push('<line x1="'+padL+'" x2="'+(W-padR)+'" y1="'+gy.toFixed(1)+'" y2="'+gy.toFixed(1)+'" class="grid" stroke="currentColor" stroke-opacity=".12" stroke-width="1"/>' );
      yLabels.push('<text x="'+(padL-10)+'" y="'+(gy+4).toFixed(1)+'" class="ylabel" text-anchor="end">'+escapeHtml(val.toLocaleString())+'</text>');
    }

    var xLabels = [
      '<text x="'+padL+'" y="'+(H-16)+'" class="xlabel">'+escapeHtml(String(first))+'</text>',
      '<text x="'+(padL + innerW/2)+'" y="'+(H-16)+'" class="xlabel" text-anchor="middle">'+escapeHtml(String(mid))+'</text>',
      '<text x="'+(W-padR)+'" y="'+(H-16)+'" class="xlabel" text-anchor="end">'+escapeHtml(String(last))+'</text>'
    ];

    var yAxisLabel = yLabel ? '<text x="16" y="'+(padT+8)+'" class="ylabel-unit" font-size="12" fill="currentColor" fill-opacity=".7">'+escapeHtml(yLabel)+'</text>' : '';

    return ''+
      '<div class="chart-block">'+
        '<h4>'+escapeHtml(title)+'</h4>'+
        '<svg class="chart-svg" viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" role="img" aria-label="'+escapeHtml(title)+'">'+
          yAxisLabel +
          '<g class="grid-lines">'+grid.join("")+'</g>'+
          '<g class="axis" fill="currentColor" fill-opacity=".85" font-size="13">'+yLabels.join("")+'</g>'+
          '<g class="bars" fill="currentColor" fill-opacity=".8">'+bars.join("")+'</g>'+
          '<g class="axis" fill="currentColor" fill-opacity=".85" font-size="13">'+xLabels.join("")+'</g>'+
        '</svg>'+
      '</div>';
  }


  function buildYearSeries(author){
    // Use counts_by_year, but ensure a continuous  min..max range (fill with zeros)
    var rows = Array.isArray(author.counts_by_year) ? author.counts_by_year.slice() : [];
    if (!rows.length) return [];
    rows.sort(function(a,b){ return a.year - b.year; });
    var minY = rows[0].year, maxY = rows[rows.length - 1].year;

    // Fill zeros
    var map = {};
    rows.forEach(function(r){
      map[r.year] = {
        year: r.year,
        works: Number(r.works_count || r.works || 0),
        cites: Number(r.cited_by_count || r.citations || 0)
      };
    });
    var out = [];
    for (var y=minY; y<=maxY; y++){
      out.push(map[y] || { year:y, works:0, cites:0 });
    }
    return out;
  }

  function renderTrendCharts(author){
    var wrap = $("trendCharts");
    if (!wrap) return;

    var seriesFull = buildYearSeries(author);
    if (!seriesFull.length){
      wrap.innerHTML = '<p class="muted">No trend data available.</p>';
      return;
    }

    var citesSeries = seriesFull.map(function(r){ return { year: r.year, value: r.cites }; });
    var worksSeries = seriesFull.map(function(r){ return { year: r.year, value: r.works }; });

    wrap.innerHTML =
      renderBarChartSVG({ title: "Citations per year", series: citesSeries, id: "cites" }) +
      renderBarChartSVG({ title: "Works per year",     series: worksSeries, id: "works" });
  }

  // ---- Publications rendering (uses components.js) ----
  function clearPublications(){
    var list = $("publicationsList");
    if (list) list.innerHTML = "";
    var pag = $("pubsPagination");
    if (pag) pag.innerHTML = "";
  }

  function renderWorksChunk(works){
    var list = $("publicationsList");
    if (!list) return;
    if (/Loading publications/i.test(list.textContent)) list.innerHTML = "";

    for (var i=0;i<works.length;i++){
      list.insertAdjacentHTML("beforeend", SE.components.renderPaperCard(works[i], { compact: true }));
    }
    SE.components.enhancePaperCards(list);

    // After rendering, update sidebar derivations (co-authors + aff years) from these works
    processWorksForSidebar(works);
    renderCoauthors();
    renderAffTimelineFromWorks();
    applyAffiliationFromWorksFallback();

    // Pagination UI
    var pag = $("pubsPagination");
    if (!pag) return;
    var shown = accumulatedWorks.length;
    if (shown < totalWorksCount) {
      pag.innerHTML = '<button id="loadMoreBtn" class="btn btn-secondary">Load more</button>';
      var btn = $("loadMoreBtn");
      if (btn) {
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

  function sortParam(){
    var dir = currentOrder === "asc" ? "asc" : "desc";
    if (currentSort === "citations") return "cited_by_count:"+dir;
    return "publication_year:"+dir;
  }

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
      totalWorksCount = get(data, "meta.count", totalWorksCount || results.length || 0);
      // If this is the last API page, we know we have everything
      var isLastPage = results.length < PAGE_SIZE;

      if (replace) {
        accumulatedWorks = [];
        coauthors = Object.create(null);
        affYears  = Object.create(null);
        clearPublications();
      }

      // Deduplicate before appending — dedup by OpenAlex ID AND DOI so
      // the same dataset appearing under multiple name variants is collapsed
      var seenIds = Object.create(null);
      accumulatedWorks.forEach(function(w) {
        if (w.id) seenIds[w.id] = true;
        var d = w.doi ? String(w.doi).toLowerCase().replace(/^https?:\/\/doi\.org\//i,'') : null;
        if (d) seenIds['doi:'+d] = true;
      });
      var uniqueNew = results.filter(function(w) {
        if (!w.id) return false;
        if (seenIds[w.id]) return false;
        var d = w.doi ? String(w.doi).toLowerCase().replace(/^https?:\/\/doi\.org\//i,'') : null;
        if (d && seenIds['doi:'+d]) return false;
        // Title dedup — collapses Zenodo multi-version datasets with same title
        var tk = 'title:' + String(w.title || w.display_name || '').toLowerCase().replace(/\s+/g,' ').trim();
        if (tk !== 'title:' && seenIds[tk]) return false;
        seenIds[w.id] = true;
        if (d) seenIds['doi:'+d] = true;
        if (tk !== 'title:') seenIds[tk] = true;
        return true;
      });
      accumulatedWorks = accumulatedWorks.concat(uniqueNew);

      // If last API page OR dedup reduced count to match what we expect, mark done
      if (isLastPage) totalWorksCount = accumulatedWorks.length;

      renderWorksChunk(uniqueNew);
    }catch(e){
      if (e.name === "AbortError") return;
      hardError(e.message || String(e));
      console.error(e);
    }
  }

  async function loadWorks(author){
    var worksApi = author && author.works_api_url;
    var list = $("publicationsList");
    if (!worksApi){
      if (list) list.innerHTML = '<p class="muted">No publications endpoint provided.</p>';
      return;
    }
    worksApiBaseUrl = worksApi;
    currentPage = 1;
    accumulatedWorks = [];

    if (list) list.innerHTML = '<p class="muted">Loading publications…</p>';
    await fetchWorksPage(currentPage, true);

    var total = author.works_count != null ? author.works_count : totalWorksCount;
    if ($("totalWorks")) $("totalWorks").textContent = (total || 0).toLocaleString();
  }

  // ---- Who cited me ----
  async function loadWhoCitedMe(works) {
    var section = $("whoCitedMeSection");
    var list = $("whoCitedMeList");
    if (!section || !list) return;

    // Collect DOIs from the loaded works, skip works without DOIs
    var dois = [];
    for (var i = 0; i < works.length; i++) {
      var doi = works[i].doi ? String(works[i].doi).replace(/^https?:\/\/doi\.org\//i, "") : null;
      if (doi && dois.indexOf(doi) === -1) dois.push(doi);
      if (dois.length >= 20) break; // cap at 20 papers to avoid hammering S2
    }
    if (!dois.length) return;

    section.style.display = "";
    list.innerHTML = '<p class="muted">Loading citation contexts…</p>';

    var allGroups = [];
    // Fetch one at a time to respect 1 req/sec — stagger with a small delay
    for (var d = 0; d < dois.length; d++) {
      if (d > 0) await new Promise(function(r){ setTimeout(r, 1100); });
      try {
        var resp = await fetch("/api/paper/citation-contexts?doi=" + encodeURIComponent(dois[d]), { credentials: "include" });
        if (!resp.ok) continue;
        var data = await resp.json();
        // The endpoint returns a flat citationContexts[] (one entry per context
        // sentence, not grouped by citing paper) — see routes/paper.js.
        var items = data.citationContexts || [];
        if (items.length > 0) allGroups.push({ doi: dois[d], items: items });
      } catch(_) {}
    }

    if (!allGroups.length) {
      list.innerHTML = '<p class="muted">No citation contexts available yet for your papers.</p>';
      return;
    }

    var anyStance = false;
    var html = "";
    for (var g = 0; g < allGroups.length; g++) {
      var group = allGroups[g];
      // Find the matching work title
      var workTitle = "";
      for (var w2 = 0; w2 < works.length; w2++) {
        var wd = works[w2].doi ? String(works[w2].doi).replace(/^https?:\/\/doi\.org\//i, "") : null;
        if (wd === group.doi) { workTitle = works[w2].title || group.doi; break; }
      }
      var paperHref = "paper.html?id=" + encodeURIComponent("https://doi.org/" + group.doi);
      html += '<div class="cited-me-group" style="margin-bottom:2rem;">';
      html += '<h3 style="font-size:1rem; margin-bottom:.5rem;">'
            + '<a href="' + paperHref + '">' + escapeHtml(workTitle) + '</a>'
            + ' <span class="muted" style="font-size:.85rem; font-weight:normal;">'
            + group.items.length.toLocaleString() + ' citation context' + (group.items.length !== 1 ? 's' : '')
            + '</span></h3>';

      for (var r = 0; r < group.items.length && r < 5; r++) {
        var c = group.items[r];
        var badges = "";
        if (c.intent) {
          var intentLabel = c.intent === "background" ? "Background"
                    : c.intent === "methodology" ? "Methodology"
                    : c.intent === "result" ? "Result"
                    : c.intent;
          badges += '<span class="stance-badge stance-' + escapeHtml(c.intent) + '">' + escapeHtml(intentLabel) + '</span> ';
        }
        if (c.stance) {
          anyStance = true;
          badges += '<span class="stance-badge stance-' + escapeHtml(c.stance.toLowerCase().replace(/\s+/g, "-")) + '">' + escapeHtml(c.stance) + '</span> ';
        }

        html += '<div class="cited-me-item" style="border-left:3px solid #e2e8f0; padding:.5rem .75rem; margin-bottom:.75rem;">';
        html += '<div style="font-size:.85rem; margin-bottom:.3rem;">';
        if (c.url) {
          html += '<a href="' + escapeHtml(c.url) + '" target="_blank" rel="noopener" style="font-weight:500;">' + escapeHtml(c.title || "Untitled") + '</a>';
        } else {
          html += '<span style="font-weight:500;">' + escapeHtml(c.title || "Untitled") + '</span>';
        }
        html += ' <span class="muted">(' + (c.year || "?") + ')</span>';
        if (c.authors) html += ' · <span class="muted">' + escapeHtml(c.authors) + '</span>';
        html += '</div>';
        if (badges) html += '<div style="margin-bottom:.35rem;">' + badges + '</div>';
        if (c.snippet) html += '<p style="font-size:.85rem; font-style:italic; color:#4b5563; margin:.2rem 0;">"' + escapeHtml(c.snippet) + '"</p>';
        html += '</div>';
      }

      if (group.items.length > 5) {
        html += '<p class="muted" style="font-size:.82rem;">+'
              + (group.items.length - 5) + ' more citing papers with context available</p>';
      }
      html += '</div>';
    }
    if (anyStance) {
      html += '<p class="muted" style="font-size:.78rem;">Stance labels (Supports/Challenges/etc.) are AI-classified from citation context — may be inaccurate.</p>';
    }
    list.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ---- Derivations from works: co-authors + affiliation years ----
  function idTail(any){ return any ? String(any).replace(/^https?:\/\/openalex\.org\//i,"") : null; }

  function processWorksForSidebar(works){
    var latestYearSeen = 0;
    for (var i=0;i<works.length;i++){
      var w = works[i];
      var yr = get(w, "publication_year", null);
      if (yr && yr > latestYearSeen) latestYearSeen = yr;

      var authorships = Array.isArray(w.authorships) ? w.authorships : [];

      // co-authors
      for (var a=0;a<authorships.length;a++){
        var aid = idTail(get(authorships[a], "author.id", null));
        var name = get(authorships[a], "author.display_name", null);
        if (!aid || aid === authorTail) continue;
        if (!coauthors[aid]) coauthors[aid] = { name: name || "Unknown", tail: aid, count: 0 };
        coauthors[aid].count += 1;
      }

      // affiliations for THIS author in this paper — check all claimed IDs
      var my = null;
      for (var a2=0;a2<authorships.length;a2++){
        var aid2 = idTail(get(authorships[a2], "author.id", null));
        if (aid2 && (aid2 === authorTail || authorTails[aid2])){ my = authorships[a2]; break; }
      }
      if (my){
        var insts = Array.isArray(my.institutions) ? my.institutions : [];
        for (var k=0;k<insts.length;k++){
          var itail = idTail(get(insts[k], "id", null));
          var nm = get(insts[k], "display_name", null) || "Institution";
          if (!itail) continue;
          if (!affYears[itail]) affYears[itail] = { name: nm, tail: itail, min: yr||null, max: yr||null };
          if (yr != null){
            if (affYears[itail].min==null || yr < affYears[itail].min) affYears[itail].min = yr;
            if (affYears[itail].max==null || yr > affYears[itail].max) affYears[itail].max = yr;
          }
        }
      }
    }
  }

  function applyAffiliationFromWorksFallback(){
    var affNode = $("profileAffiliation");
    if (!affNode) return;
    if (affNode.textContent && !/Unknown affiliation|Affiliation unavailable/i.test(affNode.textContent)) return;
    var best = null;
    Object.keys(affYears).forEach(function(t){
      var entry = affYears[t];
      if (!entry) return;
      if (!best) { best = entry; return; }
      var bestYear = best.max != null ? best.max : best.min || 0;
      var curYear = entry.max != null ? entry.max : entry.min || 0;
      if (curYear > bestYear) best = entry;
    });
    if (best){
      setAffiliationNode(best.name, best.tail);
    }
  }

  function renderCoauthors(){
    var box = $("coauthorsList");
    if (!box) return;
    var arr = Object.keys(coauthors).map(function(k){ return coauthors[k]; });
    if (!arr.length){
      box.innerHTML = '<li class="muted">No co-authors found (yet).</li>';
      return;
    }
    arr.sort(function(a,b){ return b.count - a.count; });
    var top = arr.slice(0, 12);
    box.innerHTML = top.map(function(c){
      return '<li class="list-item list-card" style="display:flex; justify-content:space-between; align-items:center;">' +
               '<a href="profile.html?id='+encodeURIComponent(c.tail)+'">'+escapeHtml(c.name)+'</a>' +
               '<span class="badge" title="Co-authored papers together">'+escapeHtml(String(c.count))+'</span>' +
             '</li>';
    }).join("");
  }

  function renderAffTimelineFromWorks(){
    var dom = $("careerTimeline");
    if (!dom) return;
    var arr = Object.keys(affYears).map(function(k){ return affYears[k]; });
    if (!arr.length) return; // keep initial fallback (already rendered)

    arr.sort(function(a,b){
      // Recent first by max year
      return (b.max||0) - (a.max||0);
    });

    var lastActive = 0;
    for (var i=0;i<arr.length;i++){ if (arr[i].max!=null && arr[i].max > lastActive) lastActive = arr[i].max; }

    dom.innerHTML = arr.map(function(x){
      var range = "-";
      if (x.min!=null && x.max!=null){
        range = (x.min === x.max) ? String(x.min) : (x.min + "–" + (x.max === lastActive ? "present" : x.max));
      } else if (x.min!=null){ range = String(x.min); } else if (x.max!=null){ range = String(x.max); }
      var label = '<a href="institute.html?id='+encodeURIComponent(x.tail)+'">'+escapeHtml(x.name)+'</a>';
      return '<li><span class="dot"></span><div><div class="title">'+label+'</div><div class="muted">'+escapeHtml(range)+'</div></div></li>';
    }).join("");
  }

  function wireFollowButton(author){
    var btn = $("followAuthorBtn");
    var status = $("followStatus");
    if (!btn || !authorTail) return;
    function refresh(){
      var following = isFollowing(authorTail);
      btn.textContent = following ? "Following" : "Follow";
      btn.classList.toggle("btn-secondary", !following);
      btn.classList.toggle("btn-success", following);
      if (status) status.textContent = following ? "Updates will show on your Home page." : (isAuthed ? "" : "Sign in to follow.");
    }
    refresh();
    btn.onclick = async function(){
      if (!isAuthed){
        if (status) status.textContent = "Sign in with ORCID to follow.";
        location.href = "/auth/orcid/login";
        return;
      }
      var following = isFollowing(authorTail);
      try{
        if (following){
          await fetch("/api/follows/"+encodeURIComponent(authorTail), { method:"DELETE", credentials:"include" });
          serverFollows = serverFollows.filter(function(f){ return (f.id||f.author_id) !== authorTail; });
        } else {
          await fetch("/api/follows", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type":"application/json" },
            body: JSON.stringify({ author_id: authorTail, name: author.display_name || authorTail })
          });
          serverFollows.push({ id: authorTail, name: author.display_name || authorTail });
        }
        refresh();
      } catch(e){
        if (status) status.textContent = "Could not update follow. Try again.";
        console.error(e);
      }
    };
  }

  // ---- Boot ----
  async function boot(authorIdParam, opts){
    opts = opts || {};
    try{
      // Auth + follows
      try{
        await fetch("/api/me", { credentials: "include" });
        isAuthed = true;
        try{
          var fl = await fetch("/api/follows", { credentials: "include" });
          if (fl.ok){
            var list = await fl.json();
            serverFollows = Array.isArray(list) ? list.map(function(f){ return ({ id: f.author_id || f.id, name: f.name || f.author_id }); }) : [];
          }
        }catch(_){}
      }catch(_){ isAuthed = false; serverFollows = []; }

      var id = normalizeAuthorId(authorIdParam || getParam("id"));
      var authorId = id || "A1969205033";
      authorTail = authorId.replace(/^https?:\/\/openalex\.org\//i,"");

      var author = await getJSON(API + "/authors/" + encodeURIComponent(authorTail));

      // ── Overlay SE user data (bio, affiliations, external links, ownership controls) ──
      var seUser = opts.seUser || _seUser || null;
      var isOwner = !!(opts.enhanced);

      renderAuthorHeader(author, seUser);

      // Bio: prefer user-written bio, fall back to auto-summary
      if (seUser && seUser.bio) {
        var bioSec = $("profileBio"), bioTxt = $("profileBioText");
        if (bioSec && bioTxt) { bioTxt.textContent = seUser.bio; bioSec.style.display = ""; }
        var aiBox = $("aiBio"); if (aiBox) aiBox.style.display = "none";
      } else {
        var aiBox2 = $("aiBio"); if (aiBox2) aiBox2.style.display = "";
      }

      // Affiliations: SE-saved affiliations always override OpenAlex guesses
      if (seUser && seUser.affiliations && seUser.affiliations.length > 0) {
        var affNode = $("profileAffiliation");
        if (affNode) affNode.innerHTML = seUser.affiliations.map(function(a){ return escapeHtml(a); }).join(' &nbsp;·&nbsp; ');
      } else if (seUser && seUser.affiliation) {
        var affNode2 = $("profileAffiliation");
        if (affNode2) affNode2.textContent = seUser.affiliation;
      }

      // Keywords from SE always take priority over OpenAlex auto-assigned concepts
      if (seUser && seUser.keywords && seUser.keywords.length) {
        var tc = $("tagsContainer");
        if (tc) {
          renderKeywordsWithLinks(seUser.keywords, tc);
        }
      }

      // External profile links
      renderExternalLinks(seUser);

      // Owner controls
      var followBtn = $("followAuthorBtn");
      var editBtn   = $("editProfileBtn");
      if (isOwner) {
        if (followBtn) followBtn.style.display = "none";
        if (editBtn) { editBtn.style.display = "inline-flex"; editBtn.onclick = function(){ location.href = "settings-profile.html"; }; }
        setupCvExport(author.display_name);
        setupBibtexExport(author.display_name);
      } else {
        if (editBtn) editBtn.style.display = "none";
        wireFollowButton(author);
      }

      // Page title
      if (author.display_name) document.title = author.display_name + " | ScienceEcosystem";

      // ── Merged works: if multiple OpenAlex IDs, override the works URL ─────────
      var allIds = (opts.allAuthorIds && opts.allAuthorIds.length > 1) ? opts.allAuthorIds : null;
      if (allIds) {
        // Store all tails so processWorksForSidebar can match any claimed ID
        allIds.forEach(function(id) {
          var t = String(id).replace(/^https?:\/\/openalex\.org\//i,'');
          authorTails[t] = true;
        });

        var idFilter = allIds.map(function(id){
          return id.indexOf("http") === 0 ? id : ("https://openalex.org/" + id);
        }).join("|");
        var mergedWorksUrl = API + "/works?filter=author.id:" + encodeURIComponent(idFilter)
          + "&sort=cited_by_count:desc&per_page=50";
        worksApiBaseUrl = mergedWorksUrl;
        currentPage = 1;
        accumulatedWorks = [];
        if ($("publicationsList")) $("publicationsList").innerHTML = '<p class="muted">Loading publications…</p>';
        await fetchWorksPage(currentPage, true);
        if ($("totalWorks")) $("totalWorks").textContent = accumulatedWorks.length;

        // Fetch citations-per-year from all author records and sum
        var citeCounts = Object.create(null);
        await Promise.all(allIds.map(async function(id) {
          var t = String(id).replace(/^https?:\/\/openalex\.org\//i,'');
          try {
            var a2 = await getJSON(API + "/authors/" + encodeURIComponent(t));
            (a2.counts_by_year || []).forEach(function(row) {
              if (!citeCounts[row.year]) citeCounts[row.year] = { year: row.year, works_count: 0, cited_by_count: 0 };
              citeCounts[row.year].cited_by_count += (row.cited_by_count || 0);
            });
          } catch(_) {}
        }));

        // Override works_count using deduplicated accumulatedWorks (correct count)
        accumulatedWorks.forEach(function(w) {
          var yr = w.publication_year;
          if (!yr) return;
          if (!citeCounts[yr]) citeCounts[yr] = { year: yr, works_count: 0, cited_by_count: 0 };
          citeCounts[yr].works_count += 1;
        });

        var fakeAuthor = { counts_by_year: Object.values(citeCounts).sort(function(a,b){ return a.year-b.year; }) };
        renderTrendCharts(fakeAuthor);

        // Update stats and auto-bio with merged totals
        var mergedCites = Object.values(citeCounts).reduce(function(s, r){ return s + (r.cited_by_count || 0); }, 0);
        var mergedWorks = accumulatedWorks.length;
        if ($("totalCitations")) $("totalCitations").textContent = mergedCites.toLocaleString();
        if ($("aiBio") && $("aiBio").textContent) {
          var bioEl = $("aiBio");
          bioEl.textContent = bioEl.textContent
            .replace(/They have \d[\d,]* works?/, "They have " + mergedWorks.toLocaleString() + " " + (mergedWorks === 1 ? "work" : "works"))
            .replace(/\d[\d,]* citations/, mergedCites.toLocaleString() + " citations");
        }
      } else {
        renderTrendCharts(author);
        await loadWorks(author);
      }

      // Semantic Scholar citation augmentation (non-blocking)
      var s2Url = opts.seUser && opts.seUser.semantic_scholar_url;
      if (s2Url) {
        var s2IdMatch = String(s2Url).match(/\/(\d+)\s*$/);
        if (s2IdMatch) {
          (async function(s2Id) {
            try {
              var r = await fetch("https://api.semanticscholar.org/graph/v1/author/" + encodeURIComponent(s2Id) + "?fields=citationCount");
              if (!r.ok) return;
              var d = await r.json();
              var s2Cites = d.citationCount || 0;
              if (!s2Cites) return;
              var curEl = $("totalCitations");
              var curVal = curEl ? parseInt((curEl.textContent || "").replace(/,/g, ""), 10) : 0;
              if (s2Cites > curVal) {
                if (curEl) curEl.textContent = s2Cites.toLocaleString();
                var bioEl = $("aiBio");
                if (bioEl) bioEl.textContent = bioEl.textContent.replace(/\d[\d,]* citations/, s2Cites.toLocaleString() + " citations");
              }
            } catch(_) {}
          })(s2IdMatch[1]);
        }
      }

      // Open Science Portfolio (computed after works load)
      renderOpenSciencePortfolio(accumulatedWorks);

      // Who cited me — only show on own profile, fire-and-forget
      if (opts && opts.enhanced) {
        loadWhoCitedMe(accumulatedWorks);
      }

      var sortSel = $("pubSort");
      var orderSel = $("orderSort");
      if (sortSel) {
        sortSel.value = currentSort;
        sortSel.addEventListener("change", async function(){
          currentSort = this.value === "citations" ? "citations" : "date";
          currentPage = 1; accumulatedWorks = [];
          await fetchWorksPage(currentPage, true);
          renderOpenSciencePortfolio(accumulatedWorks);
        });
      }
      if (orderSel){
        orderSel.value = currentOrder;
        orderSel.addEventListener("change", async function(){
          currentOrder = (this.value === "asc" ? "asc" : "desc");
          currentPage = 1; accumulatedWorks = [];
          await fetchWorksPage(currentPage, true);
        });
      }

    }catch(e){
      hardError(e.message || String(e));
      console.error(e);
      var wrap = $("trendCharts");
      if (wrap) wrap.innerHTML = '<p class="muted">Could not load trends.</p>';
    }
  }

  document.addEventListener("DOMContentLoaded", initProfilePage);
})();
