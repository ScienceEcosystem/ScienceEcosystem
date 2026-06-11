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

// ── Helpers ───────────────────────────────────────────────────────────────────

const OA_MAILTO = "info@scienceecosystem.org";
const OA_API    = "https://api.openalex.org";

function escJ(str) {
  return String(str || '').replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function oaBadge(isOa, inDoaj) {
  if (inDoaj) return '<span style="font-size:.72rem;background:#dcfce7;color:#166534;padding:1px 7px;border-radius:10px;">DOAJ · Gold OA</span>';
  if (isOa)   return '<span style="font-size:.72rem;background:#dcfce7;color:#166534;padding:1px 7px;border-radius:10px;">Open Access</span>';
  return             '<span style="font-size:.72rem;background:#f1f5f9;color:#475569;padding:1px 7px;border-radius:10px;">Subscription</span>';
}

function journalPageUrl(openAlexId) {
  if (!openAlexId) return null;
  const tail = String(openAlexId).replace(/^https?:\/\/openalex\.org\//i, '').replace(/^\//, '');
  return tail ? 'journal.html?id=' + encodeURIComponent(tail) : null;
}

// ── Card renderers ─────────────────────────────────────────────────────────────

function makeCuratedCard(j) {
  const card = document.createElement('article');
  card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1rem;display:flex;flex-direction:column;gap:.4rem;';

  const oaStyle = j.oaPolicy === 'OA'
    ? 'background:#dcfce7;color:#166534'
    : j.oaPolicy === 'Hybrid'
      ? 'background:#fef9c3;color:#78350f'
      : 'background:#f1f5f9;color:#475569';

  card.setAttribute('data-jname', j.name);
  card.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">'
      + '<a href="' + escJ(j.link) + '" target="_blank" rel="noopener noreferrer" '
        + 'style="font-size:.9rem;font-weight:700;color:#0f172a;text-decoration:none;">' + escJ(j.name) + '</a>'
      + '<span style="font-size:.72rem;padding:1px 7px;border-radius:10px;flex-shrink:0;' + oaStyle + '">' + escJ(j.oaPolicy) + '</span>'
    + '</div>'
    + '<p style="font-size:.8rem;color:#475569;margin:0;line-height:1.4;">' + escJ(j.summary) + '</p>'
    + '<div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-top:.2rem;">'
      + (j.apcBand && j.apcBand !== 'Unknown' ? '<span style="font-size:.72rem;background:#f1f5f9;color:#374151;padding:1px 7px;border-radius:10px;">APC: ' + escJ(j.apcBand) + '</span>' : '')
      + (j.speed && j.speed !== 'Unknown' ? '<span style="font-size:.72rem;background:#f1f5f9;color:#374151;padding:1px 7px;border-radius:10px;">' + escJ(j.speed) + '</span>' : '')
      + '<span class="curated-jti" style="font-size:.72rem;color:#cbd5e1;">JTI…</span>'
    + '</div>'
    + '<div style="margin-top:auto;padding-top:.25rem;display:flex;gap:.75rem;align-items:center;">'
      + '<a href="journal.html?name=' + encodeURIComponent(j.name) + '" '
        + 'style="font-size:.8rem;color:#2e7f9f;text-decoration:none;font-weight:600;">Full details →</a>'
      + '<a href="' + escJ(j.link) + '" target="_blank" rel="noopener noreferrer" '
        + 'style="font-size:.8rem;color:#475569;text-decoration:none;">Website ↗</a>'
    + '</div>';
  return card;
}

function makeOpenAlexCard(s) {
  const card = document.createElement('article');
  card.style.cssText = 'background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:1rem;display:flex;flex-direction:column;gap:.4rem;';

  const pageUrl  = journalPageUrl(s.id);
  const nameHtml = pageUrl
    ? '<a href="' + escJ(pageUrl) + '" style="font-size:.9rem;font-weight:700;color:#0f172a;text-decoration:none;">' + escJ(s.display_name) + '</a>'
    : '<span style="font-size:.9rem;font-weight:700;color:#0f172a;">' + escJ(s.display_name) + '</span>';

  const works  = (s.works_count || 0).toLocaleString();
  const hIndex = s.summary_stats?.h_index || null;
  const pub    = s.host_organization_name || '';
  const site   = s.homepage_url || '';

  const seScore   = (globalThis.SE?.components?.computeJournalTrustIndex) ? SE.components.computeJournalTrustIndex(s) : null;
  const scoreBadge = seScore ? SE.components.journalTrustIndexBadgeHtml(seScore) : '';

  card.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">'
      + nameHtml
      + oaBadge(s.is_oa, s.is_in_doaj)
    + '</div>'
    + (pub ? '<p style="font-size:.78rem;color:#475569;margin:0;">' + escJ(pub) + '</p>' : '')
    + '<div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-top:.2rem;">'
      + '<span style="font-size:.72rem;background:#f1f5f9;color:#374151;padding:1px 7px;border-radius:10px;">' + works + ' works</span>'
      + (hIndex ? '<span style="font-size:.72rem;background:#f1f5f9;color:#374151;padding:1px 7px;border-radius:10px;">h-index ' + hIndex + '</span>' : '')
      + scoreBadge
    + '</div>'
    + '<div style="margin-top:auto;padding-top:.25rem;display:flex;gap:.75rem;align-items:center;">'
      + (pageUrl ? '<a href="' + escJ(pageUrl) + '" style="font-size:.8rem;color:#2e7f9f;text-decoration:none;font-weight:600;">Full details →</a>' : '')
      + (site ? '<a href="' + escJ(site) + '" target="_blank" rel="noopener noreferrer" style="font-size:.8rem;color:#475569;text-decoration:none;">Website ↗</a>' : '')
    + '</div>';
  return card;
}

// ── Default view — curated journals grouped by discipline ─────────────────────

function renderDefault(oaOnly) {
  const container = document.getElementById('journalResults');
  if (!container) return;
  container.innerHTML = '';

  const list = oaOnly ? journalCatalog.filter(function(j){ return j.oaPolicy === 'OA'; }) : journalCatalog;

  if (!list.length) {
    container.innerHTML = '<p class="muted">No journals match the current filters.</p>';
    return;
  }

  const byDiscipline = Object.create(null);
  list.forEach(function(j) {
    const d = j.discipline || 'Other';
    if (!byDiscipline[d]) byDiscipline[d] = [];
    byDiscipline[d].push(j);
  });

  Object.keys(byDiscipline).sort().forEach(function(disc) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:2rem;';
    section.innerHTML = '<h2 style="font-size:.95rem;font-weight:700;color:#374151;'
      + 'margin:0 0 .75rem;padding-bottom:.4rem;border-bottom:1px solid #e5e7eb;">' + escJ(disc) + '</h2>';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.75rem;';

    byDiscipline[disc]
      .slice()
      .sort(function(a, b){ return a.name.localeCompare(b.name); })
      .forEach(function(j){ grid.appendChild(makeCuratedCard(j)); });

    section.appendChild(grid);
    container.appendChild(section);
  });
}

// ── Live search via OpenAlex sources API ──────────────────────────────────────

let _searchTimer = null;
let _lastQuery   = '';

async function searchJournals(query, oaOnly) {
  const container = document.getElementById('journalResults');
  const hint      = document.getElementById('searchHint');
  if (!container) return;
  _lastQuery = query;

  container.innerHTML = '<p class="muted" style="padding:.5rem 0;">Searching…</p>';
  if (hint) hint.textContent = 'Searching OpenAlex for journals matching "' + query + '"…';

  try {
    let url = OA_API + '/sources?search=' + encodeURIComponent(query)
      + '&filter=type:journal'
      + (oaOnly ? ',is_oa:true' : '')
      + '&per_page=20&sort=works_count:desc&select=id,display_name,host_organization_name,'
      + 'is_oa,is_in_doaj,works_count,homepage_url,summary_stats'
      + '&mailto=' + OA_MAILTO;

    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    // Guard against stale response if user typed faster
    if (query !== _lastQuery) return;

    const results = data.results || [];
    container.innerHTML = '';

    if (!results.length) {
      container.innerHTML = '<p class="muted">No journals found for "' + escJ(query) + '". Try a broader term.</p>';
      if (hint) hint.textContent = '0 results from OpenAlex.';
      return;
    }

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:.75rem;';
    results.forEach(function(s){ grid.appendChild(makeOpenAlexCard(s)); });
    container.appendChild(grid);

    if (hint) hint.textContent = results.length + ' journals found via OpenAlex. Click "Full details" to see metrics, topics, and papers.';

  } catch(e) {
    if (query !== _lastQuery) return;
    container.innerHTML = '<p class="muted">Search failed — showing curated list instead.</p>';
    renderDefault(oaOnly);
    if (hint) hint.textContent = 'Search unavailable. Showing curated journals.';
  }
}

// ── JTI loader for curated cards ─────────────────────────────────────────────
// Fetches real OpenAlex source data for each curated journal and populates
// the JTI badge. Runs in the background after cards are rendered.

async function loadCuratedJti() {
  if (!globalThis.SE?.components?.computeJournalTrustIndex) return;
  const placeholders = Array.from(document.querySelectorAll('.curated-jti'));
  if (!placeholders.length) return;

  // Process in batches of 4 to stay within OpenAlex rate limits
  const BATCH = 4;
  for (let i = 0; i < placeholders.length; i += BATCH) {
    const batch = placeholders.slice(i, i + BATCH);
    await Promise.all(batch.map(async function(el) {
      const card = el.closest('[data-jname]');
      if (!card) return;
      const name = card.getAttribute('data-jname');
      try {
        const url = OA_API + '/sources?search=' + encodeURIComponent(name)
          + '&filter=type:journal&per_page=1&select=display_name,is_oa,is_in_doaj,works_count,summary_stats'
          + '&mailto=' + OA_MAILTO;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const src = data.results && data.results[0];
        if (!src) { el.textContent = ''; return; }
        const score = SE.components.computeJournalTrustIndex(src);
        el.outerHTML = SE.components.journalTrustIndexBadgeHtml(score);
      } catch(_) { el.textContent = ''; }
    }));
    // Small pause between batches
    if (i + BATCH < placeholders.length) {
      await new Promise(function(r){ setTimeout(r, 150); });
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// defer guarantees DOM is parsed — run directly
(function initJournals() {
  const searchEl = document.getElementById('journalSearch');
  const oaEl     = document.getElementById('oaOnly');
  const hint      = document.getElementById('searchHint');

  function isOaOnly() { return !!(oaEl && oaEl.checked); }

  renderDefault(false);
  if (hint) hint.textContent = 'Showing ' + journalCatalog.length + ' curated journals by discipline. Type to search all journals via OpenAlex.';
  loadCuratedJti();

  if (searchEl) {
    searchEl.addEventListener('input', function() {
      const q = this.value.trim();
      clearTimeout(_searchTimer);
      if (!q) {
        _lastQuery = '';
        renderDefault(isOaOnly());
        if (hint) hint.textContent = 'Showing curated journals. Type to search all journals via OpenAlex.';
        return;
      }
      _searchTimer = setTimeout(function(){ searchJournals(q, isOaOnly()); }, 350);
    });
  }

  if (oaEl) {
    oaEl.addEventListener('change', function() {
      const q = searchEl ? searchEl.value.trim() : '';
      if (q) searchJournals(q, isOaOnly());
      else renderDefault(isOaOnly());
    });
  }
})();
