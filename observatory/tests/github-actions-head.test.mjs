import test from 'node:test';
import assert from 'node:assert/strict';
import { convertGithubActionsExport } from '../run-receipts/github-actions.mjs';
import { fixture, mapping, now } from './helpers/github-actions-export.mjs';
const convert = input => convertGithubActionsExport(JSON.stringify(input), mapping, { now });

test('different heads cannot be combined as attempts of the same workflow run', () => {
  const input = fixture();
  input.attempts[1].run.head_sha = 'b'.repeat(40);
  input.attempts[1].jobPages[0].jobs[0].head_sha = 'b'.repeat(40);
  assert.throws(() => convert(input), /head/);
});
