/* =========================================================================
   ScienceEcosystem - Profile Page (production)
   - Robust OpenAlex fetch with mailto + retry
   - Works even if ?id= is missing (falls back to a known author)
   - No overlay; console-only notes via no-op shims
   ========================================================================= */

(function () {
  // ---- no-op logger shims (prevent ReferenceError) ----
  const log  = (..._) => {};
  const ok   = (..._) => {};
  const fail = (..._) => {};

  // ---- constants & utils ----
  const API = "https://api.openalex.org";
  const MAILTO = "scienceecosystem@icloud.com";
  const PAGE_SIZE = 50;

  const $ = (id) => document.getElementById(id);
  const getParam = (name) => new URLSearchParams(location.search).get(name);

  function escapeHtml(str = "") {
    return String(str).replace(/[&<>'"]/g, (c) =>
      ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" }[c]));
  }

  function normalizeAuthorId(raw) {
    if (!raw) return "";
    let s = raw;
    try { s = decodeURIComponent(s); } catch {}
    s = s.trim();
    if (s.includes("/")) s = s.split("/").filter(Boolean).pop();
    const orcidLike = /^\d{4}-\d{4}-\d{4}-\d{3}[0-9X]$/i.test(s);
    if (orcidLike && !s.toUpperCase().startsWith("ORCID:")) s = `ORCID:${s}`;
    return s;
  }

  function addMailto(u) {
    const url = new URL(u, API);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  }

  async function getJSON(url) {
    const withMt = addMailto(url);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(withMt, { headers: { "Accept": "application/json" } })
        .catch(err => ({ ok: false, statusText: err.message }));
      if (!res || !res.ok) {
        if (res && res.status === 429) {
          const ra = parseInt(res.headers.get("Retry-After") || "1", 10);
          await new Promise(r => setTimeout(r, Math.min(ra,5)*1000));
          continue;
        }
        const msg = `Fetch failed: ${res ? (res.status + " " + res.statusText) : "network error"}`;
        if (attempt === 2) throw new Error(msg);
      } else {
        return res.json();
      }
    }
    throw new Error("Unreachable");
  }

  // ---- rendering ----
  function renderAuthorHeader(a) {
    $("profileName").textContent = a.display_name || "Unknown researcher";
    $("profileAffiliation").textContent =
      a.last_known_institution?.display_name ||
      a.last_known_institutions?.[0]?.display_name ||
      "Unknown affiliation";

    const alt = (a.display_name_alternatives?.length ? a.display_name_alternatives : a.alternate_names) || [];
    $("otherNames").innerHTML = alt.length
      ? `<strong>Also published as:</strong> ${alt.map(escapeHtml).join(", ")}`
      : "";

    if (a.orcid) {
      const orcidHref = a.orcid.startsWith("http") ? a.orcid : `https://orcid.org/${a.orcid.replace(/^ORCID:/i,"")}`;
      const el = $("profileOrcid");
      el.href = orcidHref;
      el.textContent = `ORCID: ${orcidHref.split("/").pop()}`;
      el.style.display = "inline-block";
    }
    if (a.display_picture) $("profilePhoto").src = a.display_picture;

    const h = a.summary_stats?.h_index || 0;
    const i10 = a.summary_stats?.i10_index || 0;
    const totalCitations = a.cited_by_count || 0;
    const years = (a.counts_by_year || []).map(c => c.year);
    const now = new Date().getFullYear();
    const minY = years.length ? Math.min(...years) : now;
    const maxY = years.length ? Math.max(...years) : now;
    const yearsActive = Math.max(1, maxY - minY + 1);
    const ris = (totalCitations * h) / (yearsActive + 1);

    $("hIndex").textContent = h.toLocaleString();
    $("i10Index").textContent = i10.toLocaleString();
    $("totalCitations").textContent = totalCitations.toLocaleString();
    $("risValue").textContent = ris.toFixed(1);

    const concepts = Array.isArray(a.x_concepts) ? a.x_concepts : [];
    $("tagsContainer").innerHTML = concepts
      .sort((x,y)=> (y.score||0)-(x.score||0)).slice(0,12)
      .map(c => `<a class="topic-card" href="topic.html?id=${c.id?.split("/").pop()||""}"><span class="topic-name">${escapeHtml(c.display_name||"Topic")}</span></a>`)
      .join("");

    const topTopics = concepts
      .sort((x,y)=>(y.score||0)-(x.score||0)).slice(0,5)
      .map(c=>c.display_name).filter(Boolean);
    $("aiBio").textContent =
      `${a.display_name || "This researcher"} studies ${topTopics.join(", ") || "various topics"}. `
      + `They have ${(a.works_count || 0).toLocaleString()} works and ${totalCitations.toLocaleString()} citations. `
      + `Current h-index is ${h}. Latest affiliation is ${$("profileAffiliation").textContent}.`;

    // simple timeline
    const timeline = [];
    if (a.last_known_institution?.display_name) timeline.push(a.last_known_institution.display_name);
    (a.last_known_institutions||[]).forEach(inst => { if (inst?.display_name) timeline.push(inst.display_name); });
    $("careerTimeline").innerHTML = timeline.length
      ? timeline.map(name => `<li><span class="dot"></span><div><div class="title">${escapeHtml(name)}</div><div class="muted">Affiliation</div></div></li>`).join("")
      : "<li>No affiliations listed.</li>";
  }

  function provenanceChips(w) {
    const doiRaw = w.doi || w.ids?.doi;
    const doi = doiRaw
      ? (String(doiRaw).startsWith("http") ? doiRaw : `https://doi.org/${encodeURIComponent(String(doiRaw).replace(/^doi:/i,""))}`)
      : null;
    const openAlexUrl = w.id || null;
    const oaUrl = w.open_access?.oa_url || w.primary_location?.pdf_url || w.best_oa_location?.url || null;
    const venueUrl = w.primary_location?.source?.homepage_url || w.primary_location?.landing_page_url || null;
    const parts = [];
    if (doi) parts.push(`<a class="badge" href="${doi}" target="_blank" rel="noopener">DOI</a>`);
    if (oaUrl) parts.push(`<a class="badge badge-oa" href="${oaUrl}" target="_blank" rel="noopener">Open access</a>`);
    if (venueUrl) parts.push(`<a class="badge" href="${venueUrl}" target="_blank" rel="noopener">Source</a>`);
    if (openAlexUrl) parts.push(`<a class="badge" href="${openAlexUrl}" target="_blank" rel="noopener">OpenAlex</a>`);
    return parts.join(" ");
  }

  function renderWorksChunk(works) {
    const list = $("publicationsList");
    if (/Loading publications/i.test(list.textContent)) list.innerHTML = "";
    for (const w of works) {
      const title = w.display_name || w.title || "Untitled work";
      const idTail = w.id ? w.id.split("/").pop() : "";
      const doiRaw = w.doi || w.ids?.doi || "";
      const pid = doiRaw ? `doi:${encodeURIComponent(String(doiRaw).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""))}` : idTail;
      const year = w.publication_year ?? "N/A";
      const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "Unknown venue";
      const cites = w.cited_by_count || 0;

      const authorsHtml = (w.authorships || [])
        .map((a) => {
          const aid = a.author?.id ? a.author.id.split("/").pop() : null;
          const name = escapeHtml(a.author?.display_name || "Unknown");
          return aid ? `<a href="profile.html?id=${aid}">${name}</a>` : name;
        }).join(", ") || "Unknown authors";

      list.insertAdjacentHTML("beforeend", `
        <article class="result-card">
          <h3><a href="paper.html?id=${pid}">${escapeHtml(title)}</a></h3>
          <p class="meta"><span class="muted">${year}</span> · <strong>Published in:</strong> ${escapeHtml(venue)} · <strong>Citations:</strong> ${cites}</p>
          <p><strong>Authors:</strong> ${authorsHtml}</p>
          <p class="chips">${provenanceChips(w)}</p>
        </article>
      `);
    }
  }

  async function loadWorks(author) {
    if (!author?.works_api_url) {
      $("publicationsList").innerHTML = `<p class="muted">No publications endpoint provided.</p>`;
      return;
    }
    const url = new URL(author.works_api_url, API);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", "1");
    const data = await getJSON(url.toString());
    ok("Works page 1 loaded.");
    const results = Array.isArray(data.results) ? data.results : [];
    $("totalWorks").textContent = (author.works_count || data.meta?.count || results.length).toLocaleString();
    $("pubsPagination").innerHTML = ""; // simple first-page render
    renderWorksChunk(results);
  }

  async function boot() {
    // optional heads-up when served via file://
    if (location.protocol === "file:") {
      log("Tip: serve via a local web server if XHRs are blocked (e.g., `python -m http.server`).");
    }

    // if search.js isn’t present this is fine
    if (window.handleSearch) ok("search.js loaded.");

    const raw = getParam("id");
    const id = normalizeAuthorId(raw);
    if (!id) {
      fail("No ?id= provided. Using fallback author.");
    }

    const authorId = id || "A1969205033"; // fallback
    const authorUrl = `${API}/authors/${encodeURIComponent(authorId)}`;
    log(`Fetching author: ${authorUrl}`);

    let author;
    try {
      author = await getJSON(authorUrl);
      ok("Author loaded.");
    } catch (e) {
      $("publicationsList").innerHTML = `<p class="muted">Profile not found or network blocked.</p>`;
      return;
    }

    renderAuthorHeader(author);

    try {
      await loadWorks(author);
    } catch (e) {
      $("publicationsList").innerHTML = `<p class="muted">Could not load publications.</p>`;
    }

    // quick ping (optional)
    try {
      await getJSON(`${API}/works?per_page=1`);
      ok("OpenAlex ping OK.");
    } catch {}
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
