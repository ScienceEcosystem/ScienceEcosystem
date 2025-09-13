(async function () {
  const body = document.getElementById("libBody");
  const input = document.getElementById("libSearch");
  const clear = document.getElementById("libClear");

  async function fetchLib() {
    try {
      const res = await fetch("/api/library", { credentials: "include" });
      if (!res.ok) throw new Error("Not signed in");
      return await res.json();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="2">Please <a href="/auth/orcid/login">sign in</a> to view your library.</td></tr>`;
      throw e;
    }
  }

  function render(items) {
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="2">No papers yet.</td></tr>`;
      return;
    }
    body.innerHTML = items.map(p => `
      <tr data-id="${p.id}">
        <td>
          <a href="paper.html?id=${encodeURIComponent(p.id)}">${(p.title || "").replace(/&/g,"&amp;").replace(/</g,"&lt;")}</a>
        </td>
        <td>
          <button class="btn btn-secondary" data-action="open">Open</button>
          <button class="btn" data-action="remove">Remove</button>
        </td>
      </tr>
    `).join("");
  }

  function filterRows() {
    const q = (input.value || "").toLowerCase();
    for (const tr of body.querySelectorAll("tr")) {
      const txt = tr.querySelector("td")?.textContent?.toLowerCase() || "";
      tr.style.display = txt.includes(q) ? "" : "none";
    }
  }

  body.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    const id = tr?.getAttribute("data-id");
    if (!id) return;
    const act = e.target.closest("[data-action]")?.getAttribute("data-action");
    if (act === "open") {
      location.href = `paper.html?id=${encodeURIComponent(id)}`;
    } else if (act === "remove") {
      await fetch(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      tr.remove();
    }
  });

  input.addEventListener("input", filterRows);
  clear.addEventListener("click", async () => {
    if (!confirm("Clear entire library?")) return;
    await fetch("/api/library", { method: "DELETE", credentials: "include" });
    render([]);
  });

  try {
    const items = await fetchLib();
    render(items);
  } catch { /* handled in fetchLib */ }
})();
