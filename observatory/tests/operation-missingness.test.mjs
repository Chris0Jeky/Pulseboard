import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/sqlite.mjs';
import { readPortfolio } from '../src/portfolio.mjs';
import { handle } from '../src/worker.mjs';
import { assertPortfolio, makePublicPulse } from '../public/desk-bridge.mjs';
import { fraction } from '../public/desk-model.mjs';

const DAY = 86_400_000, now = Date.UTC(2026, 9, 7, 12);
const names = { s: 'puzzle.started', c: 'puzzle.completed', f: 'puzzle.failed' };
const token = 'synthetic-operation-test-token-' + 'x'.repeat(32);
function database(t) {
  const db = openDatabase();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  t.after(() => db.close());
  return db;
}
async function seed(db, rows) {
  await db.batch(rows.map((value, i) => {
    const r = typeof value === 'string' ? { kind: value } : value;
    return db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,NULL)').bind(r.project ?? 'alibi', `event-${i}`,
      r.received ?? now - 1000, r.session ?? 'session-one', r.seq ?? i + 1, names[r.kind],
      r.route ?? 'puzzle', r.release ?? '0.11.4');
  }));
}
const read = (db, version = 3) => readPortfolio(db, { now, days: 1, version, collectionEnabled: true, admittedProjects: ['alibi'] });
const operation = snapshot => snapshot.projects.find(p => p.id === 'alibi').operations[0];

for (const [label, rows, expected] of [
  ['terminal-only', ['c', 'f'], [0, 0, 0, 0, 0, 1, 1]],
  ['first terminal consumes once', ['s', 'c', 'f', 'c'], [1, 1, 0, 0, 0, 1, 1]],
  ['failed retry', ['s', 'f', 'f', 's', 'c'], [2, 1, 1, 0, 1, 0, 1]],
  ['orphan before a start', ['c', 's', 'f'], [1, 0, 1, 0, 0, 1, 0]],
  ['consecutive open starts', ['s', 's', 'f'], [2, 0, 1, 1, 1, 0, 0]],
  ['duplicate start sequence', [{kind:'s',seq:1},{kind:'s',seq:1},{kind:'c',seq:2}], [2, 1, 0, 1, 1, 0, 0]],
  ['terminal tied with a start', [{kind:'s',seq:1},{kind:'c',seq:1},{kind:'f',seq:2}], [1, 0, 1, 0, 0, 1, 0]],
  ['terminal tied with next start', [{kind:'s',seq:1},{kind:'c',seq:2},{kind:'s',seq:2}], [2, 0, 0, 2, 1, 1, 0]],
  ['conflicting terminals tie', [{kind:'s',seq:1},{kind:'f',seq:2},{kind:'c',seq:2}], [1, 0, 1, 0, 0, 1, 0]],
]) {
  test(`v3 accounts for ${label} without inflating failures or consuming terminals twice`, async t => {
    const db = database(t); await seed(db, rows);
    const snapshot = await read(db);
    assert.equal(snapshot.schema, 'pulseboard.portfolio/3');
    assertPortfolio(snapshot);
    const op = operation(snapshot);
    assert.deepEqual([op.attempts, op.completed, op.failed, op.open, op.retries, op.unmatched.completed, op.unmatched.failed], expected);
    assert.equal(op.completion.denominator, op.attempts);
    for (const kind of ['completed', 'failed']) assert.equal(op.releases.reduce((n, r) => n + r.unmatched[kind], 0), op.unmatched[kind]);
  });
}

for (const [boundary, fields] of [
  ['route', {route:'home'}], ['session', {session:'other'}], ['release', {release:'0.11.5'}],
]) {
  test(`a terminal across the ${boundary} boundary stays unmatched`, async t => {
    const db = database(t); await seed(db, ['s', {kind:'c', ...fields}]);
    const op = operation(await read(db));
    assert.deepEqual(op.unmatched, {completed:1,failed:0});
    assert.equal(op.open, 1); assert.equal(op.completed, 0);
  });
}

