/** Bounded authenticated Desk reads. Kept separate so request policy is testable without a DOM. */
export const READ_TIMEOUT_MS = 10_000;

export function requestPortfolio(fetcher, { token, days, signal }) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher');
  return fetcher(`/v1/portfolio?days=${days}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
}
