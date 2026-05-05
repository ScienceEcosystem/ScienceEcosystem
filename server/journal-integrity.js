import fetch from "node-fetch";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = "v3"; // bump whenever KNOWN_PREDATORY_* lists change
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

const KNOWN_PREDATORY_PUBLISHERS = [
  "magnus med club",
  "mmc",
  "omics international",
  "omics publishing",
  "medwin publishers",
  "sciforschenonline",
  "sci forschen",
  "longdom publishing",
  "hilavina",
  "crimson publishers",
  "lupine publishers",
  "austin publishing group",
  "medcrave",
  "gavin publishers",
  "remedy publications",
  "peertechz",
  "scholars.direct",
  "opast publishing",
  "annex publishers",
  "open access pub",
  "pulsus group",
  "herald scholarly open access",
  "scitechnol",
  "jscimedcentral",
  "symbiosisonlinepublishing",
  "imedpub",
  "innovare academic sciences",
  "rroij",
  "scientific research and community",
  "science domain international",
  "scielo predatory",
  "ejmanager"
];

const KNOWN_PREDATORY_DOMAINS = [
  "jcases.org",
  "jneonatal.com",
  "jdiabetic.com",
  "jclinical.com",
  "jdermis.com",
  "jobese.com",
  "jcatalytic.com",
  "magnusmedclub.com",
  "mmcemails.com",
  "omicsonline.org",
  "omicsonline.com",
  "longdom.org",
  "medcraveonline.com",
  "gavinpublishers.com",
  "remedypublications.com",
  "peertechz.com",
  "austinpublishinggroup.com",
  "lupinepublishers.com",
  "crimsonpublishers.com",
  "scitechnol.com",
  "imedpub.com",
  "hilarispublisher.com"
];

// ISSNs (digits only, no hyphen) for journals confirmed predatory.
// Bump CACHE_VERSION above whenever this list changes.
const KNOWN_PREDATORY_ISSNS = [
  "28361555" // Cases (jcases.org) — Magnus Med Club; OpenAlex S4387288622
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

function cacheKeyFor({ issn, issnL, journalName, openAlexSourceId, homepageUrl }) {
  const parts = [CACHE_VERSION];
  const normalizedIssn = normalizeIssn(issn);
  const normalizedIssnL = normalizeIssn(issnL);
  const normalizedName = normalizeText(journalName);
  const normalizedSourceId = String(openAlexSourceId || "").trim().toUpperCase();
  const normalizedHomepage = extractHostname(homepageUrl || "");

  if (normalizedIssn) parts.push(`issn:${normalizedIssn}`);
  if (normalizedIssnL) parts.push(`issnl:${normalizedIssnL}`);
  if (normalizedName) parts.push(`name:${normalizedName}`);
  if (normalizedSourceId) parts.push(`source:${normalizedSourceId}`);
  if (normalizedHomepage) parts.push(`host:${normalizedHomepage}`);

  return parts.join("|");
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
  if (Number(result && result.checksCompleted) < 2) return;
  integrityCache.set(key, {
    savedAt: Date.now(),
    result: { ...result }
  });
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function clearJournalIntegrityCache() {
  integrityCache.clear();
}

function verdictForScore(score) {
  if (score >= 75) return { verdict: "trusted", label: "Appears legitimate" };
  if (score >= 50) return { verdict: "caution", label: "Use caution" };
  if (score >= 25) return { verdict: "suspicious", label: "Likely predatory or low-quality" };
  return { verdict: "predatory", label: "High risk - possible predatory journal" };
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

function extractHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_err) {
    return "";
  }
}

async function safeFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ScienceEcosystem/1.0",
        ...(options.headers || {})
      }
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.json();
  } catch (_err) {
    clearTimeout(timer);
    return null;
  }
}

async function safeFetchText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ScienceEcosystem/1.0" }
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    return await response.text();
  } catch (_err) {
    clearTimeout(timer);
    return null;
  }
}