test('receipt window and project isolate unmatched evidence', async t => {
  const db = database(t);
  await seed(db, [{kind:'s',received:now-DAY-1}, {kind:'c',received:now-DAY}, {kind:'f',received:now-1},
    {kind:'c',received:now}, {kind:'f',received:now+1}, {kind:'c',project:'mdviewer'}]);
  const op = operation(await read(db));
  assert.deepEqual(op.unmatched, {completed:1,failed:1}); assert.equal(op.attempts, 0);
});

test('default v2 retains strict old fields and excludes terminal-only release rows', async t => {
  const db = database(t); await seed(db, ['s','c',{kind:'f',release:'0.11.5'}]);
  const snapshot = await readPortfolio(db, {now,days:1});
  assert.equal(snapshot.schema, 'pulseboard.portfolio/2');
  assert.deepEqual(operation(snapshot), { id:'puzzle.solve',version:1,attempts:1,completed:1,failed:0,open:0,retries:0,
    completion:fraction(1,1),releases:[{release:'0.11.4',attempts:1,completed:1,failed:0,open:0,retries:0}] });
  assertPortfolio(snapshot);
  const detailed = assertPortfolio(await read(db));
  assert.equal(operation(detailed).releases.length, 2);
  assert.deepEqual(operation(detailed).releases.find(r => r.release === '0.11.5').unmatched, {completed:0,failed:1});
  const publicPulse = makePublicPulse(detailed, ['alibi'], now);
  assert.doesNotMatch(JSON.stringify(publicPulse), /unmatched|puzzle\.solve|operation/);
});

test('terminal-only releases fold with all counts preserved', async t => {
  const db = database(t);
  await seed(db, Array.from({length:80}, (_,i) => ({kind:i%2?'c':'f',release:`0.11.${i}`})));
  const snapshot = assertPortfolio(await read(db)); const op = operation(snapshot);
  assert.deepEqual(op.unmatched, {completed:40,failed:40});
  assert.ok(op.releases.length <= 64);
  assert.ok(op.releases.some(r => r.release === 'other'));
  assert.equal(op.releases.reduce((n,r) => n+r.unmatched.completed+r.unmatched.failed,0), 80);
  assert.equal(op.attempts, 0);
});

test('empty v3 is explicit zero missingness, not absent detail', async t => {
  const snapshot = assertPortfolio(await read(database(t)));
  assert.equal(snapshot.schema, 'pulseboard.portfolio/3');
  assert.deepEqual(operation(snapshot).unmatched, {completed:0,failed:0});
  assert.deepEqual(operation(snapshot).releases, []);
});

for (const version of [0,1,4,'3',null,NaN]) {
  test(`read model refuses unsupported version ${String(version)}`, async t => {
    await assert.rejects(readPortfolio(database(t), {now, version}), RangeError);
  });
}

for (const query of ['version=1','version=4','version=03','version=3.0','version=','version=3&version=3','version=2&version=3']) {
  test(`API rejects ${query} before any database access`, async () => {
    const env = {READ_TOKEN:token, DB:{prepare(){throw new Error('database must not be accessed');}}};
    const res = await handle(new Request(`https://desk.example/v1/portfolio?${query}`, {headers:{authorization:`Bearer ${token}`}}), env);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'version');
  });
}

test('API negotiates v3 explicitly and keeps unauthenticated access closed', async t => {
  const db = database(t); t.mock.method(Date,'now',()=>now); await seed(db,['c']);
  const env = {DB:db,READ_TOKEN:token,COLLECT_ENABLED:'false'};
  const url = 'https://desk.example/v1/portfolio?days=1&version=3';
  assert.equal((await handle(new Request(url),env)).status,401);
  const res = await handle(new Request(url,{headers:{authorization:`Bearer ${token}`}}),env);
  assert.equal(res.status,200); assert.equal(res.headers.get('cache-control'),'no-store');
  const snapshot = assertPortfolio(await res.json()); assert.equal(snapshot.schema,'pulseboard.portfolio/3');
  assert.equal(snapshot.projects.find(p=>p.id==='alibi').collectionAdmitted,false);
  assert.deepEqual(operation(snapshot).unmatched,{completed:1,failed:0});
});

