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
    // update local cache + UI
    (SE_LIB_MAP ??= Object.create(null));
    SE_LIB_MAP[String(paper.id)] = true;
    if (btnEl) markSavedButton(btnEl);
    // Non-blocking confirmation
    const saved = document.createElement("div");
    saved.textContent = `Saved to library`;
    Object.assign(saved.style, { position:"fixed", bottom:"1.25rem", right:"1.25rem", background:"#15803d", color:"#fff", padding:".6rem 1rem", borderRadius:"8px", fontSize:".9rem", zIndex:"9000", boxShadow:"0 4px 12px rgba(0,0,0,.2)", opacity:"0", transition:"opacity .2s" });
    document.body.appendChild(saved);
    requestAnimationFrame(()=>{ saved.style.opacity="1"; });
    setTimeout(()=>{ saved.style.opacity="0"; setTimeout(()=>saved.remove(),200); }, 2500);
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
