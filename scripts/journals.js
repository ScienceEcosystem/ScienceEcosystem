/* Journal Selection Guide */
let journalCatalog = [
  // General / high-prestige
  { id: "nature", name: "Nature", discipline: "Multidisciplinary", articleTypes: ["Research", "Short"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Deliberate", ambition: "High", summary: "Flagship multidisciplinary journal with stringent novelty bar.", strengths: ["Prestige", "Broad reach", "News coverage"], bestFor: "Field-defining advances across science.", avoidIf: "Incremental work or narrow scope.", publisher: "Springer Nature", link: "https://www.nature.com/" },
  { id: "science", name: "Science", discipline: "Multidisciplinary", articleTypes: ["Research", "Short"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Deliberate", ambition: "High", summary: "Top multidisciplinary journal with high selectivity.", strengths: ["Prestige", "Broad audience", "Rapid news pickup"], bestFor: "Breakthroughs of broad scientific interest.", avoidIf: "Specialized or incremental studies.", publisher: "AAAS", link: "https://www.science.org/" },
  { id: "cell", name: "Cell", discipline: "Biology", articleTypes: ["Research", "Short"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Deliberate", ambition: "High", summary: "Flagship life sciences journal.", strengths: ["High impact", "Strong editorial guidance", "Wide reach"], bestFor: "Major advances in molecular and cellular biology.", avoidIf: "Preliminary or narrow-scope biology.", publisher: "Cell Press (Elsevier)", link: "https://www.cell.com/cell" },

  // Strong mid-tier / broad OA
  { id: "nature-communications", name: "Nature Communications", discipline: "Multidisciplinary", articleTypes: ["Research"], oaPolicy: "OA", apcBand: "Over3500", speed: "Moderate", ambition: "Solid", summary: "Open access multidisciplinary journal with strong reach.", strengths: ["OA visibility", "Broad scope", "Good editorial standards"], bestFor: "Robust studies with cross-field interest.", avoidIf: "Very niche topics.", publisher: "Springer Nature", link: "https://www.nature.com/ncomms/" },
  { id: "science-advances", name: "Science Advances", discipline: "Multidisciplinary", articleTypes: ["Research"], oaPolicy: "OA", apcBand: "Over3500", speed: "Moderate", ambition: "Solid", summary: "Open access sibling of Science.", strengths: ["OA", "Broad readership", "Stringent review"], bestFor: "Strong multidisciplinary studies with clear advance.", avoidIf: "Preliminary results.", publisher: "AAAS", link: "https://www.science.org/journal/sciadv" },
  { id: "pnas", name: "PNAS", discipline: "Multidisciplinary", articleTypes: ["Research", "Short"], oaPolicy: "Hybrid", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "Well-known multidisciplinary journal with society backing.", strengths: ["Broad readership", "Society journal", "Reasonable timelines"], bestFor: "Solid advances with broad relevance.", avoidIf: "Very niche topics.", publisher: "National Academy of Sciences", link: "https://www.pnas.org/" },
  { id: "pnas-nexus", name: "PNAS Nexus", discipline: "Multidisciplinary", articleTypes: ["Research", "Short"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "OA sister journal of PNAS with interdisciplinary focus.", strengths: ["OA", "Interdisciplinary", "NAS-backed"], bestFor: "Interdisciplinary studies needing OA.", avoidIf: "Ultra-prestige goals.", publisher: "Oxford University Press / NAS", link: "https://academic.oup.com/pnasnexus" },
  { id: "eLife", name: "eLife", discipline: "Biology", articleTypes: ["Research", "Short"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Fast", ambition: "Solid", summary: "Community-reviewed life sciences journal with transparent review.", strengths: ["OA", "Transparent review", "Constructive feedback"], bestFor: "Strong biology with commitment to open peer review.", avoidIf: "Authors uncomfortable with transparent review.", publisher: "eLife Sciences", link: "https://elifesciences.org/" },
  { id: "plos-biology", name: "PLOS Biology", discipline: "Biology", articleTypes: ["Research", "Short"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "Selective OA biology journal covering broad life sciences.", strengths: ["OA", "Broad biology scope", "Transparent policies"], bestFor: "Robust biology studies needing OA.", avoidIf: "Highly specialized subfields.", publisher: "PLOS", link: "https://journals.plos.org/plosbiology/" },
  { id: "plos-medicine", name: "PLOS Medicine", discipline: "Medicine", articleTypes: ["Research", "Review"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "OA clinical and public health research.", strengths: ["OA", "Global health focus", "Transparent policies"], bestFor: "Clinical/public health studies needing OA.", avoidIf: "Highly technical subspecialty case reports.", publisher: "PLOS", link: "https://journals.plos.org/plosmedicine/" },
  { id: "plos-one", name: "PLOS ONE", discipline: "Multidisciplinary", articleTypes: ["Research", "Data"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Fast", ambition: "Rapid", summary: "Soundness-only peer review across disciplines.", strengths: ["OA", "Soundness focus", "Broad scope"], bestFor: "Methodologically solid studies regardless of novelty.", avoidIf: "Seeking novelty-driven prestige.", publisher: "PLOS", link: "https://journals.plos.org/plosone/" },
  { id: "patterns", name: "Patterns", discipline: "Data/AI", articleTypes: ["Research", "Data", "Methods", "Review"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "OA journal for data science, AI, and reusable resources.", strengths: ["OA", "Data/method focus", "Broad AI scope"], bestFor: "AI/data papers with reusable datasets or methods.", avoidIf: "Non-data-driven humanities.", publisher: "Cell Press (Elsevier)", link: "https://www.cell.com/patterns" },
  { id: "jmlr", name: "Journal of Machine Learning Research", discipline: "Computer Science", articleTypes: ["Research", "Methods"], oaPolicy: "OA", apcBand: "None", speed: "Deliberate", ambition: "Solid", summary: "Respected ML journal, fully OA with no APC.", strengths: ["No APC", "Strong reputation", "Deep technical papers"], bestFor: "Substantive ML theory and methods.", avoidIf: "Short application notes.", publisher: "Microtome Publishing", link: "https://www.jmlr.org/" },
  { id: "tmlr", name: "Transactions on Machine Learning Research", discipline: "Computer Science", articleTypes: ["Research", "Methods"], oaPolicy: "OA", apcBand: "None", speed: "Moderate", ambition: "Solid", summary: "Community-reviewed ML venue with rolling review and no APC.", strengths: ["No APC", "Rolling review", "Transparent process"], bestFor: "ML research needing community feedback and OA.", avoidIf: "Very short application notes.", publisher: "Community-led", link: "https://jmlr.org/tmlr/" },
  { id: "nature-machine-intelligence", name: "Nature Machine Intelligence", discipline: "Computer Science", articleTypes: ["Research", "Review"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Moderate", ambition: "High", summary: "Applied and fundamental AI research with high bar.", strengths: ["Prestige", "Applied AI focus", "Broad readership"], bestFor: "High-impact AI studies with broad appeal.", avoidIf: "Incremental benchmarks only.", publisher: "Springer Nature", link: "https://www.nature.com/natmachintell/" },

  // Medicine / clinical
  { id: "nejm", name: "New England Journal of Medicine", discipline: "Medicine", articleTypes: ["Research", "Review", "Case"], oaPolicy: "Closed", apcBand: "None", speed: "Deliberate", ambition: "High", summary: "Top clinical medicine journal with stringent review.", strengths: ["Prestige", "Clinical reach", "Rigorous review"], bestFor: "Practice-changing clinical trials and guidelines.", avoidIf: "Observational studies without major impact.", publisher: "NEJM Group", link: "https://www.nejm.org/" },
  { id: "lancet", name: "The Lancet", discipline: "Medicine", articleTypes: ["Research", "Review"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Moderate", ambition: "High", summary: "High-profile general medical journal.", strengths: ["Prestige", "Global health reach", "Fast-track options"], bestFor: "High-impact clinical studies with global relevance.", avoidIf: "Niche subspecialty work.", publisher: "Elsevier", link: "https://www.thelancet.com/" },
  { id: "jama", name: "JAMA", discipline: "Medicine", articleTypes: ["Research", "Review"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Moderate", ambition: "High", summary: "Major US medical journal.", strengths: ["Prestige", "Clinical audience", "Editorial support"], bestFor: "Practice-influencing clinical research.", avoidIf: "Preliminary or single-center only.", publisher: "AMA", link: "https://jamanetwork.com/journals/jama" },
  { id: "bmj", name: "The BMJ", discipline: "Medicine", articleTypes: ["Research", "Review"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Moderate", ambition: "Solid", summary: "General medical journal with openness to methods and policy.", strengths: ["Broad clinical reach", "Open science friendly", "Policy focus"], bestFor: "Clinical studies with clear practice implications.", avoidIf: "Highly technical subspecialty.", publisher: "BMJ", link: "https://www.bmj.com/" },
  { id: "medrxiv-journal", name: "medRxiv overlays (e.g., eClinicalMedicine)", discipline: "Medicine", articleTypes: ["Research", "Short"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Fast", ambition: "Rapid", summary: "Faster OA clinical venues tied to preprints.", strengths: ["Rapid decisions", "OA", "Preprint-friendly"], bestFor: "Clinical studies needing rapid dissemination with peer review.", avoidIf: "Top-prestige targets.", publisher: "Elsevier / others", link: "https://www.thelancet.com/eclinicalmedicine" },

  // Biology subfields
  { id: "nature-genetics", name: "Nature Genetics", discipline: "Biology", articleTypes: ["Research", "Short"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Deliberate", ambition: "High", summary: "Top journal for genetics and genomics.", strengths: ["Prestige", "Broad genetics audience"], bestFor: "High-impact genetics and genomics studies.", avoidIf: "Narrow or preliminary results.", publisher: "Springer Nature", link: "https://www.nature.com/ng/" },
  { id: "genome-biology", name: "Genome Biology", discipline: "Biology", articleTypes: ["Research", "Methods", "Review"], oaPolicy: "OA", apcBand: "Over3500", speed: "Moderate", ambition: "Solid", summary: "OA journal for genomics and systems biology.", strengths: ["OA", "Genomics focus", "Good methods track"], bestFor: "Genomics, single-cell, and systems biology.", avoidIf: "Non-genomic biology.", publisher: "Springer Nature", link: "https://genomebiology.biomedcentral.com/" },
  { id: "emboj", name: "EMBO Journal", discipline: "Biology", articleTypes: ["Research"], oaPolicy: "Hybrid", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "Molecular biology journal with rigorous review.", strengths: ["Strong review", "Society-backed"], bestFor: "Mechanistic molecular biology.", avoidIf: "Clinical focus.", publisher: "EMBO / Wiley", link: "https://www.embopress.org/journal/14602075" },
  { id: "jbc", name: "Journal of Biological Chemistry", discipline: "Biology", articleTypes: ["Research", "Methods"], oaPolicy: "OA", apcBand: "Under1500", speed: "Moderate", ambition: "Rapid", summary: "Society journal for biochemistry with OA option.", strengths: ["Affordable OA", "Society-run", "Soundness focus"], bestFor: "Solid biochemical research and methods.", avoidIf: "High-prestige goals.", publisher: "ASBMB", link: "https://www.jbc.org/" },
  { id: "giga", name: "GigaScience", discipline: "Biology", articleTypes: ["Data", "Methods", "Research"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Moderate", ambition: "Rapid", summary: "OA journal for data-intensive life science with data/code requirements.", strengths: ["Data and code required", "OA", "Reproducibility focus"], bestFor: "Datasets, pipelines, and computational biology.", avoidIf: "Wet-lab only without data.", publisher: "Oxford University Press", link: "https://academic.oup.com/gigascience" },

  // Environmental / Earth
  { id: "nature-climate", name: "Nature Climate Change", discipline: "Earth & Environment", articleTypes: ["Research", "Review"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Deliberate", ambition: "High", summary: "Top journal for climate research and policy-relevant studies.", strengths: ["Prestige", "Policy reach"], bestFor: "High-impact climate science and policy research.", avoidIf: "Local-only studies without broader impact.", publisher: "Springer Nature", link: "https://www.nature.com/nclimate/" },
  { id: "aguph", name: "AGU journals (e.g., JGR Atmospheres)", discipline: "Earth & Environment", articleTypes: ["Research"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "Society journals covering geoscience branches.", strengths: ["Society-led", "OA options", "Broad geoscience"], bestFor: "Solid geoscience and earth system research.", avoidIf: "Ultra-rapid needs.", publisher: "AGU / Wiley", link: "https://www.agu.org/Publish-with-AGU/Publish" },
  { id: "esd", name: "Earth System Dynamics", discipline: "Earth & Environment", articleTypes: ["Research"], oaPolicy: "OA", apcBand: "Under1500", speed: "Moderate", ambition: "Rapid", summary: "OA journal for earth system modelling.", strengths: ["OA", "Interactive public discussion", "Modeling focus"], bestFor: "Climate and earth system modeling studies.", avoidIf: "Non-modeling topics.", publisher: "EGU / Copernicus", link: "https://esd.copernicus.org/" },

  // Social sciences / humanities
  { id: "asr", name: "American Sociological Review", discipline: "Social Science", articleTypes: ["Research", "Review"], oaPolicy: "Closed", apcBand: "None", speed: "Deliberate", ambition: "High", summary: "Flagship sociology journal.", strengths: ["Prestige", "Field-shaping"], bestFor: "Theoretical and empirical sociology with wide impact.", avoidIf: "Niche subdisciplinary cases.", publisher: "ASA / SAGE", link: "https://journals.sagepub.com/home/asr" },
  { id: "aer", name: "American Economic Review", discipline: "Economics", articleTypes: ["Research"], oaPolicy: "Closed", apcBand: "None", speed: "Deliberate", ambition: "High", summary: "Flagship economics journal.", strengths: ["Prestige", "Citations"], bestFor: "Economics with broad theoretical or policy impact.", avoidIf: "Field-specific only.", publisher: "AEA", link: "https://www.aeaweb.org/journals/aer" },
  { id: "ej", name: "Economic Journal", discipline: "Economics", articleTypes: ["Research"], oaPolicy: "Hybrid", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "Society journal covering applied and theoretical economics.", strengths: ["Society-run", "Balanced scope"], bestFor: "Solid economics with applied relevance.", avoidIf: "Seeking top-5 prestige.", publisher: "Royal Economic Society / Oxford", link: "https://academic.oup.com/ej" },
  { id: "soc-sci-open", name: "PLOS Social Sciences", discipline: "Social Science", articleTypes: ["Research", "Review"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Moderate", ambition: "Rapid", summary: "OA venue for social science research.", strengths: ["OA", "Broad social science", "Soundness-first"], bestFor: "Methodologically solid social science needing OA.", avoidIf: "Prestige-seeking econ/finance.", publisher: "PLOS", link: "https://journals.plos.org/plossocialsciences/" },
  { id: "jh", name: "Journal of Humanistic Data", discipline: "Humanities", articleTypes: ["Data", "Methods"], oaPolicy: "OA", apcBand: "None", speed: "Moderate", ambition: "Rapid", summary: "OA venue for humanities datasets and methods.", strengths: ["No APC", "Data focus", "Interdisciplinary"], bestFor: "Humanities datasets, digital humanities methods.", avoidIf: "Traditional narrative-only humanities.", publisher: "Community-led", link: "https://journalofdigitalhumanities.org/" },
  { id: "dhq", name: "Digital Humanities Quarterly", discipline: "Humanities", articleTypes: ["Research", "Methods", "Review"], oaPolicy: "OA", apcBand: "None", speed: "Deliberate", ambition: "Rapid", summary: "OA journal for digital humanities.", strengths: ["No APC", "Community review", "Open methods"], bestFor: "Digital humanities research and tools.", avoidIf: "Non-digital humanities.", publisher: "Alliance of Digital Humanities Organizations", link: "http://www.digitalhumanities.org/dhq/" },

  // Engineering / applied
  { id: "ieee-access", name: "IEEE Access", discipline: "Engineering", articleTypes: ["Research", "Methods"], oaPolicy: "OA", apcBand: "Over3500", speed: "Fast", ambition: "Rapid", summary: "OA megajournal for engineering and applied sciences.", strengths: ["Fast decisions", "OA", "Broad engineering"], bestFor: "Applied engineering needing rapid OA publication.", avoidIf: "Prestige-seeking theoretical work.", publisher: "IEEE", link: "https://ieeeaccess.ieee.org/" },
  { id: "npj-flex", name: "npj Flexible Electronics", discipline: "Engineering", articleTypes: ["Research", "Short"], oaPolicy: "OA", apcBand: "Over3500", speed: "Moderate", ambition: "Solid", summary: "OA journal for flexible and wearable electronics.", strengths: ["OA", "Focused scope", "Nature Partner Journal branding"], bestFor: "Flexible electronics and materials research.", avoidIf: "Outside flexible/wearable domain.", publisher: "Springer Nature", link: "https://www.nature.com/npjflexelectron/" },
  { id: "materials-today", name: "Materials Today", discipline: "Engineering", articleTypes: ["Review", "Short"], oaPolicy: "Hybrid", apcBand: "Over3500", speed: "Moderate", ambition: "Solid", summary: "High-visibility materials science review and news journal.", strengths: ["High reach", "Review focus"], bestFor: "Authoritative materials science reviews.", avoidIf: "Primary research needing full papers.", publisher: "Elsevier", link: "https://www.journals.elsevier.com/materials-today" },

  // Rapid / niche outlets
  { id: "peerj", name: "PeerJ", discipline: "Biology", articleTypes: ["Research", "Review"], oaPolicy: "OA", apcBand: "Under1500", speed: "Fast", ambition: "Rapid", summary: "OA, community-focused biology and medicine journal.", strengths: ["Low APC", "Fast review", "Soundness-first"], bestFor: "Well-executed studies needing affordable OA.", avoidIf: "Prestige goals.", publisher: "PeerJ", link: "https://peerj.com/" },
  { id: "f1000research", name: "F1000Research / platform journals", discipline: "Multidisciplinary", articleTypes: ["Research", "Data", "Methods", "Review"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Fast", ambition: "Rapid", summary: "Post-publication peer review with rapid OA publication.", strengths: ["Very fast", "Transparent review", "Data sharing required"], bestFor: "Rapid dissemination with open review and data.", avoidIf: "Authors needing traditional pre-publication review.", publisher: "Taylor & Francis", link: "https://f1000research.com/" },
  { id: "bmc-research-notes", name: "BMC Research Notes", discipline: "Multidisciplinary", articleTypes: ["Short"], oaPolicy: "OA", apcBand: "Under1500", speed: "Fast", ambition: "Rapid", summary: "Short reports, data notes, and methods briefs.", strengths: ["Fast", "Short format", "OA"], bestFor: "Negative results, data notes, and brief reports.", avoidIf: "Full-length narrative papers.", publisher: "Springer Nature", link: "https://bmcresnotes.biomedcentral.com/" },
  { id: "journal-of-open-research-software", name: "Journal of Open Research Software", discipline: "Data/AI", articleTypes: ["Data", "Methods"], oaPolicy: "OA", apcBand: "None", speed: "Moderate", ambition: "Rapid", summary: "Software papers with open code requirements.", strengths: ["No APC", "Reproducibility focus", "Software emphasis"], bestFor: "Research software papers needing citable credit.", avoidIf: "No intent to release code.", publisher: "Ubiquity Press", link: "https://openresearchsoftware.metajnl.com/" },
  { id: "jors-data", name: "Scientific Data", discipline: "Multidisciplinary", articleTypes: ["Data"], oaPolicy: "OA", apcBand: "Over3500", speed: "Moderate", ambition: "Solid", summary: "Data descriptor journal for high-value datasets.", strengths: ["Data descriptors", "OA", "Nature Research visibility"], bestFor: "Well-documented datasets of broad reuse value.", avoidIf: "Primary research narratives.", publisher: "Springer Nature", link: "https://www.nature.com/sdata/" },

  // Public health / policy
  { id: "health-policy", name: "Health Policy and Planning", discipline: "Public Health", articleTypes: ["Research", "Review"], oaPolicy: "Hybrid", apcBand: "1500-3500", speed: "Moderate", ambition: "Solid", summary: "Health policy and systems research journal.", strengths: ["Policy focus", "Global health"], bestFor: "Health systems and policy research.", avoidIf: "Basic bench science.", publisher: "Oxford University Press", link: "https://academic.oup.com/heapol" },
  { id: "ijerph", name: "International Journal of Environmental Research and Public Health", discipline: "Public Health", articleTypes: ["Research", "Review"], oaPolicy: "OA", apcBand: "1500-3500", speed: "Fast", ambition: "Rapid", summary: "OA journal covering environmental and public health.", strengths: ["Fast", "Broad scope"], bestFor: "Applied public health needing rapid OA.", avoidIf: "Looking for high-prestige clinical journals.", publisher: "MDPI", link: "https://www.mdpi.com/journal/ijerph" }
];

const journalState = {
  defaultCount: 10
};

async function loadOpenAlexCatalog(){
  try{
    const res = await fetch("https://api.openalex.org/sources?per_page=200&sort=works_count:desc&mailto=info@scienceecosystem.org");
    if (!res.ok) throw new Error(res.status+" "+res.statusText);
    const data = await res.json();
    const seen = new Set(journalCatalog.map(j=>j.id));
    const mapped = (data.results||[]).map(s=>{
      const tail = (s.id||"").split("/").pop();
      return {
        id: tail || s.id || s.display_name,
        name: s.display_name || "Journal",
        discipline: "Multidisciplinary",
        articleTypes: ["Research"],
        oaPolicy: s.is_oa ? "OA" : (s.is_in_doaj ? "OA" : "Hybrid"),
        apcBand: "Unknown",
        speed: "Unknown",
        ambition: "Solid",
        summary: s.summary || "Journal from OpenAlex.",
        strengths: [
          s.is_in_doaj ? "DOAJ listed" : "Publisher journal",
          (s.is_oa || s.is_in_doaj) ? "OA friendly" : "Mixed access"
        ],
        bestFor: "General research in its scope.",
        avoidIf: "Scope mismatch or closed access constraints.",
        publisher: s.host_organization_name || "Publisher",
        link: s.homepage_url || s.id || "#",
        openAlexId: s.id
      };
    }).filter(j=>!seen.has(j.id));
    journalCatalog = journalCatalog.concat(mapped);
  }catch(e){
    console.warn("OpenAlex catalog load failed:", e);
  }
}

function buildJournalPageUrl(journal) {
  const rawId = journal.openAlexId || journal.id || "";
  let tail = "";
  if (/^https?:\/\//i.test(rawId)) {
    tail = rawId.split("/").filter(Boolean).pop() || "";
  } else if (/^S\d+$/i.test(rawId)) {
    tail = rawId;
  }
  if (tail) return `journal.html?id=${encodeURIComponent(tail)}`;
  return `journal.html?name=${encodeURIComponent(journal.name)}`;
}

const disciplineKeywords = [
  { key: "Biology", words: ["bio", "genome", "cell", "molecular", "genetic", "protein", "microbio"] },
  { key: "Medicine", words: ["clinical", "medicine", "trial", "patient", "healthcare"] },
  { key: "Public Health", words: ["public health", "epidemiology", "population", "health policy"] },
  { key: "Computer Science", words: ["ai", "machine learning", "ml", "algorithm", "computer", "deep learning"] },
  { key: "Data/AI", words: ["dataset", "data", "benchmark", "software", "code"] },
  { key: "Engineering", words: ["engineering", "materials", "device", "electronics", "mechanical"] },
  { key: "Earth & Environment", words: ["climate", "earth", "geoscience", "atmosphere", "environment", "ocean"] },
  { key: "Economics", words: ["economics", "finance", "market", "macro", "micro"] },
  { key: "Social Science", words: ["sociology", "social", "behavior", "policy", "education"] },
  { key: "Humanities", words: ["humanities", "history", "literature", "digital humanities"] },
  { key: "Multidisciplinary", words: ["interdisciplinary", "multiple fields", "general"] }
];

const articleTypeKeywords = [
  { key: "Research", words: ["research", "study", "experiment", "trial", "analysis"] },
  { key: "Review", words: ["review", "meta-analysis", "systematic"] },
  { key: "Methods", words: ["method", "protocol", "pipeline"] },
  { key: "Short", words: ["brief", "letter", "short", "communication"] },
  { key: "Case", words: ["case report", "case series", "clinical case"] },
  { key: "Data", words: ["dataset", "data note", "descriptor", "software"] }
];

function normalizeText(val) {
  return (val || "").toLowerCase();
}

function mapDiscipline(text) {
  for (const d of disciplineKeywords) {
    if (d.words.some(w => text.includes(w))) return d.key;
  }
  return "";
}

function mapArticleTypes(text) {
  const picks = [];
  for (const a of articleTypeKeywords) {
    if (a.words.some(w => text.includes(w))) picks.push(a.key);
  }
  return picks;
}

function scoreJournal(j, text, filters) {
  let score = 0;
  const reasons = [];
  const lower = normalizeText(text);

  // Discipline match
  if (filters.discipline && j.discipline === filters.discipline) { score += 6; reasons.push("Discipline match"); }
  else if (!filters.discipline) {
    const inferred = mapDiscipline(lower);
    if (inferred && j.discipline === inferred) { score += 5; reasons.push("Matches described field"); }
    else if (j.discipline === "Multidisciplinary") { score += 3; reasons.push("Multidisciplinary option"); }
  }

  // Article type
  if (filters.article && j.articleTypes.includes(filters.article)) { score += 4; reasons.push("Supports your article type"); }
  else if (!filters.article) {
    const inferredTypes = mapArticleTypes(lower);
    if (inferredTypes.some(t => j.articleTypes.includes(t))) { score += 3; reasons.push("Fits article type"); }
  }

  // OA / APC
  if (filters.oa && j.oaPolicy === filters.oa) { score += 3; reasons.push("OA policy matches"); }
  if (filters.apc) {
    if (filters.apc === j.apcBand) { score += 3; reasons.push("APC within budget"); }
    else if (filters.apc === "None" && j.apcBand === "Under1500") { score += 1; reasons.push("Low APC option"); }
  } else if (lower.includes("oa") || lower.includes("open access") || lower.includes("budget")) {
    if (j.apcBand === "None") { score += 3; reasons.push("No APC"); }
    else if (j.apcBand === "Under1500") { score += 2; reasons.push("Low APC"); }
  }

  // Speed
  if (filters.speed && j.speed === filters.speed) { score += 2; reasons.push("Speed preference"); }
  else if (lower.includes("urgent") || lower.includes("fast") || lower.includes("rapid")) {
    if (j.speed === "Fast") { score += 2; reasons.push("Fast review"); }
  }

  // Ambition
  if (filters.ambition && j.ambition === filters.ambition) { score += 3; reasons.push("Ambition match"); }
  else if (lower.includes("prestige") || lower.includes("high impact")) {
    if (j.ambition === "High") { score += 2; reasons.push("High-prestige option"); }
  }

  // Publisher anchor
  if (lower.includes("society") && j.publisher.toLowerCase().includes("society")) {
    score += 1; reasons.push("Society journal");
  }

  return { score, reasons };
}

function renderRecommendations(problemText, filters) {
  const container = document.getElementById("journalRecommendations");
  if (!container) return;

  const scored = journalCatalog.map(j => {
    const { score, reasons } = scoreJournal(j, problemText, filters);
    return { journal: j, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const meaningful = problemText.trim() ? scored.filter(x => x.score > 0) : scored;
  const picks = (meaningful.length ? meaningful : scored).slice(0, journalState.defaultCount);

  if (!picks.length) {
    container.innerHTML = '<p class="muted">Add a sentence about your manuscript to see suggestions.</p>';
    return;
  }

  container.innerHTML = "";
  picks.forEach(({ journal, score, reasons }) => {
    const reasonText = reasons.length ? `Why: ${Array.from(new Set(reasons)).slice(0, 4).join(", ")}.` : "Why: Broadly suitable default.";
    const verify = [
      "Check aims & scope",
      "Confirm APC on journal site",
      "Check review timelines",
      "Confirm preprint policy"
    ].map(t => `<span class="badge">${t}</span>`).join("");
    const journalUrl = buildJournalPageUrl(journal);
    const card = document.createElement("article");
    card.className = "rec-card";
    card.innerHTML = `
      <div class="rec-head">
        <div>
          <h3><a href="${journalUrl}">${journal.name}</a></h3>
          <p class="muted small">${journal.discipline} · ${journal.publisher}</p>
        </div>
        <div class="pill-row">
          <span class="badge">${journal.oaPolicy}</span>
          <span class="badge badge-ease">APC: ${journal.apcBand === "None" ? "None" : journal.apcBand}</span>
          <span class="badge">${journal.speed}</span>
          <span class="badge">${journal.ambition}</span>
        </div>
      </div>
      <p class="rec-summary">${journal.summary}</p>
      <p class="rec-why">${reasonText}</p>
      <p class="tool-strengths">Best for: ${journal.bestFor}</p>
      <p class="tool-strengths muted small">Avoid if: ${journal.avoidIf}</p>
      <div class="chip-row">${journal.strengths.map(s => `<span class="badge">${s}</span>`).join("")}</div>
      <div class="chip-row" style="margin-top:.5rem;">${verify}</div>
      <div class="rec-actions">
        <a class="btn btn-secondary" href="${journal.link}" target="_blank" rel="noopener">Visit ${journal.name}</a>
        <span class="alt-note">Article types: ${journal.articleTypes.join(", ")}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderJournalGrid(list) {
  const grid = document.getElementById("journalGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = '<p class="muted">No journals match those filters yet.</p>';
    return;
  }
  list.forEach(j => {
    const journalUrl = buildJournalPageUrl(j);
    const card = document.createElement("article");
    card.className = "tool-card";
    card.innerHTML = `
      <div class="tool-meta">
        <h3><a href="${journalUrl}">${j.name}</a></h3>
        <div class="pill-row">
          <span class="badge">${j.discipline}</span>
          <span class="badge">${j.oaPolicy}</span>
          <span class="badge badge-ease">APC: ${j.apcBand === "None" ? "None" : j.apcBand}</span>
          <span class="badge">${j.speed}</span>
          <span class="badge">${j.ambition}</span>
        </div>
      </div>
      <p class="rec-summary">${j.summary}</p>
      <p class="tool-strengths">Best for: ${j.bestFor}</p>
      <p class="tool-strengths muted small">Avoid if: ${j.avoidIf}</p>
      <div class="tool-footer">
        <span class="alt-note">Article types: ${j.articleTypes.join(", ")} · Publisher: ${j.publisher}</span>
        <a href="${j.link}" target="_blank" rel="noopener">Visit</a>
      </div>
    `;
    grid.appendChild(card);
  });
}

function getFilters() {
  return {
    discipline: document.getElementById("disciplineFilter")?.value || "",
    article: document.getElementById("articleTypeFilter")?.value || "",
    oa: document.getElementById("oaFilter")?.value || "",
    apc: document.getElementById("apcFilter")?.value || "",
    speed: document.getElementById("speedFilter")?.value || "",
    ambition: document.getElementById("ambitionFilter")?.value || "",
  };
}

function applyJournalFilters(problemText) {
  const filters = getFilters();
  const filtered = journalCatalog.filter(j => {
    const matchesDiscipline = !filters.discipline || j.discipline === filters.discipline;
    const matchesArticle = !filters.article || j.articleTypes.includes(filters.article);
    const matchesOA = !filters.oa || j.oaPolicy === filters.oa;
    const matchesAPC = !filters.apc || j.apcBand === filters.apc || (filters.apc === "None" && j.apcBand === "Under1500");
    const matchesSpeed = !filters.speed || j.speed === filters.speed;
    const matchesAmbition = !filters.ambition || j.ambition === filters.ambition;
    return matchesDiscipline && matchesArticle && matchesOA && matchesAPC && matchesSpeed && matchesAmbition;
  });
  renderJournalGrid(filtered);
}

function populateDisciplineOptions() {
  const select = document.getElementById("disciplineFilter");
  if (!select) return;
  const disciplines = Array.from(new Set(journalCatalog.map(j => j.discipline))).sort();
  disciplines.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    select.appendChild(opt);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("journalProblem");
  const btn = document.getElementById("findJournalsBtn");

  loadOpenAlexCatalog().then(()=>{
    populateDisciplineOptions();
    renderJournalGrid(journalCatalog);
  }).catch(()=>{
    populateDisciplineOptions();
    renderJournalGrid(journalCatalog);
  });

  btn?.addEventListener("click", () => {
    applyJournalFilters(input?.value || "");
  });
  input?.addEventListener("input", () => applyJournalFilters(input.value));
  input?.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
      applyJournalFilters(input.value);
    }
  });

  ["disciplineFilter","articleTypeFilter","oaFilter","apcFilter","speedFilter","ambitionFilter"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => applyJournalFilters(input?.value || ""));
  });
});
