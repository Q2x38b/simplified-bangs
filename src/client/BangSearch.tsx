import * as React from 'react';
import { CheckIcon } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../components/ui/command.js';
import { buildIndex, facets, search, type SearchIndex } from '../lib/search.js';
import type { SearchEntry, SearchPayload } from '../lib/types.js';
import { cn } from '../lib/utils.js';

declare const __SEARCH_INDEX_URL__: string;

/** Tags offered before the user has typed anything. */
const STARTER_TAGS = ['ai', 'developer', 'docs', 'search', 'social', 'video', 'shopping', 'news'];

function useSearchIndex(active: boolean): { index: SearchIndex | null; error: boolean } {
  const [index, setIndex] = React.useState<SearchIndex | null>(null);
  const [error, setError] = React.useState(false);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    fetch(__SEARCH_INDEX_URL__)
      .then((r) => (r.ok ? (r.json() as Promise<SearchPayload>) : Promise.reject(new Error(String(r.status)))))
      .then((payload) => setIndex(buildIndex(payload)))
      .catch(() => setError(true));
  }, [active]);

  return { index, error };
}

/** One result, on one line: trigger, name, domain. */
function Row({ entry }: { entry: SearchEntry }): React.JSX.Element {
  const [trigger, name, domain] = entry;
  const [copied, setCopied] = React.useState(false);

  return (
    <CommandItem
      value={trigger}
      onSelect={() => {
        void navigator.clipboard?.writeText(`!${trigger}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}
    >
      <span className="w-32 shrink-0 truncate font-mono text-neutral-400">!{trigger}</span>
      <span className="min-w-0 flex-1 truncate text-neutral-200">{name || trigger}</span>
      {copied ? (
        <CheckIcon className="size-3.5 shrink-0 text-neutral-300" />
      ) : (
        <span className="hidden shrink-0 truncate font-mono text-xs text-neutral-600 sm:block">{domain}</span>
      )}
    </CommandItem>
  );
}

export function BangSearch(): React.JSX.Element {
  const [open, setOpen] = React.useState(() => location.hash === '#search' || window.__openBangSearch === true);
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<number[]>([]);
  const { index, error } = useSearchIndex(open);

  // ⌘K / Ctrl-K anywhere, and `/` when not already typing in a field.
  React.useEffect(() => {
    window.__openBangSearch = false;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    const onHash = (): void => setOpen(location.hash === '#search');
    const onClick = (): void => setOpen(true);
    const openers = document.querySelectorAll('[data-open-search]');

    document.addEventListener('keydown', onKey);
    addEventListener('hashchange', onHash);
    openers.forEach((el) => el.addEventListener('click', onClick));
    return () => {
      document.removeEventListener('keydown', onKey);
      removeEventListener('hashchange', onHash);
      openers.forEach((el) => el.removeEventListener('click', onClick));
    };
  }, []);

  // Shareable without touching `?q=`, which is the redirect parameter.
  React.useEffect(() => {
    if (open && location.hash !== '#search') history.replaceState(null, '', '#search');
    if (!open && location.hash === '#search') history.replaceState(null, '', location.pathname + location.search);
  }, [open]);

  const tags = index?.payload.tags ?? [];
  const results = React.useMemo(
    () => (index ? search(index, query, { tagFilter: selected }) : []),
    [index, query, selected],
  );

  // Facets track the current results, except before a query when a fixed
  // starter set makes the palette useful the moment it opens.
  const chips = React.useMemo(() => {
    if (!index) return [];
    if (!query.trim() && selected.length === 0) {
      return STARTER_TAGS.map((tag) => tags.indexOf(tag)).filter((id) => id >= 0);
    }
    return [...new Set([...selected, ...facets(index.payload, results)])].slice(0, 10);
  }, [index, query, selected, results, tags]);

  const status = error
    ? 'Could not load the bang list.'
    : !index
      ? 'Loading…'
      : query.trim().length === 0
        ? 'Type to search, or pick a tag.'
        : query.trim().length === 1
          ? 'Keep typing…'
          : 'No matching bangs.';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Search bangs</DialogTitle>
        <DialogDescription className="sr-only">Search bang shortcuts by name, trigger, domain or tag.</DialogDescription>

        {/* cmdk's own filtering is off: it is fed an already-ranked list. */}
        <Command shouldFilter={false} loop>
          <CommandInput autoFocus value={query} onValueChange={setQuery} placeholder="Search bangs…" />

          {chips.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-neutral-800 px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {chips.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setSelected((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
                  }
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs transition-colors',
                    selected.includes(id)
                      ? 'bg-neutral-700 text-neutral-100'
                      : 'text-neutral-500 hover:text-neutral-200',
                  )}
                >
                  {tags[id]}
                </button>
              ))}
            </div>
          )}

          <CommandList>
            {results.length === 0 ? (
              <CommandEmpty>{status}</CommandEmpty>
            ) : (
              results.map((entry) => <Row key={entry[0]} entry={entry} />)
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
