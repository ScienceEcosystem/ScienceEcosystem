(function(){
  if (document.body?.dataset.page !== "library") return;

  // Helpers
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=(s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  // ---- Toast notifications (replaces alert()) ----
  function toast(msg, type="info", ms=3000){
    const c=$("#toastContainer"); if(!c) return;
    const t=document.createElement("div");
    const bg=type==="error"?"#b91c1c":type==="success"?"#15803d":"#1e3a5f";
    t.style.cssText=`background:${bg};color:#fff;padding:.65rem 1rem;border-radius:8px;font-size:.9rem;max-width:320px;box-shadow:0 4px 12px rgba(0,0,0,.2);pointer-events:auto;opacity:0;transition:opacity .2s;`;
    t.textContent=msg;
    c.appendChild(t);
    requestAnimationFrame(()=>{ t.style.opacity="1"; });
    setTimeout(()=>{ t.style.opacity="0"; setTimeout(()=>t.remove(), 200); }, ms);
  }

  // ---- Collection picker modal (replaces prompt()) ----
  function showCollectionPicker(onPick){
    const overlay=$("#colPickerOverlay"); if(!overlay) return;
    const list=$("#colPickerList");
    const search=$("#colPickerSearch");
    search.value="";
    overlay.style.display="flex";
    search.focus();

    function renderList(filter=""){
      const f=filter.toLowerCase();
      const active=collections.filter(c=>!c.deleted_at&&(!f||c.name.toLowerCase().includes(f)));
      list.innerHTML=active.length
        ? active.map(c=>`<li data-id="${c.id}" style="padding:.6rem 1rem;cursor:pointer;border-bottom:1px solid #f3f4f6;user-select:none;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''">${esc(c.name)}</li>`).join("")
        : `<li style="padding:.6rem 1rem;color:#6b7280;">No collections</li>`;
    }
    renderList();
    search.oninput=()=>renderList(search.value);

    function close(){ overlay.style.display="none"; search.oninput=null; list.onclick=null; }
    $("#colPickerCancel").onclick=close;
    overlay.onclick=(e)=>{ if(e.target===overlay) close(); };

    list.onclick=(e)=>{
      const li=e.target.closest("li[data-id]"); if(!li) return;
      close();
      onPick(Number(li.getAttribute("data-id")));
    };

    $("#colPickerNew").onclick=async()=>{
      const nm=search.value.trim()||prompt("New collection name:");
      if(!nm) return;
      close();
      const col=await api("/api/collections",{method:"POST",body:JSON.stringify({name:nm,parent_id:null})});
      await safeRefreshCollections(); renderTree();
      onPick(col.id);
    };
  }

  // ---- Citation formatters (lightweight, no deps) ----
  function splitName(full){
    const s=String(full||"").trim();
    if(s.includes(",")){ const [f,...r]=s.split(","); return {family:f.trim(),given:r.join(",").trim()}; }
    const parts=s.split(/\s+/); const family=parts.pop()||""; return {family,given:parts.join(" ")};
  }
  function fmtBibTeX(item){
    const authors=(item.authors||"").split(/;| and /i).map(a=>{ const p=splitName(a.trim()); return p.family+(p.given?", "+p.given:""); });
    const key=((authors[0]||"").split(",")[0]||"key").replace(/\s+/g,"")+(item.year||"")+(item.title||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,10);
    return ["@article{"+key+",",
      "  title={"+esc(item.title||"")+"},",
      authors.length?"  author={"+authors.join(" and ")+"},":"",
      item.venue?"  journal={"+item.venue+"},":"",
      item.year?"  year={"+item.year+"},":"",
      item.doi?"  doi={"+item.doi+"},":"",
      "}"].filter(Boolean).join("\n");
  }
  function fmtRIS(item){
    const authors=(item.authors||"").split(/;| and /i);
    return ["TY  - JOUR",
      ...authors.map(a=>{ const p=splitName(a.trim()); return "AU  - "+p.family+(p.given?", "+p.given:""); }),
      "TI  - "+(item.title||""),
      item.venue?"JO  - "+item.venue:"",
      item.year?"PY  - "+item.year:"",
      item.doi?"DO  - "+item.doi:"",
      "ER  - "].filter(Boolean).join("\n");
  }
  function downloadText(filename, content, mime="text/plain"){
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([content],{type:mime}));
    a.download=filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(a.href); },500);
  }
  async function api(path, opts={}){
    const isFormData = opts.body instanceof FormData;
    const defaultHeaders = isFormData ? {} : { "Content-Type":"application/json" };
    const res = await fetch(path,{
      credentials:"include",
      headers:{ ...defaultHeaders, ...(opts.headers||{}) },
      ...opts
    });
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
  let zoteroStatus=null;
  let zoteroUserId=null;

  // Bootstrap
  window.addEventListener("DOMContentLoaded", async()=>{
    try{ if(globalThis.SE_SESSION?.syncHeader) await globalThis.SE_SESSION.syncHeader(); }catch{}
    await refreshEverything();
    bindUI();
  });

  async function refreshEverything(){
    await Promise.all([safeRefreshCollections(), safeRefreshItems(), safeRefreshZoteroStatus()]);
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
  function buildContextMenuAt(defs, x, y){
    closeAnyMenu();
    const m=document.createElement("div");
    m.className="context-menu";
    m.innerHTML=`<ul>${defs.map(d=>`<li data-act="${d.act}">${esc(d.label)}</li>`).join("")}</ul>`;
    document.body.appendChild(m);
    requestAnimationFrame(()=>{
      const left = Math.min(x, window.innerWidth - m.offsetWidth - 12);
      const top  = Math.min(y, window.innerHeight - m.offsetHeight - 12);
      m.style.left = `${left}px`;
      m.style.top  = `${top}px`;
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

  async function addItemToCollection(id){
    showCollectionPicker(async(cid)=>{
      try{
        await api(`/api/collections/${cid}/items`,{method:"POST",body:JSON.stringify({id})});
        await safeRefreshItems(); renderTable();
        const col=collections.find(c=>c.id===cid);
        toast(`Added to "${col?.name||"collection"}"`, "success");
      }catch(e){ toast("Could not add to collection: "+e.message,"error"); }
    });
  }

  async function removeItemFromCollection(id, collectionId){
    if(!collectionId) return;
    await api(`/api/collections/${collectionId}/items/${encodeURIComponent(id)}`,{method:"DELETE"});
    await safeRefreshItems(); renderTable();
  }

  async function moveItemToTrash(id){
    try{ await api(`/api/trash/items`,{method:"POST",body:JSON.stringify({id})}); }
    catch{ try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({deleted_at:new Date().toISOString()})}); }catch{} }
    await safeRefreshItems(); renderTable(); await renderInspector(id);
  }

  async function restoreItem(id){
    try{ await api(`/api/trash/restore`,{method:"POST",body:JSON.stringify({type:"item",id})}); }
    catch{ try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({deleted_at:null})}); }catch{} }
    await safeRefreshItems(); renderTable(); await renderInspector(id);
  }

  async function deleteItemForever(id){
    if(!confirm("Permanently delete this item?")) return;
    try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"DELETE"}); }
    catch{ try{ await api(`/api/trash/items`,{method:"DELETE",body:JSON.stringify({id})}); }catch{} }
    items = items.filter(x=>String(x.id)!==String(id));
    renderTable(); $("#inspectorBody").innerHTML=`<p class="muted" style="padding:.75rem;">Select an item…</p>`;
  }

  function buildMenuForItem(item, ev){
    const openAlexId = item.openalex_id || item.id || "";
    const localPdf = item.local_pdf_path ? `/api/library/pdf?paper_id=${encodeURIComponent(item.id)}` : null;
    const pdfUrl = localPdf || item.pdf_url || null;
    const defs=[
      {act:"open-paper",label:"Open paper page",onClick: ()=>{ location.href=`paper.html?id=${encodeURIComponent(openAlexId)}`; }},
      ...(pdfUrl ? [{act:"open-pdf",label:"Open in PDF viewer",onClick: ()=>{
        const openAlexId = item.openalex_id || item.id || "";
        const viewerUrl = openAlexId
          ? `pdf-viewer.html?id=${encodeURIComponent(openAlexId)}&pdf=${encodeURIComponent(pdfUrl)}`
          : `pdf-viewer.html?pdf=${encodeURIComponent(pdfUrl)}`;
        window.open(viewerUrl,"_blank");
      }}] : []),
      {act:"add-col",label:"Add to collection…",onClick: async()=>{ await addItemToCollection(item.id); }},
      ...((currentCollectionId && typeof currentCollectionId==="number") ? [{act:"remove-col",label:"Remove from this collection",onClick: async()=>{ await removeItemFromCollection(item.id, currentCollectionId); }}] : []),
      ...(!item.deleted_at ? [{act:"trash",label:"Move to Trash",onClick: async()=>{ await moveItemToTrash(item.id); }}] : [{act:"restore",label:"Restore",onClick: async()=>{ await restoreItem(item.id); }}]),
      ...(item.deleted_at ? [{act:"delete",label:"Delete permanently",onClick: async()=>{ await deleteItemForever(item.id); }}] : [])
    ];
    buildContextMenuAt(defs, ev.clientX, ev.clientY);
  }

  function buildMenuForCollection(c, anchorEl){
    const defs=[
      {act:"new",label:"New subcollection",onClick: async()=>{
        const nm=prompt("New subcollection name:"); if(!nm) return;
        await api("/api/collections",{method:"POST",body:JSON.stringify({name:nm,parent_id:c.id})});
        await safeRefreshCollections(); renderTree();
        toast("Collection created","success");
      }},
      {act:"ren",label:"Rename",onClick: async()=>{
        const nm=prompt("Rename collection:",c.name); if(!nm) return;
        await api(`/api/collections/${c.id}`,{method:"PATCH",body:JSON.stringify({name:nm})});
        await safeRefreshCollections(); renderTree();
        toast("Renamed","success");
      }},
      {act:"move",label:"Move to…",onClick: async()=>{
        showCollectionPicker(async(parent_id)=>{
          if(parent_id===c.id){ toast("Cannot move under itself","error"); return; }
          await api(`/api/collections/${c.id}`,{method:"PATCH",body:JSON.stringify({parent_id})});
          await safeRefreshCollections(); renderTree(); toast("Moved","success");
        });
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
          await safeRefreshCollections(); renderTree(); toast("Collection created","success");
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
    const virtDupLi=document.createElement("li");
    const virtDup=document.createElement("div");
    virtDup.className="virtual-h"; virtDup.textContent="Virtual";
    virtDupLi.appendChild(virtDup);
    ul.appendChild(virtDupLi);

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
          await safeRefreshCollections(); renderTree(); toast("Collection created","success");
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
    wireCollectionDropTargets();
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

  async function safeRefreshZoteroStatus(){
    try{
      const data = await api("/api/integrations/zotero/status");
      zoteroStatus = data || null;
      zoteroUserId = data?.zotero_user_id || null;
    }catch(e){
      zoteroStatus = null;
      zoteroUserId = null;
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

  // Only show first author's last name in main table
  function firstAuthorLastName(authStr){
    const s=(authStr||"").trim();
    if(!s) return "-";
    // Split list of authors on common separators
    let first = s.split(/;| and | & /i)[0].trim();
    if(!first) return "-";
    // If stored as "Last, First"
    if(first.includes(",")){
      first = first.split(",")[0].trim();
    }else{
      const parts = first.split(/\s+/);
      if(parts.length) first = parts[parts.length-1];
    }
    return first || "-";
  }

  function countFilledFields(it){
    return ["title","authors","year","venue","doi","abstract","pdf_url"].filter(f => it[f] !== null && it[f] !== undefined && it[f] !== "").length;
  }

  async function mergeItems(keepId, trashId){
    try{
      await api("/api/library/merge", {method:"POST", body:JSON.stringify({keep_id:keepId, trash_id:trashId})});
      await safeRefreshItems();
      renderTable();
      toast("Merged — duplicate moved to trash","success");
    } catch(e){
      toast("Merge failed: "+(e.message||"error"), "error");
    }
  }

  function renderTable(){
    const tbody=$("#itemsTbody"); if(!tbody) return;

    // Duplicates merge panel
    let mergePanelEl = $("#dupMergePanel");
    if(currentCollectionId === "__duplicates__"){
      const {dupGroups} = computeDuplicates(items.filter(it=>!it.deleted_at));
      const panelHtml = dupGroups.length === 0
        ? `<div id="dupMergePanel" style="background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem;color:#166534;">No duplicates found.</div>`
        : `<div id="dupMergePanel" style="margin-bottom:1rem;">
            <p style="font-size:.85rem;font-weight:600;margin:0 0 .5rem 0;color:#374151;">${dupGroups.length} duplicate ${dupGroups.length===1?"group":"groups"} found</p>
            ${dupGroups.map((grp,gi)=>{
              const winner = grp.slice().sort((a,b)=>countFilledFields(b)-countFilledFields(a))[0];
              return `<div style="background:#fafafa;border:1px solid #e2e8f0;border-radius:6px;padding:.6rem .8rem;margin-bottom:.5rem;font-size:.83rem;">
                ${grp.map(it=>`
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.2rem 0;">
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(it.title)}">${esc(it.title)}</span>
                    <span class="muted" style="flex-shrink:0;">${it.year||"?"} · ${countFilledFields(it)} fields</span>
                    ${it.id===winner.id?`<span style="font-size:.78rem;color:#16a34a;font-weight:600;flex-shrink:0;">↑ keep</span>`:`<span style="font-size:.78rem;color:#6b7280;flex-shrink:0;">discard</span>`}
                  </div>`).join(`<hr style="margin:.25rem 0;border:none;border-top:1px solid #e5e7eb;">`)}
                <button class="btn btn-secondary" data-merge-gi="${gi}" style="margin-top:.5rem;font-size:.8rem;">Merge (discard → trash)</button>
              </div>`;
            }).join("")}
          </div>`;
      if(mergePanelEl){ mergePanelEl.outerHTML = panelHtml; }
      else {
        tbody.closest("table")?.insertAdjacentHTML("beforebegin", panelHtml);
      }
      // Bind merge buttons
      $$("[data-merge-gi]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const gi = parseInt(btn.getAttribute("data-merge-gi"), 10);
          const {dupGroups:dg} = computeDuplicates(items.filter(it=>!it.deleted_at));
          const grp = dg[gi]; if(!grp) return;
          const winner = grp.slice().sort((a,b)=>countFilledFields(b)-countFilledFields(a))[0];
          const losers = grp.filter(it=>it.id!==winner.id);
          for(const loser of losers) await mergeItems(winner.id, loser.id);
        });
      });
    } else {
      // Remove panel if switching away from duplicates view
      $("#dupMergePanel")?.remove();
    }

    const cols=visibleColumns();
    const sortBy=$("#sortBy")?.value||"title";
    const sortDir=$("#sortDir")?.value||"asc";

    let view=applyFilters(currentViewItems());

    view.sort((a,b)=>{
      if(sortBy==="year"){
        const A=Number(a.year||0), B=Number(b.year||0);
        return sortDir==="asc" ? A-B : B-A;
      }
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
      const authorsDisplay = firstAuthorLastName(it.authors);
      const authors = cols.has("authors")?`<td>${esc(authorsDisplay)}${tagsHtml}</td>`:"";
      const year    = cols.has("year")   ?`<td>${esc(it.year??"-")}</td>`:"";
      const zoteroBadge = it.zotero_key ? `<span class="badge badge-zotero" title="Synced from Zotero">Z</span>` : "";
      const pdfBadge = it.local_pdf_path
        ? `<span title="PDF stored in your library" style="display:inline-flex;align-items:center;margin-right:4px;vertical-align:middle;flex-shrink:0;">
            <svg width="13" height="15" viewBox="0 0 13 15" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="13" height="15" rx="2" fill="#dc2626"/>
              <text x="6.5" y="10.5" text-anchor="middle" font-size="5.5" font-family="Inter,sans-serif" font-weight="700" fill="white">PDF</text>
            </svg>
           </span>`
        : "";
      return `<tr data-id="${esc(it.id)}" draggable="true">
        <td title="${esc(it.title||"-")}">${zoteroBadge}${pdfBadge}${esc(it.title||"-")}</td>
        ${authors}${year}
      </tr>`;
    }).join("");

    // row click -> select
    $$("#itemsTbody tr").forEach(tr=>{
      tr.addEventListener("click", async(ev)=>{
        currentSelection = tr.getAttribute("data-id");
        await renderInspector(currentSelection);
        const item = items.find(x=>String(x.id)===String(currentSelection));
        if(item) buildMenuForItem(item, ev);
      });
      tr.addEventListener("contextmenu", async(ev)=>{
        ev.preventDefault();
        currentSelection = tr.getAttribute("data-id");
        await renderInspector(currentSelection);
        const item = items.find(x=>String(x.id)===String(currentSelection));
        if(item) buildMenuForItem(item, ev);
      });
      tr.addEventListener("dragstart",(ev)=>{
        const id = tr.getAttribute("data-id");
        if(ev.dataTransfer && id){
          ev.dataTransfer.setData("text/plain", id);
          ev.dataTransfer.effectAllowed = "copy";
        }
        tr.classList.add("dragging");
      });
      tr.addEventListener("dragend",()=>{
        tr.classList.remove("dragging");
      });
    });
  }

  function wireCollectionDropTargets(){
    $$("#collectionsTree .row[data-id]").forEach(row=>{
      row.addEventListener("dragover",(ev)=>{
        ev.preventDefault();
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave",()=>{
        row.classList.remove("drag-over");
      });
      row.addEventListener("drop",async(ev)=>{
        ev.preventDefault();
        row.classList.remove("drag-over");
        const itemId = ev.dataTransfer?.getData("text/plain");
        const cid = row.getAttribute("data-id");
        if(!itemId || !cid) return;
        await api(`/api/collections/${cid}/items`,{method:"POST",body:JSON.stringify({id:itemId})});
        await safeRefreshItems(); renderTable();
      });
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
    const openAlexId = item.openalex_id || item.id || "";
    const localPdf = item.local_pdf_path ? `/api/library/pdf?paper_id=${encodeURIComponent(item.id)}` : null;
    const pdfUrl = localPdf || item.pdf_url || null;
    // Always open PDFs through the viewer so annotations sync
    const pdfViewerUrl = pdfUrl && openAlexId
      ? `pdf-viewer.html?id=${encodeURIComponent(openAlexId)}&pdf=${encodeURIComponent(pdfUrl)}`
      : (pdfUrl ? `pdf-viewer.html?pdf=${encodeURIComponent(pdfUrl)}` : null);
    const zoteroLink = (item.zotero_key && zoteroUserId) ? `https://www.zotero.org/users/${encodeURIComponent(zoteroUserId)}/items/${encodeURIComponent(item.zotero_key)}` : null;

    const currentTags = Array.isArray(item.tags) ? [...item.tags] : [];

    host.innerHTML = `
      <div style="padding:.75rem 1rem;">
        <!-- Metadata (view mode) -->
        <div id="metaView">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;">
            <h4 style="margin:0 0 .25rem 0;flex:1;">${esc(item.title)}</h4>
            <button class="btn btn-secondary" id="editMetaBtn" style="flex-shrink:0;font-size:.78rem;padding:.2rem .55rem;" title="Edit details">✏ Edit</button>
          </div>
          <p class="muted" style="margin:.25rem 0;">${esc(item.authors||"-")}</p>
          <p class="meta"><strong>${esc(item.year??"-")}</strong> · ${esc(item.venue||"-")}</p>
          ${item.doi?`<p class="meta" style="font-size:.8rem;">DOI: ${esc(item.doi)}</p>`:""}
        </div>

        <!-- Metadata (edit mode, hidden initially) -->
        <div id="metaEdit" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:.75rem;margin-bottom:.5rem;">
          <p style="font-size:.8rem;font-weight:600;margin:0 0 .5rem 0;color:#374151;">Edit details</p>
          <label style="font-size:.8rem;display:block;margin-bottom:.35rem;">Title
            <input id="editTitle" class="input" value="${esc(item.title||"")}" style="display:block;width:100%;margin-top:.15rem;font-size:.85rem;">
          </label>
          <label style="font-size:.8rem;display:block;margin-bottom:.35rem;">Authors
            <input id="editAuthors" class="input" value="${esc(item.authors||"")}" placeholder="Last, First; Last, First" style="display:block;width:100%;margin-top:.15rem;font-size:.85rem;">
          </label>
          <div style="display:flex;gap:.5rem;margin-bottom:.35rem;">
            <label style="font-size:.8rem;flex:1;">Year
              <input id="editYear" class="input" type="number" value="${esc(String(item.year||""))}" min="1000" max="2099" style="display:block;width:100%;margin-top:.15rem;font-size:.85rem;">
            </label>
            <label style="font-size:.8rem;flex:2;">Journal / Venue
              <input id="editVenue" class="input" value="${esc(item.venue||"")}" style="display:block;width:100%;margin-top:.15rem;font-size:.85rem;">
            </label>
          </div>
          <label style="font-size:.8rem;display:block;margin-bottom:.35rem;">DOI
            <input id="editDoi" class="input" value="${esc(item.doi||"")}" placeholder="10.xxxx/xxxxx" style="display:block;width:100%;margin-top:.15rem;font-size:.85rem;">
          </label>
          <label style="font-size:.8rem;display:block;margin-bottom:.5rem;">Abstract
            <textarea id="editAbstract" class="input" rows="4" style="display:block;width:100%;margin-top:.15rem;font-size:.85rem;resize:vertical;">${esc(item.abstract||"")}</textarea>
          </label>
          <div style="display:flex;gap:.4rem;">
            <button class="btn btn-primary" id="saveMetaBtn" style="font-size:.82rem;">Save</button>
            <button class="btn btn-secondary" id="cancelMetaBtn" style="font-size:.82rem;">Cancel</button>
          </div>
          <p id="metaSaveStatus" style="font-size:.8rem;margin:.35rem 0 0 0;"></p>
        </div>

        <!-- Secondary reference links -->
        <p style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.25rem 0;">
          ${chip(doiUrl,"Publisher page")}
          ${chip(item.openalex_url,"OpenAlex")}
          ${zoteroLink?`<a class="badge badge-zotero" href="${zoteroLink}" target="_blank" rel="noopener">Zotero</a>`:(item.zotero_key?`<span class="badge badge-zotero">Zotero</span>`:"")}
        </p>

        <!-- Primary actions -->
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.5rem 0;">
          <a class="btn btn-secondary" href="paper.html?id=${encodeURIComponent(openAlexId)}">Paper details</a>
          ${pdfViewerUrl?`<a class="btn btn-secondary" href="${esc(pdfViewerUrl)}">Read PDF</a>`:""}
          <button class="btn btn-secondary" id="addToCollectionBtn">+ Collection</button>
          ${!item.deleted_at?`<button class="btn btn-secondary" id="trashItemBtn">Trash</button>`:`<button class="btn btn-secondary" id="restoreItemBtn">Restore</button>`}
          ${item.deleted_at?`<button class="btn btn-secondary" id="deleteForeverBtn">Delete forever</button>`:""}
        </div>

        <!-- PDF attach/remove -->
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.25rem 0;">
          ${localPdf?`
            <button class="btn btn-secondary" id="deletePdfBtn">Remove attached PDF</button>
          `:`
            <button class="btn btn-secondary" id="uploadPdfBtn">Attach PDF</button>
            <input id="uploadPdfInput" type="file" accept="application/pdf" style="display:none;">
          `}
        </div>

        <!-- Annotations panel (loaded async below) -->
        <div id="annotPanel" style="margin:.5rem 0;"></div>

        <!-- Citation export -->
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.5rem 0;">
          <button class="btn btn-secondary" id="exportBibBtn">↓ BibTeX</button>
          <button class="btn btn-secondary" id="exportRisBtn">↓ RIS</button>
        </div>

        <!-- Tags editor -->
        <div style="margin:.5rem 0;">
          <strong style="font-size:.85rem;">Tags</strong>
          <div id="tagEditorWrap" style="margin:.35rem 0;display:flex;flex-wrap:wrap;gap:.3rem;align-items:center;">
            ${currentTags.map(t=>`<span class="tag-chip" data-tag="${esc(t)}">${esc(t)} <button class="tag-del" data-tag="${esc(t)}" title="Remove tag" style="background:none;border:none;cursor:pointer;font-size:.8rem;padding:0 0 0 3px;color:inherit;">×</button></span>`).join("")}
            <input id="tagInput" class="input" placeholder="Add tag…" style="width:90px;padding:.25rem .4rem;font-size:.85rem;"/>
          </div>
        </div>

        <!-- Abstract -->
        <details style="margin-top:.5rem;">
          <summary style="cursor:pointer;font-size:.85rem;font-weight:600;color:#374151;">Abstract</summary>
          <p style="margin:.35rem 0;font-size:.85rem;">${esc(item.abstract||"No abstract available.")}</p>
        </details>
      </div>
    `;

    // Load PDF annotations from server and render in the panel
    renderAnnotationPanel(id, pdfViewerUrl);

    // ---- Edit metadata ----
    $("#editMetaBtn")?.addEventListener("click", () => {
      $("#metaView").style.display = "none";
      $("#metaEdit").style.display = "";
      $("#editTitle").focus();
    });
    $("#cancelMetaBtn")?.addEventListener("click", () => {
      $("#metaView").style.display = "";
      $("#metaEdit").style.display = "none";
    });
    $("#saveMetaBtn")?.addEventListener("click", async () => {
      const statusEl = $("#metaSaveStatus");
      statusEl.textContent = "Saving…";
      const patch = {
        title:    $("#editTitle").value.trim()   || item.title,
        authors:  $("#editAuthors").value.trim() || null,
        year:     $("#editYear").value.trim()    || null,
        venue:    $("#editVenue").value.trim()   || null,
        doi:      $("#editDoi").value.trim()     || null,
        abstract: $("#editAbstract").value.trim() || null,
      };
      try {
        const updated = await api(`/api/library/${encodeURIComponent(id)}`, {
          method: "PATCH", body: JSON.stringify(patch)
        });
        Object.assign(item, updated);
        statusEl.textContent = "Saved.";
        setTimeout(() => renderInspector(id), 600);
      } catch (e) {
        statusEl.style.color = "red";
        statusEl.textContent = "Save failed: " + (e.message || "unknown error");
      }
    });

    // Add to collection
    $("#addToCollectionBtn").onclick=()=>addItemToCollection(id);

    // Citation export
    $("#exportBibBtn")?.addEventListener("click",()=>{
      const safe=(item.title||"citation").replace(/[^a-z0-9]/gi,"_").slice(0,40);
      downloadText(safe+".bib", fmtBibTeX(item));
      toast("BibTeX downloaded","success");
    });
    $("#exportRisBtn")?.addEventListener("click",()=>{
      const safe=(item.title||"citation").replace(/[^a-z0-9]/gi,"_").slice(0,40);
      downloadText(safe+".ris", fmtRIS(item), "application/x-research-info-systems");
      toast("RIS downloaded","success");
    });

    // Tag editing
    async function saveTags(tags){
      try{
        await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({tags})});
        const it=items.find(x=>String(x.id)===String(id)); if(it) it.tags=tags;
        renderTable();
      }catch(e){ toast("Could not save tags: "+e.message,"error"); }
    }
    $("#tagEditorWrap")?.addEventListener("click",async(e)=>{
      const btn=e.target.closest(".tag-del"); if(!btn) return;
      const tag=btn.getAttribute("data-tag");
      const newTags=currentTags.filter(t=>t!==tag);
      currentTags.length=0; newTags.forEach(t=>currentTags.push(t));
      await saveTags([...currentTags]);
      await renderInspector(id);
    });
    const tagInput=$("#tagInput");
    tagInput?.addEventListener("keydown",async(e)=>{
      if(e.key!=="Enter"&&e.key!==",") return;
      e.preventDefault();
      const val=tagInput.value.trim(); if(!val) return;
      if(!currentTags.includes(val)){ currentTags.push(val); await saveTags([...currentTags]); }
      tagInput.value="";
      await renderInspector(id);
    });

    // Trash / Restore / Delete forever
    $("#trashItemBtn")?.addEventListener("click", async()=>{
      try{ await api(`/api/trash/items`,{method:"POST",body:JSON.stringify({id})}); }
      catch{ try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({deleted_at:new Date().toISOString()})}); }catch{} }
      await safeRefreshItems(); renderTable(); await renderInspector(id);
      toast("Moved to Trash");
    });
    $("#restoreItemBtn")?.addEventListener("click", async()=>{
      try{ await api(`/api/trash/restore`,{method:"POST",body:JSON.stringify({type:"item",id})}); }
      catch{ try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({deleted_at:null})}); }catch{} }
      await safeRefreshItems(); renderTable(); await renderInspector(id);
      toast("Restored","success");
    });
    $("#deleteForeverBtn")?.addEventListener("click", async()=>{
      if(!confirm("Permanently delete this item?")) return;
      try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"DELETE"}); }
      catch{ try{ await api(`/api/trash/items`,{method:"DELETE",body:JSON.stringify({id})}); }catch{} }
      items = items.filter(x=>String(x.id)!==String(id));
      renderTable(); $("#inspectorBody").innerHTML=`<p class="muted" style="padding:.75rem;">Select an item…</p>`;
      toast("Deleted permanently");
    });

    // PDF upload / delete
    $("#uploadPdfBtn")?.addEventListener("click",()=>$("#uploadPdfInput")?.click());
    $("#uploadPdfInput")?.addEventListener("change", async(ev)=>{
      const file = ev.target.files && ev.target.files[0];
      if(!file) return;
      const btn=$("#uploadPdfBtn"); if(btn){ btn.textContent="Uploading…"; btn.disabled=true; }
      const form = new FormData();
      form.append("paper_id", id);
      form.append("file", file);
      try{
        await api("/api/library/pdf",{ method:"POST", body:form });
        await safeRefreshItems(); renderTable(); await renderInspector(id);
        toast("PDF attached","success");
      }catch(e){ toast("Failed to upload PDF: "+e.message,"error"); }
      finally{ ev.target.value=""; }
    });
    $("#deletePdfBtn")?.addEventListener("click", async()=>{
      if(!confirm("Remove stored PDF?")) return;
      try{
        await api(`/api/library/pdf?paper_id=${encodeURIComponent(id)}`,{method:"DELETE"});
        await safeRefreshItems(); renderTable(); await renderInspector(id);
        toast("PDF removed");
      }catch(e){ toast("Failed to remove PDF: "+e.message,"error"); }
    });

    // Related section
    await renderRelated(id);
    // Notes
    await renderNotes(id);
  }

  // ---- PDF annotation panel in inspector ----
  async function renderAnnotationPanel(paperId, pdfViewerUrl){
    const panel = document.getElementById("annotPanel");
    if (!panel) return;

    let annotData = { annotations: [], pdf_url: null };
    try {
      const res = await api(`/api/library/pdf-annotations?paper_id=${encodeURIComponent(paperId)}`);
      annotData = res || annotData;
    } catch(_) {}

    const annots = Array.isArray(annotData.annotations) ? annotData.annotations : [];
    const highlights = annots.filter(a => a.type === "highlight");
    const notes     = annots.filter(a => a.type === "note");

    if (!annots.length) {
      panel.innerHTML = pdfViewerUrl
        ? `<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:.6rem .75rem;font-size:.83rem;color:#6b7280;">
             No highlights or notes yet. <a href="${esc(pdfViewerUrl)}" style="color:#2e7f9f;">Open in PDF viewer</a> to start annotating.
           </div>`
        : "";
      return;
    }

    const summaryLine = [
      highlights.length ? `${highlights.length} highlight${highlights.length>1?"s":""}` : "",
      notes.length ? `${notes.length} note${notes.length>1?"s":""}` : ""
    ].filter(Boolean).join(", ");

    const annotHtml = annots.slice(0, 6).map(a => {
      const icon = a.type === "note" ? "📝" : "🖊";
      const color = a.type === "note" ? "rgba(46,127,159,.18)" : "rgba(255,235,59,.45)";
      const border = a.type === "note" ? "#0284c7" : "#d4a017";
      return `<div style="background:${color};border-left:3px solid ${border};border-radius:0 6px 6px 0;padding:.4rem .6rem;margin:.3rem 0;font-size:.82rem;">
        <span style="margin-right:.3rem;">${icon}</span>${esc(a.quote||"").slice(0,120)}${(a.quote||"").length>120?"…":""}
        ${a.note?`<div style="font-style:italic;color:#555;margin-top:.2rem;font-size:.8rem;">"${esc(a.note)}"</div>`:""}
      </div>`;
    }).join("");

    const moreNote = annots.length > 6
      ? `<p style="font-size:.78rem;color:#6b7280;margin:.25rem 0;">${annots.length-6} more in PDF viewer…</p>`
      : "";

    panel.innerHTML = `
      <div style="margin:.25rem 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.35rem;">
          <strong style="font-size:.85rem;">${summaryLine}</strong>
          ${pdfViewerUrl?`<a href="${esc(pdfViewerUrl)}" style="font-size:.8rem;color:#2e7f9f;">Open PDF viewer →</a>`:""}
        </div>
        ${annotHtml}${moreNote}
      </div>`;
  }

  // ---- Related items: show collection siblings ----
  async function renderRelated(itemId){
    const ul=$("#relatedList");
    const addBtn=$("#addRelatedBtn");
    if(addBtn) addBtn.style.display="none"; // not applicable for collection-based related

    const item=items.find(x=>String(x.id)===String(itemId));
    const colIds=(item?.collection_ids||[]);

    // Papers in the same collection(s), excluding self
    const siblings=items.filter(x=>
      String(x.id)!==String(itemId) &&
      !x.deleted_at &&
      colIds.some(cid=>(x.collection_ids||[]).includes(cid))
    ).slice(0,8);

    ul.innerHTML = siblings.length
      ? siblings.map(r=>`<li style="padding:.3rem 0;border-bottom:1px solid #f3f4f6;"><a href="#" data-open="${esc(r.id)}" style="font-size:.85rem;">${esc(r.title||r.id)}</a> <span class="muted" style="font-size:.8rem;">${esc(r.year??"")}</span></li>`).join("")
      : `<li class="muted" style="font-size:.85rem;">No items in the same collection.</li>`;

    ul.onclick=(e)=>{
      const a=e.target.closest("a[data-open]"); if(!a) return;
      e.preventDefault(); renderInspector(a.getAttribute("data-open"));
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

  // ---- PDF import (front-end hook; requires /api/library/import-pdf on server) ----
  async function handlePdfUpload(file){
    if(!file) return;
    const form = new FormData();
    form.append("file", file);

    try{
      const res = await api("/api/library/import-pdf",{ method:"POST", body:form });
      // Expect server to return { item } or { items: [...] }
      let createdItem = null;
      if(res && res.item){
        createdItem = res.item;
        const idx = items.findIndex(x=>String(x.id)===String(createdItem.id));
        if(idx>=0) items[idx]=createdItem; else items.push(createdItem);
      }else if(res && Array.isArray(res.items) && res.items.length){
        createdItem = res.items[0];
        items = res.items;
      }else{
        await safeRefreshItems();
      }
      renderTable();
      if(createdItem){
        currentSelection = createdItem.id;
        await renderInspector(currentSelection);
      }
    }catch(e){
      console.error("PDF import failed", e);
      alert("Could not import PDF. Please try again.");
    }
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

    // PDF import bindings
    const importBtn   = $("#importPdfBtn");
    const importInput = $("#importPdfInput");
    if(importBtn && importInput){
      importBtn.addEventListener("click",()=>importInput.click());
      importInput.addEventListener("change", async(ev)=>{
        const file = ev.target.files && ev.target.files[0];
        await handlePdfUpload(file);
        // Reset so selecting same file again still triggers change
        ev.target.value="";
      });
    }

    // Export the currently visible items (selected collection + filters) as one .bib file
    $("#exportLibBibBtn")?.addEventListener("click",()=>{
      const list = applyFilters(currentViewItems());
      if(!list.length){ toast("Nothing to export","error"); return; }
      const usedKeys = new Set();
      const entries = list.map(item=>{
        let entry = fmtBibTeX(item);
        const m = entry.match(/^@article\{([^,]*),/);
        if(m){
          let key = m[1], n = 2;
          while(usedKeys.has(key)){ key = m[1] + n; n++; }
          usedKeys.add(key);
          if(key !== m[1]) entry = entry.replace(/^@article\{[^,]*,/, "@article{"+key+",");
        }
        return entry;
      });
      const col = collections.find(c=>String(c.id)===String(currentCollectionId));
      const name = col ? col.name.toLowerCase().replace(/[^a-z0-9]+/g,"-") : "library";
      downloadText(`scienceecosystem-${name}.bib`, entries.join("\n\n")+"\n");
      toast(`Exported ${list.length} item${list.length===1?"":"s"} as .bib`,"success");
    });
  }
})();
