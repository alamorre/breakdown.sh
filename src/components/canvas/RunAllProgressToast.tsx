import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  CircleDashed,
  CirclePause,
  Loader2,
} from 'lucide-react';
import {
  formatElapsed,
  getRunProgressState,
  summarizeRunProgress,
  type RunProgressItem,
  type RunProgressTone,
} from '@/lib/graph/run-progress';
import { cn } from '@/lib/utils';

interface RunAllProgressToastProps {
  items: RunProgressItem[];
  elapsedMs: number;
  note?: string;
}

const iconClassName = 'size-3.5';

function RunProgressIcon({ tone }: { tone: RunProgressTone }) {
  if (tone === 'success') {
    return <CheckCircle2 className={cn(iconClassName, 'text-emerald-600')} />;
  }

  if (tone === 'running') {
    return <Loader2 className={cn(iconClassName, 'animate-spin text-sky-600')} />;
  }

  if (tone === 'warning') {
    return <CirclePause className={cn(iconClassName, 'text-amber-600')} />;
  }

  if (tone === 'error') {
    return <AlertTriangle className={cn(iconClassName, 'text-destructive')} />;
  }

  return <CircleDashed className={cn(iconClassName, 'text-muted-foreground')} />;
}

function getStatusPillClassName(tone: RunProgressTone) {
  if (tone === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300';
  }

  if (tone === 'running') {
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300';
  }

  if (tone === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300';
  }

  if (tone === 'error') {
    return 'border-destructive/20 bg-destructive/10 text-destructive';
  }

  return 'border-border bg-muted text-muted-foreground';
}

function getRowClassName(tone: RunProgressTone) {
  if (tone === 'running') {
    return 'bg-sky-50/70 dark:bg-sky-950/20';
  }

  if (tone === 'error') {
    return 'bg-destructive/5';
  }

  return 'bg-muted/30';
}

function formatIssueCount(count: number) {
  return `${count} ${count === 1 ? 'issue' : 'issues'}`;
}

export function RunAllProgressToast({ items, elapsedMs, note }: RunAllProgressToastProps) {
  const summary = summarizeRunProgress(items);
  const waitingCount = summary.queued + summary.pending;

  return (
    <div className="w-[356px] max-w-[calc(100vw-32px)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-tight">Run All</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {summary.settled}/{summary.total} done
            </span>
            {summary.running > 0 && <span>{summary.running} running</span>}
            {waitingCount > 0 && <span>{waitingCount} queued</span>}
            {summary.failed > 0 && (
              <span className="text-destructive">{formatIssueCount(summary.failed)}</span>
            )}
            <span>{formatElapsed(elapsedMs)} elapsed</span>
          </div>
          {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
        </div>
        {summary.running === 0 && summary.settled === summary.total ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        ) : (
          <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
        )}
      </div>

      <div className="mt-3 max-h-72 overflow-y-auto pr-1">
        <div className="space-y-1.5">
          {items.map((item) => {
            const state = getRunProgressState(item);
            const title = [item.name, state.label, item.error].filter(Boolean).join(' - ');

            return (
              <div
                key={item.nodeId}
                title={title}
                className={cn(
                  'grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5',
                  getRowClassName(state.tone),
                )}
              >
                <RunProgressIcon tone={state.tone} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium leading-4">{item.name}</div>
                  {item.error && (
                    <div className="truncate text-[11px] leading-3.5 text-muted-foreground">
                      {item.error}
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    'rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-3.5',
                    getStatusPillClassName(state.tone),
                  )}
                >
                  {state.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
