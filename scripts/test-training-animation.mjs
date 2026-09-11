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
  'stepShots','syncTrainingShot','evRemoveArrow','clearTrainingShot','tmBallsOf','tmPassBall','addArrow','removeArrow','tbAssign',
  'tmShotTap','tmBasketTap','tmHeldBalls','tmArmBall','framePositions','tbSlotPos','ballViewAt','ballFlight','lerpPts',
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
test('Cliquer le dernier ballon ajouté confirme son affectation',()=>{
 const c=editorContext();c.tbAdd();const bid=c.tbSel;c.tbSelect(bid);
 assert.equal(c.tbSel,bid);assert.equal(c.tbAssign('a2'),true);assert.equal(c.ballsAt(0)[bid],'a2');
});
test('Six ballons peuvent être affectés et transférés indépendamment',()=>{
 const c=editorContext();c.doc.balls=[];c.doc.ballInit={};
 for(let i=0;i<6;i++)c.tbAdd();
 const ids=c.doc.balls.map(b=>b.id);
 ids.forEach((id,i)=>{c.tbSelect(id);assert.equal(c.tbAssign('a'+(1+Math.floor(i/2))),true);});
 ids.forEach((id,i)=>{c.tbSelect(id);assert.equal(c.tbAssign('@main'),true);assert.equal(c.ballsAt(0)[id],'@main');});
 assert.equal(new Set(ids).size,6);
});
test('Les deux paniers officiels et les dix paniers additionnels sont des cibles',()=>{
 const c=context();vm.runInContext(extract('tmBaskets'),c);c.TM_BASKET_MAX=10;
 c.tmDims=()=>({base:'full',el:60,et:20,bw:174,bh:304});
 c.doc.extraBaskets=Array.from({length:10},(_,i)=>({id:'extra'+i,x:15,y:40+i*20}));
 const b=c.tmBaskets();assert.equal(b.length,12);assert.equal(b[0].id,'main');assert.equal(b[1].id,'opposite');
 assert.equal(b[0].y,47.75);assert.equal(b[1].y,296.25);
 c.tmShotFrom='a1';c.tbSel='b1';c.tmBasketTap('opposite');assert.equal(c.ballsAt(0).b1,'@opposite');
 c.tmDims=()=>({base:'half',el:0,et:0,bw:174,bh:164});assert.equal(c.tmBaskets().length,11);
});
test('Les ballons rangés dans un panier ne se superposent pas',()=>{
 const c=context();const a=c.tbSlotPos('@main',0,c.step().pos),b=c.tbSlotPos('@main',1,c.step().pos);
 assert.notEqual(a.x,b.x);assert.equal(a.y,b.y);
});
test('Terrain → mouvements joueuse → Ballons conserve tous les paniers',()=>{
 const c=editorContext(), baskets=[{id:'main'},{id:'opposite'},{id:'extra'}];
 let floor=baskets.slice(),top=[];
 const layer={set innerHTML(v){top=[];},appendChild(el){top.push(el);floor=floor.filter(x=>x!==el);}};
 const get=c.document.getElementById;c.document.getElementById=id=>id==='lay-bk'?layer:get(id);
 c.layC={querySelectorAll:()=>floor.slice()};c.EM_OF.move='players';
 c.EM_TOOLS={players:['select','move'],court:['select'],balls:['ball','shot']};
 c.EM_DEF={players:'select',court:'select',balls:'ball'};
 c.tmAttach();c.setEMode('players');c.setTool('move');
 assert.equal(c.tool,'move');assert.deepEqual(top,baskets);
 c.setEMode('balls');assert.deepEqual(top,baskets);
});

