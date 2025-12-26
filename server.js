// server.js
require('dotenv').config(); // 1) load env first

const path = require('path');
const express = require('express');
const searchRouter = require('./routes/search');
const authRouter = require('./routes/auth');
const profileRouter = require('./routes/profile');
const session = require('express-session');
const db = require('./db');

const app = express();

const PORT = process.env.PORT || 3000; // 2) declare once
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';
const NODE_ENV = process.env.NODE_ENV || 'development';

app.use(express.json());
app.use(session({
  name: 'sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  }
}));

// Initialize DB schema
db.init().catch(e => console.error("DB init error:", e));

app.use('/api', searchRouter);
app.use('/api', profileRouter);
app.use(authRouter);
app.use(express.static(PUBLIC_DIR));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`ScienceEcosystem server listening on http://localhost:${PORT}`);
});
