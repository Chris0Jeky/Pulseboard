import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = new URL('../tools/profile-portfolio.mjs', import.meta.url);
function run(args) {
  return spawnSync(process.execPath, [script.pathname, ...args], { encoding: 'utf8', timeout: 10_000 });
}

test('local profiler reconciles all shapes and supported windows without hosted claims', () => {
  const result = run(['--events-per-day', '60']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, 'pulseboard.local-query-profile/1');
  assert.equal(report.synthetic, true);
  assert.equal(report.storage, 'isolated in-memory SQLite');
  assert.equal(report.profiles.length, 9);
  for (const profile of report.profiles) {
    assert.equal(profile.seededRows, 840);
    assert.equal(profile.windowEventRows, profile.days * 60);
    assert.equal(profile.statements.length, 10);
    assert.equal(profile.d1RowsRead, null);
    assert.ok(profile.durationMs >= 0);
    assert.ok(profile.responseBytes > 0 && profile.responseBytes < 262144);
    assert.ok(profile.statements.every(row => row.plan.length > 0));
    assert.equal(profile.statements.at(-1).plan.some(line => /CORRELATED/.test(line)), false);
    assert.equal(profile.operationCounts.attempts, profile.operationCounts.completed + profile.operationCounts.failed + profile.operationCounts.open);
  }
  assert.match(report.limitations.join(' '), /not.*D1/i);
  assert.equal(readFileSync(new URL('../src/assets.mjs', import.meta.url), 'utf8').includes('profile-portfolio'), false);
});

for (const args of [
  ['--events-per-day', '0'], ['--events-per-day', '1001'], ['--events-per-day', '1.5'],
  ['--shape', 'unknown'], ['--database', '/tmp/never-open-this'], ['--events-per-day', '60', 'extra'],
]) {
  test(`local profiler refuses unsupported arguments ${JSON.stringify(args)}`, () => {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  });
}
