const urlParams = new URLSearchParams(window.location.search);
const paperId = urlParams.get('id');
const pdfUrl = urlParams.get('pdf');

let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.5;
let canvas = null;
let ctx = null;
let pdfjsLib = null;
let extractedReferences = [];
let openAlexRefsList = []; // sorted alphabetically, mirrors the Refs sidebar cards
let authorYearMap = new Map(); // "lastname_year" -> 1-based ref number
let currentTextLayer = null;
let refMatchCache = null;
let annotMode = 'none'; // 'note' (click-to-pin) | 'erase' | 'none'
let annotations = [];
let annotationKey = '';
let pdfLinkIndex = [];
let pageTextIndex = new Map();
let _openNoteBox = null; // { el, page, annotId, cleanup() } — the currently open sticky-note editor, if any
let _paperDoiHref = null; // set by loadPaperMetadata; used by the PDF error state

function renderDoiLink(el, doiHref, oaUrl) {
  let html = `<a href="${escapeHtml(doiHref)}" target="_blank" rel="noopener"
    style="display:inline-flex;align-items:center;gap:.5rem;background:#0284c7;color:#000;padding:.65rem 1.25rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:.95rem;">
    🔗 View on publisher site
  </a>`;
  if (oaUrl && oaUrl !== doiHref) {
    html += `<a href="${escapeHtml(oaUrl)}" target="_blank" rel="noopener"
      style="display:inline-flex;align-items:center;gap:.5rem;background:#f1f5f9;color:#334155;padding:.65rem 1.25rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:.95rem;border:1px solid #e2e8f0;">
      📄 Open access version
    </a>`;
  }
  el.innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateZoomLabel() {
  const el = document.getElementById('zoomLabel');
  if (el) el.textContent = Math.round(scale * 100) + '%';
}

function setupCanvas() {
  const pdfMain = document.querySelector('.pdf-main');
  if (!pdfMain) return;

  const body = pdfMain.querySelector('.pdf-main-body') || pdfMain;
  body.innerHTML = `
    <div class="pdf-scroll" style="text-align:center;padding:1.5rem;overflow:auto;height:100%;box-sizing:border-box;">
      <div id="pdfPages" class="pdf-pages"></div>
    </div>
  `;

  // Wire zoom buttons from the static toolbar
  document.getElementById('zoomIn')?.addEventListener('click', () => setZoom(scale + 0.25));
  document.getElementById('zoomOut')?.addEventListener('click', () => setZoom(scale - 0.25));

  bindAnnotationToolbar();
  bindSidebarToggle();
  bindZoomMenu();
  bindPageJumpControls();
  bindKeyboardShortcuts();
  document.getElementById('downloadPdfBtn')?.addEventListener('click', downloadCurrentPdf);
  document.getElementById('exportNotesBtn')?.addEventListener('click', exportAnnotationsMarkdown);
}

// ── Zoom: presets menu instead of more toolbar buttons ──────────────────────
function setZoom(newScale) {
  scale = Math.max(0.5, Math.min(4, newScale));
  updateZoomLabel();
  renderAllPages();
}

async function computeFitScale(mode) {
  if (!pdfDoc) return scale;
  try {
    const page = await pdfDoc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scrollEl = document.querySelector('.pdf-scroll');
    const availW = (scrollEl?.clientWidth || 900) - 48;
    const availH = (scrollEl?.clientHeight || 700) - 48;
    if (mode === 'width') return Math.max(0.5, Math.min(4, availW / vp1.width));
    if (mode === 'page') return Math.max(0.5, Math.min(4, Math.min(availW / vp1.width, availH / vp1.height)));
  } catch (_) {}
  return scale;
}

function bindZoomMenu() {
  const label = document.getElementById('zoomLabel');
  if (!label) return;
  label.addEventListener('click', () => {
    const existing = document.getElementById('zoomMenu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'zoomMenu';
    const presets = [50, 75, 100, 125, 150, 175, 200];
    menu.innerHTML =
      presets.map(p => `<button data-zoom="${p}">${p}%</button>`).join('') +
      `<hr>
       <button data-zoom="width">Fit width</button>
       <button data-zoom="page">Fit page</button>`;
    document.body.appendChild(menu);

    const r = label.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = (r.bottom + 4) + 'px';

    menu.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-zoom]');
      if (!btn) return;
      const val = btn.getAttribute('data-zoom');
      menu.remove();
      if (val === 'width' || val === 'page') {
        setZoom(await computeFitScale(val));
      } else {
        setZoom(Number(val) / 100);
      }
    });

    setTimeout(() => {
      const onOutside = (e) => {
        if (!menu.contains(e.target) && e.target !== label) {
          menu.remove();
          document.removeEventListener('mousedown', onOutside);
        }
      };
      document.addEventListener('mousedown', onOutside);
    }, 0);
  });
}

// ── Page navigation: lives in the thumbnail rail's footer, not the top
// toolbar — thumbnails are already the page-navigation surface, so a page
// number + prev/next belongs right there rather than as more top-bar chrome.
function goToPage(n) {
  if (!pdfDoc) return;
  const target = Math.max(1, Math.min(pdfDoc.numPages, Math.round(n)));
  renderPage(target);
  scrollToPage(target);
}

function bindPageJumpControls() {
  const input = document.getElementById('pdfPageInput');
  const prevBtn = document.getElementById('pdfPrevPageBtn');
  const nextBtn = document.getElementById('pdfNextPageBtn');
  prevBtn?.addEventListener('click', () => goToPage(pageNum - 1));
  nextBtn?.addEventListener('click', () => goToPage(pageNum + 1));
  input?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const n = parseInt(input.value, 10);
    if (Number.isFinite(n)) goToPage(n);
    else input.value = String(pageNum);
    input.blur();
  });
  input?.addEventListener('blur', () => { input.value = String(pageNum); });
}

// ── Keyboard shortcuts — no new visible UI, just behavior. Ignored while
// typing in any input/textarea/contenteditable (search box, note editor,
// page-jump box) so normal typing is never hijacked.
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (isTyping) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 'ArrowLeft': case 'PageUp':
        e.preventDefault(); goToPage(pageNum - 1); break;
      case 'ArrowRight': case 'PageDown':
        e.preventDefault(); goToPage(pageNum + 1); break;
      case 'Home':
        e.preventDefault(); goToPage(1); break;
      case 'End':
        e.preventDefault(); if (pdfDoc) goToPage(pdfDoc.numPages); break;
      case '+': case '=':
        e.preventDefault(); setZoom(scale + 0.25); break;
      case '-':
        e.preventDefault(); setZoom(scale - 0.25); break;
      case '/':
        e.preventDefault(); document.getElementById('pdfSearchInput')?.focus(); break;
      default: return;
    }
  });
}

// ── Download the exact PDF currently loaded, regardless of which of the
// several load paths (signed R2 URL, streamed library upload, external
// proxy) brought it in — pdf.js keeps the original bytes regardless of how
// the document was opened, so this is simpler and more reliable than
// re-deriving/re-fetching a download URL per load path.
async function downloadCurrentPdf() {
  const btn = document.getElementById('downloadPdfBtn');
  if (!pdfDoc) return;
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
    const data = await pdfDoc.getData();
    const blob = new Blob([data], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    const name = (document.title || 'document').replace(/\s*\|\s*ScienceEcosystem\s*$/i, '').replace(/[\/\\?%*:|"<>]/g, '-').trim() || 'document';
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  } catch (_e) {
    if (pdfUrl) window.open(pdfUrl, '_blank');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download PDF'; }
  }
}

// Hide/show the thumbnail strip + Info/Contents/Refs/Links sidebar, for
// distraction-free reading — a small floating tab on the page's left edge
// brings it back. Preference persists across PDFs via localStorage.
function setPdfSidebarHidden(hidden) {
  const container = document.querySelector('.pdf-container');
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  if (!container) return;
  container.classList.toggle('sidebar-hidden', hidden);
  if (toggleBtn) {
    toggleBtn.textContent = hidden ? '▶' : '◀';
    toggleBtn.title = hidden ? 'Show the thumbnails/Info panel' : 'Hide the thumbnails/Info panel';
    toggleBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  }
  try { localStorage.setItem('se_pdf_sidebar_hidden', hidden ? '1' : '0'); } catch (_) {}
}

function bindSidebarToggle() {
  const container = document.querySelector('.pdf-container');
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const showTab = document.getElementById('showSidebarTab');
  if (!container || !toggleBtn) return;

  let hidden = false;
  try { hidden = localStorage.getItem('se_pdf_sidebar_hidden') === '1'; } catch (_) {}
  setPdfSidebarHidden(hidden);

  toggleBtn.addEventListener('click', () => setPdfSidebarHidden(!container.classList.contains('sidebar-hidden')));
  showTab?.addEventListener('click', () => setPdfSidebarHidden(false));
}

async function ensurePdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('/pdfjs/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';
  }
  return pdfjsLib;
}

// Looks up an open-access PDF URL for the current paper via OpenAlex,
// caching the result (including misses) so we only fetch once.
let _oaPdfUrlCache;
async function getOaPdfUrl() {
  if (_oaPdfUrlCache !== undefined) return _oaPdfUrlCache;
  if (!paperId) return (_oaPdfUrlCache = null);
  try {
    const cleanId = paperId.replace('https://openalex.org/', '');
    const res = await fetch(`${location.origin}/api/openalex/works/${cleanId}?mailto=scienceecosystem@icloud.com`);
    if (!res.ok) return (_oaPdfUrlCache = null);
    const work = await res.json();
    return (_oaPdfUrlCache = work.best_oa_location?.pdf_url || work.open_access?.oa_url || null);
  } catch (_e) {
    return (_oaPdfUrlCache = null);
  }
}

// If a stored library PDF can't be loaded, fall back to the paper's
// open-access copy (if OpenAlex/Unpaywall knows about one) so the reader
// shows *something* instead of just an error. Loads silently (no self-
// displayed error) so the caller can decide what to show if this ALSO
// fails — otherwise a failed fallback would overwrite the screen with a
// generic "publisher is blocking" message that has nothing to do with why
// the actual saved library PDF failed to load.
async function tryLoadOaFallback(url) {
  const oaUrl = await getOaPdfUrl();
  if (!oaUrl || oaUrl === url) return false;
  return await loadPDF(oaUrl, true);
}

async function loadSignedUrlWithRetry(signedUrl, attempt) {
  attempt = attempt || 1;
  try {
    // Fetch the whole file ourselves rather than handing pdf.js the raw
    // URL — pdf.js's url-mode uses HTTP Range requests for progressive
    // loading, and Cloudflare R2 has a known issue where range requests
    // intermittently 408/time out even though a plain full GET to the
    // same object succeeds reliably (confirmed: curling the exact failing
    // URL always succeeds in under a second). A full GET avoids range
    // requests entirely.
    const res = await fetch(signedUrl);
    if (!res.ok) {
      const err = new Error('Unexpected server response (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    const bytes = await res.arrayBuffer();
    const task = pdfjsLib.getDocument({ data: bytes });
    return await task.promise;
  } catch (err) {
    const status = err && (err.status || (String(err.message || err).match(/\b(40[89]|425|429|5\d\d)\b/) || [])[1]);
    const isTransient = [408, 425, 429, 500, 502, 503, 504].indexOf(Number(status)) !== -1;
    if (isTransient && attempt < 3) {
      await new Promise(function (r) { setTimeout(r, 700 * attempt); });
      return loadSignedUrlWithRetry(signedUrl, attempt + 1);
    }
    throw err;
  }
}

// `silent`: when true, never self-display an error on failure — just
// return false and let the caller (tryLoadOaFallback) decide what, if
// anything, to show. Used so a failed OA fallback attempt doesn't paper
// over the real reason the original (e.g. library) PDF failed to load.
async function loadPDF(url, silent) {
  setupCanvas();
  await ensurePdfJs();

  const isExternal = !url.startsWith('/') && !url.startsWith(window.location.origin);
  const finalUrl = isExternal ? `/api/pdf/proxy?url=${encodeURIComponent(url)}` : url;
  const isLibraryPdf = url.includes('/api/library/pdf');

  // If it's a library PDF, fetch the signed R2 URL from the server first
  if (isLibraryPdf) {
    try {
      const check = await fetch(url, { credentials: 'include' });
      if (!check.ok) {
        const data = await check.json().catch(() => ({}));
        if (await tryLoadOaFallback(url)) return true;
        if (silent) return false;
        showPdfError(data.error || 'PDF not available.', true);
        return false;
      }
      const contentType = check.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await check.json().catch(() => null);
        if (data && data.signedUrl) {
          // R2 signed URL — load directly, no auth needed. Retry on
          // transient errors (408/425/429/5xx) — R2 occasionally times out
          // a single request even though the file is fine; the same URL
          // typically succeeds on retry within a second or two.
          pdfDoc = await loadSignedUrlWithRetry(data.signedUrl);
          const countEl = document.getElementById('pageCount');
          if (countEl) countEl.textContent = String(pdfDoc.numPages);
          renderAllPages();
          return true;
        }
        // JSON response but no signedUrl — error
        if (await tryLoadOaFallback(url)) return true;
        if (silent) return false;
        showPdfError(data?.error || 'PDF not available.', true);
        return false;
      }
      // Binary PDF streamed directly — pass the response body to pdf.js
      const pdfBytes = await check.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
      pdfDoc = await loadingTask.promise;
      const countEl = document.getElementById('pageCount');
      if (countEl) countEl.textContent = String(pdfDoc.numPages);
      renderAllPages();
      return true;
    } catch (err) {
      if (await tryLoadOaFallback(url)) return true;
      if (silent) return false;
      showPdfError('Could not load PDF: ' + String(err), true);
      return false;
    }
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      url: finalUrl,
      withCredentials: true  // send session cookie for authenticated endpoints
    });
    pdfDoc = await loadingTask.promise;

    const countEl = document.getElementById('pageCount');
    if (countEl) countEl.textContent = String(pdfDoc.numPages);

    renderAllPages();
    return true;
  } catch (error) {
    console.error('Error loading PDF:', error);
    if (silent) return false;
    showPdfError(null, false);
    return false;
  }
}

function showPdfError(customMessage, isLibraryLoss) {
  const pdfMain = document.querySelector('.pdf-main-body') || document.querySelector('.pdf-main');
  if (!pdfMain) return;

  const initialLinks = _paperDoiHref
    ? ''
    : '<span style="color:#999;font-size:.9rem;">Looking up publisher link…</span>';

  const bodyText = isLibraryLoss
    ? (customMessage || 'The stored PDF is no longer available — the file was lost when the server restarted. Visit the publisher site to get the PDF again and re-save it using the browser extension.')
    : 'The publisher is blocking direct PDF access. Visit the publisher\'s page to read or download the paper.';

  pdfMain.innerHTML = `
    <div id="pdfErrorState" style="text-align:center;padding:3rem 2rem;color:#444;max-width:520px;margin:0 auto;">
      <div style="font-size:2.5rem;margin-bottom:.75rem;">📄</div>
      <h3 style="color:#c0392b;margin:0 0 .5rem;">${isLibraryLoss ? 'PDF no longer available' : 'PDF unavailable'}</h3>
      <p style="margin:.5rem 0 1.75rem;color:#666;line-height:1.5;">${escapeHtml(bodyText)}</p>
      <div id="pdfErrorLinks" style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;margin-bottom:1.5rem;">
        ${initialLinks}
      </div>
      ${!isLibraryLoss ? '<p style="font-size:.83rem;color:#94a3b8;">Install the <strong>ScienceEcosystem browser extension</strong> to save PDFs directly from the publisher\'s site.</p>' : ''}
    </div>`;

  const linksEl = document.getElementById('pdfErrorLinks');
  if (linksEl && _paperDoiHref) renderDoiLink(linksEl, _paperDoiHref, null);
}

