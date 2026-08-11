/**
 * Address-bar autocomplete endpoint, served from the edge.
 *
 * Registered by /opensearch.xml as this engine's suggestions URL. Browsers call
 * it with whatever is in the address bar; we reply only when a bang token is
 * being typed, and with nothing at all otherwise.
 *
 * Nothing is logged or counted here. Responses that contain suggestions are
 * cacheable — a trigger prefix is not personal, and caching keeps repeat
 * keystrokes off the function entirely. Responses to anything else are
 * `no-store`, so ordinary typing never lands in a shared cache.
 */
import { SUGGEST_INDEX } from '../src/generated/suggest-index.js';
import { suggest } from '../src/lib/suggest.js';

export const config = { runtime: 'edge' };

/** Address-bar text is short; anything longer is not a real query. */
const MAX_QUERY = 200;

export default function handler(request: Request): Response {
  const query = (new URL(request.url).searchParams.get('q') ?? '').slice(0, MAX_QUERY);
  const payload = suggest(SUGGEST_INDEX, query);
  const hasSuggestions = payload[1].length > 0;

  return new Response(JSON.stringify(payload), {
    headers: {
      // Firefox requires this exact type; Chromium accepts it too.
      'content-type': 'application/x-suggestions+json; charset=utf-8',
      'cache-control': hasSuggestions
        ? 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800'
        : 'private, no-store',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
}
