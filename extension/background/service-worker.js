// ScienceEcosystem — background service worker
// Handles all API calls to the SE server, auth state, and PDF downloads.
// Runs in a separate context from popup/content; all communication is via chrome.runtime.sendMessage.

const SE_BASE = "https://scienceecosystem.org"; // change to http://localhost:3000 for local dev

// ── API helper ──────────────────────────────────────────────────────────────

async function seApi(path, opts = {}) {
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(`${SE_BASE}${path}`, {
    credentials: "include",
    headers: isFormData ? {} : { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts
  });
  if (res.status === 204) return { ok: true };
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(String(body?.error || body || res.status)), { status: res.status });
  return body;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const user = await seApi("/api/me");
    return { loggedIn: true, user };
  } catch (e) {
    if (e.status === 401 || e.status === 404) return { loggedIn: false, user: null };
    return { loggedIn: false, user: null, error: e.message };
  }
}

// ── Library helpers ───────────────────────────────────────────────────────────

async function checkIfSaved(doi, openAlexId) {
  try {
    const items = await seApi("/api/library");
    const normDoi = (s) => String(s || "").toLowerCase().replace(/^doi:/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    const nd = normDoi(doi);
    return items.some(it => {
      if (openAlexId && (it.id === openAlexId || it.openalex_id === openAlexId)) return true;
      if (nd && normDoi(it.doi) === nd) return true;
      return false;
    });
  } catch (_) {
    return false;
  }
}

async function savePaper({ id, title, doi }) {
  return seApi("/api/library", {
    method: "POST",
    body: JSON.stringify({ id: id || doi || "", title: title || "Untitled" })
  });
}

// ── OpenAlex lookup ───────────────────────────────────────────────────────────

async function resolveByDoi(doi) {
  if (!doi) return null;
  try {
    const clean = doi.replace(/^doi:/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
    const res = await fetch(
      `https://api.openalex.org/works/doi:${encodeURIComponent(clean)}?mailto=info@scienceecosystem.org`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// ── PDF download & upload ─────────────────────────────────────────────────────

async function downloadAndUploadPdf({ pdfUrl, paperId, title }) {
  // 1. Fetch the PDF from the page (with the user's browser session / cookies)
  let pdfBlob;
  try {
    const res = await fetch(pdfUrl, { credentials: "include" });
    if (!res.ok) throw new Error(`PDF fetch failed: ${res.status}`);
    pdfBlob = await res.blob();
  } catch (e) {
    throw new Error(`Could not download PDF: ${e.message}`);
  }

  // 2. Upload to SE as either a new import or attach to existing item
  const form = new FormData();
  const filename = `${(title || "paper").replace(/[^a-z0-9]/gi, "_").slice(0, 60)}.pdf`;
  form.append("file", pdfBlob, filename);

  if (paperId) {
    // Attach to existing library item
    form.append("paper_id", paperId);
    return seApi("/api/library/pdf", { method: "POST", body: form });
  } else {
    // Import as new item (server will try to extract DOI from the PDF)
    return seApi("/api/library/import-pdf", { method: "POST", body: form });
  }
}

// ── Annotation sync helper ────────────────────────────────────────────────────

async function syncAnnotations({ paperId, pdfUrl, annotations }) {
  return seApi("/api/library/pdf-annotations", {
    method: "POST",
    body: JSON.stringify({ paper_id: paperId, pdf_url: pdfUrl, annotations })
  });
}

// ── Omnibox search ────────────────────────────────────────────────────────────

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  if (!text.trim()) return;
  suggest([{
    content: text,
    description: `Search ScienceEcosystem for: <match>${text}</match>`
  }]);
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const url = `${SE_BASE}/search.html?q=${encodeURIComponent(text.trim())}`;
  if (disposition === "currentTab") {
    chrome.tabs.update({ url });
  } else {
    chrome.tabs.create({ url, active: disposition === "newForegroundTab" });
  }
});

// ── Keyboard shortcut ─────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-paper") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  let meta;
  try { meta = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_METADATA" }); } catch (_) {}

  if (!meta?.detected) {
    chrome.notifications.create("", {
      type: "basic", iconUrl: "icons/icon48.png",
      title: "No paper detected",
      message: "Could not find a research paper on this page."
    });
    return;
  }

  const auth = await checkAuth();
  if (!auth.loggedIn) {
    chrome.tabs.create({ url: `${SE_BASE}/auth/orcid/login` });
    return;
  }

  let work = null;
  if (meta.doi) work = await resolveByDoi(meta.doi);
  const openAlexTail = work?.id?.replace("https://openalex.org/", "");

  try {
    await savePaper({ id: openAlexTail || meta.doi || "", title: meta.title || "Untitled", doi: meta.doi || null });
    chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e", tabId: tab.id });
    chrome.notifications.create("", {
      type: "basic", iconUrl: "icons/icon48.png",
      title: "Paper saved!",
      message: `"${(meta.title || "Paper").slice(0, 80)}" added to your library.`
    });
  } catch (e) {
    chrome.notifications.create("", {
      type: "basic", iconUrl: "icons/icon48.png",
      title: "Save failed",
      message: e.message || "Could not save. Are you logged in?"
    });
  }
});

// ── Action badge — clear on navigation ───────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId });
  }
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  if (msg.type === "CHECK_AUTH") {
    checkAuth().then(sendResponse).catch(e => sendResponse({ loggedIn: false, error: e.message }));
    return true;
  }

  if (msg.type === "CHECK_SAVED") {
    checkIfSaved(msg.doi, msg.openAlexId)
      .then(saved => sendResponse({ saved }))
      .catch(() => sendResponse({ saved: false }));
    return true;
  }

  if (msg.type === "SAVE_PAPER") {
    savePaper(msg)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "RESOLVE_DOI") {
    resolveByDoi(msg.doi)
      .then(work => sendResponse({ work }))
      .catch(() => sendResponse({ work: null }));
    return true;
  }

  if (msg.type === "DOWNLOAD_PDF") {
    downloadAndUploadPdf(msg)
      .then(result => sendResponse({ ok: true, result }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "SYNC_ANNOTATIONS") {
    syncAnnotations(msg)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.type === "OPEN_SE") {
    chrome.tabs.create({ url: `${SE_BASE}/${msg.path || ""}` });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "PAPER_DETECTED") {
    const tabId = _sender.tab?.id;
    if (tabId) {
      chrome.action.setBadgeText({ text: "1", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#2e7f9f", tabId });
    }
    sendResponse({ ok: true });
    return true;
  }

});
