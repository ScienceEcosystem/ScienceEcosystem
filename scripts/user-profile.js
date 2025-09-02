// --- user-profile.js ---
// Production-grade profile page using real ORCID OAuth (server handles the flow).
// Preserves your layout and 'paper.html?id=...' links.

// Utility: simple fetch with JSON + credentials
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
  return res.headers.get("content-type")?.includes("application/json")
    ? res.json()
    : res.text();
}

async function bootstrap() {
  const userMain = document.getElementById("userMain");
  const userSidebar = document.getElementById("userSidebar");
  const loginBtn = document.getElementById("orcidLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  try {
    // 1) Get current session + profile from server (if logged in)
    const me = await api("/api/me");

    // Toggle login/logout UI
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    logoutBtn.onclick = async () => {
      await api("/auth/logout", { method: "POST" });
      location.reload();
    };

    // Render main profile
    const orcidUrl = `https://orcid.org/${me.orcid}`;
    userMain.innerHTML = `
      <h1>${escapeHtml(me.name || "Your Profile")}</h1>
      <p><strong>ORCID ID:</strong> <a href="${orcidUrl}" target="_blank" rel="noopener">${me.orcid}</a></p>
      <p><strong>Affiliation:</strong> ${escapeHtml(me.affiliation || "—")}</p>

      <section>
        <h2>My Library</h2>
        <ul id="userLibraryList" class="list-unstyled"></ul>
      </section>

      <section>
        <h2>My Topics</h2>
        <p id="userTopics">No topics yet.</p>
      </section>

      <section>
        <h2>Analytics</h2>
        <p id="userAnalytics">No analytics available yet.</p>
      </section>
    `;

    // Sidebar
    const lib = await api("/api/library");
    userSidebar.innerHTML = `
      <h3>Library Stats</h3>
      <p><strong>Total Papers Saved:</strong> ${lib.length}</p>
      <button id="clearLibBtn" style="margin-top:.5rem;">Clear Library</button>
    `;

    document.getElementById("clearLibBtn").onclick = async () => {
      if (!confirm("Remove all items from your library?")) return;
      await api("/api/library", { method: "DELETE" });
      location.reload();
    };

    renderLibrary(lib);
  } catch (e) {
    // Not logged in yet or error: show login button, simple placeholder
    console.warn(e);
    userMain.innerHTML = `
      <h1>Sign in to view your profile</h1>
      <p>Use the green ORCID button in the header.</p>
    `;
    userSidebar.innerHTML = `<p>Sign in to see your library stats.</p>`;
    // Ensure login button visible
    const loginBtn = document.getElementById("orcidLoginBtn");
    if (loginBtn) loginBtn.style.display = "inline-flex";
  }
}

function renderLibrary(items) {
  const list = document.getElementById("userLibraryList");
  if (!list) return;
  if (!items || items.length === 0) {
    list.innerHTML = "<li>No papers saved yet.</li>";
    return;
  }
  list.innerHTML = items
    .map(
      (p) => `
      <li style="margin:.25rem 0; display:flex; justify-content:space-between; gap:.5rem;">
        <span>${escapeHtml(p.title)}</span>
        <span>
          <a href="paper.html?id=${encodeURIComponent(p.id)}">[View]</a>
          <button data-id="${encodeURIComponent(p.id)}" class="removeBtn" style="margin-left:.5rem;">Remove</button>
        </span>
      </li>`
    )
    .join("");

  [...document.querySelectorAll(".removeBtn")].forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      await api(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
      // Update UI
      btn.closest("li").remove();
    };
  });
}

// Public function other pages can call to save a paper
// Keep signature compatible with your existing 'savePaper(paper)'
window.savePaper = async function savePaper(paper) {
  // Paper: { id, title }
  try {
    await api("/api/library", { method: "POST", body: JSON.stringify(paper) });
    alert(`Saved "${paper.title}" to your library`);
  } catch (e) {
    alert(e.message);
  }
};

// Simple HTML escape
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Kick off
window.addEventListener("DOMContentLoaded", bootstrap);
