// --- user-profile.js ---
// Researcher profile dashboard with ORCID data, library overview, and following feed.

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

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtDateOnly(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SE";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function setAvatar(photoUrl, name) {
  const avatar = document.getElementById("profileAvatar");
  const img = document.getElementById("profileAvatarImg");
  const initials = document.getElementById("profileAvatarInitials");
  if (!avatar || !img || !initials) return;

  if (photoUrl) {
    img.src = photoUrl;
    img.alt = name ? `${name} profile photo` : "Profile photo";
    avatar.classList.add("has-photo");
  } else {
    avatar.classList.remove("has-photo");
    initials.textContent = initialsFromName(name);
  }
}

// --- Following feed ---
const OPENALEX = "https://api.openalex.org";
const MAILTO = "info@scienceecosystem.org";
function addMailto(u) {
  try {
    const url = new URL(u);
    if (!url.searchParams.get("mailto")) url.searchParams.set("mailto", MAILTO);
    return url.toString();
  } catch {
    return u;
  }
}

async function fetchFollows() {
  try {
    const res = await fetch("/api/follows", { credentials: "include" });
    if (res.status === 401) return [];
    if (!res.ok) throw new Error("Follows fetch failed");
    const list = await res.json();
    return Array.isArray(list) ? list.map((f) => ({ id: f.author_id || f.id, name: f.name || f.author_id })) : [];
  } catch (e) {
    console.warn("Could not load follows", e);
    return [];
  }
}

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
    <li>
      <div class="avatar-chip">
        <span class="avatar-mini">${escapeHtml(initialsFromName(f.name || f.id))}</span>
        <a href="profile.html?id=${encodeURIComponent(f.id)}">${escapeHtml(f.name || f.id)}</a>
      </div>
      <button class="btn btn-ghost btn-small" data-unfollow="${encodeURIComponent(f.id)}">Unfollow</button>
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
  ul.innerHTML = entries.slice(0, 10).map((item) => `
    <li>
      <a href="${escapeHtml(item.link)}">${escapeHtml(item.title || "Untitled")}</a>
      <div class="update-meta">${escapeHtml(item.author || "")} · ${fmtDateOnly(item.date)}</div>
    </li>
  `).join("");
}

async function loadFollowingFeed() {
  const follows = await fetchFollows();
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

function setupFollowingUI() {
  loadFollowingFeed();
  const followingBtn = document.getElementById("refreshFollowingBtn");
  followingBtn?.addEventListener("click", loadFollowingFeed);

  const followListEl = document.getElementById("followedList");
  if (followListEl) {
    followListEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-unfollow]");
      if (!btn) return;
      const id = btn.getAttribute("data-unfollow");
      try {
        await api(`/api/follows/${encodeURIComponent(id)}`, { method: "DELETE" });
        await loadFollowingFeed();
      } catch {
        alert("Failed to unfollow. Please try again.");
      }
    });
  }
}

// --- ORCID helpers ---
function orcidDateToNumber(d) {
  if (!d || !d.year?.value) return null;
  const y = Number(d.year.value);
  const m = Number(d.month?.value || 1);
  const day = Number(d.day?.value || 1);
  return new Date(Date.UTC(y, m - 1, day)).getTime();
}

