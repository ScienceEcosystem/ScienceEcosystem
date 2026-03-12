import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// Get paper with linked resources
router.get('/api/paper/:doi(*)', async (req, res) => {
  const doi = decodeURIComponent(req.params.doi);
  
  try {
    const linkedResources = await findLinkedResources(doi);
    const reproducibilityScore = calculateReproducibilityScore(linkedResources);
    
    res.json({
      linkedResources,
      reproducibilityScore
    });
  } catch (error) {
    console.error('Error fetching paper resources:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pdf/extract
// Extract structured data from PDF using GROBID cloud service
router.post('/api/pdf/extract', async (req, res) => {
  const { pdfUrl } = req.body || {};
  if (!pdfUrl) return res.status(400).json({ error: 'pdfUrl required' });

  try {
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) throw new Error('Failed to fetch PDF');
    const pdfBuffer = await pdfResponse.arrayBuffer();

    const formData = new FormData();
    formData.append('input', new Blob([pdfBuffer]), 'paper.pdf');

    const grobidResponse = await fetch('https://cloud.science-miner.com/grobid/api/processFulltextDocument', {
      method: 'POST',
      body: formData
    });
    if (!grobidResponse.ok) throw new Error('GROBID processing failed');

    const teiXml = await grobidResponse.text();
    const parsed = parseGrobidTEI(teiXml);
    res.json(parsed);
  } catch (e) {
    console.error('PDF extraction error:', e);
    res.status(500).json({ error: 'Failed to extract PDF data' });
  }
});

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Helper function to parse GROBID TEI XML
function parseGrobidTEI(teiXml) {
  const references = [];
  const figures = [];

  const refMatches = teiXml.matchAll(/<biblStruct[^>]*>(.*?)<\/biblStruct>/gs);
  let refNumber = 1;

  for (const match of refMatches) {
    const refXml = match[1] || '';

    const titleMatch = refXml.match(/<title[^>]*level="a"[^>]*>(.*?)<\/title>/s);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';

    const authorMatches = refXml.matchAll(/<author>(.*?)<\/author>/gs);
    const authors = [];
    for (const authorMatch of authorMatches) {
      const authorXml = authorMatch[1] || '';
      const forename = authorXml.match(/<forename[^>]*>(.*?)<\/forename>/s)?.[1] || '';
      const surname = authorXml.match(/<surname[^>]*>(.*?)<\/surname>/s)?.[1] || '';
      const name = stripTags(`${forename} ${surname}`);
      if (name) authors.push(name);
    }

    const doiMatch = refXml.match(/<idno[^>]*type="DOI"[^>]*>(.*?)<\/idno>/);
    const doi = doiMatch ? stripTags(doiMatch[1]) : null;

    const yearMatch = refXml.match(/<date[^>]*when="(\d{4})/);
    const year = yearMatch ? yearMatch[1] : null;

    references.push({
      number: refNumber++,
      title: title,
      authors: authors,
      doi: doi,
      year: year
    });
  }

  const figMatches = teiXml.matchAll(/<figure[^>]*>(.*?)<\/figure>/gs);
  let figNumber = 1;
  for (const match of figMatches) {
    const figXml = match[1] || '';
    const captionMatch = figXml.match(/<figDesc>(.*?)<\/figDesc>/s);
    const caption = captionMatch ? stripTags(captionMatch[1]) : '';
    figures.push({ number: figNumber++, caption: caption });
  }

  return {
    references: references,
    figures: figures,
    metadata: {
      totalReferences: references.length,
      totalFigures: figures.length
    }
  };
}

// Semantic Scholar API
async function getSemanticScholarCitations(doi) {
  try {
    const paperRes = await fetch(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=paperId`);
    if (!paperRes.ok) return null;
    const { paperId } = await paperRes.json();
    if (!paperId) return null;

    const citationsRes = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/${paperId}/citations?fields=contexts,intents,isInfluential,citingPaper&limit=100`
    );
    if (!citationsRes.ok) return null;
    const data = await citationsRes.json();

    return (data.data || [])
      .filter(c => c.citingPaper?.isOpenAccess && c.contexts?.length > 0)
      .map(c => ({
        source: 'semantic_scholar',
        title: c.citingPaper.title,
        year: c.citingPaper.year,
        authors: c.citingPaper.authors?.map(a => a.name).join(', ') || '',
        snippet: c.contexts[0],
        intent: c.intents?.[0] || 'background',
        isInfluential: c.isInfluential || false,
        url: c.citingPaper.url || (c.citingPaper.externalIds?.DOI ? `https://doi.org/${c.citingPaper.externalIds.DOI}` : null),
        openAccessPdf: c.citingPaper.openAccessPdf?.url || null
      }));
  } catch (e) {
    console.error('Semantic Scholar API error:', e);
    return null;
  }
}

// OpenCitations API
async function getOpenCitations(doi) {
  try {
    const cleanDoi = doi.replace(/^doi:/i, '');
    const res = await fetch(`https://opencitations.net/index/coci/api/v1/citations/${encodeURIComponent(cleanDoi)}`);
    if (!res.ok) return null;
    const citations = await res.json();
    return citations.map(c => ({
      source: 'opencitations',
      citingDoi: c.citing,
      citedDoi: c.cited,
      year: c.creation?.split('-')[0] || null
    }));
  } catch (e) {
    console.error('OpenCitations API error:', e);
    return null;
  }
}

// CORE API (optional)
async function getCORECitations(doi, apiKey) {
  if (!apiKey) return null;
  try {
    const query = `doi:"${doi.replace(/^doi:/i, '')}"`;
    const res = await fetch(
      `https://core.ac.uk/api-v2/articles/search/${encodeURIComponent(query)}?apiKey=${apiKey}&metadata=true&fulltext=false&citations=false&similar=false&duplicate=false&urls=true&faithfulMetadata=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.map(paper => ({
      source: 'core',
      title: paper.title,
      year: paper.yearPublished,
      authors: paper.authors?.join(', ') || '',
      url: paper.downloadUrl || paper.urls?.[0] || null
    })) || [];
  } catch (e) {
    console.error('CORE API error:', e);
    return null;
  }
}

// ScienceOpen API (peer review data)
async function getScienceOpenReviews(doi) {
  try {
    const cleanDoi = doi.replace(/^doi:/i, '');
    const res = await fetch(`https://www.scienceopen.com/api/document/doi/${encodeURIComponent(cleanDoi)}/reviews`);
    if (!res.ok) return null;
    const reviews = await res.json();
    return reviews.map(r => ({
      source: 'scienceopen',
      reviewer: r.author?.name || 'Anonymous',
      date: r.created,
      rating: r.rating,
      comment: r.comment,
      url: `https://www.scienceopen.com/document?doi=${cleanDoi}`
    }));
  } catch (e) {
    console.error('ScienceOpen API error:', e);
    return null;
  }
}

// Lens.org API (optional)
async function getLensImpact(doi, apiKey) {
  if (!apiKey) return null;
  try {
    const cleanDoi = doi.replace(/^doi:/i, '');
    const res = await fetch('https://api.lens.org/scholarly/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: { match: { doi: cleanDoi } },
        include: ['scholarly_citations', 'patent_citations', 'clinical_trials']
      })
    });
    if (!res.ok) return null;
    const data = await res.json();

    const paper = data.data?.[0];
    if (!paper) return null;

    return {
      source: 'lens',
      patentCitations: paper.patent_citation_count || 0,
      patents: paper.citing_patents?.slice(0, 5) || [],
      clinicalTrials: paper.clinical_trials?.slice(0, 5) || [],
      scholarCitations: paper.scholarly_citation_count || 0
    };
  } catch (e) {
    console.error('Lens.org API error:', e);
    return null;
  }
}

// Semantic Scholar abstract (fallback when OpenAlex abstract is missing)
async function getSemanticScholarAbstract(doi) {
  try {
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,abstract`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.abstract) return null;
    return { title: data.title || null, abstract: data.abstract };
  } catch (e) {
    console.error('Semantic Scholar abstract error:', e);
    return null;
  }
}

// GET /api/paper/abstract?doi=10.xxxx
router.get('/api/paper/abstract', async (req, res) => {
  const doi = req.query?.doi;
  if (!doi) return res.status(400).json({ error: 'doi required' });

  try {
    const ss = await getSemanticScholarAbstract(doi);
    if (!ss) return res.status(404).json({ error: 'No abstract found' });
    res.json({ source: 'semantic_scholar', title: ss.title, abstract: ss.abstract });
  } catch (e) {
    console.error('Abstract fallback error:', e);
    res.status(500).json({ error: 'Failed to fetch abstract' });
  }
});

// GET /api/paper/citation-contexts?doi=10.xxxx
router.get('/api/paper/citation-contexts', async (req, res) => {
  const doi = req.query?.doi;
  if (!doi) return res.status(400).json({ error: 'doi required' });

  try {
    const [semanticScholar, openCitations, core, scienceOpen, lensImpact] = await Promise.all([
      getSemanticScholarCitations(doi),
      getOpenCitations(doi),
      getCORECitations(doi, process.env.CORE_API_KEY),
      getScienceOpenReviews(doi),
      getLensImpact(doi, process.env.LENS_API_KEY)
    ]);

    const result = {
      citationContexts: semanticScholar || [],
      citationLinks: openCitations || [],
      coreResults: core || [],
      peerReviews: scienceOpen || [],
      impact: lensImpact || null,
      sources: {
        semanticScholar: !!semanticScholar,
        openCitations: !!openCitations,
        core: !!core,
        scienceOpen: !!scienceOpen,
        lens: !!lensImpact
      }
    };

    res.json(result);
  } catch (e) {
    console.error('Citation contexts error:', e);
    res.status(500).json({ error: 'Failed to fetch citation data' });
  }
});

async function findLinkedResources(doi) {
  const resources = {
    osf: null,
    datasets: [],
    code: [],
    protocols: []
  };
  
  // Check OSF
  try {
    const osfUrl = `https://api.osf.io/v2/nodes/?filter[preprint_doi]=${doi}`;
    const osfResponse = await fetch(osfUrl);
    const osfData = await osfResponse.json();
    
    if (osfData.data && osfData.data.length > 0) {
      const project = osfData.data[0];
      resources.osf = {
        id: project.id,
        title: project.attributes.title,
        description: project.attributes.description,
        url: project.links.html,
        dateCreated: project.attributes.date_created
      };
    }
  } catch (error) {
    console.error('OSF API error:', error);
  }
  
  // Check CrossRef
  try {
    const crossrefUrl = `https://api.crossref.org/works/${doi}`;
    const crossrefResponse = await fetch(crossrefUrl);
    const crossrefData = await crossrefResponse.json();
    
    if (crossrefData.message?.relation) {
      const relations = crossrefData.message.relation;
      
      // Extract supplementary materials
      if (relations['is-supplemented-by']) {
        relations['is-supplemented-by'].forEach(item => {
          if (item.id && item['id-type'] === 'doi') {
            resources.datasets.push({
              doi: item.id,
              type: 'dataset',
              source: 'crossref',
              url: `https://doi.org/${item.id}`
            });
          }
        });
      }
    }
  } catch (error) {
    console.error('CrossRef API error:', error);
  }
  
  // Check DataCite
  try {
    const dataciteUrl = `https://api.datacite.org/dois?query=relatedIdentifiers.relatedIdentifier:${doi}`;
    const dataciteResponse = await fetch(dataciteUrl);
    const dataciteData = await dataciteResponse.json();
    
    if (dataciteData.data) {
      dataciteData.data.forEach(item => {
        resources.datasets.push({
          doi: item.id,
          title: item.attributes.titles?.[0]?.title,
          type: 'dataset',
          source: 'datacite',
          url: `https://doi.org/${item.id}`,
          publisher: item.attributes.publisher
        });
      });
    }
  } catch (error) {
    console.error('DataCite API error:', error);
  }
  
  return resources;
}

function calculateReproducibilityScore(resources) {
  let score = 0;
  const breakdown = {
    hasOSF: false,
    hasData: false,
    hasCode: false,
    hasProtocols: false
  };
  
  if (resources.osf) {
    score += 40;
    breakdown.hasOSF = true;
  }
  
  if (resources.datasets.length > 0) {
    score += 30;
    breakdown.hasData = true;
  }
  
  if (resources.code.length > 0) {
    score += 30;
    breakdown.hasCode = true;
  }
  
  return {
    score,
    percentage: score,
    breakdown
  };
}

export default router;