function renderPage(num) {
  pageNum = num;
  const input = document.getElementById('pdfPageInput');
  if (input) input.value = String(num);
  saveLastPageDebounced(num);
}

// ── Resume where you left off: persists the current page per PDF (keyed by
// its URL, same pattern annotationKey already uses) so reopening a long
// document doesn't always dump you back at page 1.
let _savePageTimer = null;
function lastPageStorageKey() {
  return 'se_pdf_lastpage_' + encodeURIComponent(pdfUrl || '');
}
function saveLastPageDebounced(num) {
  if (!pdfUrl) return;
  clearTimeout(_savePageTimer);
  _savePageTimer = setTimeout(() => {
    try { localStorage.setItem(lastPageStorageKey(), String(num)); } catch (_) {}
  }, 400);
}
function getSavedPage() {
  try {
    const v = parseInt(localStorage.getItem(lastPageStorageKey()), 10);
    return Number.isFinite(v) && v >= 1 ? v : null;
  } catch (_) { return null; }
}

async function renderTextLayer(page, viewport, layerEl, tooltipEl) {
  if (!layerEl || !pdfjsLib) return;
  layerEl.innerHTML = '';

  const textContent = await page.getTextContent();
  if (typeof pdfjsLib.TextLayer !== 'function') return;

  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: layerEl,
    viewport: viewport,
    textDivs: []
  });
  await textLayer.render();

  // Ensure every span is transparent so canvas text shows through
  layerEl.querySelectorAll('span').forEach(s => {
    s.style.color = 'transparent';
  });

  indexTextLayer(layerEl);
  applyCitationHighlightsToLayer(layerEl);
  wireCitationHover(layerEl, tooltipEl);
  wireAnnotationSelection(layerEl);
}

function indexTextLayer(layerEl) {
  try {
    const wrap = layerEl.closest('.pdf-page-wrap');
    if (!wrap) return;
    const page = Number(wrap.getAttribute('data-page') || '0');
    const wrapRect = wrap.getBoundingClientRect();
    const spans = Array.from(layerEl.querySelectorAll('span'));
    const entries = spans.map(s => {
      const r = s.getBoundingClientRect();
      return {
        text: (s.textContent || '').trim(),
        rect: {
          left: r.left - wrapRect.left,
          top: r.top - wrapRect.top,
          right: r.right - wrapRect.left,
          bottom: r.bottom - wrapRect.top
        }
      };
    }).filter(e => e.text);
    pageTextIndex.set(page, entries);
  } catch (_) {}
}

function labelFromTextHits(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const fig = t.match(/(fig(ure)?\.?\s*\d+[a-z]?)/i);
  if (fig) return fig[1].replace(/\s+/g, ' ').replace(/fig/i, 'Figure');
  const tbl = t.match(/(table\s*\d+[a-z]?)/i);
  if (tbl) return tbl[1].replace(/\s+/g, ' ').replace(/table/i, 'Table');
  const cit = t.match(/(\[\s*\d{1,3}\s*\])/);
  if (cit) return `Citation ${cit[1].replace(/\s+/g,'')}`;
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
}

async function resolveDestToPage(dest) {
  if (!pdfDoc || !dest) return null;
  try {
    let destArray = dest;
    if (typeof dest === 'string') {
      destArray = await pdfDoc.getDestination(dest);
    }
    if (!Array.isArray(destArray) || !destArray.length) return null;
    const pageRef = destArray[0];
    const pageIndex = await pdfDoc.getPageIndex(pageRef);
    return pageIndex + 1;
  } catch (e) {
    return null;
  }
}

async function renderLinkLayer(page, viewport, layerEl, pageNumber, tooltipEl) {
  if (!layerEl || !pdfjsLib) return;
  layerEl.innerHTML = '';
  const pageWrap = layerEl.closest('.pdf-page-wrap');

  let annotationsList = [];
  try {
    annotationsList = await page.getAnnotations({ intent: 'display' });
  } catch (_) {
    annotationsList = [];
  }

  for (const ann of annotationsList) {
    if (!ann || ann.subtype !== 'Link' || !ann.rect) continue;
    const rect = viewport.convertToViewportRectangle(ann.rect);
    const left = Math.min(rect[0], rect[2]);
    const top = Math.min(rect[1], rect[3]);
    const width = Math.abs(rect[0] - rect[2]);
    const height = Math.abs(rect[1] - rect[3]);
    if (!width || !height) continue;

    const linkEl = document.createElement('a');
    linkEl.className = 'pdf-link';
    linkEl.style.left = `${left}px`;
    linkEl.style.top = `${top}px`;
    linkEl.style.width = `${width}px`;
    linkEl.style.height = `${height}px`;

    const url = ann.url || null;
    const dest = ann.dest || null;
    let inferredLabel = '';
    let hitText = '';
    try {
      const hits = (pageTextIndex.get(pageNumber) || []).filter(s => {
        return !(s.rect.right < left || s.rect.left > left + width || s.rect.bottom < top || s.rect.top > top + height);
      });
      hitText = hits.map(h => h.text).join(' ');
      inferredLabel = labelFromTextHits(hitText);
    } catch (_) {}
    if (url) {
      linkEl.href = url;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener';
      linkEl.title = url;
      pdfLinkIndex.push({ page: pageNumber, label: inferredLabel || url, url });
    } else if (dest) {
      // An in-text citation — numbered ("[12]") or author-year
      // ("Devcich 1979") — is usually a real embedded PDF link pointing at
      // the bibliography page, since this layer sits ON TOP of the plain
      // text-layer spans and wins the click. Following it used to scroll
      // the whole main PDF pane down to that page — jarring when you just
      // want to check what a citation is, and easy to miss as "still
      // jumping" even after the text-layer spans got the popup treatment,
      // since THIS layer's raw link was still catching the click first.
      // Numbers/author-years matching a known reference instead get the
      // same hover-preview + popup treatment as plain-text citations, with
      // no PDF scrolling. Figure/table cross-references keep the real
      // in-PDF jump — that one's useful.
      const trimmed = hitText.trim();
      const isFigTbl = /fig(ure)?\.?\s*\d|table\s*\d/i.test(trimmed);
      const refNum = isFigTbl ? null : findRefNumberInText(trimmed);
      // Even with no local reference data to resolve against (e.g. GROBID
      // failed and the PDF's own bibliography isn't in a format the
      // text-layer fallback can parse — an author-year/APA reference list,
      // common in theses, has no numbering at all), still recognize
      // anything CITATION-SHAPED as a citation rather than falling through
      // to the raw in-PDF jump — it just resolves live instead of locally.
      const isKnownCitation = !!refNum || (!isFigTbl && looksLikeAuthorYearCitation(trimmed));

      if (isKnownCitation && pageWrap && tooltipEl) {
        linkEl.classList.add('citation-highlight');
        if (refNum) linkEl.setAttribute('data-ref-number', String(refNum));
        wireInlineCitationLink(linkEl, tooltipEl, pageWrap, refNum, trimmed);
      } else {
        linkEl.href = '#';
        linkEl.title = 'Jump to linked section';
        linkEl.addEventListener('click', async (ev) => {
          ev.preventDefault();
          const targetPage = await resolveDestToPage(dest);
          if (targetPage) {
            pageNum = targetPage;
            renderPage(targetPage);
            // All pages are pre-rendered — just scroll; use setTimeout to let paint settle
            setTimeout(() => scrollToPage(targetPage), 30);
          }
        });
        pdfLinkIndex.push({ page: pageNumber, label: inferredLabel || 'Internal link', dest });
      }
    } else {
      continue;
    }
    layerEl.appendChild(linkEl);
  }
}

// Builds "lastname_year" → ref number, from whichever reference source is
// actually populated. PDF-extracted references (the common case — GROBID
// or the text-layer fallback) are numbered by the PDF's own bibliography;
// the OpenAlex fallback list is numbered alphabetically. Prefers extracted
// references when present, since that's the numbering getExtractedRefByNumber
// (and the Refs sidebar) actually uses.
function buildAuthorYearMap() {
  authorYearMap = new Map();
  if (extractedReferences.length) {
    extractedReferences.forEach((ref) => {
      const lastName = (ref.authors?.[0] || '')
        .trim().split(' ').pop().toLowerCase().replace(/[^a-z]/g, '');
      const year = String(ref.year || '').slice(0, 4);
      if (!lastName || !year) return;
      const key = `${lastName}_${year}`;
      if (!authorYearMap.has(key)) authorYearMap.set(key, ref.number);
    });
    return;
  }
  openAlexRefsList.forEach((w, i) => {
    const lastName = (w.authorships?.[0]?.author?.display_name || '')
      .split(' ').pop().toLowerCase().replace(/[^a-z]/g, '');
    const year = String(w.publication_year || '');
    if (!lastName || !year) return;
    const key = `${lastName}_${year}`;
    if (!authorYearMap.has(key)) authorYearMap.set(key, i + 1);
  });
}

function applyCitationHighlights() {
  document.querySelectorAll('.pdf-text-layer').forEach(applyCitationHighlightsToLayer);
}

