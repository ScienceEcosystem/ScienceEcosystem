# Contributing to ScienceEcosystem

Thanks for considering contributing. ScienceEcosystem is an independent, non-commercial open-science project — we don't have a huge team, so outside help genuinely matters.

## Before you start

- For anything bigger than a small fix (a new feature, a significant refactor, a new external data source), please open an issue first to discuss the approach before writing code. This avoids wasted work on both sides.
- For small bug fixes, typos, or clear improvements, a pull request directly is fine.
- Check `notes.txt` at the repo root — it's our running development log and roadmap. It tells you what's already planned, what's in progress, and what's intentionally deferred. Please check it before proposing a feature that might already be on the list (or explicitly decided against).

## Local setup

**Requirements:** Node.js 18+, a PostgreSQL database (e.g. a free [Neon](https://neon.tech) instance), and an [ORCID](https://orcid.org) public API client if you want to test login locally.

```bash
git clone https://github.com/ScienceEcosystem/ScienceEcosystem.git
cd ScienceEcosystem
npm install
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL and SESSION_SECRET.
# ORCID_CLIENT_ID/SECRET are only needed if you're testing login.
npm start
```

The server creates and migrates its own schema automatically on startup (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `server/index.js`) — there is no separate migration step to run. Point `DATABASE_URL` at any empty Postgres database and it will set itself up on first boot.

The frontend is plain HTML/CSS/JS served directly by the Express server (`app.use(express.static(...))`) — no build step, no bundler. Edit a file, refresh the browser.

## Code style

This codebase doesn't use a linter/formatter config yet, so match what's already there:

- Vanilla JS, no framework, no build tooling on the frontend.
- Prefer small, focused functions. Look at neighboring code in the same file for naming/formatting conventions before introducing a new pattern.
- No comments explaining *what* code does — only *why*, when something is genuinely non-obvious (a workaround, an external API quirk, a subtle invariant).
- Don't add abstractions, config options, or "while I'm here" refactors beyond what the change needs.

## Security

If you find a security vulnerability, **please don't open a public issue.** Email info@scienceecosystem.org directly so it can be fixed before it's public.

## Pull requests

- Keep PRs focused — one change per PR is much easier to review than five unrelated ones bundled together.
- Describe *why* the change is needed, not just what it does (the diff already shows that).
- If your change affects user-facing behavior, a screenshot or short description of what you tested helps a lot — we don't have an automated test suite yet, so manual verification notes matter.

## What's especially useful right now

Check the `[ ]` (not-yet-done) items in `notes.txt` for the current priority list. As a general guide:

- **Bug fixes** are always welcome, any time.
- **Accessibility** improvements (the site targets WCAG 2.1 AA).
- **Data source integrations** (see Phase 2 in `notes.txt` — linking papers to datasets/code from Zenodo, Dryad, Figshare, GitHub, Software Heritage, DataCite).
- Browser extension improvements (Chrome is live, Firefox is in review; Safari is unstarted and needs an Xcode/Apple developer setup).

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) — see the `LICENSE` file. In short: you can use, modify, and redistribute this code, but if you run a modified version as a network service, you must also make your modified source available to its users under the same license.

## Questions

Open an issue, or email info@scienceecosystem.org.
