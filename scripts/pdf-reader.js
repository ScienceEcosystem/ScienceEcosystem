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

  pdfMain.innerHTML = `
    <div style="text-align: center; padding: 2rem; overflow: auto; height: 100%;">
      <div>
        <button id="prevPage" class="btn btn-small">Previous</button>
        <span style="margin: 0 1rem;">
          Page: <span id="pageNum"></span> / <span id="pageCount"></span>
        </span>
        <button id="nextPage" class="btn btn-small">Next</button>
        <button id="zoomIn" class="btn btn-small">Zoom In</button>
        <button id="zoomOut" class="btn btn-small">Zoom Out</button>
      </div>
      <canvas id="pdfCanvas" style="margin-top: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.3);"></canvas>
    </div>
  `;

  canvas = document.getElementById('pdfCanvas');
  ctx = canvas.getContext('2d');

  document.getElementById('prevPage').addEventListener('click', onPrevPage);
  document.getElementById('nextPage').addEventListener('click', onNextPage);
  document.getElementById('zoomIn').addEventListener('click', () => {
    scale += 0.25;
    renderPage(pageNum);
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    if (scale > 0.5) {
      scale -= 0.25;
      renderPage(pageNum);
    }
  });
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

    renderPage(pageNum);
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
  pageRendering = true;

  pdfDoc.getPage(num).then(page => {
    const viewport = page.getViewport({ scale: scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    const renderTask = page.render(renderContext);

    renderTask.promise.then(() => {
      pageRendering = false;
      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }
    });
  });

  const numEl = document.getElementById('pageNum');
  if (numEl) numEl.textContent = String(num);
}

function queueRenderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
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

function showReferencesPlaceholder() {
  const refsDiv = document.getElementById('pdfReferences');
  if (!refsDiv) return;
  refsDiv.innerHTML = '<p class="muted" style="font-size:0.9rem;">Reference extraction will be available after GROBID integration.</p>';
}

window.addEventListener('DOMContentLoaded', () => {
  if (!pdfUrl) {
    alert('No PDF URL provided. Please access this page from a paper link.');
    window.location.href = '/';
    return;
  }

  loadPDF(pdfUrl);

  if (paperId) {
    loadPaperMetadata(paperId);
  }

  showReferencesPlaceholder();
});