// Citations are frequently split across multiple PDF.js text-layer spans
// (kerning/font runs break "[1]" or "(Smith, 2020)" into several spans), so
// matching against each span's text in isolation misses most real citations.
// Instead we concatenate all span text on the layer in DOM order (which
// mirrors PDF.js's reading order) and match against that merged string,
// then map each match back to every span it touches.
const _bracketRe = /\[(\d[\d,\s\-–]*)\]/g;
// (Smith, 2020) / (Smith et al. 2020) / (Smith & Jones 2019) — author+year fully in parens
const _ayRe = /\(\s*([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+)(?:\s+(?:et\s+al\.?|&\s*[A-Z][A-Za-z]+|and\s+[A-Z][A-Za-z]+))?\s*,?\s*(\d{4}[a-z]?)\s*\)/g;
// Smith et al. (2020) / Smith (2020) — author name precedes a "(year)"
const _narRe = /([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+)(?:\s+(?:et\s+al\.?|&\s*[A-Z][A-Za-z]+|and\s+[A-Z][A-Za-z]+))?\s+\((\d{4}[a-z]?)\)/g;
// A parenthetical citation GROUP: "(Smith 2020; Jones et al. 2019a)" — the
// two patterns above only ever match a citation that has its own "(" right
// before it and ")" right after, which is never true for any citation
// inside a semicolon-separated group (only the group's own outer parens
// exist). Matches the whole group's contents so each semicolon-separated
// piece inside can be parsed individually below.
const _citeGroupRe = /\(([^()]{4,240})\)/g;
// Holds the raw text of text-layer citations that couldn't be resolved
// against any local reference data (looked up by index from
// data-cite-live-id on the span) — resolved live via OpenAlex on click
// instead. Grows for the life of the page view; small enough not to matter.
const _liveCiteTexts = [];

// Resolves a short piece of text (typically one PDF link annotation's hit
// area — a bracketed number or an author-year fragment) to a known
// reference number, using the same patterns applyCitationHighlightsToLayer
// matches against the full merged text layer. Used to recognize citations
// that arrive via a real embedded PDF hyperlink rather than plain text,
// regardless of numbering style.
function findRefNumberInText(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const bracketMatch = t.match(/^\[?\s*(\d{1,4})\s*[\]\s,;.]*$/);
  if (bracketMatch) {
    const n = parseInt(bracketMatch[1], 10);
    if (getExtractedRefByNumber(n) || getRefByNumber(n)) return n;
  }
  if (!authorYearMap.size) return null;
  _ayRe.lastIndex = 0;
  let m = _ayRe.exec(t);
  if (!m) { _narRe.lastIndex = 0; m = _narRe.exec(t); }
  if (m) {
    const lastName = m[1].toLowerCase().replace(/[^a-z]/g, '');
    const year = m[2].slice(0, 4);
    return authorYearMap.get(`${lastName}_${year}`) || authorYearMap.get(`${lastName}_${m[2]}`) || null;
  }
  // Bare "Lastname Year" / "Lastname et al. 2020a" with no surrounding
  // parentheses at all — the actual clickable rect of a PDF-embedded
  // citation link often covers just the name+year and not the punctuation
  // around it, so neither pattern above (both require a literal "(" ")")
  // ever matches the isolated hit text. Safe to be looser here than the
  // full-page scan above: this only runs against text already confirmed
  // to sit under a real internal PDF link, not arbitrary prose.
  const bare = t.match(/^([A-Za-zÀ-ÖØ-öø-ÿ'\-]+)(?:\s+(?:et\s+al\.?|&\s*[A-Za-z]+|and\s+[A-Za-z]+))?[.,]?\s*(\d{4}[a-z]?)[.,;)]*$/);
  if (bare) {
    const lastName = bare[1].toLowerCase().replace(/[^a-z]/g, '');
    const year = bare[2].slice(0, 4);
    return authorYearMap.get(`${lastName}_${year}`) || authorYearMap.get(`${lastName}_${bare[2]}`) || null;
  }
  return null;
}

function applyCitationHighlightsToLayer(layerEl) {
  // Works from whichever reference source is populated — PDF-extracted
  // references (the common case) or the OpenAlex fallback list. Used to
  // require openAlexRefsList specifically, which meant plain in-text
  // citations on an extracted-references PDF never got highlighted at
  // all (no hover preview, no click-to-popup) — the only interaction
  // available was whatever the PDF's own embedded hyperlinks did, which
  // for non-numeric (author-year) citations is a raw jump to the
  // bibliography page inside the PDF itself.
  if (!layerEl || (!openAlexRefsList.length && !extractedReferences.length)) return;
  const hasAuthorYear = authorYearMap.size > 0;

  const spans = Array.from(layerEl.querySelectorAll('span')).filter(s => !s.hasAttribute('data-ref-number'));
  if (!spans.length) return;

  let merged = '';
  const offsets = [];
  spans.forEach(span => {
    const t = span.textContent || '';
    offsets.push({ span, start: merged.length, end: merged.length + t.length });
    merged += t;
  });

  const candidates = [];
  let m;

  _bracketRe.lastIndex = 0;
  while ((m = _bracketRe.exec(merged))) {
    const firstNum = parseInt(m[1].match(/\d+/)[0], 10);
    if (getExtractedRefByNumber(firstNum) || getRefByNumber(firstNum)) {
      candidates.push({ start: m.index, end: m.index + m[0].length, refNum: firstNum, priority: 0 });
    }
  }

  if (hasAuthorYear) {
    _ayRe.lastIndex = 0;
    while ((m = _ayRe.exec(merged))) {
      const lastName = m[1].toLowerCase().replace(/[^a-z]/g, '');
      const year = m[2].slice(0, 4);
      const refNum = authorYearMap.get(`${lastName}_${year}`) || authorYearMap.get(`${lastName}_${m[2]}`);
      if (refNum) candidates.push({ start: m.index, end: m.index + m[0].length, refNum, priority: 1 });
    }

    _narRe.lastIndex = 0;
    while ((m = _narRe.exec(merged))) {
      const lastName = m[1].toLowerCase().replace(/[^a-z]/g, '');
      const year = m[2].slice(0, 4);
      const refNum = authorYearMap.get(`${lastName}_${year}`) || authorYearMap.get(`${lastName}_${m[2]}`);
      if (refNum) candidates.push({ start: m.index, end: m.index + m[0].length, refNum, priority: 2 });
    }
  }

  // Resolve overlaps: earliest match wins; ties broken by priority (more specific pattern first)
  candidates.sort((a, b) => a.start - b.start || a.priority - b.priority);
  const accepted = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.start < lastEnd) continue;
    accepted.push(c);
    lastEnd = c.end;
  }

  for (const c of accepted) {
    for (const o of offsets) {
      if (o.end <= c.start || o.start >= c.end) continue;
      if (o.span.hasAttribute('data-ref-number')) continue;
      o.span.classList.add('citation-highlight');
      o.span.setAttribute('data-ref-number', String(c.refNum));
    }
  }
}

function clearCitationActive() {
  document.querySelectorAll('.citation-highlight.active').forEach(el => {
    el.classList.remove('active');
  });
}

function jumpToCitation(refNumber) {
  const target = document.querySelector(`.citation-highlight[data-ref-number="${refNumber}"]`);
  clearCitationActive();
  if (target) {
    target.classList.add('active');
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  } else {
    // Citation not visible — it may be on a different page; nothing to scroll to
    console.info('Citation [' + refNumber + '] not visible in rendered text layers.');
  }
}

function getRefByNumber(n) {
  const idx = parseInt(n, 10) - 1;
  return (idx >= 0 && idx < openAlexRefsList.length) ? openAlexRefsList[idx] : null;
}

function getExtractedRefByNumber(n) {
  const num = parseInt(n, 10);
  return extractedReferences.find(r => parseInt(r.number, 10) === num) || null;
}

// Builds the hover-preview HTML for a reference number, regardless of which
// numbering scheme it belongs to: PDF-extracted references keep their native
// bibliography number; the OpenAlex fallback list is numbered alphabetically.
function buildRefTooltipHtml(refNum) {
  const n = parseInt(refNum, 10);
  const extracted = getExtractedRefByNumber(n);
  if (extracted) {
    const authors = (extracted.authors || []).slice(0, 3).join(', ');
    const hasMore = (extracted.authors || []).length > 3;
    return `
      <div style="font-weight:600;margin-bottom:.3rem;font-size:.85rem;line-height:1.3;">[${n}] — ${escapeHtml(extracted.title || 'Untitled')}</div>
      ${authors ? `<div style="font-size:.78rem;color:#475569;margin-bottom:.15rem;">${escapeHtml(authors)}${hasMore ? ' et al.' : ''}</div>` : ''}
      ${extracted.year ? `<div style="font-size:.75rem;color:#64748b;margin-bottom:.4rem;">${escapeHtml(String(extracted.year))}</div>` : ''}
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;">
        <button onclick="handleReferenceClick(${n})" style="font-size:.73rem;padding:.15rem .5rem;background:#0284c7;color:#fff;border:none;border-radius:4px;cursor:pointer;">View in Refs ↗</button>
        ${extracted.doi ? `<a href="https://doi.org/${encodeURIComponent(extracted.doi)}" target="_blank" style="font-size:.73rem;color:#0284c7;text-decoration:none;">DOI →</a>` : ''}
      </div>`;
  }
  const w = getRefByNumber(n);
  if (!w) return null;
  const authors = w.authorships?.slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', ') || '';
  const hasMore = (w.authorships?.length || 0) > 3;
  const cleanId = w.id?.replace('https://openalex.org/', '') || '';
  const firstAuthorLast = (w.authorships?.[0]?.author?.display_name || '').split(' ').pop();
  const refLabel = firstAuthorLast && w.publication_year ? `${firstAuthorLast}, ${w.publication_year}` : `[${n}]`;
  return `
    <div style="font-weight:600;margin-bottom:.3rem;font-size:.85rem;line-height:1.3;">${escapeHtml(refLabel)} — ${escapeHtml(w.title || 'Untitled')}</div>
    ${authors ? `<div style="font-size:.78rem;color:#475569;margin-bottom:.15rem;">${escapeHtml(authors)}${hasMore ? ' et al.' : ''}</div>` : ''}
    ${w.publication_year ? `<div style="font-size:.75rem;color:#64748b;margin-bottom:.4rem;">${w.publication_year}</div>` : ''}
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;">
      <button onclick="handleReferenceClick(${n})" style="font-size:.73rem;padding:.15rem .5rem;background:#0284c7;color:#fff;border:none;border-radius:4px;cursor:pointer;">View in Refs ↗</button>
      ${cleanId ? `<a href="/paper.html?id=${escapeHtml(cleanId)}" target="_blank" style="font-size:.73rem;color:#0284c7;text-decoration:none;">Paper page →</a>` : ''}
    </div>`;
}

// Positions a tooltip relative to a page wrap, clamped to stay inside it.
function positionRefTooltip(tooltipEl, wrapRect, anchorRect) {
  const ttW = tooltipEl.offsetWidth || 280;
  const ttH = tooltipEl.offsetHeight || 120;
  let left = anchorRect.left - wrapRect.left + 8;
  let top = anchorRect.bottom - wrapRect.top + 6;
  if (left + ttW > wrapRect.right - wrapRect.left - 8) left = anchorRect.right - wrapRect.left - ttW - 8;
  if (left < 0) left = 4;
  if (top + ttH > wrapRect.bottom - wrapRect.top - 8) top = anchorRect.top - wrapRect.top - ttH - 6;
  tooltipEl.style.left = left + 'px';
  tooltipEl.style.top = top + 'px';
}

// Wires hover-preview + click-to-sidebar behavior on a single citation-style
// element that lives outside the text layer's delegated listeners (e.g. a
// numbered in-text citation that's a real embedded PDF link, not a text
// span). Never scrolls the main PDF — only the Refs sidebar.
// `refNum` is null when this citation only matched by shape (looks like an
// author-year/bracket citation) but couldn't be resolved against any local
// reference data — click still opens a popup, just resolved live via
// openCitationInfoPopupLive() instead of a local lookup. No hover preview
// in that case (would mean a network request on every mouseenter).
function wireInlineCitationLink(el, tooltipEl, pageWrap, refNum, rawText) {
  let hideTimer = null;
  el.addEventListener('mouseenter', () => {
    if (!refNum) return;
    clearTimeout(hideTimer);
    const html = buildRefTooltipHtml(refNum);
    if (!html) return;
    tooltipEl.innerHTML = html;
    tooltipEl.style.visibility = 'hidden';
    tooltipEl.style.display = 'block';
    positionRefTooltip(tooltipEl, pageWrap.getBoundingClientRect(), el.getBoundingClientRect());
    tooltipEl.style.visibility = 'visible';
  });
  el.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(() => { tooltipEl.style.display = 'none'; }, 120);
  });
  el.addEventListener('click', (ev) => {
    ev.preventDefault();
    clearCitationActive();
    el.classList.add('active');
    if (refNum) openCitationInfoPopup(refNum, el);
    else openCitationInfoPopupLive(rawText, el);
  });
}

function wireCitationHover(layerEl, tooltipEl) {
  if (!layerEl || !tooltipEl) return;

  let hideTimer = null;
  let shownForNum = null;

  function showTooltip(target) {
    if (!target.hasAttribute('data-ref-number')) return; // live-resolve spans have no local data to preview
    const refNum = target.getAttribute('data-ref-number');
    if (refNum === shownForNum) return;
    const html = buildRefTooltipHtml(refNum);
    if (!html) { tooltipEl.style.display = 'none'; shownForNum = null; return; }
    shownForNum = refNum;
    tooltipEl.innerHTML = html;
    tooltipEl.style.visibility = 'hidden';
    tooltipEl.style.display = 'block';

    const pageWrap = layerEl.closest('.pdf-page-wrap');
    const wrapRect = pageWrap ? pageWrap.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    positionRefTooltip(tooltipEl, wrapRect, target.getBoundingClientRect());
    tooltipEl.style.visibility = 'visible';
  }

  function scheduleHide() {
    hideTimer = setTimeout(() => {
      tooltipEl.style.display = 'none';
      shownForNum = null;
    }, 120);
  }

  layerEl.addEventListener('mouseover', function (e) {
    const target = e.target.closest('.citation-highlight');
    if (!target) return;
    clearTimeout(hideTimer);
    showTooltip(target);
  });

  // Clicking the citation opens a small info popup right next to it — title,
  // authors, abstract snippet, cited-by count, Save/Open/See-in-References —
  // the same idea as the citation-preview popup other PDF readers show, just
  // backed by our own OpenAlex data instead of Google Scholar. Since
  // citations no longer show a persistent highlight (only on hover/click —
  // see .citation-highlight in style.css), mark the clicked one .active so
  // there's visible confirmation of what was actually clicked.
  layerEl.addEventListener('click', function (e) {
    if (annotMode === 'note') return; // let note placement handle the click instead
    const target = e.target.closest('.citation-highlight');
    if (!target) return;
    const refNum = target.getAttribute('data-ref-number');
    const liveId = target.getAttribute('data-cite-live-id');
    if (!refNum && liveId == null) return;
    clearCitationActive();
    target.classList.add('active');
    if (refNum) openCitationInfoPopup(parseInt(refNum, 10), target);
    else openCitationInfoPopupLive(_liveCiteTexts[Number(liveId)] || '', target);
  });

  layerEl.addEventListener('mouseout', function (e) {
    const target = e.target.closest('.citation-highlight');
    if (!target) return;
    // Only hide if not moving to the tooltip
    if (e.relatedTarget && tooltipEl.contains(e.relatedTarget)) return;
    scheduleHide();
  });

  tooltipEl.addEventListener('mouseenter', function () {
    clearTimeout(hideTimer);
  });

  tooltipEl.addEventListener('mouseleave', function () {
    scheduleHide();
  });
}

function queueRenderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
    scrollToPage(num);
  }
}

function onPrevPage() {
  if (pageNum <= 1) return;
  pageNum--;
  queueRenderPage(pageNum);
}

function onNextPage() {
  if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
  pageNum++;
  queueRenderPage(pageNum);
}

// Generation counter: each call to renderAllPages increments it.
// Any async step that sees a stale generation aborts early.
let _renderGen = 0;

let _restoredInitialPage = false;
async function renderAllPages() {
  if (!pdfDoc) return;
  const gen = ++_renderGen; // claim this render slot
  pageRendering = true;

  // Resume where you left off — only on the very first render of this
  // document, not on every re-render (zoom changes also call this, and
  // should keep whatever page you're currently on, not jump back to a
  // stale saved position).
  if (!_restoredInitialPage) {
    _restoredInitialPage = true;
    const saved = getSavedPage();
    if (saved) pageNum = Math.min(saved, pdfDoc.numPages);
  }

  const pagesHost = document.getElementById('pdfPages');
  if (!pagesHost) return;

  // 1. First pass: create ALL placeholder wraps with correct dimensions so the
  //    scroll container has stable height from the start (no layout jumps).
  pagesHost.innerHTML = '';
  pdfLinkIndex = [];
  pageTextIndex = new Map();

  const viewports = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (_renderGen !== gen) return; // superseded
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });
    viewports.push(viewport);

    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-wrap';
    wrap.setAttribute('data-page', String(i));
    // Canvas sized immediately so layout height is correct before pixel content arrives
    wrap.innerHTML = `
      <canvas class="pdf-page-canvas" width="${viewport.width}" height="${viewport.height}" style="box-shadow:0 4px 20px rgba(0,0,0,0.3);"></canvas>
      <div class="pdf-text-layer"></div>
      <div class="pdf-link-layer"></div>
      <div class="pdf-annotation-layer"></div>
      <div class="citation-tooltip" style="display:none;"></div>
    `;
    pagesHost.appendChild(wrap);
  }

  // 2. Second pass: paint content into each canvas in order.
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    if (_renderGen !== gen) return; // superseded by zoom change etc.
    const page = await pdfDoc.getPage(i);
    const viewport = viewports[i - 1];
    const wrap = pagesHost.querySelector(`.pdf-page-wrap[data-page="${i}"]`);
    if (!wrap) continue;

    const pageCanvas = wrap.querySelector('canvas');
    const pageCtx = pageCanvas.getContext('2d');
    const renderTask = page.render({ canvasContext: pageCtx, viewport });
    await renderTask.promise;
    if (_renderGen !== gen) return;

    const layerEl = wrap.querySelector('.pdf-text-layer');
    const linkLayerEl = wrap.querySelector('.pdf-link-layer');
    const tooltipEl = wrap.querySelector('.citation-tooltip');
    await renderTextLayer(page, viewport, layerEl, tooltipEl);
    await renderLinkLayer(page, viewport, linkLayerEl, i, tooltipEl);
    renderAnnotationsForPage(i);
  }

  if (_renderGen !== gen) return;

  renderPage(pageNum);
  // Re-renders (zoom changes) fully rebuild #pdfPages, which would otherwise
  // silently drop the viewport back to the top of the document every time —
  // jump back to whatever page was current (also what makes the "resume
  // where you left off" restore above actually land in view on first load).
  scrollToPage(pageNum);
  renderPdfLinksSidebar();
  pageRendering = false;
  searchAllText = null;
  renderOutline();
  renderThumbnails();
  startScrollPageTracker();
  extractFiguresTablesFromText();
}

// Explicit page jumps (page-jump box, thumbnail click, keyboard shortcuts,
// figure/note/outline jumps) all go through here. The scroll-position
// tracker below fires several times DURING a smooth-scroll animation and
// can otherwise "win" against an intentional jump — e.g. briefly seeing the
// page just before the target as more visible than the target itself mid-
// animation, and stomping pageNum/the page-number box back to it right as
// the scroll settles. Suppressing the tracker for the duration of the
// animation fixes that without touching the (many) call sites individually.
let _suppressScrollTracking = false;
let _suppressScrollTrackingTimer = null;
function scrollToPage(num) {
  const scrollEl = document.querySelector('.pdf-scroll');
  const el = document.querySelector(`.pdf-page-wrap[data-page="${num}"]`);

  _suppressScrollTracking = true;
  clearTimeout(_suppressScrollTrackingTimer);
  const resume = () => { _suppressScrollTracking = false; };
  // Prefer the real 'scrollend' event over a guessed timeout — a smooth
  // scroll's duration varies with distance, and a fixed timeout either
  // resumes tracking too early (letting it observe mid-animation and
  // stomp pageNum back to the page just before the target — the exact bug
  // this suppression exists to prevent) or unnecessarily late.
  if (scrollEl && 'onscrollend' in scrollEl) {
    scrollEl.addEventListener('scrollend', resume, { once: true });
    _suppressScrollTrackingTimer = setTimeout(resume, 2500); // safety net
  } else {
    _suppressScrollTrackingTimer = setTimeout(resume, 700);
  }

  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Sync thumbnail active state
  document.querySelectorAll('.pdf-thumb').forEach(t => {
    t.classList.toggle('active', Number(t.getAttribute('data-page')) === num);
  });
}

