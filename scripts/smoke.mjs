#!/usr/bin/env node
/**
 * Smoke test post-migration.
 *
 * Utilise le service_role key (sb_secret_*) contre PostgREST pour :
 *   1. Vérifier que les 17 tables attendues existent (via openapi)
 *   2. Insérer un match de test, un live_event, vérifier le RPC verify_pin
 *   3. Cleanup
 *
 * Ne fait AUCUN appel admin destructif. Tout est marqué __smoke__ et nettoyé.
 *
 * Usage : node scripts/smoke.mjs
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
  } catch (e) {}
}
loadEnv();

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('❌ SUPABASE_URL ou SUPABASE_SECRET_KEY manquant dans .env.local');
  process.exit(1);
}

const baseHeaders = {
  'apikey': KEY,
  'Authorization': `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

let pass = 0, fail = 0;
function ok(label)   { console.log(`  ✓ ${label}`); pass++; }
function ko(label, e){ console.log(`  ✗ ${label}\n     → ${e}`); fail++; }

// ---- 1. Vérifier la présence des tables via OpenAPI ----
console.log('▸ 1/4  Schéma OpenAPI / tables');
const expectedTables = [
  'profiles','players','players_public','plays','custom_concepts','matches',
  'match_player_stats','match_feedback','live_events','challenges',
  'challenge_scores','convocations','convocation_responses','lineups',
  'ffbb_config','team_reviews','offseason_program','offseason_logs'
  // team_pins est volontairement non exposée (pas de policy SELECT)
];

const swaggerRes = await fetch(`${URL}/rest/v1/`, { headers: baseHeaders });
const swagger = await swaggerRes.json();
const tablesFound = Object.keys(swagger.definitions || {});
for (const t of expectedTables) {
  if (tablesFound.includes(t)) ok(`table/vue ${t}`);
  else ko(`table/vue ${t} manquante`, 'absente du swagger');
}

// ---- 2. Insert + read sur un match ----
console.log('\n▸ 2/4  Écriture/lecture matches (service_role bypass RLS)');
const SMOKE_MATCH_ID = '__smoke_m__';
try {
  // Cleanup éventuel
  await fetch(`${URL}/rest/v1/matches?id=eq.${SMOKE_MATCH_ID}`, { method: 'DELETE', headers: baseHeaders });

  const ins = await fetch(`${URL}/rest/v1/matches`, {
    method: 'POST',
    headers: { ...baseHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify({
      id: SMOKE_MATCH_ID,
      date: '2026-05-17',
      opponent: 'SMOKE_TEST',
      home: true,
      score_us: 0, score_opp: 0,
      public_live: true   // pour autoriser live_events anon
    })
  });
  if (!ins.ok) throw new Error(`insert HTTP ${ins.status}: ${await ins.text()}`);
  ok('INSERT match');

  const sel = await fetch(`${URL}/rest/v1/matches?id=eq.${SMOKE_MATCH_ID}&select=*`, { headers: baseHeaders });
  const rows = await sel.json();
  if (rows.length === 1 && rows[0].opponent === 'SMOKE_TEST') ok('SELECT match');
  else throw new Error('lecture incohérente');
} catch (e) { ko('matches I/O', e.message); }

// ---- 3. live_events avec trigger d'enforcement ----
console.log('\n▸ 3/4  live_events (trigger enforce_open_match)');
try {
  const ev = await fetch(`${URL}/rest/v1/live_events`, {
    method: 'POST',
    headers: { ...baseHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify({
      match_id: SMOKE_MATCH_ID,
      player_id: null,
      key: 'opp',
      inc: 2,
      value: 2,
      label: 'smoke +2 adverse'
    })
  });
  if (!ev.ok) throw new Error(`HTTP ${ev.status}: ${await ev.text()}`);
  ok('INSERT live_event (match public_live=true)');

  // Mettre public_live à false → l'INSERT suivant doit échouer (trigger)
  await fetch(`${URL}/rest/v1/matches?id=eq.${SMOKE_MATCH_ID}`, {
    method: 'PATCH', headers: baseHeaders,
    body: JSON.stringify({ public_live: false })
  });
  const ev2 = await fetch(`${URL}/rest/v1/live_events`, {
    method: 'POST', headers: baseHeaders,
    body: JSON.stringify({ match_id: SMOKE_MATCH_ID, key: 'opp', inc: 1 })
  });
  if (ev2.status >= 400) ok('REJECT live_event quand match fermé (trigger)');
  else ko('le trigger devrait avoir rejeté l\'INSERT', `HTTP ${ev2.status}`);
} catch (e) { ko('live_events', e.message); }

// ---- 4. RPC verify_pin ----
console.log('\n▸ 4/4  RPC verify_pin (PIN par défaut 1234 / 0000)');
try {
  const r1 = await fetch(`${URL}/rest/v1/rpc/verify_pin`, {
    method: 'POST', headers: baseHeaders,
    body: JSON.stringify({ p_role: 'coach', p_player_id: null, p_pin: '1234' })
  });
  const v1 = await r1.json();
  if (v1 === true) ok('verify_pin(coach, 1234) → true');
  else ko('verify_pin(coach, 1234)', `attendu true, reçu ${JSON.stringify(v1)}`);

  const r2 = await fetch(`${URL}/rest/v1/rpc/verify_pin`, {
    method: 'POST', headers: baseHeaders,
    body: JSON.stringify({ p_role: 'coach', p_player_id: null, p_pin: '9999' })
  });
  const v2 = await r2.json();
  if (v2 === false) ok('verify_pin(coach, 9999) → false');
  else ko('verify_pin(coach, 9999)', `attendu false, reçu ${JSON.stringify(v2)}`);

  const r3 = await fetch(`${URL}/rest/v1/rpc/verify_pin`, {
    method: 'POST', headers: baseHeaders,
    body: JSON.stringify({ p_role: 'player', p_player_id: 'pl1', p_pin: '0000' })
  });
  const v3 = await r3.json();
  if (v3 === true) ok('verify_pin(player pl1, 0000) → true');
  else ko('verify_pin(player pl1)', `attendu true, reçu ${JSON.stringify(v3)}`);
} catch (e) { ko('verify_pin', e.message); }

// ---- Cleanup ----
await fetch(`${URL}/rest/v1/live_events?match_id=eq.${SMOKE_MATCH_ID}`, { method: 'DELETE', headers: baseHeaders });
await fetch(`${URL}/rest/v1/matches?id=eq.${SMOKE_MATCH_ID}`, { method: 'DELETE', headers: baseHeaders });

console.log(`\n=== ${pass} OK / ${fail} KO ===`);
process.exit(fail > 0 ? 1 : 0);