function fmtOrcidDate(d) {
  if (!d || !d.year?.value) return "";
  const y = Number(d.year.value);
  const m = d.month?.value ? Number(d.month.value) : null;
  const day = d.day?.value ? Number(d.day.value) : null;
  if (!m) return String(y);
  const date = new Date(Date.UTC(y, m - 1, day || 1));
  if (day) return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function fmtOrcidRange(start, end) {
  const s = fmtOrcidDate(start);
  const e = fmtOrcidDate(end);
  if (!s && !e) return "";
  if (s && e) return `${s} – ${e}`;
  if (s && !e) return `${s} – Present`;
  return e;
}

function listOrEmpty(items, renderItem, emptyMsg = "No public data available.") {
  if (!items.length) return `<p class="muted">${emptyMsg}</p>`;
  return `<ul class="list">${items.map(renderItem).join("")}</ul>`;
}

function extractOpenAlexId(value) {
  if (!value) return null;
  const str = String(value);
  if (str.includes("openalex.org/")) {
    const id = str.split("openalex.org/")[1];
    return id ? id.replace(/^\s+|\s+$/g, "") : null;
  }
  if (/^W\d+$/i.test(str)) return str;
  return null;
}

function getOrcidPhoto(record) {
  const person = record?.person || {};
  const photos = person?.["person-photos"]?.photo || [];
  const first = photos[0] || {};
  return first?.url?.value || first?.value || first?.url || "";
}

async function loadOrcidProfile() {
  const personalEl = document.getElementById("orcidPersonal");
  const contactEl = document.getElementById("orcidContact");
  const keywordsEl = document.getElementById("orcidKeywords");
  const employmentEl = document.getElementById("orcidEmployment");
  const educationEl = document.getElementById("orcidEducation");
  const worksEl = document.getElementById("orcidWorks");
  const fundingEl = document.getElementById("orcidFunding");
  const serviceEl = document.getElementById("orcidService");
  const lastUpdatedEl = document.getElementById("orcidLastUpdated");

  if (!personalEl) return;

  try {
    const record = await api("/api/orcid/record");
    const person = record?.person || {};
    const nameObj = person?.name || {};
    const given = nameObj?.["given-names"]?.value || "";
    const family = nameObj?.["family-name"]?.value || "";
    const credit = nameObj?.["credit-name"]?.value || "";
    const displayName = (credit || `${given} ${family}`).trim() || "Not provided";

    const bio = person?.biography?.content || "";
    const orcidId = record?.["orcid-identifier"]?.path || "";
    const photoUrl = getOrcidPhoto(record);

    const emails = (person?.emails?.email || []).map(e => e?.email).filter(Boolean);
    const urls = (person?.["researcher-urls"]?.["researcher-url"] || []).map(u => ({
      name: u?.["url-name"] || "Link",
      url: u?.url?.value || ""
    })).filter(u => u.url);
    const extIds = (person?.["external-identifiers"]?.["external-identifier"] || []).map(e => ({
      type: e?.["external-id-type"],
      value: e?.["external-id-value"],
      url: e?.["external-id-url"]?.value || ""
    })).filter(e => e.type || e.value || e.url);

    const keywords = (person?.keywords?.keyword || []).map(k => k?.content).filter(Boolean);

    const activities = record?.["activities-summary"] || {};
    const employments = activities?.employments?.["employment-summary"] || [];
    const educations = activities?.educations?.["education-summary"] || [];

    const worksGroups = Array.isArray(activities?.works?.group) ? activities.works.group : [];
    const works = worksGroups.flatMap(g => g?.["work-summary"] || []);

    const fundGroups = Array.isArray(activities?.fundings?.group) ? activities.fundings.group : [];
    const fundings = fundGroups.flatMap(g => g?.["funding-summary"] || []);

    const peerGroups = Array.isArray(activities?.["peer-reviews"]?.group) ? activities["peer-reviews"].group : [];
    const peerReviews = peerGroups.flatMap(g => g?.["peer-review-summary"] || []);
    const services = activities?.services?.["service-summary"] || [];

    const lastModified = record?.["last-modified-date"]?.value;
    if (lastUpdatedEl) lastUpdatedEl.textContent = lastModified ? fmtDateTime(lastModified) : "-";

    // Personal information
    personalEl.innerHTML = `
      <div style="display:flex; gap:1rem; align-items:flex-start;">
        <div class="avatar-large ${photoUrl ? "has-photo" : ""}" style="width:80px;height:80px;">
          ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)} profile photo" referrerpolicy="no-referrer">` : `<span>${escapeHtml(initialsFromName(displayName))}</span>`}
        </div>
        <div>
          <p><strong>Name:</strong> ${escapeHtml(displayName)}</p>
          <p><strong>Given:</strong> ${escapeHtml(given || "-")}</p>
          <p><strong>Family:</strong> ${escapeHtml(family || "-")}</p>
          ${credit ? `<p><strong>Credit name:</strong> ${escapeHtml(credit)}</p>` : ""}
          <p><strong>ORCID iD:</strong> ${orcidId ? `<a href="https://orcid.org/${escapeHtml(orcidId)}" target="_blank" rel="noopener">${escapeHtml(orcidId)}</a>` : "-"}</p>
        </div>
      </div>
      ${bio ? `<p style="margin-top:.75rem;"><strong>Bio:</strong> ${escapeHtml(bio)}</p>` : ""}
    `;

    // Contact & Links
    const emailsHtml = emails.length ? emails.map(e => `<li>${escapeHtml(e)}</li>`).join("") : "";
    const urlsHtml = urls.length ? urls.map(u => `<li><a href="${escapeHtml(u.url)}" target="_blank" rel="noopener">${escapeHtml(u.name)}</a></li>`).join("") : "";
    const idsHtml = extIds.length ? extIds.map(e => {
      const label = [e.type, e.value].filter(Boolean).join(": ");
      const link = e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(label || e.url)}</a>` : escapeHtml(label || e.url);
      return `<li>${link}</li>`;
    }).join("") : "";
    contactEl.innerHTML = `
      <div>
        <p><strong>Emails:</strong></p>
        ${emails.length ? `<ul class="list">${emailsHtml}</ul>` : `<p class="muted">No public emails.</p>`}
        <p><strong>Researcher URLs:</strong></p>
        ${urls.length ? `<ul class="list">${urlsHtml}</ul>` : `<p class="muted">No public links.</p>`}
        <p><strong>External identifiers:</strong></p>
        ${extIds.length ? `<ul class="list">${idsHtml}</ul>` : `<p class="muted">No external identifiers.</p>`}
      </div>
    `;

    // Keywords
    keywordsEl.innerHTML = keywords.length
      ? `<div class="pill-group">${keywords.map(k => `<span class="pill">${escapeHtml(k)}</span>`).join("")}</div>`
      : `<p class="muted">No keywords listed.</p>`;

    // Employment
    const employmentSorted = [...employments].sort((a, b) => {
      const aKey = orcidDateToNumber(a?.["end-date"]) ?? orcidDateToNumber(a?.["start-date"]) ?? 0;
      const bKey = orcidDateToNumber(b?.["end-date"]) ?? orcidDateToNumber(b?.["start-date"]) ?? 0;
      return bKey - aKey;
    });
    employmentEl.innerHTML = listOrEmpty(employmentSorted, (item) => {
      const org = item?.organization?.name || "Organization";
      const role = item?.["role-title"] || "";
      const range = fmtOrcidRange(item?.["start-date"], item?.["end-date"]);
      const title = [org, role].filter(Boolean).join(" · ");
      return `<li><strong>${escapeHtml(title)}</strong>${range ? ` <span class="muted">(${escapeHtml(range)})</span>` : ""}</li>`;
    });

    // Education
    const educationSorted = [...educations].sort((a, b) => {
      const aKey = orcidDateToNumber(a?.["end-date"]) ?? orcidDateToNumber(a?.["start-date"]) ?? 0;
      const bKey = orcidDateToNumber(b?.["end-date"]) ?? orcidDateToNumber(b?.["start-date"]) ?? 0;
      return bKey - aKey;
    });
    educationEl.innerHTML = listOrEmpty(educationSorted, (item) => {
      const org = item?.organization?.name || "Institution";
      const role = item?.["role-title"] || item?.["department-name"] || "";
      const range = fmtOrcidRange(item?.["start-date"], item?.["end-date"]);
      const title = [org, role].filter(Boolean).join(" · ");
      return `<li><strong>${escapeHtml(title)}</strong>${range ? ` <span class="muted">(${escapeHtml(range)})</span>` : ""}</li>`;
    });

    // Works
    const worksList = works.map((w) => {
      const title = w?.title?.title?.value || w?.title?.value || "Untitled";
      const year = w?.["publication-date"]?.year?.value || w?.["publication-date"]?.year || w?.["publication-year"]?.value || "";
      const ext = w?.["external-ids"]?.["external-id"] || [];
      let openalex = null;
      ext.forEach((e) => {
        openalex = openalex || extractOpenAlexId(e?.["external-id-value"]) || extractOpenAlexId(e?.["external-id-url"]?.value);
        if (!openalex && e?.["external-id-type"] && String(e["external-id-type"]).toLowerCase().includes("openalex")) {
          openalex = extractOpenAlexId(e?.["external-id-value"]);
        }
      });
      const link = openalex ? `paper.html?id=${encodeURIComponent(openalex)}` : null;
      return { title, year, link };
    });

    worksEl.innerHTML = `
      <p><strong>Total works:</strong> ${worksList.length || 0}</p>
      ${listOrEmpty(worksList, (w) => `
        <li>
          ${w.link ? `<a href="${escapeHtml(w.link)}">${escapeHtml(w.title)}</a>` : escapeHtml(w.title)}
          ${w.year ? `<span class="muted"> · ${escapeHtml(w.year)}</span>` : ""}
        </li>
      `, "No works available.")}
    `;

    // Funding
    fundingEl.innerHTML = listOrEmpty(fundings, (f) => {
      const title = f?.title?.title?.value || "Funding";
      const org = f?.organization?.name || f?.["organization-defined-type"] || "";
      const range = fmtOrcidRange(f?.["start-date"], f?.["end-date"]);
      const meta = [org, range].filter(Boolean).join(" · ");
      return `<li><strong>${escapeHtml(title)}</strong>${meta ? ` <span class="muted">(${escapeHtml(meta)})</span>` : ""}</li>`;
    }, "No funding records.");

    // Peer review & service
    const serviceItems = [];
    peerReviews.forEach((p) => {
      const role = p?.["reviewer-role"] || "Reviewer";
      const org = p?.["convening-organization"]?.name || p?.["review-group-id"] || "Peer review";
      const date = fmtOrcidDate(p?.["review-completion-date"] || p?.["review-date"]);
      serviceItems.push({ label: `${role} · ${org}`, date });
    });
    services.forEach((s) => {
      const org = s?.organization?.name || "Service";
      const role = s?.["role-title"] || "Service";
      const range = fmtOrcidRange(s?.["start-date"], s?.["end-date"]);
      serviceItems.push({ label: `${role} · ${org}`, date: range });
    });

    serviceEl.innerHTML = listOrEmpty(serviceItems, (item) => `
      <li><strong>${escapeHtml(item.label)}</strong>${item.date ? ` <span class="muted">(${escapeHtml(item.date)})</span>` : ""}</li>
    `, "No peer review or service data.");

    // Update hero with ORCID photo if available
    setAvatar(photoUrl, displayName);
  } catch {
    if (personalEl) personalEl.innerHTML = `<p class="muted">Could not load ORCID data. Please re-login to grant access.</p>`;
    if (contactEl) contactEl.innerHTML = `<p class="muted">-</p>`;
    if (keywordsEl) keywordsEl.innerHTML = `<p class="muted">-</p>`;
    if (employmentEl) employmentEl.innerHTML = `<p class="muted">-</p>`;
    if (educationEl) educationEl.innerHTML = `<p class="muted">-</p>`;
    if (worksEl) worksEl.innerHTML = `<p class="muted">-</p>`;
    if (fundingEl) fundingEl.innerHTML = `<p class="muted">-</p>`;
    if (serviceEl) serviceEl.innerHTML = `<p class="muted">-</p>`;
  }
}

