/** A single bang entry, mirroring DuckDuckGo's field names. */
export interface Bang {
  /** Trigger, without the leading `!`. Always lowercase. */
  t: string;
  /** Human-readable site name. */
  s: string;
  /** Domain. */
  d: string;
  /** Category. */
  c: string;
  /** Sub-category. */
  sc: string;
  /** DuckDuckGo relevance score. Higher is more popular. */
  r: number;
  /** Target URL template, containing zero or more `{{{s}}}` placeholders. */
  u: string;
}

/** Compact tuple used by the search page: [trigger, name, domain, category, relevance]. */
export type SearchEntry = readonly [t: string, s: string, d: string, c: string, r: number];

/** Trigger -> URL template. The only thing the redirect path needs. */
export type RedirectMap = Record<string, string>;