// Track which page is visible during scroll and update counter + thumbnail highlight
let _scrollTracker = null;
function startScrollPageTracker() {
  if (_scrollTracker) { _scrollTracker.disconnect(); _scrollTracker = null; }
  const scrollEl = document.querySelector('.pdf-scroll');
  if (!scrollEl) return;

  const wraps = Array.from(document.querySelectorAll('.pdf-page-wrap[data-page]'));
  if (!wraps.length) return;

  _scrollTracker = new IntersectionObserver((entries) => {
    if (_suppressScrollTracking) return;
    let best = null, bestRatio = -1;
    entries.forEach(e => { if (e.intersectionRatio > bestRatio) { bestRatio = e.intersectionRatio; best = e.target; } });
    if (best) {
      const p = Number(best.getAttribute('data-page'));
      if (p && p !== pageNum) renderPage(p);
    }
  }, { root: scrollEl, threshold: [0.1, 0.3, 0.5, 0.7] });

  wraps.forEach(w => _scrollTracker.observe(w));
}

// ---- Feature 1: Sidebar tab switcher ----
function bindSidebarTabs() {
  const btns = document.querySelectorAll('.pdf-tab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => {
        b.classList.remove('active');
        b.style.borderBottomColor = 'transparent';
      });
      btn.classList.add('active');
      btn.style.borderBottomColor = '#0284c7';
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.pdf-tab-panel').forEach(p => p.style.display = 'none');
      const panel = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
      if (panel) panel.style.display = '';
    });
  });
}

// ---- Feature 2: Outline / bookmarks ----
async function renderOutline() {
  const host = document.getElementById('pdfOutline');
  if (!host || !pdfDoc) return;
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || !outline.length) {
      host.innerHTML = '<p class="muted" style="font-size:.85rem;">No table of contents found.</p>';
      return;
    }
    host.innerHTML = buildOutlineHTML(outline, 0);
    host.querySelectorAll('[data-outline-dest]').forEach(el => {
      el.addEventListener('click', async () => {
        const dest = el.getAttribute('data-outline-dest');
        const targetPage = await resolveDestToPage(dest);
        if (targetPage) { renderPage(targetPage); setTimeout(() => scrollToPage(targetPage), 30); }
      });
    });
  } catch (e) {
    host.innerHTML = '<p class="muted" style="font-size:.85rem;">Could not load outline.</p>';
  }
}

function buildOutlineHTML(items, depth) {
  return '<ul style="list-style:none;margin:0;padding-left:' + (depth * 12) + 'px;">' +
    items.map(item => {
      const dest = typeof item.dest === 'string' ? item.dest : JSON.stringify(item.dest || '');
      const sub = item.items && item.items.length ? buildOutlineHTML(item.items, depth + 1) : '';
      return '<li style="margin:.15rem 0;">' +
        '<a href="#" data-outline-dest="' + escapeHtml(dest) + '" style="font-size:.83rem;color:#1e3a5f;text-decoration:none;display:block;padding:.2rem .3rem;border-radius:4px;" ' +
        'onmouseenter="this.style.background=\'#e8f0f7\'" onmouseleave="this.style.background=\'\'">' +
        escapeHtml(item.title || 'Section') + '</a>' + sub + '</li>';
    }).join('') + '</ul>';
}

// ---- Feature 3: Page thumbnails ----
async function renderThumbnails() {
  const strip = document.getElementById('pdfThumbnailStrip');
  if (!strip || !pdfDoc) return;
  strip.innerHTML = '';
  const totalLabel = document.getElementById('pdfPageTotalLabel');
  if (totalLabel) totalLabel.textContent = '/ ' + pdfDoc.numPages;
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: 0.18 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.className = 'pdf-thumb' + (i === pageNum ? ' active' : '');
    canvas.setAttribute('data-page', String(i));
    canvas.title = 'Page ' + i;
    page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    canvas.addEventListener('click', () => goToPage(i));
    const label = document.createElement('span');
    label.className = 'pdf-thumb-label';
    label.textContent = i;
    strip.appendChild(canvas);
    strip.appendChild(label);
  }
}

// ---- Feature 4: Full-text search ----
let searchMatches = [];
let searchIndex = -1;
let searchAllText = null; // { page: n, spans: [{el, text}] }[]

async function buildSearchIndex() {
  if (searchAllText) return;
  searchAllText = [];
  document.querySelectorAll('.pdf-page-wrap').forEach(wrap => {
    const page = Number(wrap.getAttribute('data-page') || 0);
    const spans = Array.from(wrap.querySelectorAll('.pdf-text-layer span')).map(el => ({
      el,
      text: (el.textContent || '').toLowerCase()
    })).filter(s => s.text.trim());
    if (spans.length) searchAllText.push({ page, spans });
  });
}

async function runSearch(query) {
  const q = query.trim().toLowerCase();
  const countEl = document.getElementById('pdfSearchCount');
  // Clear previous highlights
  document.querySelectorAll('.pdf-search-highlight').forEach(el => {
    el.classList.remove('pdf-search-highlight', 'current');
  });
  searchMatches = [];
  searchIndex = -1;
  if (!q || q.length < 2) { if (countEl) countEl.textContent = ''; return; }

  await buildSearchIndex();

  for (const { spans } of (searchAllText || [])) {
    for (const { el, text } of spans) {
      if (text.includes(q)) {
        el.classList.add('pdf-search-highlight');
        searchMatches.push(el);
      }
    }
  }

  if (countEl) countEl.textContent = searchMatches.length ? `1/${searchMatches.length}` : '0';
  if (searchMatches.length) jumpSearchMatch(0);
}

function jumpSearchMatch(idx) {
  if (!searchMatches.length) return;
  idx = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
  searchMatches.forEach((el, i) => el.classList.toggle('current', i === idx));
  searchMatches[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
  searchIndex = idx;
  const countEl = document.getElementById('pdfSearchCount');
  if (countEl) countEl.textContent = `${idx + 1}/${searchMatches.length}`;
}

function bindSearch() {
  const input = document.getElementById('pdfSearchInput');
  const prev  = document.getElementById('pdfSearchPrev');
  const next  = document.getElementById('pdfSearchNext');
  if (!input) return;

  let debounceT;
  input.addEventListener('input', () => {
    clearTimeout(debounceT);
    debounceT = setTimeout(() => runSearch(input.value), 300);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.shiftKey ? jumpSearchMatch(searchIndex - 1) : jumpSearchMatch(searchIndex + 1); }
    if (e.key === 'Escape') { input.value = ''; runSearch(''); }
  });
  prev?.addEventListener('click', () => jumpSearchMatch(searchIndex - 1));
  next?.addEventListener('click', () => jumpSearchMatch(searchIndex + 1));

  // Ctrl+F / Cmd+F → focus search bar
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ---- Feature 5: Annotation server sync ----
const ANNOT_SYNC_DEBOUNCE = 1500;
let _annotSyncTimer = null;

function scheduleSyncAnnotations() {
  if (!paperId) return; // can only sync if we know the paper
  clearTimeout(_annotSyncTimer);
  _annotSyncTimer = setTimeout(syncAnnotationsToServer, ANNOT_SYNC_DEBOUNCE);
}

async function syncAnnotationsToServer() {
  if (!paperId) {
    // No paper ID — annotations are browser-only; show a one-time nudge
    showSyncNudge();
    return;
  }
  try {
    const res = await fetch('/api/library/pdf-annotations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper_id: paperId, pdf_url: pdfUrl, annotations })
    });
    if (res.status === 401) showSyncNudge(); // not logged in
  } catch (_) { /* network error — annotations still safe in localStorage */ }
}

let _nudgeShown = false;
function showSyncNudge() {
  if (_nudgeShown) return;
  _nudgeShown = true;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:.6rem 1.1rem;border-radius:10px;font-size:.85rem;z-index:10020;display:flex;align-items:center;gap:.75rem;box-shadow:0 4px 16px rgba(0,0,0,.3);';
  bar.innerHTML = '🔒 <span>Log in with ORCID to save highlights & notes permanently.</span> <a href="/auth/orcid/login" style="color:#7dd3fc;font-weight:600;white-space:nowrap;">Log in →</a> <button style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;padding:0 0 0 .5rem;" title="Dismiss">✕</button>';
  bar.querySelector('button').onclick = () => bar.remove();
  document.body.appendChild(bar);
  // Auto-dismiss after 8s
  setTimeout(() => bar.remove(), 8000);
}

