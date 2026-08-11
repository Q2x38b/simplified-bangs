/**
 * Entry point for the search island.
 *
 * Loaded lazily by `landing.ts` — React, Radix and cmdk are never fetched
 * unless the user actually opens the palette. The redirect path is resolved at
 * the edge and downloads none of this.
 */
import { createRoot } from 'react-dom/client';
import { BangSearch } from './BangSearch.js';

const container = document.createElement('div');
container.id = 'bang-search-root';
document.body.append(container);

createRoot(container).render(<BangSearch />);
