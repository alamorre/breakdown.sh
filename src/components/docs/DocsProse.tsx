import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function DocsProse({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'prose prose-neutral max-w-none dark:prose-invert prose-code:rounded-sm prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.925em] prose-code:font-semibold prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none',
        className,
      )}
    >
      {children}
    </div>
  );
}
