// Exécute les fonctions de l'éditeur réel, sans boot, DOM ni accès réseau.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const source = fs.readFileSync(fileURLToPath(new URL('../src/plays-editor-poc.html', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name);
  const lineEnd = source.indexOf('\n', start);
  if (source.slice(start, lineEnd).trimEnd().endsWith('}')) return source.slice(start, lineEnd);
  const end = source.indexOf('\n  }', lineEnd);
  assert.ok(end > start, name + ' body');
  return source.slice(start, end + 4);
}
const names = ['clonePos','isMoveKind','endPos','pullPos','recomputeList','recomputeTree',
  'tmBallList','ballInit','stEv','evWin','evSet','ballStateAt','evPlan','evApply','ballLegsAt','ballWalk','ballsAt',
  'evRemoveArrow','clearTrainingShot','tmBallsOf','tmPassBall','addArrow','removeArrow','tbAssign',
  'tmShotTap','tmBasketTap','tmHeldBalls','tmArmBall','framePositions','tbSlotPos','ballViewAt','lerpPts',
  'encSteps','decSteps','placeToken','tbAdd','tbSelect','tmAttach','setTool','setEMode'];
function context() {
  const c = {
    doc: { mode: 'training', balls: [{ id:'b1' }], ballInit:{b1:'a1'}, training:{steps:[{pos:{a1:{x:0,y:0},a2:{x:100,y:0},a3:{x:200,y:0}}, arw:[] }]} },
    cur:0, bpath:[], tbSel:null, PLAY:{move:[0,.65],pass:[.45,.9],shot:[.7,1]}, EV_WIN:{move:[.5,1],set:null},
    BALL_PER_PLAYER:2, PR:1, view:'2d', TOKMAP:{a1:{},a2:{},a3:{}}, playing:false, tool:'select',
    pPrepared:-1,pPaths:null, tmShotFrom:null,
    document:{body:{classList:{contains:()=>false}}},tokEl:{a1:{setAttribute(){}}},depthScale:()=>1,f:x=>x,
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)), ease:t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2,
    win:(u,w)=>Math.max(0,Math.min(1,(u-w[0])/(w[1]-w[0]))),
    VIEWS:{'2d':{project:q=>q}},visible:()=>true,tmBaskets:()=>[{id:'main',x:50,y:50}],
    quadAt:(a,c,b,t)=>({x:(1-t)**2*a.x+2*(1-t)*t*c.x+t*t*b.x,y:(1-t)**2*a.y+2*(1-t)*t*c.y+t*t*b.y}),
    uid:(()=>{let n=0;return prefix=>prefix+(++n);})(), labelOf:x=>x,
    toast(){},drawTrainBalls(){},tbListSync(){},drawArrows(){},syncInfo(){},renderTimeline(){},touch(){},setHint(){},syncBall(){},
    tmShotArm(id){c.tmShotFrom=id;},
    pt:q=>({x:q.x,y:q.y}),numOf:id=>id,pick:(o,...ks)=>ks.map(k=>o[k]).find(v=>v!==undefined),
    refId:v=>typeof v==='string'&&/^a\d+$/.test(v)?v:null,refPoint:v=>v&&typeof v.x==='number'?v:null,
    makeStep:pos=>({pos,arw:[],shot:null}), BR_DEPTH_MAX:6, BR_PER_STEP_MAX:8,
  };
  c.rootSteps=()=>c.doc.training.steps;c.steps=()=>c.doc.training.steps;c.step=()=>c.steps()[c.cur];c.mode=()=>c.doc.mode;c.pos=()=>c.step().pos;
  vm.createContext(c);vm.runInContext(names.map(extract).join('\n'),c);return c;
}
let passed=0;
function test(name,fn){fn();passed++;console.log('OK '+name);}
function pass(c,from,to){const e=c.tmPassBall(from,to);assert.ok(e);c.addArrow('pass',from,to,e);return c.step().arw.at(-1);}
test('Deux passes du même ballon restent deux actions ordonnées',()=>{
 const c=context();pass(c,'a1','a2');pass(c,'a2','a3');assert.equal(c.step().ballEv.length,2);
 assert.equal(c.ballsAt(0).b1,'a3');assert.equal(c.ballStateAt(0,.5).b1,'a2');assert.equal(c.ballStateAt(0,.3).b1,null);
});
test('Réception puis tir : conserve la passe et annule uniquement le tir',()=>{
 const c=context();pass(c,'a1','a2');c.tmShotFrom='a2';c.tbSel='b1';c.tmBasketTap('main');
 assert.equal(c.step().ballEv.length,2);assert.equal(c.ballsAt(0).b1,'@main');
 c.removeArrow('__shot');assert.equal(c.ballsAt(0).b1,'a2');assert.equal(c.step().ballEv.length,1);
});
test('Retaper la tireuse annule aussi le transfert',()=>{
 const c=context();c.tmShotFrom='a1';c.tbSel='b1';c.tmBasketTap('main');c.tmShotTap('a1');assert.equal(c.ballsAt(0).b1,'a1');
});
test('Supprimer une passe invalide la passe suivante sans téléporter le ballon',()=>{
 const c=context();const a=pass(c,'a1','a2');pass(c,'a2','a3');c.removeArrow(a.id);
 assert.equal(c.step().ballEv.length,1);assert.equal(c.ballsAt(0).b1,'a1');assert.equal(c.ballLegsAt(0).legs.b1,undefined);
});
test('Suppression rétrocompatible sans identifiant de flèche',()=>{
 const c=context();const a=pass(c,'a1','a2');delete c.step().ballEv[0].arrow;c.removeArrow(a.id);assert.equal(c.ballsAt(0).b1,'a1');
});
test('Deux ballons, seule la passe choisie est supprimée',()=>{
 const c=context();c.doc.balls.push({id:'b2'});c.doc.ballInit.b2='a1';c.tbSel='b1';const a=pass(c,'a1','a2');c.tbSel='b2';pass(c,'a1','a2');
 c.removeArrow(a.id);assert.equal(c.ballsAt(0).b1,'a1');assert.equal(c.ballsAt(0).b2,'a2');
});
test('Refuse les passes sans ballon et une troisième balle chez la receveuse',()=>{
 const c=context();assert.equal(c.tmPassBall('a2','a3'),false);c.doc.balls.push({id:'b2'},{id:'b3'});c.doc.ballInit.b2='a2';c.doc.ballInit.b3='a2';assert.equal(c.tmPassBall('a1','a2'),false);
});
test('Ramasser après un tir au premier temps ne réécrit pas la possession initiale',()=>{
 const c=context();c.tmShotFrom='a1';c.tbSel='b1';c.tmBasketTap('main');c.tbSel='b1';c.tbAssign('a2');
 assert.equal(c.doc.ballInit.b1,'a1');assert.equal(c.step().ballEv.length,2);assert.equal(c.ballsAt(0).b1,'a2');
});
test('La fin des mouvements simultanés ne dépend pas de l’ordre des flèches',()=>{
 const c=context(),st=c.step();st.arw=[{kind:'move',from:'a1',to:'a2'},{kind:'move',from:'a2',to:'a1'}];
 const end=c.endPos(st);assert.equal(end.a1.x,100);assert.equal(end.a2.x,0);st.arw.reverse();assert.equal(JSON.stringify(c.endPos(st)),JSON.stringify(end));
});
test('Modifier une course recale le temps suivant et ses branches',()=>{
 const c=context(),st=c.step();st.arw=[{kind:'move',from:'a1',to:{x:42,y:17}}];
 const next={pos:c.clonePos(st.pos),arw:[]};const branch={pos:c.clonePos(st.pos),arw:[]};st.branches=[{steps:[branch]}];c.steps().push(next);
 c.recomputeTree(c.steps(),next);assert.equal(next.pos.a1.x,42);assert.equal(branch.pos.a1.y,17);
});
test('La joueuse et son ballon partagent la position de la frame',()=>{
 const c=context();c.pPrepared=0;c.pPaths={moves:[{id:'a1',len:100,el:{getPointAtLength:l=>({x:l,y:20})}}]};
 const q=c.framePositions(0,.3),b=c.ballViewAt(0,.3,q)[0];assert.equal(b.at,'a1');assert.ok(Math.abs(b.pt.x-(q.a1.x-.9))<1e-9);
});
test('Placer une joueuse pendant la lecture ne programme pas un retour du ballon au début',()=>{
 const c=context();let n=0;c.tbSoon=()=>n++;c.placeToken('a1',{x:50,y:0});assert.equal(n,0);
 c.placeToken('a1');assert.equal(n,1);
});
test('Un ballon sans propriétaire ne fait pas planter le rendu',()=>{
 const c=context();delete c.doc.ballInit.b1;assert.equal(c.ballViewAt(0,0,c.step().pos)[0].pt,null);
});
test('La passe vise les positions au départ et à la réception, pas la frame courante',()=>{
 const c=context();pass(c,'a1','a2');c.pPrepared=0;c.pPaths={moves:[{id:'a1',len:100,el:{getPointAtLength:l=>({x:l,y:0})}}]};
 const a=c.ballViewAt(0,.6,{a1:{x:-999,y:0},a2:{x:100,y:0}})[0].pt;
 const b=c.ballViewAt(0,.6,{a1:{x:999,y:0},a2:{x:100,y:0}})[0].pt;assert.equal(JSON.stringify(a),JSON.stringify(b));
});
test('Export/import conserve les chaînes et leur lien avec les flèches',()=>{
 const c=context();pass(c,'a1','a2');pass(c,'a2','a3');const serialized=c.encSteps(c.steps(),[],0);
 c.doc.training.steps=c.decSteps(JSON.parse(JSON.stringify(serialized)),c.step().pos,0);
 assert.equal(c.ballsAt(0).b1,'a3');c.removeArrow(c.step().arw[0].id);assert.equal(c.ballsAt(0).b1,'a1');
});
function editorContext() {
 const c=context(), body={};
 c.document.body.setAttribute=(k,v)=>body[k]=v;
 c.document.getElementById=()=>({classList:{toggle(){}}});
 Object.assign(c,{BALL_CAP:6,emode:'court',EM_LIST:['court','players','balls','zones','notes'],
  EM_OF:{ball:'balls',shot:'balls'},TOOLS:['select','ball','shot'],layX:null,layC:null,
  svg:{querySelectorAll:()=>[]},drawAcc(){},accBarClose(){},syncSelection(){},closeSheets(){}});
 c.body=body; return c;
}
test('Ajout depuis Terrain : trois ballons affectables sans déplacer les joueuses',()=>{
 const c=editorContext();
 for(const id of ['a1','a2','a3']) { c.tbAdd(); assert.equal(c.emode,'balls'); assert.equal(c.tool,'ball'); assert.equal(c.tbAssign(id),true); }
 assert.equal(c.tmBallsOf('a1'),2);assert.equal(c.tmBallsOf('a2'),1);assert.equal(c.tmBallsOf('a3'),1);
});
test('Sélection dans la liste : ferme le panneau et active Ballons depuis Terrain',()=>{
 const c=editorContext();let closed=0;c.closeSheets=()=>closed++;
 c.tbSelect('b1');assert.equal(c.tbSel,'b1');assert.equal(c.tool,'ball');assert.equal(c.emode,'balls');assert.equal(closed,1);
});
test('Rattacher les paniers sans redessiner le terrain conserve les cibles',()=>{
 const c=context(), baskets=[{id:'main'},{id:'extra'}];let floor=baskets.slice(),top=[];
 const layer={set innerHTML(v){top=[];},appendChild(el){top.push(el);floor=floor.filter(x=>x!==el);}};
 c.layX=null;c.layC={querySelectorAll:()=>floor.slice()};c.document.getElementById=()=>layer;
 c.svg={querySelectorAll:()=>[]};c.tmAttach();c.tmAttach();c.tmAttach();assert.deepEqual(top,baskets);
 floor=[{id:'new-main'},{id:'new-extra'}];c.tmAttach();assert.equal(top.length,2);assert.equal(top[1].id,'new-extra');
});
test('Tir avec deux ballons : choisir le ballon avant de sélectionner le panier additionnel',()=>{
 const c=context();c.doc.balls.push({id:'b2'});c.doc.ballInit.b2='a1';let choose;
 c.bpOpen=(anchor,items,cb)=>choose=cb;c.tmBaskets=()=>[{id:'main'},{id:'extra'}];
 c.tmShotTap('a1');assert.equal(c.tmShotFrom,null);choose('b2');assert.equal(c.tmShotFrom,'a1');
 c.tmBasketTap('extra');assert.equal(c.step().shotBk,'extra');assert.equal(c.ballsAt(0).b2,'@extra');assert.equal(c.ballsAt(0).b1,'a1');
});
test('Quitter Tir désarme la sélection du panier',()=>{
 const c=editorContext();c.tmShotFrom='a1';c.setTool('ball');assert.equal(c.tmShotFrom,null);
});
console.log(`${passed} scénarios réussis`);
