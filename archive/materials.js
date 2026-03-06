// materials.js - handles material creation and listing
async function matApi(path, opts = {}) {
  const res = await fetch(path, { credentials: "include", ...opts });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function ensureMatSession(loginBtn, logoutBtn) {
  try {
    await matApi("/api/me");
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) {
      logoutBtn.style.display = "inline-block";
      logoutBtn.onclick = async () => { try { await matApi("/auth/logout", { method: "POST" }); } catch {} location.reload(); };
    }
    return true;
  } catch {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
    return false;
  }
}

async function setupMaterialsNew() {
  const msg = document.getElementById("msg");
  await ensureMatSession(
    document.getElementById("orcidLoginBtn"),
    document.getElementById("logoutBtn")
  );

  async function loadProjects() {
    const select = document.getElementById("projectSelect");
    if (!select) return;
    try {
      const rows = await matApi("/api/projects?limit=100");
      select.innerHTML = '<option value="">-</option>' + rows.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("");
    } catch {
      select.innerHTML = '<option value="">-</option>';
    }
  }

  async function create() {
    msg.textContent = "Creating…";
    const fd = new FormData();
    fd.append("title", document.getElementById("title").value.trim());
    fd.append("type", document.getElementById("type").value);
    fd.append("status", document.getElementById("status").value);
    fd.append("project_id", document.getElementById("projectSelect").value);
    fd.append("description", document.getElementById("description").value.trim());
    const file = document.getElementById("fileInput")?.files?.[0];
    if (file) fd.append("file", file);
    try {
      const res = await fetch("/api/materials", { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error(await res.text());
      msg.textContent = "Created. Redirecting…";
      const obj = await res.json().catch(() => ({}));
      const id = obj.id;
      setTimeout(() => { location.href = id ? `material.html?id=${encodeURIComponent(id)}` : "materials.html"; }, 300);
    } catch (e) {
      console.error(e);
      msg.textContent = "Failed to create material.";
    }
  }

  document.getElementById("createBtn")?.addEventListener("click", (e) => { e.preventDefault(); create(); });
  loadProjects();
}

async function setupMaterialsList() {
  const grid = document.getElementById("materialsGrid");
  const empty = document.getElementById("emptyState");
  if (!grid) return;
  await ensureMatSession(
    document.getElementById("orcidLoginBtn"),
    document.getElementById("logoutBtn")
  );

  let items = [];
  try {
    items = await matApi("/api/materials?limit=100");
  } catch {
    grid.innerHTML = "<p class='muted'>Could not load materials.</p>";
    return;
  }

  function card(m) {
    const link = m.link || `material.html?id=${encodeURIComponent(m.id)}`;
    return `
      <article class="card" style="background:#fafafa; border-radius:10px; padding:1rem;">
        <h3 style="margin-top:0;"><a href="${link}">${esc(m.title||"Untitled")}</a></h3>
        <p style="margin:.25rem 0;">Type: <strong>${esc(m.type||"material")}</strong> · Status: <strong>${esc(m.status||"draft")}</strong></p>
        <p class="muted" style="margin:.25rem 0;">Updated: ${new Date(m.updated_at||Date.now()).toLocaleString()}</p>
      </article>`;
  }

  function apply() {
    const q = (document.getElementById("q")?.value || "").toLowerCase();
    const t = document.getElementById("typeFilter")?.value || "";
    const s = document.getElementById("statusFilter")?.value || "";
    const f = items.filter(m =>
      (!q || ((m.title||"").toLowerCase().includes(q) || (m.type||"").toLowerCase().includes(q))) &&
      (!t || m.type === t) &&
      (!s || m.status === s)
    );
    if (!f.length) {
      grid.innerHTML = "";
      if (empty) empty.style.display = "block";
    } else {
      if (empty) empty.style.display = "none";
      grid.innerHTML = f.map(card).join("");
    }
  }

  ["q","typeFilter","statusFilter"].forEach(id => document.getElementById(id)?.addEventListener("input", apply));
  apply();
}

window.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "materials-new") setupMaterialsNew();
  if (page === "materials") setupMaterialsList();
});