async function loadAnnotationsFromServer() {
  if (!paperId) return false;
  try {
    const res = await fetch(`/api/library/pdf-annotations?paper_id=${encodeURIComponent(paperId)}`, { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    if (Array.isArray(data.annotations) && data.annotations.length) {
      annotations = data.annotations;
      return true;
    }
  } catch (_) {}
  return false;
}

// ---- Feature 6: GROBID fallback — extract refs from text layer ----
function extractRefsFromTextLayer() {
  const textBlocks = [];
  document.querySelectorAll('.pdf-page-wrap').forEach(wrap => {
    const spans = wrap.querySelectorAll('.pdf-text-layer span');
    spans.forEach(s => { if (s.textContent.trim()) textBlocks.push(s.textContent.trim()); });
  });
  const fullText = textBlocks.join(' ');

  // Find reference section
  const refSectionMatch = fullText.match(/(?:references|bibliography|works cited)\s*\n?([\s\S]{200,})/i);
  const refText = refSectionMatch ? refSectionMatch[1] : fullText.slice(-Math.min(fullText.length, 6000));

  // Match numbered references [1] Title... or 1. Title...
  const numbered = refText.match(/(?:\[\d{1,3}\]|\d{1,3}\.)[ \t]+.{20,200}/g) || [];
  if (!numbered.length) return [];

  return numbered.slice(0, 60).map((raw, i) => {
    const numMatch = raw.match(/^[\[(\s]*(\d+)/);
    const num = numMatch ? Number(numMatch[1]) : i + 1;
    const body = raw.replace(/^[\[\d.\]\s]+/, '').trim();
    // Try to pull a DOI
    const doiMatch = body.match(/10\.\d{4,9}\/\S+/);
    return {
      number: num,
      title: body.slice(0, 120),
      authors: [],
      doi: doiMatch ? doiMatch[0].replace(/[.,)]+$/, '') : null,
      year: (body.match(/\b(19|20)\d{2}\b/) || [])[0] || null,
      source: 'text_layer'
    };
  });
}

async function loadPaperMetadata(paperId) {
  const metadataDiv = document.getElementById('pdfMetadata');
  if (!metadataDiv) return;

  try {
    const cleanId = paperId.replace('https://openalex.org/', '');
    const response = await fetch(`${location.origin}/api/openalex/works/${cleanId}?mailto=scienceecosystem@icloud.com`);

    if (!response.ok) throw new Error('Failed to load metadata');

    const paper = await response.json();

    const authors = paper.authorships?.slice(0, 3).map(a => a.author.display_name).join(', ') || 'Unknown authors';
    const hasMore = paper.authorships?.length > 3;

    metadataDiv.innerHTML = `
      <h4 style="line-height:1.4;">${escapeHtml(paper.title || 'Untitled')}</h4>
      <p class="muted" style="font-size:0.9rem; margin:0.5rem 0;">
        ${escapeHtml(authors)}${hasMore ? ' et al.' : ''}
      </p>
      <p class="muted" style="font-size:0.9rem; margin:0.25rem 0;">
        ${escapeHtml(String(paper.publication_year || 'Year unknown'))}
      </p>
      <p style="margin:0.5rem 0 0 0; font-size:0.9rem;">
        <strong>Citations:</strong> ${paper.cited_by_count?.toLocaleString() || 0}
      </p>
    `;

    // Cache the DOI so the error state can use it immediately
    const rawDoi = paper.doi ? String(paper.doi).replace(/^doi:/i, '') : null;
    if (rawDoi) {
      _paperDoiHref = rawDoi.startsWith('http') ? rawDoi : `https://doi.org/${rawDoi}`;
      // If the PDF already failed and the error state is visible, inject the link now
      const linksEl = document.getElementById('pdfErrorLinks');
      if (linksEl) renderDoiLink(linksEl, _paperDoiHref, paper.open_access?.oa_url || null);
    }

    // Chain into references and research objects (non-blocking)
    loadReferencesFromOpenAlex(paper);
    loadResearchObjects(paper);
    if (rawDoi) checkLivingPaperAvailable(rawDoi, paper);

    return paper;
  } catch (e) {
    console.error('Failed to load metadata:', e);
    metadataDiv.innerHTML = '<p class="muted">Could not load paper information</p>';
  }
}

async function loadReferencesFromOpenAlex(paper) {
  const refsDiv = document.getElementById('pdfReferences');
  if (!refsDiv) return;
  const refs = paper.referenced_works || [];
  if (!refs.length) {
    refsDiv.innerHTML = '<p class="muted">No references listed in OpenAlex.</p>';
    return;
  }
  refsDiv.innerHTML = `<p class="muted" style="font-size:.8rem;">Loading ${refs.length} references…</p>`;

  const ids = refs.map(u => u.replace('https://openalex.org/', ''));
  const BATCH = 50;
  const allWorks = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH).join('|');
    try {
      const r = await fetch(`${location.origin}/api/openalex/works?filter=ids.openalex:${batch}&per-page=50&select=id,title,authorships,publication_year,doi,open_access&mailto=scienceecosystem@icloud.com`);
      if (r.ok) { const d = await r.json(); allWorks.push(...(d.results || [])); }
    } catch(_) {}
  }

  if (!allWorks.length) {
    refsDiv.innerHTML = '<p class="muted">Could not load reference details.</p>';
    return;
  }

  // Sort alphabetically by first author last name
  allWorks.sort((a, b) => {
    const nameA = (a.authorships?.[0]?.author?.display_name || '').split(' ').pop().toLowerCase();
    const nameB = (b.authorships?.[0]?.author?.display_name || '').split(' ').pop().toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Store globally so citation hover + click can look up details by index
  openAlexRefsList = allWorks;

  refsDiv.innerHTML = `<p class="muted" style="font-size:.75rem;margin-bottom:.5rem;">${allWorks.length} references</p>` +
    allWorks.map((w, i) => {
      const firstAuthors = w.authorships?.slice(0, 2).map(a => a.author?.display_name).filter(Boolean).join(', ') || '';
      const hasMore = (w.authorships?.length || 0) > 2;
      const cleanId = w.id?.replace('https://openalex.org/', '') || '';
      const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : null;
      return `<div class="reference-item" id="oa-ref-${i + 1}" style="cursor:pointer;" onclick="window.location.href='/paper.html?id=${escapeHtml(cleanId)}'">
        <span class="reference-number">[${i + 1}]</span>
        <div>
          <strong style="font-size:.82rem;">${escapeHtml(w.title || 'Untitled')}</strong>
          ${firstAuthors ? `<p class="muted small">${escapeHtml(firstAuthors)}${hasMore ? ' et al.' : ''} · ${w.publication_year || ''}</p>` : ''}
          <div style="display:flex;gap:.4rem;margin-top:.2rem;flex-wrap:wrap;">
            ${doi ? `<a href="https://doi.org/${encodeURIComponent(doi)}" target="_blank" class="badge badge-ok" onclick="event.stopPropagation()">DOI</a>` : ''}
            ${w.open_access?.is_oa ? '<span class="badge" style="background:#16a34a;color:#fff;font-size:.7rem;">OA</span>' : ''}
          </div>
        </div>
      </div>`;
    }).join('');

  // Build author-year lookup for (Author, YYYY) style citations
  buildAuthorYearMap();

  // Re-apply citation highlights now that we have the list
  applyCitationHighlights();
}

async function loadResearchObjects(paper) {
  const el = document.getElementById('pdfResearchObjects');
  if (!el) return;
  const doi = paper.doi ? paper.doi.replace(/^https?:\/\/doi\.org\//i, '') : null;
  const title = paper.display_name || paper.title || '';
  if (!doi && !title) {
    el.innerHTML = '<p class="muted" style="font-size:.8rem;">No DOI or title — cannot search for research objects.</p>';
    return;
  }
  el.innerHTML = '<p class="muted" style="font-size:.8rem;">Searching for code &amp; data…</p>';
  try {
    // Same backend endpoint paper.html uses (server/artifacts-resolver.js) —
    // it cross-checks DataCite, Zenodo (by DOI and by title), CrossRef
    // relations, OpenAlex-cited repos, Figshare, GitHub (title/author
    // search), publisher DOI links, and EPMC. A plain client-side Zenodo
    // API query (the previous approach here) only ever found a fraction of
    // what paper.html shows, and often nothing at all — same paper, two
    // different answers depending on which page you were on.
    const authors = (paper.authorships || []).slice(0, 3)
      .map(a => a?.author?.display_name).filter(Boolean).join(', ');
    const qs = new URLSearchParams();
    if (doi) qs.set('doi', doi);
    if (title) qs.set('title', title);
    if (authors) qs.set('authors', authors);
    if (paper.id) qs.set('id', paper.id);
    const res = await fetch(`/api/paper/artifacts?${qs.toString()}`);
    if (!res.ok) throw new Error('artifacts lookup failed');
    const items = await res.json();
    if (!Array.isArray(items) || !items.length) {
      el.innerHTML = '<p class="muted" style="font-size:.8rem;">No research objects found.</p>';
      return;
    }
    el.innerHTML = items.map(x => {
      const url = x.url || (x.doi ? `https://doi.org/${x.doi}` : '');
      const conf = (typeof x.confidence === 'number' && x.confidence < 80)
        ? `<span class="muted" style="font-size:.7rem;">${x.confidence}% match</span> ` : '';
      const doiLink = x.doi
        ? `<a href="https://doi.org/${escapeHtml(x.doi)}" target="_blank" class="badge badge-ok" style="margin-top:.2rem;font-size:.7rem;" onclick="event.stopPropagation()">DOI</a>`
        : '';
      return `<div class="reference-item">
        <div>
          <strong style="font-size:.82rem;"><a href="${escapeHtml(url)}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(x.title || x.doi || x.url || 'Untitled')}</a></strong>
          <p class="muted small">${conf}${escapeHtml(x.type || 'Record')}${x.provenance ? ' · ' + escapeHtml(x.provenance) : ''}</p>
          ${doiLink}
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<p class="muted" style="font-size:.8rem;">Could not load research objects.</p>';
  }
}

// Living paper entry point: reuses the same artifact-discovery endpoint
// paper.html already relies on to find the GitHub repo, then asks
// /api/paper/living-evidence whether it's a living paper — that endpoint
// covers repos with their own committed evidence.json (author-published or
// CI-verified) AND repos ScienceEcosystem generated a manifest for itself
// by parsing the repo's source, so a button shows up even when the author
// never ran the generator — see server/living-paper-cache.js.
async function checkLivingPaperAvailable(rawDoi, paper) {
  const btn = document.getElementById('livingPaperBtn');
  if (!btn) return;
  // rawDoi comes straight from OpenAlex, which always returns the full
  // https://doi.org/... URL — normalize to bare here so the generated link
  // (and the artifacts lookup) don't end up with a doubly-wrapped DOI.
  rawDoi = String(rawDoi || '').replace(/^doi:/i, '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!rawDoi) return;
  try {
    // title/authors matter here — the resolver's GitHub-search path (which
    // is what actually finds most repos) needs them; doi alone only
    // catches repos with a Zenodo record explicitly cross-linked to the DOI.
    const title = paper?.display_name || paper?.title || '';
    const authors = (paper?.authorships || []).slice(0, 3)
      .map(a => a?.author?.display_name).filter(Boolean).join(', ');
    const qs = new URLSearchParams({ doi: rawDoi, title, authors });
    const res = await fetch(`/api/paper/artifacts?${qs.toString()}`);
    const artifacts = res.ok ? await res.json() : [];
    let repoHit = (artifacts || []).find(a => a.repository === 'GitHub' && a.url);

    // The artifacts endpoint only covers structured DataCite/Crossref
    // relations — a repo named only in the manuscript's own text (e.g. a
    // Data Availability statement, the common case) is never indexed there.
    // Fall back to the same publisher-page scrape paper.html's research-
    // objects harvest uses, which reads that text directly.
    if (!repoHit) {
      try {
        const linksRes = await fetch(`/api/paper/links?doi=${encodeURIComponent(rawDoi)}`);
        if (linksRes.ok) {
          const links = await linksRes.json();
          repoHit = (links || []).find(h => h.url && /github\.com\//i.test(h.url));
        }
      } catch (_) { /* fall through with repoHit still unset */ }
    }
    if (!repoHit || !repoHit.url) return;
    const m = repoHit.url.match(/github\.com\/([^\/]+)\/([^\/#?]+)/i);
    if (!m) return;
    const repo = `${m[1]}/${m[2]}`;

    const evRes = await fetch(`/api/paper/living-evidence?repo=${encodeURIComponent(repo)}`);
    if (!evRes.ok) return;
    const { tier } = await evRes.json();
    if (!tier || tier === 'none') return; // repo exists but isn't a living paper — no button

    btn.href = `living-paper.html?repo=${encodeURIComponent(repo)}&doi=${encodeURIComponent(rawDoi)}`;
    btn.style.display = '';
  } catch (e) { /* silent — button just stays hidden */ }
}

async function extractPDFReferences(pdfUrl) {
  const refsDiv = document.getElementById('pdfReferences');
  if (!refsDiv) return;
  refsDiv.innerHTML = '<p class="muted">Extracting references...</p>';

  try {
    const response = await fetch('/api/pdf/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl: pdfUrl })
    });

    if (!response.ok) throw new Error('Extraction failed');

    const data = await response.json();
    extractedReferences = Array.isArray(data.references) ? data.references : [];

    if (!extractedReferences.length) {
      refsDiv.innerHTML = '<p class="muted">No references found.</p>';
    } else {
      refsDiv.innerHTML = extractedReferences.map(ref => `
        <div class="reference-item" data-ref-number="${ref.number}" onclick="handleReferenceClick(${ref.number})">
          <span class="reference-number">[${ref.number}]</span>
          <div>
            <strong>${escapeHtml(ref.title || 'Untitled')}</strong>
            ${ref.authors && ref.authors.length > 0 ? `<p class="muted small">${escapeHtml(ref.authors.slice(0, 3).join(', '))}${ref.authors.length > 3 ? ' et al.' : ''}</p>` : ''}
            <div style="display:flex; gap:0.5rem; margin-top:0.25rem; flex-wrap:wrap;">
              ${ref.year ? `<span class="badge">${escapeHtml(ref.year)}</span>` : ''}
              ${ref.doi ? `<a href="https://doi.org/${encodeURIComponent(ref.doi)}" target="_blank" class="badge badge-ok" onclick="event.stopPropagation()">DOI</a>` : ''}
              <button class="badge badge-warn jump-ref-btn" data-ref-number="${ref.number}" onclick="event.stopPropagation()">Find in PDF</button>
            </div>
          </div>
        </div>
      `).join('');
    }

    wireReferenceButtons();
    renderFiguresAndTables(data);
    buildAuthorYearMap();
    applyCitationHighlights();
    wireCitationHover();

    return;
  } catch (e) {
    console.error('Reference extraction error:', e);
    // Fallback: extract references from rendered text layer
    refsDiv.innerHTML = '<p class="muted" style="font-size:.8rem;">Server extraction unavailable — trying text layer…</p>';
    setTimeout(() => {
      const fallback = extractRefsFromTextLayer();
      if (fallback.length) {
        extractedReferences = fallback;
        refsDiv.innerHTML = '<p class="muted" style="font-size:.75rem;margin-bottom:.5rem;">Extracted from text (basic):</p>' +
          fallback.map(ref => `
            <div class="reference-item" data-ref-number="${ref.number}" onclick="handleReferenceClick(${ref.number})">
              <span class="reference-number">[${ref.number}]</span>
              <div>
                <strong style="font-size:.82rem;">${escapeHtml(ref.title || 'Untitled')}</strong>
                <div style="display:flex;gap:.4rem;margin-top:.2rem;flex-wrap:wrap;">
                  ${ref.year ? `<span class="badge">${escapeHtml(ref.year)}</span>` : ''}
                  ${ref.doi ? `<a href="https://doi.org/${encodeURIComponent(ref.doi)}" target="_blank" class="badge badge-ok" onclick="event.stopPropagation()">DOI</a>` : ''}
                </div>
              </div>
            </div>`).join('');
        wireReferenceButtons();
        buildAuthorYearMap();
        applyCitationHighlights();
      } else {
        refsDiv.innerHTML = '<p class="muted">No references found.</p>';
      }
    }, 1500); // wait for text layers to finish rendering
  }
}

function extractFiguresTablesFromText() {
  const figures = [];
  const tables = [];
  const seen = new Set();

  const pages = Array.from(pageTextIndex.keys()).sort((a, b) => a - b);
  for (const pageNum of pages) {
    const entries = pageTextIndex.get(pageNum) || [];
    if (!entries.length) continue;

    // Group spans into lines by proximity of vertical midpoint
    const lines = [];
    for (const e of entries) {
      const midY = (e.rect.top + e.rect.bottom) / 2;
      const line = lines.find(l => Math.abs(l.midY - midY) < 8);
      if (line) {
        line.parts.push(e.text);
      } else {
        lines.push({ midY, parts: [e.text] });
      }
    }
    lines.sort((a, b) => a.midY - b.midY);

    for (let li = 0; li < lines.length; li++) {
      const lineText = lines[li].parts.join(' ').trim();

      // Figure caption: "Figure 1.", "Fig. 2a", "FIG 3"
      const figM = lineText.match(/^(fig(?:ure)?s?\.?\s*(\d+[a-z]?))[.\s:–—]/i);
      if (figM) {
        const num = figM[2];
        const key = `fig_${num}`;
        if (!seen.has(key)) {
          seen.add(key);
          const rest = lineText.slice(figM[0].length).trim();
          const nextLine = (lines[li + 1]?.parts.join(' ') || '').trim();
          const caption = (rest + (nextLine && !nextLine.match(/^(fig|table)/i) ? ' ' + nextLine : '')).slice(0, 220);
          figures.push({ number: num, caption: caption || lineText.slice(0, 120), page: pageNum });
        }
        continue;
      }

      // Table caption: "Table 1.", "TABLE S2"
      const tblM = lineText.match(/^(tables?\.?\s*(\d+[a-z]?))[.\s:–—]/i);
      if (tblM) {
        const num = tblM[2];
        const key = `tbl_${num}`;
        if (!seen.has(key)) {
          seen.add(key);
          const rest = lineText.slice(tblM[0].length).trim();
          const nextLine = (lines[li + 1]?.parts.join(' ') || '').trim();
          const caption = (rest + (nextLine && !nextLine.match(/^(fig|table)/i) ? ' ' + nextLine : '')).slice(0, 220);
          tables.push({ number: num, caption: caption || lineText.slice(0, 120), page: pageNum });
        }
      }
    }
  }

  // Sort by number
  const numSort = (a, b) => parseFloat(a.number) - parseFloat(b.number) || a.number.localeCompare(b.number);
  figures.sort(numSort);
  tables.sort(numSort);

  renderFiguresAndTables({ figures, tables });
}

function renderFiguresAndTables(data) {
  const figuresDiv = document.getElementById('pdfFigures');
  const tablesDiv = document.getElementById('pdfTables');
  if (!figuresDiv && !tablesDiv) return;

  const figures = Array.isArray(data?.figures) ? data.figures : [];
  const tables = Array.isArray(data?.tables) ? data.tables : [];

  if (figuresDiv) {
    if (!figures.length) {
      figuresDiv.innerHTML = '<p class="muted" style="font-size:.8rem;">No figure captions detected.</p>';
    } else {
      figuresDiv.innerHTML = figures.map(f => `
        <div class="reference-item" style="cursor:pointer;" onclick="jumpToPageWithFlash(${Number(f.page)})">
          <span class="reference-number">Fig ${escapeHtml(String(f.number))}</span>
          <div>
            <strong style="font-size:.82rem;">${escapeHtml(f.caption || 'No caption')}</strong>
            <p class="muted small">p. ${f.page}</p>
          </div>
        </div>
      `).join('');
    }
  }

  if (tablesDiv) {
    if (!tables.length) {
      tablesDiv.innerHTML = '<p class="muted" style="font-size:.8rem;">No table captions detected.</p>';
    } else {
      tablesDiv.innerHTML = tables.map(t => `
        <div class="reference-item" style="cursor:pointer;" onclick="jumpToPageWithFlash(${Number(t.page)})">
          <span class="reference-number">Table ${escapeHtml(String(t.number))}</span>
          <div>
            <strong style="font-size:.82rem;">${escapeHtml(t.caption || 'No caption')}</strong>
            <p class="muted small">p. ${t.page}</p>
          </div>
        </div>
      `).join('');
    }
  }
}

function renderPdfLinksSidebar() {
  const linksDiv = document.getElementById('pdfLinks');
  if (!linksDiv) return;
  if (!pdfLinkIndex.length) {
    linksDiv.innerHTML = '<p class="muted">No links detected.</p>';
    return;
  }

  // Split and deduplicate
  const seenUrls = new Set();
  const external = [];
  pdfLinkIndex.forEach((item, idx) => {
    if (!item.url) return;
    // Strip trailing punctuation that PDF parsers sometimes include in the annotation URL
    const cleanUrl = item.url.replace(/[.,;)\s]+$/, '');
    if (!cleanUrl.startsWith('http') || seenUrls.has(cleanUrl)) return;
    seenUrls.add(cleanUrl);
    external.push({ ...item, url: cleanUrl, _idx: idx });
  });

  const internal = pdfLinkIndex
    .map((item, idx) => ({ ...item, _idx: idx }))
    .filter(item => !item.url && item.dest);

  // Deduplicate internal links by target page (keep first occurrence per page)
  const seenDestPages = new Set();
  const uniqueInternal = internal.filter(item => {
    const key = item.page; // group by source page is fine; dest unknown until async resolve
    if (seenDestPages.has(JSON.stringify(item.dest))) return false;
    seenDestPages.add(JSON.stringify(item.dest));
    return true;
  });

  // Classify external link type
  function linkType(url) {
    if (/doi\.org/i.test(url)) return { label: 'DOI', cls: 'badge-ok' };
    if (/arxiv\.org/i.test(url)) return { label: 'arXiv', cls: 'badge-ok' };
    if (/zenodo\.org/i.test(url)) return { label: 'Zenodo', cls: '' };
    if (/github\.com/i.test(url)) return { label: 'GitHub', cls: '' };
    if (/hdl\.handle\.net/i.test(url)) return { label: 'Handle', cls: '' };
    return { label: 'Web', cls: '' };
  }

  function displayUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 1 ? u.pathname : '';
      const display = u.hostname.replace(/^www\./, '') + path;
      return display.length > 55 ? display.slice(0, 52) + '…' : display;
    } catch (_) { return url.slice(0, 55); }
  }

  let html = '';

  if (external.length) {
    html += `<p class="muted" style="font-size:.75rem;margin-bottom:.5rem;">${external.length} external link${external.length !== 1 ? 's' : ''}</p>`;
    html += external.map(item => {
      const { label, cls } = linkType(item.url);
      return `<div class="reference-item">
        <div>
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" style="font-size:.82rem;word-break:break-all;">${escapeHtml(displayUrl(item.url))}</a>
          <div style="display:flex;gap:.4rem;margin-top:.2rem;align-items:center;flex-wrap:wrap;">
            <span class="badge ${cls}" style="font-size:.7rem;">${label}</span>
            <span class="muted" style="font-size:.7rem;">p.${item.page}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  if (uniqueInternal.length) {
    html += `<p class="muted" style="font-size:.75rem;margin:1rem 0 .4rem;">${internal.length} internal cross-reference${internal.length !== 1 ? 's' : ''}</p>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:.3rem;">`;
    html += uniqueInternal.map(item =>
      `<button class="badge" onclick="jumpToInternalLink(${item._idx})" style="cursor:pointer;font-size:.75rem;">p.${item.page}</button>`
    ).join('');
    html += `</div>`;
  }

  linksDiv.innerHTML = html || '<p class="muted">No links detected.</p>';
}

async function jumpToInternalLink(index) {
  const item = pdfLinkIndex[index];
  if (!item || !item.dest) return;
  const target = await resolveDestToPage(item.dest);
  if (target) {
    pageNum = target;
    queueRenderPage(target);
  }
}

function wireReferenceButtons() {
  document.querySelectorAll('.jump-ref-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.getAttribute('data-ref-number');
      if (n) jumpToCitation(n);
    });
  });
}

function handleReferenceClick(refNumber) {
  // Switch to Refs tab
  const refsTabBtn = document.querySelector('.pdf-tab-btn[data-tab="refs"]');
  if (refsTabBtn) refsTabBtn.click();

  // Scroll to and highlight the ref card. The Refs tab renders one of two
  // lists depending on what loaded: PDF-extracted references (native
  // bibliography numbering, `.reference-item[data-ref-number]`) or the
  // OpenAlex fallback list (alphabetical, `#oa-ref-N`) — try both.
  const refNum = parseInt(refNumber, 10);
  const card = document.querySelector(`.reference-item[data-ref-number="${refNum}"]`) ||
    document.getElementById(`oa-ref-${refNum}`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.outline = '2px solid #0284c7';
  card.style.outlineOffset = '2px';
  setTimeout(() => { card.style.outline = ''; card.style.outlineOffset = ''; }, 2000);
}

// ── Citation info popup ─────────────────────────────────────────────────────
// Clicking an in-text citation opens a small card with title/authors/
// abstract snippet/cited-by count and Save/Open/See-in-References actions,
// anchored right next to the citation — the same idea as the citation
// preview popup some PDF readers/extensions show, backed by our own
// OpenAlex data instead of linking out to Google Scholar.

const _citationInfoCache = new Map(); // refNum -> resolved OpenAlex work, or null

function closeReferencePopup() {
  document.getElementById('citationInfoPopup')?.remove();
  document.removeEventListener('mousedown', _citationInfoOutsideClick, true);
}
function _citationInfoOutsideClick(e) {
  const popup = document.getElementById('citationInfoPopup');
  if (popup && !popup.contains(e.target) && !e.target.closest('.citation-highlight')) closeReferencePopup();
}

function _citationInfoBaseData(refNum) {
  const extracted = getExtractedRefByNumber(refNum);
  if (extracted) {
    return {
      title: extracted.title || 'Untitled',
      authors: extracted.authors || [],
      year: extracted.year || null,
      doi: extracted.doi || null,
      openalexId: null,
      abstract: null,
      citedBy: null,
    };
  }
  const w = getRefByNumber(refNum);
  if (!w) return null;
  return {
    title: w.title || w.display_name || 'Untitled',
    authors: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean),
    year: w.publication_year || null,
    doi: w.doi ? w.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null,
    openalexId: w.id ? w.id.replace('https://openalex.org/', '') : null,
    abstract: w.abstract_inverted_index ? invertAbstractWords(w.abstract_inverted_index) : null,
    citedBy: typeof w.cited_by_count === 'number' ? w.cited_by_count : null,
  };
}

function invertAbstractWords(idx) {
  if (!idx || typeof idx !== 'object') return null;
  const words = [];
  for (const [word, positions] of Object.entries(idx)) {
    for (const p of positions) words[p] = word;
  }
  return words.join(' ') || null;
}

// Fetches full OpenAlex fields (abstract + cited-by count) for a reference
// that only came from PDF text extraction — by DOI when we have one,
// otherwise a title search. Cached per refNum for the life of the page.
async function _resolveCitationInfoFull(refNum, base) {
  if (_citationInfoCache.has(refNum)) return _citationInfoCache.get(refNum);
  const fields = 'id,title,display_name,authorships,publication_year,doi,cited_by_count,abstract_inverted_index';
  let work = null;
  try {
    if (base.doi) {
      const r = await fetch(`${location.origin}/api/openalex/works/doi:${encodeURIComponent(base.doi)}?select=${fields}&mailto=scienceecosystem@icloud.com`);
      if (r.ok) work = await r.json();
    }
    if (!work && base.title) {
      const q = base.authors?.[0] ? `${base.title} ${base.authors[0]}` : base.title;
      const r = await fetch(`${location.origin}/api/openalex/works?search=${encodeURIComponent(q)}&per-page=1&select=${fields}&mailto=scienceecosystem@icloud.com`);
      if (r.ok) { const d = await r.json(); work = d.results?.[0] || null; }
    }
  } catch (_e) { work = null; }
  _citationInfoCache.set(refNum, work);
  return work;
}

function _citationInfoBody(data, saved) {
  const authorsStr = data.authors.slice(0, 4).join(', ') + (data.authors.length > 4 ? ' et al.' : '');
  const abstractHtml = data.abstract
    ? `<div class="ci-abstract" data-full="${escapeHtml(data.abstract)}">${escapeHtml(data.abstract.length > 220 ? data.abstract.slice(0, 220) + '…' : data.abstract)}${data.abstract.length > 220 ? ' <a href="#" class="ci-show-more">Show more</a>' : ''}</div>`
    : `<div class="ci-abstract muted" style="font-style:italic;">${data._loading ? 'Loading abstract…' : 'No abstract available.'}</div>`;
  const citedByHtml = typeof data.citedBy === 'number'
    ? `<div class="muted" style="font-size:.75rem;margin-top:.35rem;">Cited by ${data.citedBy.toLocaleString()}</div>` : '';
  const paperHref = data.openalexId ? `/paper.html?id=${encodeURIComponent(data.openalexId)}`
    : (data.doi ? `https://doi.org/${encodeURIComponent(data.doi)}` : null);

  return `
    <div style="display:flex;align-items:flex-start;gap:.4rem;">
      <div style="flex:1;font-weight:600;font-size:.88rem;line-height:1.3;">${escapeHtml(data.title)}</div>
      <button class="ci-close" title="Close" aria-label="Close" style="flex:0 0 auto;border:none;background:none;cursor:pointer;font-size:1rem;color:#64748b;padding:0 .1rem;">×</button>
    </div>
    ${authorsStr ? `<div class="muted" style="font-size:.78rem;margin-top:.15rem;">${escapeHtml(authorsStr)}${data.year ? ' · ' + escapeHtml(String(data.year)) : ''}</div>` : ''}
    <div style="font-size:.8rem;line-height:1.4;margin-top:.5rem;color:#334155;">${abstractHtml}</div>
    ${citedByHtml}
    <div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.6rem;">
      <button class="btn btn-secondary btn-xs ci-save" ${saved ? 'disabled' : ''}>${saved ? '✓ Saved' : '+ Save'}</button>
      ${paperHref ? `<a href="${paperHref}" target="_blank" rel="noopener" class="btn btn-secondary btn-xs">Open paper page →</a>` : ''}
      ${data._hasLocalRef !== false ? '<button class="btn btn-secondary btn-xs ci-see-refs">See in References</button>' : ''}
    </div>
  `;
}

function openCitationInfoPopup(refNum, anchorEl) {
  closeReferencePopup();
  const base = _citationInfoBaseData(refNum);
  if (!base) return;

  // Also switch the sidebar to Refs and highlight the matching entry there,
  // same as the popup's own "See in References" button — this never
  // scrolls the main PDF page (handleReferenceClick only touches the
  // sidebar), so it's safe to do automatically alongside the popup. If the
  // side panel is currently collapsed, reveal it too — showing the ref in
  // a hidden panel wouldn't actually be visible.
  if (document.querySelector('.pdf-container')?.classList.contains('sidebar-hidden')) {
    setPdfSidebarHidden(false);
  }
  handleReferenceClick(refNum);

  const popup = document.createElement('div');
  popup.id = 'citationInfoPopup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Reference info');
  const cached = _citationInfoCache.get(refNum);
  const data = cached ? { ...base, abstract: base.abstract || invertAbstractWords(cached.abstract_inverted_index), citedBy: base.citedBy ?? cached.cited_by_count ?? null, openalexId: base.openalexId || (cached.id ? cached.id.replace('https://openalex.org/', '') : null) } : base;
  if (!cached) data._loading = true;
  popup.innerHTML = _citationInfoBody(data, false);
  document.body.appendChild(popup);
  _positionCitationInfoPopup(popup, anchorEl);
  _wireCitationInfoButtons(popup, refNum, data);

  if (!cached) {
    _resolveCitationInfoFull(refNum, base).then((work) => {
      if (document.getElementById('citationInfoPopup') !== popup) return; // popup closed/replaced meanwhile
      const enriched = work ? {
        ...base,
        abstract: invertAbstractWords(work.abstract_inverted_index),
        citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
        openalexId: work.id ? work.id.replace('https://openalex.org/', '') : base.openalexId,
      } : base;
      popup.innerHTML = _citationInfoBody(enriched, false);
      _wireCitationInfoButtons(popup, refNum, enriched);
    });
  }

  setTimeout(() => document.addEventListener('mousedown', _citationInfoOutsideClick, true), 0);
}

function _positionCitationInfoPopup(popup, anchorEl) {
  popup.style.visibility = 'hidden';
  popup.style.display = 'block';
  const w = popup.offsetWidth || 320;
  const h = popup.offsetHeight || 160;
  const a = anchorEl.getBoundingClientRect();
  let left = a.left;
  let top = a.bottom + 8;
  if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
  if (left < 12) left = 12;
  if (top + h > window.innerHeight - 12) top = a.top - h - 8;
  if (top < 12) top = 12;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.visibility = 'visible';
}

function _wireCitationInfoButtons(popup, refNum, data) {
  popup.querySelector('.ci-close')?.addEventListener('click', closeReferencePopup);
  popup.querySelector('.ci-see-refs')?.addEventListener('click', () => {
    closeReferencePopup();
    handleReferenceClick(refNum);
  });
  popup.querySelector('.ci-show-more')?.addEventListener('click', (e) => {
    e.preventDefault();
    const el = e.target.closest('.ci-abstract');
    if (el) el.textContent = el.dataset.full;
  });
  const saveBtn = popup.querySelector('.ci-save');
  saveBtn?.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const id = data.openalexId || (data.doi ? `doi:${data.doi}` : null);
    if (!id) { saveBtn.textContent = 'No ID to save'; return; }
    try {
      const res = await fetch('/api/library', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title: data.title, doi: data.doi || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      saveBtn.textContent = '✓ Saved';
    } catch (_e) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Could not save — sign in?';
    }
  });
}

// ── Live-resolved citations — for a PDF with no usable local reference data
// at all (GROBID failed, and its own bibliography isn't in a numbered
// format extractRefsFromTextLayer's fallback can parse — an APA/author-
// year reference list, common in theses, has neither). Rather than fall
// back to the old raw in-PDF jump whenever local matching comes up empty,
// resolve the citation live via a search against OpenAlex using the
// author+year text itself, so the popup (and specifically "not jumping
// around the PDF") still works even with zero local reference data.
async function resolveCitationByRawText(rawText) {
  const t = String(rawText || '').trim();
  const m = t.match(/([A-Za-zÀ-ÖØ-öø-ÿ'\-]+)[^0-9]*?\b((?:19|20)\d{2})([a-z])?\b/);
  const surname = m ? m[1] : (t.match(/[A-Za-zÀ-ÖØ-öø-ÿ'\-]+/) || [])[0];
  const year = m ? m[2] : null;
  if (!surname) return null;
  const fields = 'id,title,display_name,authorships,publication_year,doi,cited_by_count,abstract_inverted_index';
  try {
    let url = `${location.origin}/api/openalex/works?search=${encodeURIComponent(surname)}&per-page=5&select=${fields}&mailto=scienceecosystem@icloud.com`;
    if (year) url += `&filter=publication_year:${year}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const results = d.results || [];
    if (!results.length) return null;
    // Prefer a result whose actual first-author surname matches — a plain
    // search= can rank a work mentioning the surname in its title/abstract
    // above the work actually written by that author.
    const surnameLower = surname.toLowerCase();
    return results.find(w => (w.authorships?.[0]?.author?.display_name || '').split(' ').pop().toLowerCase() === surnameLower) || results[0];
  } catch (_e) {
    return null;
  }
}

function looksLikeAuthorYearCitation(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/fig(ure)?\.?\s*\d|table\s*\d/i.test(t)) return false;
  return /[A-Za-zÀ-ÖØ-öø-ÿ]+[\s\S]*\b(19|20)\d{2}[a-z]?\b/.test(t);
}

async function openCitationInfoPopupLive(rawText, anchorEl) {
  closeReferencePopup();
  const popup = document.createElement('div');
  popup.id = 'citationInfoPopup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Reference info');
  const loading = { title: rawText.trim(), authors: [], year: null, doi: null, openalexId: null, abstract: null, citedBy: null, _loading: true, _hasLocalRef: false };
  popup.innerHTML = _citationInfoBody(loading, false);
  document.body.appendChild(popup);
  _positionCitationInfoPopup(popup, anchorEl);
  _wireCitationInfoButtons(popup, null, loading);
  setTimeout(() => document.addEventListener('mousedown', _citationInfoOutsideClick, true), 0);

  const work = await resolveCitationByRawText(rawText);
  if (document.getElementById('citationInfoPopup') !== popup) return; // closed/replaced meanwhile

  if (!work) {
    popup.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:.4rem;">
        <div style="flex:1;font-weight:600;font-size:.88rem;">Could not identify this reference</div>
        <button class="ci-close" title="Close" aria-label="Close" style="flex:0 0 auto;border:none;background:none;cursor:pointer;font-size:1rem;color:#64748b;">×</button>
      </div>
      <div class="muted" style="font-size:.8rem;margin-top:.4rem;">"${escapeHtml(rawText.trim())}"</div>`;
    popup.querySelector('.ci-close')?.addEventListener('click', closeReferencePopup);
    return;
  }
  const data = {
    title: work.title || work.display_name || rawText.trim(),
    authors: (work.authorships || []).map(a => a.author?.display_name).filter(Boolean),
    year: work.publication_year || null,
    doi: work.doi ? work.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : null,
    openalexId: work.id ? work.id.replace('https://openalex.org/', '') : null,
    abstract: invertAbstractWords(work.abstract_inverted_index),
    citedBy: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
    _hasLocalRef: false,
  };
  popup.innerHTML = _citationInfoBody(data, false);
  _wireCitationInfoButtons(popup, null, data);
}

window.handleReferenceClick = handleReferenceClick;
window.closeReferencePopup = closeReferencePopup;
window.jumpToInternalLink = jumpToInternalLink;
window.jumpToPageWithFlash = function (page) { goToPage(page); flashPageWrap(page); };

// Escape handled by the combined listener below (removeSelToolbar + closeReferencePopup)

window.addEventListener('DOMContentLoaded', async () => {
  if (!pdfUrl) {
    document.querySelector('.pdf-main-body')?.insertAdjacentHTML('afterbegin',
      '<p style="padding:2rem;color:#c0392b;">No PDF URL provided. Please open this page from a paper link.</p>');
    return;
  }

  bindSidebarTabs();
  bindSearch();

  annotationKey = `se_annotations_${encodeURIComponent(pdfUrl)}`;

  // Try loading annotations from server first, fall back to localStorage
  const serverLoaded = await loadAnnotationsFromServer();
  if (!serverLoaded) loadAnnotations();
  renderNotesTab();

  loadPDF(pdfUrl);

  if (paperId) {
    // OpenAlex-based: metadata chains into refs + research objects
    loadPaperMetadata(paperId);
    // Figures/tables extracted from PDF text layer after rendering
    const figs = document.getElementById('pdfFigures');
    const tabs = document.getElementById('pdfTables');
    if (figs) figs.innerHTML = '<p class="muted" style="font-size:.8rem;">Scanning PDF…</p>';
    if (tabs) tabs.innerHTML = '<p class="muted" style="font-size:.8rem;">Scanning PDF…</p>';
  } else {
    extractPDFReferences(pdfUrl);
    // Hide research objects section — only available when we have an OpenAlex ID
    const roEl = document.getElementById('pdfResearchObjects');
    if (roEl) {
      roEl.previousElementSibling?.remove(); // remove the <h3> label
      roEl.remove();
    }
  }
});

function bindAnnotationToolbar() {
  const n = document.getElementById('annotNoteBtn');
  const e = document.getElementById('annotEraseBtn');
  const c = document.getElementById('annotClearBtn');
  // Toggle: clicking the already-active mode button turns it back off
  // (returns to plain selection/reading), instead of being stuck in
  // note-placement or erase mode until the other button is clicked.
  const setMode = (m) => { annotMode = (annotMode === m) ? 'none' : m; updateAnnotButtons(); };
  n?.addEventListener('click', () => setMode('note'));
  e?.addEventListener('click', () => setMode('erase'));
  if (c) {
    let clearPending = false;
    let clearTimer = null;
    c.addEventListener('click', () => {
      if (!clearPending) {
        clearPending = true;
        c.textContent = 'Clear all? Click again';
        c.style.color = '#dc2626';
        c.style.borderColor = '#dc2626';
        clearTimer = setTimeout(() => {
          clearPending = false;
          c.textContent = 'Clear All';
          c.style.color = '';
          c.style.borderColor = '';
        }, 3000);
      } else {
        clearTimeout(clearTimer);
        clearPending = false;
        c.textContent = 'Clear All';
        c.style.color = '';
        c.style.borderColor = '';
        annotations = [];
        saveAnnotations();
        renderAnnotationsAll();
      }
    });
    // Cancel if user clicks anywhere else
    document.addEventListener('click', (ev) => {
      if (clearPending && ev.target !== c) {
        clearTimeout(clearTimer);
        clearPending = false;
        c.textContent = 'Clear All';
        c.style.color = '';
        c.style.borderColor = '';
      }
    }, true);
  }
  updateAnnotButtons();
}

function updateAnnotButtons() {
  const map = {
    note: 'annotNoteBtn',
    erase: 'annotEraseBtn'
  };
  Object.keys(map).forEach(k => {
    const el = document.getElementById(map[k]);
    if (!el) return;
    if (annotMode === k) el.classList.add('btn-primary');
    else el.classList.remove('btn-primary');
  });
  document.body.classList.toggle('annot-erase', annotMode === 'erase');
}

// ---- Highlight color palette ----
const HIGHLIGHT_COLORS = [
  { name: 'yellow', value: 'rgba(255,235,59,0.55)' },
  { name: 'green',  value: 'rgba(105,220,120,0.45)' },
  { name: 'blue',   value: 'rgba(100,181,246,0.45)' },
  { name: 'pink',   value: 'rgba(244,143,177,0.50)' },
];
const UNDERLINE_COLOR = '#e53935';

// ---- Floating selection toolbar ----
let _selToolbar = null;

function removeSelToolbar() {
  if (_selToolbar) { _selToolbar.remove(); _selToolbar = null; }
}

function showSelToolbar(x, y, quote, page, normRects) {
  removeSelToolbar();
  const tb = document.createElement('div');
  tb.className = 'pdf-sel-toolbar';
  // Position above the selection, clamped to viewport
  const TOP_OFFSET = 44;
  tb.style.left = Math.min(x, window.innerWidth - 220) + 'px';
  tb.style.top  = Math.max(4, y - TOP_OFFSET) + 'px';

  const btn = (label, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('mousedown', (e) => { e.preventDefault(); }); // keep selection alive
    b.addEventListener('click', () => { onClick(); removeSelToolbar(); window.getSelection()?.removeAllRanges(); });
    return b;
  };

  tb.appendChild(btn('📋 Copy', () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(quote).catch(() => {});
    } else {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = quote; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch(_) {}
      ta.remove();
    }
    showCopiedToast();
  }));

  const divider = () => { const d = document.createElement('div'); d.className = 'pdf-sel-divider'; return d; };
  tb.appendChild(divider());

  // Color swatches — this is the one place highlighting actually happens
  // (clicking a color highlights the selection immediately, no separate
  // "Highlight" mode to turn on first).
  HIGHLIGHT_COLORS.forEach(c => {
    const sw = document.createElement('button');
    sw.className = 'pdf-sel-swatch';
    sw.title = `Highlight (${c.name})`;
    sw.style.background = c.value;
    sw.addEventListener('mousedown', (e) => { e.preventDefault(); });
    sw.addEventListener('click', () => {
      createAnnotation(page, normRects, quote, 'highlight', '', c.value);
      removeSelToolbar();
      window.getSelection()?.removeAllRanges();
    });
    tb.appendChild(sw);
  });

  tb.appendChild(divider());

  tb.appendChild(btn('U Underline', () => {
    createAnnotation(page, normRects, quote, 'underline', '', UNDERLINE_COLOR);
  }));

  tb.appendChild(btn('💬 Comment', () => {
    // Replace toolbar contents with an inline note input
    tb.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type your note…';
    Object.assign(input.style, {
      background: '#1e293b', color: '#f8fafc', border: '1px solid #475569',
      borderRadius: '6px', padding: '4px 8px', fontSize: '.82rem',
      width: '200px', outline: 'none', fontFamily: 'inherit'
    });
    const save = document.createElement('button');
    save.textContent = 'Save';
    Object.assign(save.style, { color: '#7dd3fc', fontWeight: '600' });
    const cancel = document.createElement('button');
    cancel.textContent = '✕';
    const doSave = () => {
      const note = input.value.trim();
      createAnnotation(page, normRects, quote, 'note', note);
      removeSelToolbar();
      window.getSelection()?.removeAllRanges();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
      if (e.key === 'Escape') { removeSelToolbar(); }
    });
    save.addEventListener('mousedown', (e) => e.preventDefault());
    save.addEventListener('click', doSave);
    cancel.addEventListener('mousedown', (e) => e.preventDefault());
    cancel.addEventListener('click', () => removeSelToolbar());
    tb.appendChild(input);
    tb.appendChild(save);
    tb.appendChild(cancel);
    setTimeout(() => input.focus(), 0);
  }));

  tb.appendChild(btn('✕', () => {}));

  document.body.appendChild(tb);
  _selToolbar = tb;

  // Dismiss on outside click or Escape
  setTimeout(() => {
    const onDown = (e) => {
      if (!tb.contains(e.target)) { removeSelToolbar(); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
  }, 0);
}

function showCopiedToast() {
  const t = document.createElement('div');
  t.textContent = 'Copied!';
  Object.assign(t.style, { position:'fixed', bottom:'1.5rem', right:'1.5rem', background:'#15803d', color:'#fff', padding:'.55rem 1rem', borderRadius:'8px', fontSize:'.9rem', zIndex:'10020', boxShadow:'0 4px 12px rgba(0,0,0,.2)', opacity:'0', transition:'opacity .15s' });
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 150); }, 1800);
}

function showNotePopup(x, y, text) {
  const existing = document.getElementById('pdfNotePopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'pdfNotePopup';
  Object.assign(popup.style, {
    position: 'fixed', zIndex: '10020', background: '#1e293b', color: '#f8fafc',
    border: '1px solid #475569', borderRadius: '8px', padding: '.6rem .8rem',
    fontSize: '.85rem', maxWidth: '280px', boxShadow: '0 4px 12px rgba(0,0,0,.3)',
    left: Math.min(x, window.innerWidth - 300) + 'px',
    top: Math.min(y + 8, window.innerHeight - 100) + 'px'
  });
  popup.textContent = text;
  document.body.appendChild(popup);

  setTimeout(() => {
    const onDown = (e) => {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('mousedown', onDown); }
    };
    document.addEventListener('mousedown', onDown);
  }, 0);
}

function createAnnotation(page, normRects, quote, type, note, color) {
  annotations.push({
    id: String(Date.now()) + '_' + Math.random().toString(16).slice(2),
    page, type, rects: normRects, quote, note, color: color || null
  });
  saveAnnotations();
  renderAnnotationsForPage(page);
}

function removeAnnotation(id) {
  annotations = annotations.filter(a => a.id !== id);
  saveAnnotations();
}

// Sticky notes: point-anchored notes placed by clicking anywhere on the page
// while the "Note" tool is active — not tied to a text selection. Rendered as
// a small draggable pin; clicking the pin opens an editable box at that spot.
function pageCanvasSize(wrap) {
  const canvas = wrap.querySelector('.pdf-page-canvas');
  return {
    cw: canvas ? canvas.offsetWidth || canvas.width : wrap.offsetWidth,
    ch: canvas ? canvas.offsetHeight || canvas.height : wrap.offsetHeight
  };
}

function closeNoteBox() {
  if (_openNoteBox) {
    _openNoteBox.cleanup();
    _openNoteBox.el.remove();
    _openNoteBox = null;
  }
}

// Wires shared drag-to-move behavior for a point annotation. `handleEl` is the
// element that starts the drag (the pin itself, or the box's title-bar
// handle); `carrierEl` is the element whose position actually moves (same as
// handleEl for the pin, the whole box for the note editor). Persists the new
// normalized point on the annotation once the drag ends.
function wireNotePointDrag(handleEl, carrierEl, wrap, page, annotId, onDragEnd) {
  let dragging = false, moved = false, startX, startY, origLeft, origTop;
  const onMove = (e) => {
    if (!dragging) return;
    moved = true;
    carrierEl.style.left = `${origLeft + (e.clientX - startX)}px`;
    carrierEl.style.top = `${origTop + (e.clientY - startY)}px`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (!moved) { onDragEnd(false); return; }
    const { cw, ch } = pageCanvasSize(wrap);
    const newNorm = {
      x: parseFloat(carrierEl.style.left) / cw,
      y: parseFloat(carrierEl.style.top) / ch,
      _norm: true, _point: true
    };
    const a = annotations.find(x => x.id === annotId);
    if (a) { a.rects = [newNorm]; saveAnnotations(); }
    onDragEnd(true);
  };
  handleEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY;
    origLeft = parseFloat(carrierEl.style.left) || 0;
    origTop = parseFloat(carrierEl.style.top) || 0;
    e.preventDefault();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// Opens the bright-yellow editable note box at a normalized point. Pass
// `existingId`/`existingText` to edit an existing sticky note; omit both to
// create a brand-new one on save.
function openNoteBox(wrap, page, pointNorm, existingId, existingText) {
  closeNoteBox();
  const layer = wrap.querySelector('.pdf-annotation-layer');
  if (!layer) return;
  const { cw, ch } = pageCanvasSize(wrap);

  const box = document.createElement('div');
  box.className = 'pdf-note-box';
  box.style.left = `${pointNorm.x * cw}px`;
  box.style.top = `${pointNorm.y * ch}px`;

  const handle = document.createElement('div');
  handle.className = 'pdf-note-box-handle';
  handle.textContent = '⠿ Note — drag to move';
  box.appendChild(handle);

  const textarea = document.createElement('textarea');
  textarea.className = 'pdf-note-box-textarea';
  textarea.value = existingText || '';
  textarea.placeholder = 'Type your note…';
  box.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'pdf-note-box-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'pdf-note-save';
  saveBtn.textContent = 'Save';
  actions.appendChild(saveBtn);
  if (existingId) {
    const delBtn = document.createElement('button');
    delBtn.className = 'pdf-note-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
      removeAnnotation(existingId);
      closeNoteBox();
      renderAnnotationsForPage(page);
    });
    actions.appendChild(delBtn);
  }
  box.appendChild(actions);
  layer.appendChild(box);

  let annotId = existingId;
  const commit = () => {
    const text = textarea.value.trim();
    const { cw: cw2, ch: ch2 } = pageCanvasSize(wrap);
    const norm = { x: parseFloat(box.style.left) / cw2, y: parseFloat(box.style.top) / ch2, _norm: true, _point: true };
    if (!text) {
      if (annotId) removeAnnotation(annotId);
      return;
    }
    if (annotId) {
      const a = annotations.find(x => x.id === annotId);
      if (a) { a.note = text; a.rects = [norm]; }
    } else {
      annotId = String(Date.now()) + '_' + Math.random().toString(16).slice(2);
      annotations.push({ id: annotId, page, type: 'note', rects: [norm], quote: '', note: text, color: null });
    }
    saveAnnotations();
  };

  const onOutsideDown = (e) => {
    if (!box.contains(e.target)) finish();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') finish();
  };
  function finish() {
    commit();
    closeNoteBox();
    renderAnnotationsForPage(page);
  }
  saveBtn.addEventListener('click', finish);
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideDown);
    document.addEventListener('keydown', onKeyDown);
  }, 0);

  wireNotePointDrag(handle, box, wrap, page, annotId, (didMove) => {
    if (didMove && !annotId) {
      // Dragged before the first save — nothing persisted yet, box stays open.
    }
  });

  _openNoteBox = {
    el: box,
    cleanup() {
      document.removeEventListener('mousedown', onOutsideDown);
      document.removeEventListener('keydown', onKeyDown);
    }
  };
}

