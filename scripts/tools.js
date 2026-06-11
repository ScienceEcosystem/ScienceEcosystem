// scripts/tools.js — fetch catalog as JSON, render tool grid

function escT(str) {
  return String(str || '').replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function renderToolGrid(list) {
  var grid = document.getElementById('toolGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!list || !list.length) {
    grid.innerHTML = '<p class="muted" style="padding:.5rem 0;">No tools match those filters.</p>';
    return;
  }

  var byCategory = Object.create(null);
  list.forEach(function(tool) {
    var cat = tool.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(tool);
  });

  Object.keys(byCategory).sort().forEach(function(cat) {
    var section = document.createElement('div');
    section.style.cssText = 'margin-bottom:2rem;';
    section.innerHTML = '<h3 style="font-size:.95rem;font-weight:700;color:#374151;margin:0 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid #e5e7eb;">' + escT(cat) + '</h3>';

    var row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.75rem;';

    byCategory[cat].slice().sort(function(a, b) {
      return (a.name || '').localeCompare(b.name || '');
    }).forEach(function(tool) {
      var card = document.createElement('article');
      card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1rem;display:flex;flex-direction:column;gap:.5rem;';
      card.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">'
          + '<span style="font-size:.9rem;font-weight:700;color:#0f172a;">' + escT(tool.name) + '</span>'
          + '<span style="font-size:.72rem;background:#f1f5f9;color:#374151;padding:2px 7px;border-radius:10px;flex-shrink:0;">' + escT(tool.cost || '') + '</span>'
        + '</div>'
        + '<p style="font-size:.82rem;color:#475569;margin:0;line-height:1.45;">' + escT(tool.summary || '') + '</p>'
        + (tool.open ? '<span style="font-size:.72rem;background:#dcfce7;color:#166534;padding:2px 7px;border-radius:10px;display:inline-block;">Open-source</span>' : '')
        + (tool.link ? '<div style="margin-top:auto;padding-top:.25rem;"><a href="' + escT(tool.link) + '" target="_blank" rel="noopener noreferrer" style="font-size:.8rem;color:#2e7f9f;text-decoration:none;font-weight:600;">Visit ' + escT(tool.name) + ' →</a></div>' : '');
      row.appendChild(card);
    });

    section.appendChild(row);
    grid.appendChild(section);
  });
}

function populateCategories(catalog, catalog_) {
  var select = document.getElementById('categoryFilter');
  if (!select) return;
  var seen = {};
  catalog.forEach(function(t) { if (t.category) seen[t.category] = true; });
  Object.keys(seen).sort().forEach(function(cat) {
    var opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat;
    select.appendChild(opt);
  });
}

function applyFilters(catalog) {
  var q    = ((document.getElementById('toolSearch') || {}).value || '').toLowerCase().trim();
  var cat  = ((document.getElementById('categoryFilter') || {}).value || '');
  var cost = ((document.getElementById('costFilter') || {}).value || '');
  renderToolGrid(catalog.filter(function(t) {
    var matchQ = !q || (t.name||'').toLowerCase().includes(q) || (t.summary||'').toLowerCase().includes(q)
                     || (t.category||'').toLowerCase().includes(q) || (t.bestFor||'').toLowerCase().includes(q)
                     || (t.tags||[]).some(function(g){ return g.toLowerCase().includes(q); });
    return matchQ && (!cat || t.category === cat) && (!cost || t.cost === cost);
  }));
}

(function initTools() {
  var hint = document.getElementById('toolHint');
  var grid = document.getElementById('toolGrid');
  if (hint) hint.textContent = 'Loading tools…';

  fetch('/assets/tools.json')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(catalog) {
      populateCategories(catalog);
      renderToolGrid(catalog);
      if (hint) hint.textContent = 'Showing ' + catalog.length + ' tools by category. Use filters to narrow results.';

      var searchEl   = document.getElementById('toolSearch');
      var categoryEl = document.getElementById('categoryFilter');
      var costEl     = document.getElementById('costFilter');

      function onFilter() {
        applyFilters(catalog);
        if (hint) {
          var q = (searchEl ? searchEl.value.trim() : '');
          var c = (categoryEl ? categoryEl.value : '');
          var v = (costEl ? costEl.value : '');
          hint.textContent = (!q && !c && !v)
            ? 'Showing ' + catalog.length + ' tools by category.'
            : 'Filtering tools' + (q ? ' for "' + q + '"' : '') + (c ? ' in ' + c : '') + (v ? ', ' + v : '') + '.';
        }
      }

      if (searchEl)   searchEl.addEventListener('input',  onFilter);
      if (categoryEl) categoryEl.addEventListener('change', onFilter);
      if (costEl)     costEl.addEventListener('change', onFilter);
    })
    .catch(function(err) {
      console.error('tools.js: failed to load catalog', err);
      if (grid) grid.innerHTML = '<p style="color:#b91c1c;padding:1rem;background:#fef2f2;border-radius:8px;"><strong>Could not load tools:</strong> ' + escT(String(err)) + '</p>';
      if (hint) hint.textContent = 'Failed to load. Please refresh.';
    });
})();
