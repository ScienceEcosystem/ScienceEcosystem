const urlParams = new URLSearchParams(window.location.search);
const paperId = urlParams.get('id');
const pdfUrl = urlParams.get('pdf');

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
      <h4 style="line-height:1.4;">${paper.title || 'Untitled'}</h4>
      <p class="muted" style="font-size:0.9rem; margin:0.5rem 0;">
        ${authors}${hasMore ? ' et al.' : ''}
      </p>
      <p class="muted" style="font-size:0.9rem; margin:0.25rem 0;">
        ${paper.publication_year || 'Year unknown'}
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

function showReferencesPlaceholder() {
  const refsDiv = document.getElementById('pdfReferences');
  if (!refsDiv) return;

  refsDiv.innerHTML = `
    <p class="muted" style="font-size:0.9rem;">
      Reference extraction will be available after GROBID integration.
    </p>
  `;
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
