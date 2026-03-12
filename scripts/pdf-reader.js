let extractedReferences = [];

const urlParams = new URLSearchParams(window.location.search);
const paperId = urlParams.get('id');
const pdfUrl = urlParams.get('pdf');

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadPDF(url) {
  const viewer = document.getElementById('pdfViewer');
  if (!viewer) return;

  const encodedUrl = encodeURIComponent(url);
  viewer.src = `/pdfjs/web/viewer.html?file=${encodedUrl}`;
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
    metadataDiv.innerHTML = `
      <p class="muted">Could not load paper information</p>
    `;
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

    refsDiv.innerHTML = extractedReferences.map(ref => `
      <div class="reference-item" data-ref-number="${ref.number}" onclick="handleReferenceClick(${ref.number})">
        <span class="reference-number">[${ref.number}]</span>
        <div>
          <strong>${escapeHtml(ref.title || 'Untitled')}</strong>
          ${ref.authors && ref.authors.length > 0 ? `<p class=\"muted small\">${escapeHtml(ref.authors.slice(0, 3).join(', '))}${ref.authors.length > 3 ? ' et al.' : ''}</p>` : ''}
          <div style="display:flex; gap:0.5rem; margin-top:0.25rem; flex-wrap:wrap;">
            ${ref.year ? `<span class=\"badge\">${escapeHtml(ref.year)}</span>` : ''}
            ${ref.doi ? `<a href=\"https://doi.org/${encodeURIComponent(ref.doi)}\" target=\"_blank\" class=\"badge badge-ok\" onclick=\"event.stopPropagation()\">DOI</a>` : ''}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Reference extraction error:', e);
    refsDiv.innerHTML = '<p class="muted">Could not extract references</p>';
  }
}

async function handleReferenceClick(refNumber) {
  const ref = extractedReferences.find(r => r.number === refNumber);
  if (!ref) return;

  let seUrl = null;
  if (ref.doi) {
    try {
      const searchResponse = await fetch(
        `https://api.openalex.org/works?filter=doi:${encodeURIComponent(ref.doi)}&mailto=scienceecosystem@icloud.com`
      );
      const searchData = await searchResponse.json();
      if (searchData.results && searchData.results.length > 0) {
        const openAlexId = searchData.results[0].id.replace('https://openalex.org/', '');
        seUrl = `/paper.html?id=${encodeURIComponent(openAlexId)}`;
      }
    } catch (e) {
      console.error('Failed to find paper:', e);
    }
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
    ${ref.year ? `<p class=\"muted\">${escapeHtml(ref.year)}</p>` : ''}

    <div style="display:flex; gap:1rem; margin-top:1.5rem; flex-wrap:wrap;">
      ${seUrl ? `<a href=\"${seUrl}\" target=\"_blank\" class=\"btn\">View in ScienceEcosystem</a>` : ''}
      ${ref.doi ? `<a href=\"https://doi.org/${encodeURIComponent(ref.doi)}\" target=\"_blank\" class=\"btn\">View on Publisher</a>` : ''}
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

  loadPDF(pdfUrl);
  extractPDFReferences(pdfUrl);

  if (paperId) {
    loadPaperMetadata(paperId);
  }
});
