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
let currentTextLayer = null;
let refMatchCache = null;
let annotMode = 'highlight';
let annotations = [];
let annotationKey = '';
let pdfLinkIndex = [];
let pageTextIndex = new Map();
let _paperDoiHref = null; // set by loadPaperMetadata; used by the PDF error state

function renderDoiLink(el, doiHref, oaUrl) {
  let html = `<a href="${escapeHtml(doiHref)}" target="_blank" rel="noopener"
    style="display:inline-flex;align-items:center;gap:.5rem;background:#2e7f9f;color:#fff;padding:.65rem 1.25rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:.95rem;">
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

function setupCanvas() {
  const pdfMain = document.querySelector('.pdf-main');
  if (!pdfMain) return;

  const body = pdfMain.querySelector('.pdf-main-body') || pdfMain;
  body.innerHTML = `
    <div class="pdf-scroll" style="text-align: center; padding: 2rem; overflow: auto; height: 100%;">
      <div>
        <button id="prevPage" class="btn btn-small">Previous</button>
        <span style="margin: 0 1rem;">
          Page: <span id="pageNum"></span> / <span id="pageCount"></span>
        </span>
        <button id="nextPage" class="btn btn-small">Next</button>
        <button id="zoomIn" class="btn btn-small">Zoom In</button>
        <button id="zoomOut" class="btn btn-small">Zoom Out</button>
      </div>
      <div id="pdfPages" class="pdf-pages" style="margin-top: 1rem;"></div>
    </div>
  `;

  document.getElementById('prevPage').addEventListener('click', onPrevPage);
  document.getElementById('nextPage').addEventListener('click', onNextPage);
  document.getElementById('zoomIn').addEventListener('click', () => {
    scale += 0.25;
    renderAllPages();
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    if (scale > 0.5) {
      scale -= 0.25;
      renderAllPages();
    }
  });

  bindAnnotationToolbar();
}

async function loadPDF(url) {
  setupCanvas();

  const isExternal = !url.startsWith('/') && !url.startsWith(window.location.origin);
  const finalUrl = isExternal ? `/api/pdf/proxy?url=${encodeURIComponent(url)}` : url;

  if (!pdfjsLib) {
    pdfjsLib = await import('/pdfjs/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/build/pdf.worker.mjs';
  }

  try {
    const loadingTask = pdfjsLib.getDocument(finalUrl);
    pdfDoc = await loadingTask.promise;

    const countEl = document.getElementById('pageCount');
    if (countEl) countEl.textContent = String(pdfDoc.numPages);

    renderAllPages();
  } catch (error) {
    console.error('Error loading PDF:', error);
    const pdfMain = document.querySelector('.pdf-main-body') || document.querySelector('.pdf-main');
    if (!pdfMain) return;

    // Build the initial link content — use cached DOI if already loaded, placeholder if not yet
    const initialLinks = _paperDoiHref
      ? '' // renderDoiLink will be called after innerHTML is set
      : '<span style="color:#999;font-size:.9rem;">Looking up publisher link…</span>';

    pdfMain.innerHTML = `
      <div id="pdfErrorState" style="text-align:center;padding:3rem 2rem;color:#444;max-width:520px;margin:0 auto;">
        <div style="font-size:2.5rem;margin-bottom:.75rem;">📄</div>
        <h3 style="color:#c0392b;margin:0 0 .5rem;">PDF unavailable</h3>
        <p style="margin:.5rem 0 1.75rem;color:#666;line-height:1.5;">
          The publisher is blocking direct PDF access.
          Visit the publisher's page to read or download the paper.
        </p>
        <div id="pdfErrorLinks" style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap;margin-bottom:1.5rem;">
          ${initialLinks}
        </div>
        <p style="font-size:.83rem;color:#94a3b8;">
          💡 Install the <strong>ScienceEcosystem browser extension</strong> to save PDFs directly from the publisher's site into your library.
        </p>
      </div>`;

    const linksEl = document.getElementById('pdfErrorLinks');
    if (linksEl && _paperDoiHref) {
      // DOI already known — render immediately
      renderDoiLink(linksEl, _paperDoiHref, null);
    }
    // If DOI not yet known, loadPaperMetadata will call renderDoiLink when it finishes
  }
}

function renderPage(num) {
  pageNum = num;
  const numEl = document.getElementById('pageNum');
  if (numEl) numEl.textContent = String(num);
}

async function renderTextLayer(page, viewport, layerEl, tooltipEl) {
  if (!layerEl || !pdfjsLib) return;
  layerEl.innerHTML = '';
  layerEl.style.width = viewport.width + 'px';
  layerEl.style.height = viewport.height + 'px';

  const textContent = await page.getTextContent();
  if (typeof pdfjsLib.TextLayer !== 'function') return;
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: layerEl,
    viewport: viewport,
    textDivs: []
  });
  await textLayer.render();
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

async function renderLinkLayer(page, viewport, layerEl, pageNumber) {
  if (!layerEl || !pdfjsLib) return;
  layerEl.innerHTML = '';
  layerEl.style.width = viewport.width + 'px';
  layerEl.style.height = viewport.height + 'px';

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
    try {
      const hits = (pageTextIndex.get(pageNumber) || []).filter(s => {
        return !(s.rect.right < left || s.rect.left > left + width || s.rect.bottom < top || s.rect.top > top + height);
      });
      const text = hits.map(h => h.text).join(' ');
      inferredLabel = labelFromTextHits(text);
    } catch (_) {}
    if (url) {
      linkEl.href = url;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener';
      linkEl.title = url;
      pdfLinkIndex.push({ page: pageNumber, label: inferredLabel || url, url });
    } else if (dest) {
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
    } else {
      continue;
    }
    layerEl.appendChild(linkEl);
  }
}

function applyCitationHighlightsToLayer(layerEl) {
  if (!layerEl || !extractedReferences.length) return;
  const refSet = new Set(extractedReferences.map(r => String(r.number)));
  const spans = layerEl.querySelectorAll('span');
  spans.forEach(span => {
    const text = span.textContent || '';
    if (!text || (!text.includes('[') && !text.includes('('))) return;
    const nums = text.match(/\d{1,3}/g);
    if (!nums) return;
    const hit = nums.find(n => refSet.has(String(n)));
    if (!hit) return;
    span.classList.add('citation-highlight');
    span.setAttribute('data-ref-number', String(hit));
  });
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
  return extractedReferences.find(r => String(r.number) === String(n));
}

function wireCitationHover(layerEl, tooltipEl) {
  if (!layerEl || !tooltipEl) return;
  layerEl.onmousemove = function (e) {
    const target = e.target.closest('.citation-highlight');
    if (!target) {
      tooltipEl.style.display = 'none';
      return;
    }
    const refNum = target.getAttribute('data-ref-number');
    const ref = getRefByNumber(refNum);
    if (!ref) return;
    tooltipEl.innerHTML = `
      <div style="font-weight:600; margin-bottom:0.25rem;">[${escapeHtml(ref.number)}] ${escapeHtml(ref.title || 'Untitled')}</div>
      ${ref.authors && ref.authors.length ? `<div style="font-size:0.85rem; color:#555;">${escapeHtml(ref.authors.slice(0, 5).join(', '))}</div>` : ''}
      ${ref.year ? `<div style="font-size:0.85rem; color:#555;">${escapeHtml(ref.year)}</div>` : ''}
    `;
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = (e.offsetX + 12) + 'px';
    tooltipEl.style.top = (e.offsetY + 12) + 'px';
  };

  layerEl.onmouseleave = function () {
    tooltipEl.style.display = 'none';
  };
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

async function renderAllPages() {
  if (!pdfDoc) return;
  pageRendering = true;
  const pagesHost = document.getElementById('pdfPages');
  if (!pagesHost) return;
  pagesHost.innerHTML = '';
  pdfLinkIndex = [];
  pageTextIndex = new Map();

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: scale });
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-wrap';
    wrap.setAttribute('data-page', String(i));
    wrap.style.marginBottom = '24px';
    wrap.innerHTML = `
      <canvas class="pdf-page-canvas" style="box-shadow: 0 4px 20px rgba(0,0,0,0.3);"></canvas>
      <div class="pdf-text-layer"></div>
      <div class="pdf-link-layer"></div>
      <div class="pdf-annotation-layer"></div>
      <div class="citation-tooltip" style="display:none;"></div>
    `;
    pagesHost.appendChild(wrap);

    const pageCanvas = wrap.querySelector('canvas');
    const pageCtx = pageCanvas.getContext('2d');
    pageCanvas.height = viewport.height;
    pageCanvas.width = viewport.width;

    const renderContext = { canvasContext: pageCtx, viewport: viewport };
    const renderTask = page.render(renderContext);
    await renderTask.promise;

    const layerEl = wrap.querySelector('.pdf-text-layer');
    const linkLayerEl = wrap.querySelector('.pdf-link-layer');
    const tooltipEl = wrap.querySelector('.citation-tooltip');
    await renderTextLayer(page, viewport, layerEl, tooltipEl);
    await renderLinkLayer(page, viewport, linkLayerEl, i);
    renderAnnotationsForPage(i);
  }

  renderPage(pageNum);
  renderPdfLinksSidebar();
  pageRendering = false;

  // Post-render features (non-blocking)
  searchAllText = null; // reset search index so it rebuilds on next search
  renderOutline();
  renderThumbnails();
}

function scrollToPage(num) {
  const el = document.querySelector(`.pdf-page-wrap[data-page="${num}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Sync thumbnail active state
  document.querySelectorAll('.pdf-thumb').forEach(t => {
    t.classList.toggle('active', Number(t.getAttribute('data-page')) === num);
  });
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
      btn.style.borderBottomColor = '#2e7f9f';
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
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const vp = page.getViewport({ scale: 0.18 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.className = 'pdf-thumb' + (i === 1 ? ' active' : '');
    canvas.setAttribute('data-page', String(i));
    canvas.title = 'Page ' + i;
    page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    canvas.addEventListener('click', () => { renderPage(i); setTimeout(() => scrollToPage(i), 30); });
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
    const response = await fetch(`https://api.openalex.org/works/${cleanId}?mailto=scienceecosystem@icloud.com`);

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

    return paper;
  } catch (e) {
    console.error('Failed to load metadata:', e);
    metadataDiv.innerHTML = '<p class="muted">Could not load paper information</p>';
  }
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
        applyCitationHighlights();
      } else {
        refsDiv.innerHTML = '<p class="muted">No references found.</p>';
      }
    }, 1500); // wait for text layers to finish rendering
  }
}

