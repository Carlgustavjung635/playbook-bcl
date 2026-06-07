#!/usr/bin/env node
/**
 * Applique UNE seule migration Supabase via la Management API.
 *
 * Pourquoi pas migrate.mjs : ce dernier rejoue TOUTES les migrations dans
 * l'ordre, et certaines anciennes ne sont pas idempotentes (plantent au replay).
 * Ce script applique exactement le fichier passé en argument.
 *
 * Usage : node scripts/apply-one.mjs supabase/migrations/20260607_010_chrono_teams.sql
 *
 * Lit SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN (sbp_*) depuis .env.local.
 * Un en-tête User-Agent est OBLIGATOIRE : sans lui, Cloudflare renvoie 403 sur
 * l'API Management de Supabase.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function loadEnv() {
  try {
    const content = readFileSync(join(repoRoot, '.env.local'), 'utf8');
    content.split('\n').forEach(line => {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* lit juste les env du process */ }
}
loadEnv();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];

if (!PROJECT_REF || !PAT) {
  console.error('❌ SUPABASE_PROJECT_REF et SUPABASE_ACCESS_TOKEN (sbp_*) requis dans .env.local');
  process.exit(1);
}
if (!file) {
  console.error('❌ Usage : node scripts/apply-one.mjs <chemin/migration.sql>');
  process.exit(1);
}

const sql = readFileSync(resolve(repoRoot, file), 'utf8');
console.log(`▸ Application de ${file} sur le projet ${PROJECT_REF} …`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
    'User-Agent': 'playbook-bcl-migrate/1.0', // sans UA → Cloudflare 403
  },
  body: JSON.stringify({ query: sql }),
});

if (!res.ok) {
  console.error(`✗ Management API ${res.status}: ${(await res.text()).slice(0, 600)}`);
  process.exit(3);
}
console.log('✓ Migration appliquée avec succès.');
