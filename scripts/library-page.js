(function(){
  if (document.body?.dataset.page !== "library") return;

  // Helpers
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=(s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  async function api(path, opts={}){
    const res = await fetch(path,{ credentials:"include", headers:{ "Content-Type":"application/json" }, ...opts });
    if(!res.ok) throw new Error(await res.text().catch(()=>res.statusText));
    const ct=res.headers.get("content-type")||"";
    return ct.includes("application/json")?res.json():res.text();
  }

  // State
  let collections=[];    // {id,name,parent_id,deleted_at?}
  let items=[];          // {id,title,authors,year,venue,cited_by,tags?,doi?,deleted_at?,collection_ids?}
  let currentCollectionId=null; // null = All Items; special: "__duplicates__", "__trash__"
  let currentSelection=null;
  let openMenu=null;
  let tagFilterTerms=[];

  // Bootstrap
  window.addEventListener("DOMContentLoaded", async()=>{
    try{ if(globalThis.SE_SESSION?.syncHeader) await globalThis.SE_SESSION.syncHeader(); }catch{}
    await refreshEverything();
    bindUI();
  });

  async function refreshEverything(){
    await Promise.all([safeRefreshCollections(), safeRefreshItems()]);
    renderTree();
    renderTable();
  }

  // ---- Collections ----
  async function safeRefreshCollections(){
    try{
      const data = await api("/api/collections");
      collections = Array.isArray(data)?data:(Array.isArray(data?.collections)?data.collections:[]);
      collections.sort((a,b)=>(a?.name||"").localeCompare(b?.name||""));
    }catch(e){ collections=[]; console.error("collections load failed",e); }
  }
  function byParentMap(list){
    const m=new Map();
    for(const c of list){
      const k = c?.parent_id==null?"root":String(c.parent_id);
      if(!m.has(k)) m.set(k,[]);
      m.get(k).push(c);
    }
    return m;
  }

  function buildContextMenu(defs, anchorEl){
    closeAnyMenu();
    const m=document.createElement("div");
    m.className="context-menu";
    m.innerHTML=`<ul>${defs.map(d=>`<li data-act="${d.act}">${esc(d.label)}</li>`).join("")}</ul>`;
    document.body.appendChild(m);
    const rect=anchorEl.getBoundingClientRect();
    requestAnimationFrame(()=>{
      m.style.left=`${Math.min(rect.left, window.innerWidth - m.offsetWidth - 12)}px`;
      m.style.top =`${rect.bottom+6}px`;
    });
    m.addEventListener("click",ev=>{
      const act=ev.target?.dataset?.act; if(!act) return;
      defs.find(d=>d.act===act)?.onClick?.();
      closeAnyMenu();
    });
    setTimeout(()=>{
      const onDoc=(ev)=>{ if(!m.contains(ev.target)) closeAnyMenu(); };
      const onEsc =(ev)=>{ if(ev.key==="Escape") closeAnyMenu(); };
      document.addEventListener("click",onDoc,{once:true});
      document.addEventListener("keydown",onEsc,{once:true});
    },0);
    openMenu=m;
  }
  function closeAnyMenu(){ if(openMenu){ openMenu.remove(); openMenu=null; } }

  function buildMenuForCollection(c, anchorEl){
    const defs=[
      {act:"new",label:"New subcollection",onClick: async()=>{
        const nm=prompt("New subcollection name:"); if(!nm) return;
        await api("/api/collections",{method:"POST",body:JSON.stringify({name:nm,parent_id:c.id})});
        await safeRefreshCollections(); renderTree();
      }},
      {act:"ren",label:"Rename",onClick: async()=>{
        const nm=prompt("Rename collection:",c.name); if(!nm) return;
        await api(`/api/collections/${c.id}`,{method:"PATCH",body:JSON.stringify({name:nm})});
        await safeRefreshCollections(); renderTree();
      }},
      {act:"move",label:"Move…",onClick: async()=>{
        const listing=collections.map(cc=>`${cc.id}: ${cc.name}`).join("\n");
        const input=prompt(`Move "${c.name}" under which parent?\n\nEnter parent ID (blank for root):\n\n${listing}`);
        if(input===null) return;
        const parent_id=input.trim()===""?null:Number(input.trim());
        if(parent_id!==null && !collections.some(cc=>cc.id===parent_id)) return alert("Invalid parent id.");
        if(parent_id===c.id) return alert("Cannot move under itself.");
        await api(`/api/collections/${c.id}`,{method:"PATCH",body:JSON.stringify({parent_id})});
        await safeRefreshCollections(); renderTree();
      }},
      {act:"trash",label:"Move to Trash",onClick: async()=>{
        // Soft delete collection
        try{
          await api(`/api/trash/collections`,{method:"POST",body:JSON.stringify({id:c.id})});
        }catch{ // fallback: mark deleted via PATCH if your API supports; otherwise delete (last resort)
          try{ await api(`/api/collections/${c.id}`,{method:"PATCH",body:JSON.stringify({deleted_at:new Date().toISOString()})}); }catch{}
        }
        if(currentCollectionId===c.id) currentCollectionId=null;
        await safeRefreshCollections(); renderTree(); renderTable();
      }},
    ];
    buildContextMenu(defs, anchorEl);
  }

  function setupRootKebab(){
    const root=$("#rootKebab"); if(!root) return;
    root.addEventListener("click",(ev)=>{
      ev.stopPropagation();
      buildContextMenu([
        {act:"new-root",label:"New collection",onClick: async()=>{
          const nm=prompt("New collection name:"); if(!nm) return;
          await api("/api/collections",{method:"POST",body:JSON.stringify({name:nm,parent_id:null})});
          await safeRefreshCollections(); renderTree();
        }},
        {act:"empty-trash",label:"Empty Trash",onClick: async()=>{
          if(!confirm("Permanently delete all items & collections in Trash?")) return;
          try{ await api("/api/trash/empty",{method:"POST"}); }catch{}
          await refreshEverything();
        }},
      ], root);
    });
  }

  function buildTreeDom(){
    const m = byParentMap(collections.filter(c=>!c.deleted_at)); // hide trashed from normal list
    const ul=document.createElement("ul"); ul.className="tree";

    // Virtual sections: Duplicates + Trash
    const virtDup=document.createElement("div");
    virtDup.className="virtual-h"; virtDup.textContent="Virtual";
    ul.appendChild(virtDup);

    const dupLi=document.createElement("li");
    if(currentCollectionId==="__duplicates__") dupLi.classList.add("active");
    dupLi.innerHTML=`<div class="row" data-virt="dup">
      <span style="width:.6rem;height:.6rem;border:1px solid #e5e7eb;border-radius:50%;background:#fff"></span>
      <span class="name">Duplicates</span>
      <button class="kebab" title="Options" aria-haspopup="menu">···</button>
    </div>`;
    dupLi.querySelector(".row").addEventListener("click",()=>{ currentCollectionId="__duplicates__"; renderTree(); renderTable(); });
    ul.appendChild(dupLi);

    const trashLi=document.createElement("li");
    if(currentCollectionId==="__trash__") trashLi.classList.add("active");
    trashLi.innerHTML=`<div class="row" data-virt="trash">
      <span style="width:.6rem;height:.6rem;border:1px solid #e5e7eb;border-radius:50%;background:#fff"></span>
      <span class="name">Trash</span>
      <button class="kebab" title="Trash options" aria-haspopup="menu">···</button>
    </div>`;
    trashLi.querySelector(".row").addEventListener("click",()=>{ currentCollectionId="__trash__"; renderTree(); renderTable(); });
    trashLi.querySelector(".kebab").addEventListener("click",(ev)=>{
      ev.stopPropagation();
      buildContextMenu([
        {act:"restore-all",label:"Restore all",onClick: async()=>{
          try{ await api("/api/trash/restore",{method:"POST",body:JSON.stringify({scope:"all"})}); }catch{}
          await refreshEverything();
        }},
        {act:"empty",label:"Empty Trash",onClick: async()=>{
          if(!confirm("Permanently delete everything in Trash?")) return;
          try{ await api("/api/trash/empty",{method:"POST"}); }catch{}
          await refreshEverything();
        }},
      ], ev.currentTarget);
    });
    ul.appendChild(trashLi);

    // Root: All Items
    const allLi=document.createElement("li");
    if(currentCollectionId==null) allLi.classList.add("active");
    allLi.innerHTML=`<div class="row" data-root="1">
      <span style="width:.75rem;height:.75rem;border:1px solid #e5e7eb;border-radius:3px;background:#f8fafc"></span>
      <span class="name">All Items</span>
      <button class="kebab" title="Options" aria-haspopup="menu">···</button>
    </div>`;
    allLi.querySelector(".row").addEventListener("click",()=>{ currentCollectionId=null; renderTree(); renderTable(); });
    allLi.querySelector(".kebab").addEventListener("click",(ev)=>{
      ev.stopPropagation();
      buildContextMenu([
        {act:"new-root",label:"New collection",onClick: async()=>{
          const nm=prompt("New collection name:"); if(!nm) return;
          await api("/api/collections",{method:"POST",body:JSON.stringify({name:nm,parent_id:null})});
          await safeRefreshCollections(); renderTree();
        }},
      ], ev.currentTarget);
    });
    ul.appendChild(allLi);

    // Actual collections
    (function renderBranch(parentKey, depth){
      for(const c of (m.get(parentKey)||[])){
        const li=document.createElement("li");
        if(currentCollectionId===c.id) li.classList.add("active");
        li.innerHTML=`<div class="row" data-id="${String(c.id)}" style="padding-left:${Math.max(0,depth)*12+8}px;">
          <span style="width:.5rem;height:.5rem;border:1px solid #e5e7eb;border-radius:50%;background:#f8fafc"></span>
          <span class="name" title="${esc(c.name)}">${esc(c.name)}</span>
          <button class="kebab" title="Collection options" aria-haspopup="menu">···</button>
        </div>`;
        const row=li.querySelector(".row");
        const keb=li.querySelector(".kebab");
        row.addEventListener("click",(ev)=>{ if(ev.target.closest(".kebab")) return; currentCollectionId=c.id; renderTree(); renderTable(); });
        keb.addEventListener("click",(ev)=>{ ev.stopPropagation(); buildMenuForCollection(c,keb); });
        ul.appendChild(li);
        renderBranch(String(c.id), depth+1);
      }
    })("root",0);

    return ul;
  }

  function renderTree(){
    const host=$("#collectionsTree");
    host.innerHTML="";
    host.appendChild(buildTreeDom());
    setupRootKebab();
  }

  // new buttons (header + sidebar)
  function bindNewCollectionButtons(){
    const act=async()=>{
      const nm=prompt("New collection name:"); if(!nm) return;
      await api("/api/collections",{method:"POST",body:JSON.stringify({name:nm,parent_id:currentCollectionId && currentCollectionId!=="__trash__" && currentCollectionId!=="__duplicates__" ? currentCollectionId : null})});
      await safeRefreshCollections(); renderTree();
    };
    $("#newCollectionBtn")?.addEventListener("click",act);
    $("#newCollectionBtnLeft")?.addEventListener("click",act);
  }

  // ---- Items & virtual views ----
  async function safeRefreshItems(){
    try{
      const data=await api("/api/library/full");
      items = Array.isArray(data)?data:(Array.isArray(data?.items)?data.items:[]);
    }catch(e){
      items=[]; console.error("items load failed",e);
      const tbody=$("#itemsTbody"); if(tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted">Could not load items.</td></tr>`;
    }
  }

  function visibleColumns(){
    const cols=new Set(["title"]);
    $$(".cols-menu input[type=checkbox]").forEach(cb=>{ if(cb.checked) cols.add(cb.dataset.col); });
    return cols;
  }

  function normTitle(s){ return (s||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim(); }
  function tokenSet(str){ return new Set(normTitle(str).split(" ").filter(Boolean)); }
  function jaccard(a,b){
    const A=tokenSet(a), B=tokenSet(b);
    if(!A.size || !B.size) return 0;
    let inter=0; for(const t of A) if(B.has(t)) inter++;
    return inter / (A.size + B.size - inter);
  }

  function computeDuplicates(list){
    // Heuristics: same DOI OR (same year and title tokens Jaccard >= 0.9)
    const byDoi=new Map();
    const dupGroups=[];
    const visited=new Set();

    list.forEach(it=>{
      const doi=(it.doi||"").trim().toLowerCase();
      if(doi){ if(!byDoi.has(doi)) byDoi.set(doi,[]); byDoi.get(doi).push(it); }
    });
    for(const arr of byDoi.values()) if(arr.length>1) dupGroups.push(arr);

    // Title+Year heuristic
    const byYear=list.reduce((m,it)=>{ const y=it.year??"unknown"; (m[y]??=[]).push(it); return m; },{});
    for(const [y,arr] of Object.entries(byYear)){
      for(let i=0;i<arr.length;i++){
        for(let j=i+1;j<arr.length;j++){
          const A=arr[i], B=arr[j];
          if((A.doi&&B.doi)&&A.doi===B.doi) continue; // already grouped
          if(jaccard(A.title,B.title)>=0.9){
            const keyA=A.id, keyB=B.id;
            if(!visited.has(keyA)||!visited.has(keyB)){
              dupGroups.push([A,B]);
              visited.add(keyA); visited.add(keyB);
            }
          }
        }
      }
    }
    // Flatten set of duplicate ids
    const dupIds=new Set(); dupGroups.forEach(g=>g.forEach(x=>dupIds.add(x.id)));
    return { dupGroups, dupIds };
  }

  function getTrashViews(){
    const trashedItems = items.filter(it=>it.deleted_at);
    return { trashedItems };
  }

  function currentViewItems(){
    if(currentCollectionId==="__duplicates__"){
      const {dupIds}=computeDuplicates(items.filter(it=>!it.deleted_at));
      return items.filter(it=>dupIds.has(it.id));
    }
    if(currentCollectionId==="__trash__"){
      const {trashedItems}=getTrashViews();
      return trashedItems;
    }
    // normal: filter by collection + not deleted
    return items.filter(it=>{
      const notDeleted=!it.deleted_at;
      if(!notDeleted) return false;
      if(currentCollectionId==null) return true;
      return (it.collection_ids||[]).includes(currentCollectionId);
    });
  }

  function applyFilters(list){
    const q=($("#libFilter")?.value||"").trim().toLowerCase();
    const tags=tagFilterTerms;
    return list.filter(it=>{
      const matchesQ = !q || `${it.title} ${it.authors||""} ${it.venue||""}`.toLowerCase().includes(q);
      const hasTags = !tags.length || (Array.isArray(it.tags) && tags.every(t=>it.tags.map(s=>s.toLowerCase()).includes(t)));
      return matchesQ && hasTags;
    });
  }

  function renderTable(){
    const tbody=$("#itemsTbody"); if(!tbody) return;
    const cols=visibleColumns();
    const sortBy=$("#sortBy")?.value||"title";
    const sortDir=$("#sortDir")?.value||"asc";

    let view=applyFilters(currentViewItems());

    view.sort((a,b)=>{
      const A=(a?.[sortBy]??"").toString().toLowerCase();
      const B=(b?.[sortBy]??"").toString().toLowerCase();
      if(A<B) return sortDir==="asc"?-1:1;
      if(A>B) return sortDir==="asc"? 1:-1;
      return 0;
    });

    if(!view.length){ tbody.innerHTML=`<tr><td colspan="5" class="muted">No items</td></tr>`; return; }

    tbody.innerHTML=view.map(it=>{
      const tagsHtml = Array.isArray(it.tags)&&it.tags.length
        ? `<div>${it.tags.map(t=>`<span class="tag-chip">${esc(t)}</span>`).join("")}</div>` : "";
      const authors = cols.has("authors")?`<td>${esc(it.authors||"—")}${tagsHtml}</td>`:"";
      const year    = cols.has("year")   ?`<td>${esc(it.year??"—")}</td>`:"";
      return `<tr data-id="${esc(it.id)}">
        <td>${esc(it.title||"—")}</td>
        ${authors}${year}
      </tr>`;
    }).join("");

    // row click -> select
    $$("#itemsTbody tr").forEach(tr=>{
      tr.onclick=async()=>{
        currentSelection = tr.getAttribute("data-id");
        await renderInspector(currentSelection);
      };
    });
  }

  // Filters + controls
  $("#libFilter")?.addEventListener("input", renderTable);
  $("#sortBy")?.addEventListener("change", renderTable);
  $("#sortDir")?.addEventListener("change", renderTable);
  $$(".cols-menu input[type=checkbox]").forEach(cb=>cb.addEventListener("change", renderTable));
  $("#tagFilter")?.addEventListener("input", ()=>{
    tagFilterTerms = ($("#tagFilter").value||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    renderTable();
  });

  // ---- Inspector (& Related) ----
  async function renderInspector(id){
    const host=$("#inspectorBody");
    const item=items.find(x=>String(x.id)===String(id));
    if(!item){ host.innerHTML=`<p class="muted">Not found.</p>`; return; }

    // refresh metadata (best-effort)
    if(!item.meta_fresh){
      try{ const ref=await api(`/api/items/${encodeURIComponent(id)}/refresh`,{method:"POST"}); Object.assign(item, ref.item); }catch{}
    }

    const chip=(href,label,cls="badge")=>href?`<a class="${cls}" href="${href}" target="_blank" rel="noopener">${label}</a>`:"";
    const doiUrl = item.doi ? (`https://doi.org/${item.doi.replace(/^doi:/i,"")}`) : null;

    host.innerHTML = `
      <div>
        <div style="padding:.75rem 1rem;">
          <h4 style="margin:0 0 .25rem 0;">${esc(item.title)}</h4>
          <p class="muted" style="margin:.25rem 0;">${esc(item.authors||"—")}</p>
          <p class="meta"><strong>${esc(item.year??"—")}</strong> · ${esc(item.venue||"—")}</p>
          <p style="display:flex;gap:.5rem;flex-wrap:wrap;">
            ${chip(doiUrl,"DOI")}
            ${chip(item.openalex_url,"OpenAlex")}
            ${chip(item.pdf_url,"PDF","badge badge-oa")}
          </p>
          <div style="display:flex; gap:.5rem; flex-wrap:wrap; margin:.5rem 0;">
            <a class="btn btn-secondary" href="paper.html?id=${encodeURIComponent(item.openalex_id||item.id||"")}">Open paper page</a>
            ${item.pdf_url?`<a class="btn btn-secondary" href="${item.pdf_url}" target="_blank" rel="noopener">Open PDF</a>`:""}
            <button class="btn btn-secondary" id="addToCollectionBtn">Add to collection…</button>
            ${!item.deleted_at?`<button class="btn btn-secondary" id="trashItemBtn">Move to Trash</button>`:`<button class="btn btn-secondary" id="restoreItemBtn">Restore</button>`}
            ${item.deleted_at?`<button class="btn btn-secondary" id="deleteForeverBtn">Delete permanently</button>`:""}
          </div>
          <div class="panel" style="padding:.5rem; margin-top:.5rem;">
            <strong>Abstract</strong>
            <p style="margin:.25rem 0;">${esc(item.abstract||"—")}</p>
          </div>
          ${Array.isArray(item.tags)&&item.tags.length?`
            <div class="panel" style="padding:.5rem; margin-top:.5rem;">
              <strong>Tags</strong>
              <p>${item.tags.map(t=>`<span class="tag-chip">${esc(t)}</span>`).join(" ")}</p>
            </div>`:""}
        </div>
      </div>
    `;

    // Add to collection
    $("#addToCollectionBtn").onclick=async()=>{
      const names=collections.filter(c=>!c.deleted_at).map(c=>`${c.id}: ${c.name}`).join("\n");
      const pick=prompt(`Add to which collection?\n${names}\n\nEnter ID:`); if(!pick) return;
      const cid=Number(pick);
      if(!collections.some(c=>c.id===cid)) return alert("Invalid collection id.");
      await api(`/api/collections/${cid}/items`,{method:"POST",body:JSON.stringify({id})});
      await safeRefreshItems(); renderTable(); alert("Added.");
    };

    // Trash / Restore / Delete forever
    $("#trashItemBtn")?.addEventListener("click", async()=>{
      try{ await api(`/api/trash/items`,{method:"POST",body:JSON.stringify({id})}); }
      catch{ try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({deleted_at:new Date().toISOString()})}); }catch{} }
      await safeRefreshItems(); renderTable(); await renderInspector(id);
    });
    $("#restoreItemBtn")?.addEventListener("click", async()=>{
      try{ await api(`/api/trash/restore`,{method:"POST",body:JSON.stringify({type:"item",id})}); }
      catch{ try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({deleted_at:null})}); }catch{} }
      await safeRefreshItems(); renderTable(); await renderInspector(id);
    });
    $("#deleteForeverBtn")?.addEventListener("click", async()=>{
      if(!confirm("Permanently delete this item?")) return;
      try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"DELETE"}); }
      catch{ try{ await api(`/api/trash/items`,{method:"DELETE",body:JSON.stringify({id})}); }catch{} }
      items = items.filter(x=>String(x.id)!==String(id));
      renderTable(); $("#inspectorBody").innerHTML=`<p class="muted" style="padding:.75rem;">Select an item…</p>`;
    });

    // Related section
    await renderRelated(id);
    // Notes
    await renderNotes(id);
  }

  // ---- Related items ----
  async function renderRelated(itemId){
    const ul=$("#relatedList");
    ul.innerHTML=`<li class="muted">Loading…</li>`;
    let related=[];
    try{
      const data = await api(`/api/related?item_id=${encodeURIComponent(itemId)}`);
      related = Array.isArray(data)?data:(Array.isArray(data?.items)?data.items:[]);
    }catch{ related=[]; }
    ul.innerHTML = related.length
      ? related.map(r=>`<li><a href="#" data-open="${esc(r.id)}">${esc(r.title||r.id)}</a> <span class="muted">· ${esc(r.year??"")}</span></li>`).join("")
      : `<li class="muted">No related items yet.</li>`;

    ul.onclick=(e)=>{
      const a=e.target.closest("a[data-open]"); if(!a) return;
      e.preventDefault(); const id=a.getAttribute("data-open"); renderInspector(id);
    };

    $("#addRelatedBtn").onclick=async()=>{
      const pick=prompt("Enter the ID of the item to relate:"); if(!pick) return;
      try{
        await api(`/api/related`,{method:"POST",body:JSON.stringify({item_id:itemId, related_id:pick})});
        await renderRelated(itemId);
      }catch{ alert("Could not add relation."); }
    };
  }

  // ---- Notes (unchanged with small guards) ----
  async function renderNotes(paperId){
    const list=$("#notesList");
    list.innerHTML=`<li class="muted" style="padding:.75rem;">Loading…</li>`;
    try{
      const notes=await api(`/api/notes?paper_id=${encodeURIComponent(paperId)}`);
      list.innerHTML = (Array.isArray(notes)&&notes.length)
        ? notes.map(n=>`
          <li data-note="${n.id}">
            <button class="del" title="Delete note">×</button>
            <div style="white-space:pre-wrap; margin-top:.25rem;">${esc(n.text)}</div>
            <div class="muted" style="font-size:.8rem; margin-top:.25rem;">${new Date(n.created_at).toLocaleString()}</div>
          </li>`).join("")
        : `<li class="muted" style="padding:.75rem;">No notes yet.</li>`;
    }catch{ list.innerHTML=`<li class="muted" style="padding:.75rem;">Could not load notes.</li>`; }

    list.onclick=async(e)=>{
      const b=e.target.closest(".del"); if(!b) return;
      const li=b.closest("li[data-note]"); const nid=li.getAttribute("data-note");
      await api(`/api/notes/${encodeURIComponent(nid)}`,{method:"DELETE"});
      await renderNotes(paperId);
    };
    $("#addNoteBtn").onclick=async()=>{
      const txt=$("#noteText").value.trim(); if(!txt) return;
      await api("/api/notes",{method:"POST",body:JSON.stringify({paper_id:paperId,text:txt})});
      $("#noteText").value=""; await renderNotes(paperId);
    };
  }

  // ---- Bind UI & observers ----
  function bindUI(){
    // Persist widths (optional)
    const grid=$(".lib-grid");
    const obs=new ResizeObserver(()=>{
      const lw=$(".lib-left")?.getBoundingClientRect().width;
      const rw=$(".lib-right")?.getBoundingClientRect().width;
      if(lw) grid.style.setProperty("--left-col",`${Math.round(lw)}px`);
      if(rw) grid.style.setProperty("--right-col",`${Math.round(rw)}px`);
    });
    if($(".lib-left")) obs.observe($(".lib-left"));
    if($(".lib-right")) obs.observe($(".lib-right"));

    bindNewCollectionButtons();
  }
})();
