import * as React from 'react';
import { ArrowUpRightIcon, CheckIcon, CopyIcon, TagIcon } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '../components/ui/command.js';
import { buildIndex, facets, search, type SearchIndex } from '../lib/search.js';
import type { SearchEntry, SearchPayload } from '../lib/types.js';
import { cn } from '../lib/utils.js';

declare const __SEARCH_INDEX_URL__: string;

/** Tags surfaced before the user has typed anything. */
const STARTER_TAGS = ['ai', 'developer', 'docs', 'search', 'social', 'video', 'shopping', 'news'];

function useSearchIndex(active: boolean): { index: SearchIndex | null; error: boolean } {
  const [index, setIndex] = React.useState<SearchIndex | null>(null);
  const [error, setError] = React.useState(false);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    fetch(__SEARCH_INDEX_URL__)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<SearchPayload>;
      })
      .then((payload) => setIndex(buildIndex(payload)))
      .catch(() => setError(true));
  }, [active]);

  return { index, error };
}

function TagChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors',
        selected
          ? 'border-violet-500/60 bg-violet-500/15 text-violet-300'
          : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200',
      )}
    >
      {selected && <CheckIcon className="size-3" />}
      {label}
    </button>
  );
}

function Row({ entry, tags }: { entry: SearchEntry; tags: readonly string[] }): React.JSX.Element {
  const [trigger, name, domain, , tagIds] = entry;
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(() => {
    void navigator.clipboard?.writeText(`!${trigger}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [trigger]);

  return (
    <CommandItem value={trigger} onSelect={copy} className="group">
      <span
        className={cn(
          'shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-xs transition-colors',
          copied
            ? 'border-violet-500/60 bg-violet-500/15 text-violet-300'
            : 'border-neutral-800 bg-neutral-900 text-neutral-300',
        )}
      >
        !{trigger}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-neutral-200">{name || 'Unnamed bang'}</span>
        <span className="block truncate font-mono text-[11px] text-neutral-500">{domain || '—'}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 sm:flex">
        {tagIds.slice(0, 2).map((id) => (
          <span key={id} className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-500">
            {tags[id]}
          </span>
        ))}
      </span>
      <CommandShortcut className="flex items-center gap-1">
        {copied ? (
          <>
            <CheckIcon className="size-3" /> copied
          </>
        ) : (
          <>
            <CopyIcon className="size-3" /> copy
          </>
        )}
      </CommandShortcut>
    </CommandItem>
  );
}

export function BangSearch(): React.JSX.Element {
  const [open, setOpen] = React.useState(() => location.hash === '#search' || window.__openBangSearch === true);
  const [query, setQuery] = React.useState('');
  const [selectedTags, setSelectedTags] = React.useState<number[]>([]);
  const { index, error } = useSearchIndex(open);

  // ⌘K / Ctrl-K anywhere, and `/` when not already typing in a field.
  React.useEffect(() => {
    window.__openBangSearch = false;
    const onKey = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName));
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    document.addEventListener('keydown', onKey);
    const onHash = (): void => setOpen(location.hash === '#search');
    addEventListener('hashchange', onHash);
    const openers = document.querySelectorAll('[data-open-search]');
    const onClick = (): void => setOpen(true);
    openers.forEach((element) => element.addEventListener('click', onClick));
    return () => {
      document.removeEventListener('keydown', onKey);
      removeEventListener('hashchange', onHash);
      openers.forEach((element) => element.removeEventListener('click', onClick));
    };
  }, []);

  // Keep the URL shareable without touching `?q=`, which is the redirect param.
  React.useEffect(() => {
    const target = open ? '#search' : '';
    if (open && location.hash !== '#search') history.replaceState(null, '', '#search');
    if (!open && location.hash === '#search') history.replaceState(null, '', location.pathname + location.search);
    void target;
  }, [open]);

  const tags = index?.payload.tags ?? [];

  const results = React.useMemo(
    () => (index ? search(index, query, { tagFilter: selectedTags }) : []),
    [index, query, selectedTags],
  );

  // Facets follow the current results, except before a query when we show a
  // fixed starter set so the modal is useful the moment it opens.
  const facetIds = React.useMemo(() => {
    if (!index) return [];
    if (!query.trim() && selectedTags.length === 0) {
      return STARTER_TAGS.map((tag) => tags.indexOf(tag)).filter((id) => id >= 0);
    }
    return [...new Set([...selectedTags, ...facets(index.payload, results)])];
  }, [index, query, selectedTags, results, tags]);

  const toggleTag = (id: number): void =>
    setSelectedTags((previous) => (previous.includes(id) ? previous.filter((t) => t !== id) : [...previous, id]));

  const status = error
    ? 'Could not load the bang list.'
    : !index
      ? 'Loading 13,631 bangs…'
      : query.trim().length === 1
        ? 'Keep typing…'
        : 'No matching bangs found.';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Search bangs</DialogTitle>
        <DialogDescription className="sr-only">
          Search every available bang shortcut by name, trigger, domain or tag.
        </DialogDescription>

        {/* cmdk's own filtering is disabled: we feed it an already-ranked list. */}
        <Command shouldFilter={false} loop>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search bangs by name, code, domain or tag…"
          />

          {/* One scrolling row rather than wrapping: the palette keeps a
              predictable height however many facets the results produce. */}
          {facetIds.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-neutral-800 px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TagIcon className="size-3.5 shrink-0 text-neutral-600" />
              {facetIds.map((id) => (
                <TagChip
                  key={id}
                  label={tags[id] ?? ''}
                  selected={selectedTags.includes(id)}
                  onToggle={() => toggleTag(id)}
                />
              ))}
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTags([])}
                  className="ml-auto shrink-0 pl-2 text-xs text-neutral-500 hover:text-neutral-300"
                >
                  clear
                </button>
              )}
            </div>
          )}

          <CommandList>
            {results.length === 0 ? (
              <CommandEmpty>{status}</CommandEmpty>
            ) : (
              <CommandGroup heading={`${results.length}${results.length === 50 ? '+' : ''} results`}>
                {results.map((entry) => (
                  <Row key={entry[0]} entry={entry} tags={tags} />
                ))}
              </CommandGroup>
            )}
          </CommandList>

          <CommandSeparator />
          <div className="flex items-center justify-between px-3 py-2 text-[11px] text-neutral-600">
            <span className="flex items-center gap-3">
              <span>
                <kbd className="font-mono text-neutral-500">↑↓</kbd> navigate
              </span>
              <span>
                <kbd className="font-mono text-neutral-500">↵</kbd> copy
              </span>
              <span>
                <kbd className="font-mono text-neutral-500">esc</kbd> close
              </span>
            </span>
            <a
              href="https://duckduckgo.com/bangs"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1 hover:text-neutral-400"
            >
              about bangs <ArrowUpRightIcon className="size-3" />
            </a>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
