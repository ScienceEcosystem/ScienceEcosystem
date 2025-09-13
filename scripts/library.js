// scripts/library.js
let SE_LIB_MAP = null; // { [paperId]: true }

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
    const items = await seApi("/api/library");
    SE_LIB_MAP = Object.create(null);
    for (const it of items) SE_LIB_MAP[String(it.id)] = true;
  } catch {
    SE_LIB_MAP = Object.create(null);
  }
  return SE_LIB_MAP;
}
function isSaved(id) {
  return !!(SE_LIB_MAP && SE_LIB_MAP[String(id)]);
}
function markSavedButton(btn) {
  if (!btn) return;
  btn.textContent = "Saved ✓";
  btn.classList.add("btn-success");
  btn.disabled = true;
}

// Exposed global helpers (no window warnings)
(globalThis.SE_LIB ??= { loadLibraryOnce, isSaved, markSavedButton });

// Global save helper that can flip the clicked button
globalThis.savePaper = async function savePaper(paper, btnEl) {
  if (!paper || !paper.id || !paper.title) {
    alert("Missing paper id/title"); return;
  }
  try {
    await seApi("/api/library", {
      method: "POST",
      body: JSON.stringify({ id: String(paper.id), title: String(paper.title) }),
    });
    // cache + UI
    if (SE_LIB_MAP) SE_LIB_MAP[String(paper.id)] = true;
    if (btnEl) markSavedButton(btnEl);
    alert(`Saved "${paper.title}" to your library`);
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

