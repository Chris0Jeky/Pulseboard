import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { buildSignals, makeHandoff, makeBrief, STALE_AFTER } from '../public/desk-model.mjs';
import { requestPortfolio } from '../public/desk-network.mjs';
import { makeDemo, SCENARIOS } from '../public/desk-demo.mjs';
import { assertPortfolio, makePublicPulse } from '../public/desk-bridge.mjs';
import { makeIdentifiedHandoff, previewHandoff } from '../public/desk-handoff.mjs';

const now=Date.UTC(2026,9,7,12), names={s:'puzzle.started',c:'puzzle.completed',f:'puzzle.failed'};
async function fixture(t, events=['c','f'],version=3){
  const db=openDatabase(); t.after(()=>db.close());
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  await db.batch(events.map((kind,i)=>db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,NULL)')
    .bind('alibi',`synthetic-${i}`,now-1000,'synthetic-session',i+1,names[kind],'puzzle','0.11.4')));
  const snapshot=assertPortfolio(await readPortfolio(db,{now,days:1,version,collectionEnabled:true,admittedProjects:['alibi']}));
  return snapshot;
}
const unmatched=s=>s.find(x=>x.rule==='operation.puzzle.solve.unmatched');

test('Desk requests v3 in the same bounded authenticated request',async()=>{
  const calls=[],signal=new AbortController().signal;
  await requestPortfolio(async(...args)=>calls.push(args),{token:'private-test-token',days:7,signal});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'/v1/portfolio?days=7&version=3');
  assert.deepEqual(calls[0][1],{headers:{authorization:'Bearer private-test-token'},cache:'no-store',credentials:'omit',redirect:'error',signal});
});

test('terminal-only evidence becomes a versioned next check, not a failure diagnosis',async t=>{
  const snapshot=await fixture(t),signals=buildSignals(snapshot,now),note=unmatched(signals);
  assert.ok(note,'missingness next check absent');
  assert.equal(note.version,'operation-evidence/1'); assert.equal(note.severity,'note');
  assert.deepEqual(note.evidence.unmatched,{completed:1,failed:1});
  assert.equal(note.evidence.attempts,0); assert.equal(note.evidence.failed,0);
  assert.equal(note.evidence.sourceSchema,'pulseboard.portfolio/3');
  assert.match(note.detail,/not extra failed attempts/);
  assert.match(note.next,/hook|sequence|route/);
  assert.equal(signals.some(s=>s.rule.endsWith('.failure')),false);
});

test('extra outcomes after a paired completion remain separate from failed attempts',async t=>{
  const snapshot=await fixture(t,['s','c','c','f']),note=unmatched(buildSignals(snapshot,now));
  assert.ok(note); assert.equal(note.evidence.completed,1); assert.equal(note.evidence.failed,0);
  assert.deepEqual(note.evidence.unmatched,{completed:1,failed:1});
});

test('v2 detail is explicitly unavailable while measured v3 zeros do not alert',async t=>{
  const old=await fixture(t,['s','c'],2),current=await fixture(t,['s','c'],3);
  const note=buildSignals(old,now).find(s=>s.rule==='operation.puzzle.solve.missingness_unavailable');
  assert.ok(note); assert.equal(note.evidence.unmatched,null);
  assert.equal(note.evidence.sourceSchema,'pulseboard.portfolio/2');
  assert.match(note.detail,/unavailable/);
  assert.equal(unmatched(buildSignals(old,now)),undefined);
  assert.equal(buildSignals(current,now).some(s=>s.version==='operation-evidence/1'),false);
});

for(const [label,readTime,failed] of [['failed refresh',now,true],['expired snapshot',now+STALE_AFTER+1,false],['future snapshot',now-1,false]]){
  test(`${label} keeps missingness explicitly last-known`,async t=>{
    const snapshot=await fixture(t),note=unmatched(buildSignals(snapshot,readTime,failed));
    assert.ok(note); assert.equal(note.evidence.lastKnown,true);
    assert.match(note.title,/last-known/); assert.match(note.next,/Refresh/);
    const handoff=makeHandoff(snapshot,note,failed);
    const review=await previewHandoff(JSON.stringify(handoff),{targetProject:'alibi',now:readTime});
    assert.notEqual(review.freshness,'current');
    assert.equal(review.proposal.fields.evidence.lastKnown,true);
    assert.deepEqual(review.proposal.permissions,[]);
  });
}

test('count changes resurface review keys without changing the identified handoff subject',async t=>{
  const a=await fixture(t,['c']),b=await fixture(t,['c','f']);
  const first=unmatched(buildSignals(a,now)),second=unmatched(buildSignals(b,now));
  assert.ok(first&&second);assert.notEqual(first.key,second.key);
  const one=await makeIdentifiedHandoff(a,first),two=await makeIdentifiedHandoff(b,second);
  assert.equal(one.fingerprint,two.fingerprint);
  assert.notDeepEqual(one.evidence.unmatched,two.evidence.unmatched);
});

test('synthetic missingness stays marked through note, handoff and public-exclusion paths',async t=>{
  const snapshot=await fixture(t);snapshot.mode='demo';
  const note=unmatched(buildSignals(snapshot,now)); assert.ok(note);
  const packet=await makeIdentifiedHandoff(snapshot,note),text=JSON.stringify(packet,null,2);
  assert.equal(packet.mode,'demo');assert.equal(packet.evidence.sourceMode,'demo');
  const review=await previewHandoff(text,{targetProject:'alibi',now});
  assert.match(review.warnings.join(' '),/SYNTHETIC/); assert.deepEqual(review.proposal.permissions,[]);
  assert.match(makeBrief(snapshot,[note]),/SYNTHETIC DEMO/);
  assert.doesNotMatch(JSON.stringify(makePublicPulse(snapshot,['alibi'],now)),/unmatched|puzzle.solve|operation-evidence/);
});

test('every demo scenario has valid v3 operations and Missing readings demonstrates unmatched outcomes',()=>{
  for(const scenario of Object.keys(SCENARIOS))for(const days of [1,7,14])for(const phase of [0,1,2]){
    const snapshot=makeDemo(scenario,{now,days,phase});
    assert.equal(snapshot.schema,'pulseboard.portfolio/3');
    assertPortfolio({...snapshot,mode:'live'});
    assert.ok(snapshot.projects.every(p=>Array.isArray(p.operations)));
    const op=snapshot.projects.find(p=>p.id==='alibi').operations[0];
    assert.ok(op); assert.equal(op.attempts,op.completed+op.failed+op.open);
  }
  const demo=makeDemo('blind',{now});
  assert.ok(unmatched(buildSignals(demo,now)));
});