// Merge selection rects that overlap on the same text line into single wider rects.
// Two rects are considered the same line when their vertical ranges actually
// overlap by a meaningful fraction of the shorter rect's height — a real
// geometric check, robust to dense/tight line spacing — rather than comparing
// against a fixed multiple of whichever rect happened to start the band
// (that heuristic could misfire on tight line spacing and let one line's box
// absorb the next line's rects too, stretching the highlight past where the
// text actually is).
function mergeLineRects(rects) {
  if (!rects.length) return rects;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    let sameLine = false;
    if (last) {
      const top = Math.max(last.y, r.y);
      const bottom = Math.min(last.y + last.h, r.y + r.h);
      const overlap = bottom - top;
      const shorter = Math.min(last.h, r.h);
      sameLine = overlap > 0 && overlap >= shorter * 0.5;
    }
    if (sameLine) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      const top = Math.min(last.y, r.y);
      last.x = Math.min(last.x, r.x);
      last.y = top;
      last.w = right - last.x;
      last.h = bottom - top;
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

function wireAnnotationSelection(layerEl) {
  layerEl.addEventListener('mouseup', (ev) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    if (!layerEl.contains(sel.anchorNode) && !layerEl.contains(sel.focusNode)) return;

    const range = sel.getRangeAt(0);
    const rects = Array.from(range.getClientRects());
    if (!rects.length) return;

    const wrap = layerEl.closest('.pdf-page-wrap');
    if (!wrap) return;
    const page = Number(wrap.getAttribute('data-page') || '0');
    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return;

    // Merge rects that are on the same line (same vertical band) to avoid gaps between spans
    const raw = rects
      .filter(r => r.width > 0 && r.height > 0)
      .map(r => ({
        x: r.left - wrapRect.left,
        y: r.top - wrapRect.top,
        w: r.width,
        h: r.height
      }));
    const merged = mergeLineRects(raw);

    // Store as fractions of page size so annotations survive zoom changes
    const normRects = merged.map(r => ({
      x: r.x / wrapRect.width,
      y: r.y / wrapRect.height,
      w: r.w / wrapRect.width,
      h: r.h / wrapRect.height,
      _norm: true
    }));

    const quote = sel.toString().trim();
    if (!quote) return;

    // Show toolbar at mouse position — selection stays intact so Ctrl+C still works
    showSelToolbar(ev.clientX, ev.clientY, quote, page, normRects);
  });

  // Note mode: a plain click (no drag-selection) anywhere on the page places
  // a free-floating sticky note at that exact spot — the top "Note" button
  // used to only set annotMode with nothing else ever checking it, so
  // clicking the page while in note mode did nothing.
  layerEl.addEventListener('click', (ev) => {
    if (annotMode !== 'note') return;
    if (ev.target.closest('.pdf-annot-note-pin') || ev.target.closest('.pdf-note-box')) return;
    // Deliberately NOT excluding .citation-highlight here: those spans often
    // cover far more area than the visible citation text (a whole PDF.js
    // text-layer span can span a full line), so excluding them silently
    // blocked most clicks in citation-dense papers. The citation click
    // handler above already yields to note placement when annotMode is 'note'.
    if (ev.target.closest('.pdf-link')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) return;

    const wrap = layerEl.closest('.pdf-page-wrap');
    if (!wrap) return;
    const page = Number(wrap.getAttribute('data-page') || '0');
    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width || !wrapRect.height) return;

    const pointNorm = {
      x: (ev.clientX - wrapRect.left) / wrapRect.width,
      y: (ev.clientY - wrapRect.top) / wrapRect.height,
      _norm: true, _point: true
    };
    openNoteBox(wrap, page, pointNorm, null, '');
  });

  // Erase mode: click annotation to remove it. Otherwise, clicking a note
  // annotation shows its text (relying on the native title-attribute tooltip
  // alone made notes effectively invisible — you had to hover and wait).
  // Must be on the annotation layer (sibling of text layer) — not on layerEl itself.
  const annotLayer = layerEl.closest('.pdf-page-wrap')?.querySelector('.pdf-annotation-layer');
  if (annotLayer) {
    annotLayer.addEventListener('click', (ev) => {
      const target = ev.target.closest('.pdf-annot');
      if (!target) return;
      const id = target.getAttribute('data-annot-id');
      if (!id) return;

      if (annotMode === 'erase') {
        annotations = annotations.filter(a => a.id !== id);
        saveAnnotations();
        renderAnnotationsForPage(layerEl.closest('.pdf-page-wrap') ?
          Number(layerEl.closest('.pdf-page-wrap').getAttribute('data-page')) : 0);
        return;
      }

      const annot = annotations.find(a => a.id === id);
      if (annot?.type === 'note' && annot.note) {
        showNotePopup(ev.clientX, ev.clientY, annot.note);
      }
    });
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { removeSelToolbar(); closeReferencePopup(); }
});

