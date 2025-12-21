/* Research Tools recommender + overview */
const toolCatalog = [
  {
    id: 'aaas',
    name: 'AAAS',
    category: 'Publisher',
    summary: 'Publishes Science and related journals across disciplines.',
    tags: ['publisher', 'journals', 'science', 'peer review'],
    cost: 'Paid',
    ease: 'Advanced',
    open: false,
    collaboration: false,
    bestFor: 'Submitting or accessing Science family journals.',
    alternatives: 'Springer Nature, Elsevier',
    link: 'https://www.aaas.org/',
    strengths: ['Flagship Science journal', 'High impact titles', 'Policy and news coverage'],
    provider: 'AAAS',
    baseScore: 0
  },
  {
    id: 'altmetric',
    name: 'Altmetric',
    category: 'Altmetrics & impact',
    summary: 'Tracks engagement with research across policy, news, and social media.',
    tags: ['altmetrics', 'attention', 'impact', 'badges', 'mentions'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Monitoring online attention to articles and datasets.',
    alternatives: 'PlumX, paperbuzz.org',
    link: 'https://www.altmetric.com/',
    strengths: ['Attention score', 'Source breakdowns', 'Embeddable badges'],
    provider: 'Digital Science & Research Solutions Ltd.',
    baseScore: 1
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    category: 'Preprints',
    summary: 'Open-access repository of electronic preprints and postprints.',
    tags: ['preprint', 'open access', 'repository', 'physics', 'math', 'cs'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Sharing early versions of papers for rapid dissemination.',
    alternatives: 'bioRxiv, medRxiv',
    link: 'https://arxiv.org/',
    strengths: ['Fast posting', 'Subject categories', 'API access'],
    provider: 'Cornell University',
    baseScore: 2
  },
  {
    id: 'arcgis',
    name: 'ArcGIS',
    category: 'Mapping & GIS',
    summary: 'Enterprise-grade platform for spatial analysis, mapping, and geodata.',
    tags: ['gis', 'mapping', 'spatial', 'geodata', 'geoprocessing'],
    cost: 'Paid',
    ease: 'Advanced',
    open: false,
    collaboration: true,
    bestFor: 'Complex spatial analysis, geodatabases, and map production.',
    alternatives: 'QGIS',
    link: 'https://www.esri.com/en-us/arcgis/about-arcgis/overview',
    strengths: ['Extensive spatial tools', 'ArcGIS Online ecosystem', 'Enterprise support'],
    provider: 'Esri',
    baseScore: 0
  },
  {
    id: 'arcmap',
    name: 'ArcMap',
    category: 'Mapping & GIS',
    summary: 'Desktop application within ArcGIS for creating and analyzing maps.',
    tags: ['gis', 'mapping', 'cartography', 'desktop'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: false,
    bestFor: 'Cartography and geoprocessing workflows on desktop.',
    alternatives: 'ArcGIS Pro, QGIS',
    link: 'https://desktop.arcgis.com/',
    strengths: ['Cartography tools', 'ModelBuilder automation', 'Local/offline analysis'],
    provider: 'Esri',
    baseScore: 0
  },
  {
    id: 'beautiful-ai',
    name: 'Beautiful.ai',
    category: 'Presentations',
    summary: 'Automates slide design to create professional-looking presentations.',
    tags: ['slides', 'presentation', 'design', 'templates', 'ai'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Quickly generating polished slide decks with minimal design effort.',
    alternatives: 'Canva, Gamma',
    link: 'https://www.beautiful.ai/',
    strengths: ['Auto layouts', 'Templates', 'Collaboration'],
    provider: 'Beautiful.ai',
    baseScore: 0
  },
  {
    id: 'binder',
    name: 'Binder',
    category: 'Reproducible environments',
    summary: 'Turn a Git repo into a runnable Jupyter environment in the cloud.',
    tags: ['reproducible', 'environment', 'notebook', 'python', 'r', 'launch'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'Sharing notebooks that others can run without installs.',
    alternatives: 'Colab, Codespaces',
    link: 'https://mybinder.org/',
    strengths: ['Live notebooks from Git', 'No sign-in required', 'Great for workshops'],
    provider: '2i2c / Project Jupyter',
    baseScore: 2
  },
  {
    id: 'biorxiv',
    name: 'bioRxiv',
    category: 'Preprints',
    summary: 'Life sciences preprint server for rapid, open sharing.',
    tags: ['preprint', 'biology', 'life sciences', 'open access'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Posting biology manuscripts ahead of journal submission.',
    alternatives: 'medRxiv, arXiv',
    link: 'https://www.biorxiv.org/',
    strengths: ['Rapid posting', 'Subject areas', 'Broad visibility'],
    provider: 'Cold Spring Harbor Laboratory',
    baseScore: 1
  },
  {
    id: 'canva',
    name: 'Canva',
    category: 'Presentations',
    summary: 'Offers customizable templates for posters, infographics, and slides.',
    tags: ['design', 'poster', 'infographic', 'slides', 'templates'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Designing conference posters and visuals quickly.',
    alternatives: 'Visme, Piktochart',
    link: 'https://www.canva.com/',
    strengths: ['Templates', 'Brand kits', 'Exports for print/web'],
    provider: 'Canva',
    baseScore: 1
  },
  {
    id: 'citeas',
    name: 'CiteAs',
    category: 'Citation helper',
    summary: 'Suggests correct citations for research software and datasets.',
    tags: ['citation', 'software', 'dataset', 'reference'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Finding a recommended citation for software or data you reuse.',
    alternatives: 'How to Cite, README guidance',
    link: 'https://citeas.org/',
    strengths: ['Auto-detect citations', 'Simple lookup', 'Supports software & data'],
    provider: 'OurResearch',
    baseScore: 1
  },
  {
    id: 'connected-papers',
    name: 'Connected Papers',
    category: 'Literature review tool',
    summary: 'Visual graph of related papers to explore a topic.',
    tags: ['literature', 'graph', 'citations', 'discovery', 'network'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Exploring related work and citation relationships quickly.',
    alternatives: 'Litmaps, ResearchRabbit',
    link: 'https://www.connectedpapers.com/',
    strengths: ['Graph visualizations', 'Seed paper exploration', 'Exportable lists'],
    provider: 'Connected Papers',
    baseScore: 1
  },
  {
    id: 'crossref',
    name: 'Crossref',
    category: 'Metadata & DOI',
    summary: 'DOI registration agency with rich metadata and event data.',
    tags: ['doi', 'metadata', 'api', 'citations', 'crossref'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Registering DOIs and pulling authoritative bibliographic metadata.',
    alternatives: 'DataCite',
    link: 'https://www.crossref.org/',
    strengths: ['Broad coverage', 'Event Data', 'Open metadata API'],
    provider: 'Crossref',
    baseScore: 1
  },
  {
    id: 'datacite',
    name: 'DataCite',
    category: 'Metadata & DOI',
    summary: 'Persistent identifiers and metadata for datasets and research outputs.',
    tags: ['doi', 'metadata', 'datasets', 'pids', 'api'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Minting DOIs for datasets and software with rich metadata.',
    alternatives: 'Crossref',
    link: 'https://datacite.org/',
    strengths: ['PID ecosystem', 'Metadata quality', 'APIs'],
    provider: 'DataCite',
    baseScore: 1
  },
  {
    id: 'deepdyve',
    name: 'DeepDyve',
    category: 'Access & discovery',
    summary: 'Rental service for accessing academic papers behind paywalls.',
    tags: ['papers', 'access', 'rental', 'articles'],
    cost: 'Paid',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Short-term access to paywalled journal articles.',
    alternatives: 'ResearchGate requests, interlibrary loan',
    link: 'https://www.deepdyve.com/',
    strengths: ['Article rentals', 'Cost-effective access', 'Search across publishers'],
    provider: 'DeepDyve',
    baseScore: 0
  },
  {
    id: 'depsy',
    name: 'Depsy',
    category: 'Impact metrics',
    summary: 'Analytics platform showing the impact of research software.',
    tags: ['impact', 'software', 'metrics', 'citations'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Assessing influence of research software packages.',
    alternatives: 'Libraries.io, GitHub Insights',
    link: 'http://depsy.org/',
    strengths: ['Software impact focus', 'Open data', 'Author credit'],
    provider: 'OurResearch',
    baseScore: 0
  },
  {
    id: 'designs-ai',
    name: 'Designs.ai',
    category: 'Presentations',
    summary: 'AI-assisted tools for creating research visuals and slides.',
    tags: ['ai', 'design', 'slides', 'graphics', 'video'],
    cost: 'Paid',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Generating graphics and visuals quickly with AI help.',
    alternatives: 'Canva, Beautiful.ai',
    link: 'https://designs.ai/',
    strengths: ['AI design assistant', 'Brand kits', 'Multiple media outputs'],
    provider: 'Inmagine',
    baseScore: 0
  },
  {
    id: 'dimensions',
    name: 'Dimensions',
    category: 'Research database',
    summary: 'Linked database of publications, grants, patents, and policy documents.',
    tags: ['database', 'grants', 'publications', 'citations', 'analytics'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Comprehensive discovery across publications, grants, and clinical trials.',
    alternatives: 'Scopus, Web of Science',
    link: 'https://www.dimensions.ai/',
    strengths: ['Broad coverage', 'Linked data', 'Analytics dashboards'],
    provider: 'Digital Science & Research Solutions Ltd.',
    baseScore: 1
  },
  {
    id: 'dryad',
    name: 'Dryad',
    category: 'Publishing & archiving',
    summary: 'Curated repository for datasets linked to publications.',
    tags: ['dataset', 'publish', 'doi', 'curated', 'share'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Publishing datasets that need curation and DOIs.',
    alternatives: 'Zenodo, Figshare',
    link: 'https://datadryad.org/',
    strengths: ['Curation support', 'Publisher integrations', 'Metadata quality'],
    provider: 'Dryad',
    baseScore: 1
  },
  {
    id: 'elsevier',
    name: 'Elsevier',
    category: 'Publisher',
    summary: 'Publisher with 2,800 journals and the ScienceDirect platform.',
    tags: ['publisher', 'journals', 'sciencedirect', 'research'],
    cost: 'Paid',
    ease: 'Advanced',
    open: false,
    collaboration: false,
    bestFor: 'Submitting to or accessing Elsevier journal content.',
    alternatives: 'Wiley, Taylor & Francis',
    link: 'https://www.elsevier.com/',
    strengths: ['ScienceDirect access', 'Editorial systems', 'Scopus integration'],
    provider: 'Elsevier B.V.',
    baseScore: 0
  },
  {
    id: 'enago-read',
    name: 'Enago Read',
    category: 'Literature review tool',
    summary: 'Summarizes dense research papers into concise, understandable summaries.',
    tags: ['summary', 'papers', 'ai', 'reading'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Quickly grasping key points of research articles.',
    alternatives: 'Scholarcy, Paper Digest',
    link: 'https://read.enago.com/',
    strengths: ['AI summaries', 'Highlight extraction', 'Reference support'],
    provider: 'Enago',
    baseScore: 0
  },
  {
    id: 'endnote',
    name: 'EndNote',
    category: 'Reference management',
    summary: 'Advanced reference management software for citations and bibliographies.',
    tags: ['citation', 'reference', 'bibliography', 'word', 'library'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Managing large citation libraries with desktop + cloud sync.',
    alternatives: 'Zotero, Mendeley',
    link: 'https://endnote.com/',
    strengths: ['Citation styles', 'PDF annotation', 'Library sharing'],
    provider: 'Clarivate',
    baseScore: 1
  },
  {
    id: 'excel',
    name: 'Excel',
    category: 'Spreadsheets',
    summary: 'Versatile tool for managing and analyzing datasets.',
    tags: ['spreadsheet', 'data', 'analysis', 'charts', 'csv'],
    cost: 'Paid',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Basic data cleaning, analysis, and quick charting.',
    alternatives: 'Google Sheets, LibreOffice Calc',
    link: 'https://www.microsoft.com/microsoft-365/excel',
    strengths: ['Pivot tables', 'Charts', 'Broad adoption'],
    provider: 'Microsoft',
    baseScore: 1
  },
  {
    id: 'f1000',
    name: 'F1000Research',
    category: 'Publisher',
    summary: 'Open research publishing platform with transparent peer review.',
    tags: ['open peer review', 'publishing', 'post publication', 'f1000'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Publishing open access with rapid publication and open peer review.',
    alternatives: 'Wellcome Open Research, Gates Open Research',
    link: 'https://f1000research.com/',
    strengths: ['Open peer review', 'Rapid publication', 'Data and software friendly'],
    provider: 'Taylor & Francis',
    baseScore: 1
  },
  {
    id: 'figshare',
    name: 'Figshare',
    category: 'Publishing & archiving',
    summary: 'Share datasets, posters, and figures with DOIs and rich previews.',
    tags: ['share', 'dataset', 'figure', 'poster', 'doi', 'publish'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Publishing supplementary materials with DOIs and altmetrics.',
    alternatives: 'Zenodo, Dryad',
    link: 'https://figshare.com/',
    strengths: ['Previews', 'Usage metrics', 'Institutional storage options'],
    provider: 'Digital Science & Research Solutions Ltd.',
    baseScore: 1
  },
  {
    id: 'gamma',
    name: 'Gamma',
    category: 'Presentations',
    summary: 'Creates dynamic, interactive presentations with AI assistance.',
    tags: ['presentation', 'slides', 'ai', 'interactive'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Engaging presentation decks with minimal design effort.',
    alternatives: 'Prezi, Beautiful.ai',
    link: 'https://gamma.app/',
    strengths: ['Interactive decks', 'AI drafting', 'Responsive layouts'],
    provider: 'Gamma',
    baseScore: 0
  },
  {
    id: 'gates-open-research',
    name: 'Gates Open Research',
    category: 'Publisher',
    summary: 'Open access platform with open peer review for Gates-funded research.',
    tags: ['open access', 'publisher', 'peer review', 'funder'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Publishing Bill & Melinda Gates Foundation–funded work openly.',
    alternatives: 'F1000Research, Wellcome Open Research',
    link: 'https://gatesopenresearch.org/',
    strengths: ['Open peer review', 'Rapid publication', 'Funder-compliant'],
    provider: 'F1000 / Taylor & Francis',
    baseScore: 0
  },
  {
    id: 'get-the-research',
    name: 'Get The Research',
    category: 'Access & discovery',
    summary: 'Academic search engine for people outside academia.',
    tags: ['search', 'papers', 'open access', 'discovery'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Finding accessible versions of scholarly articles.',
    alternatives: 'Google Scholar, Semantic Scholar',
    link: 'https://gettheresearch.org/',
    strengths: ['Simple search', 'Open access focus', 'Plain-language snippets'],
    provider: 'OurResearch',
    baseScore: 1
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Version control',
    summary: 'Git hosting with issues, pull requests, CI, and pages for docs.',
    tags: ['git', 'version control', 'code', 'collaboration', 'issues', 'pull request', 'ci'],
    cost: 'Freemium',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Team coding, versioned analysis pipelines, and reproducible releases.',
    alternatives: 'GitLab, Bitbucket',
    link: 'https://github.com/',
    strengths: ['Pull requests', 'Actions CI', 'Releases + tags'],
    provider: 'Microsoft',
    baseScore: 2
  },
  {
    id: 'google-colab',
    name: 'Google Colab',
    category: 'Notebooks & analysis',
    summary: 'Hosted Jupyter notebooks with GPUs, easy sharing, and no install.',
    tags: ['python', 'notebook', 'analysis', 'ml', 'gpu', 'data exploration'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Quick Python analysis, teaching, and sharing runnable notebooks.',
    alternatives: 'Binder, Kaggle Notebooks',
    link: 'https://colab.research.google.com/',
    strengths: ['No setup', 'GPU runtime', 'Notebook sharing'],
    provider: 'Google',
    baseScore: 2
  },
  {
    id: 'google-docs',
    name: 'Google Docs',
    category: 'Writing & collaboration',
    summary: 'Online writing platform for real-time collaboration.',
    tags: ['writing', 'collaboration', 'documents', 'cloud'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Collaborative drafting and feedback on manuscripts.',
    alternatives: 'Microsoft Word Online, Overleaf',
    link: 'https://docs.google.com/',
    strengths: ['Live collaboration', 'Comments/suggestions', 'Version history'],
    provider: 'Google',
    baseScore: 1
  },
  {
    id: 'google-scholar',
    name: 'Google Scholar',
    category: 'Search engine',
    summary: 'Comprehensive scholarly search with citation linking.',
    tags: ['search', 'citations', 'papers', 'metrics'],
    cost: 'Free',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Quickly finding scholarly articles and citation counts.',
    alternatives: 'Semantic Scholar, Dimensions',
    link: 'https://scholar.google.com/',
    strengths: ['High coverage', 'Citation linking', 'Alerts'],
    provider: 'Google',
    baseScore: 2
  },
  {
    id: 'google-sheets',
    name: 'Google Sheets',
    category: 'Spreadsheets',
    summary: 'Collaborative spreadsheet tool for organizing and analyzing data.',
    tags: ['spreadsheet', 'data', 'collaboration', 'charts', 'csv'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Lightweight data analysis and sharing with teams.',
    alternatives: 'Excel, Airtable',
    link: 'https://sheets.google.com/',
    strengths: ['Live collaboration', 'Charts', 'App Scripts'],
    provider: 'Google',
    baseScore: 1
  },
  {
    id: 'grammarly',
    name: 'Grammarly',
    category: 'Writing & collaboration',
    summary: 'Grammar and style checker for polished writing.',
    tags: ['grammar', 'style', 'writing', 'proofreading'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Catching grammatical issues and tone problems in drafts.',
    alternatives: 'Trinka.ai, Hemingway Editor',
    link: 'https://www.grammarly.com/',
    strengths: ['Grammar checks', 'Tone suggestions', 'Browser extensions'],
    provider: 'Grammarly',
    baseScore: 0
  },
  {
    id: 'hemingway',
    name: 'Hemingway Editor',
    category: 'Writing & collaboration',
    summary: 'Simplifies complex sentences to make writing more readable.',
    tags: ['style', 'readability', 'writing', 'editing'],
    cost: 'Paid',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Improving clarity and readability of academic text.',
    alternatives: 'Grammarly, Trinka.ai',
    link: 'https://hemingwayapp.com/',
    strengths: ['Readability scoring', 'Highlights complex sentences', 'Offline app'],
    provider: 'Hemingway',
    baseScore: 0
  },
  {
    id: 'hypothesis',
    name: 'Hypothesis',
    category: 'Annotation',
    summary: 'Open-source web annotation for collaborative reading.',
    tags: ['annotation', 'collaboration', 'pdf', 'web', 'notes'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: true,
    bestFor: 'Annotating articles with teams or students.',
    alternatives: 'Perusall, Zotero notes',
    link: 'https://web.hypothes.is/',
    strengths: ['Open annotations', 'Group workspaces', 'Browser integrations'],
    provider: 'Hypothesis',
    baseScore: 1
  },
  {
    id: 'imagej',
    name: 'ImageJ (FIJI)',
    category: 'Imaging & analysis',
    summary: 'Open-source image analysis platform popular in life sciences.',
    tags: ['image analysis', 'microscopy', 'bioimage', 'plugins'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Analyzing microscopy and other scientific images.',
    alternatives: 'CellProfiler, Ilastik',
    link: 'https://imagej.net/software/fiji/',
    strengths: ['Extensible plugins', 'Scientific image formats', 'Macro automation'],
    provider: 'NIH / community',
    baseScore: 1
  },
  {
    id: 'impactstory-profile',
    name: 'Impactstory profiles',
    category: 'Impact metrics',
    summary: 'Researcher impact profile highlighting open science activities.',
    tags: ['impact', 'profile', 'altmetrics', 'open science'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Showcasing open science outputs and attention.',
    alternatives: 'Google Scholar Profiles, ORCID record',
    link: 'https://profiles.impactstory.org/',
    strengths: ['Altmetric signals', 'Open access focus', 'Easy profile setup'],
    provider: 'OurResearch',
    baseScore: 0
  },
  {
    id: 'infogram',
    name: 'Infogram',
    category: 'Presentations',
    summary: 'Tool for creating interactive infographics and charts.',
    tags: ['infographic', 'charts', 'visualization', 'presentation'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Building interactive charts and reports for the web.',
    alternatives: 'Piktochart, Visme',
    link: 'https://infogram.com/',
    strengths: ['Interactive embeds', 'Templates', 'Collaboration'],
    provider: 'Prezi',
    baseScore: 0
  },
  {
    id: 'inkscape',
    name: 'Inkscape',
    category: 'Design & illustration',
    summary: 'Open-source vector graphics editor for illustrations and figures.',
    tags: ['vector', 'svg', 'illustration', 'design'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Creating scientific illustrations, diagrams, and SVG graphics.',
    alternatives: 'Adobe Illustrator, Affinity Designer',
    link: 'https://inkscape.org/',
    strengths: ['SVG native', 'Extensions', 'Open-source'],
    provider: 'Inkscape Project',
    baseScore: 1
  },
  {
    id: 'jasp',
    name: 'JASP',
    category: 'Statistics',
    summary: 'User-friendly software for Bayesian and frequentist statistical analysis.',
    tags: ['statistics', 'bayesian', 'analysis', 'anova', 't-test'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Running common statistical tests with minimal coding.',
    alternatives: 'SPSS, jamovi',
    link: 'https://jasp-stats.org/',
    strengths: ['Bayesian support', 'Clean UI', 'Reproducible results panel'],
    provider: 'University of Amsterdam',
    baseScore: 1
  },
  {
    id: 'jstor',
    name: 'JSTOR',
    category: 'Access & discovery',
    summary: 'Digital library for academic journals, books, and primary sources.',
    tags: ['archive', 'journals', 'books', 'humanities', 'access'],
    cost: 'Paid',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Discovering humanities and social science literature.',
    alternatives: 'Project MUSE, Google Scholar',
    link: 'https://www.jstor.org/',
    strengths: ['Deep archives', 'Humanities focus', 'Stable links'],
    provider: 'ITHAKA',
    baseScore: 0
  },
  {
    id: 'julius',
    name: 'Julius',
    category: 'Writing & collaboration',
    summary: 'Automates structuring and outlining for academic papers.',
    tags: ['writing', 'outline', 'ai', 'paper', 'structure'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Kickstarting paper outlines with AI guidance.',
    alternatives: 'ResearchPal, Trinka.ai',
    link: 'https://www.julius.ai/',
    strengths: ['Structured outlines', 'Templates', 'AI-assisted drafting'],
    provider: 'Julius',
    baseScore: 0
  },
  {
    id: 'latex',
    name: 'LaTeX',
    category: 'Writing & collaboration',
    summary: 'Document preparation system for high-quality typesetting.',
    tags: ['latex', 'typeset', 'pdf', 'math', 'manuscript'],
    cost: 'Free',
    ease: 'Advanced',
    open: true,
    collaboration: false,
    bestFor: 'Producing manuscripts with precise layout and math.',
    alternatives: 'Word with MathType, Markdown',
    link: 'https://www.latex-project.org/',
    strengths: ['Precision typesetting', 'Large package ecosystem', 'Great for math'],
    provider: 'LaTeX Project',
    baseScore: 1
  },
  {
    id: 'litmaps',
    name: 'Litmaps',
    category: 'Literature review tool',
    summary: 'Tracks citation networks to monitor emerging trends and connections.',
    tags: ['literature', 'citations', 'maps', 'discovery'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Visualizing related studies and following new papers.',
    alternatives: 'Connected Papers, ResearchRabbit',
    link: 'https://www.litmaps.com/',
    strengths: ['Citation maps', 'Alerts', 'Collaboration'],
    provider: 'Litmaps',
    baseScore: 1
  },
  {
    id: 'mendeley',
    name: 'Mendeley',
    category: 'Reference management',
    summary: 'Reference manager and academic social network.',
    tags: ['references', 'citation', 'pdf', 'library', 'annotations'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Organizing PDFs and collaborating on shared libraries.',
    alternatives: 'Zotero, EndNote',
    link: 'https://www.mendeley.com/',
    strengths: ['PDF highlights', 'Shared groups', 'Citation plug-ins'],
    provider: 'Elsevier B.V.',
    baseScore: 1
  },
  {
    id: 'mind-the-graph',
    name: 'Mind the Graph',
    category: 'Design & illustration',
    summary: 'Simplifies creation of scientific infographics and diagrams.',
    tags: ['infographic', 'diagram', 'design', 'science visuals'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Illustrating complex ideas for presentations or papers.',
    alternatives: 'BioRender, Canva',
    link: 'https://mindthegraph.com/',
    strengths: ['Scientific icons', 'Templates', 'Drag-and-drop'],
    provider: 'Mind the Graph',
    baseScore: 0
  },
  {
    id: 'minitab',
    name: 'Minitab',
    category: 'Statistics',
    summary: 'Statistical software for data analysis and quality improvement.',
    tags: ['statistics', 'quality', 'analysis', 'hypothesis testing'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: false,
    bestFor: 'Industrial stats, SPC, and hypothesis testing.',
    alternatives: 'SPSS, JASP',
    link: 'https://www.minitab.com/',
    strengths: ['Quality tools', 'Stat guidance', 'Visualization'],
    provider: 'Minitab',
    baseScore: 0
  },
  {
    id: 'nvivo',
    name: 'NVivo',
    category: 'Qualitative analysis',
    summary: 'Designed for qualitative and mixed-method data analysis.',
    tags: ['qualitative', 'coding', 'interviews', 'analysis', 'mixed methods'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Analyzing interviews, surveys, and open-ended responses.',
    alternatives: 'Atlas.ti, MAXQDA',
    link: 'https://www.qsrinternational.com/nvivo-qualitative-data-analysis-software/home',
    strengths: ['Coding tools', 'Mixed methods support', 'Visualization'],
    provider: 'QSR International',
    baseScore: 0
  },
  {
    id: 'omeka',
    name: 'Omeka',
    category: 'Digital collections',
    summary: 'Free, open-source CMS for online digital collections.',
    tags: ['cms', 'digital collections', 'exhibits', 'archives'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'Building online exhibits and digital collections.',
    alternatives: 'CollectionSpace, WordPress + plugins',
    link: 'https://omeka.org/',
    strengths: ['Collections focus', 'Exhibit builder', 'Open-source'],
    provider: 'Roy Rosenzweig Center for History and New Media',
    baseScore: 0
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    category: 'Research database',
    summary: 'Open catalog of papers, authors, institutions, and concepts.',
    tags: ['database', 'api', 'open access', 'metadata', 'citations'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Programmatic access to global scholarly metadata.',
    alternatives: 'Lens.org, Dimensions',
    link: 'https://openalex.org/',
    strengths: ['Open data', 'Rich metadata', 'Graph structure'],
    provider: 'OurResearch',
    baseScore: 2
  },
  {
    id: 'openrefine',
    name: 'OpenRefine',
    category: 'Data cleaning',
    summary: 'Powerful GUI to clean messy tabular data, cluster duplicates, and reshape tables.',
    tags: ['clean', 'data quality', 'deduplicate', 'csv', 'spreadsheet', 'transform'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Cleaning messy CSV/TSV data without writing code.',
    alternatives: 'Trifacta Wrangler, pandas',
    link: 'https://openrefine.org/',
    strengths: ['Clustering', 'Undo/redo steps', 'Preview changes safely'],
    provider: 'OpenRefine',
    baseScore: 2
  },
  {
    id: 'orcid',
    name: 'ORCID',
    category: 'Identifiers',
    summary: 'Persistent digital identifier for researchers.',
    tags: ['identifier', 'profile', 'pid', 'researcher'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Maintaining a unique researcher ID and syncing works.',
    alternatives: 'ResearcherID, Scopus Author ID',
    link: 'https://orcid.org/',
    strengths: ['Persistent ID', 'Profile syncing', 'Widely adopted'],
    provider: 'ORCID, Inc.',
    baseScore: 2
  },
  {
    id: 'osf',
    name: 'Open Science Framework (OSF)',
    category: 'Project management',
    summary: 'Organise projects, preregistrations, storage, and collaboration in one place.',
    tags: ['project', 'preregistration', 'share', 'storage', 'collaboration', 'workflow'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: true,
    bestFor: 'Coordinating studies, preregistering, and sharing materials openly.',
    alternatives: 'Notion, Asana',
    link: 'https://osf.io/',
    strengths: ['Component structure', 'Embeds GitHub/Drive', 'Permission controls'],
    provider: 'Center for Open Science',
    baseScore: 3
  },
  {
    id: 'outread',
    name: 'Outread',
    category: 'Reading',
    summary: 'Guides speed reading to help you comprehend academic texts faster.',
    tags: ['reading', 'speed', 'comprehension', 'mobile'],
    cost: 'Paid',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Covering more literature in less time on mobile devices.',
    alternatives: 'Blinkist, Spritz',
    link: 'https://www.outreadapp.com/',
    strengths: ['Speed reading guides', 'Custom pacing', 'Mobile-focused'],
    provider: 'Outread',
    baseScore: 0
  },
  {
    id: 'overleaf',
    name: 'Overleaf',
    category: 'Writing & collaboration',
    summary: 'Collaborative LaTeX editor with versioning, comments, and templates.',
    tags: ['latex', 'manuscript', 'writing', 'paper', 'collaborate', 'draft'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Drafting papers and preprints with co-authors.',
    alternatives: 'Manubot, Authorea',
    link: 'https://www.overleaf.com/',
    strengths: ['Track changes', 'Journal templates', 'Share links'],
    provider: 'Digital Science & Research Solutions Ltd.',
    baseScore: 2
  },
  {
    id: 'paper-digest',
    name: 'Paper Digest',
    category: 'Literature review tool',
    summary: 'Creates concise summaries of academic papers.',
    tags: ['summary', 'papers', 'ai', 'reading'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Identifying key takeaways of complex studies.',
    alternatives: 'Scholarcy, Enago Read',
    link: 'https://www.paper-digest.com/',
    strengths: ['Concise summaries', 'Key points extraction', 'PDF support'],
    provider: 'Paper Digest',
    baseScore: 0
  },
  {
    id: 'paperbuzz',
    name: 'paperbuzz.org',
    category: 'Altmetrics & impact',
    summary: 'Open source of altmetrics data based on Crossref Event Data.',
    tags: ['altmetrics', 'events', 'citations', 'api'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Pulling open altmetrics signals via API.',
    alternatives: 'Altmetric, PlumX',
    link: 'https://paperbuzz.org/',
    strengths: ['Open data', 'Event-level metrics', 'API access'],
    provider: 'OurResearch',
    baseScore: 0
  },
  {
    id: 'paperpal',
    name: 'Paperpal',
    category: 'Writing & collaboration',
    summary: 'Real-time feedback on grammar, clarity, and academic style.',
    tags: ['grammar', 'style', 'writing', 'ai'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Editing manuscripts for journal submission quality.',
    alternatives: 'Trinka.ai, Grammarly',
    link: 'https://paperpal.com/',
    strengths: ['Academic tone checks', 'Contextual suggestions', 'Journal readiness'],
    provider: 'Cactus Communications',
    baseScore: 0
  },
  {
    id: 'petal',
    name: 'Petal',
    category: 'Reference management',
    summary: 'Annotates and organizes PDFs of research papers.',
    tags: ['pdf', 'annotation', 'notes', 'references'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Keeping track of notes and references across PDFs.',
    alternatives: 'Zotero, ReadCube Papers',
    link: 'https://petal.org/',
    strengths: ['PDF annotation', 'Organization', 'Sync across devices'],
    provider: 'Petal',
    baseScore: 0
  },
  {
    id: 'piktochart',
    name: 'Piktochart',
    category: 'Design & illustration',
    summary: 'Specialises in creating infographics and charts.',
    tags: ['infographic', 'charts', 'design', 'presentation'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Turning data into visually compelling graphics.',
    alternatives: 'Canva, Visme',
    link: 'https://piktochart.com/',
    strengths: ['Infographic templates', 'Charts', 'Team collaboration'],
    provider: 'Piktochart',
    baseScore: 0
  },
  {
    id: 'posit-cloud',
    name: 'Posit Cloud (RStudio)',
    category: 'Notebooks & analysis',
    summary: 'Cloud RStudio with tidyverse pre-installed for data analysis.',
    tags: ['r', 'tidyverse', 'analysis', 'statistics', 'teaching', 'notebook'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'R-based analysis without local installs; good for teaching or teams.',
    alternatives: 'RStudio Desktop, Saturn Cloud',
    link: 'https://posit.cloud/',
    strengths: ['Zero install', 'Projects with collaborators', 'Great for teaching'],
    provider: 'Posit',
    baseScore: 1
  },
  {
    id: 'power-bi',
    name: 'Power BI',
    category: 'Visualization & BI',
    summary: 'Business intelligence tool for data visualization and analysis.',
    tags: ['bi', 'dashboard', 'data viz', 'reports'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Sharing interactive dashboards with stakeholders.',
    alternatives: 'Tableau, Looker Studio',
    link: 'https://powerbi.microsoft.com/',
    strengths: ['Interactive dashboards', 'Microsoft ecosystem', 'Data connectors'],
    provider: 'Microsoft',
    baseScore: 0
  },
  {
    id: 'pressforward',
    name: 'PressForward',
    category: 'Digital collections',
    summary: 'WordPress plugin for maintaining content hubs.',
    tags: ['wordpress', 'aggregation', 'curation', 'plugin'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'Curating and publishing aggregated scholarly content.',
    alternatives: 'RSS aggregators, Omeka plugins',
    link: 'https://pressforward.org/',
    strengths: ['Curation workflow', 'Editorial features', 'Open-source'],
    provider: 'Roy Rosenzweig Center for History and New Media',
    baseScore: 0
  },
  {
    id: 'prezi',
    name: 'Prezi',
    category: 'Presentations',
    summary: 'Enables non-linear, dynamic presentation designs.',
    tags: ['presentation', 'zooming', 'slides', 'design'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Delivering visually captivating, interactive presentations.',
    alternatives: 'Gamma, Canva',
    link: 'https://prezi.com/',
    strengths: ['Zooming UI', 'Templates', 'Web embeds'],
    provider: 'Prezi',
    baseScore: 0
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    category: 'Research database',
    summary: 'Comprehensive database for biomedical and life sciences literature.',
    tags: ['biomedical', 'medicine', 'papers', 'database', 'search'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Searching peer-reviewed biomedical research.',
    alternatives: 'Embase, Web of Science',
    link: 'https://pubmed.ncbi.nlm.nih.gov/',
    strengths: ['Trusted indexing', 'MeSH terms', 'Full-text links'],
    provider: 'U.S. National Library of Medicine (HHS)',
    baseScore: 2
  },
  {
    id: 'pubpeer',
    name: 'PubPeer',
    category: 'Post-publication review',
    summary: 'Platform for anonymous and signed post-publication peer review.',
    tags: ['peer review', 'comments', 'post publication', 'integrity'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: true,
    bestFor: 'Discussing and scrutinizing published research.',
    alternatives: 'PubMed Commons (retired), journal comments',
    link: 'https://pubpeer.com/',
    strengths: ['Anonymity options', 'Paper alerts', 'Community oversight'],
    provider: 'PubPeer Foundation',
    baseScore: 0
  },
  {
    id: 'pubreader',
    name: 'PubReader',
    category: 'Reading',
    summary: 'Formats articles for easier reading on digital devices.',
    tags: ['reading', 'formatting', 'html', 'articles'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Comfortable reading of journal articles online.',
    alternatives: 'ReadCube Papers, paper PDF viewers',
    link: 'https://www.ncbi.nlm.nih.gov/pmc/tools/pubreader/',
    strengths: ['Responsive layout', 'Accessible view', 'Simple navigation'],
    provider: 'NCBI',
    baseScore: 0
  },
  {
    id: 'python',
    name: 'Python',
    category: 'Programming',
    summary: 'General-purpose programming language for data and automation.',
    tags: ['programming', 'analysis', 'automation', 'data', 'notebooks'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'Automating workflows and running advanced analyses.',
    alternatives: 'R, Julia',
    link: 'https://www.python.org/',
    strengths: ['Large ecosystem', 'Libraries for data/ML', 'Community support'],
    provider: 'Python Software Foundation',
    baseScore: 2
  },
  {
    id: 'qgis',
    name: 'QGIS',
    category: 'Mapping & GIS',
    summary: 'Open-source GIS for spatial data visualization and analysis.',
    tags: ['gis', 'mapping', 'spatial', 'vector', 'raster'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'GIS analysis and cartography without proprietary licenses.',
    alternatives: 'ArcGIS, ArcMap',
    link: 'https://qgis.org/',
    strengths: ['Plugin ecosystem', 'Supports many formats', 'Open-source'],
    provider: 'QGIS Project',
    baseScore: 2
  },
  {
    id: 'quarto',
    name: 'Quarto',
    category: 'Reproducible documents',
    summary: 'Author reports, articles, and books that mix prose, code, and outputs.',
    tags: ['reproducible', 'report', 'notebook', 'analysis', 'r', 'python', 'docs', 'book'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: false,
    bestFor: 'Readable, shareable reports where code and results stay in sync.',
    alternatives: 'R Markdown, Jupyter Book',
    link: 'https://quarto.org/',
    strengths: ['Multi-language', 'Citations built-in', 'Publish to web or PDF'],
    provider: 'Posit',
    baseScore: 2
  },
  {
    id: 'r-discovery',
    name: 'R Discovery',
    category: 'Literature review tool',
    summary: 'AI-powered paper recommendations tailored to your interests.',
    tags: ['recommendations', 'papers', 'ai', 'alerts'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Staying up-to-date with new articles in your field.',
    alternatives: 'Semantic Scholar alerts, Google Scholar alerts',
    link: 'https://www.researcher-app.com/rdiscovery',
    strengths: ['Personalized feeds', 'Mobile friendly', 'Topic alerts'],
    provider: 'R Discovery',
    baseScore: 0
  },
  {
    id: 'readcube',
    name: 'ReadCube Papers',
    category: 'Reference management',
    summary: 'Manages PDFs with advanced search and discovery features.',
    tags: ['pdf', 'reference', 'annotations', 'discovery'],
    cost: 'Paid',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Organizing a cloud-based library with discovery features.',
    alternatives: 'Zotero, Mendeley',
    link: 'https://www.papersapp.com/',
    strengths: ['Smart search', 'PDF enhancement', 'Cloud sync'],
    provider: 'Digital Science & Research Solutions Ltd.',
    baseScore: 0
  },
  {
    id: 'research4life',
    name: 'Research4Life',
    category: 'Access & discovery',
    summary: 'Provides institutions in low- and middle-income countries with research access.',
    tags: ['access', 'journals', 'developing countries', 'program'],
    cost: 'Free',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Institutional access to research content in eligible regions.',
    alternatives: 'Local consortia, library access',
    link: 'https://www.research4life.org/',
    strengths: ['Broad publisher participation', 'Capacity building', 'Affordable access'],
    provider: 'UN agencies & partners',
    baseScore: 0
  },
  {
    id: 'researchgate',
    name: 'ResearchGate',
    category: 'Social network',
    summary: 'Platform for sharing research, finding collaborators, and asking questions.',
    tags: ['network', 'collaboration', 'papers', 'profile'],
    cost: 'Free',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Connecting with peers and sharing preprints.',
    alternatives: 'Academia.edu, OSF profiles',
    link: 'https://www.researchgate.net/',
    strengths: ['Researcher profiles', 'Q&A', 'Paper sharing'],
    provider: 'ResearchGate',
    baseScore: 0
  },
  {
    id: 'researchpal',
    name: 'ResearchPal',
    category: 'Reference management',
    summary: 'Creates first-draft literature reviews with real references.',
    tags: ['ai', 'literature review', 'references', 'writing'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Jumpstarting literature review drafts with cited papers.',
    alternatives: 'Elicit, R Discovery',
    link: 'https://researchpal.xyz/',
    strengths: ['AI-generated reviews', 'Reference suggestions', 'Long/short form outputs'],
    provider: 'ResearchPal',
    baseScore: 0
  },
  {
    id: 'reviewmypaper',
    name: 'ReviewMyPaper',
    category: 'Writing & collaboration',
    summary: 'Reviews your paper and points out areas for improvement.',
    tags: ['review', 'feedback', 'ai', 'manuscript'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Receiving structured feedback on drafts.',
    alternatives: 'Paperpal, Trinka.ai',
    link: 'https://reviewmypaper.ai/',
    strengths: ['Targeted suggestions', 'Clarity checks', 'Structure feedback'],
    provider: 'ReviewMyPaper',
    baseScore: 0
  },
  {
    id: 'scholarcy',
    name: 'Scholarcy',
    category: 'Literature review tool',
    summary: 'Breaks down papers into summaries and highlights key points.',
    tags: ['summary', 'highlights', 'ai', 'papers'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Saving time by focusing on the most important sections.',
    alternatives: 'Paper Digest, Enago Read',
    link: 'https://www.scholarcy.com/',
    strengths: ['Flashcards', 'Highlight extraction', 'Reference extraction'],
    provider: 'Scholarcy',
    baseScore: 0
  },
  {
    id: 'sci-hub',
    name: 'Sci-Hub',
    category: 'Access & discovery',
    summary: 'Unofficial repository providing free access to paywalled articles.',
    tags: ['access', 'papers', 'paywall'],
    cost: 'Free',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Accessing paywalled literature (legal status varies).',
    alternatives: 'Unpaywall, Library access',
    link: 'https://sci-hub.se/',
    strengths: ['Broad coverage', 'Immediate access', 'No accounts'],
    provider: 'Independent',
    baseScore: 0
  },
  {
    id: 'scispace',
    name: 'SciSpace',
    category: 'Writing & collaboration',
    summary: 'Helps format scientific papers with templates and compliance checks.',
    tags: ['formatting', 'templates', 'journal requirements', 'writing'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Ensuring manuscripts meet journal formatting guidelines.',
    alternatives: 'Overleaf templates, journal style guides',
    link: 'https://typeset.io/',
    strengths: ['Journal templates', 'Compliance checks', 'Citation tools'],
    provider: 'SciSpace',
    baseScore: 0
  },
  {
    id: 'scite',
    name: 'Scite',
    category: 'Literature review tool',
    summary: 'Shows citation context to see if a paper is supported or contrasted.',
    tags: ['citations', 'context', 'evaluation', 'evidence'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Evaluating the credibility and reception of papers.',
    alternatives: 'Connected Papers, Semantic Scholar',
    link: 'https://scite.ai/',
    strengths: ['Supports/contrasts tags', 'Smart citations', 'Browser extension'],
    provider: 'Scite',
    baseScore: 1
  },
  {
    id: 'scopus',
    name: 'Scopus',
    category: 'Research database',
    summary: 'Large abstract and citation database with analytics.',
    tags: ['database', 'citations', 'analytics', 'metrics'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Precision literature searches and bibliometrics.',
    alternatives: 'Web of Science, Dimensions',
    link: 'https://www.scopus.com/',
    strengths: ['Citation analytics', 'Author profiles', 'Alerts'],
    provider: 'Elsevier B.V.',
    baseScore: 1
  },
  {
    id: 'scribe-ai',
    name: 'Scribe AI',
    category: 'Reading',
    summary: 'Simplifies technical language into layman terms for easier understanding.',
    tags: ['plain language', 'ai', 'reading', 'explain'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Making dense academic text more understandable.',
    alternatives: 'Trinka.ai, Paperpal',
    link: 'https://scribe.rip/',
    strengths: ['Lay summaries', 'Terminology explanations', 'Browser-based'],
    provider: 'Scribe AI',
    baseScore: 0
  },
  {
    id: 'scrivener',
    name: 'Scrivener',
    category: 'Writing & collaboration',
    summary: 'Writing tool designed for long documents, perfect for dissertations and theses.',
    tags: ['writing', 'longform', 'manuscript', 'organization'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: false,
    bestFor: 'Organizing large writing projects with notes and research.',
    alternatives: 'Ulysses, Word',
    link: 'https://www.literatureandlatte.com/scrivener/overview',
    strengths: ['Binder organization', 'Corkboard view', 'Export flexibility'],
    provider: 'Literature & Latte',
    baseScore: 0
  },
  {
    id: 'semantic-scholar',
    name: 'Semantic Scholar',
    category: 'Search engine',
    summary: 'AI-powered scholarly search with citation context and highlights.',
    tags: ['search', 'ai', 'citations', 'papers'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Finding relevant papers with AI summaries and citation context.',
    alternatives: 'Google Scholar, Scite',
    link: 'https://www.semanticscholar.org/',
    strengths: ['AI paper summaries', 'Highly cited sorting', 'PDF highlights'],
    provider: 'Allen Institute for AI (AI2)',
    baseScore: 2
  },
  {
    id: 'sourcery',
    name: 'Sourcery',
    category: 'Digital collections',
    summary: 'Mobile app and community for digitizing archival collections.',
    tags: ['archives', 'digitization', 'mobile', 'collections'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: true,
    bestFor: 'Crowdsourcing digitization of archival materials.',
    alternatives: 'Tropy, Omeka',
    link: 'https://www.sourceryapp.org/',
    strengths: ['Mobile capture', 'Community tagging', 'Open-source'],
    provider: 'Digital Scholarship',
    baseScore: 0
  },
  {
    id: 'springer-nature',
    name: 'Springer Nature',
    category: 'Publisher',
    summary: 'Publisher of Nature, Springer, and BioMed Central journals.',
    tags: ['publisher', 'journals', 'nature', 'open access'],
    cost: 'Paid',
    ease: 'Advanced',
    open: false,
    collaboration: false,
    bestFor: 'Submitting or accessing Springer Nature journals.',
    alternatives: 'Elsevier, Wiley',
    link: 'https://www.springernature.com/',
    strengths: ['High-impact journals', 'Open access options', 'Global reach'],
    provider: 'Springer Nature Group',
    baseScore: 0
  },
  {
    id: 'spss',
    name: 'SPSS',
    category: 'Statistics',
    summary: 'Trusted software for statistical data analysis.',
    tags: ['statistics', 'analysis', 'spss', 'survey'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: false,
    bestFor: 'Running standard statistical procedures with GUI.',
    alternatives: 'Stata, JASP',
    link: 'https://www.ibm.com/products/spss-statistics',
    strengths: ['Extensive procedures', 'GUI driven', 'Widely taught'],
    provider: 'IBM',
    baseScore: 1
  },
  {
    id: 'ssrn',
    name: 'SSRN',
    category: 'Preprints',
    summary: 'Preprint server for social science and humanities research.',
    tags: ['preprint', 'social science', 'economics', 'law'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Sharing early social science papers.',
    alternatives: 'RePEc, arXiv',
    link: 'https://www.ssrn.com/',
    strengths: ['Discipline hubs', 'Early dissemination', 'Author profiles'],
    provider: 'Elsevier',
    baseScore: 0
  },
  {
    id: 'tableau',
    name: 'Tableau',
    category: 'Visualization & BI',
    summary: 'Tool for visualising large datasets in interactive dashboards.',
    tags: ['dashboard', 'visualization', 'data', 'charts'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Communicating complex data insights interactively.',
    alternatives: 'Power BI, Looker Studio',
    link: 'https://www.tableau.com/',
    strengths: ['Interactive dashboards', 'Drag-and-drop', 'Sharing options'],
    provider: 'Salesforce',
    baseScore: 1
  },
  {
    id: 'taylor-francis',
    name: 'Taylor & Francis Online',
    category: 'Publisher',
    summary: 'Publisher with 2,700 journals across disciplines.',
    tags: ['publisher', 'journals', 'taylor and francis'],
    cost: 'Paid',
    ease: 'Advanced',
    open: false,
    collaboration: false,
    bestFor: 'Accessing or submitting to Taylor & Francis journals.',
    alternatives: 'Wiley, Elsevier',
    link: 'https://www.tandfonline.com/',
    strengths: ['Subject breadth', 'Online platform', 'Open access options'],
    provider: 'Taylor & Francis',
    baseScore: 0
  },
  {
    id: 'trinka',
    name: 'Trinka.ai',
    category: 'Writing & collaboration',
    summary: 'AI-powered tool for checking grammar, style, and technical consistency.',
    tags: ['grammar', 'style', 'ai', 'academic writing'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: false,
    bestFor: 'Ensuring academic rigor and proper tone in manuscripts.',
    alternatives: 'Grammarly, Paperpal',
    link: 'https://www.trinka.ai/',
    strengths: ['Technical checks', 'Style guide options', 'Plagiarism alerts'],
    provider: 'Trinka',
    baseScore: 0
  },
  {
    id: 'tropy',
    name: 'Tropy',
    category: 'Digital collections',
    summary: 'Manages photographs of physical collections with rich metadata.',
    tags: ['photos', 'archives', 'metadata', 'organization'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Organizing research photos and archival materials.',
    alternatives: 'Sourcery, Omeka',
    link: 'https://tropy.org/',
    strengths: ['Metadata templates', 'Tagging', 'Open-source'],
    provider: 'Roy Rosenzweig Center for History and New Media',
    baseScore: 0
  },
  {
    id: 'unpaywall',
    name: 'Unpaywall',
    category: 'Access & discovery',
    summary: 'Free database of open access scholarly articles with API and browser extension.',
    tags: ['open access', 'oa', 'api', 'browser extension'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Finding legal open copies of articles.',
    alternatives: 'Open Access Button, Sci-Hub',
    link: 'https://unpaywall.org/',
    strengths: ['Browser extension', 'OA coverage', 'API access'],
    provider: 'OurResearch',
    baseScore: 2
  },
  {
    id: 'unsub',
    name: 'Unsub',
    category: 'Access & discovery',
    summary: 'Dashboard to help libraries evaluate and cancel Big Deal journal bundles.',
    tags: ['subscriptions', 'library', 'analytics', 'journals'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'Assessing journal package value for cancellations.',
    alternatives: 'Homegrown analytics, COUNTER reports',
    link: 'https://unsub.org/',
    strengths: ['Cost modeling', 'Usage analytics', 'Scenario planning'],
    provider: 'OurResearch',
    baseScore: 0
  },
  {
    id: 'visme',
    name: 'Visme',
    category: 'Presentations',
    summary: 'Versatile tool for creating presentations and infographics.',
    tags: ['presentation', 'infographic', 'charts', 'design'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Designing professional slides and visuals for academic audiences.',
    alternatives: 'Canva, Piktochart',
    link: 'https://www.visme.co/',
    strengths: ['Templates', 'Animations', 'Collaboration'],
    provider: 'Visme',
    baseScore: 0
  },
  {
    id: 'vizzlo',
    name: 'Vizzlo',
    category: 'Presentations',
    summary: 'Tools to create professional charts and visual aids.',
    tags: ['charts', 'visualization', 'slides', 'infographic'],
    cost: 'Freemium',
    ease: 'Easy',
    open: false,
    collaboration: true,
    bestFor: 'Designing data-driven visuals for papers or presentations.',
    alternatives: 'Visme, Infogram',
    link: 'https://vizzlo.com/',
    strengths: ['Chart templates', 'PowerPoint integration', 'Custom branding'],
    provider: 'Vizzlo',
    baseScore: 0
  },
  {
    id: 'web-of-science',
    name: 'Web of Science',
    category: 'Research database',
    summary: 'Citation database with curated indexing and analytics.',
    tags: ['citations', 'database', 'analytics', 'research'],
    cost: 'Paid',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Citation tracking and bibliometric analyses.',
    alternatives: 'Scopus, Dimensions',
    link: 'https://www.webofscience.com/',
    strengths: ['Curated indexing', 'Citation maps', 'Journal metrics'],
    provider: 'Clarivate',
    baseScore: 1
  },
  {
    id: 'wiley',
    name: 'Wiley',
    category: 'Publisher',
    summary: 'Publisher with 1,600 peer-reviewed journals and books.',
    tags: ['publisher', 'journals', 'books', 'wiley'],
    cost: 'Paid',
    ease: 'Advanced',
    open: false,
    collaboration: false,
    bestFor: 'Publishing or accessing Wiley journal content.',
    alternatives: 'Taylor & Francis, Elsevier',
    link: 'https://www.wiley.com/',
    strengths: ['Subject breadth', 'Open access options', 'Author resources'],
    provider: 'John Wiley & Sons, Inc.',
    baseScore: 0
  },
  {
    id: 'zenodo',
    name: 'Zenodo',
    category: 'Publishing & archiving',
    summary: 'Archive datasets, code, and papers with DOIs for free.',
    tags: ['doi', 'archive', 'publish', 'dataset', 'code', 'share'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Minting DOIs for datasets, software, and preprints.',
    alternatives: 'Figshare, institutional repos',
    link: 'https://zenodo.org/',
    strengths: ['Free DOIs', 'Versioned uploads', 'Supports large files'],
    provider: 'CERN Data Centre & InvenioRDM',
    baseScore: 3
  },
  {
    id: 'zotero',
    name: 'Zotero',
    category: 'Reference management',
    summary: 'Collect papers, annotate PDFs, and cite while you write in Word or Google Docs.',
    tags: ['citation', 'cite', 'references', 'bibliography', 'papers', 'literature', 'pdf'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: true,
    bestFor: 'Building and sharing literature libraries with instant citations.',
    alternatives: 'Paperpile, Mendeley',
    link: 'https://www.zotero.org/',
    strengths: ['Browser save button', 'Group libraries', 'Word/Docs plug-ins'],
    provider: 'Digital Scholarship',
    baseScore: 3
  },
  {
    id: 'r-language',
    name: 'R',
    category: 'Programming',
    summary: 'Statistical programming language for data analysis and visualization.',
    tags: ['r', 'programming', 'statistics', 'analysis', 'visualization'],
    cost: 'Free',
    ease: 'Intermediate',
    open: true,
    collaboration: true,
    bestFor: 'Statistical modeling, data analysis, and reproducible research.',
    alternatives: 'Python, Julia',
    link: 'https://www.r-project.org/',
    strengths: ['Tidyverse ecosystem', 'Statistical packages', 'Strong community'],
    provider: 'R Foundation',
    baseScore: 2
  },
  {
    id: 'rstudio-desktop',
    name: 'RStudio Desktop',
    category: 'IDE',
    summary: 'Integrated development environment for R with built-in visualization and debugging.',
    tags: ['r', 'ide', 'notebook', 'analysis'],
    cost: 'Free',
    ease: 'Easy',
    open: true,
    collaboration: false,
    bestFor: 'Developing R scripts, notebooks, and Shiny apps locally.',
    alternatives: 'Posit Cloud, VS Code',
    link: 'https://posit.co/download/rstudio-desktop/',
    strengths: ['Notebook mode', 'Package manager', 'Built-in viewer'],
    provider: 'Posit',
    baseScore: 1
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    category: 'IDE',
    summary: 'Python IDE with intelligent code completion and debugging.',
    tags: ['python', 'ide', 'debugging', 'testing'],
    cost: 'Freemium',
    ease: 'Intermediate',
    open: false,
    collaboration: true,
    bestFor: 'Developing robust Python applications and analyses.',
    alternatives: 'VS Code, Spyder',
    link: 'https://www.jetbrains.com/pycharm/',
    strengths: ['Smart editor', 'Refactoring tools', 'Integrated testing'],
    provider: 'JetBrains',
    baseScore: 0
  }
];

const finderState = {
  defaultCount: 4
};

const keywordMatchers = [
  { pattern: /write|manuscript|paper|latex|draft|author/, topic: 'writing' },
  { pattern: /cite|citation|reference|bibliograph/, topic: 'citation' },
  { pattern: /clean|messy|deduplicat|normalize|tidy/, topic: 'cleaning' },
  { pattern: /analysis|stat|model|regression|visuali|python|r\b|notebook|code/, topic: 'analysis' },
  { pattern: /collaborat|team|coauthor|share/, topic: 'collaboration' },
  { pattern: /publish|archive|doi|deposit|repository|data set|dataset/, topic: 'publishing' },
  { pattern: /reproducib|workflow|environment|binder|container/, topic: 'reproducibility' },
  { pattern: /free|budget|open source|no cost/, topic: 'budget' },
  { pattern: /easy|quick|beginner|simple/, topic: 'ease' },
];

function scoreTool(tool, text) {
  const lower = text.toLowerCase();
  let score = tool.baseScore || 0;
  const reasons = [];

  if (!text.trim()) {
    return { score, reasons };
  }

  tool.tags.forEach(tag => {
    if (lower.includes(tag)) {
      score += 3;
      reasons.push(`Mentions ${tag}`);
    }
  });

  keywordMatchers.forEach(({ pattern, topic }) => {
    if (pattern.test(lower)) {
      switch (topic) {
        case 'writing':
          if (tool.category.includes('Writing') || tool.tags.includes('draft')) {
            score += 3;
            reasons.push('Built for writing');
          }
          break;
        case 'citation':
          if (tool.category.includes('Reference') || tool.tags.includes('citation')) {
            score += 3;
            reasons.push('Handles citations');
          }
          break;
        case 'cleaning':
          if (tool.category.includes('Data cleaning')) {
            score += 3;
            reasons.push('Data cleaning workflows');
          }
          break;
        case 'analysis':
          if (tool.category.includes('analysis') || tool.tags.includes('analysis') || tool.tags.includes('notebook')) {
            score += 2;
            reasons.push('Good for analysis/notebooks');
          }
          break;
        case 'collaboration':
          if (tool.collaboration) {
            score += 2;
            reasons.push('Collaboration built-in');
          }
          break;
        case 'publishing':
          if (tool.category.includes('Publishing') || tool.tags.includes('doi')) {
            score += 3;
            reasons.push('Publishes with DOIs');
          }
          break;
        case 'reproducibility':
          if (tool.category.includes('Reproducible') || tool.tags.includes('reproducible') || tool.tags.includes('environment')) {
            score += 2;
            reasons.push('Keeps environments reproducible');
          }
          break;
        case 'budget':
          if (tool.cost === 'Free') {
            score += 2;
            reasons.push('No-cost option');
          } else if (tool.cost === 'Freemium') {
            score += 1;
            reasons.push('Free tier available');
          }
          if (tool.open) {
            score += 1;
            reasons.push('Open-source');
          }
          break;
        case 'ease':
          if (tool.ease === 'Easy') {
            score += 2;
            reasons.push('Low learning curve');
          }
          break;
      }
    }
  });

  return { score, reasons };
}

function renderRecommendations(problemText) {
  const container = document.getElementById('recommendations');
  if (!container) return;

  const scored = toolCatalog
    .map(tool => {
      const { score, reasons } = scoreTool(tool, problemText);
      return { tool, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const meaningful = problemText.trim()
    ? scored.filter(entry => entry.score > 0)
    : scored;

  const picks = (meaningful.length ? meaningful : scored).slice(0, finderState.defaultCount);

  if (!picks.length) {
    container.innerHTML = '<p class="muted">Add a sentence about your task to see recommendations.</p>';
    return;
  }

  container.innerHTML = '';
  picks.forEach(({ tool, score, reasons }) => {
    const reasonText = reasons.length
      ? `Why: ${Array.from(new Set(reasons)).slice(0, 3).join(', ')}.`
      : 'Why: Solid default for open, reproducible workflows.';

    const card = document.createElement('article');
    card.className = 'rec-card';
    card.innerHTML = `
      <div class="rec-head">
        <div>
          <h3>${tool.name}</h3>
          <p class="muted small">${tool.category}</p>
        </div>
        <div class="pill-row">
          <span class="badge">${tool.cost}</span>
          <span class="badge badge-ease">${tool.ease}</span>
          ${tool.open ? '<span class="badge badge-open">Open-source</span>' : ''}
        </div>
      </div>
      <p class="rec-summary">${tool.summary}</p>
      <p class="rec-why">${reasonText}</p>
      <div class="chip-row">
        ${tool.tags.slice(0, 4).map(tag => `<span class="badge">${tag}</span>`).join('')}
      </div>
      <div class="rec-actions">
        <a class="btn btn-secondary" href="${tool.link}" target="_blank" rel="noopener">Open ${tool.name}</a>
        <span class="alt-note">Best for: ${tool.bestFor}${tool.alternatives ? ` · Alternatives: ${tool.alternatives}` : ''}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderToolGrid(list) {
  const grid = document.getElementById('toolGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!list.length) {
    grid.innerHTML = '<p class="muted">No tools match those filters yet.</p>';
    return;
  }

  list.forEach(tool => {
    const card = document.createElement('article');
    card.className = 'tool-card';
    card.innerHTML = `
      <div class="tool-meta">
        <h3>${tool.name}</h3>
        <div class="pill-row">
          <span class="badge">${tool.cost}</span>
          <span class="badge badge-ease">${tool.ease}</span>
          ${tool.open ? '<span class="badge badge-open">Open-source</span>' : ''}
          <span class="badge">${tool.category}</span>
        </div>
      </div>
      <p class="rec-summary">${tool.summary}</p>
      <p class="tool-strengths">Strengths: ${tool.strengths.join(', ')}</p>
      <div class="tool-footer">
        <span class="alt-note">Best for: ${tool.bestFor}</span>
        <a href="${tool.link}" target="_blank" rel="noopener">Visit</a>
      </div>
    `;
    grid.appendChild(card);
  });
}

function applyFilters() {
  const searchTerm = (document.getElementById('problemInput')?.value || '').toLowerCase();
  const category = document.getElementById('categoryFilter')?.value || '';
  const cost = document.getElementById('costFilter')?.value || '';

  const filtered = toolCatalog.filter(tool => {
    const matchesSearch = !searchTerm
      || tool.name.toLowerCase().includes(searchTerm)
      || tool.summary.toLowerCase().includes(searchTerm)
      || tool.bestFor.toLowerCase().includes(searchTerm)
      || tool.tags.some(tag => tag.toLowerCase().includes(searchTerm));

    const matchesCategory = !category || tool.category === category;
    const matchesCost = !cost || tool.cost === cost;

    return matchesSearch && matchesCategory && matchesCost;
  });

  renderToolGrid(filtered);
}

function populateCategories() {
  const select = document.getElementById('categoryFilter');
  if (!select) return;
  const categories = Array.from(new Set(toolCatalog.map(t => t.category))).sort();
  categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const findBtn = document.getElementById('findToolsBtn');
  const problemInput = document.getElementById('problemInput');

  populateCategories();
  renderToolGrid(toolCatalog);
  renderRecommendations(problemInput?.value || '');

  findBtn?.addEventListener('click', () => {
    renderRecommendations(problemInput.value);
    applyFilters();
  });
  problemInput?.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)) {
      renderRecommendations(problemInput.value);
      applyFilters();
    }
  });
  problemInput?.addEventListener('input', () => {
    applyFilters();
    renderRecommendations(problemInput.value);
  });
  document.getElementById('categoryFilter')?.addEventListener('change', applyFilters);
  document.getElementById('costFilter')?.addEventListener('change', applyFilters);
});
