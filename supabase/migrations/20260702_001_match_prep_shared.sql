-- Partage de la préparation match aux joueuses (plays liés, notes de prépa,
-- vidéos de prépa). Défaut false = rétrocompatibilité : les préparations
-- existantes restent privées coach jusqu'à ce que le coach active le partage.
-- Additive et non destructive (colonne booléenne NOT NULL DEFAULT false).
alter table matches add column if not exists prep_shared boolean not null default false;
