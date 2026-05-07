// ScienceEcosystem — content script
// Runs on every page. Detects paper metadata (DOI, title, authors, PDF URLs)
// and responds to requests from the popup/background.

(function () {
  "use strict";

  // ── DOI detection ──────────────────────────────────────────────────────────

  const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"'<>\])}]+)/i;

  function cleanDoi(raw) {
    return String(raw || "")
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
      .replace(/^doi:/i, "")
      .replace(/[.,;:)}\]]+$/, "");
  }

  function detectDoi() {
    // 1. doi.org in the current URL
    const doiOrg = location.href.match(/doi\.org\/(10\.\d{4,9}\/[^\s"'<>&?#]+)/i);
    if (doiOrg) return cleanDoi(doiOrg[1]);

    // 2. DOI pattern anywhere in the URL
    const urlMatch = location.href.match(DOI_PATTERN);
    if (urlMatch) return cleanDoi(urlMatch[1]);

    // 3. <meta> tags — ordered by reliability
    const metaNames = [
      "citation_doi", "dc.identifier", "DC.identifier",
      "prism.doi", "bepress_citation_doi", "rft_id"
    ];
    for (const name of metaNames) {
      const el = document.querySelector(
        `meta[name="${name}"], meta[property="${name}"], meta[name="${name.toLowerCase()}"]`
      );
      if (el?.content) {
        const m = el.content.match(DOI_PATTERN);
        if (m) return cleanDoi(m[1]);
      }
    }

    // 4. <link rel="canonical"> often contains a DOI URL
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical?.href) {
      const m = canonical.href.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i);
      if (m) return cleanDoi(m[1]);
    }

    // 5. JSON-LD schema.org
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const candidates = [data, ...(Array.isArray(data) ? data : [])];
        for (const obj of candidates) {
          const id = obj?.["@id"] || obj?.identifier || obj?.sameAs || "";
          const str = Array.isArray(id) ? id.join(" ") : String(id);
          const m = str.match(DOI_PATTERN);
          if (m) return cleanDoi(m[1]); // can't early-return from forEach, stored below
        }
      } catch (_) {}
    });

    return null;
  }

  // ── Metadata extraction ────────────────────────────────────────────────────

  function getMeta(...names) {
    for (const name of names) {
      const el = document.querySelector(
        `meta[name="${name}"], meta[property="${name}"]`
      );
      if (el?.content?.trim()) return el.content.trim();
    }
    return null;
  }

  function getMetaAll(...names) {
    const results = [];
    for (const name of names) {
      document.querySelectorAll(`meta[name="${name}"], meta[property="${name}"]`).forEach(el => {
        if (el.content?.trim()) results.push(el.content.trim());
      });
      if (results.length) break;
    }
    return results;
  }

  function extractTitle() {
    return (
      getMeta("citation_title", "dc.title", "DC.Title", "og:title", "twitter:title") ||
      document.title.replace(/\s*[-|–—].*$/, "").trim() ||
      null
    );
  }

  function extractAuthors() {
    const authors = getMetaAll("citation_author", "dc.creator", "DC.Creator", "author");
    if (authors.length) return authors;

    // JSON-LD fallback
    try {
      const ld = document.querySelector('script[type="application/ld+json"]');
      if (ld) {
        const data = JSON.parse(ld.textContent);
        const persons = data?.author || data?.creator || [];
        if (Array.isArray(persons)) {
          return persons.map(p => p?.name || p).filter(Boolean);
        }
      }
    } catch (_) {}
    return [];
  }

  function extractYear() {
    const raw = getMeta(
      "citation_publication_date", "citation_date", "dc.date", "DC.Date",
      "prism.publicationDate", "article:published_time"
    );
    if (raw) {
      const m = raw.match(/\b(19|20)\d{2}\b/);
      if (m) return m[0];
    }
    return null;
  }

  function extractVenue() {
    return getMeta(
      "citation_journal_title", "prism.publicationName",
      "dc.source", "DC.Source", "citation_conference_title"
    ) || null;
  }

  // ── PDF URL detection ──────────────────────────────────────────────────────

  function detectPdfUrls() {
    const seen = new Set();
    const urls = [];

    function add(url) {
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    }

    // 1. citation_pdf_url meta (most reliable — publishers set this explicitly)
    const pdfMeta = getMeta("citation_pdf_url");
    if (pdfMeta) add(pdfMeta);

    // 2. arXiv special case
    if (location.hostname.includes("arxiv.org")) {
      const m = location.pathname.match(/(?:abs|html)\/(.+)/);
      if (m) add(`https://arxiv.org/pdf/${m[1]}`);
    }

    // 3. PubMed Central: construct PDF URL from PMCID
    if (location.hostname.includes("ncbi.nlm.nih.gov")) {
      const pmcMatch = location.pathname.match(/PMC(\d+)/i) ||
                       location.href.match(/PMC(\d+)/i);
      if (pmcMatch) add(`https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcMatch[1]}/pdf/`);
    }

    // 4. Links on the page that look like PDFs
    document.querySelectorAll("a[href]").forEach(a => {
      const href = a.href;
      if (!href || href.startsWith("javascript")) return;
      const text = (a.textContent || "").trim().toLowerCase();
      const isPdfLink =
        href.endsWith(".pdf") ||
        href.includes("/pdf/") ||
        href.includes("download=true") ||
        text === "pdf" ||
        text.includes("download pdf") ||
        text.includes("full text pdf") ||
        a.getAttribute("data-track-action")?.toLowerCase().includes("pdf");
      if (isPdfLink) add(href);
    });

    return urls;
  }

  // ── Site-specific extractors ───────────────────────────────────────────────
  // Add more publisher-specific logic here as we expand the extension.

  function siteSpecificExtras() {
    const host = location.hostname.replace(/^www\./, "");

    // Google Scholar
    if (host === "scholar.google.com") {
      const doi = detectDoi();
      const titleEl = document.querySelector("h3.gs_rt a, .gs_rt a");
      return { source: "Google Scholar", doi, title: titleEl?.textContent?.trim() };
    }

    // PubMed
    if (host === "pubmed.ncbi.nlm.nih.gov") {
      const pmid = location.pathname.replace(/\//g, "").trim();
      return { source: "PubMed", pmid };
    }

    return { source: host };
  }

  // ── Main: build the full metadata object ──────────────────────────────────

  function getPageMetadata() {
    const doi = detectDoi();
    const title = extractTitle();
    const authors = extractAuthors();
    const year = extractYear();
    const venue = extractVenue();
    const pdfUrls = detectPdfUrls();
    const extras = siteSpecificExtras();

    return {
      doi,
      title,
      authors,
      year,
      venue,
      pdfUrls,
      pageUrl: location.href,
      ...extras,
      // A paper is "detected" if we found at least a DOI or a title that looks academic
      detected: !!(doi || (title && (venue || year || authors.length)))
    };
  }

  // ── Message listener ───────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "GET_PAGE_METADATA") {
      sendResponse(getPageMetadata());
    }
    return true; // keep channel open for async
  });

})();
