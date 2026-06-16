(function(){
  if (document.body?.dataset.page !== "library") return;

  // Helpers
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=(s)=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");

  // Render title HTML safely — allows only inline formatting tags (<i>,<em>,<b>,<strong>,<sub>,<sup>)
  const titleHtml=(raw)=>{
    if(!raw) return '';
    const s=String(raw).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return s
      .replace(/&lt;\/(i|em|b|strong|sub|sup)&gt;/gi,'</$1>')
      .replace(/&lt;(i|em|b|strong|sub|sup)\s*&gt;/gi,'<$1>');
  };

  // Small SVG type icons for the item table
  const _T_DOC=`<svg width="11" height="13" viewBox="0 0 11 13" fill="none" style="display:block;margin:auto"><rect x=".5" y=".5" width="10" height="12" rx="1" stroke="#7b8ea0"/><line x1="2" y1="4" x2="9" y2="4" stroke="#7b8ea0"/><line x1="2" y1="6.5" x2="9" y2="6.5" stroke="#7b8ea0"/><line x1="2" y1="9" x2="6.5" y2="9" stroke="#7b8ea0"/></svg>`;
  const _T_BOOK=`<svg width="12" height="13" viewBox="0 0 12 13" fill="none" style="display:block;margin:auto"><rect x=".5" y=".5" width="11" height="12" rx="1" stroke="#7b8ea0"/><line x1="3.5" y1=".5" x2="3.5" y2="12.5" stroke="#7b8ea0"/></svg>`;
  const _T_CONF=`<svg width="11" height="13" viewBox="0 0 11 13" fill="none" style="display:block;margin:auto"><rect x=".5" y=".5" width="10" height="12" rx="1" stroke="#2e7f9f"/><line x1="2" y1="4" x2="9" y2="4" stroke="#2e7f9f"/><line x1="2" y1="6.5" x2="9" y2="6.5" stroke="#2e7f9f"/></svg>`;
  const _T_PRE=`<svg width="11" height="13" viewBox="0 0 11 13" fill="none" style="display:block;margin:auto"><rect x=".5" y=".5" width="10" height="12" rx="1" stroke="#7c3aed"/><line x1="2" y1="4" x2="9" y2="4" stroke="#7c3aed"/><line x1="2" y1="6.5" x2="9" y2="6.5" stroke="#7c3aed"/><line x1="2" y1="9" x2="6.5" y2="9" stroke="#7c3aed"/></svg>`;
  const _T_DISS=`<svg width="11" height="13" viewBox="0 0 11 13" fill="none" style="display:block;margin:auto"><rect x=".5" y=".5" width="10" height="12" rx="1" stroke="#b45309"/><circle cx="5.5" cy="7" r="2" stroke="#b45309"/></svg>`;
  const _T_DATA=`<svg width="11" height="13" viewBox="0 0 11 13" fill="none" style="display:block;margin:auto"><ellipse cx="5.5" cy="3" rx="4.5" ry="2" stroke="#6b7280"/><path d="M1 3v7c0 1.1 2 2 4.5 2s4.5-.9 4.5-2V3" stroke="#6b7280"/><path d="M1 7c0 1.1 2 2 4.5 2s4.5-.9 4.5-2" stroke="#6b7280"/></svg>`;
  const TYPE_ICON_MAP={'journal-article':_T_DOC,'review':_T_DOC,'letter':_T_DOC,'editorial':_T_DOC,'other':_T_DOC,'book':_T_BOOK,'book-chapter':_T_BOOK,'conference-paper':_T_CONF,'preprint':_T_PRE,'dissertation':_T_DISS,'dataset':_T_DATA,'report':_T_DOC};
  function typeIcon(t){ return TYPE_ICON_MAP[t]||_T_DOC; }

  // Small PDF badge SVG
  const PDF_BADGE=`<svg width="13" height="15" viewBox="0 0 13 15" fill="none" style="display:block;margin:auto"><rect width="13" height="15" rx="2" fill="#dc2626"/><text x="6.5" y="10.5" text-anchor="middle" font-size="5.5" font-family="Inter,sans-serif" font-weight="700" fill="white">PDF</text></svg>`;

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
      const nm=search.value.trim()||"New collection";
      close();
      const col=await api("/api/collections",{method:"POST",body:JSON.stringify({name:nm,parent_id:null})});
      await safeRefreshCollections(); renderTree();
      startInlineRename({id:col.id,name:col.name});
      onPick(col.id);
    };
  }

  // ---- Item type config ----
  const ITEM_TYPES = {
    "journal-article": { label: "Journal Article", bibtex: "article",   fields: ["volume","issue","pages","issn"] },
    "review":          { label: "Review",           bibtex: "article",   fields: ["volume","issue","pages","issn"] },
    "book":            { label: "Book",             bibtex: "book",      fields: ["publisher","isbn","edition"] },
    "book-chapter":    { label: "Book Chapter",     bibtex: "incollection", fields: ["publisher","isbn","pages"] },
    "conference-paper":{ label: "Conference Paper", bibtex: "inproceedings", fields: ["conference","pages"] },
    "preprint":        { label: "Preprint",         bibtex: "misc",      fields: ["repository","arxiv_id"] },
    "dataset":         { label: "Dataset",          bibtex: "misc",      fields: ["publisher","repository"] },
    "dissertation":    { label: "Dissertation",     bibtex: "phdthesis", fields: ["institution"] },
    "report":          { label: "Report",           bibtex: "techreport",fields: ["publisher"] },
    "letter":          { label: "Letter",           bibtex: "article",   fields: ["volume","issue","pages"] },
    "editorial":       { label: "Editorial",        bibtex: "article",   fields: ["volume","issue","pages"] },
    "other":           { label: "Other",            bibtex: "misc",      fields: [] },
  };
  const EXTRA_LABELS = {
    volume:"Volume", issue:"Issue", pages:"Pages", issn:"ISSN",
    publisher:"Publisher", isbn:"ISBN", edition:"Edition",
    conference:"Conference", repository:"Repository",
    arxiv_id:"arXiv ID", institution:"Institution",
  };

  function getItemType(item) {
    return item.item_type && ITEM_TYPES[item.item_type] ? item.item_type : "journal-article";
  }
  function getExtraFields(item) {
    if (!item.extra_fields) return {};
    if (typeof item.extra_fields === "string") {
      try { return JSON.parse(item.extra_fields); } catch { return {}; }
    }
    return item.extra_fields || {};
  }

  // ---- Citation formatters (lightweight, no deps) ----
  function splitName(full){
    const s=String(full||"").trim();
    if(s.includes(",")){ const [f,...r]=s.split(","); return {family:f.trim(),given:r.join(",").trim()}; }
    const parts=s.split(/\s+/); const family=parts.pop()||""; return {family,given:parts.join(" ")};
  }
  function fmtBibTeX(item){
    const ef = getExtraFields(item);
    const typ = ITEM_TYPES[getItemType(item)] || ITEM_TYPES["journal-article"];
    const authors=(item.authors||"").split(/;| and /i).map(a=>{ const p=splitName(a.trim()); return p.family+(p.given?", "+p.given:""); });
    const key=((authors[0]||"").split(",")[0]||"key").replace(/\s+/g,"")+(item.year||"")+(item.title||"").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,10);
    const venueKey = typ.bibtex==="book"||typ.bibtex==="phdthesis" ? "  publisher" : (typ.bibtex==="inproceedings" ? "  booktitle" : "  journal");
    return [`@${typ.bibtex}{${key},`,
      `  title={${esc(item.title||"")}},`,
      authors.length?`  author={${authors.join(" and ")}},`:"",
      item.venue?`${venueKey}={${item.venue}},`:"",
      ef.conference?`  booktitle={${ef.conference}},`:"",
      item.year?`  year={${item.year}},`:"",
      ef.volume?`  volume={${ef.volume}},`:"",
      ef.issue?`  number={${ef.issue}},`:"",
      ef.pages?`  pages={${ef.pages}},`:"",
      ef.publisher?`  publisher={${ef.publisher}},`:"",
      ef.institution?`  school={${ef.institution}},`:"",
      ef.isbn?`  isbn={${ef.isbn}},`:"",
      ef.arxiv_id?`  eprint={${ef.arxiv_id}},archivePrefix={arXiv},`:"",
      item.doi?`  doi={${item.doi}},`:"",
      "}"].filter(Boolean).join("\n");
  }
  function authorInitials(given){
    return given.split(/\s+/).filter(Boolean).map(n=>n[0].toUpperCase()+".").join(" ");
  }
  function fmtAPA(item){
    const ef = getExtraFields(item);
    const authors=(item.authors||"").split(/;| and /i).map(a=>a.trim()).filter(Boolean);
    const names=authors.map(a=>{ const p=splitName(a); return p.given?`${p.family}, ${authorInitials(p.given)}`:p.family; });
    let authorStr="";
    if(names.length===1) authorStr=names[0];
    else if(names.length===2) authorStr=names.join(", & ");
    else if(names.length>2) authorStr=names.slice(0,-1).join(", ")+", & "+names[names.length-1];
    const year=item.year?`(${item.year}). `:"";
    const title=(item.title||"").trim();
    const venue=item.venue?` *${item.venue}*`:"";
    const volIss = ef.volume ? (ef.issue ? `, *${ef.volume}*(${ef.issue})` : `, *${ef.volume}*`) : "";
    const pages = ef.pages ? `, ${ef.pages}` : "";
    const doi=item.doi?` https://doi.org/${item.doi}`:"";
    const publisher=ef.publisher?` ${ef.publisher}.`:"";
    const institution=ef.institution?` ${ef.institution}.`:"";
    const repo=ef.repository?` ${ef.repository}.`:"";
    const arxiv=ef.arxiv_id?` arXiv:${ef.arxiv_id}`:"";
    const typeStr = getItemType(item);
    let source="";
    if(typeStr==="book"||typeStr==="report") source=publisher;
    else if(typeStr==="dissertation") source=institution;
    else if(typeStr==="preprint") source=repo+arxiv;
    else source=`${venue}${volIss}${pages}.`;
    return `${authorStr?authorStr+" ":""}${year}${title}.${source}${doi}`.trim();
  }
  function fmtMLA(item){
    const ef = getExtraFields(item);
    const authors=(item.authors||"").split(/;| and /i).map(a=>a.trim()).filter(Boolean);
    const names=authors.map(a=>{ const p=splitName(a); return p.given?`${p.family}, ${p.given}`:p.family; });
    let authorStr="";
    if(names.length===1) authorStr=names[0];
    else if(names.length===2) authorStr=`${names[0]}, and ${authors[1]}`;
    else if(names.length>2) authorStr=`${names[0]}, et al.`;
    const title=item.title?`"${item.title}."`: "";
    const venue=item.venue?` *${item.venue}*,`:"";
    const vol=ef.volume?(ef.issue?` vol. ${ef.volume}, no. ${ef.issue},`:` vol. ${ef.volume},`):"";
    const pages=ef.pages?` pp. ${ef.pages},`:"";
    const year=item.year?` ${item.year}.`:"";
    const doi=item.doi?` doi:${item.doi}.`:"";
    return `${authorStr?authorStr+". ":""}${title}${venue}${vol}${pages}${year}${doi}`.trim();
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
  function fmtChicago(item){
    const ef=getExtraFields(item);
    const rawAuthors=(item.authors||"").split(/;| and /i).map(a=>a.trim()).filter(Boolean);
    const names=rawAuthors.map((a,i)=>{ const p=splitName(a); return i===0?(p.given?`${p.family}, ${p.given}`:p.family):(p.given?`${p.given} ${p.family}`:p.family); });
    let authorStr="";
    if(names.length===1) authorStr=names[0];
    else if(names.length<=3) authorStr=names.slice(0,-1).join(", ")+" and "+names[names.length-1];
    else authorStr=names[0]+" et al.";
    const year=item.year?`${item.year}`:"n.d.";
    const title=item.title?`"${item.title}."`: "";
    const venue=item.venue?` *${item.venue}*`:"";
    const vol=ef.volume?(ef.issue?` ${ef.volume}, no. ${ef.issue}`:" "+ef.volume):"";
    const pages=ef.pages?`: ${ef.pages}`:"";
    const doi=item.doi?` https://doi.org/${item.doi}`:"";
    return `${authorStr?authorStr+". ":""}${year}. ${title}${venue}${vol}${pages}.${doi}`.trim();
  }
  function fmtVancouver(item){
    const ef=getExtraFields(item);
    const rawAuthors=(item.authors||"").split(/;| and /i).map(a=>a.trim()).filter(Boolean);
    const names=rawAuthors.map(a=>{ const p=splitName(a); const initials=(p.given||"").split(/\s+/).filter(Boolean).map(n=>n[0].toUpperCase()).join(""); return p.family+(initials?" "+initials:""); });
    const authorStr=names.length>6?names.slice(0,6).join(", ")+" et al.":names.join(", ");
    const vol=ef.volume?`${ef.volume}`:"";
    const iss=ef.issue?`(${ef.issue})`:"";
    const pages=ef.pages?`:${ef.pages}`:"";
    const year=item.year?` ${item.year}`:""
    const venue=item.venue?` ${item.venue}.`:"";
    const doi=item.doi?` doi:${item.doi}`:"";
    return `${authorStr?authorStr+". ":""}${item.title||""}. ${venue}${year}${vol?";"+vol:""}${iss}${pages}.${doi}`.replace(/\s{2,}/g," ").trim();
  }
  function fmtIEEE(item){
    const ef=getExtraFields(item);
    const rawAuthors=(item.authors||"").split(/;| and /i).map(a=>a.trim()).filter(Boolean);
    const names=rawAuthors.map(a=>{ const p=splitName(a); const initials=(p.given||"").split(/\s+/).filter(Boolean).map(n=>n[0].toUpperCase()+".").join(" "); return initials?`${initials} ${p.family}`:p.family; });
    let authorStr="";
    if(names.length===1) authorStr=names[0];
    else if(names.length===2) authorStr=`${names[0]} and ${names[1]}`;
    else authorStr=names.slice(0,-1).join(", ")+", and "+names[names.length-1];
    const title=item.title?`"${item.title},"`: "";
    const venue=item.venue?` *${item.venue}*,`:"";
    const vol=ef.volume?` vol. ${ef.volume},`:"";
    const iss=ef.issue?` no. ${ef.issue},`:"";
    const pages=ef.pages?` pp. ${ef.pages},`:"";
    const year=item.year?` ${item.year}.`:"";
    const doi=item.doi?` doi: ${item.doi}.`:"";
    return `${authorStr?authorStr+", ":""}${title}${venue}${vol}${iss}${pages}${year}${doi}`.trim();
  }
  function fmtHarvard(item){
    const ef=getExtraFields(item);
    const rawAuthors=(item.authors||"").split(/;| and /i).map(a=>a.trim()).filter(Boolean);
    const names=rawAuthors.map(a=>{ const p=splitName(a); return p.given?`${p.family}, ${p.given.split(/\s+/).filter(Boolean).map(n=>n[0].toUpperCase()+".").join(" ")}`:p.family; });
    let authorStr="";
    if(names.length===1) authorStr=names[0];
    else if(names.length===2) authorStr=`${names[0]} and ${names[1]}`;
    else authorStr=names.slice(0,-1).join(", ")+" and "+names[names.length-1];
    const year=item.year?`(${item.year}) `:"";
    const title=item.title?`'${item.title}',`:"";
    const venue=item.venue?` *${item.venue}*,`:"";
    const volIss=ef.volume?(ef.issue?` ${ef.volume}(${ef.issue}),`:` ${ef.volume},`):"";
    const pages=ef.pages?` pp. ${ef.pages}.`:" ";
    const doi=item.doi?` doi: ${item.doi}.`:"";
    return `${authorStr?authorStr+" ":""}${year}${title}${venue}${volIss}${pages}${doi}`.trim();
  }
  function fmtNature(item){
    const ef=getExtraFields(item);
    const rawAuthors=(item.authors||"").split(/;| and /i).map(a=>a.trim()).filter(Boolean);
    const names=rawAuthors.map(a=>{ const p=splitName(a); const initials=(p.given||"").split(/\s+/).filter(Boolean).map(n=>n[0].toUpperCase()+".").join(""); return p.family+(initials?", "+initials:""); });
    const authorStr=names.length>5?names.slice(0,5).join(", ")+" et al.":names.join(", ");
    const title=item.title||"";
    const venue=item.venue?` *${item.venue}*`:"";
    const vol=ef.volume?` **${ef.volume}**,`:",";
    const pages=ef.pages?` ${ef.pages}`:"";
    const year=item.year?` (${item.year})`:""
    const doi=item.doi?` https://doi.org/${item.doi}`:"";
    return `${authorStr?authorStr+". ":""}${title}.${venue}${vol}${pages}${year}.${doi}`.trim();
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
  let selectedIds=new Set();   // multi-select set
  let lastClickId=null;        // anchor for shift-click range
  let lastRenderedView=[];     // ordered view array for range selection
  let openMenu=null;
  let tagFilterTerms=[];
  let _renderTagPanel=null; // set after init, called by renderTable
  let zoteroStatus=null;
  let zoteroUserId=null;

  // Bootstrap
  window.addEventListener("DOMContentLoaded", async()=>{
    try{ if(globalThis.SE_SESSION?.syncHeader) await globalThis.SE_SESSION.syncHeader(); }catch{}
    await refreshEverything();
    bindUI();
    initResizers();
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

  function startInlineRename(c){
    // Find the .name span inside the row for this collection
    const row=$(`#collectionsTree .row[data-id="${CSS.escape(String(c.id))}"]`);
    if(!row) return;
    const nameSpan=row.querySelector(".name");
    if(!nameSpan) return;
    const prev=nameSpan.textContent;
    const inp=document.createElement("input");
    inp.value=prev;
    inp.className="input";
    inp.style.cssText="font-size:.83rem;padding:.1rem .3rem;width:100%;min-width:0;";
    nameSpan.replaceWith(inp);
    inp.focus(); inp.select();
    let committed=false;
    const commit=async()=>{
      if(committed) return; committed=true;
      const nm=inp.value.trim();
      if(!nm||nm===prev){ await safeRefreshCollections(); renderTree(); return; }
      try{
        await api(`/api/collections/${c.id}`,{method:"PATCH",body:JSON.stringify({name:nm})});
        await safeRefreshCollections(); renderTree();
        toast("Renamed","success");
      }catch(e){ committed=false; toast("Rename failed: "+e.message,"error"); await safeRefreshCollections(); renderTree(); }
    };
    inp.addEventListener("keydown",async(ev)=>{
      if(ev.key==="Enter"){ ev.preventDefault(); await commit(); }
      if(ev.key==="Escape"){ committed=true; await safeRefreshCollections(); renderTree(); }
    });
    inp.addEventListener("blur",commit);
  }

  function buildMenuForCollection(c, anchorEl){
    const defs=[
      {act:"new",label:"New subcollection",onClick: async()=>{
        // Create a placeholder collection and immediately rename it inline
        const col=await api("/api/collections",{method:"POST",body:JSON.stringify({name:"New collection",parent_id:c.id})});
        await safeRefreshCollections(); renderTree();
        startInlineRename({id:col.id,name:col.name});
      }},
      {act:"ren",label:"Rename",onClick: ()=>{ startInlineRename(c); }},
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
          const col=await api("/api/collections",{method:"POST",body:JSON.stringify({name:"New collection",parent_id:null})});
          await safeRefreshCollections(); renderTree();
          startInlineRename({id:col.id,name:col.name});
        }},
        {act:"empty-trash",label:"Empty Trash",onClick: async()=>{
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
      <svg class="tree-icon" viewBox="0 0 16 16" fill="none"><rect x="5" y="1" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="4" width="9" height="11" rx="1" stroke="currentColor" stroke-width="1.2" fill="white"/></svg>
      <span class="name">Duplicates</span>
      <button class="kebab" title="Options" aria-haspopup="menu">···</button>
    </div>`;
    dupLi.querySelector(".row").addEventListener("click",()=>{ currentCollectionId="__duplicates__"; selectedIds=new Set(); renderTree(); renderTable(); });
    ul.appendChild(dupLi);

    const trashLi=document.createElement("li");
    if(currentCollectionId==="__trash__") trashLi.classList.add("active");
    trashLi.innerHTML=`<div class="row" data-virt="trash">
      <svg class="tree-icon" viewBox="0 0 16 16" fill="none"><polyline points="3,5 3,14 13,14 13,5" stroke="currentColor" stroke-width="1.2"/><line x1="1" y1="5" x2="15" y2="5" stroke="currentColor" stroke-width="1.2"/><line x1="6" y1="8" x2="6" y2="12" stroke="currentColor" stroke-width="1"/><line x1="10" y1="8" x2="10" y2="12" stroke="currentColor" stroke-width="1"/><path d="M6 5V3h4v2" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
      <span class="name">Trash</span>
      <button class="kebab" title="Trash options" aria-haspopup="menu">···</button>
    </div>`;
    trashLi.querySelector(".row").addEventListener("click",()=>{ currentCollectionId="__trash__"; selectedIds=new Set(); renderTree(); renderTable(); });
    trashLi.querySelector(".kebab").addEventListener("click",(ev)=>{
      ev.stopPropagation();
      buildContextMenu([
        {act:"restore-all",label:"Restore all",onClick: async()=>{
          try{ await api("/api/trash/restore",{method:"POST",body:JSON.stringify({scope:"all"})}); }catch{}
          await refreshEverything();
        }},
        {act:"empty",label:"Empty Trash",onClick: async()=>{
          try{ await api("/api/trash/empty",{method:"POST"}); }catch{}
          await refreshEverything();
        }},
      ], ev.currentTarget);
    });
    ul.appendChild(trashLi);

    // Root: All Items
    const allLi=document.createElement("li");
    if(currentCollectionId==null) allLi.classList.add("active");
    const allCount=items.filter(it=>!it.deleted_at).length;
    allLi.innerHTML=`<div class="row" data-root="1">
      <svg class="tree-icon" viewBox="0 0 16 16" fill="none"><path d="M2 4h4l2 2h6v7H2z" stroke="currentColor" stroke-width="1.2"/></svg>
      <span class="name">My Library</span>
      <span class="tree-count">${allCount}</span>
      <button class="kebab" title="Options" aria-haspopup="menu">···</button>
    </div>`;
    allLi.querySelector(".row").addEventListener("click",()=>{ currentCollectionId=null; selectedIds=new Set(); renderTree(); renderTable(); });
    allLi.querySelector(".kebab").addEventListener("click",(ev)=>{
      ev.stopPropagation();
      buildContextMenu([
        {act:"new-root",label:"New collection",onClick: async()=>{
          const col=await api("/api/collections",{method:"POST",body:JSON.stringify({name:"New collection",parent_id:null})});
          await safeRefreshCollections(); renderTree();
          startInlineRename({id:col.id,name:col.name});
        }},
      ], ev.currentTarget);
    });
    ul.appendChild(allLi);

    // Actual collections
    (function renderBranch(parentKey, depth){
      for(const c of (m.get(parentKey)||[])){
        const li=document.createElement("li");
        if(currentCollectionId===c.id) li.classList.add("active");
        const cnt=items.filter(it=>!it.deleted_at&&(it.collection_ids||[]).includes(c.id)).length;
        li.innerHTML=`<div class="row" data-id="${String(c.id)}" style="padding-left:${Math.max(0,depth)*14+8}px;">
          <svg class="tree-icon" viewBox="0 0 16 16" fill="none"><path d="M1 4h5l2 2h7v7H1z" stroke="currentColor" stroke-width="1.2"/></svg>
          <span class="name" title="${esc(c.name)}">${esc(c.name)}</span>
          ${cnt?`<span class="tree-count">${cnt}</span>`:''}
          <button class="kebab" title="Collection options" aria-haspopup="menu">···</button>
        </div>`;
        const row=li.querySelector(".row");
        const keb=li.querySelector(".kebab");
        row.addEventListener("click",(ev)=>{ if(ev.target.closest(".kebab")) return; currentCollectionId=c.id; selectedIds=new Set(); renderTree(); renderTable(); });
        row.addEventListener("dblclick",(ev)=>{ if(ev.target.closest(".kebab")) return; ev.stopPropagation(); startInlineRename(c); });
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
      const parent_id = currentCollectionId && currentCollectionId!=="__trash__" && currentCollectionId!=="__duplicates__" ? currentCollectionId : null;
      const col=await api("/api/collections",{method:"POST",body:JSON.stringify({name:"New collection",parent_id})});
      await safeRefreshCollections(); renderTree();
      startInlineRename({id:col.id,name:col.name});
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
    return new Set(["title","authors","year"]);
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
      const matchesQ = !q || `${it.title} ${it.authors||""} ${it.venue||""} ${it.abstract||""}`.toLowerCase().includes(q);
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

    if(!view.length){ tbody.innerHTML=`<tr><td colspan="5" class="muted" style="padding:.5rem .75rem;">No items</td></tr>`; return; }

    const READ_DOT={'to-read':'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#3b82f6;margin:auto;"></span>','reading':'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#f59e0b;margin:auto;"></span>','read':'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;margin:auto;"></span>'};
    tbody.innerHTML=view.map(it=>{
      const authorsDisplay = firstAuthorLastName(it.authors);
      const authors = cols.has("authors")?`<td class="col-authors">${esc(authorsDisplay)}</td>`:"";
      const year    = cols.has("year")   ?`<td class="col-year">${esc(it.year??"-")}</td>`:"";
      const zoteroBadge = it.zotero_key ? `<span class="badge badge-zotero" title="Synced from Zotero" style="font-size:.65rem;padding:.05rem .3rem;margin-right:3px;">Z</span>` : "";
      const isSel = selectedIds.has(String(it.id));
      const readDot = it.read_status ? `<span title="${it.read_status}">${READ_DOT[it.read_status]||''}</span>` : "";
      return `<tr data-id="${esc(it.id)}" draggable="true"${isSel?' class="selected"':''}>
        <td class="col-icon" title="${esc(ITEM_TYPES[getItemType(it)]?.label||'Article')}" style="position:relative;">${typeIcon(getItemType(it))}${it.read_status?`<span style="position:absolute;top:1px;right:1px;">${READ_DOT[it.read_status]||''}</span>`:""}</td>
        <td class="col-title" title="${esc(it.title||"-")}">${zoteroBadge}${titleHtml(it.title||"-")}</td>
        ${authors}${year}
        <td class="col-pdf" title="${it.local_pdf_path?'PDF stored in library':''}">${it.local_pdf_path?PDF_BADGE:''}</td>
      </tr>`;
    }).join("");

    lastRenderedView = view;

    // row click -> select (shift=range, ctrl/cmd=toggle, plain=single)
    $$("#itemsTbody tr").forEach(tr=>{
      tr.addEventListener("click", async(ev)=>{
        const id = tr.getAttribute("data-id");
        if(ev.shiftKey && lastClickId){
          const ids = lastRenderedView.map(x=>String(x.id));
          const a = ids.indexOf(String(lastClickId));
          const b = ids.indexOf(String(id));
          if(a!==-1 && b!==-1){
            const [lo,hi]=[Math.min(a,b),Math.max(a,b)];
            selectedIds = new Set(ids.slice(lo,hi+1));
          }
        } else if(ev.ctrlKey || ev.metaKey){
          if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
          lastClickId = id;
        } else {
          selectedIds = new Set([id]);
          lastClickId = id;
        }
        currentSelection = id;
        $$("#itemsTbody tr").forEach(r=>r.classList.toggle("selected", selectedIds.has(r.getAttribute("data-id"))));
        if(selectedIds.size===1){ await renderInspector(currentSelection); }
        else if(selectedIds.size>1){ renderMultiSelectPanel(); }
        else { const host=$("#inspectorBody"); if(host) host.innerHTML=`<p class="muted" style="padding:.75rem;">Select an item…</p>`; }
      });
      tr.addEventListener("contextmenu", async(ev)=>{
        ev.preventDefault();
        const id = tr.getAttribute("data-id");
        if(!selectedIds.has(id)){ selectedIds=new Set([id]); lastClickId=id; }
        currentSelection = id;
        $$("#itemsTbody tr").forEach(r=>r.classList.toggle("selected", selectedIds.has(r.getAttribute("data-id"))));
        if(selectedIds.size===1) await renderInspector(currentSelection);
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

    // Column header click-to-sort + sort indicator
    const sortByEl=$("#sortBy"), sortDirEl=$("#sortDir");
    $$("#itemsTable thead th[data-k]").forEach(th=>{
      th.style.cursor="pointer"; th.style.userSelect="none";
      const k=th.dataset.k;
      // Store the bare label once so repeated renders don't stack arrows
      if(!th.dataset.label) th.dataset.label=th.textContent.trim();
      const curSort=sortByEl?.value||"title";
      const curDir=sortDirEl?.value||"asc";
      th.textContent=th.dataset.label+(k===curSort?(curDir==="asc"?" ↑":" ↓"):"");
      // Use onclick so re-renders replace rather than accumulate the handler
      th.onclick=()=>{
        const wasSort=sortByEl?.value;
        if(sortByEl) sortByEl.value=k;
        if(sortDirEl) sortDirEl.value=(wasSort===k && sortDirEl.value==="asc") ? "desc" : "asc";
        renderTable();
      };
    });
    // Empty Trash button — only visible in trash view
    const emptyTrashBtn=$("#emptyTrashBtn");
    if(emptyTrashBtn){
      emptyTrashBtn.style.display=currentCollectionId==="__trash__"?"":"none";
      emptyTrashBtn.onclick=async()=>{
        emptyTrashBtn.disabled=true; emptyTrashBtn.textContent="Emptying…";
        try{ await api("/api/trash/empty",{method:"POST"}); }catch{}
        selectedIds=new Set(); await safeRefreshItems(); renderTable();
        toast("Trash emptied");
      };
    }

    _renderTagPanel?.();
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
  $("#tagFilter")?.addEventListener("input", ()=>{
    tagFilterTerms = ($("#tagFilter").value||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    renderTable();
  });

  // ---- Inspector (& Related) ----
  function renderMultiSelectPanel(){
    const host=$("#inspectorBody");
    if(!host) return;
    const count=selectedIds.size;
    const inTrash=currentCollectionId==="__trash__";
    host.innerHTML=`
      <div style="padding:1rem .75rem;">
        <p style="font-size:.9rem;font-weight:600;margin:0 0 .85rem;color:#374151;">${count} items selected</p>
        ${!inTrash?`<button class="btn btn-secondary" id="bulkTrashBtn" style="width:100%;margin-bottom:.4rem;">Move to Trash</button>`:""}
        ${inTrash?`<button class="btn btn-secondary" id="bulkRestoreBtn" style="width:100%;margin-bottom:.4rem;">Restore</button>`:""}
        ${inTrash?`<button class="btn btn-secondary" id="bulkDeleteBtn" style="width:100%;margin-bottom:.4rem;color:#dc2626;border-color:#dc2626;">Delete permanently</button>`:""}
      </div>`;
    $("#bulkTrashBtn")?.addEventListener("click", async()=>{
      const ids=[...selectedIds];
      for(const id of ids) await moveItemToTrash(id).catch(()=>{});
      selectedIds=new Set(); await safeRefreshItems(); renderTable();
      toast(`${ids.length} item${ids.length===1?"":"s"} moved to Trash`);
    });
    $("#bulkRestoreBtn")?.addEventListener("click", async()=>{
      const ids=[...selectedIds];
      for(const id of ids) await restoreItem(id).catch(()=>{});
      selectedIds=new Set(); await safeRefreshItems(); renderTable();
      toast(`${ids.length} item${ids.length===1?"":"s"} restored`,"success");
    });
    $("#bulkDeleteBtn")?.addEventListener("click", async()=>{
      const ids=[...selectedIds];
      for(const id of ids){
        try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"DELETE"}); }
        catch{ try{ await api(`/api/trash/items`,{method:"DELETE",body:JSON.stringify({id})}); }catch{} }
      }
      items=items.filter(x=>!ids.includes(String(x.id)));
      selectedIds=new Set(); renderTable();
      host.innerHTML=`<p class="muted" style="padding:.75rem;">Select an item…</p>`;
      toast(`${ids.length} item${ids.length===1?"":"s"} deleted permanently`);
    });
  }

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
    const itemType = getItemType(item);
    const typeInfo = ITEM_TYPES[itemType] || ITEM_TYPES["journal-article"];
    const extraFields = getExtraFields(item);
    const localPdf = item.local_pdf_path ? `/api/library/pdf?paper_id=${encodeURIComponent(item.id)}` : null;
    const pdfUrl = localPdf || item.pdf_url || null;
    // Always open PDFs through the viewer so annotations sync
    const pdfViewerUrl = pdfUrl && openAlexId
      ? `pdf-viewer.html?id=${encodeURIComponent(openAlexId)}&pdf=${encodeURIComponent(pdfUrl)}`
      : (pdfUrl ? `pdf-viewer.html?pdf=${encodeURIComponent(pdfUrl)}` : null);
    const zoteroLink = (item.zotero_key && zoteroUserId) ? `https://www.zotero.org/users/${encodeURIComponent(zoteroUserId)}/items/${encodeURIComponent(item.zotero_key)}` : null;

    const currentTags = Array.isArray(item.tags) ? [...item.tags] : [];

    // Build field-grid view rows (skips empty values)
    const fgRow=(label,value,html=false)=>value
      ? `<span class="fg-label">${label}</span><span class="fg-value">${html?value:esc(String(value))}</span>`
      : "";
    const doiDisplay = item.doi
      ? `<a href="${doiUrl}" target="_blank" rel="noopener">${esc(item.doi)}</a>` : "";

    host.innerHTML = `
      <!-- Inspector header: title + type badge + reading status -->
      <div class="insp-hdr">
        <div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.2rem;flex-wrap:wrap;">
          <span class="type-badge">${esc(typeInfo.label)}</span>
          ${item.read_status?`<span id="readStatusBadge" class="read-status-badge read-status-${esc(item.read_status)}">${item.read_status==='to-read'?'To Read':item.read_status==='reading'?'Reading':'Read'}</span>`:`<span id="readStatusBadge" class="read-status-badge read-status-none" style="color:#9ca3af;">+ Status</span>`}
          <span style="flex:1"></span>
          <button class="btn btn-secondary" id="editMetaBtn" style="font-size:.75rem;padding:.15rem .45rem;">Edit</button>
        </div>
        <h4 class="insp-title">${titleHtml(item.title||"Untitled")}</h4>
      </div>

      <!-- Tab bar -->
      <div class="insp-tabs">
        <button class="insp-tab active" data-tab="info">Info</button>
        <button class="insp-tab" data-tab="notes">Notes</button>
        <button class="insp-tab" data-tab="abstract">Abstract</button>
        <button class="insp-tab" data-tab="tags">Tags</button>
      </div>

      <!-- ========== INFO TAB ========== -->
      <div id="inspTabInfo" class="insp-tab-content">

        <!-- View mode: field grid -->
        <div id="metaView">
          <div class="field-grid">
            ${fgRow("Item Type", typeInfo.label)}
            ${fgRow("Author", item.authors||"—")}
            ${fgRow("Year", item.year??"")}
            ${fgRow("Journal", item.venue||"")}
            ${fgRow("Volume", extraFields.volume||"")}
            ${fgRow("Issue", extraFields.issue||"")}
            ${fgRow("Pages", extraFields.pages||"")}
            ${fgRow("Publisher", extraFields.publisher||"")}
            ${fgRow("Conference", extraFields.conference||"")}
            ${fgRow("Institution", extraFields.institution||"")}
            ${fgRow("arXiv", extraFields.arxiv_id||"")}
            ${fgRow("DOI", doiDisplay, true)}
          </div>

          <!-- Links -->
          <div style="display:flex;flex-wrap:wrap;gap:.3rem;padding:.4rem 0;border-bottom:1px solid #f0f0f0;">
            ${chip(doiUrl,"Publisher")}
            ${chip(item.openalex_url,"OpenAlex")}
            ${zoteroLink?`<a class="badge badge-zotero" href="${zoteroLink}" target="_blank" rel="noopener">Zotero</a>`:(item.zotero_key?`<span class="badge badge-zotero">Zotero</span>`:"")}
          </div>

          <!-- Actions -->
          <div style="display:flex;flex-wrap:wrap;gap:.3rem;padding:.4rem 0;border-bottom:1px solid #f0f0f0;">
            <a class="btn btn-secondary" href="paper.html?id=${encodeURIComponent(openAlexId)}" style="font-size:.79rem;padding:.22rem .5rem;">Details</a>
            ${pdfViewerUrl?`<a class="btn btn-secondary" href="${esc(pdfViewerUrl)}" style="font-size:.79rem;padding:.22rem .5rem;">Read PDF</a>`:""}
            <button class="btn btn-secondary" id="addToCollectionBtn" style="font-size:.79rem;padding:.22rem .5rem;">+ Collection</button>
            ${!item.deleted_at?`<button class="btn btn-secondary" id="trashItemBtn" style="font-size:.79rem;padding:.22rem .5rem;">Trash</button>`:`<button class="btn btn-secondary" id="restoreItemBtn" style="font-size:.79rem;padding:.22rem .5rem;">Restore</button>`}
            ${item.deleted_at?`<button class="btn btn-secondary" id="deleteForeverBtn" style="font-size:.79rem;padding:.22rem .5rem;">Delete forever</button>`:""}
          </div>

          <!-- PDF -->
          <div style="display:flex;flex-wrap:wrap;gap:.3rem;padding:.4rem 0;border-bottom:1px solid #f0f0f0;">
            ${localPdf
              ?`<button class="btn btn-secondary" id="deletePdfBtn" style="font-size:.79rem;padding:.22rem .5rem;">Remove PDF</button>`
              :`<button class="btn btn-secondary" id="uploadPdfBtn" style="font-size:.79rem;padding:.22rem .5rem;">Attach PDF</button><input id="uploadPdfInput" type="file" accept="application/pdf" style="display:none;">`
            }
          </div>

          <!-- Annotations -->
          <div id="annotPanel" style="padding:.3rem 0;"></div>

          <!-- Citation export -->
          <div style="display:flex;flex-wrap:wrap;gap:.3rem;align-items:center;padding:.4rem 0;border-top:1px solid #f0f0f0;">
            <button class="btn btn-secondary" id="exportBibBtn" style="font-size:.77rem;padding:.2rem .45rem;">↓ BibTeX</button>
            <button class="btn btn-secondary" id="exportRisBtn" style="font-size:.77rem;padding:.2rem .45rem;">↓ RIS</button>
            <select id="citeFormatSelect" class="input" style="padding:.15rem .3rem;font-size:.77rem;">
              <option value="apa">APA 7th</option>
              <option value="mla">MLA 9th</option>
              <option value="chicago">Chicago</option>
              <option value="harvard">Harvard</option>
              <option value="vancouver">Vancouver</option>
              <option value="ieee">IEEE</option>
              <option value="nature">Nature</option>
            </select>
            <button class="btn btn-secondary" id="copyCiteBtn" style="font-size:.77rem;padding:.2rem .45rem;">Copy citation</button>
          </div>
        </div>

        <!-- Edit mode: field grid form (hidden) -->
        <div id="metaEdit" style="display:none;">
          <div class="field-grid">
            <span class="fg-label">Item Type</span>
            <span class="fg-value">
              <select id="editItemType" class="input">
                ${Object.entries(ITEM_TYPES).map(([k,v])=>`<option value="${k}"${k===itemType?" selected":""}>${v.label}</option>`).join("")}
              </select>
            </span>
            <span class="fg-label">Title</span>
            <span class="fg-value"><input id="editTitle" class="input" value="${esc(item.title||"")}"></span>
            <span class="fg-label">Authors</span>
            <span class="fg-value"><input id="editAuthors" class="input" value="${esc(item.authors||"")}" placeholder="Last, First; Last, First"></span>
            <span class="fg-label">Year</span>
            <span class="fg-value"><input id="editYear" class="input" type="number" value="${esc(String(item.year||""))}" min="1000" max="2099" style="width:80px;"></span>
            <span class="fg-label">Journal</span>
            <span class="fg-value"><input id="editVenue" class="input" value="${esc(item.venue||"")}"></span>
            <div id="extraFieldsWrap" style="display:contents;"></div>
            <span class="fg-label">DOI</span>
            <span class="fg-value"><input id="editDoi" class="input" value="${esc(item.doi||"")}" placeholder="10.xxxx/xxxxx"></span>
          </div>
          <div style="margin-top:.5rem;">
            <p style="font-size:.74rem;color:#6b7280;margin:0 0 .2rem 0;">Abstract</p>
            <textarea id="editAbstract" class="input" rows="3" style="width:100%;font-size:.8rem;resize:vertical;">${esc(item.abstract||"")}</textarea>
          </div>
          <div style="display:flex;gap:.4rem;margin-top:.45rem;">
            <button class="btn btn-primary" id="saveMetaBtn" style="font-size:.81rem;">Save</button>
            <button class="btn btn-secondary" id="cancelMetaBtn" style="font-size:.81rem;">Cancel</button>
          </div>
          <p id="metaSaveStatus" style="font-size:.78rem;margin:.3rem 0 0 0;"></p>
        </div>
      </div>

      <!-- ========== NOTES TAB ========== -->
      <div id="inspTabNotes" class="insp-tab-content" style="display:none;">
        <p class="insp-sub-hdr">In Same Collection</p>
        <ul id="relatedList"></ul>
        <p class="insp-sub-hdr" style="margin-top:.6rem;">Notes</p>
        <ul id="notesList" class="notes"></ul>
        <div class="note-editor" style="margin-top:.4rem;">
          <textarea id="noteText" class="input" placeholder="Add a note…" rows="3"></textarea>
          <div style="display:flex;justify-content:flex-end;margin-top:.3rem;">
            <button id="addNoteBtn" class="btn btn-secondary" style="font-size:.81rem;">Add Note</button>
          </div>
        </div>
      </div>

      <!-- ========== ABSTRACT TAB ========== -->
      <div id="inspTabAbstract" class="insp-tab-content" style="display:none;">
        <p style="font-size:.84rem;line-height:1.6;color:#374151;">${esc(item.abstract||"No abstract available.")}</p>
      </div>

      <!-- ========== TAGS TAB ========== -->
      <div id="inspTabTags" class="insp-tab-content" style="display:none;">
        <div id="tagEditorWrap" style="display:flex;flex-wrap:wrap;gap:.3rem;align-items:center;">
          ${currentTags.map(t=>`<span class="tag-chip" data-tag="${esc(t)}">${esc(t)} <button class="tag-del" data-tag="${esc(t)}" title="Remove tag" style="background:none;border:none;cursor:pointer;font-size:.8rem;padding:0 0 0 3px;color:inherit;">×</button></span>`).join("")}
          <input id="tagInput" class="input" placeholder="Add tag…" style="width:90px;padding:.2rem .35rem;font-size:.82rem;"/>
        </div>
      </div>
    `;

    // Tab switching
    $$(".insp-tab").forEach(tab=>{
      tab.addEventListener("click",()=>{
        const name=tab.dataset.tab;
        $$(".insp-tab").forEach(t=>t.classList.remove("active"));
        $$(".insp-tab-content").forEach(c=>{ c.style.display="none"; });
        tab.classList.add("active");
        const tId={info:"inspTabInfo",notes:"inspTabNotes",abstract:"inspTabAbstract",tags:"inspTabTags"}[name];
        if(tId) $("#"+tId).style.display="";
      });
    });

    // Load PDF annotations from server and render in the panel
    renderAnnotationPanel(id, pdfViewerUrl);

    // ---- Edit metadata ----
    function renderExtraFieldInputs(type) {
      const wrap = $("#extraFieldsWrap");
      if (!wrap) return;
      const fields = (ITEM_TYPES[type] || ITEM_TYPES["journal-article"]).fields;
      if (!fields.length) { wrap.innerHTML = ""; return; }
      // Output fg-label/fg-value pairs inside display:contents so they join the field-grid
      wrap.innerHTML = fields.map(f=>`
        <span class="fg-label">${EXTRA_LABELS[f]||f}</span>
        <span class="fg-value"><input id="ef_${f}" class="input" value="${esc(String(extraFields[f]||""))}" placeholder="${EXTRA_LABELS[f]||f}"></span>
      `).join("");
    }
    renderExtraFieldInputs(itemType);
    $("#editItemType")?.addEventListener("change", function() { renderExtraFieldInputs(this.value); });

    function collectExtraFields(type) {
      const fields = (ITEM_TYPES[type] || ITEM_TYPES["journal-article"]).fields;
      const ef = {};
      for (const f of fields) {
        const el = $(`#ef_${f}`);
        const v = el ? el.value.trim() : (extraFields[f] || "");
        if (v) ef[f] = v;
      }
      return Object.keys(ef).length ? ef : null;
    }

    // Reading status quick-toggle
    const READ_STATUS_CYCLE=[null,"to-read","reading","read"];
    $("#readStatusBadge")?.addEventListener("click", async()=>{
      const cur=item.read_status||null;
      const next=READ_STATUS_CYCLE[(READ_STATUS_CYCLE.indexOf(cur)+1)%READ_STATUS_CYCLE.length];
      try{
        await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({read_status:next})});
        item.read_status=next;
        const it=items.find(x=>String(x.id)===String(id));
        if(it) it.read_status=next;
        renderTable();
        // Update badge in place without full re-render
        const badge=$("#readStatusBadge");
        if(badge){
          const labels={null:"+ Status","to-read":"To Read","reading":"Reading","read":"Read"};
          badge.textContent=labels[next]||"+ Status";
          badge.className=`read-status-badge read-status-${next||"none"}`;
          if(!next) badge.style.color="#9ca3af"; else badge.style.color="";
        }
      }catch(e){ toast("Could not update status","error"); }
    });

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
      statusEl.style.color = "";
      const newType = $("#editItemType")?.value || itemType;
      const patch = {
        item_type: newType,
        extra_fields: collectExtraFields(newType),
        title:    $("#editTitle").value.trim()    || item.title,
        authors:  $("#editAuthors").value.trim()  || null,
        year:     $("#editYear").value.trim()     || null,
        venue:    $("#editVenue").value.trim()    || null,
        doi:      $("#editDoi").value.trim()      || null,
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
    $("#copyCiteBtn")?.addEventListener("click", async ()=>{
      const fmt = $("#citeFormatSelect")?.value || "apa";
      const fmtMap={apa:fmtAPA,mla:fmtMLA,chicago:fmtChicago,harvard:fmtHarvard,vancouver:fmtVancouver,ieee:fmtIEEE,nature:fmtNature};
      const text = (fmtMap[fmt]||fmtAPA)(item);
      try{
        await navigator.clipboard.writeText(text);
        toast(`${fmt.toUpperCase()} citation copied`,"success");
      }catch(_e){
        toast("Could not copy citation","error");
      }
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
      const btn=$("#deleteForeverBtn"); if(btn){ btn.disabled=true; btn.textContent="Deleting…"; }
      try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"DELETE"}); }
      catch{ try{ await api(`/api/trash/items`,{method:"DELETE",body:JSON.stringify({id})}); }catch{} }
      items=items.filter(x=>String(x.id)!==String(id));
      selectedIds.delete(String(id));
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
      const btn=$("#deletePdfBtn"); if(!btn) return;
      const prev=btn.textContent; btn.disabled=true; btn.textContent="Removing…";
      try{
        await api(`/api/library/pdf?paper_id=${encodeURIComponent(id)}`,{method:"DELETE"});
        // Reload items from DB so client state matches actual DB state
        await safeRefreshItems();
        const it=items.find(x=>String(x.id)===String(id));
        if(it) it.meta_fresh=true;
        renderTable(); await renderInspector(id);
        toast("PDF removed","success");
      }catch(e){
        btn.disabled=false; btn.textContent=prev;
        toast("Failed to remove PDF: "+(e.message||"unknown error"),"error");
      }
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
    const highlights = annots.filter(a => a.type === "highlight" || a.type === "underline");
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
      const icon = a.type === "note" ? "📝" : (a.type === "underline" ? "U" : "🖊");
      const color = a.type === "note" ? "rgba(46,127,159,.18)" : (a.color || "rgba(255,235,59,.45)");
      const border = a.type === "note" ? "#0284c7" : (a.color || "#d4a017");
      return `<div data-annot-id="${esc(a.id||"")}" style="background:${color};border-left:3px solid ${border};border-radius:0 6px 6px 0;padding:.4rem .6rem;margin:.3rem 0;font-size:.82rem;">
        <span style="margin-right:.3rem;">${icon}</span>${esc(a.quote||"").slice(0,120)}${(a.quote||"").length>120?"…":""}
        ${a.note?`<div style="font-style:italic;color:#555;margin-top:.2rem;font-size:.8rem;">"${esc(a.note)}"</div>`:""}
        <div style="margin-top:.25rem;"><button class="btn btn-secondary annot-to-note" style="font-size:.75rem;padding:.15rem .45rem;">→ Send to note</button></div>
      </div>`;
    }).join("");

    const moreNote = annots.length > 6
      ? `<p style="font-size:.78rem;color:#6b7280;margin:.25rem 0;">${annots.length-6} more in PDF viewer…</p>`
      : "";

    panel.innerHTML = `
      <div style="margin:.25rem 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.35rem;">
          <strong style="font-size:.85rem;">${summaryLine}</strong>
          <span>
            <button class="btn btn-secondary" id="exportAnnotBtn" style="font-size:.75rem;padding:.2rem .5rem;">↓ Export</button>
            ${pdfViewerUrl?`<a href="${esc(pdfViewerUrl)}" style="font-size:.8rem;color:#2e7f9f;margin-left:.5rem;">Open PDF viewer →</a>`:""}
          </span>
        </div>
        ${annotHtml}${moreNote}
      </div>`;

    // Send an individual annotation to the Notes panel
    panel.querySelectorAll(".annot-to-note").forEach(btn=>{
      btn.addEventListener("click", async ()=>{
        const wrap = btn.closest("[data-annot-id]");
        const aid = wrap?.getAttribute("data-annot-id");
        const a = annots.find(x=>String(x.id)===String(aid));
        if(!a) return;
        const text = a.quote ? (a.note ? `"${a.quote}"\n\n${a.note}` : `"${a.quote}"`) : (a.note||"");
        if(!text) return;
        try{
          await api("/api/notes",{method:"POST",body:JSON.stringify({paper_id:paperId,text})});
          await renderNotes(paperId);
          toast("Added to notes","success");
        }catch(e){ toast("Could not add note: "+e.message,"error"); }
      });
    });

    // Export all highlights/notes as a markdown file
    $("#exportAnnotBtn")?.addEventListener("click", ()=>{
      const lines = annots.map(a=>{
        const label = a.type === "note" ? "Note" : (a.type === "underline" ? "Underline" : "Highlight");
        let s = `- **${label}** (p.${a.page}): ${a.quote||""}`;
        if(a.note) s += `\n  > ${a.note}`;
        return s;
      });
      const md = `# Annotations\n\n${lines.join("\n\n")}\n`;
      downloadText("annotations.md", md, "text/markdown");
      toast("Annotations exported","success");
    });
  }

  // ---- Related items: show collection siblings ----
  async function renderRelated(itemId){
    const ul=$("#relatedList");
    if(!ul) return;

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

  // ---- Notes ----
  async function renderNotes(paperId){
    const list=$("#notesList");
    if(!list) return;
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
    const addBtn=$("#addNoteBtn");
    if(addBtn) addBtn.onclick=async()=>{
      const noteText=$("#noteText");
      const txt=noteText?.value.trim(); if(!txt) return;
      await api("/api/notes",{method:"POST",body:JSON.stringify({paper_id:paperId,text:txt})});
      if(noteText) noteText.value="";
      await renderNotes(paperId);
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

  async function handleAddByDoi(input){
    const identifier = (input.value || "").trim();
    if(!identifier) return;
    try{
      const res = await api("/api/library/add-by-doi", { method:"POST", body: JSON.stringify({ identifier }) });
      if(res?.duplicate){
        toast("Already in your library","info");
        currentSelection = res.existing_id;
      } else if(res?.item){
        const idx = items.findIndex(x=>String(x.id)===String(res.item.id));
        if(idx>=0) items[idx]=res.item; else items.push(res.item);
        currentSelection = res.item.id;
        toast("Added to library","success");
      } else {
        await safeRefreshItems();
      }
      renderTable();
      if(currentSelection) await renderInspector(currentSelection);
      input.value = "";
    }catch(e){
      console.error("Add by DOI failed", e);
      toast(String(e?.message || "Could not find that paper"), "error");
    }
  }

  // ---- Column resizers ----
  function initResizers(){
    const grid=$(".lib-grid");
    if(!grid) return;
    const resizers=$$(".lib-resizer");
    resizers.forEach((handle,idx)=>{
      handle.addEventListener("mousedown",(startEv)=>{
        startEv.preventDefault();
        handle.classList.add("dragging");
        const startX=startEv.clientX;
        const isLeft=(idx===0);
        const startVal=parseInt(
          getComputedStyle(grid).getPropertyValue(isLeft?"--lib-left":"--lib-right")||
          (isLeft?"240":"310"),10
        );
        const onMove=(ev)=>{
          const delta=isLeft?(ev.clientX-startX):(startX-ev.clientX);
          const next=Math.max(140,startVal+delta);
          grid.style.setProperty(isLeft?"--lib-left":"--lib-right",`${next}px`);
        };
        const onUp=()=>{
          handle.classList.remove("dragging");
          document.removeEventListener("mousemove",onMove);
          document.removeEventListener("mouseup",onUp);
        };
        document.addEventListener("mousemove",onMove);
        document.addEventListener("mouseup",onUp);
      });
    });
  }

  // ---- Bind UI & observers ----
  function bindUI(){

    bindNewCollectionButtons();

    // Add-by-DOI / identifier bindings
    const addDoiInput = $("#addByDoiInput");
    const addDoiBtn   = $("#addByDoiBtn");
    if(addDoiInput && addDoiBtn){
      addDoiBtn.addEventListener("click", ()=>handleAddByDoi(addDoiInput));
      addDoiInput.addEventListener("keydown", (ev)=>{
        if(ev.key === "Enter"){ ev.preventDefault(); handleAddByDoi(addDoiInput); }
      });
    }

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
        const m = entry.match(/^@\w+\{([^,]*),/);
        if(m){
          let key = m[1], n = 2, base = m[1];
          while(usedKeys.has(key)){ key = base + n; n++; }
          usedKeys.add(key);
          if(key !== base) entry = entry.replace(/^(@\w+\{)[^,]*,/, `$1${key},`);
        }
        return entry;
      });
      const col = collections.find(c=>String(c.id)===String(currentCollectionId));
      const name = col ? col.name.toLowerCase().replace(/[^a-z0-9]+/g,"-") : "library";
      downloadText(`scienceecosystem-${name}.bib`, entries.join("\n\n")+"\n");
      toast(`Exported ${list.length} item${list.length===1?"":"s"} as .bib`,"success");
    });

    // ---- Keyboard shortcuts ----
    document.addEventListener("keydown", async(ev)=>{
      // Don't fire when typing in inputs / textareas / contenteditable
      const tag=(ev.target?.tagName||"").toLowerCase();
      if(tag==="input"||tag==="textarea"||tag==="select"||ev.target?.isContentEditable) return;

      const rows=[...$$("#itemsTbody tr[data-id]")];
      const curIdx=rows.findIndex(r=>r.getAttribute("data-id")===currentSelection);

      if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){
        ev.preventDefault();
        const next=ev.key==="ArrowDown"
          ? (curIdx<0 ? 0 : Math.min(curIdx+1,rows.length-1))
          : (curIdx<0 ? rows.length-1 : Math.max(curIdx-1,0));
        const tr=rows[next]; if(!tr) return;
        const id=tr.getAttribute("data-id");
        selectedIds=new Set([id]); lastClickId=id; currentSelection=id;
        $$("#itemsTbody tr").forEach(r=>r.classList.toggle("selected", selectedIds.has(r.getAttribute("data-id"))));
        tr.scrollIntoView({block:"nearest"});
        await renderInspector(currentSelection);
        return;
      }

      if(ev.key==="Delete"||ev.key==="Backspace"){
        ev.preventDefault();
        const toTrash=[...selectedIds].filter(id=>{ const it=items.find(x=>String(x.id)===String(id)); return it&&!it.deleted_at; });
        if(!toTrash.length) return;
        for(const id of toTrash){
          try{ await api("/api/trash/items",{method:"POST",body:JSON.stringify({id})}); }
          catch{ try{ await api(`/api/library/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify({deleted_at:new Date().toISOString()})}); }catch{} }
        }
        selectedIds=new Set(); await safeRefreshItems(); renderTable();
        toast(`${toTrash.length} item${toTrash.length===1?"":"s"} moved to Trash`);
        return;
      }

      if(ev.key==="Enter"){
        if(!currentSelection) return;
        ev.preventDefault();
        const item=items.find(x=>String(x.id)===String(currentSelection));
        if(!item) return;
        const openAlexId=item.openalex_id||item.id||"";
        const localPdf=item.local_pdf_path?`/api/library/pdf?paper_id=${encodeURIComponent(item.id)}`:null;
        const pdfUrl=localPdf||item.pdf_url||null;
        if(pdfUrl&&openAlexId){
          window.location.href=`pdf-viewer.html?id=${encodeURIComponent(openAlexId)}&pdf=${encodeURIComponent(pdfUrl)}`;
        } else if(pdfUrl){
          window.location.href=`pdf-viewer.html?pdf=${encodeURIComponent(pdfUrl)}`;
        }
        return;
      }
    });

    // ---- Tag panel in sidebar ----
    function renderTagPanel(){
      let panel=$("#tagSidePanel");
      if(!panel){
        const host=$(".lib-left");
        if(!host) return;
        panel=document.createElement("div");
        panel.id="tagSidePanel";
        panel.style.cssText="border-top:1px solid #d4d8df;padding:.35rem 0;";
        host.appendChild(panel);
      }
      // Collect all tags from non-deleted items in current view
      const viewItems=applyFilters(currentViewItems());
      const tagCounts={};
      viewItems.forEach(it=>{ (it.tags||[]).forEach(t=>{ tagCounts[t]=(tagCounts[t]||0)+1; }); });
      const tags=Object.keys(tagCounts).sort();
      if(!tags.length){ panel.innerHTML=""; return; }

      panel.innerHTML=`
        <p style="font-size:.68rem;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;padding:.35rem .65rem .1rem;margin:0;">Tags</p>
        <div style="padding:0 .5rem .35rem;display:flex;flex-wrap:wrap;gap:.25rem;">
          ${tags.map(t=>{
            const active=tagFilterTerms.includes(t.toLowerCase());
            return `<span class="tag-side-chip${active?" active":""}" data-tag="${esc(t)}" style="font-size:.72rem;padding:.1rem .4rem;border-radius:999px;cursor:pointer;border:1px solid ${active?"#3b82f6":"#d1d5db"};background:${active?"#dbeafe":"#f3f4f6"};color:${active?"#1e40af":"#374151"};">${esc(t)} <span style="color:#9ca3af;">${tagCounts[t]}</span></span>`;
          }).join("")}
        </div>`;

      panel.querySelectorAll(".tag-side-chip").forEach(chip=>{
        chip.addEventListener("click",()=>{
          const t=chip.getAttribute("data-tag").toLowerCase();
          if(tagFilterTerms.includes(t)){
            tagFilterTerms=tagFilterTerms.filter(x=>x!==t);
          } else {
            tagFilterTerms=[...tagFilterTerms,t];
          }
          renderTagPanel();
          renderTable();
        });
      });
    }
    _renderTagPanel=renderTagPanel;
    renderTagPanel();
  }
})();
