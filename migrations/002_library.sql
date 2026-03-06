-- Library table for saved papers
CREATE TABLE IF NOT EXISTS library (
  id SERIAL PRIMARY KEY,
  orcid VARCHAR(255) NOT NULL,
  doi VARCHAR(500) NOT NULL,
  title TEXT,
  authors JSONB,
  year INTEGER,
  journal VARCHAR(500),
  tags TEXT[],
  notes TEXT,
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(orcid, doi)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_library_orcid ON library(orcid);
CREATE INDEX IF NOT EXISTS idx_library_doi ON library(doi);
CREATE INDEX IF NOT EXISTS idx_library_added_at ON library(added_at DESC);

-- Foreign key (only if users table exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
    ALTER TABLE library DROP CONSTRAINT IF EXISTS library_orcid_fkey;
    ALTER TABLE library ADD CONSTRAINT library_orcid_fkey 
      FOREIGN KEY (orcid) REFERENCES users(orcid) ON DELETE CASCADE;
  END IF;
END $$;
