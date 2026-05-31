const MARKER = '<!-- thesis-pr-preview -->';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getRunUrl() {
  const repository = requireEnv('GITHUB_REPOSITORY');
  const runId = requireEnv('GITHUB_RUN_ID');
  return `https://github.com/${repository}/actions/runs/${runId}`;
}

function getStatusLine(status) {
  if (status === 'inactive') {
    return 'Inactive. The PR was closed and the preview alias cleanup has run.';
  }
  if (status === 'failed') {
    return 'Failed. Open the workflow logs to see what broke before testing.';
  }
  return 'Ready for manual acceptance testing.';
}

function buildBody() {
  const status = process.env.PREVIEW_STATUS || 'ready';
  const previewUrl = process.env.PREVIEW_URL || '';
  const deploymentUrl = process.env.DEPLOYMENT_URL || '';
  const commitSha = process.env.COMMIT_SHA || '';
  const databaseTarget = process.env.DATABASE_TARGET || 'production Supabase';
  const runUrl = getRunUrl();
  const updatedAt = new Date().toISOString();
  const shortSha = commitSha ? commitSha.slice(0, 7) : 'unknown';

  const previewLine =
    status === 'inactive' || !previewUrl
      ? `Preview app: ${previewUrl || 'not available'}`
      : `Preview app: [${previewUrl}](${previewUrl})`;
  const deploymentLine = deploymentUrl
    ? `Vercel deployment: [${deploymentUrl}](${deploymentUrl})`
    : 'Vercel deployment: not available';

  return `${MARKER}
## PR preview

${getStatusLine(status)}

${previewLine}
${deploymentLine}
Commit: \`${shortSha}\`
Database: \`${databaseTarget}\`
Updated: \`${updatedAt}\`
Workflow: [run logs](${runUrl})

Manual test path:
- Sign in.
- Open the dashboard.
- Create or open a graph.
- Add, edit, move, and connect nodes.
- Run a node if this PR touches evaluation behavior.
- Export a graph if this PR touches serialization.

Heads up: this preview intentionally uses production Supabase data for now. Treat manual testing here like real product usage.`;
}

async function githubRequest(path, options = {}) {
  const token = requireEnv('GITHUB_TOKEN');
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function upsertComment() {
  const repository = requireEnv('GITHUB_REPOSITORY');
  const prNumber = requireEnv('PR_NUMBER');
  const [owner, repo] = repository.split('/');
  const comments = await githubRequest(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
  );
  const existingComment = comments.find((comment) => comment.body?.includes(MARKER));
  const body = buildBody();

  if (existingComment) {
    await githubRequest(`/repos/${owner}/${repo}/issues/comments/${existingComment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
    return;
  }

  await githubRequest(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  upsertComment().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  MARKER,
  buildBody,
};
