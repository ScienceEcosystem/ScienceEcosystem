async function Search() {
  const query = document.getElementById('unifiedSearchInput').value.trim();
  const resultsDiv = document.getElementById('unifiedSearchResults');

  if (!query) return;

  resultsDiv.innerHTML = 'Loading...';

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    resultsDiv.innerHTML = '';

    if (data.authors.length > 0) {
      resultsDiv.innerHTML += '<h3>Researchers</h3>';
      data.authors.forEach(author => {
        const div = document.createElement('div');
        div.className = 'result';
        div.style = 'margin-bottom: 0.5rem; cursor: pointer;';
        div.innerHTML = `
          <strong>${author.display_name}</strong><br>
          <small>${author.last_known_institution?.display_name || 'Unknown institution'}</small>
        `;
        div.onclick = () => window.location.href = '/author?id=' + encodeURIComponent(author.id);
        resultsDiv.appendChild(div);
      });
    }

    if (data.works.length > 0) {
      resultsDiv.innerHTML += '<h3>Publications</h3>';
      data.works.forEach(work => {
        const div = document.createElement('div');
        div.className = 'result';
        div.style = 'margin-bottom: 0.5rem; cursor: pointer;';
        div.innerHTML = `
          <strong>${work.title}</strong><br>
          <small>${(work.authorships || []).map(a => a.author.display_name).join(', ')}</small>
        `;
        div.onclick = () => window.location.href = '/paper?id=' + encodeURIComponent(work.id);
        resultsDiv.appendChild(div);
      });
    }

    if (data.authors.length === 0 && data.works.length === 0) {
      resultsDiv.innerHTML = '<p>No results found.</p>';
    }
  } catch (err) {
    console.error(err);
    resultsDiv.innerHTML = '<p>Error fetching results.</p>';
  }
}
