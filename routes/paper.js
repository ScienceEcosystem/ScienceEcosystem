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
