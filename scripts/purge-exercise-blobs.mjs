// Purge des photos et PDF stockés en base64 DANS les plans d'entraînement
// PASSÉS (training_plans.instance_date < aujourd'hui).
//
// Pourquoi : un data:image/jpeg pèse ~200-470 Ko et un PDF jusqu'à 6,7 Mo une
// fois en base64. Tout ça vit dans localStorage (plafond ~5 Mo sur Safari iOS),
// d'où le bandeau « Enregistrement local incomplet ». La compression LZ n'y peut
// rien : du base64 ne se compresse quasiment pas.
//
// ⚠️ DESTRUCTIF ET IRRÉVERSIBLE côté serveur. Les photos purgées n'existent
// nulle part ailleurs — d'où la sauvegarde OBLIGATOIRE écrite avant tout UPDATE
// (dans Backups/, qui est gitignoré). Rien n'est touché sans --apply.
//
//   node scripts/purge-exercise-blobs.mjs            # inventaire seul, 0 écriture
//   node scripts/purge-exercise-blobs.mjs --apply    # sauvegarde PUIS purge
//
// Ne touche JAMAIS :
//   - les séances d'aujourd'hui et à venir ;
//   - les images déjà servies par une URL (http…) — seul le base64 part ;
//   - les animations, groupes, notes, validations : le reste du plan est intact.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Transformation pure (testée par scripts/test-purge-exercise-blobs.mjs) --
// Renvoie { plan, removedImages, removedFiles, freedBytes } sans muter l'entrée.
export function stripPlan(plan) {
  const out = JSON.parse(JSON.stringify(plan || {}));
  let removedImages = 0, removedFiles = 0, freedBytes = 0;
  const isB64 = v => typeof v === 'string' && v.startsWith('data:');
  const exercises = Array.isArray(out.exercises) ? out.exercises : [];
  for (const ex of exercises) {
    if (Array.isArray(ex.images)) {
      const kept = [];
      for (const img of ex.images) {
        if (isB64(img)) { removedImages++; freedBytes += img.length; }
        else kept.push(img);
      }
      ex.images = kept;
    }
    if (Array.isArray(ex.attachments)) {
      const kept = [];
      for (const att of ex.attachments) {
        if (att && isB64(att.data)) { removedFiles++; freedBytes += att.data.length; }
        else kept.push(att);
      }
      ex.attachments = kept;
    }
  }
  return { plan: out, removedImages, removedFiles, freedBytes };
}

// --- À partir d'ici : I/O réseau (rien n'est exécuté à l'import) -------------
function env() {
  const e = {};
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) e[m[1]] = m[2].trim();
  }
  if (!e.SUPABASE_ACCESS_TOKEN || !e.SUPABASE_PROJECT_REF) {
    throw new Error('SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF requis dans .env.local');
  }
  return e;
}

// Management API. Le header User-Agent est OBLIGATOIRE : sans lui Cloudflare
// renvoie 403 « error code: 1010 ».
async function sql(e, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${e.SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + e.SUPABASE_ACCESS_TOKEN,
      'Content-Type': 'application/json',
      'User-Agent': 'playbook-purge/1.0',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (res.status !== 200 && res.status !== 201) throw new Error(`HTTP ${res.status} — ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : [];
}

const ko = n => (n / 1024).toFixed(0) + ' Ko';
// Guillemet dollar : le JSON ne contient jamais ce marqueur, donc aucun
// échappement à bricoler (et aucune injection possible depuis le contenu).
const lit = s => '$pbpurge$' + s + '$pbpurge$';

async function main() {
  const apply = process.argv.includes('--apply');
  const e = env();

  console.log('Lecture des plans PASSÉS contenant du base64…');
  const rows = await sql(e, `
    select id, instance_date, plan
    from training_plans
    where instance_date < current_date
      and plan::text like '%data:%'
      and jsonb_typeof(plan->'exercises') = 'array'
    order by instance_date
  `);
  if (!rows.length) { console.log('Rien à purger.'); return; }

  const plans = [];
  let img = 0, pdf = 0, bytes = 0;
  for (const r of rows) {
    const s = stripPlan(r.plan);
    if (!s.removedImages && !s.removedFiles) continue;
    plans.push({ id: r.id, instance_date: r.instance_date, next: s.plan });
    img += s.removedImages; pdf += s.removedFiles; bytes += s.freedBytes;
    console.log(`  ${r.instance_date}  ${r.id}  −${s.removedImages} photo(s) −${s.removedFiles} PDF  (${ko(s.freedBytes)})`);
  }
  console.log(`\n${plans.length} plan(s) · ${img} photo(s) · ${pdf} PDF · ${ko(bytes)} libérés`);

  if (!apply) { console.log('\nINVENTAIRE SEUL — aucune écriture. Relancer avec --apply.'); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(ROOT, 'Backups', `purge-exos-${stamp}.json`);
  mkdirSync(join(ROOT, 'Backups'), { recursive: true });
  // La sauvegarde contient les plans AVANT purge, tels quels : c'est le seul
  // exemplaire restant des photos supprimées.
  writeFileSync(backup, JSON.stringify(rows, null, 2));
  console.log(`\nSauvegarde écrite : ${backup}`);

  // updated_at = now() : la garde anti-écho de l'apply() côté client ne prend le
  // remote que s'il est STRICTEMENT plus récent. Sans ce bump, un appareil avec
  // l'ancien plan en mémoire repousserait le base64 au flush suivant.
  for (let i = 0; i < plans.length; i += 10) {
    const chunk = plans.slice(i, i + 10);
    await sql(e, chunk.map(p =>
      `update training_plans set plan = ${lit(JSON.stringify(p.next))}::jsonb, updated_at = now() where id = ${lit(p.id)};`
    ).join('\n'));
    console.log(`  purgé ${Math.min(i + 10, plans.length)}/${plans.length}`);
  }

  const reste = await sql(e, `
    select count(*) as n from training_plans
    where instance_date < current_date and plan::text like '%data:%'
  `);
  console.log(`\nTerminé. Plans passés contenant encore du base64 : ${reste[0].n}`);
}

// Comparaison de chemin EXACTE : un endsWith() matchait le fichier de test
// (test-purge-exercise-blobs.mjs), donc un simple import lançait la purge.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error('ÉCHEC —', err.message); process.exitCode = 1; });
}