function shoot(c, from, ball, basket) { c.tmShotFrom=from;c.tbSel=ball;assert.equal(c.tmBasketTap(basket),true); }
function multiContext() {
 const c=context();c.doc.balls=[{id:'b1'},{id:'b2'},{id:'b3'}];c.doc.ballInit={b1:'a1',b2:'a2',b3:'a3'};
 c.tmBaskets=()=>[{id:'main',x:50,y:50},{id:'extra',x:150,y:70}];return c;
}
test('Trois joueuses tirent simultanément vers des paniers distincts ou communs',()=>{
 const c=multiContext();shoot(c,'a1','b1','main');shoot(c,'a2','b2','extra');shoot(c,'a3','b3','main');
 assert.equal(c.stepShots(c.step()).length,3);
 for(const bid of ['b1','b2','b3']) {assert.equal(c.ballWalk(bid,c.ballLegsAt(0),.85).fly.t,'shot');assert.deepEqual(Array.from(c.ballLegsAt(0).legs[bid][0].win),[.7,1]);}
 assert.equal(c.ballsAt(0).b1,'@main');assert.equal(c.ballsAt(0).b2,'@extra');assert.equal(c.ballsAt(0).b3,'@main');
});
test('Supprimer un tir ou retaper une tireuse préserve les autres tirs',()=>{
 const c=multiContext();shoot(c,'a1','b1','main');shoot(c,'a2','b2','extra');shoot(c,'a3','b3','main');
 c.removeArrow('__shot:b2');assert.equal(c.ballsAt(0).b2,'a2');assert.equal(c.stepShots(c.step()).length,2);
 c.tmShotTap('a1');assert.equal(c.ballsAt(0).b1,'a1');assert.equal(c.ballsAt(0).b3,'@main');
});
test('Deux ballons chez la même joueuse peuvent chacun être tirés',()=>{
 const c=multiContext();c.doc.ballInit.b2='a1';shoot(c,'a1','b1','main');c.tmShotTap('a1');assert.equal(c.tmShotFrom,'a1');
 c.tmBasketTap('extra');assert.equal(c.ballsAt(0).b1,'@main');assert.equal(c.ballsAt(0).b2,'@extra');
});
test('Export/import préserve tous les tirs et leurs cibles',()=>{
 const c=multiContext();shoot(c,'a1','b1','main');shoot(c,'a2','b2','extra');const flat=[];
 const data=c.encSteps(c.steps(),flat,0);assert.equal(flat.filter(x=>x.kind==='shot').length,2);
 c.doc.training.steps=c.decSteps(JSON.parse(JSON.stringify(data)),c.step().pos,0);
 assert.equal(c.stepShots(c.step()).length,2);assert.equal(c.ballsAt(0).b1,'@main');assert.equal(c.ballsAt(0).b2,'@extra');
});
function view3Context() {
 const c=multiContext();c.view='3d';c.PR=5;c.tokLift=()=>4.75;c.depthScale=()=>1.1;
 c.project3=q=>({x:q.x*.8+q.y*.2,y:q.y*.5-q.x*.1});c.VIEWS['3d']={project:c.project3};c.isoOf=()=>({s:.8,sy:.5});
 vm.runInContext(extract('rimPt'),c);return c;
}
test('En 3D, deux ballons restent aux côtés du jeton et au-dessus de ses pieds',()=>{
 const c=view3Context();c.doc.ballInit.b2='a1';const Q={a1:{x:100,y:120},a2:{x:80,y:90},a3:{x:50,y:50}};
 const foot=c.project3(Q.a1), a=c.tbSlotPos('a1',0,Q),b=c.tbSlotPos('a1',1,Q);
 assert.ok(a.x>foot.x && b.x<foot.x);assert.equal(a.y,foot.y-(4.75+5*.78)*1.1);assert.equal(a.y,b.y);
 assert.equal(c.ballViewAt(0,0,Q)[1].pt.x,b.x);
});
test('Les tirs 3D partent du bon ballon et arrivent à hauteur du cercle',()=>{
 const c=view3Context();c.doc.ballInit.b2='a1';shoot(c,'a1','b1','main');shoot(c,'a1','b2','extra');
 const leg=c.ballLegsAt(0).legs.b2[0], arc=c.ballFlight(leg,0,'b2');
 assert.equal(arc.a.x,c.tbSlotPos('a1',1,c.step().pos).x);assert.equal(arc.b.y,c.rimPt(c.tmBaskets()[1]).y);
 assert.ok(c.quadAt(arc.a,arc.c,arc.b,.5).y<Math.min(arc.a.y,arc.b.y));
});
test('Tous les paniers 3D sont en élévation avec une planche verticale orientée',()=>{
 const c=view3Context();c.MODES={training:{hoop:{x:50,y:50}},half:{}};c.mode=()=> 'training';
 vm.runInContext(['hoopsOf','hoop3','decorFront3','tmBasketMarkup','tmBasketHit'].map(extract).join('\n'),c);
 const hoops=c.hoopsOf('training');assert.equal(hoops.length,2);
 const html=c.decorFront3('training');assert.equal((html.match(/class="rim3"/g)||[]).length,2);
 assert.equal(c.tmBasketMarkup({id:'extra'}),'');assert.equal(c.tmBasketHit({id:'main'}),'');
 const a=c.hoop3({id:'extra',x:150,y:70,a:0}),b=c.hoop3({id:'extra',x:150,y:70,a:90});assert.notEqual(a,b);
 assert.ok(a.includes('class="bb3" d="M'));assert.ok(a.includes('cy="'+c.rimPt({x:150,y:70}).y+'"'));
});

test('Supprimer une tireuse ou un panier recale uniquement les tirs concernés',()=>{
 const c=multiContext();c.tmWalkSteps=cb=>c.steps().forEach(cb);vm.runInContext(extract('tmReholder'),c);
 shoot(c,'a1','b1','main');shoot(c,'a2','b2','extra');
 c.tmReholder('@extra','@main');assert.equal(c.ballsAt(0).b2,'@main');
 c.tmReholder('a2',null);assert.equal(c.stepShots(c.step()).length,1);assert.equal(c.step().shot,'a1');assert.equal(c.ballsAt(0).b1,'@main');
});
test('Le tir unique historique garde son rendu et son annulation',()=>{
 const c=context();c.step().shot='a1';delete c.step().ballEv;assert.equal(c.stepShots(c.step())[0].id,'__shot');
 c.removeArrow('__shot');assert.equal(c.step().shot,null);
});
console.log(passed + ' scénarios réussis');