function renderAnnotationsAll() {
  document.querySelectorAll('.pdf-page-wrap').forEach(w => {
    const page = Number(w.getAttribute('data-page') || '0');
    renderAnnotationsForPage(page);
  });
}

function renderAnnotationsForPage(page) {
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${page}"]`);
  if (!wrap) return;
  const layer = wrap.querySelector('.pdf-annotation-layer');
  if (!layer) return;
  layer.innerHTML = '';

  // Page canvas gives us current pixel dimensions for normalizing stored coords
  const canvas = wrap.querySelector('.pdf-page-canvas');
  const cw = canvas ? canvas.offsetWidth || canvas.width : wrap.offsetWidth;
  const ch = canvas ? canvas.offsetHeight || canvas.height : wrap.offsetHeight;

  const pageAnnots = annotations.filter(a => a.page === page);
  pageAnnots.forEach(a => {
    // Point-anchored sticky notes render as a draggable pin, not a rect.
    if (a.type === 'note' && a.rects[0]?._point) {
      const point = a.rects[0];
      const pin = document.createElement('div');
      pin.className = 'pdf-annot-note-pin';
      pin.setAttribute('data-annot-id', a.id);
      pin.style.left = `${point.x * cw}px`;
      pin.style.top = `${point.y * ch}px`;
      pin.textContent = '📌';
      pin.title = a.note || '';
      pin.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (annotMode === 'erase') {
          removeAnnotation(a.id);
          renderAnnotationsForPage(page);
          return;
        }
        openNoteBox(wrap, page, point, a.id, a.note || '');
      });
      wireNotePointDrag(pin, pin, wrap, page, a.id, () => {});
      layer.appendChild(pin);
      return;
    }

    a.rects.forEach((r, ri) => {
      // r._norm means coords are 0-1 fractions; legacy rects are absolute px
      const px = r._norm ? r.x * cw : r.x;
      const py = r._norm ? r.y * ch : r.y;
      const pw = r._norm ? r.w * cw : r.w;
      const ph = r._norm ? r.h * ch : r.h;

      const d = document.createElement('div');
      d.className = 'pdf-annot';
      d.setAttribute('data-annot-id', a.id);
      d.style.left = `${px}px`;
      if (a.type === 'underline') {
        d.style.top = `${py + ph - 2}px`;
        d.style.width = `${pw}px`;
        d.style.height = '2px';
        d.style.background = a.color || UNDERLINE_COLOR;
      } else {
        // The captured rect is the browser's full line-box (Range.
        // getClientRects()), which includes leading/line-gap above and
        // below the glyphs themselves — drawing a highlight at that exact
        // height makes it visibly bleed into the whitespace above/below
        // the actual text instead of hugging just the line (reported
        // live, with a screenshot). Trimmed in just for highlights —
        // underline already computes its own thin bar separately above,
        // and this is purely cosmetic (doesn't touch the stored rect, so
        // it can be tuned again later without migrating saved annotations).
        const inset = a.type === 'highlight' ? ph * 0.16 : 0;
        d.style.top = `${py + inset / 2}px`;
        d.style.width = `${pw}px`;
        d.style.height = `${ph - inset}px`;
        d.style.background = a.color || (a.type === 'note' ? 'rgba(255,193,7,0.35)' : 'rgba(255,235,59,0.55)');
      }
      if (a.note) d.setAttribute('title', a.note);

      // Notes get a small visible marker on their first rect — a faint tinted
      // box alone (or a hover-only title tooltip) is too easy to miss/ignore.
      if (a.type === 'note' && ri === 0) {
        d.classList.add('pdf-annot-note');
        const marker = document.createElement('span');
        marker.className = 'pdf-annot-note-marker';
        marker.textContent = '📝';
        d.appendChild(marker);
      }

      layer.appendChild(d);
    });
  });
}

