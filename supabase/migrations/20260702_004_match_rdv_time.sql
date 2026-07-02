-- Heure et lieu de RDV équipe (avant match). Jusqu'ici rdvTime/rdvPlace vivaient
-- en localStorage seul (jamais sérialisés vers matches). On les persiste pour la
-- sync cross-device + la notif « tu es retenue · RDV à … ».
-- Rétrocompat : colonnes nullables ; un match sans rdv_time prend le défaut
-- calculé à l'affichage (1h avant l'heure du match).
alter table matches add column if not exists rdv_time text;
alter table matches add column if not exists rdv_place text;
