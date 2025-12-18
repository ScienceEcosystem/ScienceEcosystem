/* Research Tools recommender + overview */
const toolCatalog = [
  {
    id: 'zotero',
    name: 'Zotero',
    category: 'Reference management',
    summary: 'Collect papers, annotate PDFs, and cite while you write in Word or Google Docs.',
    tags: ['citation', 'cite', 'references', 'bibliography', 'papers', 'literature', 'pdf'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: true,
    bestFor: 'Building and sharing literature libraries with instant citations.',
    alternatives: 'Paperpile, Mendeley',
    link: 'https://www.zotero.org/',
    strengths: ['Browser save button', 'Group libraries', 'Word/Docs plug-ins'],
    baseScore: 3
  },
  {
    id: 'overleaf',
    name: 'Overleaf',
    category: 'Writing & collaboration',
    summary: 'Collaborative LaTeX editor with versioning, comments, and templates.',
    tags: ['latex', 'manuscript', 'writing', 'paper', 'collaborate', 'draft'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Drafting papers and preprints with co-authors.',
    alternatives: 'Manubot, Authorea',
    link: 'https://www.overleaf.com/',
    strengths: ['Track changes', 'Journal templates', 'Share links'],
    baseScore: 2
  },
  {
    id: 'quarto',
    name: 'Quarto',
    category: 'Reproducible documents',
    summary: 'Author reports, articles, and books that mix prose, code, and outputs.',
    tags: ['reproducible', 'report', 'notebook', 'analysis', 'r', 'python', 'docs', 'book'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Readable, shareable reports where code and results stay in sync.',
    alternatives: 'R Markdown, Jupyter Book',
    link: 'https://quarto.org/',
    strengths: ['Multi-language', 'Citations built-in', 'Publish to web or PDF'],
    baseScore: 2
  },
  {
    id: 'colab',
    name: 'Google Colab',
    category: 'Notebooks & analysis',
    summary: 'Hosted Jupyter notebooks with GPUs, easy sharing, and no install.',
    tags: ['python', 'notebook', 'analysis', 'ml', 'machine learning', 'gpu', 'data exploration'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Quick Python analysis, teaching, and sharing runnable notebooks.',
    alternatives: 'Binder, Kaggle Notebooks',
    link: 'https://colab.research.google.com/',
    strengths: ['No setup', 'GPU runtime', 'Notebook sharing'],
    baseScore: 2
  },
  {
    id: 'rstudio',
    name: 'Posit Cloud (RStudio)',
    category: 'Notebooks & analysis',
    summary: 'Cloud RStudio with tidyverse pre-installed for data analysis.',
    tags: ['r', 'tidyverse', 'analysis', 'statistics', 'teaching', 'notebook'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'R-based analysis without local installs; good for teaching or teams.',
    alternatives: 'RStudio Desktop, Saturn Cloud',
    link: 'https://posit.cloud/',
    strengths: ['Zero install', 'Projects with collaborators', 'Great for teaching'],
    baseScore: 1
  },
  {
    id: 'openrefine',
    name: 'OpenRefine',
    category: 'Data cleaning',
    summary: 'Powerful GUI to clean messy tabular data, cluster duplicates, and reshape tables.',
    tags: ['clean', 'data quality', 'deduplicate', 'csv', 'spreadsheet', 'transform'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Cleaning messy CSV/TSV data without writing code.',
    alternatives: 'Trifacta Wrangler, pandas',
    link: 'https://openrefine.org/',
    strengths: ['Clustering', 'Undo/redo steps', 'Preview changes safely'],
    baseScore: 2
  },
  {
    id: 'osf',
    name: 'Open Science Framework (OSF)',
    category: 'Project management',
    summary: 'Organise projects, preregistrations, storage, and collaboration in one place.',
    tags: ['project', 'preregistration', 'share', 'storage', 'collaboration', 'workflow'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: true,
    bestFor: 'Coordinating studies, preregistering, and sharing materials openly.',
    alternatives: 'Notion, Asana',
    link: 'https://osf.io/',
    strengths: ['Component structure', 'Embeds GitHub/Drive', 'Permission controls'],
    baseScore: 3
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Version control',
    summary: 'Git hosting with issues, pull requests, CI, and pages for docs.',
    tags: ['git', 'version control', 'code', 'collaboration', 'issues', 'pull request', 'ci'],
    cost: 'Freemium',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Team coding, versioned analysis pipelines, and reproducible releases.',
    alternatives: 'GitLab, Bitbucket',
    link: 'https://github.com/',
    strengths: ['Pull requests', 'Actions CI', 'Releases + tags'],
    baseScore: 2
  },
  {
    id: 'zenodo',
    name: 'Zenodo',
    category: 'Publishing & archiving',
    summary: 'Archive datasets, code, and papers with DOIs for free.',
    tags: ['doi', 'archive', 'publish', 'dataset', 'code', 'share'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Minting DOIs for datasets, software, and preprints.',
    alternatives: 'Figshare, institutional repos',
    link: 'https://zenodo.org/',
    strengths: ['Free DOIs', 'Versioned uploads', 'Supports large files'],
    baseScore: 3
  },
  {
    id: 'figshare',
    name: 'Figshare',
    category: 'Publishing & archiving',
    summary: 'Share datasets, posters, and figures with DOIs and rich previews.',
    tags: ['share', 'dataset', 'figure', 'poster', 'doi', 'publish'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Publishing supplementary materials with DOIs and altmetrics.',
    alternatives: 'Zenodo, Dryad',
    link: 'https://figshare.com/',
    strengths: ['Previews', 'Usage metrics', 'Institutional storage options'],
    baseScore: 1
  },
  {
    id: 'dryad',
    name: 'Dryad',
    category: 'Publishing & archiving',
    summary: 'Curated repository for datasets linked to publications.',
    tags: ['dataset', 'publish', 'doi', 'curated', 'share'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Publishing datasets that need curation and DOIs.',
    alternatives: 'Zenodo, Figshare',
    link: 'https://datadryad.org/',
    strengths: ['Curation support', 'Publisher integrations', 'Metadata quality'],
    baseScore: 1
  },
  {
    id: 'binder',
    name: 'Binder',
    category: 'Reproducible environments',
    summary: 'Turn a Git repo into a runnable Jupyter environment in the cloud.',
    tags: ['reproducible', 'environment', 'notebook', 'python', 'r', 'launch'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'Sharing notebooks that others can run without installs.',
    alternatives: 'Colab, Codespaces',
    link: 'https://mybinder.org/',
    strengths: ['Live notebooks from Git', 'No sign-in required', 'Great for workshops'],
    baseScore: 2
  }
];

const finderState = {
  defaultCount: 4
};

const keywordMatchers = [
  { pattern: /write|manuscript|paper|latex|draft|author/, topic: 'writing' },
  { pattern: /cite|citation|reference|bibliograph/, topic: 'citation' },
  { pattern: /clean|messy|deduplicat|normalize|tidy/, topic: 'cleaning' },
  { pattern: /analysis|stat|model|regression|visuali|python|r\b|notebook|code/, topic: 'analysis' },
  { pattern: /collaborat|team|coauthor|share/, topic: 'collaboration' },
  { pattern: /publish|archive|doi|deposit|repository|data set|dataset/, topic: 'publishing' },
  { pattern: /reproducib|workflow|environment|binder|container/, topic: 'reproducibility' },
  { pattern: /free|budget|open source|no cost/, topic: 'budget' },
  { pattern: /easy|quick|beginner|simple/, topic: 'ease' },
];

function scoreTool(tool, text) {
  const lower = text.toLowerCase();
  let score = tool.baseScore || 0;
  const reasons = [];

  if (!text.trim()) {
    return { score, reasons };
  }

  tool.tags.forEach(tag => {
    if (lower.includes(tag)) {
      score += 3;
      reasons.push(`Mentions ${tag}`);
    }
  });

  keywordMatchers.forEach(({ pattern, topic }) => {
    if (pattern.test(lower)) {
      switch (topic) {
        case 'writing':
          if (tool.category.includes('Writing') || tool.tags.includes('draft')) {
            score += 3;
            reasons.push('Built for writing');
          }
          break;
        case 'citation':
          if (tool.category.includes('Reference') || tool.tags.includes('citation')) {
            score += 3;
            reasons.push('Handles citations');
          }
          break;
        case 'cleaning':
          if (tool.category.includes('Data cleaning')) {
            score += 3;
            reasons.push('Data cleaning workflows');
          }
          break;
        case 'analysis':
          if (tool.category.includes('analysis') || tool.tags.includes('analysis') || tool.tags.includes('notebook')) {
            score += 2;
            reasons.push('Good for analysis/notebooks');
          }
          break;
        case 'collaboration':
          if (tool.collaboration) {
            score += 2;
            reasons.push('Collaboration built-in');
          }
          break;
        case 'publishing':
          if (tool.category.includes('Publishing') || tool.tags.includes('doi')) {
            score += 3;
            reasons.push('Publishes with DOIs');
          }
          break;
        case 'reproducibility':
          if (tool.category.includes('Reproducible') || tool.tags.includes('reproducible') || tool.tags.includes('environment')) {
            score += 2;
            reasons.push('Keeps environments reproducible');
          }
          break;
        case 'budget':
          if (tool.cost === 'Free') {
            score += 2;
            reasons.push('No-cost option');
          } else if (tool.cost === 'Freemium') {
            score += 1;
            reasons.push('Free tier available');
          }
          if (tool.open) {
            score += 1;
            reasons.push('Open-source');
          }
          break;
        case 'ease':
          if (tool.ease === 'Easy') {
            score += 2;
            reasons.push('Low learning curve');
          }
          break;
      }
    }
  });

  return { score, reasons };
}

function renderRecommendations(problemText) {
  const container = document.getElementById('recommendations');
  if (!container) return;

  const scored = toolCatalog
    .map(tool => {
      const { score, reasons } = scoreTool(tool, problemText);
      return { tool, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const meaningful = problemText.trim()
    ? scored.filter(entry => entry.score > 0)
    : scored;

  const picks = (meaningful.length ? meaningful : scored).slice(0, finderState.defaultCount);

  if (!picks.length) {
    container.innerHTML = '<p class="muted">Add a sentence about your task to see recommendations.</p>';
    return;
  }

  container.innerHTML = '';
  picks.forEach(({ tool, score, reasons }) => {
    const reasonText = reasons.length
      ? `Why: ${Array.from(new Set(reasons)).slice(0, 3).join(', ')}.`
      : 'Why: Solid default for open, reproducible workflows.';

    const card = document.createElement('article');
    card.className = 'rec-card';
    card.innerHTML = `
      <div class="rec-head">
        <div>
          <h3>${tool.name}</h3>
          <p class="muted small">${tool.category}</p>
        </div>
        <div class="pill-row">
          <span class="badge">${tool.cost}</span>
          <span class="badge badge-ease">${tool.ease}</span>
          ${tool.open ? '<span class="badge badge-open">Open-source</span>' : ''}
        </div>
      </div>
      <p class="rec-summary">${tool.summary}</p>
      <p class="rec-why">${reasonText}</p>
      <div class="chip-row">
        ${tool.tags.slice(0, 4).map(tag => `<span class="badge">${tag}</span>`).join('')}
      </div>
      <div class="rec-actions">
        <a class="btn btn-secondary" href="${tool.link}" target="_blank" rel="noopener">Open ${tool.name}</a>
        <span class="alt-note">Best for: ${tool.bestFor}${tool.alternatives ? ` · Alternatives: ${tool.alternatives}` : ''}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderToolGrid(list) {
  const grid = document.getElementById('toolGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!list.length) {
    grid.innerHTML = '<p class="muted">No tools match those filters yet.</p>';
    return;
  }

  list.forEach(tool => {
    const card = document.createElement('article');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-meta">
        <h3>${tool.name}</h3>
        <div class="pill-row">
          <span class="badge">${tool.cost}</span>
          <span class="badge badge-ease">${tool.ease}</span>
          ${tool.open ? '<span class="badge badge-open">Open-source</span>' : ''}
          <span class="badge">${tool.category}</span>
        </div>
      </div>
      <p class="rec-summary">${tool.summary}</p>
      <p class="tool-strengths">Strengths: ${tool.strengths.join(', ')}</p>
      <div class="tool-footer">
        <span class="alt-note">Best for: ${tool.bestFor}</span>
        <a href="${tool.link}" target="_blank" rel="noopener">Visit</a>
      </div>
    `;
    grid.appendChild(card);
  });
}

function applyFilters() {
  const searchTerm = (document.getElementById('toolSearchInput')?.value || '').toLowerCase();
  const category = document.getElementById('categoryFilter')?.value || '';
  const cost = document.getElementById('costFilter')?.value || '';

  const filtered = toolCatalog.filter(tool => {
    const matchesSearch = !searchTerm
      || tool.name.toLowerCase().includes(searchTerm)
      || tool.summary.toLowerCase().includes(searchTerm)
      || tool.bestFor.toLowerCase().includes(searchTerm)
      || tool.tags.some(tag => tag.toLowerCase().includes(searchTerm));

    const matchesCategory = !category || tool.category === category;
    const matchesCost = !cost || tool.cost === cost;

    return matchesSearch && matchesCategory && matchesCost;
  });

  renderToolGrid(filtered);
}

function populateCategories() {
  const select = document.getElementById('categoryFilter');
  if (!select) return;
  const categories = Array.from(new Set(toolCatalog.map(t => t.category))).sort();
  categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const findBtn = document.getElementById('findToolsBtn');
  const problemInput = document.getElementById('problemInput');

  populateCategories();
  renderToolGrid(toolCatalog);
  renderRecommendations(problemInput?.value || '');

  findBtn?.addEventListener('click', () => {
    renderRecommendations(problemInput.value);
  });
  problemInput?.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)) {
      renderRecommendations(problemInput.value);
    }
  });

  document.getElementById('toolSearchInput')?.addEventListener('input', applyFilters);
  document.getElementById('categoryFilter')?.addEventListener('change', applyFilters);
  document.getElementById('costFilter')?.addEventListener('change', applyFilters);
});
