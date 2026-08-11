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
  /**
   * Curated tags, beyond the ones derived automatically from `c` and `sc`.
   * Only set on entries in `extra-bangs.json`.
   */
  tg?: string[];
}

/**
 * Compact tuple used by the search modal:
 * [trigger, name, domain, relevance, tag ids].
 *
 * Tag ids index into the sibling `tags` array. Interning them this way is both
 * smaller than repeating category strings on every entry and faster to filter.
 */
export type SearchEntry = readonly [t: string, s: string, d: string, r: number, tags: readonly number[]];

/** Payload served to the search modal. */
export interface SearchPayload {
  /** All distinct tags, ordered by descending entry count. */
  tags: readonly string[];
  entries: readonly SearchEntry[];
}

/** Trigger -> URL template. The only thing the redirect path needs. */
export type RedirectMap = Record<string, string>;

/** Trigger -> domain, only for bangs whose template origin is not their site. */
export type HomeOverrides = Record<string, string>;

/** The redirect data file: everything the service worker and fallback need. */
export interface RedirectPayload {
  map: RedirectMap;
  home: HomeOverrides;
}