async function checkDOAJ(issn, issnL, journalName) {
  try {
    const tryISSN = async (id) => {
      if (!id) return null;
      const clean = id.replace(/[^0-9X]/gi, "");
      if (clean.length < 7) return null;
      const formatted = clean.slice(0, 4) + "-" + clean.slice(4);
      const url = "https://doaj.org/api/search/journals/issn:" + formatted;
      const result = await safeFetch(url, {}, 8000);
      return result && Array.isArray(result.results) && result.results.length > 0 ? result.results[0] : null;
    };

    let result = (await tryISSN(issn)) || (await tryISSN(issnL));

    if (result) {
      const doajName = String(result.bibjson && result.bibjson.title || "").toLowerCase();
      const ourName = String(journalName || "").toLowerCase();
      const ourWords = ourName.split(/\s+/).filter((word) => word.length > 3);
      const nameMatches = ourWords.length ? ourWords.some((word) => doajName.includes(word)) : false;
      if (!nameMatches) {
        result = null;
      }
    }

    if (!result && journalName && journalName.length > 4) {
      const url = "https://doaj.org/api/search/journals/" + encodeURIComponent(`"${journalName}"`);
      const response = await safeFetch(url, {}, 8000);
      if (response && Array.isArray(response.results) && response.results.length > 0) {
        const match = response.results.find((journal) => {
          const doajTitle = String(journal.bibjson && journal.bibjson.title || "").toLowerCase();
          const ourTitle = String(journalName || "").toLowerCase();
          return doajTitle === ourTitle || doajTitle.includes(ourTitle) || ourTitle.includes(doajTitle);
        });
        result = match || null;
      }
    }

    const attempted = !!(issn || issnL || journalName);
    return { checked: attempted, inDOAJ: !!result, doajRecord: result || null };
  } catch (_err) {
    return { checked: false, inDOAJ: false, doajRecord: null };
  }
}

async function fetchPredatoryLists() {
  const [publishersRaw, journalsRaw] = await Promise.all([
    safeFetchText("https://raw.githubusercontent.com/stop-predatory-journals/stop-predatory-journals.github.io/master/_data/publishers.yaml"),
    safeFetchText("https://raw.githubusercontent.com/stop-predatory-journals/stop-predatory-journals.github.io/master/_data/journals.yaml")
  ]);

  const extractNames = (raw) => {
    if (!raw) return [];
    return raw
      .split("\n")
      .map((line) => {
        const nameMatch = line.match(/(?:name|title):\s*["']?([^"'\n]+)["']?/i);
        if (nameMatch) return nameMatch[1].trim().toLowerCase();
        const bareMatch = line.match(/^\s*-\s+["']?([^"'\n]+)["']?/);
        if (bareMatch && !bareMatch[1].startsWith("url:") && !bareMatch[1].startsWith("http")) {
          return bareMatch[1].trim().toLowerCase();
        }
        return null;
      })
      .filter(Boolean);
  };

  const extractURLs = (raw) => {
    if (!raw) return [];
    return raw
      .split("\n")
      .map((line) => {
        const urlMatch = line.match(/url:\s*["']?(https?:\/\/[^\s"']+)["']?/i);
        if (urlMatch) return urlMatch[1].trim().toLowerCase();
        return null;
      })
      .filter(Boolean);
  };

  return {
    publisherNames: extractNames(publishersRaw),
    publisherURLs: extractURLs(publishersRaw),
    journalNames: extractNames(journalsRaw),
    journalURLs: extractURLs(journalsRaw)
  };
}

async function checkOpenAlex({ openAlexSourceId }) {
  try {
    if (!openAlexSourceId) {
      return {
        checked: false,
        openAlex: { ...DEFAULT_OPENALEX },
        publisherName: "",
        homepageUrl: ""
      };
    }

    const data = await safeFetch(
      `https://api.openalex.org/sources/${encodeURIComponent(openAlexSourceId)}?mailto=info@scienceecosystem.org`,
      {},
      8000
    );

    if (!data || typeof data !== "object") {
      return {
        checked: false,
        openAlex: { ...DEFAULT_OPENALEX },
        publisherName: "",
        homepageUrl: ""
      };
    }

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
      },
      publisherName: String(data.host_organization_name || data.host_organization || data.publisher || ""),
      homepageUrl: String(data.homepage_url || "")
    };
  } catch (_err) {
    return {
      checked: false,
      openAlex: { ...DEFAULT_OPENALEX },
      publisherName: "",
      homepageUrl: ""
    };
  }
}

