/**
 * Bang resolution. Pure, dependency-free, and shared verbatim by all three
 * redirect layers: the Vercel edge middleware, the service worker, and the
 * inline `<head>` fallback. One implementation means one set of semantics.
 */

export const DEFAULT_TRIGGER = 'g';

/** Cookie the client writes so the *edge* can honour a user's default bang. */
export const DEFAULT_BANG_COOKIE = 'default-bang';

/**
 * Matches a bang token that stands on its own: at the start of the query, at
 * the end, or surrounded by whitespace.
 *
 * The previous implementation used `/!(\S+)/`, which also matched mid-word
 * (`foo!bar` resolved as bang `bar`) and matched the first `!` anywhere even
 * when it was part of the search terms.
 */
const BANG_TOKEN = /(?:^|\s)!([^\s!]+)(?=\s|$)/;

const PLACEHOLDER = /\{\{\{s\}\}\}/g;

export interface ParsedQuery {
  /** Lowercased trigger without `!`, or null when the query has no bang token. */
  trigger: string | null;
  /** The query with the bang token removed. */
  terms: string;
  /** The original, untouched query. */
  raw: string;
}

/** Splits a raw `?q=` value into a bang trigger and the remaining search terms. */
export function parseQuery(raw: string): ParsedQuery {
  const query = raw.trim();
  const match = BANG_TOKEN.exec(query);
  if (!match?.[1]) return { trigger: null, terms: query, raw: query };

  // Removing a bang from the middle of a query would otherwise leave a double
  // space, which encodes as `%20%20` in the destination URL.
  const terms = (query.slice(0, match.index) + ' ' + query.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return { trigger: match[1].toLowerCase(), terms, raw: query };
}

/**
 * Substitutes search terms into a bang URL template.
 *
 * Slashes are deliberately left unescaped: templates such as
 * `reddit.com/r/{{{s}}}` rely on them being path separators.
 */
export function expandTemplate(template: string, terms: string): string {
  const encoded = encodeURIComponent(terms).replace(/%2F/g, '/');
  // `replaceAll`, not `replace` — 72 templates contain the placeholder twice
  // and were previously left with a literal `{{{s}}}` in the final URL.
  return template.replace(PLACEHOLDER, encoded);
}

export interface ResolveOptions {
  /** Trigger to use when the query has no bang token. */
  defaultTrigger?: string | undefined;
}

export interface Resolution {
  /** Fully expanded destination URL. */
  url: string;
  /** The trigger that was actually used. */
  trigger: string;
  /**
   * False when the query named a bang we don't know. The unknown token is then
   * kept in the search terms rather than silently discarded, so `!notabang foo`
   * searches for "!notabang foo" instead of just "foo".
   */
  matched: boolean;
}

/**
 * Resolves a raw `?q=` value against a trigger -> template map.
 * Returns null only when the map has no usable fallback.
 */
export function resolve(
  rawQuery: string,
  lookup: (trigger: string) => string | undefined,
  options: ResolveOptions = {},
): Resolution | null {
  const { trigger, terms, raw } = parseQuery(rawQuery);
  if (!raw) return null;

  const fallbackTrigger = options.defaultTrigger || DEFAULT_TRIGGER;

  if (trigger) {
    const template = lookup(trigger);
    if (template) return { url: expandTemplate(template, terms), trigger, matched: true };
  }

  // No bang, or a bang we don't recognise. Fall back to the default engine and
  // search for the *whole* original query.
  const fallbackTemplate = lookup(fallbackTrigger) ?? lookup(DEFAULT_TRIGGER);
  if (!fallbackTemplate) return null;

  return {
    url: expandTemplate(fallbackTemplate, trigger ? raw : terms),
    trigger: fallbackTrigger,
    matched: false,
  };
}

/** Reads the default-bang cookie out of a `Cookie` header. */
export function readDefaultTrigger(cookieHeader: string | null | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== DEFAULT_BANG_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim()).toLowerCase();
    // Triggers are short and have no delimiters; reject anything else.
    if (value && value.length <= 32 && !/[\s;,]/.test(value)) return value;
  }
  return undefined;
}
