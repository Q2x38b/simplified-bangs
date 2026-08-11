/**
 * Inline `<head>` redirect fallback.
 *
 * In normal operation this never runs: the edge middleware answers `/?q=...`
 * with a 302 and the browser never fetches this document. It exists so the
 * site still resolves bangs if middleware is unavailable (a purely static
 * deploy, a middleware error, or a rollback to static hosting).
 *
 * It is inlined into the `<head>` and executes synchronously — before the
 * parser reaches `<body>`, before any stylesheet, and without waiting for
 * `DOMContentLoaded`. The bundled hot map covers the most-used triggers; a
 * miss lazily fetches the full map.
 */
import type { HomeOverrides, RedirectMap, RedirectPayload } from '../lib/types.js';
import { DEFAULT_BANG_COOKIE, parseQuery, resolve } from '../lib/resolve.js';

declare const __HOT_MAP__: RedirectMap;
declare const __HOME_OVERRIDES__: HomeOverrides;
declare const __REDIRECT_MAP_URL__: string;

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

const query = new URLSearchParams(location.search).get('q');

if (query?.trim()) {
  const defaultTrigger =
    localStorage.getItem(DEFAULT_BANG_COOKIE) ?? readCookie(DEFAULT_BANG_COOKIE) ?? undefined;

  const lookupHome = (t: string): string | undefined => __HOME_OVERRIDES__[t];

  const go = (lookup: (t: string) => string | undefined): boolean => {
    const resolution = resolve(query, lookup, { defaultTrigger, lookupHome });
    if (!resolution) return false;
    location.replace(resolution.url);
    return true;
  };

  const hot = (t: string): string | undefined => __HOT_MAP__[t];

  // Only reach for the full map when the query names a trigger the hot set
  // doesn't have. No bang at all resolves instantly against the default.
  const { trigger } = parseQuery(query);

  if (trigger && !__HOT_MAP__[trigger]) {
    document.documentElement.style.visibility = 'hidden';
    fetch(__REDIRECT_MAP_URL__)
      .then((response) => response.json() as Promise<RedirectPayload>)
      .then((payload) => go((t) => payload.map[t] ?? __HOT_MAP__[t]))
      .catch(() => go(hot))
      .finally(() => {
        document.documentElement.style.visibility = '';
      });
  } else {
    go(hot);
  }
}
