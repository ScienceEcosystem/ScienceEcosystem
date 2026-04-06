// server/artifacts-resolver.js
import fetch from "node-fetch";

const REPO_PREFIXES = {
  "10.5281": { name: "Zenodo", url: "https://zenodo.org/record/", type: "auto" },
  "10.6084": { name: "Figshare", url: "https://figshare.com/", type: "auto" },
  "10.17605": { name: "OSF", url: "https://osf.io/", type: "auto" },
  "10.7910": { name: "Harvard Dataverse", url: "https://dataverse.harvard.edu/", type: "Dataset" },
  "10.15468": { name: "GBIF", url: "https://www.gbif.org/", type: "Dataset" },
  "10.26008": { name: "Dryad", url: "https://datadryad.org/", type: "Dataset" },
  "10.48550": { name: "arXiv", url: "https://arxiv.org/", type: "Preprint" },
  "10.25080": { name: "SciPy Proceedings", url: "https://proceedings.scipy.org/", type: "Software" }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeFetch(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "ScienceEcosystem/1.0 (+https://scienceecosystem.org)",
        ...(opts.headers || {})
      }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

async function safeFetchText(url, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "User-Agent": "ScienceEcosystem/1.0 (+https://scienceecosystem.org)",
        ...(opts.headers || {})
      }
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function normDOI(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/&[^;]+;/g, "")
    .replace(/&#xa/gi, "")
    .replace(/[\s\u00a0\u2028\u2029]+/g, "")
    .trim()
    .toLowerCase();
}
function doiPrefix(doi) {
  return doi ? doi.split("/")[0] : "";
}
function classifyType(str) {
  const s = String(str || "").toLowerCase();
  if (/\bsoftware\b|\bcode\b|\bscript\b|\bpackage\b|\blibrary\b/.test(s)) return "Software";
  if (/\bdataset\b|\bdata\b|\bdatabase\b/.test(s)) return "Dataset";
  if (/\bworkflow\b|\bpipeline\b/.test(s)) return "Workflow";
  if (/\bpreprint\b|\bpaper\b/.test(s)) return "Preprint";
  return "Other";
}
function jaccard(a, b) {
  const tokenize = s => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const A = tokenize(a), B = tokenize(b);
  let inter = 0;
  A.forEach(t => { if (B.has(t)) inter++; });
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}
const STOP = new Set(["a","an","the","of","in","on","at","to","for","and","or","with","from","by","is","are","was","were","that","this","these","those","it","its"]);
function shortTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w))
    .slice(0, 5)
    .join(" ");
}
function firstAuthorSurname(authors) {
  if (!authors) return "";
  const first = String(authors).split(/[,;]|\band\b/i)[0].trim();
  if (first.includes(",")) return first.split(",")[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1] || "";
}

async function fetchDataCite(doi) {
  if (!doi) return [];
  const q = `relatedIdentifiers.identifier:"${doi.replace(/"/g, '\\"')}"`;
  const data = await safeFetch(`https://api.datacite.org/works?query=${encodeURIComponent(q)}&page[size]=100`);
  if (!data?.data?.length) return [];
  return data.data.map(rec => {
    const a = rec.attributes || {};
    const title = (Array.isArray(a.titles) && a.titles[0]?.title) ? a.titles[0].title : (a.title || "");
    const typeGen = String(a.types?.resourceTypeGeneral || "").toLowerCase();
    return {
      source: "DataCite",
      type: typeGen.includes("software") ? "Software" : typeGen.includes("dataset") ? "Dataset" : "Other",
      title: title || a.doi || "DataCite record",
      doi: a.doi || "",
      url: a.url || (a.doi ? `https://doi.org/${a.doi}` : ""),
      repository: a.publisher || "",
      confidence: 90
    };
  });
}

async function fetchZenodoByDOI(doi) {
  if (!doi) return [];
  const queries = [
    `metadata.related_identifiers.identifier:"${doi}"`,
    `related.identifiers.identifier:"${doi}"`
  ];
  for (const q of queries) {
    const data = await safeFetch(`https://zenodo.org/api/records/?q=${encodeURIComponent(q)}&size=50`);
    const hits = data?.hits?.hits;
    if (hits?.length) {
      return hits.map(h => {
        const md = h.metadata || {};
        const typeGen = String(md.resource_type?.type || "").toLowerCase();
        const doiZ = md.doi || h.doi || "";
        return {
          source: "Zenodo",
          type: typeGen.includes("software") ? "Software" : typeGen.includes("dataset") ? "Dataset" : "Other",
          title: md.title || doiZ || "Zenodo record",
          doi: doiZ,
          url: h.links?.html || (doiZ ? `https://doi.org/${doiZ}` : ""),
          repository: "Zenodo",
          version: md.version || "",
          licence: (md.license && (md.license.id || md.license)) || "",
          confidence: 88
        };
      });
    }
  }
  return [];
}

