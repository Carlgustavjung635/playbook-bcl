// Régression : le pull-to-refresh (document-level) volait le scroll DANS les
// modales (picker couleurs/sons de ⚙ Personnalisation) à scrollTop=0.
// Ce test reproduit fidèlement _ptrTouchBlocked de index.html sur une chaîne
// d'ancêtres synthétique (DOM non dispo headless) : touch dans modale/overlay
// /zone scrollable → PTR bloqué ; touch dans .app → PTR autorisé.
import assert from 'node:assert';

const PTR_OVERLAY = ['modal', 'modal-bg']; // classes overlay
const PTR_OVERLAY_IDS = ['modal-root', 'broadcast-overlay'];

// Mirror fidèle de la décision de _ptrTouchBlocked (cf. index.html).
// chain = ancêtres target→haut : { id?, classes?:[], role?, overflowY?, scrollable? }
function ptrBlockedByChain(chain) {
  // 1) zone overlay/dialogue explicite (équiv. target.closest(SELECTOR))
  for (const n of chain) {
    if (n.id && PTR_OVERLAY_IDS.includes(n.id)) return true;
    if (n.classes && n.classes.some(c => PTR_OVERLAY.includes(c) || c === 'chrono-overlay')) return true;
    if (n.role === 'dialog') return true;
  }
  // 2) ancêtre scrollable verticalement, en s'arrêtant à .app (container du PTR)
  for (const n of chain) {
    if (n.classes && n.classes.includes('app')) break;
    if ((n.overflowY === 'auto' || n.overflowY === 'scroll') && n.scrollable) return true;
  }
  return false;
}

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

console.log('SCÉNARIO 1 — touch DANS une modale → PTR bloqué');
t('contenu de .modal-body sous #modal-root → bloqué', () => {
  const chain = [
    { classes: ['modal-body'], overflowY: 'auto', scrollable: true },
    { classes: ['modal'] },
    { classes: ['modal-bg'] },
    { id: 'modal-root' },
    { classes: ['body'] },
  ];
  assert.strictEqual(ptrBlockedByChain(chain), true);
});
t('picker (theme-grid) dans la modale → bloqué', () => {
  const chain = [
    { classes: ['theme-card'] },
    { id: 'chrono-sound-grid', classes: ['theme-grid'] },
    { classes: ['modal-body'], overflowY: 'auto', scrollable: true },
    { classes: ['modal'] },
    { id: 'modal-root' },
  ];
  assert.strictEqual(ptrBlockedByChain(chain), true);
});
t('overlay diffusion (broadcast) → bloqué', () => {
  assert.strictEqual(ptrBlockedByChain([{ classes: ['bc-card'] }, { id: 'broadcast-overlay' }]), true);
});
t('role="dialog" → bloqué', () => {
  assert.strictEqual(ptrBlockedByChain([{ classes: ['x'] }, { role: 'dialog' }]), true);
});

console.log('SCÉNARIO 2 — touch HORS modale (dans .app) → PTR autorisé');
t('contenu normal de la home dans .app → non bloqué', () => {
  const chain = [
    { classes: ['list-row'] },
    { classes: ['list-section'] },
    { classes: ['fade-up'] },
    { classes: ['app'], overflowY: 'auto', scrollable: true }, // .app EST scrollable mais c'est le container du PTR
  ];
  assert.strictEqual(ptrBlockedByChain(chain), false);
});
t('.app scrollable n\'est jamais traité comme zone bloquante', () => {
  assert.strictEqual(ptrBlockedByChain([{ classes: ['app'], overflowY: 'auto', scrollable: true }]), false);
});

console.log('SCÉNARIO 3 — sous-conteneur scrollable DANS .app (avant .app) → bloqué');
t('liste interne overflow:auto scrollable → bloqué (le scroll interne prime)', () => {
  const chain = [
    { classes: ['inner-item'] },
    { classes: ['inner-scroll'], overflowY: 'scroll', scrollable: true },
    { classes: ['app'], overflowY: 'auto', scrollable: true },
  ];
  assert.strictEqual(ptrBlockedByChain(chain), true);
});
t('conteneur overflow:auto NON scrollable (contenu court) → non bloqué', () => {
  const chain = [
    { classes: ['inner'], overflowY: 'auto', scrollable: false },
    { classes: ['app'], scrollable: true },
  ];
  assert.strictEqual(ptrBlockedByChain(chain), false);
});

console.log(`\n✅ ${pass} assertions OK — PTR exclut modales/overlays/zones scrollables, autorise .app.`);
