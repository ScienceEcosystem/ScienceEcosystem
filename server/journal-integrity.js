import fetch from "node-fetch";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const integrityCache = new Map();

const LEGITIMATE_JOURNALS = [
  "Nature",
  "Science",
  "Cell",
  "The Lancet",
  "JAMA",
  "NEJM",
  "PLOS ONE",
  "Scientific Reports",
  "PNAS",
  "BMJ",
  "PLOS Biology",
  "eLife"
];

const DEFAULT_OPENALEX = {
  works_count: 0,
  cited_by_count: 0,
  avgCitationsPerPaper: 0,
  isNewJournal: false,
  is_in_doaj: false,
  is_oa: false,
  type: "",
  apc_usd: null,
  country_code: null
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeIssn(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^0-9X]/g, "");
}

function tokenize(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(/\s+/).filter(Boolean) : [];
}

function jaccardSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union ? intersection / union : 0;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function cacheKeyFor({ issn, issnL, journalName, openAlexSourceId }) {
  return (
    normalizeIssn(issn) ||
    normalizeIssn(issnL) ||
    normalizeText(journalName) ||
    String(openAlexSourceId || "").trim().toUpperCase()
  );
}

function getCachedResult(key) {
  if (!key) return null;
  const hit = integrityCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > CACHE_TTL_MS) {
    integrityCache.delete(key);
    return null;
  }
  return { ...hit.result, cached: true };
}

function setCachedResult(key, result) {
  if (!key) return;
  integrityCache.set(key, {
    savedAt: Date.now(),
    result: { ...result }
  });
}

function extractDoajCount(payload) {
  if (!payload || typeof payload !== "object") return 0;
  if (typeof payload.total === "number") return payload.total;
  if (typeof payload.count === "number") return payload.count;
  if (typeof payload.totalResults === "number") return payload.totalResults;
  if (Array.isArray(payload.results)) return payload.results.length;
  if (Array.isArray(payload.hits)) return payload.hits.length;
  if (payload.results && typeof payload.results === "object" && Array.isArray(payload.results.items)) {
    return payload.results.items.length;
  }
  return 0;
}

async function checkDoaj({ issn, issnL, journalName }) {
  try {
    const urls = [];
    if (issn) urls.push(`https://doaj.org/api/search/journals/issn:${encodeURIComponent(issn)}`);
    if (issnL && normalizeIssn(issnL) !== normalizeIssn(issn)) {
      urls.push(`https://doaj.org/api/search/journals/issn:${encodeURIComponent(issnL)}`);
    }
    if (journalName) {
      urls.push(`https://doaj.org/api/search/journals/${encodeURIComponent(journalName)}`);
    }
    for (const url of urls) {
      const response = await fetchWithTimeout(url, {
        headers: { Accept: "application/json" }
      });
      const data = await response.json();
      if (extractDoajCount(data) > 0) {
        return { checked: true, inDOAJ: true };
      }
    }
    return { checked: urls.length > 0, inDOAJ: false };
  } catch (_err) {
    return { checked: false, inDOAJ: false };
  }
}

function parseSimpleYamlRecords(yamlText) {
  const records = [];
  let current = null;

  for (const rawLine of String(yamlText || "").split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^- /.test(trimmed)) {
      if (current && Object.keys(current).length) records.push(current);
      current = {};
      const rest = trimmed.slice(2).trim();
      if (!rest) continue;
      const kv = rest.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
      if (kv) {
        current[kv[1].trim()] = kv[2].trim();
      } else {
        current.value = rest;
      }
      continue;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
    if (!kv) continue;
    if (!current) current = {};
    current[kv[1].trim()] = kv[2].trim();
  }

  if (current && Object.keys(current).length) records.push(current);
  return records;
}

function recordMatches(record, journalName, issnSet) {
  const normalizedJournal = normalizeText(journalName);
  const exactNames = new Set();
  const partialNames = new Set();
  const recordIssns = new Set();

  for (const [key, value] of Object.entries(record || {})) {
    const textValue = String(value || "").trim();
    if (!textValue) continue;
    const normalizedValue = normalizeText(textValue);
    const issnValue = normalizeIssn(textValue);
    const keyName = normalizeText(key);

    if (issnValue && /^[0-9]{7}[0-9X]$/.test(issnValue)) {
      recordIssns.add(issnValue);
    }
    if (normalizedValue) {
      partialNames.add(normalizedValue);
      if (keyName === "name" || keyName === "journal" || keyName === "title" || keyName === "publisher") {
        exactNames.add(normalizedValue);
      }
    }
  }

  if (normalizedJournal) {
    if (exactNames.has(normalizedJournal)) return true;
    for (const candidate of partialNames) {
      if (candidate === normalizedJournal) return true;
      if (candidate.includes(normalizedJournal) || normalizedJournal.includes(candidate)) return true;
    }
  }

  for (const issn of issnSet) {
    if (recordIssns.has(issn)) return true;
  }

  return false;
}

