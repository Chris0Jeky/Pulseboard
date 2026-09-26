import test from 'node:test';
import assert from 'node:assert/strict';
import { findingsFor } from '../watch/store.mjs';

const NOW = Date.parse('2026-09-17T12:00:00Z');

test('unexpected egress remains visible for the full daily evidence window', () => {
  const sources = [{
    id: 'alibi-app',
    project: 'alibi',
    coverage: 'reporting',
    budgetUsed: 0,
    budgetLimit: 1000,
  }];
  const aggregates = [{
    source: 'alibi-app',
    asset: 'network',
    kind: 'egress.unexpected',
    n: 1,
    recent: 0,
    serverErrors: 0,
  }];

  const finding = findingsFor(sources, aggregates, NOW)
    .find(item => item.rule === 'egress.unexpected');
  assert.ok(finding, 'unexpected egress must not disappear after the five-minute burst window');
  assert.equal(finding.count, 1);
  assert.equal(finding.windowSeconds, 86400);
  assert.equal(finding.severity, 'high');
});
