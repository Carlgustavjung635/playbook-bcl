const fs=require('fs'),http=require('http'),assert=require('assert/strict');
// Run with Playwright installed, or PB_PLAYWRIGHT_MODULE pointing to its package.
// PB_CHROME optionally selects a local Chrome binary; otherwise use Playwright Chromium.
const path=require('path'),os=require('os');
const {chromium}=require(process.env.PB_PLAYWRIGHT_MODULE || 'playwright');
const output=process.env.PB_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(),'pb-library-'));
fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",'const createClient=window.__fakeCreateClient;');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url.startsWith('/src/')?'<button onclick="history.back()">Retour</button>':html)});
const passed=[];
function ok(name){passed.push(name);console.log('OK '+name)}
(async()=>{await new Promise(r=>server.listen(8884,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.PB_CHROME || undefined});
try{
const page=await browser.newPage({viewport:{width:390,height:844}});
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8884/')?route.continue():route.abort());
await page.addInitScript(()=>{window.__fakeCreateClient=()=>{const chain=new Proxy({},{get(_,key){if(key==='then')return resolve=>Promise.resolve({data:[],error:{message:'offline simulation'}}).then(resolve);return ()=>chain}});return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},from:()=>chain,channel:()=>chain,removeChannel(){}}};});
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8884/');await page.waitForTimeout(250);
await page.evaluate(()=>{
  Pb.online=false;
  state.auth={role:'coach',coachId:'fixture',coachRole:'admin_coach'};
  state.exoTemplates=[{id:'same',name:'Gainage équilibré',category:'gainage',drillId:'linked',defaultSets:3,defaultReps:12,defaultRestSec:30,descriptionMd:'Consigne',illustrationUrl:'keep',createdAt:10,custom:'keep'}, {id:'gone',name:'Archived',deletedAt:1}];
  state.drills=[{id:'same',name:'Réaction test',mode:'stimulus'},{id:'linked',name:'Fractionné test',mode:'interval'},{id:'preset',name:'Preset',isPreset:true},{id:'gone',name:'Archived',deletedAt:1}];
  state.sanctionTemplates=[{id:'same',name:'Gainage sanction',sets:2,reps:10,notes:'keep',createdAt:12}];
  state.ardoiseAssignments=[{id:'assignment',status:'completed',items:[{exo_id:'same',name:'Ancien nom',sets:5}]}];
  state.trainingPlans=[{id:'plan',exercises:[{exercise_ref_id:'same'}]}];
  TREX.list=[{id:'same',title:'Passe basket',data:{steps:[{},{}],balls:[{}]}}];
  const lib=_exerciseLibraryState();lib.basket=TREX.list;lib.at=Date.now();
  window.__snapshot=()=>JSON.stringify({exos:state.exoTemplates,drills:state.drills,sanctions:state.sanctionTemplates,assignments:state.ardoiseAssignments,plans:state.trainingPlans,basket:TREX.list});
  window.__before=__snapshot();
  openExerciseLibrary('all');
});
assert.equal(await page.locator('#exercise-library article').count(),5);ok('Les quatre sources coexistent, les fiches supprimées et presets sont exclus');
await page.locator('#exercise-library-q').fill('equilibre');
assert.equal(await page.locator('#exercise-library article').count(),1);
assert.equal(await page.locator('#exercise-library-q').evaluate(e=>document.activeElement===e),true);ok('Recherche sans accents, focus conservé pendant la saisie');
await page.locator('#exercise-library-q').fill('');
await page.getByRole('button',{name:'Sanctions',exact:true}).click();assert.equal(await page.locator('#exercise-library article').count(),1);
await page.getByRole('button',{name:'Tous',exact:true}).click();
assert.equal(await page.evaluate(()=>__snapshot()===__before),true);ok('Ouvrir, chercher et filtrer ne modifie aucune fiche, affectation ni référence');
// Dispatch identities are checked against the real lookup with spies only at the navigation boundary.
const dispatched=await page.evaluate(()=>{const oldExo=openExoEditor,oldSanction=openSanctionTemplateEditor,oldBasket=openTrainingExoEditor,oldDrill=launchDrillByMode;const calls=[];
  openExoEditor=(...x)=>calls.push(['physical',...x]);openSanctionTemplateEditor=(...x)=>calls.push(['sanction',...x]);openTrainingExoEditor=(...x)=>calls.push(['basket',...x]);launchDrillByMode=(...x)=>calls.push(['guide',...x]);
  _exerciseLibraryAction('physical','same','edit');_exerciseLibraryAction('sanction','same','edit');_exerciseLibraryAction('basket','same','launch');_exerciseLibraryAction('physical','same','launch');
  openExoEditor=oldExo;openSanctionTemplateEditor=oldSanction;openTrainingExoEditor=oldBasket;launchDrillByMode=oldDrill;sessionStorage.removeItem('pb_exercise_library_return');window._drillReturnTo=null;return calls;
});
assert.deepEqual(dispatched,[['physical','same',true],['sanction','same',true],['basket','same','view'],['guide','linked']]);ok('Un même id dans quatre sources ouvre la bonne fiche ; le guidage lié est résolu');
await page.getByRole('button',{name:'Physique',exact:true}).click();
await page.locator('#exercise-library-q').fill('gainage');
await page.getByRole('button',{name:'Modifier',exact:true}).click();
assert.equal(await page.locator('#ard-e-name').inputValue(),'Gainage équilibré');
await page.locator('#ard-e-name').fill('Gainage révisé');
await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.waitForTimeout(200);
assert.equal(await page.locator('#exercise-library-q').inputValue(),'gainage');
assert.equal(await page.getByRole('button',{name:'Physique',exact:true}).getAttribute('aria-pressed'),'true');
const preserved=await page.evaluate(()=>({exo:state.exoTemplates[0],sameOthers:JSON.parse(__before).assignments[0].items[0].name===state.ardoiseAssignments[0].items[0].name,plan:state.trainingPlans[0].exercises[0].exercise_ref_id,sanction:state.sanctionTemplates[0].name}));
assert.equal(preserved.exo.name,'Gainage révisé');assert.equal(preserved.exo.id,'same');assert.equal(preserved.exo.drillId,'linked');assert.equal(preserved.exo.illustrationUrl,'keep');assert.equal(preserved.exo.custom,'keep');assert.equal(preserved.exo.createdAt,10);assert.equal(preserved.sameOthers,true);assert.equal(preserved.plan,'same');assert.equal(preserved.sanction,'Gainage sanction');ok('Modification physique : identité, guidage, champs annexes et historique conservés ; retour à la recherche');
await page.getByRole('button',{name:'Sanctions',exact:true}).click();await page.getByRole('button',{name:'Modifier',exact:true}).click();await page.locator('#sct-name').fill('Gainage sanction révisée');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.waitForTimeout(200);
assert.equal(await page.locator('#exercise-library-q').inputValue(),'gainage');assert.equal(await page.evaluate(()=>state.sanctionTemplates[0].notes),'keep');ok('Modification de sanction : retour à la bibliothèque et notes conservées');
// Partial paginated read failure must not replace cache.
const loading=await page.evaluate(async()=>{const before=JSON.stringify(_exerciseLibraryState().basket);const old=window.sb;const pages=[];window.sb={from:()=>({select(){return this},is(){return this},order(){return this},range:async(a,b)=>{pages.push([a,b]);return a===0?{data:Array.from({length:1000},(_,i)=>({id:'remote'+i,title:'Remote'}))}:{error:{message:'offline'}}}})};await _exerciseLibraryLoadBasket(true);const kept=JSON.stringify(_exerciseLibraryState().basket)===before;const error=_exerciseLibraryState().error;window.sb=old;return {kept,error,pages}});
assert.deepEqual(loading,{kept:true,error:true,pages:[[0,999],[1000,1999]]});ok('Échec sur la deuxième page : cache intégral préservé et erreur visible');
const full=await page.evaluate(async()=>{const old=window.sb;window.sb={from:()=>({select(){return this},is(){return this},order(){return this},range:async(a)=>({data:a===0?Array.from({length:1000},(_,i)=>({id:'r'+i,title:'Remote'})):[{id:'last',title:'Last'}]})})};await _exerciseLibraryLoadBasket(true);const n=_exerciseLibraryState().basket.length;window.sb=old;_exerciseLibraryState().basket=TREX.list;_exerciseLibraryRefresh();return n});assert.equal(full,1001);ok('Bibliothèque basket paginée au-delà de 1 000 fiches');
await page.locator('#exercise-library-q').fill('');await page.getByRole('button',{name:'Tous',exact:true}).click();
assert.equal(await page.evaluate(()=>document.querySelector('#modal-root .modal').scrollWidth<=document.querySelector('#modal-root .modal').clientWidth+1),true);
await page.screenshot({path:path.join(output,'library-250-mobile.png')});ok('Bibliothèque lisible à 390 px, sans débordement horizontal');
await page.getByRole('button',{name:'+ Créer un exercice',exact:true}).click();assert.equal(await page.getByRole('button',{name:/🏀 Basket/}).count(),1);assert.equal(await page.getByRole('button',{name:/🏋 Physique/}).count(),1);
await page.getByRole('button',{name:/🏋 Physique/}).click();assert.equal(await page.locator('#ard-e-name').inputValue(),'');await page.locator('.modal-close').click();await page.waitForTimeout(100);assert.equal(await page.locator('#exercise-library').count(),1);ok('Création guidée Basket / Physique et annulation sans fiche fantôme');
await page.getByRole('button',{name:'Physique',exact:true}).click();
await page.locator('#exercise-library-q').fill('gainage');await page.getByRole('button',{name:'▶ Lancer',exact:true}).click();
await page.getByRole('button',{name:'Arrêter le fractionné',exact:true}).click();await page.waitForTimeout(150);
assert.equal(await page.locator('#exercise-library-q').inputValue(),'gainage');assert.equal(await page.getByRole('button',{name:'Physique',exact:true}).getAttribute('aria-pressed'),'true');ok('Lancement réel du fractionné lié puis retour à la recherche physique');
await page.getByRole('button',{name:'Guidages',exact:true}).click();await page.locator('#exercise-library-q').fill('');
await page.locator('#exercise-library article').filter({hasText:'Fractionné test'}).getByRole('button',{name:'Réglages',exact:true}).click();
await page.locator('button[title="Modifier"]').click();assert.ok(await page.locator('.modal').innerText());
// Existing wizard returns to the guided library; its explicit shared-library link restores the original filter.
await page.evaluate(()=>openDrillLibrary());await page.getByRole('button',{name:'← Bibliothèque d’exercices',exact:true}).click();
assert.equal(await page.getByRole('button',{name:'Guidages',exact:true}).getAttribute('aria-pressed'),'true');ok('Réglages du fractionné accessibles et retour au filtre Guidages');
await page.getByRole('button',{name:'Basket',exact:true}).click();await page.getByRole('button',{name:'▶ Voir l’animation',exact:true}).click();
await page.waitForURL('**/src/plays-editor-poc.html?**');assert.ok(page.url().includes('exo=same'));assert.ok(page.url().includes('mode=view'));
await page.getByRole('button',{name:'Retour',exact:true}).click();await page.waitForURL('http://127.0.0.1:8884/**');await page.waitForTimeout(500);
assert.equal(await page.locator('#exercise-library').count(),1);assert.equal(await page.getByRole('button',{name:'Basket',exact:true}).getAttribute('aria-pressed'),'true');ok('Aller-retour navigateur vers l’animation : bibliothèque et filtre restaurés');
await page.evaluate(()=>{state.auth={role:'coach',coachId:'scoped',coachRole:'coach',teams:['e1']};openExerciseLibrary()});assert.equal(await page.getByRole('button',{name:'+ Créer un exercice',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Modifier',exact:true}).count(),0);ok('Coach restreint : commandes de modification masquées');
await page.evaluate(()=>{closeModal();state.auth={role:'player'};openExerciseLibrary()});assert.equal(await page.locator('#exercise-library').count(),0);ok('La bibliothèque coach ne s’ouvre pas pour une joueuse');
assert.deepEqual(errors,[]);ok('Aucune erreur JavaScript dans l’application complète');
fs.writeFileSync(path.join(output,'verification-library-250.json'),JSON.stringify({passed,errors,syntheticData:true,remoteBusinessWrites:false},null,2));
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