async function checkPredatoryList({ journalName, homepageUrl, openAlexPromise, issn, issnL }) {
  try {
    // Fast path: ISSN in hardcoded list (no network needed)
    const normIssn = normalizeIssn(issn);
    const normIssnL = normalizeIssn(issnL);
    const issnHit = KNOWN_PREDATORY_ISSNS.find(
      (i) => (normIssn && normIssn === i) || (normIssnL && normIssnL === i)
    );
    if (issnHit) {
      return { checked: true, onPredatoryList: true, predatoryListSource: "issn-hardcoded", publisherName: "", homepageUrl };
    }

    const [lists, openAlexResult] = await Promise.all([
      fetchPredatoryLists(),
      openAlexPromise
    ]);

    const publisherName = String(openAlexResult && openAlexResult.publisherName || "");
    const resolvedHomepageUrl = String(
      (openAlexResult && openAlexResult.homepageUrl) || homepageUrl || ""
    ).toLowerCase();
    const homepageDomain = extractHostname(resolvedHomepageUrl);
    const normalizedPublisher = normalizeText(publisherName);
    const normalizedJournal = normalizeText(journalName);

    const publisherYamlMatch = normalizedPublisher
      ? lists.publisherNames.some((name) => normalizedPublisher.includes(name) || name.includes(normalizedPublisher))
      : false;
    const journalYamlMatch = normalizedJournal
      ? lists.journalNames.some((name) => normalizedJournal.includes(name) || name.includes(normalizedJournal))
      : false;
    const publisherUrlMatch = resolvedHomepageUrl
      ? lists.publisherURLs.some((url) => resolvedHomepageUrl.includes(url))
      : false;
    const journalUrlMatch = resolvedHomepageUrl
      ? lists.journalURLs.some((url) => resolvedHomepageUrl.includes(url))
      : false;

    const hardcodedPublisher = normalizedPublisher
      ? KNOWN_PREDATORY_PUBLISHERS.find((name) => normalizedPublisher.includes(name) || name.includes(normalizedPublisher))
      : null;
    const hardcodedDomain = homepageDomain
      ? KNOWN_PREDATORY_DOMAINS.find((domain) => homepageDomain === domain || homepageDomain.endsWith("." + domain))
      : null;

    if (hardcodedPublisher) {
      return {
        checked: true,
        onPredatoryList: true,
        predatoryListSource: "publisher-hardcoded",
        publisherName,
        homepageUrl
      };
    }

    if (hardcodedDomain) {
      return {
        checked: true,
        onPredatoryList: true,
        predatoryListSource: "domain-hardcoded",
        publisherName,
        homepageUrl: resolvedHomepageUrl
      };
    }

    if (publisherYamlMatch || publisherUrlMatch) {
      return {
        checked: true,
        onPredatoryList: true,
        predatoryListSource: "publisher",
        publisherName,
        homepageUrl: resolvedHomepageUrl
      };
    }

    if (journalYamlMatch || journalUrlMatch) {
      return {
        checked: true,
        onPredatoryList: true,
        predatoryListSource: "journal",
        publisherName,
        homepageUrl: resolvedHomepageUrl
      };
    }

    return {
      checked: true,
      onPredatoryList: false,
      predatoryListSource: null,
      publisherName,
      homepageUrl: resolvedHomepageUrl
    };
  } catch (_err) {
    return {
      checked: false,
      onPredatoryList: false,
      predatoryListSource: null,
      publisherName: "",
      homepageUrl: ""
    };
  }
}