function renderFiguresAndTables(data) {
  const figuresDiv = document.getElementById('pdfFigures');
  const tablesDiv = document.getElementById('pdfTables');
  if (!figuresDiv && !tablesDiv) return;

  const figures = Array.isArray(data?.figures) ? data.figures : [];
  const tables = Array.isArray(data?.tables) ? data.tables : [];

  if (figuresDiv) {
    if (!figures.length) {
      figuresDiv.innerHTML = '<p class="muted">No figures found.</p>';
    } else {
      figuresDiv.innerHTML = figures.map(f => `
        <div class="reference-item">
          <span class="reference-number">Fig ${escapeHtml(f.number)}</span>
          <div>
            <strong>${escapeHtml(f.caption || 'No caption')}</strong>
          </div>
        </div>
      `).join('');
    }
  }

  if (tablesDiv) {
    if (!tables.length) {
      tablesDiv.innerHTML = '<p class="muted">No tables found.</p>';
    } else {
      tablesDiv.innerHTML = tables.map(t => `
        <div class="reference-item">
          <span class="reference-number">Table ${escapeHtml(t.number)}</span>
          <div>
            <strong>${escapeHtml(t.caption || 'No caption')}</strong>
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

  const max = 80;
  const items = pdfLinkIndex.slice(0, max).map((item, idx) => {
    const label = item.url ? item.label : `Internal link (p.${item.page})`;
    const safe = escapeHtml(label);
    if (item.url) {
      return `
        <div class="reference-item">
          <span class="reference-number">Link</span>
          <div>
            <strong>${safe}</strong>
            <div style="display:flex; gap:0.5rem; margin-top:0.25rem; flex-wrap:wrap;">
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="badge badge-ok">Open</a>
              <span class="badge">p.${item.page}</span>
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="reference-item" data-link-index="${idx}" onclick="jumpToInternalLink(${idx})">
        <span class="reference-number">Link</span>
        <div>
          <strong>${safe}</strong>
          <div style="display:flex; gap:0.5rem; margin-top:0.25rem; flex-wrap:wrap;">
            <button class="badge badge-warn" onclick="event.stopPropagation(); jumpToInternalLink(${idx});">Jump</button>
            <span class="badge">p.${item.page}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  linksDiv.innerHTML = items;
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

async function handleReferenceClick(refNumber) {
  const ref = extractedReferences.find(r => r.number === refNumber);
  if (!ref) return;

  let seUrl = null;
  try {
    seUrl = await findScienceEcosystemLink(ref);
  } catch (e) {
    console.error('Failed to resolve ScienceEcosystem link:', e);
  }

  showReferencePopup(ref, seUrl);
}

function showReferencePopup(ref, seUrl) {
  const existing = document.getElementById('refPopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'refPopup';
  popup.style.cssText = [
    'position: fixed',
    'top: 50%',
    'left: 50%',
    'transform: translate(-50%, -50%)',
    'background: white',
    'padding: 2rem',
    'border-radius: 10px',
    'box-shadow: 0 4px 20px rgba(0,0,0,0.3)',
    'max-width: 500px',
    'z-index: 10000'
  ].join(';');

  popup.innerHTML = `
    <h3 style="margin-top:0;">[${ref.number}] ${escapeHtml(ref.title || 'Untitled')}</h3>
    <p class="muted">${escapeHtml((ref.authors || []).join(', '))}</p>
    ${ref.year ? `<p class="muted">${escapeHtml(ref.year)}</p>` : ''}

    <div style="display:flex; gap:1rem; margin-top:1.5rem; flex-wrap:wrap;">
      ${seUrl ? `<a href="${seUrl}" target="_blank" class="btn">View in ScienceEcosystem</a>` : ''}
      ${ref.doi ? `<a href="https://doi.org/${encodeURIComponent(ref.doi)}" target="_blank" class="btn">View on Publisher</a>` : ''}
    </div>

    <button onclick="closeReferencePopup()" style="margin-top:1rem;" class="btn btn-small">Close</button>
  `;

  const backdrop = document.createElement('div');
  backdrop.id = 'refBackdrop';
  backdrop.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'right: 0',
    'bottom: 0',
    'background: rgba(0,0,0,0.5)',
    'z-index: 9999'
  ].join(';');
  backdrop.onclick = closeReferencePopup;

  document.body.appendChild(backdrop);
  document.body.appendChild(popup);
}

function closeReferencePopup() {
  const popup = document.getElementById('refPopup');
  const backdrop = document.getElementById('refBackdrop');
  if (popup) popup.remove();
  if (backdrop) backdrop.remove();
}

window.handleReferenceClick = handleReferenceClick;
window.closeReferencePopup = closeReferencePopup;
window.jumpToInternalLink = jumpToInternalLink;

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

  loadPDF(pdfUrl);
  extractPDFReferences(pdfUrl);

  if (paperId) loadPaperMetadata(paperId);
});

function bindAnnotationToolbar() {
  const h = document.getElementById('annotHighlightBtn');
  const n = document.getElementById('annotNoteBtn');
  const e = document.getElementById('annotEraseBtn');
  const c = document.getElementById('annotClearBtn');
  const setMode = (m) => { annotMode = m; updateAnnotButtons(); };
  h?.addEventListener('click', () => setMode('highlight'));
  n?.addEventListener('click', () => setMode('note'));
  e?.addEventListener('click', () => setMode('erase'));
  c?.addEventListener('click', () => { if (confirm('Clear all annotations?')) { annotations = []; saveAnnotations(); renderAnnotationsAll(); } });
  updateAnnotButtons();
}

function updateAnnotButtons() {
  const map = {
    highlight: 'annotHighlightBtn',
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

  tb.appendChild(btn('🖊 Highlight', () => {
    createAnnotation(page, normRects, quote, 'highlight', '');
  }));

  tb.appendChild(btn('📝 Note', () => {
    // Use a small inline prompt inside the toolbar area
    const note = window.prompt('Add a note:', '') || '';
    createAnnotation(page, normRects, quote, 'note', note);
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

function createAnnotation(page, normRects, quote, type, note) {
  annotations.push({
    id: String(Date.now()) + '_' + Math.random().toString(16).slice(2),
    page, type, rects: normRects, quote, note
  });
  saveAnnotations();
  renderAnnotationsForPage(page);
}

function wireAnnotationSelection(layerEl) {
  layerEl.addEventListener('mouseup', (ev) => {
    if (annotMode === 'erase') return;
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
    const normRects = rects.map(r => ({
      x: r.left - wrapRect.left,
      y: r.top - wrapRect.top,
      w: r.width,
      h: r.height
    }));

    const quote = sel.toString().trim();
    if (!quote) return;

    // Show toolbar at mouse position — selection stays intact so Ctrl+C still works
    showSelToolbar(ev.clientX, ev.clientY, quote, page, normRects);
  });

  // Erase mode: click annotation to remove it
  layerEl.addEventListener('click', (ev) => {
    if (annotMode !== 'erase') return;
    const target = ev.target.closest('.pdf-annot');
    if (!target) return;
    const id = target.getAttribute('data-annot-id');
    if (!id) return;
    annotations = annotations.filter(a => a.id !== id);
    saveAnnotations();
    renderAnnotationsAll();
  });
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
  const pageAnnots = annotations.filter(a => a.page === page);
  pageAnnots.forEach(a => {
    a.rects.forEach(r => {
      const d = document.createElement('div');
      d.className = 'pdf-annot';
      d.setAttribute('data-annot-id', a.id);
      d.style.left = `${r.x}px`;
      d.style.top = `${r.y}px`;
      d.style.width = `${r.w}px`;
      d.style.height = `${r.h}px`;
      d.style.background = a.type === 'note' ? 'rgba(46,127,159,0.25)' : 'rgba(255,235,59,0.55)';
      if (a.note) d.setAttribute('title', a.note);
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
      `https://api.openalex.org/works?filter=doi:${encodeURIComponent(doi)}&mailto=scienceecosystem@icloud.com`
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
      `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=5&mailto=scienceecosystem@icloud.com`
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
