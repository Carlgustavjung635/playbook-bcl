const fs=require('fs'),http=require('http'),assert=require('assert/strict');
// Run with Playwright installed, or PB_PLAYWRIGHT_MODULE pointing to its package.
// PB_CHROME optionally selects a local Chrome binary; otherwise use Playwright Chromium.
const path=require('path'),os=require('os');
const {chromium}=require(process.env.PB_PLAYWRIGHT_MODULE || 'playwright');
const output=process.env.PB_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(),'pb-games-'));
fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8').replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",'const createClient=window.__fakeCreateClient;');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url.startsWith('/src/')?'<button onclick="history.back()">Retour</button>':html)});
const passed=[];
function ok(name){passed.push(name);console.log('OK '+name)}
(async()=>{await new Promise(r=>server.listen(8885,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.PB_CHROME || undefined});
try{
const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(7000);
await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:8885/')?route.continue():route.abort());
await page.addInitScript(()=>{window.__fakeCreateClient=()=>{const chain=new Proxy({},{get(_,key){if(key==='then')return resolve=>Promise.resolve({data:[],error:{message:'offline simulation'}}).then(resolve);return ()=>chain}});return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},from:()=>chain,channel:()=>chain,removeChannel(){}}};});
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8885/');await page.waitForTimeout(250);
await page.evaluate(()=>{
  Pb.online=false;ffbbDash().lastAutoSync=Date.now(); // Isolate the unrelated FFBB fetch from this local UX test.
  state.auth={role:'coach',coachId:'fixture',coachRole:'admin_coach'};
  state.gages=[];state.gageDraws=[];state.ardoiseAssignments=[];state.pintadePeriods=[];state.pintadeRequests=[];state.pintadeIncidents=[];state.challenges=[];state.players=[{id:'p1',name:'Test',num:1,badges:[]}];
  state.pointsLedger=[];state.pointsHarvests=[];state.exoTemplates=[];state.sanctionTemplates=[];state.gageDefis=[];
  window.__gameSnapshot=()=>JSON.stringify({gages:state.gages,draws:state.gageDraws,ardoise:state.ardoiseAssignments,periods:state.pintadePeriods,requests:state.pintadeRequests,incidents:state.pintadeIncidents,points:state.pointsLedger,harvests:state.pointsHarvests,players:state.players,challenges:state.challenges});
  window.__paintGame=()=>document.getElementById('root').innerHTML=renderGamificationMenu();
  window.__before=__gameSnapshot(); __paintGame();
});
assert.equal(await page.locator('#gamification-menu').getAttribute('open'),null);
assert.ok((await page.locator('#gamification-menu').boundingBox()).height<120);
assert.equal(await page.locator('[data-game-section]').count(),5);ok('Menu coach replié, cinq rubriques accessibles même sans données');
await page.locator('#gamification-menu > summary').click();
await page.locator('[data-game-section="gages"] > summary').click();
await page.waitForTimeout(80);await page.evaluate(()=>__paintGame());
assert.equal(await page.locator('#gamification-menu').evaluate(e=>e.open),true);
assert.equal(await page.locator('[data-game-section="gages"]').evaluate(e=>e.open),true);
assert.equal(await page.evaluate(()=>__gameSnapshot()===__before),true);ok('Déplier et replier est sans mutation métier ; état ouvert conservé au rendu');
const home=await page.evaluate(()=>{const el=document.createElement('div');el.innerHTML=renderHomeCoach();return {menu:el.querySelectorAll('#gamification-menu').length,outside:[...el.querySelectorAll('[onclick]')].filter(e=>/openGagesCoach|openPintade|openArdoiseCoach/.test(e.getAttribute('onclick'))&&!e.closest('#gamification-menu')).length}});
assert.deepEqual(home,{menu:1,outside:0});ok('Accueil coach : les anciennes cartes de jeux sont toutes à l’intérieur du menu');
await page.evaluate(()=>{state.gages=[{id:'g1',status:'pending'}];state.gageDraws=[{id:'d1',playerId:'p1',status:'player_done'},{id:'old',playerId:'p1',status:'confirmed'}];state.ardoiseAssignments=[{id:'a1',playerId:'p1',status:'done_home'},{id:'deleted',playerId:'p1',status:'done_home',deletedAt:1}];__paintGame()});
assert.equal(await page.evaluate(()=>_gameMenuStatus().gages),2);assert.equal(await page.evaluate(()=>_gameMenuStatus().ardoise),1);ok('Résumé coach : propositions et confirmations, preuves Ardoise actives uniquement');
await page.evaluate(()=>{state.auth={role:'player',playerId:'p1'};state.gages=[{id:'g1',text:'Gage fictif',status:'approved'}];state.gageDraws=[{id:'d1',playerId:'p1',gageId:'g1',kind:'classique',status:'accepted'},{id:'other',playerId:'p2',status:'accepted'}];state.ardoiseAssignments=[{id:'a1',playerId:'p1',status:'in_progress',deadlineAt:Date.now()-1000,items:[]},{id:'other',playerId:'p2',status:'in_progress',deadlineAt:Date.now()-1000}];window.__before=__gameSnapshot();__paintGame()});
assert.equal(await page.locator('#gamification-menu').evaluate(e=>e.open),false);assert.equal(await page.evaluate(()=>_gameMenuStatus().gages),1);assert.equal(await page.evaluate(()=>_gameMenuStatus().ardoise),1);
assert.ok((await page.locator('#gamification-menu > summary').innerText()).includes('Ardoise en retard'));ok('Joueuse : résumé personnel et retard visible sans ouvrir le menu ; état réinitialisé au changement de rôle');
await page.locator('#gamification-menu > summary').click();await page.locator('[data-game-section="gages"] > summary').click();
assert.equal(await page.getByRole('button',{name:"J'ai fait le gage ✓",exact:true}).isVisible(),true);
assert.equal(await page.evaluate(()=>__gameSnapshot()===__before),true);ok('Rappel et action de validation toujours accessibles, sans changement des états');
const playerHome=await page.evaluate(()=>{const el=document.createElement('div');el.innerHTML=renderHomePlayer();return {menu:el.querySelectorAll('#gamification-menu').length,points:el.querySelectorAll('#pts-bank').length,outside:[...el.querySelectorAll('[onclick]')].filter(e=>/openProposeGage|openPintadeScreen|openArdoiseScreen|harvestPoints/.test(e.getAttribute('onclick'))&&!e.closest('#gamification-menu')).length}});
assert.deepEqual(playerHome,{menu:1,points:1,outside:0});ok('Accueil joueuse : points et jeux regroupés sans doublon de banque');
await page.locator('[data-game-section="gages"] > summary').click();await page.locator('[data-game-section="points"] > summary').click();
assert.equal(await page.getByRole('button',{name:'Mes trophées',exact:true}).isVisible(),true);ok('Points, récolte et palmarès restent accessibles');
await page.locator('[data-game-section="points"] > summary').click();
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.screenshot({path:path.join(output,'gamification-251-mobile-open.png')});
await page.locator('#gamification-menu > summary').click();await page.screenshot({path:path.join(output,'gamification-251-mobile-closed.png')});
assert.ok((await page.locator('#gamification-menu').boundingBox()).height<120);ok('À 390 px : menu replié inférieur à 120 px et aucun débordement horizontal');
const hiddenGain=await page.evaluate(()=>{const sid=state.currentSeasonId || getActiveSeasonId();_setPointsSeenTotal('p1',sid,-100);_pointsCheckGain();return _pointsSeenTotal('p1',sid)});assert.equal(hiddenGain,-100);
await page.locator('#gamification-menu > summary').click();await page.locator('[data-game-section="points"] > summary').click();await page.waitForTimeout(80);
assert.equal(await page.evaluate(()=>{const sid=state.currentSeasonId || getActiveSeasonId();return _pointsSeenTotal('p1',sid)===playerPointsTotal('p1',sid)}),true);ok('Gain de points non consommé quand le menu est fermé, annoncé à l’ouverture de Points');
await page.evaluate(()=>{state.auth={role:'stat'};__paintGame()});assert.equal(await page.locator('#gamification-menu').count(),0);ok('Aucun menu de joueuse ou coach pour un autre rôle');
assert.deepEqual(errors,[]);ok('Application complète sans erreur JavaScript');
fs.writeFileSync(path.join(output,'verification-gamification-251.json'),JSON.stringify({passed,errors,syntheticData:true,remoteBusinessWrites:false},null,2));
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
