/**
 * Probes every `http://` host in the dataset to see whether it also answers over
 * HTTPS, and records the verified ones in `src/data/https-hosts.json`.
 *
 * An `http://` destination costs the user an extra round trip plus a TLS
 * handshake, because the site immediately redirects to HTTPS. Upgrading the
 * template removes that hop entirely.
 *
 * Run with `npm run probe-https`, then `npm run build` to apply. Results are
 * committed so builds stay reproducible and offline.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Bang } from '../src/lib/types.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONCURRENCY = 120;
const TIMEOUT_MS = 6000;

const bangs: Bang[] = JSON.parse(await readFile(`${ROOT}src/data/bangs.json`, 'utf8'));

const hosts = [
  ...new Set(
    bangs
      .filter((bang) => bang.u.startsWith('http://'))
      .map((bang) => {
        try {
          return new URL(bang.u).host;
        } catch {
          return null;
        }
      })
      .filter((host): host is string => host !== null),
  ),
];

console.log(`Probing ${hosts.length} hosts…`);

const verified: string[] = [];
let done = 0;
const queue = hosts.slice();

async function worker(): Promise<void> {
  for (let host = queue.pop(); host !== undefined; host = queue.pop()) {
    try {
      // A response of any status means the TLS handshake succeeded with a
      // certificate valid for this host, which is what we need to know.
      const response = await fetch(`https://${host}/`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status > 0) verified.push(host);
    } catch {
      // Unreachable over HTTPS: leave the template on http://.
    }
    if (++done % 500 === 0) console.log(`  ${done}/${hosts.length}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

verified.sort();
await writeFile(`${ROOT}src/data/https-hosts.json`, `${JSON.stringify(verified)}\n`);
console.log(`${verified.length}/${hosts.length} hosts support HTTPS -> src/data/https-hosts.json`);
