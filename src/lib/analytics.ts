/**
 * Anonymous, aggregate-only usage counting.
 *
 * Because a bang is answered with a 302 from the edge, no HTML is ever rendered
 * and no client-side analytics script can observe the event. Counting has to
 * happen here instead.
 *
 * What is recorded: the bang trigger, and the UTC date. That's it.
 *
 * What is deliberately NOT recorded: the search terms, IP address, user agent,
 * referrer, any cookie or identifier, and anything that could be joined back to
 * a person. There are no per-user records at all — only two integer counters
 * per request — so there is nothing to anonymise after the fact and no
 * consent banner to show.
 *
 * Entirely optional: with no credentials configured, `record` is a no-op and
 * the redirect path is untouched.
 */

const ENDPOINT = process.env['UPSTASH_REDIS_REST_URL'];
const TOKEN = process.env['UPSTASH_REDIS_REST_TOKEN'];

export const analyticsEnabled = Boolean(ENDPOINT && TOKEN);

/** `context.waitUntil` where the runtime provides it. */
export interface EdgeContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Increments two counters: a per-day total, and a per-day hash of trigger
 * counts. Fired through `waitUntil` so it never delays the redirect, and any
 * failure is swallowed — analytics must not be able to break a search.
 */
export function record(trigger: string, matched: boolean, context?: EdgeContext): void {
  if (!analyticsEnabled) return;

  // An unmatched trigger is attacker-controlled free text; bucket it rather
  // than writing it to the store.
  const field = matched ? trigger : '(unknown)';
  const day = new Date().toISOString().slice(0, 10);

  const promise = fetch(`${ENDPOINT}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify([
      ['HINCRBY', `bangs:${day}`, field, '1'],
      ['INCR', `total:${day}`],
    ]),
    // Never let a slow counter hold a redirect open.
    signal: AbortSignal.timeout(2000),
  }).catch(() => undefined);

  if (context?.waitUntil) context.waitUntil(promise);
}
