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


let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss()});
const recovery=await page.evaluate(()=>{
 const original=localStorage.getItem(K.matches);const legacy=JSON.stringify([{id:'quota-fixture',description:'photo-and-animation-fixture '.repeat(140000)}]);localStorage.setItem(K.matches,legacy);
 let n=100000;while(n<6000000){try{localStorage.setItem('quota-fixture-filler','z'.repeat(n));n+=100000}catch(_){break}}
 const payload={text:Array.from({length:25000},(_,i)=>i+' '+Math.sin(i)).join('|')};
 const saved=save('pb8_test_recovery',payload);const compacted=localStorage.getItem(K.matches).length;const same=JSON.stringify(load(K.matches,[]))===legacy;
 localStorage.removeItem('quota-fixture-filler');localStorage.removeItem('pb8_test_recovery');localStorage.setItem(K.matches,original);
 return {saved,same,before:legacy.length,after:compacted,unsaved:PbLocalStore.hasUnsaved()};
});assert.equal(recovery.saved,true);assert.equal(recovery.same,true);assert.equal(recovery.unsaved,false);assert.ok(recovery.after<recovery.before);ok('Quota réel Chrome atteint puis écriture récupérée par compression sans perte');
await page.evaluate(()=>{window.__originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('pb'))throw new DOMException('Test storage blocked','QuotaExceededError');return __originalSet.call(this,k,v)};state.plays[0].title='Modification hors ligne à sauver';persist()});
assert.equal(await page.locator('#pb-storage-warning').count(),1);assert.equal(await page.evaluate(()=>_pbBusyForReload()),'données locales non enregistrées');ok('Échec total : alerte persistante et rechargement automatique différé');
const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Sauvegarder sur cet appareil',exact:true}).click();const download=await downloadPromise;const target=path.join(output,'storage-rescue-synthetic.json');await download.saveAs(target);const backup=JSON.parse(fs.readFileSync(target,'utf8'));assert.equal(JSON.parse(backup.unsaved.pb8_plays)[0].title,'Modification hors ligne à sauver');assert.ok(Object.keys(backup.unsaved).some(k=>k.startsWith('pb8_sync_pending_v1:')));ok('Sauvegarde téléchargée : fiche et journal hors ligne inclus');
await page.screenshot({animations:'disabled',path:path.join(output,'storage-full-255.png')});
await page.evaluate(()=>{Storage.prototype.setItem=__originalSet});await page.getByRole('button',{name:'Réessayer',exact:true}).click();assert.equal(await page.locator('#pb-storage-warning').count(),0);assert.equal(await page.evaluate(()=>PbLocalStore.hasUnsaved()),false);ok('Réessayer confirme les écritures et enlève l’alerte après succès');
await page.reload();await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>state.plays[0].title),'Modification hors ligne à sauver');ok('Modification conservée après rechargement');
assert.equal(dialogs,0);assert.deepEqual(errors,[]);ok('Aucun popup Mémoire pleine ni erreur JavaScript');
fs.writeFileSync(path.join(output,'verification-storage-browser-255.json'),JSON.stringify({passed,errors,recovery,syntheticData:true,remoteWrites:false},null,2));
}finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
