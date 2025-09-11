// scripts/library.js
let SE_LIB_MAP = null; // { [paperId]: true }

async function loadLibraryOnce() {
  if (SE_LIB_MAP) return SE_LIB_MAP;
  try {
    const res = await fetch("/api/library", { credentials: "include" });
    if (!res.ok) throw new Error();
    const items = await res.json();
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
  btn.textContent = "Saved ✓";
  btn.classList.add("btn-success"); // optional: style.css rule
  btn.disabled = true;
}

// keep your seApi + savePaper; add a hook to update local cache & UI
async function seApi(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.headers.get("content-type")?.includes("application/json")
    ? res.json()
    : res.text();
}

window.savePaper = async function savePaper(paper, btnEl) {
  try {
    if (!paper || !paper.id || !paper.title) throw new Error("Missing id/title");
    await seApi("/api/library", {
      method: "POST",
      body: JSON.stringify({ id: String(paper.id), title: String(paper.title) }),
    });
    // update local cache + UI
    if (SE_LIB_MAP) SE_LIB_MAP[String(paper.id)] = true;
    if (btnEl) markSavedButton(btnEl);
    alert(`Saved "${paper.title}" to your library`);
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("Not signed in")) {
      if (confirm("Please sign in with ORCID to save to your library. Go to login now?")) {
        window.location.href = "/auth/orcid/login";
      }
    } else {
      alert(`Could not save: ${msg}`);
    }
  }
};

// export helpers for components.js
window.SE_LIB = { loadLibraryOnce, isSaved, markSavedButton };

