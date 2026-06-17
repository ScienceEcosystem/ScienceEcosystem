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
let annotMode = 'highlight';
let annotations = [];
let annotationKey = '';
let pdfLinkIndex = [];
let pageTextIndex = new Map();
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
  document.getElementById('zoomIn')?.addEventListener('click', () => {
    scale = Math.min(scale + 0.25, 4);
    updateZoomLabel();
    renderAllPages();
  });
  document.getElementById('zoomOut')?.addEventListener('click', () => {
    scale = Math.max(scale - 0.25, 0.5);
    updateZoomLabel();
    renderAllPages();
  });

  bindAnnotationToolbar();
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
    const res = await fetch(`https://api.openalex.org/works/${cleanId}?mailto=scienceecosystem@icloud.com`);
    if (!res.ok) return (_oaPdfUrlCache = null);
    const work = await res.json();
    return (_oaPdfUrlCache = work.best_oa_location?.pdf_url || work.open_access?.oa_url || null);
  } catch (_e) {
    return (_oaPdfUrlCache = null);
  }
}

// If a stored library PDF can't be loaded, fall back to the paper's
// open-access copy (if OpenAlex/Unpaywall knows about one) so the reader
// shows *something* instead of just an error.
async function tryLoadOaFallback(url) {
  const oaUrl = await getOaPdfUrl();
  if (!oaUrl || oaUrl === url) return false;
  await loadPDF(oaUrl);
  return true;
}

