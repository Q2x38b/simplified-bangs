/**
 * Vercel Edge Middleware — the primary redirect path.
 *
 * Runs in a V8 isolate at the edge PoP nearest the user, so a bang resolves in
 * a single round trip with no HTML, no JavaScript bundle and no database
 * download on the client. The whole trigger -> template map is compiled into
 * this bundle, so a lookup is an in-memory hash hit.
 *
 * Requests without a `?q=` fall through to the static landing page.
 */
import { REDIRECT_MAP } from './src/generated/redirect-map.js';
import { readDefaultTrigger, resolve } from './src/lib/resolve.js';

export const config = {
  // Only the redirect entry point. Everything else is served straight from CDN.
  matcher: '/',
};

const lookup = (trigger: string): string | undefined => REDIRECT_MAP[trigger];

export default function middleware(request: Request): Response | undefined {
  const query = new URL(request.url).searchParams.get('q');
  if (!query?.trim()) return undefined; // No bang — serve the landing page.

  const resolution = resolve(query, lookup, {
    defaultTrigger: readDefaultTrigger(request.headers.get('cookie')),
  });
  if (!resolution) return undefined;

  return new Response(null, {
    status: 302,
    headers: {
      location: resolution.url,
      // The destination depends on an unbounded query string; caching it buys
      // nothing over an in-memory lookup and would leak queries into shared caches.
      'cache-control': 'private, no-store',
      // Don't hand the user's search terms to the destination site.
      'referrer-policy': 'no-referrer',
      'x-bang-trigger': resolution.trigger,
      'x-bang-matched': String(resolution.matched),
    },
  });
}