async function fetchCrossrefRelations(doi) {
  if (!doi) return [];
  const data = await safeFetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=info@scienceecosystem.org`);
  const rel = data?.message?.relation || {};
  const out = [];
  for (const [k, arr] of Object.entries(rel)) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      const rid = r.DOI || r.id || "";
      const url = r.url || (rid ? `https://doi.org/${rid}` : "");
      if (!url && !rid) continue;
      const prefix = doiPrefix(normDOI(rid));
      const fromRepo = !!REPO_PREFIXES[prefix];
      out.push({
        source: "Crossref",
        type: classifyType(k),
        title: rid || k || "Related item",
        doi: rid || "",
        url,
        repository: REPO_PREFIXES[prefix]?.name || "",
        confidence: fromRepo ? 85 : 60
      });
    }
  }
  return out;
}

async function fetchOpenAlexCitedRepos(openAlexId) {
  if (!openAlexId) return [];
  const id = String(openAlexId).replace(/^https?:\/\/openalex\.org\//i, "");
  const data = await safeFetch(`https://api.openalex.org/works/${encodeURIComponent(id)}?select=referenced_works,doi&mailto=info@scienceecosystem.org`);
  const refs = data?.referenced_works;
  if (!refs?.length) return [];

  const BATCH = 50;
  const slice = refs.slice(0, BATCH);
  const ids = slice.map(r => `https://openalex.org/${String(r).split("/").pop()}`).join("|");
  const batch = await safeFetch(`https://api.openalex.org/works?filter=ids.openalex:${encodeURIComponent(ids)}&select=id,doi,display_name,type&per_page=${BATCH}&mailto=info@scienceecosystem.org`);
  if (!batch?.results?.length) return [];

  const out = [];
  for (const w of batch.results) {
    const doi = normDOI(w.doi || "");
    if (!doi) continue;
    const prefix = doiPrefix(doi);
    const repo = REPO_PREFIXES[prefix];
    if (!repo) continue;
    const type = repo.type === "auto" ? classifyType(w.type || w.display_name || "") : repo.type;
    out.push({
      source: repo.name,
      type,
      title: w.display_name || doi,
      doi,
      url: `https://doi.org/${doi}`,
      repository: repo.name,
      confidence: 80
    });
  }
  return out;
}

async function fetchFigshare(doi, title) {
  const out = [];
  const prefix = doiPrefix(normDOI(doi || ""));
  if (doi && prefix === "10.6084") {
    const data = await safeFetch(`https://api.figshare.com/v2/articles/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search_for: `"${doi}"`, page_size: 10 })
    });
    if (data?.length) {
      for (const item of data) {
        const sim = title ? jaccard(title, item.title || "") : 0;
        if (title && sim < 0.7) continue;
        out.push({
          source: "Figshare",
          type: classifyType(item.defined_type_name || item.defined_type || ""),
          title: item.title || "Figshare item",
          doi: item.doi ? normDOI(item.doi) : "",
          url: item.url_public_html || (item.doi ? `https://doi.org/${normDOI(item.doi)}` : ""),
          repository: "Figshare",
          confidence: Math.max(60, Math.round(sim * 80))
        });
      }
    }
  }
  if (!out.length && title) {
    const q = shortTitle(title);
    if (q.length > 5) {
      const data = await safeFetch(`https://api.figshare.com/v2/articles/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search_for: q, page_size: 5 })
      });
      if (data?.length) {
      for (const item of data) {
        const sim = jaccard(title, item.title || "");
        if (sim < 0.7) continue;
        out.push({
            source: "Figshare",
            type: classifyType(item.defined_type_name || ""),
            title: item.title || "Figshare item",
            doi: item.doi ? normDOI(item.doi) : "",
            url: item.url_public_html || "",
            repository: "Figshare",
            confidence: Math.round(40 + sim * 40)
          });
        }
      }
    }
  }
  return out;
}

async function fetchPublisherDoiLinks(doi) {
  if (!doi) return [];
  const html = await safeFetchText(`https://doi.org/${encodeURIComponent(doi)}`, {
    headers: { "Accept": "text/html,application/xhtml+xml" }
  });
  if (!html) return [];
  const out = [];
  const re = /10\.(5281|6084|17605|7910|26008|15468)\/[^\s"<>]+/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = String(m[0]).replace(/[),.;]+$/g, "");
    const clean = normDOI(raw);
    const prefix = doiPrefix(clean);
    const repo = REPO_PREFIXES[prefix];
    if (!repo) continue;
    if (clean.includes("\\xa") || clean.includes("xa")) continue;
    out.push({
      source: "Publisher page",
      type: repo.type === "auto" ? "Dataset" : repo.type,
      title: clean,
      doi: clean,
      url: `https://doi.org/${clean}`,
      repository: repo.name,
      confidence: 70
    });
  }
  return out;
}

