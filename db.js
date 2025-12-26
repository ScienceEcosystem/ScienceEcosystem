const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn("[db] DATABASE_URL not set; database calls will fail.");
}

// Neon requires SSL; channel_binding requirement is handled via connection string.
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    create table if not exists users (
      orcid text primary key,
      name text,
      affiliation text,
      bio text,
      keywords text[],
      languages text[],
      links text[],
      visibility text default 'public',
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
  `);
}

async function upsertUser(orcid, data = {}) {
  const { name = null, affiliation = null, bio = null, keywords = null, languages = null, links = null, visibility = null } = data;
  await pool.query(
    `
    insert into users (orcid, name, affiliation, bio, keywords, languages, links, visibility)
    values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (orcid) do update set
      name = coalesce(excluded.name, users.name),
      affiliation = coalesce(excluded.affiliation, users.affiliation),
      bio = coalesce(excluded.bio, users.bio),
      keywords = coalesce(excluded.keywords, users.keywords),
      languages = coalesce(excluded.languages, users.languages),
      links = coalesce(excluded.links, users.links),
      visibility = coalesce(excluded.visibility, users.visibility),
      updated_at = now();
    `,
    [orcid, name, affiliation, bio, keywords, languages, links, visibility]
  );
}

async function getUser(orcid) {
  const { rows } = await pool.query(`select * from users where orcid=$1`, [orcid]);
  return rows[0] || null;
}

async function updateProfile(orcid, data) {
  const { name, affiliation, bio, keywords, languages, links, visibility } = data;
  const { rows } = await pool.query(
    `
    update users set
      name = $2,
      affiliation = $3,
      bio = $4,
      keywords = $5,
      languages = $6,
      links = $7,
      visibility = $8,
      updated_at = now()
    where orcid = $1
    returning *;
    `,
    [orcid, name, affiliation, bio, keywords, languages, links, visibility]
  );
  return rows[0] || null;
}

module.exports = {
  pool,
  init,
  upsertUser,
  getUser,
  updateProfile,
};
