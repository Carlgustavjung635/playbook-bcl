-- ============================================================================
-- Migration : 25 EXOS DE DÉPART POUR LA MACHINE À SOUS
-- ----------------------------------------------------------------------------
-- La 20260816_004 a livré le casino, mais elle n'a rien mis dans les rouleaux.
-- Or `ardoiseLibraryReady()` (index.html) exige AU MOINS un rouleau garni : sur
-- une base vierge, la machine refuse de tourner et une joueuse ardoisée reste
-- bloquée en `pending_draw` — l'écran lui dit « le coach n'a pas encore rentré
-- d'exercices », ce qui est vrai mais ne se répare que par 25 saisies à la main.
--
-- Cette migration remplit les cinq rouleaux, 5 exos chacun :
--   💪 bras · 🦵 jambes · 🧠 gainage · 🧘 mobilite · 🔥 cardio
--
-- Avec 5 exos par catégorie et 4 exos par spin, le tirage produit déjà plus de
-- 600 programmes distincts — la jauge de l'écran coach passe donc au vert dès
-- l'application, et `random_seed_isolation` a de quoi écarter le programme
-- précédent sans jamais vider un rouleau.
--
-- ----------------------------------------------------------------------------
-- CE SONT DES SUGGESTIONS, PAS UN BARÈME
-- ----------------------------------------------------------------------------
-- `default_sets` / `default_reps` / `default_duration_sec` sont documentés dans
-- la 20260815_001 comme des SUGGESTIONS : la dose est RECOPIÉE dans la dette au
-- moment du tirage (`ardoise_assignments.items`). Le coach peut donc corriger
-- ces valeurs — ou supprimer un exo qui ne lui plaît pas — sans jamais réécrire
-- une dette déjà tirée. Le niveau visé est « moyen » : rien ici n'est
-- infaisable en chambre, sans matériel, par une joueuse au repos forcé.
--
-- Il n'y a PAS de colonne `level` sur `exo_templates` : la notion de niveau
-- vivait sur `ardoise_menus.level` (⭐ starter → 🌋 feu), et cette table est
-- legacy depuis la 20260816_004. Le niveau se lit donc dans la dose et dans la
-- description, pas dans une colonne.
--
-- `illustration_url` et `drill_id` restent NULL : aucun média n'est inventé ici.
-- Le coach associe un drill quand il en a un (lien vivant, cf. 20260816_003) et
-- le bouton « ▶ Lancer » apparaît alors tout seul sur la carte de la joueuse.
--
-- ----------------------------------------------------------------------------
-- IDEMPOTENCE : DEUX VERROUS, ET AUCUN NE CRÉE DE CONTRAINTE
-- ----------------------------------------------------------------------------
--   1. `on conflict (id) do nothing` — les id sont FIXES (`seed-ard-…`), donc
--      rejouer la migration ne peut rien dupliquer, même après que le coach a
--      renommé un exo seedé.
--   2. un `where not exists` sur la CLÉ NATURELLE (nom insensible à la casse +
--      catégorie, hors corbeille) — si le coach a déjà saisi « Squats » à la
--      main avant d'appliquer ce fichier, on ne lui en pose pas un deuxième.
--
-- Volontairement PAS d'index unique sur (name, category) : ce serait une
-- contrainte permanente posée pour les besoins d'un seed, et elle ferait
-- échouer une saisie coach parfaitement légitime (deux variantes d'un même nom
-- dans deux équipes). Le `where not exists` protège l'insert sans rien imposer
-- à la suite de la vie de la table.
--
-- Le préfixe d'id est `seed-ard-`, PAS `x…` : un id `x…` est celui que les
-- clients fabriquent (`uid()`), et une ligne d'id `x…` supprimée en base est
-- repoussée au prochain flush par n'importe quel appareil qui l'a en cache. Un
-- exo seedé doit rester supprimable pour de vrai (soft-delete côté app, ou
-- DELETE en base).
--
-- Additive et idempotente. Aucune donnée existante n'est réécrite.
-- ============================================================================

