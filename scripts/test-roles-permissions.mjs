// Test RÔLES MULTI-COACH & MULTI-ÉQUIPES (cf. ROLES_SPEC.md).
//   • admin_coach voit toutes les joueuses / matchs / gages ; peut modérer.
//   • coach non-admin ne voit QUE ses joueuses/matchs ; ne peut PAS modérer,
//     ni éditer playbook/prépa ; peut PROPOSER un gage (pending) et faire tirer
//     à ses joueuses.
//   • admin peut valider un gage proposé ; renommer son profil ; créer un coach ;
//     attribuer une joueuse à un effectif (team_tag).
//   • effectiveTeamFilter borne le coach non-admin à ses équipes.
// Extraits FIDÈLES d'index.html (mêmes règles, sans le DOM).
import assert from 'node:assert';

let state;
let CLOCK = 1000; function now() { return ++CLOCK; }
let _uid = 0; function uid() { return 'x' + (++_uid); }
function persist() {}
function _coachFlush() {}
function getActiveSeasonId() { const s = (state.seasons || []).find(x => x.status === 'active'); return s ? s.id : null; }
function _seasonsLoaded() { return (state.seasons || []).length > 0; }
function teamTagMatches(tag, want) {
  if (!want || want === 'all') return true;
  if (tag === 'both') return true;
  return (tag || 'e1') === want;
}
function getSeasonPlayers(seasonId, { team = 'all' } = {}) {
  if (!seasonId) return state.players || [];
  const links = (state.seasonPlayers || []).filter(sp => sp.seasonId === seasonId);
  return links.map(link => {
    const p = (state.players || []).find(pp => pp.id === link.playerId);
    if (!p) return null;
    if (!teamTagMatches(link.teamTag, team)) return null;
    return { ...p, _seasonLink: link };
  }).filter(Boolean);
}

// ---------------- SUJET : helpers rôles (copie fidèle d'index.html) ----------
function _adminCoach() {
  const found = (state.coaches || []).find(c => c.coachRole === 'admin_coach');
  if (found) return found;
  return { id: 'admin', name: 'Coach', coachRole: 'admin_coach', teams: ['e1', 'e2'], code: (state.pins && state.pins.coach) || '1234' };
}
function _coachById(id) { return (state.coaches || []).find(c => c.id === id) || null; }
function _nonAdminCoaches() { return (state.coaches || []).filter(c => c.coachRole === 'coach'); }
function _seedAdminCoach() {
  state.coaches = state.coaches || [];
  const existing = state.coaches.find(c => c.coachRole === 'admin_coach');
  if (existing) return existing;
  const admin = { id: 'admin', name: 'Coach', coachRole: 'admin_coach', teams: ['e1', 'e2'], code: (state.pins && state.pins.coach) || '1234', createdAt: now(), updatedAt: now() };
  state.coaches.unshift(admin); persist(); return admin;
}
function currentCoach() {
  if (!state.auth || state.auth.role !== 'coach') return null;
  if (state.auth.coachId) {
    const c = _coachById(state.auth.coachId);
    if (c) return c;
    if (state.auth.coachRole) return { id: state.auth.coachId, name: state.auth.coachName || '', coachRole: state.auth.coachRole, teams: state.auth.teams || ['e1'], code: null };
  }
  return _adminCoach();
}
function isAdminCoach() { const c = currentCoach(); return !!c && c.coachRole === 'admin_coach'; }
function isScopedCoach() { return !!(state.auth && state.auth.role === 'coach') && !isAdminCoach(); }
function coachTeams() {
  const c = currentCoach();
  const t = (c && Array.isArray(c.teams)) ? c.teams.filter(x => x === 'e1' || x === 'e2') : [];
  return t.length ? t : ['e1', 'e2'];
}
function visiblePlayersForUser(players) {
  if (!isScopedCoach()) return players || [];
  const teams = coachTeams();
  return (players || []).filter(p => {
    const tag = (p && p._seasonLink && p._seasonLink.teamTag) || 'e1';
    return tag === 'both' || teams.includes(tag);
  });
}
function effectiveTeamFilter() {
  if (isScopedCoach()) {
    const t = coachTeams();
    if (t.length === 1) return t[0];
    const f = state.teamFilter || 'all';
    if (f === 'all') return 'all';
    return t.includes(f) ? f : t[0];
  }
  if (!(state.team && state.team.multiSquad)) return 'all';
  return state.teamFilter || 'all';
}
function canEditSharedLibrary() { return !isScopedCoach(); }
function _denyIfScopedCoach() { return isScopedCoach(); }

