// Server-side port of generate_evidence.R — same manifest-building logic,
// re-targeted to fetch files from GitHub instead of a local checkout, so
// ScienceEcosystem can build evidence.json for a paper's repo on demand
// even when the author never ran the R script themselves.
//
// This is a faithful line-by-line port, not a reimplementation — every
// regex, filter, and known limitation below mirrors
// scripts/generate_evidence.R exactly (see that file's own header for the
// full design rationale and limitation writeup). Keep the two in sync: a
// fix made to one static-text-analysis bug applies to both, since they're
// solving the same problem against the same kind of source files.
//
// Known limitations (same as the R version):
// - R-only (```{r} chunks). Python/Julia chunks aren't parsed.
// - Static text analysis, not real data-flow analysis.
// - Short variable names (<4 chars) are excluded from backward-chase
//   candidates to avoid loop-counter/temporary false positives, at the
//   cost of missing genuine short names (e.g. "dat") once in a while.
// - A word immediately followed by a bare "=" is treated as a named
//   function argument, not a variable reference.

import fetch from "node-fetch";
import { load as loadYaml } from "js-yaml";

const RAW_BASE = "https://raw.githubusercontent.com";

async function fetchTextTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ScienceEcosystem/1.0 (+https://scienceecosystem.org)" },
    });
    if (!res.ok) return null;
    return (await res.text()).replace(/\r\n/g, "\n");
  } catch (_) {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function makeFetcher(owner, repo, sha) {
  const cache = new Map();
  return async function fetchText(path) {
    if (cache.has(path)) return cache.get(path);
    const text = await fetchTextTimeout(`${RAW_BASE}/${owner}/${repo}/${sha}/${path}`);
    cache.set(path, text);
    return text;
  };
}

// ---- parse every ```{r}...``` chunk in one file's text (1-indexed line
// numbers throughout, to match GitHub's own line numbering for permalinks) ----
function parseChunksInText(filename, text) {
  if (text == null) return [];
  const raw = text.split("\n");
  const lines = [null, ...raw]; // lines[1] === raw[0], so indices match R's 1-indexed vectors
  const n = raw.length;
  const chunkStarts = [];
  for (let i = 1; i <= n; i++) {
    if (/^```\{r/.test(lines[i])) chunkStarts.push(i);
  }
  const out = [];
  for (const s of chunkStarts) {
    let e = s;
    while (e < n && lines[e] !== "```") e++;
    const bodyLines = [];
    for (let k = s; k <= e; k++) bodyLines.push(lines[k]);
    const body = bodyLines.join("\n");

    const labelMatch = body.match(/#\|\s*label:\s*([^\n]+)/);
    const label = labelMatch ? labelMatch[1].trim() : null;

    // Only `<-` counts as a real top-level assignment — see generate_evidence.R
    // for why a bare `=` isn't treated the same way.
    const ownVars = [];
    const seenVars = new Set();
    for (let k = s; k <= e; k++) {
      const m = lines[k].match(/^\s*([A-Za-z_.][A-Za-z0-9_.]*)\s*<-/);
      if (m && !seenVars.has(m[1])) { seenVars.add(m[1]); ownVars.push(m[1]); }
    }
    out.push({ sourceFile: filename, start: s, end: e, body, label, ownVars });
  }
  return out;
}

function findFiles(body, fnPattern, extPattern) {
  const fn = `(?:${fnPattern})`;
  const re = new RegExp(`${fn}\\(\\s*"([^"]+${extPattern})"`, "g");
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(body))) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

// read_excel(some_var, sheet = "X") — path is a variable, only resolvable
// when that variable was assigned a plain literal string somewhere in the
// project (see literalStringDefs below).
function findVariableArgReads(body, fnPattern, literalStringDefs) {
  const fn = `(?:${fnPattern})`;
  const re = new RegExp(`${fn}\\(\\s*([A-Za-z_.][A-Za-z0-9_.]*)\\s*[,)]`, "g");
  const varNames = new Set();
  let m;
  while ((m = re.exec(body))) varNames.add(m[1]);
  const out = [];
  for (const v of varNames) {
    if (literalStringDefs.has(v)) out.push(literalStringDefs.get(v));
  }
  return out;
}

function findReads(body, literalStringDefs) {
  const literal = [
    ...findFiles(body, "read_excel", "\\.xlsx"),
    ...findFiles(body, "read\\.csv|read_csv", "\\.csv"),
    ...findFiles(body, "readRDS", "\\.rds"),
  ];
  const varArg = [
    ...findVariableArgReads(body, "read_excel", literalStringDefs),
    ...findVariableArgReads(body, "read\\.csv|read_csv", literalStringDefs),
    ...findVariableArgReads(body, "readRDS", literalStringDefs),
  ];
  return [...new Set([...literal, ...varArg])];
}

function findWrites(body) {
  const outWrites = [];
  {
    const re = /file\.path\(out_dir,\s*"\s*([^"]+\.(?:csv|png|rds))"\)/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(body))) {
      const v = `outputs/${m[1].trim()}`;
      if (!seen.has(v)) { seen.add(v); outWrites.push(v); }
    }
  }

  // Literal-path writes: saveRDS(x, "path.rds"), write_csv(x, "path.csv"),
  // write.csv(x, "path.csv"), ggsave("path.png", plot) — path may be the
  // first or a later argument, call often spans several lines.
  const literalWriteFns = [
    { fn: "saveRDS", ext: "\\.rds" },
    { fn: "write_csv|readr::write_csv|write\\.csv|write\\.table", ext: "\\.csv" },
    { fn: "ggsave", ext: "\\.(?:png|pdf|svg|jpg|jpeg|tiff)" },
  ];
  const literalWrites = [];
  const seenLit = new Set();
  for (const spec of literalWriteFns) {
    const fn = `(?:${spec.fn})`;
    const re = new RegExp(`${fn}\\([\\s\\S]*?"([^"]+${spec.ext})"`, "g");
    let m;
    while ((m = re.exec(body))) {
      // Skip matches that actually reach into a nested file.path(out_dir, "...")
      // call — that write is already captured above, with its outputs/
      // prefix intact; without this guard it'd be double-counted here too.
      if (m[0].includes("file.path(out_dir")) continue;
      if (!seenLit.has(m[1])) { seenLit.add(m[1]); literalWrites.push(m[1]); }
    }
  }

  return [...new Set([...outWrites, ...literalWrites])];
}