do $$
begin
  if to_regclass('public.exo_templates') is null then
    raise exception 'Applique d''abord 20260815_001_ardoise.sql (la bibliothèque d''exercices).';
  end if;
end $$;

insert into public.exo_templates
  (id, name, category, default_sets, default_reps, default_duration_sec, default_rest_sec, description_md, created_by)
select v.id, v.name, v.category, v.sets, v.reps, v.dur, v.rest, v.descr, 'seed'
from (values
  -- 💪 BRAS ------------------------------------------------------------------
  ('seed-ard-bras-pompes-classiques', 'Pompes classiques',      'bras', 3, 12, null, 30,
   'Mains à plat, largeur d''épaules. Corps gainé de la tête aux talons, coudes à 45°. Sur les genoux si la ligne casse.'),
  ('seed-ard-bras-pompes-diamant',    'Pompes diamant',         'bras', 3, 10, null, 30,
   'Mains jointes sous la poitrine, index et pouces en losange. Coudes le long du corps — ça travaille les triceps.'),
  ('seed-ard-bras-dips-chaise',       'Dips chaise',            'bras', 3, 12, null, 30,
   'Assise au bord d''une chaise stable, mains de part et d''autre des hanches. Descendre en pliant les coudes vers l''arrière.'),
  ('seed-ard-bras-curl-bouteille',    'Curl bouteille d''eau',  'bras', 3, 15, null, 30,
   'Une bouteille pleine dans chaque main (1,5 L ≈ 1,5 kg). Coudes collés au corps, montée lente, descente encore plus lente.'),
  ('seed-ard-bras-planche-lat-bras',  'Planche latérale bras',  'bras', 3, null, 30, 30,
   'Sur la main, bras tendu, corps en ligne. 30 s de CHAQUE côté. Le poids reste sur l''épaule, pas écrasé dedans.'),

  -- 🦵 JAMBES ----------------------------------------------------------------
  ('seed-ard-jambes-squats',          'Squats',                 'jambes', 3, 15, null, 30,
   'Pieds largeur de bassin, poids sur les talons. Descendre jusqu''à cuisses parallèles, dos droit, genoux dans l''axe des pieds.'),
  ('seed-ard-jambes-fentes-avant',    'Fentes avant',           'jambes', 3, 10, null, 30,
   '10 répétitions PAR JAMBE. Grand pas en avant, genou arrière vers le sol sans le toucher, buste vertical.'),
  ('seed-ard-jambes-chaise-mur',      'Chaise contre mur',      'jambes', 3, null, 45, 30,
   'Dos plaqué au mur, cuisses parallèles au sol, genoux à 90°. 45 s sans poser les mains sur les cuisses.'),
  ('seed-ard-jambes-jump-squats',     'Jump squats',            'jambes', 3, 12, null, 30,
   'Squat complet puis détente explosive. Réception amortie sur la plante des pieds, genoux souples. À éviter si les genoux tirent.'),
  ('seed-ard-jambes-mollets-debout',  'Mollets debout',         'jambes', 3, 20, null, 30,
   'Debout, montée sur la pointe des pieds, pause d''une seconde en haut, descente contrôlée. Sur une marche pour plus d''amplitude.'),

  -- 🧠 GAINAGE ---------------------------------------------------------------
  ('seed-ard-gainage-planche',        'Planche classique',      'gainage', 3, null, 45, 30,
   'Appui sur les avant-bras, coudes sous les épaules. Fessiers serrés, bassin ni creusé ni en pont. 45 s sans retenir sa respiration.'),
  ('seed-ard-gainage-planche-lat',    'Planche latérale',       'gainage', 3, null, 30, 30,
   'Sur l''avant-bras, hanches hautes, corps en ligne. 30 s de CHAQUE côté.'),
  ('seed-ard-gainage-hollow-body',    'Hollow body',            'gainage', 3, null, 30, 30,
   'Allongée sur le dos, lombaires PLAQUÉES au sol, bras et jambes décollés. Si le bas du dos se creuse : rapprocher les genoux.'),
  ('seed-ard-gainage-dead-bug',       'Dead bug',               'gainage', 3, 10, null, 30,
   '10 répétitions PAR CÔTÉ. Sur le dos, bras et genoux au plafond ; on tend le bras et la jambe OPPOSÉS, lentement, dos collé au sol.'),
  ('seed-ard-gainage-bird-dog',       'Bird dog',               'gainage', 3, 12, null, 30,
   '12 répétitions PAR CÔTÉ. À quatre pattes, on tend bras et jambe opposés à l''horizontale. Le bassin ne pivote pas.'),

  -- 🧘 MOBILITÉ / SOUPLESSE --------------------------------------------------
  ('seed-ard-mobilite-cat-cow',       'Cat-cow',                'mobilite', 2, 10, null, 15,
   'À quatre pattes : on creuse le dos en inspirant, on l''arrondit en expirant. Lent, sur le rythme de la respiration.'),
  ('seed-ard-mobilite-wgs',           'World''s greatest stretch', 'mobilite', 2, 5, null, 15,
   '5 répétitions PAR CÔTÉ. Fente avant, main au sol côté intérieur, puis ouverture du buste bras au plafond. L''étirement le plus complet du lot.'),
  ('seed-ard-mobilite-rot-hanches',   'Rotation hanches',       'mobilite', 2, 10, null, 15,
   '10 rotations PAR CÔTÉ. Debout, genou monté à hauteur de hanche, on ouvre vers l''extérieur puis on referme. Amplitude maximale, sans forcer.'),
  ('seed-ard-mobilite-ischios',       'Étirement ischios',      'mobilite', 2, null, 30, 15,
   '30 s PAR JAMBE. Talon posé devant, jambe tendue, on bascule le BASSIN vers l''avant (dos droit — ce n''est pas le dos qui s''arrondit).'),
  ('seed-ard-mobilite-cercles-epaules','Cercles épaules',       'mobilite', 2, 15, null, 15,
   '15 cercles DANS CHAQUE SENS. Bras tendus, grands cercles lents. Idéal en fin de séance ou au réveil.'),

  -- 🔥 CARDIO ----------------------------------------------------------------
  ('seed-ard-cardio-burpees',         'Burpees',                'cardio', 3, 10, null, 45,
   'Squat, planche, (pompe si tu peux), retour et saut. Le rythme importe moins que la ligne du corps en position planche.'),
  ('seed-ard-cardio-mountain-climb',  'Mountain climbers',      'cardio', 3, null, 40, 45,
   'En position planche, genoux ramenés vers la poitrine en alternance. Bassin BAS : s''il monte, c''est que le rythme est trop rapide.'),
  ('seed-ard-cardio-jumping-jacks',   'Jumping jacks',          'cardio', 3, 30, null, 45,
   'Écart des jambes et bras au-dessus de la tête, en rythme. Le grand classique de l''échauffement, ici en série.'),
  ('seed-ard-cardio-high-knees',      'High knees',             'cardio', 3, null, 30, 45,
   'Montées de genoux sur place, hauteur de bassin, appuis dynamiques sur l''avant du pied. 30 s à intensité réelle.'),
  ('seed-ard-cardio-skater-jumps',    'Skater jumps',           'cardio', 3, 20, null, 45,
   '20 appuis au total (10 par côté). Bonds latéraux d''un pied sur l''autre, réception amortie — du travail d''appuis très basket.')
) as v(id, name, category, sets, reps, dur, rest, descr)
where not exists (
  select 1 from public.exo_templates e
  where e.deleted_at is null
    and e.category = v.category
    and lower(trim(e.name)) = lower(trim(v.name))
)
on conflict (id) do nothing;

-- ============================================================================
-- Rollback (ne touche QUE les lignes seedées et jamais renommées) :
--   delete from public.exo_templates where id like 'seed-ard-%';
--
-- Attention : si des dettes ont déjà été tirées sur ces exos, leur programme
-- reste intact (`ardoise_assignments.items` est une COPIE FIGÉE) — seul le
-- bouton « ▶ Lancer » d'un éventuel drill associé disparaîtrait.
-- ============================================================================
