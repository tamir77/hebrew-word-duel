const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const root=require('node:path').resolve(__dirname,'..');
const WebSocket=require(root+'/node_modules/ws');
const {normalize,oneEditApart,neighbors}=require(root+'/server');
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
    const deadline=Date.now()+4000;
    while(Date.now()<deadline){const i=messages.findIndex(fn);if(i>=0)return messages.splice(i,1)[0];await delay(10);}
    throw new Error('Expected message not received');
  }};
}
(async()=>{
  try{
    for(let i=0;i<50;i++){try{const h=await fetch(`http://127.0.0.1:${port}/health`);if(h.ok)break;}catch{}await delay(100);}
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);ok('HTTP health 200');
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
    await delay(Math.max(0,roulette.roulette.startedAt-Date.now())+20);
    a.send({type:'stop_roulette'});
    const initial=(await b.next(m=>m.state?.phase==='playing')).state;
    assert.equal(initial.activePlayer,1);ok('Roulette selects opening word and opponent starts');
    a.send({type:'submit_word',word:'כיס'});await a.next(m=>m.type==='error');ok('Out-of-turn command rejected');
    b.send({type:'use_joker'});
    const played=(await a.next(m=>m.state?.history.length===2)).state;
    assert.equal(played.players[1].joker,0);assert.equal(played.activePlayer,0);ok('Joker auto-plays a legal move and is consumed');
    a.send({type:'submit_word',word:initial.currentWord});
    const repeat=await a.next(m=>m.type==='error');assert.match(repeat.message,/כבר/);ok('Previously used word rejected');
    const options=new Set(neighbors(played.currentWord).map(normalize));
    const unknown=[...'אבגדהוזחטיכלמנסעפצקרשת'].map(x=>played.currentWord+x).find(x=>!options.has(normalize(x)));
    a.send({type:'submit_word',word:unknown});
    const appeal=(await b.next(m=>!!m.state?.pendingAppeal)).state;assert.equal(appeal.pendingAppeal.judge,1);
    a.send({type:'appeal_decision',approved:true});await a.next(m=>m.type==='error');
    b.send({type:'appeal_decision',approved:true});
    const approved=(await a.next(m=>m.state?.history.length===3)).state;assert.equal(approved.currentWord,unknown);ok('Unknown word requires opponent approval; self-approval rejected');
    const again=await peer();again.send({type:'join_room',roomCode:code,playerId:joinedA.playerId,name:'אמילי'});
    const resumed=await again.next(m=>m.type==='joined');assert.equal(resumed.playerIndex,0);assert.equal(resumed.state.history.length,3);ok('Reconnect restores player identity and history while server runs');
    console.log(JSON.stringify({status:'passed',checks,scope:'Existing baseline only; not full PRD acceptance or live Render validation'},null,2));
  }finally{for(const ws of clients)ws.terminate();child.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1});
