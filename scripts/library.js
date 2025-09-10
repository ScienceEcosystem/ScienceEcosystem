// scripts/library.js
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.headers.get("content-type")?.includes("application/json") ? res.json() : res.text();
}

window.savePaper = async function savePaper(paper) {
  try {
    await api("/api/library", { method: "POST", body: JSON.stringify(paper) });
    alert(`Saved "${paper.title}" to your library`);
  } catch (e) {
    if (String(e.message || "").includes("Not signed in")) {
      if (confirm("Please sign in with ORCID to save to your library. Go to login now?")) {
        window.location.href = "/auth/orcid/login";
      }
    } else {
      alert(e.message || "Failed to save");
    }
  }
};
