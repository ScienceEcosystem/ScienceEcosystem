# ScienceEcosystem

Discover research papers and see the data and code behind them.

## What is ScienceEcosystem?

ScienceEcosystem helps researchers:
- **Search** 200M+ papers from OpenAlex
- **Discover** linked datasets and code repositories
- **Access** materials from OSF, GitHub, Zenodo, Figshare, and more
- **Build** personal research libraries
- **Visualize** knowledge graphs and connections

## Core Features

1. **Search & Discovery** - Find papers, authors, topics, institutions, journals, and funders
2. **Data-Code Linking** - Automatically detect linked datasets and code for any paper
3. **Personal Library** - Save and organize papers you care about
4. **Research Tools** - Curated directory of tools for researchers
5. **Reproducibility Scores** - See which papers have accessible materials

## Quick Start

### Prerequisites
- Node.js 16+
- PostgreSQL 12+

### Installation
```bash
# Clone repository
git clone https://github.com/yourusername/scienceecosystem.git
cd scienceecosystem

# Install dependencies
npm install

# Set up database
createdb scienceecosystem
psql scienceecosystem < migrations/001_users.sql
psql scienceecosystem < migrations/002_library.sql

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start server
npm start
```

### Environment Variables
```
DATABASE_URL=postgresql://user:password@localhost/scienceecosystem
SESSION_SECRET=your-secret-key
ORCID_CLIENT_ID=your-orcid-client-id
ORCID_CLIENT_SECRET=your-orcid-client-secret
ORCID_REDIRECT_URI=http://localhost:3000/auth/orcid/callback

```
