const requireValue = (condition, message) => { if (!condition) throw new TypeError(message); };

/** A review prompt, never an instruction to change code, cancel runs or alter CI. */
export function makeRunReceiptQuestionCard(summary) {
  requireValue(summary?.schema === 'pulseboard.private-run-summary/1' && summary.visibility === 'private',
    'Expected a private run receipt summary');
  const runnerSeconds = summary.resources.find(item => item.unit === 'runner_seconds')?.value ?? 0;
  const failed = summary.statuses.failed, cancelled = summary.statuses.cancelled, retries = summary.attempts.retries;
  const hasWasteLead = failed + cancelled + retries > 0;
  const limitations = [
    ...summary.limitations,
    ...summary.coverage.limitations.map(value => `Source limitation: ${value}.`),
  ];
  if (summary.costPerVerifiedAccepted === null) {
    limitations.push(`Cost per verified accepted outcome cannot be calculated: ${summary.costAbstention}`);
  }
  return {
    schema: 'pulseboard.private-question-card/1',
    visibility: 'private',
    project: summary.project,
    title: hasWasteLead ? 'Review run retries and cancellations' : 'Review run outcome coverage',
    question: hasWasteLead
      ? 'Which failed, cancelled or retried runs consume measured resources without producing a verified accepted outcome?'
      : 'Which additional outcome verification would make these run receipts decision-useful?',
    evidence: {
      receipts: summary.attempts.receipts,
      failed,
      cancelled,
      retries,
      runnerSeconds,
      verifiedAccepted: summary.outcomes['verified-accepted'],
    },
    costPerVerifiedAccepted: summary.costPerVerifiedAccepted,
    nextCheck: 'Inspect the private source runs and their bounded verification references before changing CI or automation.',
    limitations,
  };
}
