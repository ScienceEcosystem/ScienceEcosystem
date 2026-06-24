// ScienceEcosystem — popup script
"use strict";

const SE_BASE = "https://scienceecosystem.org";

// ── Helpers ───────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
function show(id) { const el = $(id); if (el) el.hidden = false; }
function hide(id) { const el = $(id); if (el) el.hidden = true; }
function setText(id, text) { const el = $(id); if (el) el.textContent = text; }

function msg(type, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...data }, resolve);
  });
}

function truncate(str, max = 120) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max).trimEnd() + "…" : str;
}

// ── State machine ─────────────────────────────────────────────────────────────

let _meta = null;       // page metadata from content script
let _work = null;       // OpenAlex work record (may be null)
let _user = null;       // SE user object
let _saved = false;     // whether paper is already in library
let _pdfUrls = [];      // PDF URLs found on page

function showState(id) {
  ["stateLoading", "stateNoAuth", "stateNoPaper", "statePaper"].forEach(hide);
  show(id);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  showState("stateLoading");

  // 1. Check auth
  const authResult = await msg("CHECK_AUTH");
  if (!authResult?.loggedIn) {
    showState("stateNoAuth");
    setFooter(null);
    return;
  }
  _user = authResult.user;
  setFooter(_user);

  // 2. Get metadata — inject content script on demand (no <all_urls> needed)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let meta = null;
  try {
    try {
      meta = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_METADATA" });
    } catch (_) {
      // Not yet injected — use scripting API to inject now
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] });
      await new Promise(r => setTimeout(r, 80));
      meta = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_METADATA" });
    }
  } catch (_) { /* chrome://, PDF, restricted page */ }

  // PDF fallback: if content script couldn't detect a paper (e.g. Chrome PDF viewer
  // or a direct .pdf URL), try to extract a DOI from the tab URL itself.
  if (!meta?.detected && tab.url) {
    const doiMatch = tab.url.match(/10\.\d{4,}\/[^\s"?#&,)>]+/);
    if (doiMatch) {
      const doi = doiMatch[0].replace(/[.,;)]+$/, ""); // trim trailing punctuation
      meta = { detected: true, doi, title: tab.title || "PDF document", isPdf: true };
    }
  }

  _meta = meta;

  // Badge: set here instead of from the auto-injected content script
  if (meta?.detected) {
    chrome.action.setBadgeText({ text: "1", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#0284c7", tabId: tab.id });
  }

  if (!meta?.detected) {
    showState("stateNoPaper");
    return;
  }

  // 3. Attempt OpenAlex lookup to enrich metadata
  if (meta.doi) {
    const resolved = await msg("RESOLVE_DOI", { doi: meta.doi });
    if (resolved?.work) {
      _work = resolved.work;
      enrichMetaFromWork(_work, meta);
    }
  }

  // 3b. Fetch JTI async — fires in background, doesn't block the rest of boot
  const sourceId = _work?.primary_location?.source?.id;
  if (sourceId) {
    msg("FETCH_SOURCE", { sourceId }).then(result => {
      if (result?.source) renderJTI(computeJTI(result.source));
    });
  }

  // 4. Check if already saved
  _saved = await msg("CHECK_SAVED", {
    doi: meta.doi,
    openAlexId: _work?.id?.replace("https://openalex.org/", "") || null
  }).then(r => r?.saved ?? false).catch(() => false);

  // 5. Render paper state
  _pdfUrls = (meta.pdfUrls || []);
  renderPaperState();
}

// ── Enrich metadata from OpenAlex record ─────────────────────────────────────

function enrichMetaFromWork(work, meta) {
  if (!meta.title && work.display_name) meta.title = work.display_name;
  if (!meta.year && work.publication_year) meta.year = String(work.publication_year);
  if (!meta.venue) {
    meta.venue = work.primary_location?.source?.display_name
      || work.host_venue?.display_name
      || null;
  }
  if (!meta.authors?.length) {
    meta.authors = (work.authorships || [])
      .slice(0, 5)
      .map(a => a?.author?.display_name)
      .filter(Boolean);
  }
  // Add OA PDF if found
  const oaPdf = work.best_oa_location?.pdf_url
    || work.primary_location?.pdf_url
    || work.open_access?.oa_url
    || null;
  if (oaPdf && !_pdfUrls.includes(oaPdf)) _pdfUrls.unshift(oaPdf);
}

// ── Journal Trust Index ───────────────────────────────────────────────────────

function computeJTI(src) {
  const isDoaj = !!(src.is_in_doaj);
  const isOa   = !!(src.is_oa);
  const openness = isDoaj ? 30 : isOa ? 20 : 0;

  const cite2yr = parseFloat(src.summary_stats?.["2yr_mean_citedness"] || 0);
  const recognition = cite2yr > 0
    ? Math.min(40, Math.round(Math.log(cite2yr + 1) / Math.log(51) * 40))
    : 0;

  const wc = parseInt(src.works_count || 0, 10);
  const scale = wc > 0
    ? Math.min(15, Math.round(Math.log(wc + 1) / Math.log(100001) * 15))
    : 0;

  const type = (src.type || "").toLowerCase();
  const integrity = type === "journal" ? (isOa ? 15 : 10) : (isOa ? 5 : 0);

  const total = openness + recognition + scale + integrity;
  const grade = total >= 85 ? "Excellent"
              : total >= 70 ? "Good"
              : total >= 50 ? "Fair"
              : total >= 30 ? "Limited"
              : "Poor";
  return { total, grade };
}

function renderJTI(jti) {
  const el = $("paperJti");
  if (!el) return;
  el.textContent = `Journal: JTI ${jti.total}/100 · ${jti.grade}`;
  el.hidden = false;
}

// ── Render the detected-paper state ──────────────────────────────────────────

function renderPaperState() {
  const meta = _meta;

  // Title
  setText("paperTitle", truncate(meta.title || "Unknown title", 160));

  // Authors + year + venue
  const authorsStr = (meta.authors || []).slice(0, 3).join(", ")
    + (meta.authors?.length > 3 ? " et al." : "");
  const parts = [authorsStr, meta.year, meta.venue].filter(Boolean);
  setText("paperMeta", parts.join(" · ") || "—");

  // DOI
  setText("paperDoi", meta.doi ? `DOI: ${meta.doi}` : "");

  // Already saved?
  if (_saved) {
    setSaveStatus("saved", "✓ Already in your library");
    const btn = $("btnSave");
    btn.className = "btn btn-success";
    btn.disabled = true;
    setText("btnSaveIcon", "✓");
    setText("btnSaveLabel", "Saved");
  }

  // PDF button
  if (_pdfUrls.length > 0) {
    show("btnSavePdf");
    setText("btnSavePdfLabel", `Save PDF${_pdfUrls.length > 1 ? ` (${_pdfUrls.length} found)` : ""}`);
  }

  // "View in SE" link
  const openAlexTail = _work?.id?.replace("https://openalex.org/", "");
  if (openAlexTail || meta.doi) {
    const seUrl = openAlexTail
      ? `${SE_BASE}/paper.html?id=${encodeURIComponent(openAlexTail)}`
      : `${SE_BASE}/search.html?q=${encodeURIComponent(meta.title || meta.doi)}`;
    const link = $("linkOpenSE");
    if (link) { link.href = seUrl; link.target = "_blank"; }
  }

  showState("statePaper");
}

// ── Save paper ────────────────────────────────────────────────────────────────

async function handleSave() {
  const btn = $("btnSave");
  btn.disabled = true;
  setSaveStatus("saving", "Saving…");

  const openAlexTail = _work?.id?.replace("https://openalex.org/", "");
  const result = await msg("SAVE_PAPER", {
    id: openAlexTail || _meta?.doi || "",
    title: _meta?.title || "Untitled",
    doi: _meta?.doi || null
  });

  if (result?.ok) {
    _saved = true;
    btn.className = "btn btn-success";
    setText("btnSaveIcon", "✓");
    setText("btnSaveLabel", "Saved");
    setSaveStatus("saved", "✓ Saved to your library");
  } else {
    btn.disabled = false;
    setSaveStatus("error", `✗ ${result?.error || "Could not save — are you logged in?"}`);
  }
}

// ── Save PDF ──────────────────────────────────────────────────────────────────

async function handleSavePdf() {
  const btn = $("btnSavePdf");
  btn.disabled = true;
  setText("btnSavePdfLabel", "Downloading…");
  showPdfStatus("Downloading PDF from publisher…");

  const openAlexTail = _work?.id?.replace("https://openalex.org/", "");

  // If paper isn't saved yet, save it first
  if (!_saved) {
    await msg("SAVE_PAPER", {
      id: openAlexTail || _meta?.doi || "",
      title: _meta?.title || "Untitled",
      doi: _meta?.doi || null
    });
    _saved = true;
  }

  // Try each candidate PDF URL in order, not just the first guess —
  // publisher pages often expose several (citation_pdf_url, constructed
  // download links, etc.) and not all of them resolve to an actual PDF
  // (anti-bot pages, login walls, redirects our background fetch can't
  // follow the same way a real browser navigation would). Stop at the
  // first one that actually validates as a real PDF server-side.
  let result = null;
  for (let i = 0; i < _pdfUrls.length; i++) {
    if (_pdfUrls.length > 1) setText("btnSavePdfLabel", `Downloading… (${i + 1}/${_pdfUrls.length})`);
    result = await msg("DOWNLOAD_PDF", {
      pdfUrl: _pdfUrls[i],
      paperId: openAlexTail || _meta?.doi || null,
      title: _meta?.title || "paper"
    });
    if (result?.ok) break;
  }

  if (result?.ok) {
    btn.className = "btn btn-success";
    setText("btnSavePdfLabel", "PDF saved ✓");
    showPdfStatus("✓ PDF attached to library item");
    // If paper wasn't already marked saved, update UI
    if (!_saved) {
      setSaveStatus("saved", "✓ Saved to your library");
      $("btnSave").className = "btn btn-success";
      $("btnSave").disabled = true;
      setText("btnSaveIcon", "✓");
      setText("btnSaveLabel", "Saved");
    }
  } else {
    btn.disabled = false;
    setText("btnSavePdfLabel", "Save PDF");
    showPdfStatus(`✗ ${result?.error || "PDF download failed"}`);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setSaveStatus(type, text) {
  const el = $("saveStatus");
  if (!el) return;
  el.className = `save-status ${type}`;
  el.textContent = text;
  el.hidden = false;
}

function showPdfStatus(text) {
  const el = $("pdfStatus");
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
}

function setFooter(user) {
  const authBadge = $("authBadge");
  const footerUser = $("footerUser");
  if (user) {
    if (authBadge) { authBadge.textContent = "●  signed in"; authBadge.className = "auth-badge ok"; }
    if (footerUser) footerUser.textContent = user.name || user.orcid || "Signed in";
  } else {
    if (authBadge) { authBadge.textContent = "not signed in"; authBadge.className = "auth-badge"; }
    if (footerUser) footerUser.textContent = "Not signed in";
  }
}

// ── Wire events ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Save paper
  $("btnSave")?.addEventListener("click", handleSave);

  // Save PDF
  $("btnSavePdf")?.addEventListener("click", handleSavePdf);

  // Login button → open SE login page
  $("btnLogin")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${SE_BASE}/auth/orcid/login` });
  });

  // Open library
  $("btnOpenLibrary")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${SE_BASE}/library.html` });
  });

  // Footer library link
  $("footerLibrary")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${SE_BASE}/library.html` });
  });

  // Boot the popup
  boot().catch(console.error);
});
