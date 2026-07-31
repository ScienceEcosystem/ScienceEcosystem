// living-paper.js — mounts the real, already-rendered Quarto manuscript from
// GitHub Pages inside an iframe (srcdoc, so it stays same-origin-scriptable
// from this page) and overlays clickable evidence badges wherever
// evidence.json's claim labels match an element id Quarto already assigns
// to every numbered figure/table in its own output.

const params = new URLSearchParams(window.location.search);
const repoParam = params.get('repo');        // "owner/repo"
// Accept whatever form the linking page passed (OpenAlex always returns the
// full https://doi.org/... URL, not a bare DOI) and normalize once here,
// rather than trust every caller to have stripped it already.
const doi = (params.get('doi') || '')
  .replace(/^doi:/i, '')
  .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') || null;

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function bindSidebarTabs() {
  const btns = document.querySelectorAll('.pdf-tab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => { b.classList.remove('active'); b.style.borderBottomColor = 'transparent'; });
      btn.classList.add('active');
      btn.style.borderBottomColor = '#0284c7';
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.pdf-tab-panel').forEach(p => p.style.display = 'none');
      const panel = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
      if (panel) panel.style.display = '';
    });
  });
}

function ownerRepoParts(repo) {
  const [owner, name] = String(repo || '').split('/');
  return { owner, name };
}

async function fetchManuscriptHtml(repo) {
  const { owner, name } = ownerRepoParts(repo);
  const pagesUrl = `https://${owner}.github.io/${name}/`;
  const res = await fetch(pagesUrl);
  if (!res.ok) throw new Error(`Could not fetch manuscript (${res.status})`);
  const html = await res.text();
  // Force relative asset URLs (css, images, site_libs) to resolve against
  // the real GitHub Pages location instead of this page's origin.
  return html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${pagesUrl}">`);
}

