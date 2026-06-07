-- ============================================================================
-- Chronomètre basket — presets de timers configurables par le coach.
--
-- Ajoute une colonne `chrono_presets` à team_settings (singleton id=1) : un
-- tableau JSON d'objets { label, seconds } décrivant les raccourcis de durée
-- que le coach configure (ex. [{ "label": "Possession", "seconds": 24 },
-- { "label": "Remise en jeu", "seconds": 8 }, { "label": "Temps-mort",
-- "seconds": 60 }]). Un tap sur un preset (re)lance le chrono à cette durée.
--
-- POURQUOI sur team_settings — et pas une table dédiée : c'est un réglage
-- d'équipe singleton, exactement comme le surnom de display, le multi-effectif
-- ou les réglages FFBB (cf. 20260606_001 et 20260607_002). Même cycle de vie,
-- mêmes policies (anon ALL, lecture publique), même entité de sync ('team').
--
-- Défaut NULL (pas '[]') : NULL = « le coach n'a jamais configuré » → le front
-- retombe sur des presets basket par défaut (24"/14"/8"/5"/60"). Une fois le
-- coach passé par l'éditeur, la colonne contient son tableau (même vide = il a
-- volontairement tout supprimé), ce qui est sémantiquement distinct de NULL.
--
-- IDEMPOTENT : `add column if not exists` → ré-exécutable. Le front a un
-- fallback (apply() ignore la colonne absente) donc l'app tourne MÊME avant
-- application de cette migration (presets par défaut only, non persistés).
--
-- Même table / mêmes policies que 20260606_001_team_settings.sql. Aucune
-- nouvelle policy nécessaire.
-- ============================================================================

alter table public.team_settings
  add column if not exists chrono_presets jsonb;
