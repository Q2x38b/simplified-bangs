/**
 * Address-bar autocomplete.
 *
 * Browsers that support OpenSearch call `/suggest?q=` with whatever is
 * currently in the address bar and render the response as a dropdown. We answer
 * only when the user is part-way through typing a bang token — everything else
 * gets an empty list, so ordinary searches typed against this engine are never
 * inspected or acted on here.
 *
 * Pure and dependency-free so it can be unit tested without the edge runtime.
 */

/** OpenSearch Suggestions format: [query, completions, descriptions, urls]. */
export type SuggestResponse = [string, string[], string[], string[]];

export interface SuggestIndex {
  /** Triggers, sorted, for binary search. */
  t: readonly string[];
  /** Names, parallel to `t`. */
  s: readonly string[];
  /** Domains, parallel to `t`. */
  d: readonly string[];
  /** Relevance, parallel to `t`. */
  r: readonly number[];
}

export const MAX_SUGGESTIONS = 8;

/** Half-open range of indices in `sorted` whose elements start with `prefix`. */
function prefixRange(sorted: readonly string[], prefix: string): [number, number] {
  const lowerBound = (target: string): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return [lowerBound(prefix), lowerBound(prefix + '￿')];
}

export interface PartialBang {
  /** The trigger fragment typed so far, lowercased, without `!`. */
  prefix: string;
  /** Everything before the bang token, preserved verbatim. */
  before: string;
}

/**
 * Identifies a bang token being typed at the end of the query.
 *
 * Only the final token counts: the browser gives us the string but not the
 * caret, and completing anything earlier would rewrite text the user has
 * already moved past.
 */
export function partialBang(query: string): PartialBang | null {
  // Anchored at the end, so a trailing space means the token is finished and
  // there is nothing left to complete.
  const match = /(^|\s)!([^\s!]*)$/.exec(query);
  if (!match) return null;
  return {
    prefix: (match[2] ?? '').toLowerCase(),
    before: query.slice(0, match.index + (match[1] ?? '').length),
  };
}

/**
 * Builds the suggestion list for an address-bar query.
 * Returns an empty completion list whenever no bang is being typed.
 */
export function suggest(index: SuggestIndex, query: string, limit = MAX_SUGGESTIONS): SuggestResponse {
  const empty: SuggestResponse = [query, [], [], []];

  const partial = partialBang(query);
  if (!partial) return empty;

  const [lo, hi] = prefixRange(index.t, partial.prefix);
  if (lo >= hi) return empty;

  // Rank by relevance, but always float an exact trigger match to the top:
  // having typed `!g` in full, the user means Google, not `!g1a`.
  const candidates: number[] = [];
  for (let i = lo; i < hi; i++) candidates.push(i);
  candidates.sort((a, b) => {
    const exactA = index.t[a] === partial.prefix ? 1 : 0;
    const exactB = index.t[b] === partial.prefix ? 1 : 0;
    if (exactA !== exactB) return exactB - exactA;
    return (index.r[b] ?? 0) - (index.r[a] ?? 0);
  });

  const chosen = candidates.slice(0, limit);
  const completions = chosen.map((i) => `${partial.before}!${index.t[i]}`);
  const descriptions = chosen.map((i) => {
    const name = index.s[i] || index.t[i]!;
    const domain = index.d[i];
    return domain ? `${name} — ${domain}` : name;
  });

  return [query, completions, descriptions, []];
}
