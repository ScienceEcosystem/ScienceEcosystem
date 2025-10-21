/* scripts/funder.js */
(function () {
  if (!document.body || document.body.dataset.page !== "funder") return;

  const API = "https://api.openalex.org";
  const MAILTO = "info@scienceecosystem.org";
  const UAQS = `mailto=${encodeURIComponent(MAILTO)}`;

  // Elements
  const nameEl = document.getElementById("funderName");
  const linksEl = document.getElementById("funderLinks");
  const summaryEl = document.getElementById("funderSummary");
  const totalWorksEl = document.getElementById("totalWorks");
  const totalCitesEl = document.getElementById("totalCitations");

  const worksListEl = document.getElementById("worksList");
  const worksPaginationEl = document.getElementById("worksPagination");
  const workSortEl = document.getElementById("workSort");

  const trendChartsEl = document.getElementById("trendCharts");
  const topResearchersEl = document.getElementById("topResearchers");
  const topInstitutionsEl = document.getElementById("topInstitutions");

  let currentFunder = null;
  let cursor = "*";
  let nextCursor = null;
  const perPage = 25;

  // Helpers
  function withMailto(url) {
    return url + (url.includes("?") ? "&" : "?") + UAQS;
  }
  async function fetchJson(url, { signal } = {}) {
    let tries = 0;
    while (tries < 4) {
      const res = await fetch(withMailto(url), { signal });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * (tries + 1)));
        tries++; continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.json();
    }
    throw new Error("Too many retries");
  }
  function qsParam(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }
  function linkify(url, text) {
    if (!url) return "";
    return `<a href="${url}" target="_blank" rel="noopener">${text || url}</a>`;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function fmtInt(n) { return (n ?? 0).toLocaleString(); }

  function renderLinks(f) {
    const parts = [];
    if (f.homepage_url) parts.push(linkify(f.homepage_url, "Website"));
    if (f.ror) {
      const rid = f.ror.replace(/^https?:\/\/ror\.org\//, "");
      parts.push(`<a href="https://ror.org/${rid}" target="_blank" rel="noopener">ROR</a>`);
    }
    parts.push(`<a href="https://openalex.org/${f.id}" target="_blank" rel="noopener">OpenAlex</a>`);
    linksEl.innerHTML = parts.join(" · ");
  }

  function renderSummary(f) {
    const bits = [];
    if (f.display_name) bits.push(`<strong>${f.display_name}</strong>`);
    const meta = [f.type, f.country_code].filter(Boolean).join(" · ");
    if (meta) bits.push(`<span class="muted">${meta}</span>`);
    summaryEl.innerHTML = bits.join("<br/>") || "No summary available.";
  }

  function workCard(w) {
    const title = w.display_name || "(Untitled)";
    const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "";
    const year = w.publication_year || "";
    const cites = w.cited_by_count ?? 0;
    const authors = (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).slice(0, 6).join(", ") + ((w.authorships?.length || 0) > 6 ? " et al." : "");

    const aHref = `paper.html?id=${encodeURIComponent(w.id)}`;
    return `
      <article class="pub-card">
        <h3 class="pub-title"><a href="${aHref}">${title}</a></h3>
        <p class="pub-meta muted">${[venue, year && `(${year})`, `${cites} citations`].filter(Boolean).join(" · ")}</p>
        ${authors ? `<p class="pub-authors">${authors}</p>` : ""}
      </article>
    `;
  }

  function renderWorks(list, meta) {
    worksListEl.innerHTML = list.map(workCard).join("") || `<p class="muted">No works found.</p>`;
    // Pagination (cursor-based; show a simple "Next" button)
    clear(worksPaginationEl);
    const controls = document.createElement("div");
    controls.className = "pager";
    const nextBtn = document.createElement("button");
    nextBtn.className = "btn";
    nextBtn.textContent = "Next";
    nextBtn.disabled = !meta?.next_cursor;
    nextBtn.addEventListener("click", async () => {
      await loadWorks(currentFunder.id, { sort: workSortEl.value, cursor: nextCursor || meta.next_cursor });
    });
    controls.appendChild(nextBtn);
    worksPaginationEl.appendChild(controls);
  }

  async function loadFunder(idOrQuery) {
    // If an ID is provided, fetch directly; else search
    if (/^F\d{6,}$/i.test(idOrQuery)) {
      const f = await fetchJson(`${API}/funders/${idOrQuery}`);
      return f;
    }
    const res = await fetchJson(`${API}/funders?search=${encodeURIComponent(idOrQuery)}&per_page=1`);
    return (res.results || [])[0] || null;
  }

  async function loadWorks(fid, { sort, cursor: cur }) {
    const url = new URL(`${API}/works`);
    url.searchParams.set("filter", `funder:${fid}`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("sort", sort || "publication_year:desc");
    url.searchParams.set("cursor", cur || "*");
    const data = await fetchJson(url.toString());
    nextCursor = data.meta?.next_cursor || null;
    renderWorks(data.results || [], data.meta || {});
  }

  async function groupTop(fid, groupBy, limit, hydrateEndpoint) {
    // group_by first to get IDs, then hydrate details
    const url = new URL(`${API}/works`);
    url.searchParams.set("filter", `funder:${fid}`);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("group_by", groupBy);
    url.searchParams.set("sort", "count:desc");
    const grouped = await fetchJson(url.toString());
    const ids = (grouped.group_by || []).map(g => g.key).filter(Boolean).slice(0, limit);
    if (!ids.length) return [];
    const idsParam = ids.map(encodeURIComponent).join("|");
    const detail = await fetchJson(`${API}/${hydrateEndpoint}?filter=id.search:${idsParam}&per_page=${limit}`);
    return detail.results || [];
  }

  function renderTopList(items, targetEl, type) {
    clear(targetEl);
    if (!items.length) {
      targetEl.innerHTML = `<li class="muted">No data.</li>`;
      return;
    }
    for (const it of items) {
      const li = document.createElement("li");
      li.className = "list-item";
      const a = document.createElement("a");
      if (type === "author") a.href = `researcher.html?id=${encodeURIComponent(it.id)}`;
      if (type === "institution") a.href = `institution.html?id=${encodeURIComponent(it.id)}`;
      a.textContent = it.display_name || "Unknown";
      const meta = document.createElement("div");
      meta.className = "muted";
      meta.textContent = `${fmtInt(it.works_count)} works · ${fmtInt(it.cited_by_count)} citations`;
      li.appendChild(a);
      li.appendChild(meta);
      targetEl.appendChild(li);
    }
  }

  function renderTrends(fid) {
    // Minimal placeholder (keeps parity with publisher page layout).
    // You can later replace with real charts; this shows year buckets.
    trendChartsEl.innerHTML = `<p class="muted">Loading yearly trend…</p>`;
    (async () => {
      try {
        const url = new URL(`${API}/works`);
        url.searchParams.set("filter", `funder:${fid}`);
        url.searchParams.set("per_page", "1");
        url.searchParams.set("group_by", "publication_year");
        url.searchParams.set("sort", "key:asc");
        const data = await fetchJson(url.toString());
        const points = (data.group_by || []).map(g => ({ year: g.key_display || g.key, count: g.count }));
        if (!points.length) {
          trendChartsEl.innerHTML = `<p class="muted">No trend data.</p>`;
          return;
        }
        const rows = points.map(p => `<div class="trend-row"><span>${p.year}</span><div class="trend-bar" style="width:${Math.min(100, Math.round((p.count / points[points.length-1].count) * 100))}%"></div><span class="muted">${fmtInt(p.count)}</span></div>`).join("");
        trendChartsEl.innerHTML = `<div class="trend-list">${rows}</div>`;
      } catch (e) {
        trendChartsEl.innerHTML = `<p class="muted">Trend unavailable.</p>`;
      }
    })();
  }

  async function init() {
    const id = qsParam("id");
    const q = qsParam("q");
    const src = id || q;
    if (!src) {
      nameEl.textContent = "Enter a funder via search";
      worksListEl.innerHTML = `<p class="muted">Open this page from search or supply <code>?id=F########</code> or <code>?q=</code> in the URL.</p>`;
      return;
    }
    const funder = await loadFunder(src);
    if (!funder) {
      nameEl.textContent = "Funder not found";
      worksListEl.innerHTML = `<p class="muted">No matching funder.</p>`;
      return;
    }
    currentFunder = funder;

    // Header
    nameEl.textContent = funder.display_name || "Unnamed funder";
    renderLinks(funder);
    renderSummary(funder);
    totalWorksEl.textContent = fmtInt(funder.works_count);
    totalCitesEl.textContent = fmtInt(funder.cited_by_count);

    // Lists
    await loadWorks(funder.id, { sort: workSortEl.value, cursor: "*" });
    renderTrends(funder.id);

    // Sidebars
    groupTop(funder.id, "authorships.author.id", 10, "authors")
      .then(list => renderTopList(list, topResearchersEl, "author"))
      .catch(() => { topResearchersEl.innerHTML = `<li class="muted">Unavailable.</li>`; });

    groupTop(funder.id, "institutions.id", 10, "institutions")
      .then(list => renderTopList(list, topInstitutionsEl, "institution"))
      .catch(() => { topInstitutionsEl.innerHTML = `<li class="muted">Unavailable.</li>`; });
  }

  // Events
  workSortEl.addEventListener("change", () => {
    if (!currentFunder) return;
    loadWorks(currentFunder.id, { sort: workSortEl.value, cursor: "*" });
  });

  // Kick off
  init().catch(err => {
    console.error(err);
    nameEl.textContent = "Error loading funder";
    worksListEl.innerHTML = `<p class="muted">Please try again later.</p>`;
  });
})();