function loadAnnotations() {
  try {
    const raw = localStorage.getItem(annotationKey);
    annotations = raw ? JSON.parse(raw) : [];
  } catch (_e) {
    annotations = [];
  }
}

function saveAnnotations() {
  try {
    localStorage.setItem(annotationKey, JSON.stringify(annotations));
  } catch (_e) {}
  scheduleSyncAnnotations();
  renderNotesTab();
}

// ── Notes tab: every highlight/underline/sticky-note on this PDF in one
// place — same idea as Zotero's annotation sidebar, and a real gap before
// this: annotations only ever lived scattered across the page itself, with
// no way to see or jump between them all at once.
const ANNOT_TYPE_LABEL = { highlight: 'Highlight', underline: 'Underline', note: 'Note' };
function renderNotesTab() {
  const host = document.getElementById('pdfNotesList');
  if (!host) return;
  if (!annotations.length) {
    host.innerHTML = '<p class="muted" style="font-size:.85rem;">No highlights or notes yet — select text, or use the Note tool, to add some.</p>';
    return;
  }
  const byPage = new Map();
  annotations.forEach(a => {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page).push(a);
  });
  const pages = Array.from(byPage.keys()).sort((x, y) => x - y);

  host.innerHTML = pages.map(p => `
    <div style="margin-bottom:.9rem;">
      <div class="muted" style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:.3rem;cursor:pointer;" data-jump-page="${p}">Page ${p}</div>
      ${byPage.get(p).map(a => `
        <div class="reference-item" data-annot-jump="${escapeHtml(a.id)}" style="padding:.55rem .7rem;margin-bottom:.4rem;display:flex;gap:.4rem;align-items:flex-start;">
          <span style="flex-shrink:0;width:10px;height:10px;border-radius:50%;margin-top:.25rem;background:${a.type === 'note' ? '#f59e0b' : (a.color || '#fde68a')};"></span>
          <div style="flex:1;min-width:0;">
            <div class="muted" style="font-size:.68rem;">${ANNOT_TYPE_LABEL[a.type] || a.type}</div>
            ${a.quote ? `<div style="font-size:.82rem;font-style:italic;color:#334155;">"${escapeHtml(a.quote.slice(0, 160))}${a.quote.length > 160 ? '…' : ''}"</div>` : ''}
            ${a.note ? `<div style="font-size:.82rem;color:#1e293b;margin-top:${a.quote ? '.25rem' : '0'};">${escapeHtml(a.note)}</div>` : ''}
          </div>
          <button data-annot-delete="${escapeHtml(a.id)}" title="Delete" style="flex-shrink:0;border:none;background:none;color:#94a3b8;cursor:pointer;font-size:.85rem;">×</button>
        </div>
      `).join('')}
    </div>
  `).join('');

  host.querySelectorAll('[data-jump-page]').forEach(el => {
    el.addEventListener('click', () => { const p = Number(el.getAttribute('data-jump-page')); goToPage(p); flashPageWrap(p); });
  });
  host.querySelectorAll('[data-annot-jump]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-annot-delete]')) return;
      const id = el.getAttribute('data-annot-jump');
      const a = annotations.find(x => x.id === id);
      if (a) jumpToAnnotation(a);
    });
  });
  host.querySelectorAll('[data-annot-delete]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-annot-delete');
      const a = annotations.find(x => x.id === id);
      removeAnnotation(id);
      if (a) renderAnnotationsForPage(a.page);
      renderNotesTab();
    });
  });
}

function flashPageWrap(page) {
  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${page}"]`);
  if (!wrap) return;
  wrap.classList.add('pdf-jump-flash');
  setTimeout(() => wrap.classList.remove('pdf-jump-flash'), 1400);
}

function jumpToAnnotation(a) {
  goToPage(a.page);
  setTimeout(() => {
    const els = document.querySelectorAll(`.pdf-annot[data-annot-id="${a.id}"], .pdf-annot-note-pin[data-annot-id="${a.id}"]`);
    if (els.length) {
      els.forEach(el => {
        el.classList.add('pdf-annot-jump-flash');
        setTimeout(() => el.classList.remove('pdf-annot-jump-flash'), 1600);
      });
    } else {
      flashPageWrap(a.page);
    }
  }, 350); // after the smooth scroll settles
}

// Downloads every highlight/note on this PDF as a Markdown file, grouped by
// page — a real "your annotations, out of the app" export, the same idea
// as library-page.js's existing per-item annotation export.
function exportAnnotationsMarkdown() {
  if (!annotations.length) return;
  const byPage = new Map();
  annotations.forEach(a => {
    if (!byPage.has(a.page)) byPage.set(a.page, []);
    byPage.get(a.page).push(a);
  });
  const pages = Array.from(byPage.keys()).sort((x, y) => x - y);
  const title = (document.title || 'PDF').replace(/\s*\|\s*ScienceEcosystem\s*$/i, '');
  let md = `# Annotations — ${title}\n\n`;
  pages.forEach(p => {
    md += `## Page ${p}\n\n`;
    byPage.get(p).forEach(a => {
      md += `- **${ANNOT_TYPE_LABEL[a.type] || a.type}**`;
      if (a.quote) md += `: "${a.quote}"`;
      md += '\n';
      if (a.note) md += `  > ${a.note}\n`;
    });
    md += '\n';
  });
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title.replace(/[\/\\?%*:|"<>]/g, '-').trim() + '-annotations.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function findScienceEcosystemLink(ref) {
  const cache = (refMatchCache ||= loadRefMatchCache());
  const cacheKey = (ref.doi || ref.title || '').toLowerCase();
  if (cacheKey && cache[cacheKey]) return cache[cacheKey];

  let result = null;

  if (ref.doi) {
    result = await openAlexByDoi(ref.doi);
  }

  if (!result) {
    result = await openAlexByTitle(ref);
  }

  if (cacheKey && result) {
    cache[cacheKey] = result;
    saveRefMatchCache(cache);
  }
  return result;
}

async function openAlexByDoi(doi) {
  try {
    const searchResponse = await fetch(
      `${location.origin}/api/openalex/works?filter=doi:${encodeURIComponent(doi)}&mailto=scienceecosystem@icloud.com`
    );
    const searchData = await searchResponse.json();
    if (searchData.results && searchData.results.length > 0) {
      const openAlexId = searchData.results[0].id.replace('https://openalex.org/', '');
      return `/paper.html?id=${encodeURIComponent(openAlexId)}`;
    }
  } catch (e) {
    console.error('Failed to find paper by DOI:', e);
  }
  return null;
}

async function openAlexByTitle(ref) {
  const title = String(ref.title || '').trim();
  if (!title) return null;
  const firstAuthor = (ref.authors && ref.authors.length) ? ref.authors[0] : '';
  const q = firstAuthor ? `${title} ${firstAuthor}` : title;
  try {
    const searchResponse = await fetch(
      `${location.origin}/api/openalex/works?search=${encodeURIComponent(q)}&per-page=5&mailto=scienceecosystem@icloud.com`
    );
    const searchData = await searchResponse.json();
    if (searchData.results && searchData.results.length > 0) {
      const best = searchData.results[0];
      const openAlexId = best.id.replace('https://openalex.org/', '');
      return `/paper.html?id=${encodeURIComponent(openAlexId)}`;
    }
  } catch (e) {
    console.error('Failed to find paper by title:', e);
  }
  return null;
}

function loadRefMatchCache() {
  try {
    const raw = sessionStorage.getItem('se_ref_match_cache');
    return raw ? JSON.parse(raw) : {};
  } catch (_e) {
    return {};
  }
}

function saveRefMatchCache(cache) {
  try {
    sessionStorage.setItem('se_ref_match_cache', JSON.stringify(cache));
  } catch (_e) {}
}
