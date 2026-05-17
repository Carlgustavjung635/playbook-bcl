#!/usr/bin/env node
/**
 * Runner de migrations Supabase.
 *
 * Lit .env.local et applique tous les fichiers de supabase/migrations/*.sql
 * dans l'ordre lexicographique. Idempotent (les migrations utilisent CREATE ...
 * IF NOT EXISTS et upsert pour les seeds).
 *
 * Deux modes de connexion (auto-détection) :
 *
 *   A) Management API   — env SUPABASE_ACCESS_TOKEN=sbp_xxx
 *      (Personal Access Token : https://app.supabase.com/account/tokens)
 *      → POST https://api.supabase.com/v1/projects/<ref>/database/query
 *
 *   B) Direct pg        — env SUPABASE_DB_URL=postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres
 *      (le mot de passe DB est dans Project Settings → Database → Connection string)
 *      → connexion psql directe via 'pg'
 *
 * Le `sb_secret_*` (service_role key) NE suffit PAS — l'API admin ne l'accepte pas.
 *
 * Usage : node scripts/migrate.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// --- Charger .env.local manuellement (pas de dépendance dotenv) ---
function loadEnv() {
  try {
    const content = readFileSync(join(repoRoot, '.env.local'), 'utf8');
    content.split('\n').forEach(line => {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* pas de .env.local, on lit juste les env */ }
}
loadEnv();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const PAT         = process.env.SUPABASE_ACCESS_TOKEN;       // sbp_*
const DB_URL      = process.env.SUPABASE_DB_URL;             // postgres://...

if (!PROJECT_REF) {
  console.error('❌ SUPABASE_PROJECT_REF manquant dans .env.local');
  process.exit(1);
}

// --- Choix du runner ---
async function runSqlViaManagementApi(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status}: ${body.slice(0, 500)}`);
  }
  return await res.json();
}

async function runSqlViaPg(sql) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

let runner = null;
let runnerLabel = '';
if (PAT) {
  runner = runSqlViaManagementApi;
  runnerLabel = 'Management API (PAT)';
} else if (DB_URL) {
  runner = runSqlViaPg;
  runnerLabel = 'Direct pg connection';
} else {
  console.error(`
❌ Aucune credential exploitable trouvée.

Le projet 'sb_secret_*' (service_role) ne permet PAS d'exécuter du DDL via API.
Tu dois fournir l'une de ces deux variables dans .env.local :

  Option A — Personal Access Token (recommandé, 30 sec à créer) :
    1. https://app.supabase.com/account/tokens → "Generate new token"
    2. Ajouter dans .env.local :
       SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxx

  Option B — URL Postgres directe (si tu connais le mot de passe DB) :
    1. Dashboard → Project Settings → Database → "Connection string" → URI
    2. Ajouter dans .env.local :
       SUPABASE_DB_URL=postgresql://postgres:<password>@db.${PROJECT_REF}.supabase.co:5432/postgres

  Option C — Manuel (1 min) :
    Coller supabase/migrations/20260517_initial.sql dans
    https://app.supabase.com/project/${PROJECT_REF}/sql/new → Run
`);
  process.exit(2);
}

console.log(`▸ Mode : ${runnerLabel}`);

// --- Lister et appliquer les migrations ---
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
if (!files.length) {
  console.error('❌ Aucun fichier .sql dans supabase/migrations/');
  process.exit(1);
}

console.log(`▸ ${files.length} migration(s) à appliquer`);

for (const f of files) {
  const sql = readFileSync(join(migrationsDir, f), 'utf8');
  process.stdout.write(`  ▸ ${f} … `);
  try {
    await runner(sql);
    console.log('✓');
  } catch (e) {
    console.log('✗');
    console.error(`\n❌ Échec sur ${f}:\n${e.message}\n`);
    process.exit(3);
  }
}

console.log('\n✓ Migrations appliquées avec succès.');
console.log('Lance ensuite :  node scripts/smoke.mjs');
