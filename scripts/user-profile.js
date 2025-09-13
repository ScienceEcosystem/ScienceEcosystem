// --- user-profile.js ---
// Production-grade profile page using real ORCID OAuth (server handles the flow).
// Preserves your layout and 'paper.html?id=...' links.

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
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

async function bootstrap() {
  const userMain   = document.getElementById("userMain");
  const userSidebar= document.getElementById("userSidebar");
  const loginBtn   = document.getElementById("orcidLoginBtn");
  const logoutBtn  = document.getElementById("logoutBtn");

  try {
    // 1) Get current session + profile (throws if not signed in)
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

    // Render main profile
    const orcidUrl = `https://orcid.org/${me.orcid}`;
    userMain.innerHTML = `
      <h1>${escapeHtml(me.name || "Your Profile")}</h1>
      <p><strong>ORCID ID:</strong> <a href="${orcidUrl}" target="_blank" rel="noopener">${me.orcid}</a></p>
      <p><strong>Affiliation:</strong> ${escapeHtml(me.affiliation || "—")}</p>

      

      <section>
        <h2>My Topics</h2>
        <p id="userTopics">No topics yet.</p>
      </section>

      <section>
        <h2>Analytics</h2>
        <p id="userAnalytics">No analytics available yet.</p>
      </section>
    `;

    // Sidebar: library stats
    const lib = await api("/api/library");
    userSidebar.innerHTML = `
      <h3>Library Stats</h3>
      <p><strong>Total Papers Saved:</strong> <span id="libCount">${lib.length}</span></p>
      <button id="clearLibBtn" style="margin-top:.5rem;">Clear Library</button>
    `;

    const libCountEl = document.getElementById("libCount");
    const clearBtn = document.getElementById("clearLibBtn");
    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (!confirm("Remove all items from your library?")) return;
        await api("/api/library", { method: "DELETE" });
        renderLibrary([]);
        if (libCountEl) libCountEl.textContent = "0";
      };
    }

    // Claims/Merge UI
    await renderClaimsUI();

    // Library list
    renderLibrary(lib);
  } catch (e) {
    // Not logged in yet or error: show login prompt
    console.warn(e);
    userMain.innerHTML = `
      <h1>Sign in to view your profile</h1>
      <p>Use the green ORCID button in the header.</p>
    `;
    userSidebar.innerHTML = `<p>Sign in to see your library stats.</p>`;
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
}

function renderLibrary(items) {
  const list = document.getElementById("userLibraryList");
  const libCountEl = document.getElementById("libCount");
  if (!list) return;

  if (!items || items.length === 0) {
    list.innerHTML = "<li>No papers saved yet.</li>";
    if (libCountEl) libCountEl.textContent = "0";
    return;
  }

  list.innerHTML = items.map(p => `
    <li style="margin:.25rem 0; display:flex; justify-content:space-between; gap:.5rem;">
      <span>${escapeHtml(p.title)}</span>
      <span>
        <a href="paper.html?id=${encodeURIComponent(p.id)}">[View]</a>
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
        // Update count
        const remain = document.querySelectorAll("#userLibraryList li").length;
        if (libCountEl) libCountEl.textContent = String(remain);
      } catch (err) {
        alert("Failed to remove item.");
      } finally {
        busy = false;
      }
    };
  });
}

// ---- Claim / Merge UI (profile sidebar) ----
async function renderClaimsUI() {
  const sidebar = document.getElementById("userSidebar");
  if (!sidebar) return;

  const wrap = document.createElement("section");
  wrap.className = "panel";
  wrap.innerHTML = `
    <h3>Claimed Profiles (OpenAlex)</h3>
    <div style="display:flex; gap:.5rem; align-items:center; margin-bottom:.5rem;">
      <input id="claimAuthorId" class="input" placeholder="Enter OpenAlex Author ID, e.g., A1969205033" style="flex:1;">
      <button id="claimBtn" class="btn">Claim</button>
    </div>
    <div id="claimsList" class="muted">Loading…</div>
    <hr/>
    <h4>Merge Profiles</h4>
    <div style="display:flex; gap:.5rem; align-items:center;">
      <select id="mergePrimary"></select>
      <select id="mergeSecondary"></select>
      <button id="mergeBtn" class="btn">Merge</button>
    </div>
    <div id="mergesList" class="muted" style="margin-top:.5rem;"></div>
  `;
  sidebar.appendChild(wrap);

  async function safeJSON(res) {
    try { return await res.json(); } catch { return {}; }
  }

  async function refreshClaims() {
    try {
      const res = await fetch("/api/claims", { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await safeJSON(res);

      const claimsEl = wrap.querySelector("#claimsList");
      const mergesEl = wrap.querySelector("#mergesList");
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
        wrap.querySelector("#mergePrimary").innerHTML   = `<option value="">Primary…</option>${opts}`;
        wrap.querySelector("#mergeSecondary").innerHTML = `<option value="">Secondary…</option>${opts}`;
      }

      mergesEl.innerHTML = (data.merges && data.merges.length)
        ? data.merges.map(m =>
            `<div>${m.primary_author_id} ⟵ ${m.merged_author_id}
               <button class="btn btn-small" data-unmerge="${m.primary_author_id}|${m.merged_author_id}">Undo</button>
             </div>`
          ).join("")
        : "<p class='muted'>No merges yet.</p>";
    } catch {
      wrap.querySelector("#claimsList").innerHTML = "<p class='muted'>Could not load claimed profiles.</p>";
      wrap.querySelector("#mergesList").innerHTML = "<p class='muted'>Could not load merges.</p>";
    }
  }

  wrap.querySelector("#claimBtn").onclick = async () => {
    const input = wrap.querySelector("#claimAuthorId");
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

  wrap.addEventListener("click", async (e) => {
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

  wrap.querySelector("#mergeBtn").onclick = async () => {
    const p = wrap.querySelector("#mergePrimary").value;
    const s = wrap.querySelector("#mergeSecondary").value;
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
