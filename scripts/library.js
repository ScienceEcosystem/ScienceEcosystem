// scripts/library.js
let SE_LIB_MAP = null; // { [paperId: string]: true }

function normalizeDoi(raw){
  if (!raw) return "";
  return String(raw)
    .trim()
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

async function seApi(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function loadLibraryOnce() {
  if (SE_LIB_MAP) return SE_LIB_MAP;
  try {
    const res = await fetch("/api/library", { credentials: "include" });
    if (res.status === 401) {
      SE_LIB_MAP = Object.create(null);
      return SE_LIB_MAP;
    }
    if (!res.ok) throw new Error("Library check failed");
    const items = await res.json();
    SE_LIB_MAP = Object.create(null);
    for (const it of items) {
      if (!it) continue;
      if (it.id) SE_LIB_MAP[String(it.id)] = true;
      if (it.openalex_id) SE_LIB_MAP[String(it.openalex_id)] = true;
      const doi = normalizeDoi(it.doi);
      if (doi) {
        SE_LIB_MAP["doi:" + doi] = true;
        SE_LIB_MAP[doi] = true;
      }
    }
  } catch (e) {
    console.warn("Library check error:", e);
    // Not signed in or server error → empty cache (don’t throw)
    SE_LIB_MAP = Object.create(null);
  }
  return SE_LIB_MAP;
}

function isSaved(id) {
  return !!(SE_LIB_MAP && SE_LIB_MAP[String(id)]);
}

function markSavedButton(btn) {
  if (!btn) return;
  btn.textContent = "Saved";
  btn.classList.add("btn-success");
  btn.disabled = true;
}

// Ensure we always attach the helpers onto SE_LIB (even if it existed already)
(globalThis.SE_LIB ??= {});
Object.assign(globalThis.SE_LIB, { loadLibraryOnce, isSaved, markSavedButton });

// After saving, sync any PDF annotations that were made before the paper was in the library
async function syncLocalAnnotationsForPaper(paperId, pdfUrl) {
  if (!paperId) return;
  // Check both possible localStorage keys (full URL or just the pdfUrl)
  const keysToTry = pdfUrl
    ? [`se_annotations_${encodeURIComponent(pdfUrl)}`]
    : [];
  // Also scan all localStorage keys for this paperId pattern
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("se_annotations_")) keysToTry.push(k);
  }
  for (const key of keysToTry) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const annots = JSON.parse(raw);
      if (!Array.isArray(annots) || !annots.length) continue;
      const inferredPdfUrl = key.replace("se_annotations_", "");
      await fetch("/api/library/pdf-annotations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paper_id: paperId,
          pdf_url: decodeURIComponent(inferredPdfUrl),
          annotations: annots
        })
      });
    } catch (_) {}
  }
}

function showSavedToast(msg = "Saved to library") {
  const el = document.createElement("div");
  el.textContent = msg;
  Object.assign(el.style, { position:"fixed", bottom:"1.25rem", right:"1.25rem", background:"#15803d", color:"#fff", padding:".6rem 1rem", borderRadius:"8px", fontSize:".9rem", zIndex:"9000", boxShadow:"0 4px 12px rgba(0,0,0,.2)", opacity:"0", transition:"opacity .2s" });
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.style.opacity="1"; });
  setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(),200); }, 2500);
}

// Global save helper that can flip the clicked button
globalThis.savePaper = async function savePaper(paper, btnEl) {
  if (!paper || !paper.id || !paper.title) {
    alert("Missing paper id/title");
    return;
  }
  try {
    await seApi("/api/library", {
      method: "POST",
      body: JSON.stringify({ id: String(paper.id), title: String(paper.title) }),
    });
    // Update local cache + UI
    (SE_LIB_MAP ??= Object.create(null));
    SE_LIB_MAP[String(paper.id)] = true;
    if (btnEl) markSavedButton(btnEl);
    showSavedToast("Saved to library");

    // Sync any PDF annotations that were made before this paper was saved
    const pdfUrl = paper.pdfUrl || null;
    syncLocalAnnotationsForPaper(String(paper.id), pdfUrl).catch(() => {});
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("Not signed in")) {
      if (confirm("Please sign in with ORCID to save. Go to login?")) {
        location.href = "/auth/orcid/login";
      }
    } else {
      alert(`Could not save: ${msg}`);
    }
  }
};