async function fetchGitHub(title, authors, doi) {
  const surname = firstAuthorSurname(authors);
  const st = shortTitle(title);
  if (!st && !surname) return [];
  const queryParts = [];
  if (st) queryParts.push(st);
  if (surname) queryParts.push(surname);
  const q = queryParts.join(" ").trim();
  if (q.length < 4) return [];

  const data = await safeFetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=5`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!data?.items?.length) return [];

  const out = [];
  for (const repo of data.items) {
    const repoText = `${repo.name} ${repo.description || ""}`;
    const sim = jaccard(title, repoText);
    const descHasDOI = doi && String(repo.description || "").includes(doi.split("/").pop());
    const score = descHasDOI ? 75 : Math.round(sim * 80);
    if (score < 30) continue;
    out.push({
      source: "GitHub",
      type: "Software",
      title: repo.full_name,
      doi: "",
      url: repo.html_url,
      repository: "GitHub",
      stars: repo.stargazers_count,
      language: repo.language || "",
      confidence: score
    });
  }
  return out;
}

async function fetchZenodoByTitle(title) {
  if (!title) return [];
  const q = shortTitle(title);
  if (q.length < 6) return [];

  const data = await safeFetch(`https://zenodo.org/api/records/?q=${encodeURIComponent(q)}&size=10&sort=mostrecent`);
  const hits = data?.hits?.hits;
  if (!hits?.length) return [];

  return hits
    .map(h => {
      const md = h.metadata || {};
      const sim = jaccard(title, md.title || "");
      const doiZ = md.doi || h.doi || "";
      return {
        source: "Zenodo",
        type: classifyType(String(md.resource_type?.type || "")),
        title: md.title || doiZ || "Zenodo record",
        doi: doiZ,
        url: h.links?.html || (doiZ ? `https://doi.org/${doiZ}` : ""),
        repository: "Zenodo",
        version: md.version || "",
        confidence: Math.round(sim * 70)
      };
    })
    .filter(x => x.confidence >= 30);
}

function dedup(items) {
  const seen = new Map();
  const out = [];
  for (const item of items) {
    const key = item.doi
      ? `doi:${normDOI(item.doi)}`
      : `url:${String(item.url || "").toLowerCase().replace(/\/$/, "")}`;
    if (!key || key === "doi:" || key === "url:") { out.push(item); continue; }
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      out.push(item);
    } else if (item.confidence > existing.confidence) {
      existing.confidence = item.confidence;
      existing.source = item.source;
    }
  }
  return out;
}

export async function resolveArtifacts({ doi, title, authors, openAlexId, minConfidence = 25 } = {}) {
  const cleanDOI = normDOI(doi || "");

  const [
    datacite,
    zenodoDOI,
    crossref,
    openalexCited,
    figshare,
    github,
    publisherDois
  ] = await Promise.all([
    fetchDataCite(cleanDOI),
    fetchZenodoByDOI(cleanDOI),
    fetchCrossrefRelations(cleanDOI),
    fetchOpenAlexCitedRepos(openAlexId || ""),
    fetchFigshare(cleanDOI, title || ""),
    fetchGitHub(title || "", authors || "", cleanDOI),
    fetchPublisherDoiLinks(cleanDOI)
  ]);

  let all = [
    ...datacite,
    ...zenodoDOI,
    ...crossref,
    ...openalexCited,
    ...figshare,
    ...github,
    ...publisherDois
  ];

  const hasHighConfidence = all.some(x => x.confidence >= 70);
  if (!hasHighConfidence && title) {
    const zenodoTitle = await fetchZenodoByTitle(title);
    all.push(...zenodoTitle);
  }

  all = all.filter(x => {
    if (!x.url && !x.doi) return false;
    if (x.url && !x.url.startsWith("http")) return false;
    return true;
  });

  all = dedup(all);
  all = all.filter(x => x.confidence >= minConfidence);

  const typeOrder = { Software: 0, Dataset: 1, Workflow: 2, Other: 3, Preprint: 4 };
  all.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (typeOrder[a.type] ?? 5) - (typeOrder[b.type] ?? 5);
  });

  return all.map(x => ({
    provenance: x.source || "Unknown",
    type: x.type || "Other",
    title: x.title || x.doi || x.url || "Untitled",
    doi: x.doi || "",
    url: x.url || (x.doi ? `https://doi.org/${x.doi}` : ""),
    repository: x.repository || "",
    version: x.version || "",
    licence: x.licence || "",
    confidence: x.confidence,
    ...(x.stars !== undefined ? { stars: x.stars, language: x.language || "" } : {})
  }));
}
