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

await page.evaluate(()=>{setCoachInterface(true);state.convocations=[{id:'demo-home',type:'training',title:'Jeu rapide & défense collective',date:isoDate(new Date()),time:'19:30',location:'Gymnase du club',seasonId:state.currentSeasonId,responses:{}}];render()});
await page.waitForTimeout(400);
const before=await page.evaluate(()=>JSON.stringify(state.convocations));
for(const width of [390,360,768]){
 await page.setViewportSize({width,height:900});
 for(const theme of ['bcl','midnight']){
  await page.evaluate(theme=>setThemeId(theme),theme);await page.waitForTimeout(100);
  await page.screenshot({animations:'disabled',path:path.join(output,'accueil-coach-proposition-'+width+'-'+theme+'.png')});
  assert.equal(await page.evaluate(()=>document.querySelector('.app').scrollWidth<=document.querySelector('.app').clientWidth),true);
 }
}ok('Accueil sans débordement à 360, 390 et 768 px, thèmes clair et sombre');
await page.setViewportSize({width:390,height:900});await page.evaluate(()=>setThemeId('bcl'));
await page.getByRole('button',{name:/Préparer la séance/}).click();assert.ok((await page.locator('#modal-root').innerText()).includes('Jeu rapide'));await page.evaluate(()=>closeModal());await page.waitForTimeout(150);ok('Carte reliée au détail réel du rendez-vous');
await page.locator('.hr-actions [data-beta-action="event"]').click();assert.ok(await page.locator('#modal-root input').count());await page.evaluate(()=>closeModal());await page.waitForTimeout(150);ok('Création de séance accessible');
await page.locator('.hr-actions [data-beta-action="message"]').click();assert.ok(await page.locator('#modal-root textarea').count());await page.evaluate(()=>closeModal());await page.waitForTimeout(150);ok('Composition de message accessible, sans envoi');
await page.locator('#gamification-menu > summary').click();assert.equal(await page.locator('#gamification-menu').getAttribute('open'),'');ok('Menu Jeux et défis accessible');
assert.equal(await page.evaluate(()=>JSON.stringify(state.convocations)),before);ok('Aucune modification du rendez-vous en consultant l’accueil');
await page.locator('.hr-more > summary').click();await page.locator('[data-beta-action="legacy"]').click();assert.equal(await page.locator('.coach-home-review').count(),0);ok('Accueil complet accessible');
await page.evaluate(()=>{goSection('home');state.convocations=[];render()});assert.ok(await page.getByRole('button',{name:/Planifier une séance/}).count());await page.screenshot({animations:'disabled',path:path.join(output,'accueil-coach-proposition-vide.png')});ok('État sans événement');
await page.evaluate(()=>setCoachInterface(false));assert.equal(await page.locator('.coach-home-review').count(),0);ok('Retour à l’interface actuelle');
assert.deepEqual(errors,[]);ok('Aucune erreur JavaScript');
fs.writeFileSync(path.join(output,'verification-accueil-proposition.json'),JSON.stringify({passed,errors,syntheticData:true,deployed:false},null,2));
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