async function checkPredatoryList({ issn, issnL, journalName }) {
  try {
    const [publishersRes, journalsRes] = await Promise.all([
      fetchWithTimeout("https://raw.githubusercontent.com/stop-predatory-journals/stop-predatory-journals.github.io/master/_data/publishers.yaml"),
      fetchWithTimeout("https://raw.githubusercontent.com/stop-predatory-journals/stop-predatory-journals.github.io/master/_data/journals.yaml")
    ]);
    const [publishersText, journalsText] = await Promise.all([
      publishersRes.text(),
      journalsRes.text()
    ]);

    const publisherRecords = parseSimpleYamlRecords(publishersText);
    const journalRecords = parseSimpleYamlRecords(journalsText);
    const issnSet = new Set([normalizeIssn(issn), normalizeIssn(issnL)].filter(Boolean));

    if (journalRecords.some((record) => recordMatches(record, journalName, issnSet))) {
      return { checked: true, onPredatoryList: true, predatoryListSource: "journal" };
    }
    if (publisherRecords.some((record) => recordMatches(record, journalName, issnSet))) {
      return { checked: true, onPredatoryList: true, predatoryListSource: "publisher" };
    }
    return { checked: true, onPredatoryList: false, predatoryListSource: null };
  } catch (_err) {
    return { checked: false, onPredatoryList: false, predatoryListSource: null };
  }
}

function extractApcUsd(sourceData) {
  if (!sourceData || typeof sourceData !== "object") return null;
  const direct = sourceData.apc_usd;
  if (typeof direct === "number") return direct;
  const nested = sourceData.apc_list && sourceData.apc_list.value_usd;
  if (typeof nested === "number") return nested;
  return null;
}

function computeIsNewJournal(countsByYear) {
  const rows = Array.isArray(countsByYear) ? countsByYear : [];
  if (!rows.length) return false;
  return !rows.some((row) => Number(row && row.year) < 2018);
}

async function checkOpenAlex({ openAlexSourceId }) {
  try {
    if (!openAlexSourceId) {
      return { checked: false, openAlex: { ...DEFAULT_OPENALEX } };
    }
    const response = await fetchWithTimeout(
      `https://api.openalex.org/sources/${encodeURIComponent(openAlexSourceId)}?mailto=info@scienceecosystem.org`,
      { headers: { Accept: "application/json" } }
    );
    const data = await response.json();
    const worksCount = Number(data.works_count || 0);
    const citedByCount = Number(data.cited_by_count || 0);
    return {
      checked: true,
      openAlex: {
        works_count: worksCount,
        cited_by_count: citedByCount,
        avgCitationsPerPaper: citedByCount / Math.max(worksCount, 1),
        isNewJournal: computeIsNewJournal(data.counts_by_year),
        is_in_doaj: !!data.is_in_doaj,
        is_oa: !!data.is_oa,
        type: String(data.type || ""),
        apc_usd: extractApcUsd(data),
        country_code: data.country_code || null
      }
    };
  } catch (_err) {
    return { checked: false, openAlex: { ...DEFAULT_OPENALEX } };
  }
}

async function checkNameSimilarity({ journalName }) {
  try {
    const normalizedJournal = normalizeText(journalName);
    if (!normalizedJournal) {
      return { checked: true, similarity: 0, mimickedJournal: null, isRealJournal: false };
    }
    let bestScore = 0;
    let bestJournal = null;
    for (const journal of LEGITIMATE_JOURNALS) {
      const score = jaccardSimilarity(journalName, journal);
      if (score > bestScore) {
        bestScore = score;
        bestJournal = journal;
      }
    }
    const isRealJournal = LEGITIMATE_JOURNALS.some((journal) => normalizeText(journal) === normalizedJournal);
    return {
      checked: true,
      similarity: bestScore,
      mimickedJournal: bestJournal,
      isRealJournal
    };
  } catch (_err) {
    return { checked: false, similarity: 0, mimickedJournal: null, isRealJournal: false };
  }
}