// createCoach (fidèle : seed admin, teams normalisés, active multiSquad)
function _normCoachTeams(teams) {
  const t = (Array.isArray(teams) ? teams : []).filter(x => x === 'e1' || x === 'e2');
  return t.length ? t : ['e2'];
}
function createCoach(name, teams) {
  _seedAdminCoach();
  const coach = { id: uid(), name: (name || '').trim().slice(0, 40) || 'Coach', coachRole: 'coach', teams: _normCoachTeams(teams), code: '4321', createdAt: now(), updatedAt: now() };
  state.coaches.push(coach);
  if (state.team && !state.team.multiSquad) state.team.multiSquad = true;
  persist(); _coachFlush();
  return coach;
}
function renameCoach(id, name) {
  let c = _coachById(id);
  if (!c && id === 'admin') c = _seedAdminCoach();
  if (!c) return false;
  c.name = (name || '').trim().slice(0, 40); c.updatedAt = now();
  persist(); return true;
}
// Attribution joueuse → équipe (team_tag du lien saison), admin only.
function setPlayerTeamTag(seasonId, playerId, tag) {
  if (_denyIfScopedCoach()) return false;
  const link = (state.seasonPlayers || []).find(sp => sp.seasonId === seasonId && sp.playerId === playerId);
  if (!link) return false;
  link.teamTag = ['e1', 'e2', 'both'].includes(tag) ? tag : 'e1';
  return true;
}

// Gages : proposition coach (pending) vs ajout direct pool (admin) + modération
const GAGE_TEXT_MAX = 140;
function _coachGageAuthorId() { const c = currentCoach(); return 'coach:' + (c ? c.id : 'admin'); }
function submitCoachProposal(text) {
  text = (text || '').trim().slice(0, GAGE_TEXT_MAX); if (!text) return false;
  const author = _coachGageAuthorId();
  state.gages = state.gages || [];
  state.gages.unshift({ id: uid(), text, authorId: author, proposedBy: author, moderatedBy: null, status: 'pending', seasonId: getActiveSeasonId() || null, createdAt: now(), updatedAt: now() });
  return true;
}
function submitCoachGage(text) {
  if (_denyIfScopedCoach()) return false; // admin only
  state.gages = state.gages || [];
  state.gages.unshift({ id: uid(), text, authorId: 'coach', status: 'approved', seasonId: getActiveSeasonId() || null, createdAt: now(), updatedAt: now() });
  return true;
}
function approveGage(id) {
  if (_denyIfScopedCoach()) return false; // admin only
  const g = (state.gages || []).find(x => x.id === id); if (!g || g.status !== 'pending') return false;
  g.status = 'approved'; g.moderatedBy = (currentCoach() || {}).id || 'admin'; return true;
}

// ---------------- HARNAIS ----------------
function reset() {
  _uid = 0; CLOCK = 1000;
  state = {
    seasons: [{ id: 's1', status: 'active' }],
    players: [
      { id: 'p1', num: 4, name: 'Alice' }, { id: 'p2', num: 5, name: 'Bea' },
      { id: 'p3', num: 6, name: 'Chloe' }, { id: 'p4', num: 7, name: 'Dora' }
    ],
    seasonPlayers: [
      { seasonId: 's1', playerId: 'p1', teamTag: 'e1' },
      { seasonId: 's1', playerId: 'p2', teamTag: 'e1' },
      { seasonId: 's1', playerId: 'p3', teamTag: 'e2' },
      { seasonId: 's1', playerId: 'p4', teamTag: 'both' }
    ],
    matches: [
      { id: 'm1', teamTag: 'e1' }, { id: 'm2', teamTag: 'e2' }, { id: 'm3', teamTag: 'e1' }
    ],
    gages: [], coaches: [], team: { multiSquad: false }, teamFilter: 'all',
    pins: { coach: '1234', stat: '1234' }, auth: null
  };
}
function asAdmin() { _seedAdminCoach(); state.auth = { role: 'coach', coachId: 'admin', coachRole: 'admin_coach', teams: ['e1', 'e2'] }; }
function asCoach(coach) { state.auth = { role: 'coach', coachId: coach.id, coachRole: coach.coachRole, teams: coach.teams }; }
function visibleMatches() { const f = effectiveTeamFilter(); return (state.matches || []).filter(m => f === 'all' || teamTagMatches(m.teamTag, f)); }

let passed = 0;
function ok(label, cond) { assert.ok(cond, '✗ ' + label); passed++; }

// === 1. Admin voit tout ===
reset(); asAdmin();
ok('admin voit toutes les joueuses (4)', visiblePlayersForUser(getSeasonPlayers('s1', { team: 'all' })).length === 4);
ok('admin voit tous les matchs (3)', visibleMatches().length === 3);
ok('admin isAdminCoach', isAdminCoach() && !isScopedCoach());
ok('admin peut éditer la bibliothèque partagée', canEditSharedLibrary());