// --- Library ---
function sortByDate(arr, key = "saved_at") {
  return [...(arr || [])].sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0));
}

function hasLabel(item, label) {
  return Array.isArray(item?.labels) && item.labels.includes(label);
}

function fillBucket(ul, items, dateKey) {
  if (!ul) return;
  if (!items || !items.length) { ul.innerHTML = `<li class="muted">-</li>`; return; }
  ul.innerHTML = items.map(i => `
    <li>
      <a href="paper.html?id=${encodeURIComponent(i.id)}">${escapeHtml(i.title || "Untitled")}</a>
      ${dateKey ? `<span class="item-date">${fmtDateOnly(i[dateKey])}</span>` : ""}
    </li>
  `).join("");
}

async function bootstrap() {
  const loginBtn = document.getElementById("orcidLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileName = document.getElementById("profileName");
  const profileOrcidLink = document.getElementById("profileOrcidLink");
  const profileAffiliation = document.getElementById("profileAffiliation");
  const syncText = document.getElementById("syncText");
  const viewOrcidBtn = document.getElementById("viewOrcidBtn");
  const orcidEditLink = document.getElementById("orcidEditLink");

  const identityBadges = document.getElementById("identityBadges");
  const identityLastSync = document.getElementById("identityLastSync");

  const libRecent = document.getElementById("libRecent");
  const libToRead = document.getElementById("libToRead");
  const libStarred = document.getElementById("libStarred");
  const libCountBig = document.getElementById("libCountBig");
  const libCountBadge = document.getElementById("libCountBadge");
  const libCountEl = document.getElementById("libCount");

  try {
    const me = await api("/api/me");

    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) {
      logoutBtn.style.display = "inline-block";
      logoutBtn.onclick = async () => {
        try { await api("/auth/logout", { method: "POST" }); } catch (_) {}
        location.reload();
      };
    }

    const orcidUrl = me?.orcid ? `https://orcid.org/${me.orcid}` : "https://orcid.org";
    if (profileName) profileName.textContent = me?.name || "Your profile";
    if (profileOrcidLink) {
      profileOrcidLink.textContent = me?.orcid ? `ORCID: ${me.orcid}` : "ORCID";
      profileOrcidLink.href = orcidUrl;
    }
    if (profileAffiliation) profileAffiliation.textContent = me?.affiliation ? `• ${me.affiliation}` : "";
    if (viewOrcidBtn) viewOrcidBtn.href = orcidUrl;
    if (orcidEditLink) orcidEditLink.href = orcidUrl;
    setAvatar("", me?.name || "");

    // Identity / linking status
    try {
      const ident = await api("/api/identity/status");
      const bits = [
        { key: "orcid", label: "ORCID" },
        { key: "github", label: "GitHub" },
        { key: "scholar", label: "Scholar" },
        { key: "osf", label: "OSF" },
        { key: "zenodo", label: "Zenodo" },
      ];
      if (identityBadges) {
        identityBadges.innerHTML = bits.map((b) => {
          const ok = !!ident?.[b.key];
          const cls = ok ? "linked" : "unlinked";
          const icon = ok ? "✅" : "⚠️";
          return `<span class="badge ${cls}">${icon} ${escapeHtml(b.label)}</span>`;
        }).join("");
      }
      const lastSync = ident?.last_sync ? fmtDateTime(ident.last_sync) : "never";
      if (identityLastSync) identityLastSync.textContent = lastSync;
      if (syncText) syncText.textContent = lastSync;
    } catch {
      if (identityBadges) identityBadges.innerHTML = `<span class="badge unlinked">⚠️ Identity status unavailable</span>`;
      if (identityLastSync) identityLastSync.textContent = "unknown";
      if (syncText) syncText.textContent = "unknown";
    }

    // Library overview
    let libItems = [];
    try {
      const res = await fetch("/api/library/full", { credentials: "include" });
      if (res.status === 401) {
        libItems = [];
      } else if (res.ok) {
        libItems = await res.json();
      } else {
        throw new Error("Library load failed");
      }
      console.log("DEBUG: Library items loaded:", libItems);
      console.log("DEBUG: Count:", Array.isArray(libItems) ? libItems.length : 0);
    } catch (e) {
      console.error("DEBUG: Library load error:", e);
      libItems = [];
    }
    if (Array.isArray(libItems)) {
      const total = libItems.length || 0;
      if (libCountBig) libCountBig.textContent = String(total);
      if (libCountBadge) libCountBadge.textContent = `${total} papers`;
      if (libCountEl) libCountEl.textContent = String(total);

      console.log("DEBUG: Filling buckets with", libItems.length, "items");
      if (libCountEl) console.log("DEBUG: Set count to", libItems.length);

      const recent = libItems.slice(0, 5);
      const toRead = libItems.filter(i => hasLabel(i, "to-read")).slice(0, 5);
      const starred = libItems.filter(i => hasLabel(i, "starred")).slice(0, 5);

      console.log("DEBUG: Recent:", recent.length, "To Read:", toRead.length, "Starred:", starred.length);

      fillBucket(libRecent, recent, "saved_at");
      fillBucket(libToRead, toRead);
      fillBucket(libStarred, starred);

      if (!libItems.length) {
        if (libRecent) libRecent.innerHTML = '<li class="muted">No papers saved yet.</li>';
        if (libToRead) libToRead.innerHTML = '<li class="muted">No papers marked to read.</li>';
        if (libStarred) libStarred.innerHTML = '<li class="muted">No starred papers.</li>';
      }
    }

    await loadOrcidProfile();
  } catch (e) {
    console.warn(e);
    if (profileName) profileName.textContent = "Sign in to view your profile";
    if (syncText) syncText.textContent = "-";
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (logoutBtn) logoutBtn.style.display = "none";
  }

  setupFollowingUI();

  try { await renderClaimsUI(); } catch (e) { console.warn(e); }
}

// ---- Claim / Merge UI (advanced settings) ----
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
        container.querySelector("#mergePrimary").innerHTML = `<option value="">Primary…</option>${opts}`;
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
