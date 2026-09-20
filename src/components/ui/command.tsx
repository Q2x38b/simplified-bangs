'use client';
/** shadcn/ui Command (cmdk). Vendored per shadcn's copy-in model. */
import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';

import { cn } from '../../lib/utils.js';

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-xl bg-neutral-950 text-neutral-200', className)}
      {...props}
    />
  );
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2.5 border-b border-neutral-800 px-3.5">
      <SearchIcon className="size-4 shrink-0 text-neutral-500" />
      <CommandPrimitive.Input
        className={cn(
          'h-11 w-full bg-transparent text-sm outline-none placeholder:text-neutral-600',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-[min(60vh,22rem)] overflow-y-auto overflow-x-hidden overscroll-contain p-1', className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="py-8 text-center text-sm text-neutral-500" {...props} />;
}

/** One compact line: no wrapping, no secondary row. */
function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-3 rounded-md px-2.5 py-1.5 text-sm outline-none',
        'data-[selected=true]:bg-neutral-800 data-[selected=true]:text-neutral-50',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandEmpty, CommandInput, CommandItem, CommandList };
