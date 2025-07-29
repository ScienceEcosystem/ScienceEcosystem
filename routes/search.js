const express = require('express');
const router = express.Router();
const axios = require('axios');

// Search route querying OpenAlex for authors and works
router.get('/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json({ authors: [], works: [] });

  try {
    const [authorsRes, worksRes] = await Promise.all([
      axios.get('https://api.openalex.org/authors', { params: { search: q, per_page: 5 } }),
      axios.get('https://api.openalex.org/works', { params: { search: q, per_page: 5 } }),
    ]);

    res.json({
      authors: authorsRes.data.results || [],
      works: worksRes.data.results || []
    });
  } catch (e) {
    console.error('Search API error:', e.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;

const express = require('express');
const app = express();
const searchRouter = require('../routes/search');

app.use('/api', searchRouter);

// Serve static files (adjust if needed)
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
