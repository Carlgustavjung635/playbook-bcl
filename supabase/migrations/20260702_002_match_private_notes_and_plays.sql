-- Notes de prépa privée vs publique + plays liés privés.
-- Additif et rétrocompatible :
--  * matches.prep_comment reste la note PUBLIQUE (partagée aux joueuses si
--    prep_shared) ; prep_comment_private est la note PRIVÉE coach (jamais partagée).
--  * match_play_links.visibility : 'public' (défaut, partagé si prep_shared) ou
--    'private' (jamais partagé, tactique/scouting). Les liens existants → 'public'.
alter table matches add column if not exists prep_comment_private text;
alter table match_play_links add column if not exists visibility text not null default 'public';
