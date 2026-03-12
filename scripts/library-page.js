(function(){
  if (document.body?.dataset.page !== "library") return;

  const grid = document.getElementById("libraryGrid");
  const totalCount = document.getElementById("totalCount");
  const searchBox = document.getElementById("searchBox");
  const searchBtn = document.getElementById("searchBtn");
  const tabs = Array.from(document.querySelectorAll(".tab-btn"));

  let allItems = [];
  let activeFilter = "all";

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDate(iso){
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  async function fetchLibrary(){
    try {
      const res = await fetch("/api/library", { credentials: "include" });
      if (res.status === 401) return [];
      if (!res.ok) throw new Error("Library load failed");
      return await res.json();
    } catch (e) {
      console.warn("Library load error:", e);
      return [];
    }
  }

  function applyFilters(){
    const q = (searchBox?.value || "").trim().toLowerCase();
    let items = Array.isArray(allItems) ? [...allItems] : [];

    if (activeFilter && activeFilter !== "all") {
      items = items.filter(i => Array.isArray(i.labels) && i.labels.includes(activeFilter));
    }

    if (q) {
      items = items.filter(i => String(i.title || "").toLowerCase().includes(q));
    }

    renderLibraryPapers(items);
  }

  function renderLibraryPapers(papers){
    if (!grid) return;
    if (!papers || papers.length === 0){
      grid.innerHTML = '<p class="muted">No papers in your library yet.</p>';
      return;
    }

    grid.innerHTML = papers.map(paper => {
      const labels = Array.isArray(paper.labels) ? paper.labels : [];
      const savedAt = fmtDate(paper.saved_at);
      const authors = paper.authors || "Unknown authors";
      const year = paper.year ? String(paper.year) : "";
      const metaParts = [authors, year].filter(Boolean).join(" · ");

      return `
        <article class="paper-card" style="background:#fafafa; padding:1.5rem; border-radius:10px; border:1px solid #eee; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">
          <h3 style="margin:0 0 0.5rem 0; font-size:1.1rem;">
            <a href="paper.html?id=${encodeURIComponent(paper.id)}">${escapeHtml(paper.title || "Untitled")}</a>
          </h3>
          <p class="muted" style="font-size:0.9rem; margin:0 0 0.5rem 0;">
            ${escapeHtml(metaParts || "Unknown authors")}
          </p>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.5rem;">
            ${labels.map(label => `
              <span class="badge" style="background:#ecf0f1; padding:0.2rem 0.5rem; border-radius:3px; font-size:0.8rem; border:1px solid #eee;">
                ${escapeHtml(label)}
              </span>
            `).join("")}
          </div>
          <div style="display:flex; gap:0.5rem; justify-content:space-between; align-items:center; margin-top:1rem;">
            <span class="muted" style="font-size:0.85rem;">${savedAt ? `Saved ${escapeHtml(savedAt)}` : ""}</span>
            <button class="btn btn-small remove-btn" style="background:#ecf0f1; color:#333;" data-id="${encodeURIComponent(paper.id)}">Remove</button>
          </div>
        </article>
      `;
    }).join("");

    document.querySelectorAll(".remove-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        await removePaper(id);
        await loadLibrary();
      });
    });
  }

  async function removePaper(id){
    try {
      const res = await fetch(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Remove failed");
    } catch (e) {
      console.warn("Remove failed:", e);
    }
  }

  async function loadLibrary(){
    if (grid) grid.innerHTML = '<p class="muted">Loading…</p>';
    const items = await fetchLibrary();
    allItems = Array.isArray(items) ? items : [];
    if (totalCount) totalCount.textContent = String(allItems.length || 0);
    applyFilters();
  }

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeFilter = btn.getAttribute("data-filter") || "all";
      applyFilters();
    });
  });

  searchBtn?.addEventListener("click", applyFilters);
  searchBox?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyFilters();
  });

  document.addEventListener("DOMContentLoaded", loadLibrary);
})();
