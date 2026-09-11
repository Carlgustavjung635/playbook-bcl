const fs=require('fs'),http=require('http'),assert=require('assert/strict');
// Run with Playwright installed, or PB_PLAYWRIGHT_MODULE pointing to its package.
// PB_CHROME optionally selects a local Chrome binary; otherwise use Playwright Chromium.
const path=require('path'),os=require('os');
const {chromium}=require(process.env.PB_PLAYWRIGHT_MODULE || 'playwright');
const output=process.env.PB_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(),'pb-coach-beta-'));
fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",'const createClient=window.__fakeCreateClient;');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');if(req.url.startsWith('/assets/bcl-logo-')){res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync(path.join(__dirname,'../assets/bcl-logo-64.png')))}res.end(html)});
const passed=[];
function ok(name){passed.push(name);console.log('OK '+name)}
(async()=>{await new Promise(r=>server.listen(8886,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.PB_CHROME || undefined});
try{
const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(7000);
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8886/')?route.continue():route.abort());
await page.addInitScript(()=>{window.__fakeCreateClient=()=>{const chain=new Proxy({},{get(_,key){if(key==='then')return resolve=>Promise.resolve({data:[],error:{message:'offline simulation'}}).then(resolve);return ()=>chain}});return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},from:()=>chain,channel:()=>chain,removeChannel(){}}};});
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8886/');await page.waitForTimeout(250);
await page.evaluate(()=>{
  Pb.online=false;ffbbDash().lastAutoSync=Date.now();
  state.auth={role:'coach',coachId:'beta-fixture',coachRole:'admin_coach'};
  state.section='home';state.view=null;state.gages=[];state.gageDraws=[];state.ardoiseAssignments=[];state.pintadePeriods=[];state.pintadeRequests=[];state.pintadeIncidents=[];state.challenges=[];state.convocs=[];state.convocations=[];state.matches=[];state.players=[];
  state.plays=[{id:'x-beta-test',title:'Test hors ligne conservé',cat:'off',description:'Ne pas perdre'}];
  state.exoTemplates=[{id:'e-test',name:'Gainage de test',category:'gainage',defaultSets:3,drillId:null,createdAt:123,updatedAt:123,notes:'keep'}];
  persist();render();
  window.__betaSnapshot=()=>JSON.stringify({plays:state.plays,exos:state.exoTemplates,convocs:state.convocs,gages:state.gages,draws:state.gageDraws,ardoise:state.ardoiseAssignments,theme:getThemeId(),pending:Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('pb8_sync_pending_v1:')).sort().map(k=>[k,localStorage.getItem(k)]))});
  window.__beforeBeta=__betaSnapshot();
});
assert.equal(await page.evaluate(()=>coachBetaEnabled()),false);assert.equal(await page.locator('.coach-beta-banner').count(),0);ok('Interface actuelle par défaut pour le coach');
await page.evaluate(()=>openSettings());assert.ok(await page.getByRole('button',{name:/Personnalisation \(couleur \+ son\)/}).count());
await page.getByRole('button',{name:/Interface coach · Actuelle/}).click();await page.getByRole('button',{name:'Nouvelle interface · Bêta',exact:true}).click();await page.waitForTimeout(200);
assert.equal(await page.locator('.coach-beta-home').count(),1);assert.deepEqual(await page.locator('.bottom-nav .nav-btn-label').allTextContents(),['Accueil','Planning','Basket','Matchs','Équipe']);ok('Activation depuis Réglages : cinq entrées de la nouvelle navigation');
assert.equal(await page.evaluate(()=>__betaSnapshot()===__beforeBeta),true);ok('Basculer ne modifie ni données, ni thème, ni file de synchronisation hors ligne');
assert.equal(await page.locator('.bottom-nav svg').count(),5);assert.equal(await page.locator('.chrono-fab,.drill-fab').count(),0);ok('Icônes de navigation et accueil sans boutons flottants superposés');
assert.equal(await page.locator('.topbar-logo img').getAttribute('src'),'/assets/bcl-logo-64.png');ok('Logo officiel conservé dans la barre supérieure');
await page.screenshot({animations:'disabled',path:path.join(output,'coach-beta-253-home.png')});
await page.locator('.bottom-nav button').filter({hasText:'Planning'}).click();
assert.equal(await page.locator('.coach-beta-planning').count(),1);assert.ok(await page.getByRole('button',{name:'+ Nouveau',exact:true}).count());
await page.getByRole('button',{name:'+ Nouveau',exact:true}).click();assert.ok(await page.locator('#modal-root input').count());await page.screenshot({animations:'disabled',path:path.join(output,'coach-beta-253-event-form.png')});await page.evaluate(()=>closeModal());await page.waitForTimeout(120);ok('Planning connecté au vrai formulaire de création d’événement');
await page.locator('.bottom-nav button').filter({hasText:'Basket'}).click();assert.equal(await page.locator('.coach-beta-basket').count(),1);await page.screenshot({animations:'disabled',path:path.join(output,'coach-beta-253-basket.png')});assert.equal(await page.locator('[data-beta-action="chrono"],[data-beta-action="drills"]').count(),2);
await page.locator('[data-beta-action="library"]').click();assert.equal(await page.locator('#exercise-library').count(),1);await page.evaluate(()=>closeModal());await page.waitForTimeout(120);ok('Basket connecté à la bibliothèque existante');
await page.locator('[data-beta-action="plays"]').click();assert.equal(await page.evaluate(()=>state.section),'plays');assert.equal(await page.locator('.bottom-nav .active .nav-btn-label').textContent(),'Basket');ok('Playbook historique accessible, onglet Basket reste actif');
await page.locator('.bottom-nav button').filter({hasText:'Matchs'}).click();assert.ok(await page.locator('[data-beta-action="ffbb"]').count());await page.screenshot({animations:'disabled',path:path.join(output,'coach-beta-253-matches.png')});ok('Matchs conserve l’accès au championnat FFBB');
await page.locator('.bottom-nav button').filter({hasText:'Équipe'}).click();assert.equal(await page.locator('.coach-beta-team').count(),1);await page.screenshot({animations:'disabled',path:path.join(output,'coach-beta-253-team.png')});
await page.locator('[data-beta-action="settings"]').click();assert.ok(await page.getByRole('button',{name:/Personnalisation \(couleur \+ son\)/}).count());
await page.getByRole('button',{name:/Personnalisation \(couleur \+ son\)/}).click();await page.waitForTimeout(100);assert.ok((await page.locator('#modal-root').innerText()).length>100);await page.evaluate(()=>closeModal());await page.waitForTimeout(100);ok('Personnalisation couleur et son toujours accessible depuis la bêta');
await page.locator('.bottom-nav button').filter({hasText:'Accueil'}).click();await page.locator('.coach-life > summary').click();await page.locator('[data-beta-action="legacy"]').click();assert.equal(await page.locator('.coach-beta-home').count(),0);assert.equal(await page.locator('.coach-beta-banner').count(),1);ok('Accueil complet historique disponible sans désactiver la bêta');
await page.locator('.bottom-nav button').filter({hasText:'Basket'}).click();await page.waitForTimeout(150);await page.reload();await page.waitForTimeout(350);
assert.equal(await page.evaluate(()=>coachBetaEnabled()),true);assert.equal(await page.locator('.coach-beta-basket').count(),1);ok('Préférence locale et navigation bêta restaurées après rechargement');
// The actual physical editor saves to the same entity in either interface.
await page.evaluate(()=>openExoEditor('e-test',true));await page.locator('#ard-e-name').fill('Gainage modifié depuis bêta');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.waitForTimeout(150);await page.evaluate(()=>closeModal());await page.waitForTimeout(120);
await page.getByRole('button',{name:'↩ Interface actuelle',exact:true}).click();await page.waitForTimeout(200);
assert.equal(await page.evaluate(()=>coachBetaEnabled()),false);assert.equal(await page.locator('.coach-beta-banner').count(),0);
await page.evaluate(()=>openExoEditor('e-test'));assert.equal(await page.locator('#ard-e-name').inputValue(),'Gainage modifié depuis bêta');assert.equal(await page.evaluate(()=>state.exoTemplates.find(e=>e.id==='e-test').notes),'keep');await page.evaluate(()=>closeModal());await page.waitForTimeout(120);ok('Retour immédiat : la modification faite dans la bêta est visible dans l’éditeur actuel avec ses champs annexes');
await page.reload();await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>coachBetaEnabled()),false);ok('Désactivation conservée après rechargement');
await page.evaluate(()=>{setCoachInterface(true)});await page.waitForTimeout(150);
await page.evaluate(()=>{state.auth={role:'coach',coachId:'other-coach',coachRole:'coach'};state.section='home';render()});assert.equal(await page.evaluate(()=>coachBetaEnabled()),false);ok('Le choix d’un coach n’active pas la bêta pour un autre coach sur cet appareil');
for(const role of ['player','stat']){
  await page.evaluate(role=>{state.auth={role,playerId:'p-test'};state.section='coach-basket';state.view=null;render();openSettings();},role);
  assert.equal(await page.evaluate(()=>coachBetaEnabled()),false);assert.equal(await page.getByRole('button',{name:/Interface coach ·/}).count(),0);
  const before=await page.evaluate(()=>JSON.stringify(Object.keys(localStorage).filter(k=>k.startsWith('pb_coach_interface_v1:')).map(k=>[k,localStorage.getItem(k)])));
  await page.evaluate(()=>setCoachInterface(true));assert.equal(await page.evaluate(()=>JSON.stringify(Object.keys(localStorage).filter(k=>k.startsWith('pb_coach_interface_v1:')).map(k=>[k,localStorage.getItem(k)]))),before);
  await page.evaluate(()=>closeModal());await page.waitForTimeout(100);
}ok('Joueuse et Stat’man : ni option, ni activation par appel direct, ni écran bêta');
await page.evaluate(()=>{state.auth={role:'coach',coachId:'storage-test',coachRole:'admin_coach'};state.section='home';const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('pb_coach_interface_v1:'))throw new Error('quota');return original.call(this,k,v)};setCoachInterface(true);Storage.prototype.setItem=original;});assert.equal(await page.evaluate(()=>coachBetaEnabled()),false);ok('Stockage indisponible : reste sur l’interface actuelle');
// Visual and interaction checks use only synthetic local state, with remote traffic blocked.
await page.locator('.toast').waitFor({state:'hidden',timeout:7000});
await page.evaluate(()=>{state.auth={role:'coach',coachId:'visual-fixture',coachRole:'admin_coach'};state.section='home';state.view=null;setCoachInterface(true)});
await page.evaluate(()=>{state.convocations=[{id:'visual-event',type:'training',title:'Entraînement de démonstration',date:isoDate(new Date()),time:'19:30',location:'Gymnase test',seasonId:state.currentSeasonId,responses:{}}];render()});
await page.getByRole('button',{name:'Préparer la séance',exact:true}).click();assert.ok((await page.locator('#modal-root').innerText()).includes('Entraînement de démonstration'));await page.evaluate(()=>closeModal());await page.waitForTimeout(120);ok('Carte prochain rendez-vous reliée à la véritable occurrence, sans compteurs inventés');
for(const width of [360,768]){
  await page.setViewportSize({width,height:900});
  for(const theme of ['bcl','midnight','ocean']){
    await page.evaluate(theme=>setThemeId(theme),theme);
    for(const section of ['home','coach-planning','coach-basket','matches','coach-team','plays']){
      await page.evaluate(section=>goSection(section),section);
      await page.screenshot({animations:'disabled',path:path.join(output,'coach-253-'+width+'-'+theme+'-'+section+'.png')});
      assert.equal(await page.evaluate(()=>document.querySelector('.app').scrollWidth<=document.querySelector('.app').clientWidth),true,section+' fits '+width);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.nav-btn-label')).textTransform),'none');
      assert.ok((await page.locator('main').innerText()).length>30,section+' has visible content');
    }
  }
}ok('Six écrans vérifiés à 360 et 768 px en thèmes BCL, Midnight et Ocean');
await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{setThemeId('bcl');goSection('coach-basket')});
for(const [action,label] of [['library','bibliotheque'],['programs','programmes'],['drills','drills'],['settings','reglages'],['broadcasts','messages'],['roster','effectif'],['wellbeing','ressenti']]){
  await page.evaluate(action=>_coachBetaAction(action),action);
  await page.screenshot({animations:'disabled',path:path.join(output,'coach-253-'+label+'.png')});
  assert.ok((await page.locator('#modal-root').innerText()).length>20,label+' opens');
  assert.equal(await page.locator('.modal-title').first().evaluate(el=>getComputedStyle(el).textTransform),'none');
  await page.evaluate(()=>closeModal());await page.waitForTimeout(120);
}ok('Bibliothèque, programmes, drills, réglages, messages, effectif et ressenti dans le style commun');
await page.evaluate(()=>_coachBetaAction('chrono'));assert.ok(await page.locator('#chrono-overlay').count());await page.evaluate(()=>closeChrono());ok('Chronomètre utilisable depuis Basket');
await page.evaluate(()=>{setCoachInterface(false)});assert.equal(await page.evaluate(()=>document.documentElement.dataset.coachUi),'current');ok('Style bêta retiré au retour à l’interface actuelle');
assert.deepEqual(errors,[]);ok('Aucune erreur JavaScript dans les parcours testés');
fs.writeFileSync(path.join(output,'verification-coach-beta-253.json'),JSON.stringify({passed,errors,syntheticData:true,remoteBusinessWrites:false},null,2));
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
