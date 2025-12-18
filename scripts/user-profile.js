// --- user-profile.js ---
// Researcher Home (post-ORCID). Adds dashboard + identity linking + projects/materials/groups.
// Preserves existing behaviour (paper.html?id=...), nav, and claims/merge UI.

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let txt = "";
    try { txt = await res.text(); } catch {}
    throw new Error(`Request failed ${res.status}: ${txt}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// --- Following store (local-only for now) ---
const FOLLOW_KEY = "se_followed_authors";
const OPENALEX = "https://api.openalex.org";
const MAILTO = "info@scienceecosystem.org";

function readFollows() {
  try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) || "[]"); } catch { return []; }
}
function saveFollows(list) {
  localStorage.setItem(FOLLOW_KEY, JSON.stringify(list));
}
function isFollowing(id) {
  return readFollows().some((f) => f.id === id);
}
function addMailto(u) {
  try {
    const url = new URL(u);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  } catch { return u; }
}

function badge(txt) {
  return `<span class="badge" style="display:inline-block; padding:.1rem .4rem; border-radius:999px; background:#eef; color:#223;">${escapeHtml(txt)}</span>`;
}

async function bootstrap() {
  const userHeader = document.getElementById("userHeader");
  const userMain   = document.getElementById("userMain");
  const sidebar    = document.getElementById("userSidebar");
  const loginBtn   = document.getElementById("orcidLoginBtn");
  const logoutBtn  = document.getElementById("logoutBtn");

  // Sections
  const todayList      = document.getElementById("todayList");
  const activityList   = document.getElementById("activityList");
  const activityScope  = document.getElementById("activityScope");
  const refreshActBtn  = document.getElementById("refreshActivityBtn");
  const projectsGrid   = document.getElementById("projectsGrid");
  const materialsList  = document.getElementById("materialsList");
  const libRecent      = document.getElementById("libRecent");
  const libToRead      = document.getElementById("libToRead");
  const libStarred     = document.getElementById("libStarred");
  const libCountEl     = document.getElementById("libCount");
  const clearBtn       = document.getElementById("clearLibBtn");
  const identityBox    = document.getElementById("identityStatus");
  const libraryList    = document.getElementById("userLibraryList");
  const followingBtn   = document.getElementById("refreshFollowingBtn");
  const followListEl   = document.getElementById("followedList");
  const followUpdates  = document.getElementById("followedUpdates");

  try {
    // --- Session ---
    const me = await api("/api/me");

    // Toggle login/logout UI
    if (loginBtn)  loginBtn.style.display = "none";
    if (logoutBtn) {
      logoutBtn.style.display = "inline-block";
      logoutBtn.onclick = async () => {
        try { await api("/auth/logout", { method: "POST" }); } catch(_) {}
        location.reload();
      };
    }

    // --- Header ---
    const orcidUrl = me?.orcid ? `https://orcid.org/${me.orcid}` : "#";
    userHeader.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:1rem;">
        <div>
          <h1 style="margin:.25rem 0 0;">${escapeHtml(me.name || "Your Home")}</h1>
          <p style="margin:.25rem 0;">
            <strong>ORCID:</strong> ${me.orcid ? `<a href="${orcidUrl}" target="_blank" rel="noopener">${me.orcid}</a>` : "—"}
            &nbsp;&nbsp; ${me.affiliation ? `| <strong>Affiliation:</strong> ${escapeHtml(me.affiliation)}` : ""}
          </p>
          <p id="syncStatus" class="muted" style="margin:.25rem 0;">Synchronisation status: <span id="syncText">Loading…</span></p>
        </div>
        <div class="quick-actions" style="display:flex; gap:.5rem; flex-wrap:wrap;">
          <a class="btn" href="library.html#add">Add to library</a>
          <a class="btn" href="projects-new.html">New project</a>
          <a class="btn" href="materials-new.html">Upload material</a>
          <a class="btn" href="settings-identity.html">Link account</a>
        </div>
      </div>
    `;

    // --- Identity / linking status ---
    try {
      const ident = await api("/api/identity/status"); // { orcid:true, github:false, scholar:false, osf:false, zenodo:false, last_sync:iso }
      const bits = [];
      bits.push(`${ident.orcid ? "✅" : "⚠️"} ORCID`);
      if ("github" in ident)  bits.push(`${ident.github ? "✅" : "—"} GitHub`);
      if ("scholar" in ident) bits.push(`${ident.scholar ? "✅" : "—"} Google Scholar`);
      if ("osf" in ident)     bits.push(`${ident.osf ? "✅" : "—"} OSF`);
      if ("zenodo" in ident)  bits.push(`${ident.zenodo ? "✅" : "—"} Zenodo`);
      identityBox.innerHTML = `
        <p style="margin:.25rem 0;">${bits.join(" &middot; ")}</p>
        <p class="muted" style="margin:.25rem 0;">Last sync: ${fmtDate(ident.last_sync)}</p>
      `;
      const syncText = document.getElementById("syncText");
      if (syncText) syncText.textContent = ident.last_sync ? fmtDate(ident.last_sync) : "never";
    } catch {
      identityBox.textContent = "Could not load identity status.";
      const syncText = document.getElementById("syncText");
      if (syncText) syncText.textContent = "unknown";
    }

    // --- Today / this week (actions & alerts) ---
    try {
      const due = await api("/api/alerts"); // [{id,type,title,due_at,link}]
      renderSimpleList(todayList, due, (a) => `
        <li>
          <a href="${escapeHtml(a.link || '#')}">${escapeHtml(a.title || a.type || "Item")}</a>
          <span class="muted"> · due ${fmtDate(a.due_at)}</span>
        </li>
      `, "Nothing scheduled.");
    } catch { todayList.innerHTML = `<li class="muted">No items.</li>`; }

    // --- Activity ---
    async function loadActivity(scope = "all") {
      try {
        const items = await api(`/api/activity?scope=${encodeURIComponent(scope)}`); // [{id,verb,object,when,link}]
        renderSimpleList(activityList, items, (ev) => `
          <li>
            <span>${escapeHtml(ev.verb || "Updated")} ${escapeHtml(ev.object || "")}</span>
            ${ev.link ? ` · <a href="${escapeHtml(ev.link)}">open</a>` : ""}
            <span class="muted"> · ${fmtDate(ev.when)}</span>
          </li>
        `, "No recent activity.");
      } catch {
        activityList.innerHTML = `<li class="muted">Could not load activity.</li>`;
      }
    }
    activityScope?.addEventListener("change", (e) => loadActivity(e.target.value));
    document.getElementById("refreshActivityBtn")?.addEventListener("click", () => loadActivity(activityScope?.value || "all"));
    await loadActivity("all");

    // --- Projects snapshot ---
    try {
      const projects = await api("/api/projects?limit=6"); // [{id,title,stage,open_tasks,last_active,summary}]
      if (!projects || !projects.length) {
        projectsGrid.innerHTML = `<p class="muted">No projects yet. <a href="projects-new.html">Create your first project</a>.</p>`;
      } else {
        projectsGrid.innerHTML = projects.map(p => `
          <article class="card" style="background:#fafafa; border-radius:10px; padding:1rem;">
            <h3 style="margin-top:0;"><a href="project.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title)}</a></h3>
            <p class="muted" style="margin:.25rem 0;">${escapeHtml(p.summary || "")}</p>
            <p style="margin:.25rem 0;">${p.stage ? badge(p.stage) : ""} ${typeof p.open_tasks === "number" ? badge(`${p.open_tasks} open tasks`) : ""}</p>
            <p class="muted" style="margin:.25rem 0;">Last active: ${fmtDate(p.last_active)}</p>
          </article>
        `).join("");
      }
    } catch {
      projectsGrid.innerHTML = `<p class="muted">Could not load projects.</p>`;
    }

    // --- Materials in progress ---
    try {
      const materials = await api("/api/materials?limit=8"); // [{id,type,title,status,updated_at,link}]
      renderSimpleList(materialsList, materials, (m) => `
        <li>
          ${badge(m.type || "material")} <a href="${escapeHtml(m.link || `material.html?id=${encodeURIComponent(m.id)}`)}">${escapeHtml(m.title || "Untitled")}</a>
          <span class="muted"> · ${escapeHtml(m.status || "draft")} · ${fmtDate(m.updated_at)}</span>
        </li>
      `, "No materials yet. Try <a href='materials-new.html'>uploading a file</a> or creating a draft.");
    } catch {
      materialsList.innerHTML = `<li class="muted">Could not load materials.</li>`;
    }

    // --- Library (quick access + stats + sidebar list preserves your remove flow) ---
    let libItems = [];
    try {
      libItems = await api("/api/library"); // [{id,title,labels:["starred","to-read",...], saved_at}]
    } catch {}
    if (Array.isArray(libItems)) {
      // Stats
      if (libCountEl) libCountEl.textContent = String(libItems.length || 0);

      // Quick access buckets
      fillBucket(libRecent, sortByDate(libItems).slice(0, 6), "saved_at");
      fillBucket(libToRead, libItems.filter(i => hasLabel(i, "to-read")).slice(0, 6));
      fillBucket(libStarred, libItems.filter(i => hasLabel(i, "starred")).slice(0, 6));

      // Sidebar detailed list (with remove buttons intact)
      renderLibrarySidebar(libraryList, libItems, libCountEl);
    }

    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (!confirm("Remove all items from your library?")) return;
        try {
          await api("/api/library", { method: "DELETE" });
          [libRecent, libToRead, libStarred, libraryList].forEach(ul => { if (ul) ul.innerHTML = "<li>—</li>"; });
          if (libCountEl) libCountEl.textContent = "0";
        } catch { alert("Failed to clear library."); }
      };
    }

    // --- Following (local) ---
    await loadFollowingFeed();
    followingBtn?.addEventListener("click", loadFollowingFeed);
    if (followListEl) {
      followListEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-unfollow]");
        if (!btn) return;
        const id = btn.getAttribute("data-unfollow");
        const next = readFollows().filter((f) => f.id !== id);
        saveFollows(next);
        renderFollowedAuthors(next);
        loadFollowingFeed();
      });
    }

    // --- Claims / Merge UI (existing feature) ---
    await renderClaimsUI();

  } catch (e) {
    // Not logged in yet (or error): keep prior behaviour
    console.warn(e);
    const userMain = document.getElementById("userMain");
    const sidebar = document.getElementById("userSidebar");
    const userHeader = document.getElementById("userHeader");
    if (userHeader) userHeader.innerHTML = `<h1>Sign in to view your home</h1>`;
    if (userMain) userMain.innerHTML = `
      <section class="panel" style="background:#fff; padding:1rem; border-radius:10px;">
        <p>Use the green ORCID button in the header.</p>
      </section>`;
    if (sidebar) sidebar.innerHTML = `<section class="panel" style="background:#fff; padding:1rem; border-radius:10px;"><p>Sign in to see your stats and tools.</p></section>`;
    const loginBtn = document.getElementById("orcidLoginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
}

// --- helpers ---

function renderSimpleList(ul, items, tpl, emptyMsg = "Nothing here.") {
  if (!ul) return;
  if (!items || !items.length) { ul.innerHTML = `<li class="muted">${emptyMsg}</li>`; return; }
  ul.innerHTML = items.map(tpl).join("");
}

function sortByDate(arr, key = "saved_at") {
  return [...(arr || [])].sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0));
}

function hasLabel(item, label) {
  return Array.isArray(item?.labels) && item.labels.includes(label);
}

function fillBucket(ul, items, dateKey) {
  if (!ul) return;
  if (!items || !items.length) { ul.innerHTML = `<li class="muted">—</li>`; return; }
  ul.innerHTML = items.map(i => `
    <li>
      <a href="paper.html?id=${encodeURIComponent(i.id)}">${escapeHtml(i.title || "Untitled")}</a>
      ${dateKey ? `<span class="muted"> · ${fmtDate(i[dateKey])}</span>` : ""}
    </li>
  `).join("");
}

// Sidebar library list with remove buttons (keeps your original behaviour)
function renderLibrarySidebar(listEl, items, libCountEl) {
  if (!listEl) return;
  if (!items || !items.length) {
    listEl.innerHTML = "<li>No papers saved yet.</li>";
    if (libCountEl) libCountEl.textContent = "0";
    return;
  }
  listEl.innerHTML = items.slice(0, 10).map(p => `
    <li style="margin:.25rem 0; display:flex; justify-content:space-between; gap:.5rem;">
      <span><a href="paper.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title || "Untitled")}</a></span>
      <span>
        <button data-id="${encodeURIComponent(p.id)}" class="removeBtn" style="margin-left:.5rem;">Remove</button>
      </span>
    </li>
  `).join("");

  // Wire remove buttons
  [...document.querySelectorAll(".removeBtn")].forEach((btn) => {
    let busy = false;
    btn.onclick = async () => {
      if (busy) return; busy = true;
      try {
        const id = btn.getAttribute("data-id");
        await api(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
        const li = btn.closest("li");
        if (li) li.remove();
        const remain = document.querySelectorAll("#userLibraryList li").length;
        if (libCountEl) libCountEl.textContent = String(remain);
      } catch {
        alert("Failed to remove item.");
      } finally {
        busy = false;
      }
    };
  });
}

// --- Following feed ---
async function fetchRecentWorksFor(authorId, limit = 2) {
  const url = addMailto(`${OPENALEX}/works?filter=authorships.author.id:${encodeURIComponent(authorId)}&sort=publication_date:desc&per_page=${limit}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load works");
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

function renderFollowedAuthors(list) {
  const ul = document.getElementById("followedList");
  if (!ul) return;
  if (!list.length) {
    ul.innerHTML = '<li class="muted">Not following anyone yet.</li>';
    return;
  }
  ul.innerHTML = list.map((f) => `
    <li style="display:flex; justify-content:space-between; gap:.5rem; align-items:center;">
      <span><a href="profile.html?id=${encodeURIComponent(f.id)}">${escapeHtml(f.name || f.id)}</a></span>
      <button class="btn btn-small" data-unfollow="${encodeURIComponent(f.id)}">Unfollow</button>
    </li>
  `).join("");
}

function renderFollowUpdates(entries) {
  const ul = document.getElementById("followedUpdates");
  if (!ul) return;
  if (!entries.length) {
    ul.innerHTML = '<li class="muted">No new works yet.</li>';
    return;
  }
  entries.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  ul.innerHTML = entries.slice(0, 12).map((item) => `
    <li>
      <a href="${escapeHtml(item.link)}">${escapeHtml(item.title || "Untitled")}</a>
      <span class="muted"> · ${escapeHtml(item.author || "")} · ${fmtDate(item.date)}</span>
    </li>
  `).join("");
}

async function loadFollowingFeed() {
  const follows = readFollows();
  renderFollowedAuthors(follows);
  const updatesBox = document.getElementById("followedUpdates");
  if (!follows.length) {
    if (updatesBox) updatesBox.innerHTML = '<li class="muted">Follow researchers to see updates.</li>';
    return;
  }
  if (updatesBox) updatesBox.innerHTML = '<li class="muted">Loading updates…</li>';

  const entries = [];
  for (const f of follows.slice(0, 8)) {
    try {
      const works = await fetchRecentWorksFor(f.id, 2);
      works.forEach((w) => {
        entries.push({
          author: f.name || f.id,
          title: w.title,
          date: w.publication_date || w.publication_year,
          link: w.id ? w.id.replace("https://openalex.org/", "paper.html?id=") : "#",
        });
      });
    } catch {
      // keep going
    }
  }
  renderFollowUpdates(entries);
}

// ---- Claim / Merge UI (profile sidebar) ----
async function renderClaimsUI() {
  const container = document.getElementById("claimsPanel");
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; gap:.5rem; align-items:center; margin-bottom:.5rem;">
      <input id="claimAuthorId" class="input" placeholder="Enter OpenAlex Author ID, e.g., A1969205033" style="flex:1;">
      <button id="claimBtn" class="btn">Claim</button>
    </div>
    <div id="claimsList" class="muted">Loading…</div>
    <hr/>
    <h4 style="margin:.5rem 0;">Merge profiles</h4>
    <div style="display:flex; gap:.5rem; align-items:center;">
      <select id="mergePrimary"></select>
      <select id="mergeSecondary"></select>
      <button id="mergeBtn" class="btn">Merge</button>
    </div>
    <div id="mergesList" class="muted" style="margin-top:.5rem;"></div>
  `;

  async function safeJSON(res) { try { return await res.json(); } catch { return {}; } }

  async function refreshClaims() {
    try {
      const res = await fetch("/api/claims", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await safeJSON(res);

      const claimsEl = container.querySelector("#claimsList");
      const mergesEl = container.querySelector("#mergesList");
      if (!data.claims || !data.claims.length) {
        claimsEl.innerHTML = "<p class='muted'>No claimed profiles yet.</p>";
      } else {
        claimsEl.innerHTML = data.claims.map(c =>
          `<div style="display:flex; justify-content:space-between; margin:.25rem 0;">
            <span><strong>${c.author_id}</strong> ${c.verified ? "✅" : "⚠️"}</span>
            <button class="btn btn-small" data-unclaim="${c.author_id}">Remove</button>
          </div>`
        ).join("");

        const opts = data.claims.map(c => `<option value="${c.author_id}">${c.author_id}</option>`).join("");
        container.querySelector("#mergePrimary").innerHTML   = `<option value="">Primary…</option>${opts}`;
        container.querySelector("#mergeSecondary").innerHTML = `<option value="">Secondary…</option>${opts}`;
      }

      mergesEl.innerHTML = (data.merges && data.merges.length)
        ? data.merges.map(m =>
            `<div>${m.primary_author_id} ⟵ ${m.merged_author_id}
               <button class="btn btn-small" data-unmerge="${m.primary_author_id}|${m.merged_author_id}">Undo</button>
             </div>`
          ).join("")
        : "<p class='muted'>No merges yet.</p>";
    } catch {
      container.querySelector("#claimsList").innerHTML = "<p class='muted'>Could not load claimed profiles.</p>";
      container.querySelector("#mergesList").innerHTML = "<p class='muted'>Could not load merges.</p>";
    }
  }

  container.querySelector("#claimBtn").onclick = async () => {
    const input = container.querySelector("#claimAuthorId");
    const v = input.value.trim();
    if (!/^A\d+$/.test(v)) { alert("Please enter a valid OpenAlex Author ID, e.g., A1969205033"); return; }
    try {
      await fetch("/api/claims", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author_id: v })
      });
      input.value = "";
      await refreshClaims();
    } catch {
      alert("Could not claim this author ID.");
    }
  };

  container.addEventListener("click", async (e) => {
    const un = e.target.closest("[data-unclaim]");
    if (un) {
      const id = un.getAttribute("data-unclaim");
      try {
        await fetch(`/api/claims/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
        await refreshClaims();
      } catch {
        alert("Failed to remove claim.");
      }
    }
    const um = e.target.closest("[data-unmerge]");
    if (um) {
      const [p, s] = um.getAttribute("data-unmerge").split("|");
      const url = `/api/claims/merge?primary_author_id=${encodeURIComponent(p)}&merged_author_id=${encodeURIComponent(s)}`;
      try {
        await fetch(url, { method: "DELETE", credentials: "include" });
        await refreshClaims();
      } catch {
        alert("Failed to undo merge.");
      }
    }
  });

  container.querySelector("#mergeBtn").onclick = async () => {
    const p = container.querySelector("#mergePrimary").value;
    const s = container.querySelector("#mergeSecondary").value;
    if (!p || !s || p === s) { alert("Pick two different claimed IDs."); return; }
    try {
      await fetch("/api/claims/merge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary_author_id: p, merged_author_id: s })
      });
      await refreshClaims();
    } catch {
      alert("Failed to merge profiles.");
    }
  };

  await refreshClaims();
}

// Kick off
window.addEventListener("DOMContentLoaded", bootstrap);
