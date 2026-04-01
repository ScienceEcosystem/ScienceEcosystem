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
    const pdfMain = document.querySelector('.pdf-main');
    if (pdfMain) {
      pdfMain.innerHTML = `
        <div style="text-align:center; padding:3rem; color:#666;">
          <h3 style="color:#c0392b;">Unable to Load PDF</h3>
          <p style="margin:1rem 0;">This publisher blocks server-side PDF loading.</p>

          <div style="margin-top:2rem; display:flex; gap:1rem; justify-content:center; flex-wrap:wrap;">
            <a href="${finalUrl}" target="_blank" class="btn" style="display:inline-flex; align-items:center; gap:0.5rem;">
              Open PDF in New Tab
            </a>
            <a href="${finalUrl}" download class="btn btn-secondary" style="display:inline-flex; align-items:center; gap:0.5rem;">
              Download PDF
            </a>
          </div>

          <p style="margin-top:2rem; font-size:0.9rem; color:#999;">
            Error: ${escapeHtml(error.message || 'Publisher blocking detected')}
          </p>
        </div>
      `;
    }
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
  applyCitationHighlightsToLayer(layerEl);
  wireCitationHover(layerEl, tooltipEl);
  wireAnnotationSelection(layerEl);
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
    alert('Citation not visible on this page.');
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
    const tooltipEl = wrap.querySelector('.citation-tooltip');
    await renderTextLayer(page, viewport, layerEl, tooltipEl);
    renderAnnotationsForPage(i);
  }

  renderPage(pageNum);
  pageRendering = false;
}

function scrollToPage(num) {
  const el = document.querySelector(`.pdf-page-wrap[data-page="${num}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    refsDiv.innerHTML = '<p class="muted">Could not extract references</p>';
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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeReferencePopup();
});

window.addEventListener('DOMContentLoaded', () => {
  if (!pdfUrl) {
    alert('No PDF URL provided. Please access this page from a paper link.');
    window.location.href = '/';
    return;
  }

  annotationKey = `se_annotations_${encodeURIComponent(pdfUrl)}`;
  loadAnnotations();

  loadPDF(pdfUrl);
  extractPDFReferences(pdfUrl);

  if (paperId) {
    loadPaperMetadata(paperId);
  }
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

function wireAnnotationSelection(layerEl) {
  layerEl.onmouseup = (ev) => {
    if (annotMode === 'erase') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    if (!layerEl.contains(sel.anchorNode) || !layerEl.contains(sel.focusNode)) return;
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

    let note = '';
    if (annotMode === 'note') {
      note = prompt('Note:', '') || '';
    }

    annotations.push({
      id: String(Date.now()) + '_' + Math.random().toString(16).slice(2),
      page: page,
      type: annotMode,
      rects: normRects,
      quote: quote,
      note: note
    });
    saveAnnotations();
    renderAnnotationsForPage(page);
    sel.removeAllRanges();
  };

  layerEl.onclick = (ev) => {
    if (annotMode !== 'erase') return;
    const target = ev.target.closest('.pdf-annot');
    if (!target) return;
    const id = target.getAttribute('data-annot-id');
    if (!id) return;
    annotations = annotations.filter(a => a.id !== id);
    saveAnnotations();
    renderAnnotationsAll();
  };
}

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
