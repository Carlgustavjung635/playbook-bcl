-- Compo privée tant que non révélée : le coach « annonce » la compo aux joueuses.
-- lineup_revealed = false par défaut (compo privée). Rétrocompat : on backfill à
-- true les matchs DÉJÀ PASSÉS (leur compo est de fait visible depuis longtemps),
-- pour ne pas casser l'historique côté joueuse.
alter table matches add column if not exists lineup_revealed boolean not null default false;
update matches set lineup_revealed = true where date < current_date;
