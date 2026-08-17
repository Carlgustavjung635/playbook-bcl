-- ============================================================================
-- Migration : 25 EXOS DE DÉPART POUR LA MACHINE À SOUS — CALIBRÉS SUR LA BIBLIO
-- ----------------------------------------------------------------------------
-- REMPLACE la 20260816_005, qui n'a jamais été appliquée. Ne joue PAS les deux :
-- les identifiants sont IDENTIQUES (`seed-ard-…`), donc si la 005 est exécutée
-- après celle-ci, son `on conflict (id) do nothing` la rend intégralement
-- inerte. C'est voulu : une migration poussée ne se réécrit pas, elle se
-- neutralise. L'inverse est vrai aussi (007 après 005 = no-op), mais alors les
-- doses restent celles, plus molles, de la 005 — d'où l'ordre recommandé :
-- **007 seule**.
--
-- ----------------------------------------------------------------------------
-- POURQUOI UNE v2 : LE NIVEAU, PAS LE FORMAT
-- ----------------------------------------------------------------------------
-- Le format de la 005 était bon (mêmes colonnes, mêmes contraintes). C'est le
-- NIVEAU qui était faux. La bibliothèque réelle du coach tourne à :
--
--   bras    « 4x10 Dips », « 4x5 Pompes larges »            → 4 séries
--   jambes  « Squats classiques 4x20 », « 4 séries de … »   → 4 séries, 15-20 rep
--   gainage « 8 séries 30' gainage planche », « 6 séries … »→ 6 à 8 séries
--   cardio  « 45min de footing », « Fractionné 18 block 45/30 »
--                                                           → durées RÉELLES
--
-- La 005 proposait 3 séries partout et un cardio à 30-40 s : un cran en dessous
-- de tout ce que le coach a écrit lui-même. Une machine à sous qui tire des
-- exos plus doux que la bibliothèque du coach dévalue la dette qu'elle est
-- censée faire payer. Les doses ci-dessous sont alignées sur les siennes.
--
-- La catégorie `mobilite` est la seule VIDE en base : ses 5 exos restent volon-
-- tairement en 2-3 séries. La souplesse ne se durcit pas en ajoutant des
-- séries, et le rouleau doit rester tirable par une joueuse au repos forcé —
-- qui est précisément la population ardoisée.
--
-- ----------------------------------------------------------------------------
-- CE SONT DES SUGGESTIONS, PAS UN BARÈME
-- ----------------------------------------------------------------------------
-- `default_sets` / `default_reps` / `default_duration_sec` sont documentés dans
-- la 20260815_001 comme des SUGGESTIONS : la dose est RECOPIÉE dans la dette au
-- moment du tirage (`ardoise_assignments.items`). Le coach peut donc corriger
-- ces valeurs — ou supprimer un exo qui ne lui plaît pas — sans jamais réécrire
-- une dette déjà tirée.
--
-- Il n'y a PAS de colonne `level` sur `exo_templates` : la notion de niveau
-- vivait sur `ardoise_menus.level`, table legacy depuis la 20260816_004. Le
-- niveau se lit donc dans la dose et dans la description, pas dans une colonne.
--
-- `illustration_url` et `drill_id` restent NULL : aucun média n'est inventé ici.
-- Le coach associe un drill quand il en a un (lien vivant, cf. 20260816_003) et
-- le bouton « ▶ Lancer » apparaît alors tout seul sur la carte de la joueuse.
--
-- ----------------------------------------------------------------------------
-- IDEMPOTENCE : DEUX VERROUS, ET AUCUN NE CRÉE DE CONTRAINTE
-- ----------------------------------------------------------------------------
--   1. `on conflict (id) do nothing` — les id sont FIXES (`seed-ard-…`), donc
--      rejouer la migration n'insère rien.
--   2. `where not exists (… même catégorie, même nom …)` — si le coach a déjà
--      saisi « Pompes classiques » à la main, on ne double pas sa ligne. Le
--      test ignore les lignes soft-deletées : un exo que le coach a SUPPRIMÉ ne
--      doit pas empêcher le seed de reposer le sien.
--
-- Aucune contrainte UNIQUE n'est créée sur (name, category) : la bibliothèque
-- est partagée avec la prépa et le coach a le droit d'y écrire deux variantes
-- homonymes. Le dédoublonnage est une politique de CE seed, pas du schéma.
--
-- Les id ne commencent PAS par « x » : PbSync repousse au flush toute ligne
-- d'id « x… » qu'un client a en cache, donc un hard DELETE ne tuerait jamais un
-- exo seedé (cf. playbook sync). Ici, un DELETE en base est définitif.
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
  -- 💪 BRAS — 4 séries, comme « 4x10 Dips » -----------------------------------
  ('seed-ard-bras-pompes-classiques', 'Pompes classiques',        'bras', 4, 10, null, 30,
   'Mains à plat, largeur d''épaules. Corps gainé de la tête aux talons, coudes à 45°. Sur les genoux si la ligne casse — mais alors on garde les 4 séries.'),
  ('seed-ard-bras-pompes-diamant',    'Pompes diamant',           'bras', 4, 8, null, 45,
   'Mains jointes sous la poitrine, index et pouces en losange. Coudes le long du corps — ça travaille les triceps, c''est normal que ça descende moins bas.'),
  ('seed-ard-bras-pompes-declinees',  'Pompes déclinées',         'bras', 4, 8, null, 45,
   'Pieds surélevés sur une chaise ou un lit. Plus le pied est haut, plus les épaules encaissent. Le bassin ne remonte pas.'),
  ('seed-ard-bras-curl-bouteille',    'Curl bouteille d''eau',    'bras', 4, 15, null, 30,
   'Une bouteille pleine dans chaque main (1,5 L ≈ 1,5 kg). Coudes collés au corps, montée lente, descente encore plus lente. Deux bouteilles de 2 L si 15 passent trop bien.'),
  ('seed-ard-bras-planche-lat-bras',  'Planche latérale bras tendu', 'bras', 4, null, 45, 30,
   '45 s de CHAQUE côté à chaque série. Sur la main, bras tendu, corps en ligne. Le poids reste porté par l''épaule, pas écrasé dedans.'),

  -- 🦵 JAMBES — 4 séries, 15-20 rep, comme « Squats classiques 4x20 » ---------
  ('seed-ard-jambes-squats-sumo',     'Squats sumo',              'jambes', 4, 15, null, 45,
   'Pieds bien plus larges que le bassin, pointes ouvertes à 45°. Descente jusqu''à cuisses parallèles, dos droit, genoux dans l''axe des pieds.'),
  ('seed-ard-jambes-fentes-avant',    'Fentes avant alternées',   'jambes', 4, 12, null, 45,
   '12 répétitions PAR JAMBE, soit 24 par série. Grand pas en avant, genou arrière vers le sol sans le toucher, buste vertical.'),
  ('seed-ard-jambes-chaise-mur',      'Chaise contre mur',        'jambes', 4, null, 60, 45,
   'Dos plaqué au mur, cuisses parallèles au sol, genoux à 90°. 60 s sans poser les mains sur les cuisses — c''est là que ça se joue.'),
  ('seed-ard-jambes-montees-banc',    'Montées de banc',          'jambes', 4, 12, null, 45,
   '12 montées PAR JAMBE. Chaise ou banc stable à hauteur de genou. La jambe qui pousse est celle du dessus : on ne s''aide pas d''un rebond du pied au sol.'),
  ('seed-ard-jambes-mollets-debout',  'Mollets debout',           'jambes', 4, 25, null, 30,
   'Montée sur la pointe des pieds, pause d''une seconde en haut, descente contrôlée. Sur une marche pour l''amplitude complète.'),

  -- 🧠 GAINAGE — 6 à 8 séries courtes, comme « 8 séries 30'' gainage planche »
  ('seed-ard-gainage-planche',        'Planche classique',        'gainage', 6, null, 45, 30,
   'Appui sur les avant-bras, coudes sous les épaules. Fessiers serrés, bassin ni creusé ni en pont. 45 s sans retenir sa respiration, six fois.'),
  ('seed-ard-gainage-planche-lat',    'Planche latérale',         'gainage', 6, null, 30, 30,
   'Sur l''avant-bras, hanches hautes, corps en ligne. Trois séries de chaque côté, en alternant.'),
  ('seed-ard-gainage-hollow-body',    'Hollow body',              'gainage', 6, null, 30, 30,
   'Allongée sur le dos, lombaires PLAQUÉES au sol, bras et jambes décollés. Si le bas du dos se creuse : rapprocher les genoux, ne pas tenir plus longtemps.'),
  ('seed-ard-gainage-dead-bug',       'Dead bug',                 'gainage', 4, 12, null, 30,
   '12 répétitions PAR CÔTÉ. Sur le dos, bras et genoux au plafond ; on tend le bras et la jambe OPPOSÉS, lentement, dos collé au sol du début à la fin.'),
  ('seed-ard-gainage-bird-dog',       'Bird dog',                 'gainage', 4, 12, null, 30,
   '12 répétitions PAR CÔTÉ. À quatre pattes, on tend bras et jambe opposés à l''horizontale. Le bassin ne pivote pas — c''est tout l''exercice.'),

  -- 🧘 MOBILITÉ — rouleau VIDE en base, volontairement doux --------------------
  ('seed-ard-mobilite-cat-cow',       'Cat-cow',                  'mobilite', 3, 10, null, 15,
   'À quatre pattes : on creuse le dos en inspirant, on l''arrondit en expirant. Lent, sur le rythme de la respiration.'),
  ('seed-ard-mobilite-wgs',           'World''s greatest stretch','mobilite', 3, 5, null, 15,
   '5 répétitions PAR CÔTÉ. Fente avant, main au sol côté intérieur, puis ouverture du buste bras au plafond. L''étirement le plus complet du lot.'),
  ('seed-ard-mobilite-rot-hanches',   'Rotation hanches',         'mobilite', 3, 10, null, 15,
   '10 rotations PAR CÔTÉ. Debout, genou monté à hauteur de hanche, on ouvre vers l''extérieur puis on referme. Amplitude maximale, sans forcer.'),
  ('seed-ard-mobilite-ischios',       'Étirement ischios',        'mobilite', 3, null, 40, 15,
   '40 s PAR JAMBE. Talon posé devant, jambe tendue, on bascule le BASSIN vers l''avant — ce n''est pas le dos qui s''arrondit.'),
  ('seed-ard-mobilite-cercles-epaules','Cercles épaules',         'mobilite', 3, 15, null, 15,
   '15 cercles DANS CHAQUE SENS. Bras tendus, grands cercles lents. Idéal en fin de séance ou au réveil.'),

  -- 🔥 CARDIO — en blocs et en durées réelles, comme « 18 block 45/30 » --------
  ('seed-ard-cardio-burpees',         'Burpees',                  'cardio', 4, 12, null, 60,
   'Squat, planche, pompe, retour et saut. Le rythme importe moins que la ligne du corps en position planche : dès qu''elle casse, on ralentit.'),
  ('seed-ard-cardio-mountain-climb',  'Mountain climbers 6 block 45/30', 'cardio', 6, null, 45, 30,
   'En position planche, genoux ramenés vers la poitrine en alternance. Bassin BAS : s''il monte, c''est que le rythme est trop rapide.'),
  ('seed-ard-cardio-jumping-jacks',   'Jumping jacks 4x60',       'cardio', 4, null, 60, 30,
   'Écart des jambes et bras au-dessus de la tête, en rythme. Une minute pleine, quatre fois : le classique de l''échauffement devient du cardio.'),
  ('seed-ard-cardio-high-knees',      'High knees 6 block 30/30', 'cardio', 6, null, 30, 30,
   'Montées de genoux sur place, hauteur de bassin, appuis dynamiques sur l''avant du pied. 30 s à intensité réelle, pas de la course sur place molle.'),
  ('seed-ard-cardio-skater-jumps',    'Skater jumps',             'cardio', 4, 30, null, 45,
   '30 appuis au total par série (15 par côté). Bonds latéraux d''un pied sur l''autre, réception amortie — du travail d''appuis très basket.')
) as v(id, name, category, sets, reps, dur, rest, descr)
where not exists (
  select 1 from public.exo_templates e
  where e.deleted_at is null
    and e.category = v.category
    and lower(trim(e.name)) = lower(trim(v.name))
)
on conflict (id) do nothing;