async function loadPDF(url) {
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
        if (await tryLoadOaFallback(url)) return;
        showPdfError(data.error || 'PDF not available.', true);
        return;
      }
      const contentType = check.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await check.json().catch(() => null);
        if (data && data.signedUrl) {
          // R2 signed URL — load directly, no auth needed
          const signedTask = pdfjsLib.getDocument({ url: data.signedUrl });
          pdfDoc = await signedTask.promise;
          const countEl = document.getElementById('pageCount');
          if (countEl) countEl.textContent = String(pdfDoc.numPages);
          renderAllPages();
          return;
        }
        // JSON response but no signedUrl — error
        if (await tryLoadOaFallback(url)) return;
        showPdfError(data?.error || 'PDF not available.', true);
        return;
      }
      // Binary PDF streamed directly — pass the response body to pdf.js
      const pdfBytes = await check.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes });
      pdfDoc = await loadingTask.promise;
      const countEl = document.getElementById('pageCount');
      if (countEl) countEl.textContent = String(pdfDoc.numPages);
      renderAllPages();
      return;
    } catch (err) {
      if (await tryLoadOaFallback(url)) return;
      showPdfError('Could not load PDF: ' + String(err), true);
      return;
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
  } catch (error) {
    console.error('Error loading PDF:', error);
    if (isLibraryPdf && await tryLoadOaFallback(url)) return;
    showPdfError(null, false);
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
  const numEl = document.getElementById('pageNum');
  if (numEl) numEl.textContent = String(num);
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

async function renderLinkLayer(page, viewport, layerEl, pageNumber) {
  if (!layerEl || !pdfjsLib) return;
  layerEl.innerHTML = '';

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

function buildAuthorYearMap() {
  authorYearMap = new Map();
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

// (Smith, 2020) / (Smith et al. 2020) / (Smith & Jones 2019) — author+year in parens
const _ayRe = /^\s*\(\s*([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+)(?:\s+(?:et\s+al\.?|&\s+[A-Z][A-Za-z]+|and\s+[A-Z][A-Za-z]+))?\s*,?\s*(\d{4}[a-z]?)\s*\)\s*$/;
// Smith et al. (2020) — author inline, only year in parens, same span
const _narSameRe = /([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+)(?:\s+(?:et\s+al\.?|&\s+[A-Z][A-Za-z]+|and\s+[A-Z][A-Za-z]+))?\s+\((\d{4}[a-z]?)\)\s*$/;
// (2020) — standalone year span; author is in the previous sibling span
const _yearOnlyRe = /^\s*\((\d{4}[a-z]?)\)\s*$/;
// Author tail at end of previous span: "...Smith et al." / "...Smith and Jones"
const _authorTailRe = /([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'\-]+)(?:\s+(?:et\s+al\.?|&\s+[A-Z][A-Za-z]+|and\s+[A-Z][A-Za-z]+))?\s*$/;

function applyCitationHighlightsToLayer(layerEl) {
  if (!layerEl || !openAlexRefsList.length) return;
  const maxRef = openAlexRefsList.length;
  const hasAuthorYear = authorYearMap.size > 0;
  const spans = layerEl.querySelectorAll('span');
  spans.forEach(span => {
    if (span.hasAttribute('data-ref-number')) return;
    const text = span.textContent || '';
    if (!text) return;

    // --- Numbered bracket: [1], [2,3], [4-6] ---
    if (text.includes('[')) {
      const m = text.match(/^\s*\[(\d[\d,\s\-–]*)\]\s*$/);
      if (m) {
        const firstNum = parseInt(m[1].match(/\d+/)[0], 10);
        if (firstNum >= 1 && firstNum <= maxRef) {
          span.classList.add('citation-highlight');
          span.setAttribute('data-ref-number', String(firstNum));
          return;
        }
      }
    }

    if (hasAuthorYear && text.includes('(')) {
      // --- (Smith et al., 2020) — full citation in parens ---
      let m = _ayRe.exec(text);
      if (m) {
        const lastName = m[1].toLowerCase().replace(/[^a-z]/g, '');
        const year = m[2].slice(0, 4);
        const refNum = authorYearMap.get(`${lastName}_${year}`) ||
                       authorYearMap.get(`${lastName}_${m[2]}`);
        if (refNum) {
          span.classList.add('citation-highlight');
          span.setAttribute('data-ref-number', String(refNum));
          return;
        }
      }

      // --- Smith et al. (2020) — author inline, year in parens, same span ---
      m = _narSameRe.exec(text);
      if (m) {
        const lastName = m[1].toLowerCase().replace(/[^a-z]/g, '');
        const year = m[2].slice(0, 4);
        const refNum = authorYearMap.get(`${lastName}_${year}`) ||
                       authorYearMap.get(`${lastName}_${m[2]}`);
        if (refNum) {
          span.classList.add('citation-highlight');
          span.setAttribute('data-ref-number', String(refNum));
          return;
        }
      }

      // --- (2020) alone — look at previous sibling for author name ---
      m = _yearOnlyRe.exec(text);
      if (m) {
        const prevText = span.previousElementSibling?.textContent || '';
        const am = _authorTailRe.exec(prevText);
        if (am) {
          const lastName = am[1].toLowerCase().replace(/[^a-z]/g, '');
          const year = m[1].slice(0, 4);
          const refNum = authorYearMap.get(`${lastName}_${year}`) ||
                         authorYearMap.get(`${lastName}_${m[1]}`);
          if (refNum) {
            span.classList.add('citation-highlight');
            span.setAttribute('data-ref-number', String(refNum));
          }
        }
      }
    }
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
  const idx = parseInt(n, 10) - 1;
  return (idx >= 0 && idx < openAlexRefsList.length) ? openAlexRefsList[idx] : null;
}

function wireCitationHover(layerEl, tooltipEl) {
  if (!layerEl || !tooltipEl) return;

  let hideTimer = null;
  let shownForNum = null;

  function showTooltip(target) {
    const refNum = target.getAttribute('data-ref-number');
    if (refNum === shownForNum) return;
    const w = getRefByNumber(refNum);
    if (!w) { tooltipEl.style.display = 'none'; shownForNum = null; return; }
    shownForNum = refNum;
    const authors = w.authorships?.slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(', ') || '';
    const hasMore = (w.authorships?.length || 0) > 3;
    const cleanId = w.id?.replace('https://openalex.org/', '') || '';
    const firstAuthorLast = (w.authorships?.[0]?.author?.display_name || '').split(' ').pop();
    const refLabel = firstAuthorLast && w.publication_year
      ? `${firstAuthorLast}, ${w.publication_year}`
      : `[${refNum}]`;
    tooltipEl.innerHTML = `
      <div style="font-weight:600;margin-bottom:.3rem;font-size:.85rem;line-height:1.3;">${escapeHtml(refLabel)} — ${escapeHtml(w.title || 'Untitled')}</div>
      ${authors ? `<div style="font-size:.78rem;color:#475569;margin-bottom:.15rem;">${escapeHtml(authors)}${hasMore ? ' et al.' : ''}</div>` : ''}
      ${w.publication_year ? `<div style="font-size:.75rem;color:#64748b;margin-bottom:.4rem;">${w.publication_year}</div>` : ''}
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;">
        <button onclick="handleReferenceClick(${parseInt(refNum, 10)})" style="font-size:.73rem;padding:.15rem .5rem;background:#0284c7;color:#fff;border:none;border-radius:4px;cursor:pointer;">View in Refs ↗</button>
        ${cleanId ? `<a href="/paper.html?id=${escapeHtml(cleanId)}" target="_blank" style="font-size:.73rem;color:#0284c7;text-decoration:none;">Paper page →</a>` : ''}
      </div>`;
    tooltipEl.style.visibility = 'hidden';
    tooltipEl.style.display = 'block';

    // Position relative to page wrap
    const pageWrap = layerEl.closest('.pdf-page-wrap');
    const wrapRect = pageWrap ? pageWrap.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const spanRect = target.getBoundingClientRect();
    const ttW = tooltipEl.offsetWidth || 280;
    const ttH = tooltipEl.offsetHeight || 120;
    let left = spanRect.left - wrapRect.left + 8;
    let top = spanRect.bottom - wrapRect.top + 6;
    if (left + ttW > wrapRect.right - wrapRect.left - 8) left = spanRect.right - wrapRect.left - ttW - 8;
    if (left < 0) left = 4;
    if (top + ttH > wrapRect.bottom - wrapRect.top - 8) top = spanRect.top - wrapRect.top - ttH - 6;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
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

async function renderAllPages() {
  if (!pdfDoc) return;
  const gen = ++_renderGen; // claim this render slot
  pageRendering = true;

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
    await renderLinkLayer(page, viewport, linkLayerEl, i);
    renderAnnotationsForPage(i);
  }

  if (_renderGen !== gen) return;

  renderPage(pageNum);
  renderPdfLinksSidebar();
  pageRendering = false;
  searchAllText = null;
  renderOutline();
  renderThumbnails();
  startScrollPageTracker();
  extractFiguresTablesFromText();
}

function scrollToPage(num) {
  const el = document.querySelector(`.pdf-page-wrap[data-page="${num}"]`);
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

    // Chain into references and research objects (non-blocking)
    loadReferencesFromOpenAlex(paper);
    loadResearchObjects(paper);

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
      const r = await fetch(`https://api.openalex.org/works?filter=ids.openalex:${batch}&per-page=50&select=id,title,authorships,publication_year,doi,open_access&mailto=scienceecosystem@icloud.com`);
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
  if (!doi) {
    el.innerHTML = '<p class="muted" style="font-size:.8rem;">No DOI — cannot search for research objects.</p>';
    return;
  }
  el.innerHTML = '<p class="muted" style="font-size:.8rem;">Searching Zenodo…</p>';
  try {
    // Use same two-query approach as paper.js fetchZenodoBacklinks
    const doiEsc = doi.replace(/"/g, '\\"');
    let hits = [];
    const q1 = encodeURIComponent(`related.identifiers.identifier:"${doiEsc}"`);
    const r1 = await fetch(`https://zenodo.org/api/records/?q=${q1}&size=20`);
    if (r1.ok) { const d1 = await r1.json(); hits = d1?.hits?.hits || []; }
    if (!hits.length) {
      const q2 = encodeURIComponent(`metadata.related_identifiers.identifier:"${doiEsc}"`);
      const r2 = await fetch(`https://zenodo.org/api/records/?q=${q2}&size=20`);
      if (r2.ok) { const d2 = await r2.json(); hits = d2?.hits?.hits || []; }
    }
    if (!hits.length) {
      el.innerHTML = '<p class="muted" style="font-size:.8rem;">No research objects found on Zenodo.</p>';
      return;
    }
    el.innerHTML = hits.map(h => {
      const md = h.metadata || {};
      const title = md.title || 'Untitled';
      const typeRaw = (md.resource_type?.type || '').toLowerCase();
      const type = typeRaw.includes('software') ? 'Software' : typeRaw.includes('dataset') ? 'Dataset' : (md.resource_type?.type || 'Record');
      const url = (h.links?.html) || `https://zenodo.org/records/${h.id}`;
      const recDoi = md.doi || `10.5281/zenodo.${h.id}`;
      return `<div class="reference-item">
        <div>
          <strong style="font-size:.82rem;"><a href="${url}" target="_blank" onclick="event.stopPropagation()">${escapeHtml(title)}</a></strong>
          <p class="muted small">${escapeHtml(type)}</p>
          <a href="https://doi.org/${escapeHtml(recDoi)}" target="_blank" class="badge badge-ok" style="margin-top:.2rem;font-size:.7rem;">DOI</a>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<p class="muted" style="font-size:.8rem;">Could not load research objects.</p>';
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
        <div class="reference-item" style="cursor:pointer;" onclick="scrollToPage(${Number(f.page)})">
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
        <div class="reference-item" style="cursor:pointer;" onclick="scrollToPage(${Number(t.page)})">
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

  // Scroll to and highlight the ref card
  const refNum = parseInt(refNumber, 10);
  const card = document.getElementById(`oa-ref-${refNum}`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.outline = '2px solid #0284c7';
  card.style.outlineOffset = '2px';
  setTimeout(() => { card.style.outline = ''; card.style.outlineOffset = ''; }, 2000);
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
  const h = document.getElementById('annotHighlightBtn');
  const n = document.getElementById('annotNoteBtn');
  const e = document.getElementById('annotEraseBtn');
  const c = document.getElementById('annotClearBtn');
  const setMode = (m) => { annotMode = m; updateAnnotButtons(); };
  h?.addEventListener('click', () => setMode('highlight'));
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

  // Color swatches for highlighting
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

  tb.appendChild(btn('U Underline', () => {
    createAnnotation(page, normRects, quote, 'underline', '', UNDERLINE_COLOR);
  }));

  tb.appendChild(btn('📝 Note', () => {
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

function createAnnotation(page, normRects, quote, type, note, color) {
  annotations.push({
    id: String(Date.now()) + '_' + Math.random().toString(16).slice(2),
    page, type, rects: normRects, quote, note, color: color || null
  });
  saveAnnotations();
  renderAnnotationsForPage(page);
}

// Merge selection rects that overlap on the same text line into single wider rects
function mergeLineRects(rects) {
  if (!rects.length) return rects;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const r of sorted) {
    const last = lines[lines.length - 1];
    // Same line if vertical overlap is > 50% of the rect height
    if (last && r.y < last.y + last.h * 0.6) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x);
      last.y = Math.min(last.y, r.y);
      last.w = right - last.x;
      last.h = bottom - last.y;
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

  // Erase mode: click annotation to remove it.
  // Must be on the annotation layer (sibling of text layer) — not on layerEl itself.
  const annotLayer = layerEl.closest('.pdf-page-wrap')?.querySelector('.pdf-annotation-layer');
  if (annotLayer) {
    annotLayer.addEventListener('click', (ev) => {
      if (annotMode !== 'erase') return;
      const target = ev.target.closest('.pdf-annot');
      if (!target) return;
      const id = target.getAttribute('data-annot-id');
      if (!id) return;
      annotations = annotations.filter(a => a.id !== id);
      saveAnnotations();
      renderAnnotationsForPage(layerEl.closest('.pdf-page-wrap') ?
        Number(layerEl.closest('.pdf-page-wrap').getAttribute('data-page')) : 0);
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
    a.rects.forEach(r => {
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
        d.style.top = `${py}px`;
        d.style.width = `${pw}px`;
        d.style.height = `${ph}px`;
        d.style.background = a.color || (a.type === 'note' ? 'rgba(46,127,159,0.25)' : 'rgba(255,235,59,0.55)');
      }
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
