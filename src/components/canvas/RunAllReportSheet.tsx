'use client';

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CirclePause,
  Clock3,
  FileDiff,
  Loader2,
} from 'lucide-react';
import { formatElapsed, getRunProgressState, type RunProgressTone } from '@/lib/graph/run-progress';
import { cn } from '@/lib/utils';
import type { RunGraphMetrics } from '@/types/run-graph';
import type { RunStatus } from '@/types/node';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export interface RunAllReportNode {
  nodeId: string;
  name: string;
  runStatus: RunStatus;
  error: string | null;
  durationMs: number;
  outputChanged: boolean;
}

export interface RunAllReport {
  graphName: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  cancelled: boolean;
  metrics: RunGraphMetrics;
  nodes: RunAllReportNode[];
}

interface RunAllReportSheetProps {
  report: RunAllReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onItemClick?: (nodeId: string) => void;
}

const iconClassName = 'size-3.5';

function ReportStatusIcon({ tone }: { tone: RunProgressTone }) {
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

function formatTimestamp(isoTimestamp: string) {
  return isoTimestamp.replace('T', ' ').slice(0, 16);
}

function ReportStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'success' | 'warning' | 'error';
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div
        className={cn(
          'text-base font-semibold leading-5',
          tone === 'success' && 'text-emerald-700 dark:text-emerald-300',
          tone === 'warning' && 'text-amber-700 dark:text-amber-300',
          tone === 'error' && 'text-destructive',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{label}</div>
    </div>
  );
}

export function RunAllReportSheet({
  report,
  open,
  onOpenChange,
  onItemClick,
}: RunAllReportSheetProps) {
  if (!report) {
    return null;
  }

  const runCount = report.metrics.succeeded + report.metrics.failed;
  const skippedCount = report.metrics.skipped + report.metrics.cancelled;
  const issueCount = report.metrics.failed + skippedCount;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(32rem,calc(100vw-2rem))] gap-0 p-0 sm:max-w-[32rem]">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>Run Report</SheetTitle>
          <SheetDescription>
            {report.graphName} completed {formatTimestamp(report.completedAt)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ReportStat label="Ran" value={runCount} tone="success" />
            <ReportStat label="Failed" value={report.metrics.failed} tone="error" />
            <ReportStat label="Skipped" value={skippedCount} tone="warning" />
            <ReportStat label="Duration" value={formatElapsed(report.totalDurationMs)} />
          </div>

          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <div>
                <div className="text-sm font-medium leading-5">Nodes</div>
                <div className="text-xs text-muted-foreground">
                  Started {formatTimestamp(report.startedAt)}
                </div>
              </div>
              <div
                className={cn(
                  'rounded-md border px-2 py-1 text-xs font-medium',
                  issueCount > 0
                    ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
                )}
              >
                {report.metrics.succeeded}/{report.metrics.total} succeeded
              </div>
            </div>

            <div className="divide-y divide-border">
              {report.nodes.map((node) => {
                const state = getRunProgressState({
                  runStatus: node.runStatus,
                  error: node.error,
                });
                const outputLabel =
                  node.runStatus === 'success'
                    ? node.outputChanged
                      ? 'Changed'
                      : 'No change'
                    : 'No output';
                const rowContent = (
                  <>
                    <ReportStatusIcon tone={state.tone} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="truncate text-xs font-medium leading-4">{node.name}</div>
                        <span
                          className={cn(
                            'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-3.5',
                            getStatusPillClassName(state.tone),
                          )}
                        >
                          {state.label}
                        </span>
                      </div>
                      {node.error && (
                        <div className="truncate text-[11px] leading-4 text-muted-foreground">
                          {node.error}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Clock3 className="size-3" />
                          {formatElapsed(node.durationMs)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <FileDiff className="size-3" />
                          {outputLabel}
                        </span>
                      </div>
                    </div>
                  </>
                );
                const rowClassName = cn(
                  'grid w-full grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 px-3 py-2',
                  onItemClick &&
                    'cursor-pointer text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                );

                if (onItemClick) {
                  return (
                    <button
                      key={node.nodeId}
                      type="button"
                      className={rowClassName}
                      onClick={() => onItemClick(node.nodeId)}
                    >
                      {rowContent}
                    </button>
                  );
                }

                return (
                  <div key={node.nodeId} className={rowClassName}>
                    {rowContent}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
