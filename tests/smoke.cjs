const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const root=require('node:path').resolve(__dirname,'..');
const WebSocket=require(root+'/node_modules/ws');
const {normalize,oneEditApart,neighbors,dictionaryStats}=require(root+'/server');
const port=Number(process.env.TEST_PORT || 31357);
const child=spawn(process.execPath,[root+'/server.js'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:'pipe'});
const checks=[];
const clients=[];
function ok(name){checks.push(name);}
async function peer(){
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);clients.push(ws);const messages=[];
  ws.on('message',s=>messages.push(JSON.parse(String(s))));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  return {ws,send:o=>ws.send(JSON.stringify(o)),next:async fn=>{
    const deadline=Date.now()+7500;
    while(Date.now()<deadline){const i=messages.findIndex(fn);if(i>=0)return messages.splice(i,1)[0];await delay(10);}
    throw new Error('Expected message not received');
  }};
}
(async()=>{
  try{
    for(let i=0;i<50;i++){try{const h=await fetch(`http://127.0.0.1:${port}/health`);if(h.ok)break;}catch{}await delay(100);}
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);ok('HTTP health 200');
    assert.equal(dictionaryStats.spellings,12655);assert.equal(dictionaryStats.keys,12625);ok('SQLite dictionary loads 12,655 Hspell noun spellings');
    for(const [a,b,v] of [['כיסא','כיס',true],['כיס','כוס',true],['כיס','כיסא',true],['מלך','מלכה',true],['חלון','חלום',true],['כור','קור',true],['רוח','חור',false],['כיס','כיס',false],['ספר','ספרים',false]])assert.equal(oneEditApart(a,b),v,`${a}/${b}`);
    assert.equal(normalize('מֶלֶךְ'),'מלכ');ok('9 edit cases and niqqud/final-letter normalization');
    const a=await peer(),b=await peer(),c=await peer();
    a.send({type:'create_room',name:'אמילי',timerSeconds:30});
    const joinedA=await a.next(m=>m.type==='joined');const code=joinedA.state.code;
    b.send({type:'join_room',name:'אדל',roomCode:code});
    const joinedB=await b.next(m=>m.type==='joined');assert.equal(joinedB.state.players[0].name,'אמילי');ok('Room creation and second-player join');
    c.send({type:'join_room',name:'שלישי',roomCode:code});await c.next(m=>m.type==='error');ok('Third player rejected');
    a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});
    const roulette=(await a.next(m=>m.state?.phase==='roulette')).state;
    const initial=(await b.next(m=>m.state?.phase==='playing')).state;
    assert.equal(initial.currentWord,roulette.roulette.words[roulette.roulette.selectedIndex]);
    assert.ok([0,1].includes(initial.activePlayer));ok('Roulette stops automatically on the server and randomly selects the first player');
    const peers=[a,b],active=initial.activePlayer,waiting=1-active;
    peers[waiting].send({type:'submit_word',word:'כיס'});await peers[waiting].next(m=>m.type==='error');ok('Out-of-turn command rejected');
    peers[active].send({type:'use_joker'});
    const played=(await peers[waiting].next(m=>m.state?.history.length===2)).state;
    assert.equal(played.players[active].joker,0);assert.equal(played.activePlayer,waiting);ok('Joker auto-plays a legal move and is consumed');
    peers[waiting].send({type:'submit_word',word:initial.currentWord});
    const repeat=await peers[waiting].next(m=>m.type==='error');assert.match(repeat.message,/כבר/);ok('Previously used word rejected');
    const options=new Set(neighbors(played.currentWord).map(normalize));
    const unknown=[...'אבגדהוזחטיכלמנסעפצקרשת'].map(x=>played.currentWord+x).find(x=>!options.has(normalize(x)));
    peers[waiting].send({type:'submit_word',word:unknown});
    const appeal=(await peers[active].next(m=>!!m.state?.pendingAppeal)).state;assert.equal(appeal.pendingAppeal.judge,active);
    peers[waiting].send({type:'appeal_decision',approved:true});await peers[waiting].next(m=>m.type==='error');
    peers[active].send({type:'appeal_decision',approved:true});
    const approved=(await peers[waiting].next(m=>m.state?.history.length===3)).state;assert.equal(approved.currentWord,unknown);ok('Unknown word requires opponent approval; self-approval rejected');
    const again=await peer();again.send({type:'join_room',roomCode:code,playerId:joinedA.playerId,name:'אמילי'});
    const resumed=await again.next(m=>m.type==='joined');assert.equal(resumed.playerIndex,0);assert.equal(resumed.state.history.length,3);ok('Reconnect restores player identity and history while server runs');
    console.log(JSON.stringify({status:'passed',checks,scope:'Existing baseline only; not full PRD acceptance or live Render validation'},null,2));
  }finally{for(const ws of clients)ws.terminate();child.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1});
