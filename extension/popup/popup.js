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
let _tabId = null;      // active tab id (for in-page PDF fetch via content script)
let _coldPdfUrl = null;   // tab URL, when it looks like a PDF but nothing was detected
let _coldPdfTitle = null;

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
  _tabId = tab.id;
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

  // Still nothing, and this looks like a raw PDF view with no DOI in the
  // URL (e.g. a publisher's short-lived signed asset link, like
  // ScienceDirect's pdf.sciencedirectassets.com PDFs) — check whether we
  // remember the paper this tab was on just before navigating here (saved
  // below, in step 5, whenever a real paper IS detected).
  let rememberedPdfUrl = null;
  if (!meta?.detected && tab.url && /\.pdf(\?|#|$)/i.test(tab.url)) {
    try {
      const key = "pdf_paper_tab_" + tab.id;
      const stored = await chrome.storage.session.get(key);
      const remembered = stored?.[key];
      if (remembered) {
        meta = {
          detected: true, doi: remembered.doi, title: remembered.title,
          authors: remembered.authors, year: remembered.year, venue: remembered.venue,
          isPdf: true,
        };
        rememberedPdfUrl = tab.url;
      }
    } catch (_) {}
  }

  _meta = meta;

  // Badge: set here instead of from the auto-injected content script
  if (meta?.detected) {
    chrome.action.setBadgeText({ text: "1", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#0284c7", tabId: tab.id });
  }

  if (!meta?.detected) {
    // No DOI/title found anywhere (page scrape, URL, or remembered tab
    // state) — but if this still looks like a PDF, offer to upload it raw
    // and let the server identify it from the document's own text/metadata
    // (same idea as Zotero's "Retrieve Metadata for PDF").
    if (tab.url && /\.pdf(\?|#|$)/i.test(tab.url)) {
      _coldPdfUrl = tab.url;
      _coldPdfTitle = tab.title || "PDF document";
      show("btnSaveColdPdf");
    }
    if (tab.url && /^https?:\/\//i.test(tab.url)) {
      _webPage = {
        url: tab.url,
        title: (meta?.title || tab.title || "").trim(),
        authors: Array.isArray(meta?.authors) ? meta.authors.join(", ") : (meta?.authors || ""),
        year: meta?.year || null,
        site: meta?.venue || "",
      };
      show("btnSaveWebPage");
    }
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
  _pdfUrls = rememberedPdfUrl ? [rememberedPdfUrl] : (meta.pdfUrls || []);

  // Remember this paper for the tab, in case the user navigates on to a
  // raw PDF view (e.g. clicks through to an online reader) where we won't
  // be able to detect anything from the page itself — see the lookup above.
  if (!rememberedPdfUrl) {
    try {
      await chrome.storage.session.set({
        ["pdf_paper_tab_" + tab.id]: {
          doi: meta.doi || null, title: meta.title || null, authors: meta.authors || null,
          year: meta.year || null, venue: meta.venue || null, ts: Date.now(),
        }
      });
    } catch (_) {}
  }

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

// ── Folder picker ─────────────────────────────────────────────────────────────
// Lets the user file a paper into a library folder right when they save it
// from the extension, instead of always landing unfiled and having to open
// the site's library separately to sort it — same idea as the folder
// popover added on the site's own Save button.

let _folderCollections = [];
let _selectedFolderId = null; // null = no folder

async function loadFolderPicker() {
  const btn = $("folderPickerBtn");
  if (!btn || _saved) return; // no point picking a folder for an already-saved paper
  const result = await msg("LIST_COLLECTIONS");
  _folderCollections = (result?.ok && Array.isArray(result.collections)) ? result.collections : [];
  _selectedFolderId = null;
  setText("folderPickerLabel", "No folder");
  btn.hidden = false;
}

// Renders a real collapsible folder tree — every folder starts closed, a
// chevron expands just that branch, clicking a folder's name selects it.
// Same shape as the site's own save-folder popover (components.js) and the
// library page's collection picker, so the mental model matches everywhere.
function renderFolderTree() {
  const tree = $("folderPickerTree");
  if (!tree) return;
  tree.innerHTML = "";

  const rootLi = document.createElement("li");
  rootLi.textContent = "No folder";
  rootLi.dataset.id = "";
  if (_selectedFolderId === null) rootLi.classList.add("selected");
  rootLi.addEventListener("click", () => selectFolder(null, "No folder"));
  tree.appendChild(rootLi);

  const byParent = new Map();
  _folderCollections.forEach((c) => {
    const k = c.parent_id != null ? String(c.parent_id) : "root";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  });

  (function addBranch(parentKey, depth, container) {
    (byParent.get(parentKey) || []).forEach((c) => {
      const hasChildren = byParent.has(String(c.id));
      const li = document.createElement("li");
      li.dataset.id = String(c.id);
      li.style.marginLeft = `${depth * 14}px`;
      if (String(_selectedFolderId) === String(c.id)) li.classList.add("selected");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "fp-toggle";
      toggle.textContent = hasChildren ? "▸" : "";
      toggle.disabled = !hasChildren;

      const name = document.createElement("span");
      name.className = "fp-name";
      name.textContent = c.name;

      li.appendChild(toggle);
      li.appendChild(name);
      container.appendChild(li);

      li.addEventListener("click", () => selectFolder(c.id, c.name));

      if (hasChildren) {
        const childWrap = document.createElement("ul");
        childWrap.style.listStyle = "none";
        childWrap.style.margin = "0";
        childWrap.style.padding = "0";
        childWrap.hidden = true;
        container.appendChild(childWrap);
        toggle.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const open = childWrap.hidden;
          childWrap.hidden = !open;
          toggle.textContent = open ? "▾" : "▸";
          if (open && !childWrap.childElementCount) addBranch(String(c.id), depth + 1, childWrap);
        });
      }
    });
  })("root", 0, tree);
}

function selectFolder(id, name) {
  _selectedFolderId = id;
  setText("folderPickerLabel", name);
  closeFolderPicker();
}

function toggleFolderPicker() {
  const panel = $("folderPickerPanel");
  if (!panel) return;
  if (!panel.hidden) { closeFolderPicker(); return; }
  renderFolderTree();
  panel.hidden = false;
  document.addEventListener("click", onFolderPickerOutsideClick, true);
}

function closeFolderPicker() {
  const panel = $("folderPickerPanel");
  if (panel) panel.hidden = true;
  document.removeEventListener("click", onFolderPickerOutsideClick, true);
}

function onFolderPickerOutsideClick(e) {
  const panel = $("folderPickerPanel");
  const btn = $("folderPickerBtn");
  if (panel && (panel.contains(e.target) || btn?.contains(e.target))) return;
  closeFolderPicker();
}

async function handleNewFolderInput(e) {
  if (e.key !== "Enter") return;
  const input = $("folderPickerNewInput");
  const name = (input.value || "").trim();
  if (!name) return;
  input.disabled = true;
  const result = await msg("CREATE_COLLECTION", { name });
  input.disabled = false;
  if (!result?.ok || !result.collection) {
    alert(`Could not create folder: ${result?.error || "unknown error"}`);
    return;
  }
  input.value = "";
  _folderCollections.push(result.collection);
  selectFolder(result.collection.id, result.collection.name);
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
  loadFolderPicker().catch(() => {});
}

// ── Save paper ────────────────────────────────────────────────────────────────

async function handleSave() {
  const btn = $("btnSave");
  btn.disabled = true;
  setSaveStatus("saving", "Saving…");

  const collectionId = _selectedFolderId || null;

  const openAlexTail = _work?.id?.replace("https://openalex.org/", "");
  const result = await msg("SAVE_PAPER", {
    collectionId,
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
    hide("folderPickerBtn"); closeFolderPicker();
  } else {
    btn.disabled = false;
    setSaveStatus("error", `✗ ${result?.error || "Could not save — are you logged in?"}`);
  }
}

// ── Save PDF ──────────────────────────────────────────────────────────────────

// Prefer fetching the PDF from inside the page itself (via the content
// script) rather than from the background service worker — an in-page
// fetch carries the page's own cookies AND a correct Referer header,
// exactly like the page's own "Download PDF" button would send. Many
// publishers' anti-bot checks gate on that, which is the likely reason a
// plain background-script fetch sometimes gets served an HTML interstitial
// instead of the real file (confirmed on ScienceDirect). Falls back to the
// background-script fetch (privileged, bypasses CORS) when the in-page
// fetch isn't possible — e.g. the candidate is cross-origin to the current
// page, or the content script isn't reachable on this page at all.
async function tryDownloadCandidate(pdfUrl, paperId, title) {
  try {
    const inPage = await chrome.tabs.sendMessage(_tabId, { type: "FETCH_PDF_BYTES", pdfUrl });
    if (inPage?.ok && inPage.bytes) {
      return await msg("UPLOAD_PDF_BYTES", { bytes: inPage.bytes, paperId, title });
    }
  } catch (_) { /* content script not reachable on this page — fall through */ }
  return await msg("DOWNLOAD_PDF", { pdfUrl, paperId, title });
}

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
  // (anti-bot pages, login walls). Stop at the first one that actually
  // validates as a real PDF server-side.
  const paperId = openAlexTail || _meta?.doi || null;
  const title = _meta?.title || "paper";
  let result = null;
  for (let i = 0; i < _pdfUrls.length; i++) {
    if (_pdfUrls.length > 1) setText("btnSavePdfLabel", `Downloading… (${i + 1}/${_pdfUrls.length})`);
    result = await tryDownloadCandidate(_pdfUrls[i], paperId, title);
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

// Save the current page as a plain web-page item (no DOI needed).
let _webPage = null;
async function handleSaveWebPage() {
  const btn = $("btnSaveWebPage");
  btn.disabled = true;
  const statusEl = $("webPageStatus");
  statusEl.hidden = false;
  statusEl.textContent = "Saving…";
  const result = await msg("SAVE_WEBPAGE", _webPage || {});
  if (result?.ok) {
    statusEl.textContent = result.result?.duplicate
      ? "✓ Already in your library"
      : `✓ Saved: "${truncate(result.result?.item?.title || _webPage?.title || "web page", 80)}"`;
    btn.hidden = true;
  } else {
    btn.disabled = false;
    statusEl.textContent = `✗ ${result?.error || "Could not save this page — are you logged in?"}`;
  }
}

// Upload a "cold" PDF (no detected DOI/title) as-is and let the server
// identify it from the document's own text/metadata — see the paperId-less
// branch of uploadPdfBlob() in the service worker, which already hits
// /api/library/import-pdf for exactly this case.
async function handleSaveColdPdf() {
  const btn = $("btnSaveColdPdf");
  btn.disabled = true;
  const statusEl = $("coldPdfStatus");
  statusEl.hidden = false;
  statusEl.textContent = "Downloading and identifying…";

  const result = await tryDownloadCandidate(_coldPdfUrl, null, _coldPdfTitle);

  if (result?.ok) {
    const item = result.result?.item;
    statusEl.textContent = item?.meta_fresh
      ? `✓ Identified and saved: "${truncate(item.title, 80)}"`
      : "✓ Saved to your library (couldn't confirm the exact paper — check the library entry)";
    btn.hidden = true;
  } else {
    btn.disabled = false;
    statusEl.textContent = `✗ ${result?.error || "Could not save this PDF"}`;
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
  $("folderPickerBtn")?.addEventListener("click", toggleFolderPicker);
  $("folderPickerNewInput")?.addEventListener("keydown", handleNewFolderInput);

  // Save PDF
  $("btnSavePdf")?.addEventListener("click", handleSavePdf);

  // Login button → open SE login page
  $("btnLogin")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${SE_BASE}/auth/orcid/login` });
  });

  // Save a "cold" PDF (no paper detected, but URL looks like a PDF)
  $("btnSaveColdPdf")?.addEventListener("click", handleSaveColdPdf);
  $("btnSaveWebPage")?.addEventListener("click", handleSaveWebPage);

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
