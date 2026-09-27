import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceContent, makeVoicesDemo, VOICE_CONTENT_NAMES } from '../public/desk-voices.mjs';
import { makeProductEventsDemo } from '../public/desk-demo.mjs';

const x = (name, props) => ({ name, props });
const puzzle = (family, tier) => ({ puzzle: 'p', family, tier });

test('content demand groups puzzle events by family and by tier with raw nearest-rank medians', () => {
  const events = [
    x('puzzle.started', puzzle('binary', 'tricky')), x('puzzle.started', puzzle('binary', 'tricky')), x('puzzle.started', puzzle('binary', 'gentle')),
    x('puzzle.started', puzzle('binary', 'tricky')),
    x('hint.requested', puzzle('binary', 'tricky')), x('hint.requested', puzzle('binary', 'tricky')), x('hint.requested', puzzle('binary', 'gentle')),
    x('puzzle.completed', { ...puzzle('binary', 'tricky'), seconds: 40 }), x('puzzle.completed', { ...puzzle('binary', 'tricky'), seconds: 10 }),
    x('puzzle.completed', { ...puzzle('binary', 'gentle'), seconds: 30 }), x('puzzle.completed', { ...puzzle('binary', 'tricky'), seconds: 20 }),
    x('puzzle.completed', { ...puzzle('binary', 'tricky'), seconds: 'fast' }),
    x('puzzle.failed', puzzle('binary', 'tricky')),
    x('puzzle.started', puzzle('sudoku', 'gentle')),
    // Not counted: other names, and puzzle events sent before family and tier existed.
    x('page.view', puzzle('binary', 'tricky')), x('puzzle.started', { puzzle: 'old' }), x('puzzle.completed', { puzzle: 'old', seconds: 5 }),
    x('puzzle.started', { family: 7, tier: null }),
  ];
  const model = voiceContent(events);
  assert.equal(model.unattributed, 3); assert.equal(model.attributed, 14);
  const binary = model.families.rows.find(r => r.family === 'binary');
  // Started 4, completed 5 (a completion can arrive without its start): two independent counts, so the ratio can exceed 1.
  assert.deepEqual({ ...binary, completionRate: +binary.completionRate.toFixed(4), hintsPerCompletion: +binary.hintsPerCompletion.toFixed(4) },
    { family: 'binary', started: 4, completed: 5, failed: 1, completionRate: 1.25, medianSeconds: 20, timed: 4, hintsPerCompletion: 0.6, ratings: null });
  assert.deepEqual(model.families.rows.map(r => r.family), ['binary', 'sudoku'], 'most started first');
  const sudoku = model.families.rows[1];
  assert.equal(sudoku.completionRate, 0); assert.equal(sudoku.medianSeconds, null); assert.equal(sudoku.hintsPerCompletion, null);
  const tricky = model.tiers.rows.find(r => r.tier === 'tricky'), gentle = model.tiers.rows.find(r => r.tier === 'gentle');
  // Nearest rank over the raw values 10, 20, 40: the second of three, never an average.
  assert.equal(tricky.medianSeconds, 20); assert.equal(tricky.timed, 3); assert.equal(tricky.started, 3);
  assert.equal(gentle.started, 2); assert.equal(gentle.completed, 1); assert.equal(gentle.medianSeconds, 30);
  assert.equal(voiceContent([x('puzzle.completed', { family: 'a', seconds: 10 }), x('puzzle.completed', { family: 'a', seconds: 20 })]).families.rows[0].medianSeconds, 10,
    'an even count takes the lower middle value, as nearest rank does');
});

test('content demand joins the rating roll-ups, including families that were rated but not played in the rows read', () => {
  const ratings = { families: [{ family: 'binary', n: 4, tooEasy: 1, justRight: 1, tooHard: 2, more: 3 }, { family: 'trail', n: 2, tooEasy: 0, justRight: 2, tooHard: 0, more: 1 },
    { family: 'scene', n: 0, tooEasy: 0, justRight: 0, tooHard: 0, more: 0 }], tiers: [{ tier: 'tricky', n: 6, tooEasy: 1, justRight: 3, tooHard: 2, more: 4 }] };
  const model = voiceContent([x('puzzle.started', puzzle('binary', 'tricky'))], ratings);
  assert.deepEqual(model.families.rows.map(r => [r.family, r.started, r.ratings?.n ?? null]), [['binary', 1, 4], ['trail', 0, 2]], 'zero-rating families stay out');
  assert.deepEqual(model.families.rows[0].ratings, { n: 4, tooEasy: 1, justRight: 1, tooHard: 2, more: 3 });
  assert.equal(model.tiers.rows[0].ratings.n, 6);
  assert.deepEqual(voiceContent([], null), { families: { rows: [], more: 0 }, tiers: { rows: [], more: 0 }, attributed: 0, unattributed: 0 });
});

test('content demand caps open-valued rows at 64 per table and counts the rest', () => {
  const events = Array.from({ length: 100 }, (_, i) => x('puzzle.started', { family: `f${String(i).padStart(3, '0')}`, tier: 'gentle' }));
  events.push(x('puzzle.started', { family: 'f099', tier: 'gentle' }));
  const model = voiceContent(events);
  assert.equal(model.families.rows.length, 64); assert.equal(model.families.more, 36);
  assert.equal(model.families.rows[0].family, 'f099', 'the most started value survives the cap');
  assert.equal(model.tiers.rows.length, 1); assert.equal(model.tiers.rows[0].started, 101);
});

test('the sandbox puzzle events carry family and tier, so the Content section has something to group', () => {
  const now = Date.UTC(2026, 8, 27, 12);
  const events = VOICE_CONTENT_NAMES.flatMap(name => makeProductEventsDemo(7, now, 'alibi', name, 5000).events);
  assert.ok(events.length > 0);
  assert.ok(events.every(e => typeof e.props.family === 'string' && typeof e.props.tier === 'string'));
  const model = voiceContent(events, makeVoicesDemo(7, now, 'alibi').ratings);
  assert.equal(model.unattributed, 0);
  assert.ok(model.families.rows.some(r => r.started > 0 && r.ratings), 'played families join their ratings');
  assert.ok(model.families.rows.every(r => r.medianSeconds === null || r.medianSeconds >= 60));
});