async function fetchEvidence(repo) {
  const { owner, name } = ownerRepoParts(repo);
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/main/evidence.json`);
  if (!res.ok) return null;
  return res.json();
}

// ---- evidence badge + card, injected directly into the iframe document ----
function evidenceCardHtml(claim) {
  const reads = (claim.reads || []).map(r =>
    `<div style="padding:.15rem 0;">⇣ <code style="font-size:.78rem;">${escapeHtml(r)}</code></div>`).join('');
  const writes = (claim.writes || []).map(w =>
    `<div style="padding:.15rem 0;">⇡ <code style="font-size:.78rem;">${escapeHtml(w)}</code></div>`).join('');

  // Boilerplate every claim depends on (raw data load -> clean -> cache) —
  // named, linked, but collapsed to one line since it's not what makes
  // THIS claim's number what it is.
  const pipeline = claim.dataPipeline || [];
  const pipelineHtml = pipeline.length ? `
      <div style="margin-top:.5rem;font-size:.76rem;color:#a37a3c;">
        Data pipeline:
        ${pipeline.map(p => `<a href="${escapeHtml(p.githubPermalink)}" target="_blank" rel="noopener" style="color:#a37a3c;text-decoration:none;border-bottom:1px dotted #d9b46a;">${escapeHtml(p.label || ('L' + p.lineStart))}</a>`).join(' → ')}
      </div>` : '';

  const codeBlockHtml = (label, permalink, code) => `
    <div style="margin-top:.6rem;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.3rem;">
        <code style="font-size:.75rem;color:#92400e;font-weight:600;">${escapeHtml(label || 'unlabelled chunk')}</code>
        <a href="${escapeHtml(permalink)}" target="_blank" rel="noopener" style="font-size:.72rem;color:#94a3b8;text-decoration:none;">view ↗</a>
      </div>
      <pre style="margin:0;max-height:260px;overflow:auto;background:#1e1b16;color:#f2e9dc;border-radius:6px;padding:.6rem .7rem;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.74rem;line-height:1.5;"><code>${escapeHtml(code || '')}</code></pre>
    </div>`;

  // This chunk's own code — the model/plot/test itself when the claim's
  // citable chunk IS the interesting part (e.g. tbl-rf's own
  // randomForest() call), which is the common case and was previously
  // shown nowhere at all — only ancestor chunks ever got a code block.
  // No separate label/link header here (unlike computedIn below) — the
  // card's own header already names and links this exact chunk.
  const ownCodeHtml = claim.code ? `
    <pre style="margin:.6rem 0 0;max-height:260px;overflow:auto;background:#1e1b16;color:#f2e9dc;border-radius:6px;padding:.6rem .7rem;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.74rem;line-height:1.5;"><code>${escapeHtml(claim.code)}</code></pre>` : '';

  // The chunk(s) that actually did the interesting work when the claim's
  // own citable chunk is instead a display wrapper — shown as real code,
  // not just a link, so the reader doesn't have to leave the page to see
  // the model.
  const computedIn = (claim.computedIn || [])
    .map(c => codeBlockHtml(c.label, c.githubPermalink, c.code)).join('');

  return `
    <div class="lp-ev-card" style="display:none;margin:.5rem 0 1rem;border:1px solid #fde68a;background:#fffbeb;border-radius:10px;padding:.9rem 1rem;font-family:'Inter',sans-serif;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">
        <span style="font-family:ui-monospace,Menlo,monospace;font-size:.75rem;color:#b45309;font-weight:600;">#| label: ${escapeHtml(claim.label)}</span>
        <a href="${escapeHtml(claim.githubPermalink)}" target="_blank" rel="noopener" style="font-size:.75rem;color:#94a3b8;text-decoration:none;">view source ↗</a>
      </div>
      ${claim.caption ? `<p style="font-size:.85rem;color:#334155;margin:.25rem 0 .6rem;">${escapeHtml(claim.caption)}</p>` : ''}
      <div style="font-size:.8rem;color:#475569;">
        ${reads}${writes}
      </div>
      ${pipelineHtml}
      ${ownCodeHtml}
      ${computedIn ? `
      <div style="margin-top:.5rem;padding-top:.5rem;border-top:1px dashed #fde68a;">
        <div style="font-size:.72rem;color:#a37a3c;text-transform:uppercase;letter-spacing:.03em;margin-bottom:.2rem;">Computed in</div>
        ${computedIn}
      </div>` : ''}
      <div style="margin-top:.6rem;font-size:.75rem;color:#16a34a;font-weight:600;">
        ● CI verified reproducible · ${escapeHtml((claim._generatedAt || '').slice(0, 10))}
      </div>
    </div>`;
}

function injectEvidenceChips(doc, evidence) {
  if (!evidence || !Array.isArray(evidence.claims)) return { linked: 0, total: 0 };
  let linked = 0;
  evidence.claims.forEach(claim => {
    claim._generatedAt = evidence.generatedAt;
    const el = doc.getElementById(claim.label);
    if (!el) return; // Quarto didn't render this id in this build — skip rather than guess
    linked++;

    const badge = doc.createElement('button');
    badge.textContent = '◆ Evidence';
    badge.setAttribute('type', 'button');
    badge.style.cssText = 'margin:.4rem 0 .2rem;display:inline-flex;align-items:center;gap:.3rem;'
      + 'background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:999px;'
      + 'padding:.2rem .65rem;font-size:.75rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;';

    const card = doc.createElement('div');
    card.innerHTML = evidenceCardHtml(claim);
    const cardEl = card.firstElementChild;

    badge.addEventListener('click', () => {
      const open = cardEl.style.display === 'block';
      doc.querySelectorAll('.lp-ev-card').forEach(c => c.style.display = 'none');
      cardEl.style.display = open ? 'none' : 'block';
    });

    el.insertAdjacentElement('beforebegin', badge);
    el.insertAdjacentElement('afterend', cardEl);
  });
  return { linked, total: evidence.claims.length };
}

// ---- sidebar: paper metadata (OpenAlex) ----
async function loadPaperMetadata() {
  const el = document.getElementById('lpMetadata');
  if (!doi) { el.innerHTML = '<p class="muted">No DOI provided.</p>'; return; }
  try {
    const res = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=scienceecosystem@icloud.com`);
    if (!res.ok) throw new Error('lookup failed');
    const paper = await res.json();
    const authors = (paper.authorships || []).slice(0, 3).map(a => a.author.display_name).join(', ') || 'Unknown authors';
    const hasMore = (paper.authorships || []).length > 3;
    el.innerHTML = `
      <h4 style="line-height:1.4;">${escapeHtml(paper.title || 'Untitled')}</h4>
      <p class="muted" style="font-size:.9rem;margin:.5rem 0;">${escapeHtml(authors)}${hasMore ? ' et al.' : ''}</p>
      <p class="muted" style="font-size:.9rem;margin:.25rem 0;">${escapeHtml(String(paper.publication_year || ''))}</p>
      <p style="margin:.5rem 0 0;font-size:.9rem;"><a href="https://doi.org/${escapeHtml(doi)}" target="_blank">doi.org/${escapeHtml(doi)}</a></p>
    `;

    // pdf-viewer.html needs both id and pdf — a bare doi id with no pdf
    // param makes it show "No PDF URL provided", so the toggle needs the
    // actual OA PDF URL, not just this paper's identity.
    const idTail = String(paper.id || '').replace(/^https?:\/\/openalex\.org\//i, '');
    const oaPdf = getOpenAccessPdf(paper);
    const pdfLink = document.getElementById('lpPdfLink');
    if (pdfLink) {
      pdfLink.href = oaPdf
        ? `pdf-viewer.html?id=${encodeURIComponent(idTail)}&pdf=${encodeURIComponent(oaPdf)}`
        : `pdf-viewer.html?id=${encodeURIComponent(idTail)}`;
    }
  } catch (e) {
    el.innerHTML = '<p class="muted">Could not load paper information.</p>';
  }
}

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Matches getOpenAccessPdf() in paper.js exactly — best_oa_location and
// primary_location don't always carry the pdf_url; for a lot of papers
// (this one included) it's only in the broader locations[] array.
function getOpenAccessPdf(p) {
  const direct = get(p, 'best_oa_location.pdf_url')
    || get(p, 'best_oa_location.url_for_pdf')
    || get(p, 'primary_location.pdf_url')
    || get(p, 'primary_location.url_for_pdf');
  if (direct) return direct;
  const locs = Array.isArray(p.locations) ? p.locations : [];
  for (let i = 0; i < locs.length; i++) {
    const u = locs[i].pdf_url || locs[i].url_for_pdf || null;
    if (u) return u;
  }
  const oaUrl = get(p, 'open_access.oa_url');
  if (oaUrl && /\.pdf(\?|$)/i.test(oaUrl)) return oaUrl;
  return null;
}