// === 2. Création d'un coach E2 par l'admin ===
const e2coach = createCoach('Sophie', ['e2']);
ok('createCoach → coachRole coach', e2coach.coachRole === 'coach');
ok('createCoach → teams [e2]', JSON.stringify(e2coach.teams) === JSON.stringify(['e2']));
ok('createCoach active le multi-effectif', state.team.multiSquad === true);
ok('un admin_coach existe (seed)', _adminCoach().coachRole === 'admin_coach');
ok('le sélecteur de coach s\'activera (≥1 non-admin)', _nonAdminCoaches().length === 1);

// === 3. Coach non-admin scopé ===
asCoach(e2coach);
ok('coach E2 isScopedCoach', isScopedCoach() && !isAdminCoach());
ok('coach E2 coachTeams = [e2]', JSON.stringify(coachTeams()) === JSON.stringify(['e2']));
const seen = visiblePlayersForUser(getSeasonPlayers('s1', { team: effectiveTeamFilter() }));
ok('coach E2 voit p3 (e2) + p4 (both) = 2', seen.length === 2 && seen.some(p => p.id === 'p3') && seen.some(p => p.id === 'p4'));
ok('coach E2 ne voit PAS p1 (e1)', !seen.some(p => p.id === 'p1'));
ok('coach E2 effectiveTeamFilter = e2', effectiveTeamFilter() === 'e2');
ok('coach E2 voit uniquement le match e2 (m2)', visibleMatches().length === 1 && visibleMatches()[0].id === 'm2');
ok('coach E2 ne peut PAS éditer la bibliothèque partagée', !canEditSharedLibrary());

// === 4. Coach non-admin : propose (pending), ne peut pas modérer ni pool direct ===
ok('coach E2 propose un gage (pending)', submitCoachProposal('gage rigolo') === true);
const proposed = state.gages[0];
ok('proposition en pending', proposed.status === 'pending');
ok('proposition tracée proposedBy coach', proposed.proposedBy === 'coach:' + e2coach.id);
ok('coach E2 NE peut PAS ajouter direct au pool', submitCoachGage('triche') === false);
ok('coach E2 NE peut PAS approuver', approveGage(proposed.id) === false && proposed.status === 'pending');
ok('coach E2 NE peut PAS attribuer un team_tag', setPlayerTeamTag('s1', 'p1', 'e2') === false);

// === 5. Admin modère la proposition du coach ===
asAdmin();
ok('admin voit la proposition à modérer', state.gages.filter(g => g.status === 'pending').length === 1);
ok('admin approuve la proposition coach', approveGage(proposed.id) === true);
ok('proposition devient approved + moderatedBy', proposed.status === 'approved' && proposed.moderatedBy === 'admin');
ok('admin peut ajouter direct au pool', submitCoachGage('gage admin') === true && state.gages[0].status === 'approved');

// === 6. Admin : renommer + attribuer joueuse à un effectif ===
ok('admin renomme son profil', renameCoach('admin', 'Carl') && _adminCoach().name === 'Carl');
ok('admin attribue p1 → e2', setPlayerTeamTag('s1', 'p1', 'e2') === true);
asCoach(e2coach);
ok('après attribution, coach E2 voit p1', visiblePlayersForUser(getSeasonPlayers('s1', { team: effectiveTeamFilter() })).some(p => p.id === 'p1'));

// === 7. Coach multi-équipes (e1+e2) : pillule honorée, bornée ===
asAdmin();
const bothCoach = createCoach('Max', ['e1', 'e2']);
asCoach(bothCoach);
state.teamFilter = 'all';
ok('coach 2 équipes, filtre all → all', effectiveTeamFilter() === 'all');
state.teamFilter = 'e1';
ok('coach 2 équipes, filtre e1 → e1', effectiveTeamFilter() === 'e1');
state.teamFilter = 'e2';
ok('coach 2 équipes, filtre e2 → e2', effectiveTeamFilter() === 'e2');

// === 8. Rétrocompat : session coach sans coachId → admin ===
reset();
state.auth = { role: 'coach' }; // connectée avant la MAJ
ok('session coach sans coachId = admin (rétrocompat)', isAdminCoach() && !isScopedCoach());

// === 9. Anti-escalade offline : snapshot coachRole gouverne si entité absente ===
reset();
state.auth = { role: 'coach', coachId: 'zzz', coachRole: 'coach', coachName: 'X', teams: ['e2'] };
ok('coachId inconnu + snapshot coach → reste scopé (pas admin)', isScopedCoach() && !isAdminCoach());

console.log(`\n✓ ${passed} assertions passées — rôles multi-coach & multi-équipes OK`);