for (const [label, mutate] of [
  ['absent aggregate detail', s=>delete operation(s).unmatched],
  ['negative count', s=>operation(s).unmatched.completed=-1],
  ['fractional count', s=>operation(s).unmatched.failed=0.5],
  ['unknown detail key', s=>operation(s).unmatched.private='inert'],
  ['aggregate mismatch', s=>operation(s).unmatched.completed++],
  ['absent release detail', s=>delete operation(s).releases[0].unmatched],
  ['unknown release detail key', s=>operation(s).releases[0].unmatched.raw='never'],
  ['unsafe count', s=>operation(s).unmatched.completed=Number.MAX_SAFE_INTEGER+1],
  ['terminals exceed events', s=>{const op=operation(s);op.unmatched.completed=99;op.releases[0].unmatched.completed=99;}],
  ['unknown schema version', s=>s.schema='pulseboard.portfolio/4'],
]) {
  test(`v3 validator refuses ${label}`, async t => {
    const db=database(t); await seed(db,['s','c','c']); const s=await read(db);
    assert.equal(s.schema,'pulseboard.portfolio/3');
    assertPortfolio(s); mutate(s); assert.throws(()=>assertPortfolio(s));
  });
}

for (let salt=1; salt<=16; salt++) {
  test(`v3 reconciles every consumed and unmatched terminal against an independent oracle (${salt})`, async t => {
    const db=database(t); let state=salt;
    const pick=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/4294967296*n);};
    const rows=Array.from({length:320},(_,i)=>({kind:['s','c','f'][pick(3)],seq:Math.floor(i/2),
      release:['0.11.4','0.11.5'][pick(2)],route:['puzzle','home'][pick(2)],session:`s${pick(4)}`,
      project:pick(6)?'alibi':'mdviewer',received:[now-DAY-1,now-DAY,now-1,now,now+1][pick(5)]}));
    await seed(db,rows);
    const eligible=rows.map((r,id)=>({...r,id})).filter(r=>r.project==='alibi'&&r.received>=now-DAY&&r.received<now);
    const groups=new Map(), releases=new Map(), consumed=new Set();
    for(const r of eligible){
      const key=JSON.stringify([r.session,r.route,r.release]);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
      if(!releases.has(r.release))releases.set(r.release,{release:r.release,attempts:0,completed:0,failed:0,open:0,retries:0,unmatched:{completed:0,failed:0}});
    }
    for(const g of groups.values()){
      g.sort((a,b)=>a.seq-b.seq||a.id-b.id);
      const starts=g.filter(r=>r.kind==='s');
      for(const [i,s] of starts.entries()){
        const next=starts[i+1], terminal=g.find(r=>r.kind!=='s'&&r.seq>s.seq&&(!next||r.seq<next.seq));
        const r=releases.get(s.release);r.attempts++;
        if(terminal){assert.equal(consumed.has(terminal.id),false);consumed.add(terminal.id);r[terminal.kind==='c'?'completed':'failed']++;}
        else r.open++;
        if(next&&(!terminal||terminal.kind==='f'))r.retries++;
      }
    }
    for(const r of eligible)if(r.kind!=='s'&&!consumed.has(r.id))releases.get(r.release).unmatched[r.kind==='c'?'completed':'failed']++;
    const snapshot=assertPortfolio(await read(db)),op=operation(snapshot);
    assert.deepEqual(op.releases,[...releases.values()].sort((a,b)=>a.release.localeCompare(b.release)));
    assert.equal(op.completed+op.failed+op.unmatched.completed+op.unmatched.failed,eligible.filter(r=>r.kind!=='s').length);
  });
}
