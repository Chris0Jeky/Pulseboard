/**
 * Bounded host-side Alibi journey reporter.
 *
 * It carries no puzzle identity, answer, text, URL or user identifier. State advances only
 * when the consent-aware Observatory facade accepts the event, so denied collection cannot
 * manufacture follow-on hints, failures, retries or completions.
 */
export function createAlibiJourneyReporter(usage = globalThis.PulseboardUsage) {
  let state = 'idle', attempts = 0, hints = 0;

  const track = event => {
    try { return usage?.track?.(event) === true; } catch { return false; }
  };
  const accept = (event, next) => {
    if (!track(event)) return false;
    state = next;
    return true;
  };

  return Object.freeze({
    start() {
      if (state === 'active') return false;
      if (!accept('puzzle.started', 'active')) return false;
      attempts++;
      return true;
    },
    hint() {
      if (state !== 'active' || !track('hint.requested')) return false;
      hints++;
      return true;
    },
    fail() {
      return state === 'active' && accept('puzzle.failed', 'failed');
    },
    retry() {
      if (state !== 'failed' || !accept('puzzle.retried', 'active')) return false;
      attempts++;
      return true;
    },
    complete() {
      return state === 'active' && accept('puzzle.completed', 'completed');
    },
    status() { return { state, attempts, hints }; },
  });
}