// ---- sidebar: references (OpenAlex referenced_works) ----
async function loadReferences() {
  const el = document.getElementById('lpReferences');
  if (!doi) { el.innerHTML = '<p class="muted">No DOI provided.</p>'; return; }
  try {
    const res = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=scienceecosystem@icloud.com`);
    const paper = await res.json();
    const refs = paper.referenced_works || [];
    if (!refs.length) { el.innerHTML = '<p class="muted">No references listed in OpenAlex.</p>'; return; }
    el.innerHTML = `<p class="muted" style="font-size:.75rem;">${refs.length} references — see the manuscript's own reference list for full detail.</p>`;
  } catch (e) {
    el.innerHTML = '<p class="muted">Could not load references.</p>';
  }
}

// ---- sidebar: research objects + repo/evidence links ----
async function loadLinksAndResearchObjects(repo) {
  const roEl = document.getElementById('lpResearchObjects');
  const linksEl = document.getElementById('lpLinks');
  const { owner, name } = ownerRepoParts(repo);

  linksEl.innerHTML = `
    <div class="reference-item" onclick="window.open('https://github.com/${escapeHtml(owner)}/${escapeHtml(name)}','_blank')">
      <strong style="font-size:.85rem;">GitHub repository</strong>
      <p class="muted small">${escapeHtml(repo)}</p>
    </div>
    <div class="reference-item" onclick="window.open('https://raw.githubusercontent.com/${escapeHtml(owner)}/${escapeHtml(name)}/main/evidence.json','_blank')">
      <strong style="font-size:.85rem;">evidence.json</strong>
      <p class="muted small">Raw claim → code/data manifest</p>
    </div>
  `;

  if (!doi) { roEl.innerHTML = '<p class="muted">No DOI — cannot search Zenodo.</p>'; return; }
  try {
    const doiEsc = doi.replace(/"/g, '\\"');
    const q = encodeURIComponent(`metadata.related_identifiers.identifier:"${doiEsc}"`);
    const res = await fetch(`https://zenodo.org/api/records/?q=${q}&size=10`);
    const data = await res.json();
    const hits = data?.hits?.hits || [];
    if (!hits.length) { roEl.innerHTML = '<p class="muted">No Zenodo records found for this DOI.</p>'; return; }
    roEl.innerHTML = hits.map(h => {
      const md = h.metadata || {};
      const url = h.links?.html || `https://zenodo.org/records/${h.id}`;
      return `<div class="reference-item" onclick="window.open('${escapeHtml(url)}','_blank')">
        <strong style="font-size:.82rem;">${escapeHtml(md.title || 'Untitled')}</strong>
        <p class="muted small">${escapeHtml(md.resource_type?.type || 'Record')}</p>
      </div>`;
    }).join('');
  } catch (e) {
    roEl.innerHTML = '<p class="muted">Could not load research objects.</p>';
  }
}

// ---- sidebar: outline from the mounted manuscript's own headings ----
function buildOutline(doc) {
  const host = document.getElementById('lpOutline');
  const headings = doc.querySelectorAll('#quarto-document-content h1, #quarto-document-content h2');
  if (!headings.length) { host.innerHTML = '<p class="muted" style="font-size:.85rem;">No headings found.</p>'; return; }
  host.innerHTML = '';
  headings.forEach(h => {
    const a = document.createElement('a');
    a.className = 'outline-item' + (h.tagName === 'H2' ? ' h2' : '');
    a.textContent = h.textContent;
    a.addEventListener('click', () => h.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    host.appendChild(a);
  });
}

async function init() {
  bindSidebarTabs();

  if (!repoParam) {
    document.querySelector('.pdf-main-body').innerHTML =
      '<p style="padding:2rem;color:#c0392b;">No repository specified — open this page from a paper\'s "Living version" link.</p>';
    return;
  }

  // lpPdfLink gets its real href (id + actual OA pdf URL) inside
  // loadPaperMetadata() once the OpenAlex lookup resolves — a bare doi
  // id with no pdf param makes pdf-viewer.html show "No PDF URL provided".
  document.getElementById('lpLivingLink').href = window.location.href;

  loadPaperMetadata();
  loadReferences();
  loadLinksAndResearchObjects(repoParam);

  const frame = document.getElementById('lpFrame');
  const coverageEl = document.getElementById('lpCoverage');
  const coverageInline = document.getElementById('lpCoverageInline');

  try {
    const [html, evidence] = await Promise.all([
      fetchManuscriptHtml(repoParam),
      fetchEvidence(repoParam)
    ]);

    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      const { linked, total } = injectEvidenceChips(doc, evidence);
      buildOutline(doc);

      const pct = total ? Math.round((linked / total) * 100) : 0;
      const summary = evidence
        ? `<div class="lp-coverage"><strong>${linked}/${total}</strong>&nbsp;claims linked to code &amp; data (${pct}%)</div>`
        : '<p class="muted" style="font-size:.85rem;">No evidence.json found for this repository.</p>';
      coverageEl.innerHTML = summary;
      coverageInline.innerHTML = evidence
        ? `<strong>${linked}/${total}</strong>&nbsp;claims linked`
        : 'No evidence manifest found';
    }, { once: true });

    frame.srcdoc = html;
  } catch (e) {
    document.querySelector('.pdf-main-body').innerHTML =
      `<p style="padding:2rem;color:#c0392b;">Could not load the living manuscript: ${escapeHtml(e.message)}</p>`;
    coverageEl.innerHTML = '<p class="muted">—</p>';
  }
}

window.addEventListener('DOMContentLoaded', init);
