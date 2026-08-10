-- =============================================================================
-- 20260811_002 — Le coach peut invalider une preuve APRÈS coup. (v.117)
-- =============================================================================
--
-- POURQUOI
-- --------
-- Le jeu ne sait juger qu'une chose : la photo est-elle arrivée dans les temps.
-- Il ne sait pas si la peluche y figure, si le cadrage est honnête, si la
-- joueuse a photographié la pintade de sa voisine ou une photo de la pintade.
-- Une preuve est donc VALIDE PAR DÉFAUT — c'est le bon réglage, l'automatisme
-- ne doit pas soupçonner — mais le coach doit pouvoir revenir dessus.
--
-- CE QUE ÇA AJOUTE
-- ----------------
-- Un sixième statut, 'invalidated_by_coach', et la traçabilité de qui a
-- invalidé, quand, et pourquoi. Une invalidation compte comme un RATÉ dans
-- toutes les mécaniques (série en cours, prolongations, plafond d'arbitrage) :
-- sans cela, invalider serait cosmétique et la porteuse garderait le bénéfice
-- d'une preuve que le coach vient de rejeter.
--
-- POURQUOI UN STATUT ET PAS UN SIMPLE DRAPEAU
-- -------------------------------------------
-- Tout le module dérive ses compteurs du statut effectif de chaque demande, à
-- la lecture, sans rien stocker (cf. `_pintadeTally`). Un statut supplémentaire
-- suffit donc à recalculer RÉTROACTIVEMENT et automatiquement la série de la
-- porteuse : rien à migrer, rien à recompter, aucun compteur en base à corriger.
-- Un drapeau parallèle aurait obligé à modifier chaque endroit qui lit `status`
-- — et le premier oubli aurait fait diverger deux compteurs.
--
-- LE MOTIF EST FACULTATIF
-- -----------------------
-- On ne force pas le coach à se justifier pour agir. Mais quand il l'écrit, le
-- motif part dans la notification à la porteuse et s'affiche dans le feed :
-- « invalidée » sans raison sur un jeu collectif, c'est ce qui déclenche les
-- disputes.
--
-- Idempotente, additive, sans perte. Rejouable.
-- =============================================================================

alter table public.pintade_proof_requests
  add column if not exists invalidated_by        text,
  add column if not exists invalidated_at        timestamptz,
  add column if not exists invalidation_reason   text;

comment on column public.pintade_proof_requests.invalidated_by is
  'Identité du coach ayant invalidé la preuve (forme « coach:<id> »). NULL tant '
  'que la preuve n''a pas été rejetée.';
comment on column public.pintade_proof_requests.invalidated_at is
  'Horodatage de l''invalidation. Distinct de resolved_at, qui reste l''instant '
  'où la photo est arrivée — on ne réécrit pas l''histoire, on l''annote.';
comment on column public.pintade_proof_requests.invalidation_reason is
  'Motif libre saisi par le coach (facultatif). Repris tel quel dans la '
  'notification à la porteuse et dans le feed public.';

-- -----------------------------------------------------------------------------
-- Le statut. On ÉLARGIT la liste fermée, on ne la remplace pas par du permissif.
-- (Le nom de la contrainte suit celui posé par la migration _002.)
-- -----------------------------------------------------------------------------
alter table public.pintade_proof_requests
  drop constraint if exists pintade_proof_requests_status_check;

alter table public.pintade_proof_requests
  add constraint pintade_proof_requests_status_check
  check (status in ('pending', 'awaiting_photo', 'ok',
                    'failed_not_seen', 'failed_timeout', 'invalidated_by_coach'));

comment on column public.pintade_proof_requests.status is
  'pending = demande partie, rien vu encore. awaiting_photo = l''écran s''est '
  'affiché chez la porteuse, le chrono photo tourne. ok = photo reçue dans les '
  'temps. failed_not_seen = app jamais ouverte dans la fenêtre de connexion. '
  'failed_timeout = elle avait l''écran sous les yeux et le chrono a filé. '
  'invalidated_by_coach = photo reçue à temps mais rejetée après coup par le '
  'coach (peluche absente, cadrage malhonnête…) : compte comme un raté dans '
  'toutes les mécaniques.';

-- -----------------------------------------------------------------------------
-- Index partiel : le feed et l''arbitrage vont chercher les invalidations d''une
-- garde. Elles restent rares par nature — d''où le partiel, qui ne coûte rien
-- sur les lignes ordinaires.
-- -----------------------------------------------------------------------------
create index if not exists pintade_requests_invalidated_idx
  on public.pintade_proof_requests (period_id, invalidated_at desc)
  where status = 'invalidated_by_coach' and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Retour arrière (si jamais) :
--   update public.pintade_proof_requests
--      set status = 'ok', invalidated_by = null, invalidated_at = null,
--          invalidation_reason = null
--    where status = 'invalidated_by_coach';
--   drop index if exists public.pintade_requests_invalidated_idx;
--   alter table public.pintade_proof_requests
--     drop constraint if exists pintade_proof_requests_status_check;
--   alter table public.pintade_proof_requests
--     add constraint pintade_proof_requests_status_check
--     check (status in ('pending','awaiting_photo','ok','failed_not_seen','failed_timeout'));
--   alter table public.pintade_proof_requests
--     drop column if exists invalidated_by,
--     drop column if exists invalidated_at,
--     drop column if exists invalidation_reason;
-- -----------------------------------------------------------------------------
