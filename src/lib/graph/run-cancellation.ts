const cancellationState = globalThis as typeof globalThis & {
  __thesisCancelledRunIds?: Set<string>;
};

function getCancelledRunIds() {
  cancellationState.__thesisCancelledRunIds ??= new Set<string>();
  return cancellationState.__thesisCancelledRunIds;
}

export function clearRunCancellation(runId: string) {
  getCancelledRunIds().delete(runId);
}

export function cancelRun(runId: string) {
  getCancelledRunIds().add(runId);
}

export function isRunCancelled(runId: string) {
  return getCancelledRunIds().has(runId);
}