async function checkNameSimilarity({ journalName, inDOAJ }) {
  try {
    const normalizedJournal = normalizeText(journalName);
    if (!normalizedJournal) {
      return { checked: false, namesMimicsLegitimate: false, mimickedJournal: null };
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
    const namesMimicsLegitimate = !!(bestScore >= 0.4 && !inDOAJ && !isRealJournal && bestJournal);

    return {
      checked: true,
      namesMimicsLegitimate,
      mimickedJournal: namesMimicsLegitimate ? bestJournal : null
    };
  } catch (_err) {
    return { checked: false, namesMimicsLegitimate: false, mimickedJournal: null };
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

export async function checkJournalIntegrity({ issn, issnL, journalName, openAlexSourceId, homepageUrl }) {
  const key = cacheKeyFor({ issn, issnL, journalName, openAlexSourceId, homepageUrl });
  const cached = getCachedResult(key);
  if (cached) return cached;

  const openAlexPromise = checkOpenAlex({ openAlexSourceId });
  const doajPromise = checkDOAJ(issn, issnL, journalName);
  const predatoryPromise = checkPredatoryList({ journalName, homepageUrl, openAlexPromise, issn, issnL });
  const retractionPromise = buildRetractionWatchLink({ journalName });

  const [openAlexResult, doajResult, predatoryResult, retractionResult] = await Promise.all([
    openAlexPromise,
    doajPromise,
    predatoryPromise,
    retractionPromise
  ]);

  const similarityResult = await checkNameSimilarity({
    journalName,
    inDOAJ: !!doajResult.inDOAJ
  });

  const checksCompleted = [
    doajResult.checked,
    predatoryResult.checked,
    openAlexResult.checked,
    similarityResult.checked,
    retractionResult.checked
  ].filter(Boolean).length;

  const inDOAJ = !!doajResult.inDOAJ;
  const onPredatoryList = !!predatoryResult.onPredatoryList;
  const predatoryListSource = predatoryResult.predatoryListSource || null;
  const namesMimicsLegitimate = !!similarityResult.namesMimicsLegitimate;
  const mimickedJournal = similarityResult.mimickedJournal || null;
  const publisherName = predatoryResult.publisherName || openAlexResult.publisherName || "";
  const openAlex = openAlexResult.openAlex || { ...DEFAULT_OPENALEX };

  const flags = [];
  let score = 100;

  if (doajResult.checked && !inDOAJ) {
    score -= 40;
    flags.push("Journal not found in DOAJ.");
  }

  if (predatoryResult.checked && onPredatoryList && predatoryListSource === "journal") {
    score -= 50;
    flags.push("Journal appears on predatory journal lists.");
  }

  if (predatoryResult.checked && onPredatoryList && predatoryListSource === "publisher") {
    score -= 40;
    flags.push(`Publisher (${publisherName || "Unknown"}) appears on predatory publisher lists.`);
  }

  if (predatoryResult.checked && onPredatoryList && predatoryListSource === "publisher-hardcoded") {
    score -= 55;
    flags.push(`Publisher (${publisherName || "Unknown"}) appears on predatory publisher lists.`);
  }

  if (predatoryResult.checked && onPredatoryList && predatoryListSource === "domain-hardcoded") {
    score -= 55;
    flags.push("Journal homepage uses a domain associated with predatory publishers.");
  }

  if (predatoryResult.checked && onPredatoryList && predatoryListSource === "issn-hardcoded") {
    score -= 60;
    flags.push("Journal ISSN matches a known predatory journal.");
  }

  if (openAlexResult.checked && openAlex.avgCitationsPerPaper < 0.1 && openAlex.works_count > 10) {
    score -= 30;
    flags.push("Very low citation rate relative to publication volume.");
  } else if (openAlexResult.checked && openAlex.avgCitationsPerPaper < 0.5 && openAlex.works_count > 20) {
    score -= 20;
    flags.push("Low citation rate relative to publication volume.");
  }

  if (openAlexResult.checked && openAlex.isNewJournal && doajResult.checked && !inDOAJ) {
    score -= 10;
    flags.push("Newer journal without DOAJ indexing.");
  }

  if (
    openAlexResult.checked &&
    openAlex.type === "journal" &&
    openAlex.works_count > 10 &&
    (openAlex.cited_by_count / Math.max(openAlex.works_count, 1)) < 0.3 &&
    doajResult.checked &&
    !inDOAJ
  ) {
    score -= 15;
    flags.push("Journal has weak citation performance for its size and is not indexed in DOAJ.");
  }

  if (namesMimicsLegitimate) {
    score -= 20;
    flags.push(`Journal name may mimic "${mimickedJournal}".`);
  }

  if (openAlexResult.checked && (openAlex.type === "repository" || openAlex.type === "preprint")) {
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
    checkedAt: new Date().toISOString(),
    checksCompleted
  };

  setCachedResult(key, result);
  return result;
}
