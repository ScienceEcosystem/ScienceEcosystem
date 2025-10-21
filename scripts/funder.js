/* globals window, document, fetch, URLSearchParams, AbortController */
(function () {
  if (!document.body || document.body.dataset.page !== "funder") return;

  // ---------- Constants ----------
  const API = "https://api.openalex.org";
  const MAILTO = "info@scienceecosystem.org"; // keep this to avoid 401/429
  const UAQS = `mailto=${encodeURIComponent(MAILTO)}`;

  // Basic retry helper for 429s
  async function fetchJson(url, { signal } = {}) {
    let attempt = 0;
    let lastErr;
    while (attempt < 4) {
      try {
        const res = await fetch(url + (url.includes("?") ? "&" : "?") + UAQS, { signal });
        if (res.status === 429) {
          const wait = Math.min(2000 * (attempt + 1), 8000);
          await new Promise(r => setTimeout(r, wait));
          attempt++;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (e.name === "AbortError") throw e;
        attempt++;
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    throw lastErr || new Error("Network error");
  }

  // ---------- Elements ----------
  const form = document.getElementById("funder-form");
  const input = document.getElementById("funder-input");
  const header = document.getElementById("funder-header");
  const nameEl = document.getElementById("funder-name");
  const metaEl = document.getElementById("funder-meta");
  const logoEl = document.getElementById("funder-logo");
  const linksEl = document.getElementById("funder-links");

  const stats = document.getElementById("funder-stats");
  const statWorks = document.getElementById("stat-works");
  const statCited = document.getElementById("stat-cited");
  const statH = document.getElementById("stat-h");

  const tabBtns = {
    works: document.getElementById("tabbtn-works"),
    researchers: document.getElementById("tabbtn-researchers"),
    institutions: document.getElementById("tabbtn-institutions"),
    topics: document.getElementById("tabbtn-topics"),
  };
  const tabs = {
    works: document.getElementById("tab-works"),
    researchers: document.getElementById("tab-researchers"),
    institutions: document.getElementById("tab-institutions"),
    topics: document.getElementById("tab-topics"),
  };

  const worksList = document.getElementById("works-list");
  const worksCount = document.getElementById("works-count");
  const worksSort = document.getElementById("works-sort");
  const worksPrev = document.getElementById("works-prev");
  const worksNext = document.getElementById("works-next");

  // ---------- State ----------
  let currentFunder = null;
  let worksCursor = { page: 1, perPage: 25, nextCursor: null, prevStack: [] };
  let controller = null;

  // ---------- Helpers ----------
  function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = !!hidden;
  }
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  function formatInt(n) {
    return (n ?? 0).toLocaleString();
  }

  function switchTab(key) {
    Object.keys(tabs).forEach(k => {
      const btn = tabBtns[k];
      const panel = tabs[k];
      const active = k === key;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
      setHidden(panel, !active);
    });
  }

  function parseIdOrQuery(str) {
    const s = (str || "").trim();
    // Accept OpenAlex id forms: F#### or https://openalex.org/F####
    const match = s.match(/(?:openalex\.org\/)?(F\d{6,})$/i);
    return match ? { id: match[1] } : { q: s };
  }

  function chip(text, href) {
    const a = document.createElement("a");
    a.className = "se-chip";
    a.textContent = text;
    if (href) a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  function authorList(authorships) {
    const names = (authorships || []).map(a => a.author?.display_name).filter(Boolean);
    return names.slice(0, 6).join(", ") + (names.length > 6 ? " et al." : "");
  }

  // ---------- Rendering ----------
  function renderFunderHeader(f) {
    currentFunder = f;
    nameEl.textContent = f.display_name || "Unnamed funder";
    const parts = [];
    if (f.country_code) parts.push(f.country_code);
    if (f.type) parts.push(f.type);
    metaEl.textContent = parts.join(" · ");

    clear(linksEl);
    if (f.homepage_url) linksEl.appendChild(chip("Website", f.homepage_url));
    if (f.ror) linksEl.appendChild(chip("ROR", `https://ror.org/${f.ror.replace(/^https?:\/\/ror\.org\//, "")}`));
    if (f.id) linksEl.appendChild(chip("OpenAlex", `https://openalex.org/${f.id}`));

    if (f.image_url) {
      logoEl.src = f.image_url;
      logoEl.alt = `${f.display_name} logo`;
      setHidden(logoEl, false);
    } else {
      setHidden(logoEl, true);
    }

    setHidden(header, false);
  }

  function renderStats(f) {
    setHidden(stats, false);
    statWorks.textContent = formatInt(f.works_count);
    statCited.textContent = formatInt(f.cited_by_count);
    // quick & dirty h-index estimate √(citations)
    const h = Math.round(Math.sqrt(f.cited_by_count || 0));
    statH.textContent = isFinite(h) ? h : "–";
  }

  function renderWorksList(results, meta) {
    clear(worksList);
    worksCount.textContent = `${formatInt(meta.count)} results`;
    for (const w of results) {
      const li = document.createElement("li");
      li.className = "se-list-item";
      const title = w.display_name || "(Untitled)";
      const venue = w.host_venue?.display_name || w.primary_location?.source?.display_name || "";
      const year = w.publication_year || "";
      const citations = w.cited_by_count ?? 0;

      const a = document.createElement("a");
      a.href = `/paper.html?id=${encodeURIComponent(w.id)}`;
      a.textContent = title;
      a.className = "se-link-strong";

      const meta = document.createElement("div");
      meta.className = "se-muted";
      meta.textContent = [venue, year ? `(${year})` : "", `${citations} citations`].filter(Boolean).join(" · ");

      const authors = document.createElement("div");
      authors.className = "se-small";
      authors.textContent = authorList(w.authorships);

      li.appendChild(a);
      li.appendChild(meta);
      if (authors.textContent) li.appendChild(authors);
      worksList.appendChild(li);
    }

    // pagination
    worksPrev.disabled = worksCursor.page <= 1 || worksCursor.prevStack.length === 0;
    worksNext.disabled = !worksCursor.nextCursor;
  }

  function renderPeople(list, target) {
    clear(target);
    for (const a of list) {
      const li = document.createElement("li");
      li.className = "se-list-item";
      const link = document.createElement("a");
      link.href = `/researcher.html?id=${encodeURIComponent(a.id)}`;
      link.textContent = a.display_name || "Unknown";
      link.className = "se-link-strong";
      const meta = document.createElement("div");
      meta.className = "se-muted";
      meta.textContent = `${formatInt(a.works_count)} works · ${formatInt(a.cited_by_count)} citations`;
      li.appendChild(link);
      li.appendChild(meta);
      target.appendChild(li);
    }
  }

  function renderInstitutions(list, target) {
    clear(target);
    for (const org of list) {
      const li = document.createElement("li");
      li.className = "se-list-item";
      const link = document.createElement("a");
      link.href = `/institution.html?id=${encodeURIComponent(org.id)}`;
      link.textContent = org.display_name || "Unknown";
      link.className = "se-link-strong";
      const meta = document.createElement("div");
      meta.className = "se-muted";
      meta.textContent = `${org.country_code || ""} · ${formatInt(org.works_count)} works`;
      li.appendChild(link);
      li.appendChild(meta);
      target.appendChild(li);
    }
  }

  function renderTopics(list, target) {
    clear(target);
    for (const t of list) {
      const li = document.createElement("li");
      li.className = "se-chip-item";
      const a = document.createElement("a");
      a.className = "se-chip";
      a.href = `/search.html?q=${encodeURIComponent(`topic.id:${t.id}`)}`;
      a.textContent = `${t.display_name} (${formatInt(t.works_count)})`;
      li.appendChild(a);
      target.appendChild(li);
    }
  }

  // ---------- Data loaders ----------
  async function loadFunderById(id, { signal }) {
    return await fetchJson(`${API}/funders/${id}`, { signal });
  }

  async function searchFunders(q, { signal }) {
    // prefer exact name match first
    return await fetchJson(`${API}/funders?search=${encodeURIComponent(q)}&per_page=1`, { signal });
  }

  async function loadWorksForFunder(id, { sort, cursor, perPage = 25, signal }) {
    const url = new URL(`${API}/works`);
    url.searchParams.set("filter", `funder:${id}`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("sort", sort || "relevance_score:desc");
    if (cursor) url.searchParams.set("cursor", cursor);
    return await fetchJson(url.toString(), { signal });
  }

  async function topEntitiesForFunder(id, { groupBy, perPage = 10, signal }) {
    // Use group_by to aggregate top authors/institutions/topics where possible
    const url = new URL(`${API}/works`);
    url.searchParams.set("filter", `funder:${id}`);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("group_by", groupBy);
    url.searchParams.set("sort", "count:desc");
    // OpenAlex group_by returns buckets with ids; we'll follow-up with /authors or /institutions hydrate
    const grouped = await fetchJson(url.toString(), { signal });
    const ids = (grouped.group_by || []).map(g => g.key).filter(Boolean).slice(0, perPage);
    if (ids.length === 0) return [];

    const endpoint = groupBy === "authorships.author.id" ? "authors"
                    : groupBy === "institutions.id" ? "institutions"
                    : groupBy === "topics.id" ? "topics"
                    : null;
    if (!endpoint) return [];

    // batch fetch
    const idsParam = ids.map(encodeURIComponent).join("|");
    const data = await fetchJson(`${API}/${endpoint}?filter=id.search:${idsParam}&per_page=${perPage}`, { signal });
    return data.results || [];
  }

  // ---------- Controller ----------
  async function showFunder(source) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;

    try {
      setHidden(header, true);
      setHidden(stats, true);
      clear(worksList);
      worksCount.textContent = "";
      worksPrev.disabled = true;
      worksNext.disabled = true;

      let f;
      if (source.id) {
        f = await loadFunderById(source.id, { signal });
      } else if (source.q) {
        const res = await searchFunders(source.q, { signal });
        f = (res.results || [])[0];
        if (!f) throw new Error("No funder found for that query.");
      } else {
        throw new Error("Please enter a funder name or ID.");
      }

      renderFunderHeader(f);
      renderStats(f);

      // Works (first page)
      worksCursor = { page: 1, perPage: 25, nextCursor: null, prevStack: [] };
      const works = await loadWorksForFunder(f.id, { sort: worksSort.value, cursor: "*", perPage: worksCursor.perPage, signal });
      worksCursor.nextCursor = works.meta?.next_cursor || null;
      renderWorksList(works.results || [], works.meta || { count: 0 });

      // Side tabs
      switchTab("works");
      // Top researchers
      topEntitiesForFunder(f.id, { groupBy: "authorships.author.id", signal }).then(list => {
        renderPeople(list, document.getElementById("researchers-list"));
      }).catch(()=>{});
      // Top institutions
      topEntitiesForFunder(f.id, { groupBy: "institutions.id", signal }).then(list => {
        renderInstitutions(list, document.getElementById("institutions-list"));
      }).catch(()=>{});
      // Topics
      topEntitiesForFunder(f.id, { groupBy: "topics.id", signal }).then(list => {
        renderTopics(list, document.getElementById("topics-list"));
      }).catch(()=>{});

      // update URL
      const url = new URL(window.location.href);
      url.searchParams.set("id", f.id);
      history.replaceState(null, "", url.toString());
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to load funder.");
    }
  }

  // ---------- Events ----------
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const src = parseIdOrQuery(input.value);
    showFunder(src);
  });

  worksSort.addEventListener("change", async () => {
    if (!currentFunder) return;
    const { signal } = controller || {};
    try {
      const works = await loadWorksForFunder(currentFunder.id, { sort: worksSort.value, cursor: "*", perPage: worksCursor.perPage, signal });
      worksCursor = { page: 1, perPage: worksCursor.perPage, nextCursor: works.meta?.next_cursor || null, prevStack: [] };
      renderWorksList(works.results || [], works.meta || { count: 0 });
    } catch (e) {
      console.error(e);
    }
  });

  worksNext.addEventListener("click", async () => {
    if (!currentFunder || !worksCursor.nextCursor) return;
    const { signal } = controller || {};
    const prevCursor = worksCursor.nextCursor;
    try {
      const works = await loadWorksForFunder(currentFunder.id, { sort: worksSort.value, cursor: worksCursor.nextCursor, perPage: worksCursor.perPage, signal });
      worksCursor.prevStack.push(prevCursor);
      worksCursor.page += 1;
      worksCursor.nextCursor = works.meta?.next_cursor || null;
      renderWorksList(works.results || [], works.meta || { count: 0 });
    } catch (e) {
      console.error(e);
    }
  });

  worksPrev.addEventListener("click", async () => {
    if (!currentFunder || worksCursor.prevStack.length === 0) return;
    const { signal } = controller || {};
    const prev = worksCursor.prevStack.pop();
    // OpenAlex cursor is forward-only; to paginate back we restart and step to page-1
    try {
      let cursor = "*";
      let next = null;
      let pageResults = null;
      for (let i = 1; i < worksCursor.page; i++) {
        const resp = await loadWorksForFunder(currentFunder.id, { sort: worksSort.value, cursor, perPage: worksCursor.perPage, signal });
        cursor = resp.meta?.next_cursor || null;
        next = cursor;
        pageResults = resp;
      }
      worksCursor.page -= 1;
      worksCursor.nextCursor = next;
      renderWorksList(pageResults?.results || [], pageResults?.meta || { count: 0 });
    } catch (e) {
      console.error(e);
    }
  });

  // Tab switching
  Object.keys(tabBtns).forEach(k => {
    tabBtns[k].addEventListener("click", () => switchTab(k));
  });

  // Load from URL if id or query present
  (function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const q = params.get("q");
    if (id || q) {
      input.value = id || q || "";
      showFunder(id ? { id } : { q });
    }
  })();
})();