async function buildRetractionWatchLink({ journalName }) {
  try {
    return {
      checked: true,
      retractionWatchUrl: `https://retractionwatch.com/?s=${encodeURIComponent(journalName || "")}`
    };
  } catch (_err) {
    return {
      checked: false,
      retractionWatchUrl: "https://retractionwatch.com/"
    };
  }
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function verdictForScore(score) {
  if (score >= 75) return { verdict: "trusted", label: "Appears legitimate" };
  if (score >= 50) return { verdict: "caution", label: "Use caution" };
  if (score >= 25) return { verdict: "suspicious", label: "Likely predatory or low-quality" };
  return { verdict: "predatory", label: "High risk — possible predatory journal" };
}

export async function checkJournalIntegrity({ issn, issnL, journalName, openAlexSourceId }) {
  const key = cacheKeyFor({ issn, issnL, journalName, openAlexSourceId });
  const cached = getCachedResult(key);
  if (cached) return cached;

  const [doajResult, predatoryResult, openAlexResult, similarityResult, retractionResult] = await Promise.all([
    checkDoaj({ issn, issnL, journalName }),
    checkPredatoryList({ issn, issnL, journalName }),
    checkOpenAlex({ openAlexSourceId }),
    checkNameSimilarity({ journalName }),
    buildRetractionWatchLink({ journalName })
  ]);

  const inDOAJ = !!doajResult.inDOAJ;
  const onPredatoryList = !!predatoryResult.onPredatoryList;
  const predatoryListSource = predatoryResult.predatoryListSource || null;
  const openAlex = openAlexResult.openAlex || { ...DEFAULT_OPENALEX };

  const namesMimicsLegitimate = !!(
    similarityResult.checked &&
    doajResult.checked &&
    similarityResult.similarity >= 0.4 &&
    !inDOAJ &&
    !similarityResult.isRealJournal &&
    similarityResult.mimickedJournal
  );
  const mimickedJournal = namesMimicsLegitimate ? similarityResult.mimickedJournal : null;

  const flags = [];
  let score = 100;

  if (doajResult.checked && !inDOAJ) {
    score -= 35;
    flags.push("Journal not found in DOAJ.");
  }
  if (predatoryResult.checked && onPredatoryList && predatoryListSource === "journal") {
    score -= 50;
    flags.push("Journal appears on the Stop Predatory Journals journal list.");
  }
  if (predatoryResult.checked && onPredatoryList && predatoryListSource === "publisher") {
    score -= 40;
    flags.push("Journal or publisher appears on the Stop Predatory Journals publisher list.");
  }
  if (
    openAlexResult.checked &&
    openAlex.avgCitationsPerPaper < 0.5 &&
    openAlex.works_count > 50
  ) {
    score -= 15;
    flags.push("Low citation rate relative to publication volume.");
  }
  if (openAlexResult.checked && openAlex.isNewJournal && doajResult.checked && !inDOAJ) {
    score -= 10;
    flags.push("Newer journal without DOAJ indexing.");
  }
  if (namesMimicsLegitimate) {
    score -= 20;
    flags.push(`Journal name may mimic "${mimickedJournal}".`);
  }
  if (
    openAlexResult.checked &&
    (openAlex.type === "repository" || openAlex.type === "preprint")
  ) {
    score -= 5;
    flags.push("Venue is a repository or preprint source rather than a conventional journal.");
  }

  if (doajResult.checked && inDOAJ) {
    score += 20;
  }
  if (openAlexResult.checked && openAlex.is_in_doaj) {
    score += 10;
  }
  if (openAlexResult.checked && openAlex.avgCitationsPerPaper > 5) {
    score += 10;
  }
  if (openAlexResult.checked && openAlex.works_count > 10000) {
    score += 5;
  }

  const finalScore = clampScore(score);
  const verdictMeta = verdictForScore(finalScore);

  const result = {
    score: finalScore,
    verdict: verdictMeta.verdict,
    label: verdictMeta.label,
    inDOAJ,
    onPredatoryList,
    predatoryListSource,
    namesMimicsLegitimate,
    mimickedJournal,
    retractionWatchUrl: retractionResult.retractionWatchUrl || "https://retractionwatch.com/",
    openAlex: {
      works_count: Number(openAlex.works_count || 0),
      cited_by_count: Number(openAlex.cited_by_count || 0),
      avgCitationsPerPaper: Number(openAlex.avgCitationsPerPaper || 0),
      isNewJournal: !!openAlex.isNewJournal,
      is_in_doaj: !!openAlex.is_in_doaj,
      is_oa: !!openAlex.is_oa,
      type: String(openAlex.type || ""),
      apc_usd: openAlex.apc_usd == null ? null : Number(openAlex.apc_usd),
      country_code: openAlex.country_code || null
    },
    flags,
    checkedAt: new Date().toISOString()
  };

  setCachedResult(key, result);
  return result;
}
