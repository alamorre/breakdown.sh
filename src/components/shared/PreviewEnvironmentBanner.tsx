function shortSha(sha: string | undefined) {
  return sha ? sha.slice(0, 7) : null;
}

export function PreviewEnvironmentBanner() {
  if (process.env.NEXT_PUBLIC_APP_ENV !== 'preview') {
    return null;
  }

  const prNumber = process.env.NEXT_PUBLIC_PREVIEW_PR_NUMBER;
  const prTitle = process.env.NEXT_PUBLIC_PREVIEW_PR_TITLE;
  const commitSha = shortSha(process.env.NEXT_PUBLIC_PREVIEW_COMMIT_SHA);
  const databaseTarget = process.env.NEXT_PUBLIC_PREVIEW_DATABASE_TARGET ?? 'production';
  const prLabel = prNumber ? `PR #${prNumber}` : 'PR preview';
  const details = [prTitle, commitSha ? `commit ${commitSha}` : null].filter(Boolean).join(' | ');

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{prLabel}</span>
        {details && <span className="truncate">{details}</span>}
        <span className="font-medium">Using {databaseTarget} data</span>
      </div>
    </div>
  );
}
