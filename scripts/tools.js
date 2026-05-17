
// ── Rendering ─────────────────────────────────────────────────────────────────

function escT(str) {
  return String(str || '').replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function renderToolGrid(list) {
  const grid = document.getElementById('toolGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!list || !list.length) {
    grid.innerHTML = '<p class="muted" style="padding:.5rem 0;">No tools match those filters.</p>';
    return;
  }

  // Group by category
  const byCategory = Object.create(null);
  list.forEach(function(tool) {
    const cat = tool.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(tool);
  });

  const categories = Object.keys(byCategory).sort();

  categories.forEach(function(cat) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:2rem;';
    section.innerHTML = '<h3 style="font-size:.95rem;font-weight:700;color:#374151;'
      + 'margin:0 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid #e5e7eb;">'
      + escT(cat) + '</h3>';

    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.75rem;';

    byCategory[cat]
      .slice()
      .sort(function(a, b) { return a.name.localeCompare(b.name); })
      .forEach(function(tool) {
        const card = document.createElement('article');
        card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;'
          + 'padding:1rem;display:flex;flex-direction:column;gap:.5rem;';
        card.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">'
            + '<span style="font-size:.9rem;font-weight:700;color:#0f172a;">' + escT(tool.name) + '</span>'
            + '<span style="font-size:.72rem;background:#f1f5f9;color:#374151;'
              + 'padding:2px 7px;border-radius:10px;flex-shrink:0;">' + escT(tool.cost || '') + '</span>'
          + '</div>'
          + '<p style="font-size:.82rem;color:#475569;margin:0;line-height:1.45;">' + escT(tool.summary || '') + '</p>'
          + (tool.open ? '<span style="font-size:.72rem;background:#dcfce7;color:#166534;'
              + 'padding:2px 7px;border-radius:10px;display:inline-block;">Open-source</span>' : '')
          + (tool.link ? '<div style="margin-top:auto;padding-top:.25rem;">'
              + '<a href="' + escT(tool.link) + '" target="_blank" rel="noopener noreferrer" '
              + 'style="font-size:.8rem;color:#2e7f9f;text-decoration:none;font-weight:600;">'
              + 'Visit ' + escT(tool.name) + ' →</a></div>' : '');
        row.appendChild(card);
      });

    section.appendChild(row);
    grid.appendChild(section);
  });
}

function applyToolFilters() {
  const searchTerm = ((document.getElementById('toolSearch') || {}).value || '').toLowerCase().trim();
  const category   = ((document.getElementById('categoryFilter') || {}).value || '');
  const cost       = ((document.getElementById('costFilter') || {}).value || '');

  const filtered = toolCatalog.filter(function(tool) {
    const matchesSearch = !searchTerm
      || (tool.name || '').toLowerCase().includes(searchTerm)
      || (tool.summary || '').toLowerCase().includes(searchTerm)
      || (tool.category || '').toLowerCase().includes(searchTerm)
      || (tool.bestFor || '').toLowerCase().includes(searchTerm)
      || (tool.tags || []).some(function(tag) { return tag.toLowerCase().includes(searchTerm); });
    const matchesCategory = !category || tool.category === category;
    const matchesCost     = !cost     || tool.cost === cost;
    return matchesSearch && matchesCategory && matchesCost;
  });

  renderToolGrid(filtered);
}

function populateToolCategories() {
  const select = document.getElementById('categoryFilter');
  if (!select) return;
  const seen = new Set();
  toolCatalog.forEach(function(t) { if (t.category) seen.add(t.category); });
  Array.from(seen).sort().forEach(function(cat) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

(function initTools() {
  const grid = document.getElementById('toolGrid');
  const hint = document.getElementById('toolHint');

  try {
    populateToolCategories();
    renderToolGrid(toolCatalog);
    if (hint) hint.textContent = 'Showing ' + toolCatalog.length + ' tools by category. Use filters to narrow results.';
  } catch (err) {
    console.error('tools.js initTools error:', err);
    if (grid) grid.innerHTML = '<p style="color:#b91c1c;padding:1rem;background:#fef2f2;border-radius:8px;"><strong>Error loading tools:</strong> ' + (err && err.message ? err.message : String(err)) + '</p>';
    if (hint) hint.textContent = 'Failed to load tools. Check the browser console for details.';
    return;
  }

  const searchEl   = document.getElementById('toolSearch');
  const categoryEl = document.getElementById('categoryFilter');
  const costEl     = document.getElementById('costFilter');
  if (!searchEl && !grid) return;

  function onFilter() {
    applyToolFilters();
    if (hint) {
      const q   = (searchEl   ? searchEl.value.trim()   : '');
      const cat = (categoryEl ? categoryEl.value        : '');
      const cost = (costEl    ? costEl.value            : '');
      if (!q && !cat && !cost) {
        hint.textContent = 'Showing ' + toolCatalog.length + ' tools by category.';
      } else {
        hint.textContent = 'Filtering tools' + (q ? ' for "' + q + '"' : '') + (cat ? ' in ' + cat : '') + (cost ? ', ' + cost : '') + '.';
      }
    }
  }

  if (searchEl)   searchEl.addEventListener('input', onFilter);
  if (categoryEl) categoryEl.addEventListener('change', onFilter);
  if (costEl)     costEl.addEventListener('change', onFilter);
})();
