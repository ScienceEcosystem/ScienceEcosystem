// server/living-paper-cache.js — resolves "does this GitHub repo have a
// living paper?" for any repo, not just ones whose authors ran
// scripts/generate_evidence.R themselves. Three tiers, in order of trust:
//
//   ci-verified      the repo has evidence.json AND a GitHub Actions
//                     workflow that appears to (re)generate it — the
//                     strongest claim, backed by an automated re-run.
//   author-published the repo has evidence.json but no visible CI wiring
//                     for it — the author generated it at some point, no
//                     freshness guarantee.
//   auto-generated    the repo has no evidence.json at all, but looks like
//                     a compatible Quarto project, so ScienceEcosystem
//                     generated the manifest itself by parsing the repo's
//                     source text (see living-paper-generator.js). Nobody
//                     re-ran this code — it's a weaker claim than the other
//                     two, and the frontend must label it as such.
//   none              not a living paper, either way.
//
// Caching is keyed on the branch's current commit sha, not a fixed TTL —
// re-generating only happens when the repo actually changes. The one
// GitHub API call needed to *check* the current sha is itself throttled to
// once per hour per repo (SHA_TTL_MS below), since api.github.com is
// unauthenticated here (60 req/hour/IP) and this runs on a free-tier
// single instance — without that throttle, a handful of paper-page views
// across different repos in the same hour could exhaust the budget for
// everyone.
import fetch from "node-fetch";
import { generateEvidenceForRepo } from "./living-paper-generator.js";

const SHA_TTL_MS = 60 * 60 * 1000; // 1 hour
const UA = "ScienceEcosystem/1.0 (+https://scienceecosystem.org)";

async function withTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function ghJson(url) {
  try {
    const res = await withTimeout(url, {
      headers: { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA },
    }, 8000);
    if (!res.ok) return null;
    return await res.json();
  } catch (_) { return null; }
}

async function rawFetch(owner, repo, sha, path) {
  try {
    const res = await withTimeout(`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`, {
      headers: { "User-Agent": UA },
    }, 8000);
    if (!res.ok) return null;
    return await res.text();
  } catch (_) { return null; }
}

async function resolveBranchSha(owner, repo) {
  for (const branch of ["main", "master"]) {
    const data = await ghJson(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`);
    if (data && data.sha) return { branch, sha: data.sha };
  }
  return null;
}

// A repo with real CI wiring gets the stronger "ci-verified" label — one
// that merely has evidence.json committed only ever proves it ran once, on
// the author's own machine, at some point in the past.
async function looksCIVerified(owner, repo, sha) {
  const listing = await ghJson(`https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows?ref=${sha}`);
  if (!Array.isArray(listing)) return false;
  const ymlFiles = listing.filter((f) => /\.ya?ml$/i.test(f.name)).slice(0, 5);
  for (const f of ymlFiles) {
    const text = await rawFetch(owner, repo, sha, `.github/workflows/${f.name}`);
    if (text && /generate_evidence|evidence\.json/i.test(text)) return true;
  }
  return false;
}

async function getCacheRow(pool, repoKey) {
  const { rows } = await pool.query(`SELECT * FROM living_paper_cache WHERE repo = $1`, [repoKey]);
  if (!rows.length) return null;
  const row = rows[0];
  row.evidence = typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence;
  return row;
}

async function saveCacheRow(pool, repoKey, { tier, sha, branch, evidence, claimCount }) {
  await pool.query(
    `INSERT INTO living_paper_cache (repo, tier, sha, branch, evidence, claim_count, sha_checked_at, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (repo) DO UPDATE SET
       tier = EXCLUDED.tier, sha = EXCLUDED.sha, branch = EXCLUDED.branch,
       evidence = EXCLUDED.evidence, claim_count = EXCLUDED.claim_count,
       sha_checked_at = NOW(), generated_at = NOW()`,
    [repoKey, tier, sha, branch, evidence ? JSON.stringify(evidence) : null, claimCount ?? null]
  );
}

export async function resolveLivingPaper(pool, repoFullName) {
  const parts = String(repoFullName || "").split("/");
  const owner = parts[0], repo = parts[1];
  if (!owner || !repo) return { tier: "none" };
  const repoKey = `${owner}/${repo}`.toLowerCase();

  const cached = pool ? await getCacheRow(pool, repoKey) : null;
  const cacheAgeMs = cached ? Date.now() - new Date(cached.sha_checked_at).getTime() : Infinity;

  // Fresh cache — serve directly, no GitHub calls at all.
  if (cached && cacheAgeMs < SHA_TTL_MS) {
    return { tier: cached.tier, evidence: cached.evidence || null };
  }

  const branchSha = await resolveBranchSha(owner, repo);

  // GitHub lookup failed (rate-limited, repo renamed/deleted, network blip)
  // — serve whatever's cached rather than flipping a known-good paper to
  // "unavailable" over a transient failure.
  if (!branchSha) {
    if (cached) return { tier: cached.tier, evidence: cached.evidence || null };
    return { tier: "none" };
  }

  // Nothing changed since the last check — just extend the cache's TTL.
  if (cached && cached.sha === branchSha.sha) {
    if (pool) await pool.query(`UPDATE living_paper_cache SET sha_checked_at = NOW() WHERE repo = $1`, [repoKey]);
    return { tier: cached.tier, evidence: cached.evidence || null };
  }

  // New repo, or moved on to a new commit since we last looked — resolve fresh.
  const { sha, branch } = branchSha;

  const authorEvidenceText = await rawFetch(owner, repo, sha, "evidence.json");
  if (authorEvidenceText) {
    let evidence = null;
    try { evidence = JSON.parse(authorEvidenceText); } catch (_) { evidence = null; }
    if (evidence) {
      const tier = (await looksCIVerified(owner, repo, sha)) ? "ci-verified" : "author-published";
      if (pool) await saveCacheRow(pool, repoKey, { tier, sha, branch, evidence, claimCount: evidence?.claims?.length ?? null });
      return { tier, evidence };
    }
  }

  const { manifest, claimCount } = await generateEvidenceForRepo({ owner, repo, sha });
  if (manifest && claimCount > 0) {
    if (pool) await saveCacheRow(pool, repoKey, { tier: "auto-generated", sha, branch, evidence: manifest, claimCount });
    return { tier: "auto-generated", evidence: manifest };
  }

  if (pool) await saveCacheRow(pool, repoKey, { tier: "none", sha, branch, evidence: null, claimCount: 0 });
  return { tier: "none" };
}
