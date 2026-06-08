#!/usr/bin/env node
/**
 * Applique UNE seule migration via la Management API Supabase (PAT).
 * Usage : node scripts/apply-one.mjs 20260607_007_match_stats_pdf.sql
 * Évite de rejouer toutes les migrations (et leurs seeds) comme migrate.mjs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  } catch (e) { /* ignore */ }
}
loadEnv();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];
if (!PROJECT_REF || !PAT) { console.error('❌ SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN manquant'); process.exit(1); }
if (!file) { console.error('❌ Usage: node scripts/apply-one.mjs <fichier.sql>'); process.exit(1); }

const sql = readFileSync(join(repoRoot, 'supabase', 'migrations', file), 'utf8');
console.log(`▸ Application de ${file} via Management API…`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json',
    // User-Agent obligatoire : sans lui, Cloudflare renvoie 403 (cf. playbook).
    'User-Agent': 'playbook-bcl-migrate/1.0',
  },
  body: JSON.stringify({ query: sql }),
});
if (!res.ok) {
  const body = await res.text();
  console.error(`❌ Management API ${res.status}: ${body.slice(0, 800)}`);
  process.exit(2);
}
console.log('✓ Migration appliquée avec succès.');
