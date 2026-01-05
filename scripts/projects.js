// projects.js - handles project list and creation pages
async function projApi(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function ensureSession(loginBtn, logoutBtn) {
  try {
    await projApi("/api/me");
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) {
      logoutBtn.style.display = "inline-block";
      logoutBtn.onclick = async () => {
        try { await projApi("/auth/logout", { method: "POST" }); } catch {}
        location.reload();
      };
    }
    return true;
  } catch {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
    return false;
  }
}

async function setupProjectsNew() {
  const form = document.getElementById("form");
  const msg = document.getElementById("msg");
  if (!form) return;

  const loggedIn = await ensureSession(
    document.getElementById("orcidLoginBtn"),
    document.getElementById("logoutBtn")
  );
  if (!loggedIn) msg.textContent = "Please sign in with ORCID before creating a project.";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "Creating…";
    const payload = {
      title: document.getElementById("title").value.trim(),
      summary: document.getElementById("summary").value.trim(),
      stage: document.getElementById("stage").value
    };
    if (!payload.title) { msg.textContent = "Title is required."; return; }
    try {
      const created = await projApi("/api/projects", { method: "POST", body: JSON.stringify(payload) });
      msg.textContent = "Created.";
      if (created?.id) {
        setTimeout(() => location.href = `project.html?id=${encodeURIComponent(created.id)}`, 150);
      } else {
        setTimeout(() => location.href = "projects.html", 150);
      }
    } catch (err) {
      msg.textContent = "Failed to create project.";
      console.error(err);
    }
  });
}

async function setupProjectsList() {
  const q = document.getElementById("q");
  const stage = document.getElementById("stage");
  const sort = document.getElementById("sort");
  const grid = document.getElementById("grid");
  const empty = document.getElementById("emptyMsg");
  if (!grid) return;

  await ensureSession(
    document.getElementById("orcidLoginBtn"),
    document.getElementById("logoutBtn")
  );

  async function fetchProjects() {
    const params = new URLSearchParams();
    if (q?.value.trim()) params.set("q", q.value.trim());
    if (stage?.value) params.set("stage", stage.value);
    params.set("sort", sort?.value || "recent");
    params.set("limit", "24");
    try {
      const items = await projApi(`/api/projects?${params.toString()}`);
      render(items || []);
    } catch (e) {
      console.error(e);
      grid.innerHTML = "";
      if (empty) empty.style.display = "block";
    }
  }

  function render(items) {
    if (!items.length) {
      grid.innerHTML = "";
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";
    grid.innerHTML = items.map(p => `
      <article class="card" style="background:#fafafa; border-radius:10px; padding:1rem;">
        <h3 style="margin-top:0;"><a href="project.html?id=${encodeURIComponent(p.id)}">${escHtml(p.title||"Untitled project")}</a></h3>
        <p class="muted" style="margin:.25rem 0;">${escHtml(p.summary||"")}</p>
        <p style="margin:.25rem 0;">
          ${p.stage ? `<span class="badge" style="background:#eef; padding:.1rem .4rem; border-radius:999px;">${escHtml(p.stage)}</span>` : ""}
          ${typeof p.open_tasks === "number" ? `<span class="badge" style="background:#efe; padding:.1rem .4rem; border-radius:999px;">${p.open_tasks} open tasks</span>` : ""}
        </p>
        <p class="muted" style="margin:.25rem 0;">Last active: ${p.last_active ? new Date(p.last_active).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}) : "-"}</p>
      </article>
    `).join("");
  }

  document.getElementById("applyBtn")?.addEventListener("click", fetchProjects);
  document.getElementById("resetBtn")?.addEventListener("click", () => {
    if (q) q.value = "";
    if (stage) stage.value = "";
    if (sort) sort.value = "recent";
    fetchProjects();
  });

  fetchProjects();
}

window.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "projects-new") setupProjectsNew();
  if (page === "projects") setupProjectsList();
});
