// server.js
require('dotenv').config(); // 1) load env first

const path = require('path');
const express = require('express');
const searchRouter = require('./routes/search');

const app = express();

const PORT = process.env.PORT || 3000; // 2) declare once
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');

app.use(express.json());
app.use('/api', searchRouter);
app.use(express.static(PUBLIC_DIR));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`ScienceEcosystem server listening on http://localhost:${PORT}`);
});