function getOpt(body, name) {
  const m = body.match(new RegExp(`#\\|\\s*${name}:\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

// Strips the ```{r}/``` fences and #| chunk-option lines, leaving just the
// real R code, for display.
function stripCode(body) {
  let lines = body.split("\n");
  lines = lines.filter((l) => !/^```/.test(l) && !/^#\|/.test(l));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

function permalinkFor(githubRepo, gitRef, ch) {
  if (!githubRepo) return null;
  return `https://github.com/${githubRepo}/blob/${gitRef}/${ch.sourceFile}#L${ch.start}-L${ch.end}`;
}

export async function generateEvidenceForRepo({ owner, repo, sha }) {
  const fetchText = makeFetcher(owner, repo, sha);
  const githubRepo = `${owner}/${repo}`;
  const gitRef = sha;

  // ---- article DOI: best-effort scan of README.md ----
  let paperDoi = null;
  const readmeText = await fetchText("README.md");
  if (readmeText != null) {
    const allDois = (readmeText.match(/10\.[0-9]{4,9}\/[^\s")\[\]>]+/g) || [])
      .map((d) => d.replace(/[>)\.,;]+$/, ""));
    const nonZenodo = allDois.filter((d) => !/^10\.5281\/zenodo/.test(d));
    paperDoi = nonZenodo.length ? nonZenodo[0] : (allDois.length ? allDois[0] : null);
  }

  // ---- discover the manuscript file + notebook file(s) from _quarto.yml ----
  const quartoYmlText = await fetchText("_quarto.yml");
  let qcfg = {};
  if (quartoYmlText != null) {
    try { qcfg = loadYaml(quartoYmlText) || {}; } catch (_) { qcfg = {}; }
  }
  const manuscriptCfg = qcfg && qcfg.manuscript;

  const articleFile = (manuscriptCfg && manuscriptCfg.article) || "index.qmd";
  let notebookFiles = [];
  if (manuscriptCfg && Array.isArray(manuscriptCfg.notebooks)) {
    notebookFiles = manuscriptCfg.notebooks.map((x) => x && x.notebook).filter(Boolean);
  } else if ((await fetchText("analysis.qmd")) != null) {
    notebookFiles = ["analysis.qmd"]; // fallback for `type: default` layouts
  }
  const allSourceFiles = [...notebookFiles, articleFile];

  // ---- parse every chunk across every notebook + the manuscript ----
  let chunks = [];
  for (const f of allSourceFiles) {
    const text = await fetchText(f);
    chunks = chunks.concat(parseChunksInText(f, text));
  }
  if (!chunks.length) return { manifest: null, claimCount: 0 };

  // ---- manuscript text to scan for @label / {{< embed >}} usage, following includes ----
  let articleText = (await fetchText(articleFile)) || "";
  const includeRe = /\{\{<\s*include\s+([a-zA-Z0-9_./-]+\.qmd)\s*>\}\}/g;
  const includes = new Set();
  let incM;
  while ((incM = includeRe.exec(articleText))) includes.add(incM[1]);
  let indexText = articleText;
  for (const inc of includes) {
    const t = await fetchText(inc);
    if (t != null) indexText += "\n" + t;
  }
  // Drop HTML comments so disabled/commented-out embeds and citations aren't live.
  indexText = indexText.replace(/<!--[\s\S]*?-->/g, "");

  // ---- global variable -> defining chunk index map (in chunk order) ----
  const varDefs = new Map(); // name -> [chunkIdx, ...]
  chunks.forEach((ch, idx) => {
    for (const v of ch.ownVars) {
      if (!varDefs.has(v)) varDefs.set(v, []);
      varDefs.get(v).push(idx);
    }
  });

  // ---- variable -> literal string value, for resolving e.g. read_excel(path_var, sheet=...) ----
  const literalStringDefs = new Map();
  for (const ch of chunks) {
    for (const ln of ch.body.split("\n")) {
      const m = ln.match(/^\s*([A-Za-z_.][A-Za-z0-9_.]*)\s*<-\s*"([^"]+)"\s*$/);
      if (m) literalStringDefs.set(m[1], m[2]);
    }
  }

  // Backward-traces ONE field (reads or writes) when a chunk has none of its
  // own — see generate_evidence.R's resolve_field() for the full rationale.
  function resolveField(chunkIdx, extractor, visited) {
    if (visited.includes(chunkIdx)) return { values: [], contributed: [] };
    visited = [...visited, chunkIdx];
    const ch = chunks[chunkIdx];
    let values = extractor(ch.body);
    const contributed = [];

    if (!values.length) {
      // R's ls(envir) returns names using the locale's collation (dictionary
      // order — "accuracy_lda" before "accuracy_Svirgsden_lda", lowercase
      // and uppercase interleaved by letter), not JS's default byte-order
      // sort (all uppercase before all lowercase) or insertion order. That
      // ordering feeds into which chunk's values get unioned in first below,
      // so it has to match exactly for identical output, even though the
      // final *set* of values wouldn't differ either way.
      const allVars = [...varDefs.keys()].sort((a, b) => a.localeCompare(b)).filter((v) => v.length >= 4);
      const candidates = allVars.filter((v) => {
        if (ch.ownVars.includes(v)) return false;
        const re = new RegExp(`\\b${v}\\b(?!\\s*=(?!=))`);
        return re.test(ch.body);
      });
      const srcIdxs = new Set();
      for (const v of candidates) {
        const defs = varDefs.get(v).filter((d) => d < chunkIdx);
        if (defs.length) srcIdxs.add(Math.max(...defs));
      }
      for (const si of srcIdxs) {
        const sub = resolveField(si, extractor, visited);
        if (sub.values.length) {
          values = [...new Set([...values, ...sub.values])];
          contributed.push({ chunkIdx: si, label: chunks[si].label, lineStart: chunks[si].start, lineEnd: chunks[si].end });
        }
        contributed.push(...sub.contributed);
      }
    }
    return { values, contributed };
  }

  function resolveLineage(chunkIdx) {
    const readsRes = resolveField(chunkIdx, (b) => findReads(b, literalStringDefs), []);
    const writesRes = resolveField(chunkIdx, findWrites, []);
    return {
      reads: readsRes.values,
      writes: writesRes.values,
      contributed: [...readsRes.contributed, ...writesRes.contributed],
    };
  }

  // ---- build one entry per fig-/tbl- label actually surfaced in the manuscript ----
  const entries = [];
  chunks.forEach((ch, chunkIdx) => {
    const label = ch.label;
    if (!label || !/^(fig|tbl)-/.test(label)) return;

    const body = ch.body;
    const tblCap = getOpt(body, "tbl-cap");
    const figCap = getOpt(body, "fig-cap");
    const caption = tblCap != null ? tblCap : figCap;

    const embedded = notebookFiles.some((f) => {
      const escaped = f.replace(/\./g, "\\.");
      return new RegExp(`\\{\\{<\\s*embed\\s+${escaped}#${label}\\s*>\\}\\}`).test(indexText);
    });
    const labelBoundary = "(?![A-Za-z0-9_-])";
    const citedRe = new RegExp(`@${label}${labelBoundary}`);
    const cited = citedRe.test(indexText);
    if (!embedded && !cited) return; // not surfaced in the manuscript

    // best-effort claim sentence: paragraph containing the first @label, split to the sentence with it
    let claimText = null;
    const paraRe = new RegExp(`[^\n]*@${label}${labelBoundary}[^\n]*`);
    const paraM = indexText.match(paraRe);
    if (paraM) {
      const sentences = paraM[0].split(/(?<=[.?!])\s+/);
      const hit = sentences.find((s) => new RegExp(`@${label}${labelBoundary}`).test(s));
      if (hit) {
        // Strip EVERY fig-/tbl- citation in the sentence, not just this
        // label's, so a multi-citation sentence doesn't leak raw @label markup.
        claimText = hit.replace(/\(?@(fig|tbl)-[A-Za-z0-9_-]+\)?/g, "").trim();
        claimText = claimText.replace(/`r [^`]+`/g, "[computed value]");
        claimText = claimText.replace(/\s+/g, " ");
      }
    }

    const lineage = resolveLineage(chunkIdx);
    const seenIdx = new Set();
    const contribIdxs = [];
    for (const c of lineage.contributed) {
      if (seenIdx.has(c.chunkIdx)) continue;
      seenIdx.add(c.chunkIdx);
      contribIdxs.push(c.chunkIdx);
    }
    contribIdxs.sort((a, b) => a - b);

    entries.push({
      label,
      manuscriptRef: `@${label}`,
      claimText,
      caption,
      sourceFile: ch.sourceFile,
      lineStart: ch.start,
      lineEnd: ch.end,
      reads: lineage.reads,
      writes: lineage.writes,
      code: stripCode(body),
      contribIdxs,
      embeddedAsFigure: /^fig-/.test(label),
      githubPermalink: permalinkFor(githubRepo, gitRef, ch),
    });
  });

  // ---- classify contributing chunks as shared pipeline vs claim-specific ----
  const allContribIdxs = [...new Set(entries.flatMap((e) => e.contribIdxs))];
  let pipelineIdxs = new Set();
  if (entries.length >= 2) {
    for (const idx of allContribIdxs) {
      const count = entries.filter((e) => e.contribIdxs.includes(idx)).length;
      if (count > entries.length / 2) pipelineIdxs.add(idx);
    }
  }

  function chunkRef(idx, withCode) {
    const ch = chunks[idx];
    const base = { label: ch.label, lineStart: ch.start, lineEnd: ch.end, githubPermalink: permalinkFor(githubRepo, gitRef, ch) };
    if (withCode) base.code = stripCode(ch.body);
    return base;
  }

  for (const e of entries) {
    const pipeline = e.contribIdxs.filter((i) => pipelineIdxs.has(i));
    const interesting = e.contribIdxs.filter((i) => !pipelineIdxs.has(i));
    delete e.contribIdxs;
    e.dataPipeline = pipeline.map((i) => chunkRef(i, false));
    e.computedIn = interesting.map((i) => chunkRef(i, true));
  }

  if (!entries.length) return { manifest: null, claimCount: 0 };

  const manifest = {
    paper: { doi: paperDoi, repo: `https://github.com/${githubRepo}` },
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    gitRef,
    claims: entries,
    // Marks this manifest as built by ScienceEcosystem parsing the repo's
    // source text, not committed by the author and not re-run by CI — the
    // frontend must show this distinctly from an author-published manifest.
    generatedBy: "scienceecosystem-auto",
  };

  return { manifest, claimCount: entries.length };
}
