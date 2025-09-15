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
  let currentSelection = null;    // selected paper id (OpenAlex tail)
  let openMenu = null;            // active context menu element

  // --- Bootstrap ---
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      await globalThis.SE_LIB?.loadLibraryOnce?.(); // pre-warm saved cache
    } catch {}

    await refreshCollections();
    await refreshItems();
    renderTree();
    renderTable();
    bindUI();
  });

  // --- Collections ---
  async function refreshCollections(){
    collections = await api("/api/collections");
    // Sort by name for consistent menus
    collections.sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  }

  function findChildrenMap(list){
    const byParent = new Map();
    for (const c of list) {
      const k = c.parent_id || "root";
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(c);
    }
    return byParent;
  }

  function buildMenuForCollection(c, anchorEl){
    closeAnyMenu();

    const m = document.createElement("div");
    m.className = "menu";
    m.innerHTML = `
      <button data-act="new">New subfolder</button>
      <button data-act="ren">Rename</button>
      <button data-act="move">Move…</button>
      <button data-act="del">Delete</button>
    `;
    document.body.appendChild(m);

    // Position near anchor
    const rect = anchorEl.getBoundingClientRect();
    m.style.left = `${Math.min(rect.left, window.innerWidth - m.offsetWidth - 12)}px`;
    m.style.top  = `${rect.bottom + 6}px`;

    const onClick = async (ev) => {
      const act = ev.target?.dataset?.act;
      if (!act) return;
      ev.stopPropagation();

      if (act === "new") {
        const nm = prompt("New subfolder name:");
        if (!nm) return;
        await api("/api/collections", { method:"POST", body: JSON.stringify({ name:nm, parent_id: c.id })});
        await refreshCollections();
        renderTree();
      } else if (act === "ren") {
        const nm = prompt("Rename folder:", c.name);
        if (!nm) return;
        await api(`/api/collections/${c.id}`, { method:"PATCH", body: JSON.stringify({ name:nm })});
        await refreshCollections();
        renderTree();
      } else if (act === "move") {
        const listing = collections.map(cc => `${cc.id}: ${cc.name}`).join("\n");
        const input = prompt(
          `Move folder "${c.name}" under which parent?\n\nEnter parent ID (blank for root):\n\n${listing}`
        );
        if (input === null) return;
        const parent_id = input.trim() === "" ? null : Number(input.trim());
        if (parent_id !== null && !collections.some(cc => cc.id === parent_id)) {
          alert("Invalid parent id.");
          return;
        }
        if (parent_id === c.id) { alert("Cannot move a folder under itself."); return; }
        await api(`/api/collections/${c.id}`, { method:"PATCH", body: JSON.stringify({ parent_id })});
        await refreshCollections();
        renderTree();
      } else if (act === "del") {
        if (!confirm(`Delete "${c.name}" (does not delete items)?`)) return;
        await api(`/api/collections/${c.id}`, { method:"DELETE" });
        if (currentCollectionId === c.id) currentCollectionId = null;
        await refreshCollections();
        renderTree();
      }

      closeAnyMenu();
    };

    m.addEventListener("click", onClick);
    openMenu = m;

    // Dismiss on outside click / escape
    const dismiss = (ev) => {
      if (!m.contains(ev.target)) closeAnyMenu();
    };
    const onEsc = (ev) => { if (ev.key === "Escape") closeAnyMenu(); };
    setTimeout(() => {
      document.addEventListener("click", dismiss, { once: true });
      document.addEventListener("keydown", onEsc, { once: true });
    }, 0);
  }

  function closeAnyMenu(){
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
    }
  }

  function buildTreeDom() {
    const byParent = findChildrenMap(collections);
    const ul = document.createElement("ul");
    ul.className = "tree";

    const allLi = document.createElement("li");
    if (currentCollectionId == null) allLi.classList.add("active");
    allLi.innerHTML = `
      <div class="row" data-root="1">
        <span style="width:.75rem; height:.75rem; border:1px solid var(--border,#e5e7eb); border-radius:3px; background:#f8fafc;"></span>
        <span class="name">All Items</span>
        <button class="kebab" title="Folder options" aria-haspopup="menu">···</button>
      </div>`;
    ul.appendChild(allLi);

    // Kebab for root -> create child at root
    allLi.querySelector(".kebab").addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeAnyMenu();
      const menu = document.createElement("div");
      menu.className = "menu";
      menu.innerHTML = `<button data-act="new-root">New folder</button>`;
      document.body.appendChild(menu);
      const rect = ev.currentTarget.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top  = `${rect.bottom + 6}px`;
      menu.addEventListener("click", async (e) => {
        if (e.target?.dataset?.act === "new-root") {
          const nm = prompt("New folder name:");
          if (!nm) return;
          await api("/api/collections", { method:"POST", body: JSON.stringify({ name:nm, parent_id: null })});
          await refreshCollections();
          renderTree();
          closeAnyMenu();
        }
      });
      openMenu = menu;
      setTimeout(() => document.addEventListener("click", () => closeAnyMenu(), { once: true }), 0);
    });

    allLi.addEventListener("click", () => { currentCollectionId = null; renderTree(); renderTable(); });

    function renderBranch(parentId, depth) {
      for (const c of (byParent.get(parentId) || [])) {
        const li = document.createElement("li");
        if (currentCollectionId === c.id) li.classList.add("active");
        li.innerHTML =
          `<div class="row" data-id="${String(c.id)}" style="padding-left:${Math.max(0, depth)*12 + 8}px;">
             <span style="width:.5rem; height:.5rem; border:1px solid var(--border,#e5e7eb); border-radius:50%; background:#f8fafc;"></span>
             <span class="name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
             <button class="kebab" title="Folder options" aria-haspopup="menu">···</button>
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
        if (byParent.has(c.id)) renderBranch(c.id, depth+1);
      }
    }
    renderBranch(null, 0);
    return ul;
  }

  function renderTree(){
    const host = $("#collectionsTree");
    host.innerHTML = "";
    host.appendChild(buildTreeDom());
  }

  $("#newCollectionBtn")?.addEventListener("click", async () => {
    const nm = prompt("New collection name:");
    if (!nm) return;
    await api("/api/collections", { method:"POST", body: JSON.stringify({ name:nm, parent_id: currentCollectionId })});
    await refreshCollections();
    renderTree();
  });

  // --- Items ---
  async function refreshItems(){
    // includes cached metadata (title/authors/year/venue/cited_by/pdf_url)
    items = await api("/api/library/full");
  }

  function visibleColumns() {
    const cols = new Set(["title"]); // always show title
    $$(".cols-menu input[type=checkbox]").forEach(cb => { if (cb.checked) cols.add(cb.dataset.col); });
    return cols;
  }

  function renderTable(){
    const tbody = $("#itemsTbody");
    const filterQ = ($("#libFilter")?.value || "").trim().toLowerCase();
    const cols = visibleColumns();
    const sortBy = $("#sortBy").value;
    const sortDir = $("#sortDir").value;

    // filter by collection (client-side for now)
    let view = items.filter(it => {
      const inCol = currentCollectionId == null ? true : (it.collection_ids || []).includes(currentCollectionId);
      if (!inCol) return false;
      if (!filterQ) return true;
      const hay = `${it.title} ${it.authors || ""} ${it.venue || ""}`.toLowerCase();
      return hay.includes(filterQ);
    });

    // sort
    view.sort((a,b) => {
      const A = (a[sortBy] ?? "").toString().toLowerCase();
      const B = (b[sortBy] ?? "").toString().toLowerCase();
      if (A < B) return sortDir === "asc" ? -1 : 1;
      if (A > B) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    // render
    if (!view.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted">No items</td></tr>`;
      return;
    }
    tbody.innerHTML = view.map(it => {
      const authors = cols.has("authors") ? `<td>${escapeHtml(it.authors || "—")}</td>` : "";
      const year    = cols.has("year")    ? `<td>${escapeHtml(it.year ?? "—")}</td>` : "";
      const venue   = cols.has("venue")   ? `<td>${escapeHtml(it.venue || "—")}</td>` : "";
      const cited   = cols.has("cited_by")? `<td>${escapeHtml(it.cited_by ?? "0")}</td>` : "";
      return `
        <tr data-id="${escapeHtml(it.id)}">
          <td>${escapeHtml(it.title)}</td>
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
    const item = items.find(x => String(x.id) === String(id));
    if (!item){ host.innerHTML = `<p class="muted">Not found.</p>`; return; }

    // lazy-refresh metadata from server if missing
    if (!item.meta_fresh) {
      try {
        const ref = await api(`/api/items/${encodeURIComponent(id)}/refresh`, { method:"POST" });
        Object.assign(item, ref.item);
      } catch(e) {}
    }

    const chip = (href, label, cls="badge") => href ? `<a class="${cls}" href="${href}" target="_blank" rel="noopener">${label}</a>` : "";
    const doiUrl = item.doi ? (`https://doi.org/${item.doi.replace(/^doi:/i,"")}`) : null;

    host.innerHTML = `
      <div style="padding:.75rem;">
        <h4 style="margin:0 0 .25rem 0;">${escapeHtml(item.title)}</h4>
        <p class="muted" style="margin:.25rem 0;">${escapeHtml(item.authors || "—")}</p>
        <p class="meta"><strong>${escapeHtml(item.year ?? "—")}</strong> · ${escapeHtml(item.venue || "—")}</p>
        <p class="chips" style="display:flex; gap:.5rem; flex-wrap:wrap;">
          ${chip(doiUrl, "DOI")}
          ${chip(item.openalex_url, "OpenAlex")}
          ${chip(item.pdf_url, "PDF", "badge badge-oa")}
        </p>
        <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin:.5rem 0;">
          <a class="btn btn-secondary" href="paper.html?id=${encodeURIComponent(item.openalex_id || item.id)}">Open paper page</a>
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

    // actions
    $("#addToCollectionBtn").onclick = async () => {
      const names = collections.map(c => `${c.id}: ${c.name}`).join("\n");
      const pick = prompt(`Add to which collection?\n${names}\n\nEnter ID:`);
      if (!pick) return;
      const cid = Number(pick);
      if (!collections.some(c => c.id === cid)) { alert("Invalid collection id."); return; }
      await api(`/api/collections/${cid}/items`, { method:"POST", body: JSON.stringify({ id }) });
      await refreshItems();
      renderTable();
      alert("Added.");
    };
    $("#removeFromLibraryBtn").onclick = async () => {
      if (!confirm("Remove from library (notes stay but item is removed)?")) return;
      await api(`/api/library/${encodeURIComponent(id)}`, { method:"DELETE" });
      items = items.filter(x => String(x.id) !== String(id));
      renderTable();
      $("#inspectorBody").innerHTML = `<p class="muted" style="padding:.75rem;">Select an item…</p>`;
      await globalThis.SE_LIB?.loadLibraryOnce?.(); // refresh cache for Saved ✓
    };

    // notes
    await renderNotes(id);
  }

  async function renderNotes(paperId){
    const list = $("#notesList");
    list.innerHTML = `<li class="muted" style="padding:.75rem;">Loading…</li>`;
    const notes = await api(`/api/notes?paper_id=${encodeURIComponent(paperId)}`);
    list.innerHTML = notes.length
      ? notes.map(n => `
        <li data-note="${n.id}">
          <button class="del" title="Delete note">×</button>
          <div style="white-space:pre-wrap; margin-top:.25rem;">${escapeHtml(n.text)}</div>
          <div class="muted" style="font-size:.8rem; margin-top:.25rem;">${new Date(n.created_at).toLocaleString()}</div>
        </li>
      `).join("")
      : `<li class="muted" style="padding:.75rem;">No notes yet.</li>`;

    list.onclick = async (e) => {
      const b = e.target.closest(".del");
      if (!b) return;
      const li = b.closest("li[data-note]");
      const nid = li.getAttribute("data-note");
      await api(`/api/notes/${encodeURIComponent(nid)}`, { method:"DELETE" });
      await renderNotes(paperId);
    };

    $("#addNoteBtn").onclick = async () => {
      const txt = $("#noteText").value.trim();
      if (!txt) return;
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
  }
})();
