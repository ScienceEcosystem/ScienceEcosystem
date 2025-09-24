// scripts/library-page.js
(function(){
  if (document.body?.dataset.page !== "library") return;

  // --- Tiny helpers ---
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const escapeHtml = (s) => String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...opts
    });
    if (!res.ok) throw new Error(await res.text().catch(()=>res.statusText));
    const ct = res.headers.get("content-type") || "";
    return ct.includes("application/json") ? res.json() : res.text();
  }

  // --- State ---
  let collections = [];           // flat list
  let items = [];                 // library items with cached meta
  let currentCollectionId = null; // null = “All Items”
  let currentSelection = null;    // selected paper id
  let openMenu = null;            // active context menu element

  // --- Bootstrap ---
  window.addEventListener("DOMContentLoaded", async () => {
    try { if (globalThis.SE_SESSION?.syncHeader) await globalThis.SE_SESSION.syncHeader(); } catch {}

    await safeRefreshCollections();
    await safeRefreshItems();

    renderTree();
    renderTable();
    bindUI();
    setupRootKebab();
  });

  // --- Collections ---
  async function safeRefreshCollections(){
    try {
      const data = await api("/api/collections");
      collections = Array.isArray(data) ? data : (Array.isArray(data?.collections) ? data.collections : []);
      // Zotero-like: sort by name
      collections.sort((a,b) => (a?.name || "").localeCompare(b?.name || ""));
    } catch (e) {
      collections = [];
      console.error("Collections load failed:", e);
    }
  }

  function findChildrenMap(list){
    const byParent = new Map();
    for (const c of list) {
      const k = c?.parent_id == null ? "root" : String(c.parent_id);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(c);
    }
    return byParent;
  }

  function buildContextMenu(items, anchorEl){
    closeAnyMenu();
    const m = document.createElement("div");
    m.className = "context-menu";
    m.innerHTML = `<ul>${items.map(i=>`<li data-act="${i.act}">${escapeHtml(i.label)}</li>`).join("")}</ul>`;
    document.body.appendChild(m);

    const rect = anchorEl.getBoundingClientRect();
    requestAnimationFrame(() => {
      const left = Math.min(rect.left, window.innerWidth - m.offsetWidth - 12);
      m.style.left = `${left}px`;
      m.style.top  = `${rect.bottom + 6}px`;
    });

    m.addEventListener("click", (ev) => {
      const act = ev.target?.dataset?.act;
      if (!act) return;
      items.find(i => i.act === act)?.onClick?.();
      closeAnyMenu();
    });

    const dismiss = (ev) => { if (!m.contains(ev.target)) closeAnyMenu(); };
    const onEsc   = (ev) => { if (ev.key === "Escape") closeAnyMenu(); };
    setTimeout(() => {
      document.addEventListener("click", dismiss, { once: true });
      document.addEventListener("keydown", onEsc, { once: true });
    }, 0);

    openMenu = m;
  }

  function closeAnyMenu(){
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }

  function buildMenuForCollection(c, anchorEl){
    const items = [
      { act:"new",  label:"New subcollection", onClick: async () => {
          const nm = prompt("New subcollection name:"); if (!nm) return;
          await api("/api/collections", { method:"POST", body: JSON.stringify({ name:nm, parent_id: c.id })});
          await safeRefreshCollections(); renderTree();
        }},
      { act:"ren",  label:"Rename", onClick: async () => {
          const nm = prompt("Rename collection:", c.name); if (!nm) return;
          await api(`/api/collections/${c.id}`, { method:"PATCH", body: JSON.stringify({ name:nm })});
          await safeRefreshCollections(); renderTree();
        }},
      { act:"move", label:"Move…", onClick: async () => {
          const listing = collections.map(cc => `${cc.id}: ${cc.name}`).join("\n");
          const input = prompt(`Move "${c.name}" under which parent?\n\nEnter parent ID (blank for root):\n\n${listing}`);
          if (input === null) return;
          const parent_id = input.trim() === "" ? null : Number(input.trim());
          if (parent_id !== null && !collections.some(cc => cc.id === parent_id)) { alert("Invalid parent id."); return; }
          if (parent_id === c.id) { alert("Cannot move a collection under itself."); return; }
          await api(`/api/collections/${c.id}`, { method:"PATCH", body: JSON.stringify({ parent_id })});
          await safeRefreshCollections(); renderTree();
        }},
      { act:"del",  label:"Delete collection", onClick: async () => {
          if (!confirm(`Delete "${c.name}" (items stay in library)?`)) return;
          await api(`/api/collections/${c.id}`, { method:"DELETE" });
          if (currentCollectionId === c.id) currentCollectionId = null;
          await safeRefreshCollections(); renderTree(); renderTable();
        }},
    ];
    buildContextMenu(items, anchorEl);
  }

  function setupRootKebab(){
    const rootKebab = $("#rootKebab");
    if (!rootKebab) return;
    rootKebab.addEventListener("click", (ev) => {
      ev.stopPropagation();
      buildContextMenu([
        { act:"new-root", label:"New collection", onClick: async () => {
            const nm = prompt("New collection name:"); if (!nm) return;
            await api("/api/collections", { method:"POST", body: JSON.stringify({ name:nm, parent_id: null })});
            await safeRefreshCollections(); renderTree();
          }},
      ], rootKebab);
    });
  }

  function buildTreeDom() {
    const byParent = findChildrenMap(collections);
    const ul = document.createElement("ul");
    ul.className = "tree";

    // Root "All Items"
    const allLi = document.createElement("li");
    if (currentCollectionId == null) allLi.classList.add("active");
    allLi.innerHTML = `
      <div class="row" data-root="1">
        <span style="width:.75rem; height:.75rem; border:1px solid var(--border,#e5e7eb); border-radius:3px; background:#f8fafc;"></span>
        <span class="name">All Items</span>
        <button class="kebab" title="Options" aria-haspopup="menu">···</button>
      </div>`;
    ul.appendChild(allLi);

    allLi.querySelector(".kebab").addEventListener("click", (ev) => {
      ev.stopPropagation();
      buildContextMenu([
        { act:"new-root", label:"New collection", onClick: async () => {
            const nm = prompt("New collection name:"); if (!nm) return;
            await api("/api/collections", { method:"POST", body: JSON.stringify({ name:nm, parent_id: null })});
            await safeRefreshCollections(); renderTree();
          }},
      ], ev.currentTarget);
    });

    allLi.addEventListener("click", () => { currentCollectionId = null; renderTree(); renderTable(); });

    // Collections recursive
    (function renderBranch(parentKey, depth){
      const children = byParent.get(parentKey) || [];
      for (const c of children) {
        const li = document.createElement("li");
        if (currentCollectionId === c.id) li.classList.add("active");
        li.innerHTML =
          `<div class="row" data-id="${String(c.id)}" style="padding-left:${Math.max(0, depth)*12 + 8}px;">
             <span style="width:.5rem; height:.5rem; border:1px solid var(--border,#e5e7eb); border-radius:50%; background:#f8fafc;"></span>
             <span class="name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
             <button class="kebab" title="Collection options" aria-haspopup="menu">···</button>
           </div>`;

        const row = li.querySelector(".row");
        const kebab = li.querySelector(".kebab");

        row.addEventListener("click", (ev) => {
          if (ev.target.closest(".kebab")) return;
          currentCollectionId = c.id;
          renderTree(); renderTable();
        });

        kebab.addEventListener("click", (ev) => {
          ev.stopPropagation();
          buildMenuForCollection(c, kebab);
        });

        ul.appendChild(li);
        renderBranch(String(c.id), depth+1);
      }
    })("root", 0);

    return ul;
  }

  function renderTree(){
    const host = $("#collectionsTree");
    host.innerHTML = "";
    host.appendChild(buildTreeDom());
  }

  // New collection buttons
  function bindNewCollectionButtons(){
    const createAtCurrent = async () => {
      const nm = prompt("New collection name:"); if (!nm) return;
      await api("/api/collections", { method:"POST", body: JSON.stringify({ name:nm, parent_id: currentCollectionId })});
      await safeRefreshCollections();
      renderTree();
    };
    $("#newCollectionBtn")?.addEventListener("click", createAtCurrent);
    $("#newCollectionBtnLeft")?.addEventListener("click", createAtCurrent);
  }

  // --- Items ---
  async function safeRefreshItems(){
    try {
      const data = await api("/api/library/full");
      // Accept either plain array or an object wrapper
      items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      items = [];
      console.error("Items load failed:", e);
      // Show an inline error instead of hanging on "Loading…"
      const tbody = $("#itemsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">Could not load items.</td></tr>`;
    }
  }

  function visibleColumns() {
    const cols = new Set(["title"]); // always show title
    $$(".cols-menu input[type=checkbox]").forEach(cb => { if (cb.checked) cols.add(cb.dataset.col); });
    return cols;
  }

  function renderTable(){
    const tbody = $("#itemsTbody");
    if (!tbody) return;

    const filterQ = ($("#libFilter")?.value || "").trim().toLowerCase();
    const cols = visibleColumns();
    const sortBy = $("#sortBy")?.value || "title";
    const sortDir = $("#sortDir")?.value || "asc";

    let view = items.filter(it => {
      const inCol = currentCollectionId == null ? true : (it.collection_ids || []).includes(currentCollectionId);
      if (!inCol) return false;
      if (!filterQ) return true;
      const hay = `${it.title||""} ${it.authors||""} ${it.venue||""}`.toLowerCase();
      return hay.includes(filterQ);
    });

    view.sort((a,b) => {
      const A = (a?.[sortBy] ?? "").toString().toLowerCase();
      const B = (b?.[sortBy] ?? "").toString().toLowerCase();
      if (A < B) return sortDir === "asc" ? -1 : 1;
      if (A > B) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    if (!view.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted">${items.length ? "No items" : "No items yet"}</td></tr>`;
      return;
    }

    tbody.innerHTML = view.map(it => {
      const authors = cols.has("authors") ? `<td>${escapeHtml(it.authors || "—")}</td>` : "";
      const year    = cols.has("year")    ? `<td>${escapeHtml(it.year ?? "—")}</td>` : "";
      const venue   = cols.has("venue")   ? `<td>${escapeHtml(it.venue || "—")}</td>` : "";
      const cited   = cols.has("cited_by")? `<td>${escapeHtml(it.cited_by ?? "0")}</td>` : "";
      return `
        <tr data-id="${escapeHtml(it.id ?? it.openalex_id ?? "")}">
          <td>${escapeHtml(it.title || "—")}</td>
          ${authors}${year}${venue}${cited}
        </tr>
      `;
    }).join("");

    // row click -> select
    $$("#itemsTbody tr").forEach(tr => {
      tr.onclick = async () => {
        const id = tr.getAttribute("data-id");
        currentSelection = id;
        await renderInspector(id);
      };
    });
  }

  // Filter and sort controls
  $("#libFilter")?.addEventListener("input", renderTable);
  $("#sortBy")?.addEventListener("change", renderTable);
  $("#sortDir")?.addEventListener("change", renderTable);
  $$(".cols-menu input[type=checkbox]").forEach(cb => cb.addEventListener("change", renderTable));

  // --- Inspector & Notes ---
  async function renderInspector(id){
    const host = $("#inspectorBody");
    const item = items.find(x => String(x.id ?? x.openalex_id) === String(id));
    if (!item){ host.innerHTML = `<p class="muted">Not found.</p>`; return; }

    // lazy-refresh metadata from server if missing
    if (!item.meta_fresh) {
      try {
        const ref = await api(`/api/items/${encodeURIComponent(id)}/refresh`, { method:"POST" });
        if (ref?.item) Object.assign(item, ref.item);
      } catch(e) {}
    }

    const chip = (href, label, cls="badge") => href ? `<a class="${cls}" href="${href}" target="_blank" rel="noopener">${label}</a>` : "";
    const doiUrl = item.doi ? (`https://doi.org/${item.doi.replace(/^doi:/i,"")}`) : null;

    host.innerHTML = `
      <div style="padding:.75rem;">
        <h4 style="margin:0 0 .25rem 0;">${escapeHtml(item.title || "—")}</h4>
        <p class="muted" style="margin:.25rem 0;">${escapeHtml(item.authors || "—")}</p>
        <p class="meta"><strong>${escapeHtml(item.year ?? "—")}</strong> · ${escapeHtml(item.venue || "—")}</p>
        <p class="chips" style="display:flex; gap:.5rem; flex-wrap:wrap;">
          ${chip(doiUrl, "DOI")}
          ${chip(item.openalex_url, "OpenAlex")}
          ${chip(item.pdf_url, "PDF", "badge badge-oa")}
        </p>
        <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin:.5rem 0;">
          <a class="btn btn-secondary" href="paper.html?id=${encodeURIComponent(item.openalex_id || item.id || "")}">Open paper page</a>
          ${item.pdf_url ? `<a class="btn btn-secondary" href="${item.pdf_url}" target="_blank" rel="noopener">Open PDF</a>` : ""}
          <button class="btn btn-secondary" id="addToCollectionBtn">Add to collection…</button>
          <button class="btn btn-secondary" id="removeFromLibraryBtn">Remove from library</button>
        </div>
        <div class="panel" style="padding:.5rem; margin-top:.5rem;">
          <strong>Abstract</strong>
          <p style="margin:.25rem 0;">${escapeHtml(item.abstract || "—")}</p>
        </div>
      </div>
    `;

    $("#addToCollectionBtn").onclick = async () => {
      const names = collections.map(c => `${c.id}: ${c.name}`).join("\n");
      const pick = prompt(`Add to which collection?\n${names}\n\nEnter ID:`); if (!pick) return;
      const cid = Number(pick);
      if (!collections.some(c => c.id === cid)) { alert("Invalid collection id."); return; }
      await api(`/api/collections/${cid}/items`, { method:"POST", body: JSON.stringify({ id: id }) });
      await safeRefreshItems();
      renderTable();
      alert("Added.");
    };

    $("#removeFromLibraryBtn").onclick = async () => {
      if (!confirm("Remove from library (notes stay but item is removed)?")) return;
      await api(`/api/library/${encodeURIComponent(id)}`, { method:"DELETE" });
      items = items.filter(x => String(x.id ?? x.openalex_id) !== String(id));
      renderTable();
      $("#inspectorBody").innerHTML = `<p class="muted" style="padding:.75rem;">Select an item…</p>`;
      try { await globalThis.SE_LIB?.loadLibraryOnce?.(); } catch {}
    };

    await renderNotes(id);
  }

  async function renderNotes(paperId){
    const list = $("#notesList");
    list.innerHTML = `<li class="muted" style="padding:.75rem;">Loading…</li>`;
    try {
      const notes = await api(`/api/notes?paper_id=${encodeURIComponent(paperId)}`);
      list.innerHTML = (Array.isArray(notes) && notes.length)
        ? notes.map(n => `
          <li data-note="${n.id}">
            <button class="del" title="Delete note">×</button>
            <div style="white-space:pre-wrap; margin-top:.25rem;">${escapeHtml(n.text)}</div>
            <div class="muted" style="font-size:.8rem; margin-top:.25rem;">${new Date(n.created_at).toLocaleString()}</div>
          </li>
        `).join("")
        : `<li class="muted" style="padding:.75rem;">No notes yet.</li>`;
    } catch (e) {
      list.innerHTML = `<li class="muted" style="padding:.75rem;">Could not load notes.</li>`;
    }

    list.onclick = async (e) => {
      const b = e.target.closest(".del");
      if (!b) return;
      const li = b.closest("li[data-note]");
      const nid = li.getAttribute("data-note");
      await api(`/api/notes/${encodeURIComponent(nid)}`, { method:"DELETE" });
      await renderNotes(paperId);
    };

    $("#addNoteBtn").onclick = async () => {
      const txt = $("#noteText").value.trim(); if (!txt) return;
      await api("/api/notes", { method:"POST", body: JSON.stringify({ paper_id: paperId, text: txt }) });
      $("#noteText").value = "";
      await renderNotes(paperId);
    };
  }

  function bindUI(){
    // Persist user-resized sidebars as CSS vars (optional; improves UX)
    const grid = $(".lib-grid");
    const observer = new ResizeObserver(() => {
      const leftW  = $(".lib-left")?.getBoundingClientRect().width;
      const rightW = $(".lib-right")?.getBoundingClientRect().width;
      if (leftW)  grid.style.setProperty("--left-col",  `${Math.round(leftW)}px`);
      if (rightW) grid.style.setProperty("--right-col", `${Math.round(rightW)}px`);
    });
    if ($(".lib-left"))  observer.observe($(".lib-left"));
    if ($(".lib-right")) observer.observe($(".lib-right"));

    bindNewCollectionButtons();
  }
})();
