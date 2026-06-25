export const DEFAULT_BASELINE_PATH = 'docs/plugin-release-tests/latest.json';

const AUTH_FRICTION_SCORE = new Map([
  ['none', 0],
  ['low', 1],
  ['medium', 2],
  ['high', 3],
  ['blocking', 4],
  ['blocked', 4],
]);

const REQUIRED_KEYS = [
  'install_success',
  'auth_friction',
  'mcp_surface',
  'graph_access',
  'external_run_success',
  'setup_steps',
  'elapsed_ms',
  'docs_ambiguity',
];

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (['true', 'pass', 'passed', 'success', 'ok'].includes(value.toLowerCase())) return true;
    if (['false', 'fail', 'failed', 'error', 'blocked'].includes(value.toLowerCase())) {
      return false;
    }
  }
  return null;
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeAuthFriction(value) {
  const text = normalizeText(Array.isArray(value) ? value.join(' ') : value).toLowerCase();
  if (AUTH_FRICTION_SCORE.has(text)) return text;
  if (text === '') return null;
  if (
    text.includes('did not require') ||
    (text.includes('present') && text.includes('not written'))
  ) {
    return 'low';
  }
  if (text.includes('missing') || text.includes('not configured') || text.includes('failed')) {
    return 'blocking';
  }
  if (text.includes('skipped')) return 'medium';
  return 'medium';
}

function getPath(input, path) {
  let current = input;
  for (const part of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function firstValue(input, paths) {
  for (const path of paths) {
    const value = getPath(input, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function normalizeStringList(value) {
  return asArray(value)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeIssueIds(acceptedKnownIssues = []) {
  return asArray(acceptedKnownIssues)
    .map((issue) => {
      if (typeof issue === 'string') return { metric: issue, reason: '' };
      if (issue && typeof issue === 'object') {
        return {
          metric: normalizeText(issue.metric ?? issue.key ?? issue.id),
          reason: normalizeText(issue.reason ?? issue.note),
        };
      }
      return { metric: '', reason: '' };
    })
    .filter((issue) => issue.metric);
}

function issueAcceptsMetric(issue, metricKey) {
  return issue.metric === metricKey || issue.metric === '*';
}

function metricAccepted(metricKey, acceptedKnownIssues) {
  return acceptedKnownIssues.find((issue) => issueAcceptsMetric(issue, metricKey)) ?? null;
}

function metricValue(summary, key) {
  return summary.metrics[key] ?? null;
}

function makeMetric({
  key,
  label,
  baseline,
  candidate,
  status,
  severity = 'info',
  details = '',
  acceptedKnownIssue = null,
}) {
  return {
    key,
    label,
    baseline,
    candidate,
    status,
    severity,
    acceptedKnownIssue,
    details,
  };
}

function compareBooleanMetric({
  key,
  label,
  baseline,
  candidate,
  failureSeverity = 'blocker',
  acceptedKnownIssues,
}) {
  const accepted = metricAccepted(key, acceptedKnownIssues);

  if (candidate === null) {
    return makeMetric({
      key,
      label,
      baseline,
      candidate,
      status: 'unknown',
      details: 'Candidate did not report this result.',
    });
  }

  if (candidate === false) {
    const regressed = baseline !== false;
    return makeMetric({
      key,
      label,
      baseline,
      candidate,
      status: regressed ? 'regressed' : 'same',
      severity: failureSeverity,
      acceptedKnownIssue: accepted,
      details: regressed
        ? 'Candidate failed a check that the baseline did not fail.'
        : 'Candidate still fails this check.',
    });
  }

  if (baseline === false) {
    return makeMetric({
      key,
      label,
      baseline,
      candidate,
      status: 'improved',
      details: 'Candidate passes a check that failed in the baseline.',
    });
  }

  return makeMetric({
    key,
    label,
    baseline,
    candidate,
    status: baseline === null ? 'new' : 'same',
  });
}

function compareAuthFriction({ baseline, candidate, acceptedKnownIssues }) {
  const key = 'auth_friction';
  const accepted = metricAccepted(key, acceptedKnownIssues);
  const baselineScore = baseline === null ? null : AUTH_FRICTION_SCORE.get(baseline);
  const candidateScore = candidate === null ? null : AUTH_FRICTION_SCORE.get(candidate);

  if (candidateScore === null || candidateScore === undefined) {
    return makeMetric({
      key,
      label: 'Auth friction',
      baseline,
      candidate,
      status: 'unknown',
      details: 'Candidate did not report auth friction.',
    });
  }

  if (candidateScore >= AUTH_FRICTION_SCORE.get('blocking')) {
    return makeMetric({
      key,
      label: 'Auth friction',
      baseline,
      candidate,
      status: baselineScore === candidateScore ? 'same' : 'regressed',
      severity: 'blocker',
      acceptedKnownIssue: accepted,
      details: 'Candidate auth flow is blocking release testing.',
    });
  }

  if (baselineScore !== null && baselineScore !== undefined && candidateScore > baselineScore) {
    return makeMetric({
      key,
      label: 'Auth friction',
      baseline,
      candidate,
      status: 'regressed',
      severity: 'warning',
      acceptedKnownIssue: accepted,
      details: 'Candidate auth friction is worse than the promoted baseline.',
    });
  }

  if (baselineScore !== null && baselineScore !== undefined && candidateScore < baselineScore) {
    return makeMetric({
      key,
      label: 'Auth friction',
      baseline,
      candidate,
      status: 'improved',
    });
  }

  return makeMetric({
    key,
    label: 'Auth friction',
    baseline,
    candidate,
    status: baseline === null ? 'new' : 'same',
  });
}

function compareMcpSurface({ baseline, candidate, acceptedKnownIssues }) {
  const key = 'mcp_surface';
  const accepted = metricAccepted(key, acceptedKnownIssues);
  const baselineTools = uniqueSorted(baseline?.tools ?? []);
  const candidateTools = uniqueSorted(candidate?.tools ?? []);
  const baselineResources = uniqueSorted(baseline?.resources ?? []);
  const candidateResources = uniqueSorted(candidate?.resources ?? []);
  const candidateMissingTools = uniqueSorted(candidate?.missingTools ?? []);
  const missingBaselineTools = baselineTools.filter((tool) => !candidateTools.includes(tool));
  const missingBaselineResources = baselineResources.filter(
    (resource) => !candidateResources.includes(resource),
  );
  const missingSurface = uniqueSorted([
    ...missingBaselineTools,
    ...candidateMissingTools,
    ...missingBaselineResources,
  ]);
  const candidateSuccess = candidate?.success;

  if (
    !candidate ||
    (candidateSuccess === null && candidateTools.length === 0 && candidateResources.length === 0)
  ) {
    return makeMetric({
      key,
      label: 'MCP surface',
      baseline,
      candidate,
      status: 'unknown',
      details: 'Candidate did not report MCP tools/resources.',
    });
  }

  if (candidateSuccess === false || missingSurface.length > 0) {
    return makeMetric({
      key,
      label: 'MCP surface',
      baseline,
      candidate,
      status: 'regressed',
      severity: 'blocker',
      acceptedKnownIssue: accepted,
      details:
        missingSurface.length > 0
          ? `Candidate is missing MCP tools/resources: ${missingSurface.join(', ')}.`
          : 'Candidate MCP surface check failed.',
    });
  }

  const addedTools = candidateTools.filter((tool) => !baselineTools.includes(tool));
  const addedResources = candidateResources.filter(
    (resource) => !baselineResources.includes(resource),
  );
  const addedSurface = [...addedTools, ...addedResources];
  const status = addedSurface.length > 0 ? 'improved' : baseline ? 'same' : 'new';

  return makeMetric({
    key,
    label: 'MCP surface',
    baseline,
    candidate,
    status,
    details: addedSurface.length > 0 ? `Candidate adds: ${addedSurface.join(', ')}.` : '',
  });
}

function compareGraphAccess({ baseline, candidate, acceptedKnownIssues }) {
  const key = 'graph_access';
  const accepted = metricAccepted(key, acceptedKnownIssues);
  const baselineList = baseline?.listSuccess ?? null;
  const baselineRead = baseline?.readSuccess ?? null;
  const candidateList = candidate?.listSuccess ?? null;
  const candidateRead = candidate?.readSuccess ?? null;

  if (candidateList === null && candidateRead === null) {
    return makeMetric({
      key,
      label: 'Graph access',
      baseline,
      candidate,
      status: 'unknown',
      details: 'Candidate did not report graph access.',
    });
  }

  const listRegressed = candidateList === false && baselineList !== false;
  const readRegressed = candidateRead === false && baselineRead !== false;
  if (listRegressed || readRegressed) {
    return makeMetric({
      key,
      label: 'Graph access',
      baseline,
      candidate,
      status: 'regressed',
      severity: 'blocker',
      acceptedKnownIssue: accepted,
      details: 'Candidate graph list/read access regressed versus baseline.',
    });
  }

  const listImproved = candidateList === true && baselineList === false;
  const readImproved = candidateRead === true && baselineRead === false;
  if (listImproved || readImproved) {
    return makeMetric({
      key,
      label: 'Graph access',
      baseline,
      candidate,
      status: 'improved',
    });
  }

  return makeMetric({
    key,
    label: 'Graph access',
    baseline,
    candidate,
    status: baselineList === null && baselineRead === null ? 'new' : 'same',
  });
}

function compareSetupSteps({ baseline, candidate, acceptedKnownIssues }) {
  const key = 'setup_steps';
  const accepted = metricAccepted(key, acceptedKnownIssues);

  if (candidate === null) {
    return makeMetric({
      key,
      label: 'Setup steps',
      baseline,
      candidate,
      status: 'unknown',
      details: 'Candidate did not report setup step count.',
    });
  }

  if (baseline !== null && candidate > baseline) {
    return makeMetric({
      key,
      label: 'Setup steps',
      baseline,
      candidate,
      status: 'regressed',
      severity: 'warning',
      acceptedKnownIssue: accepted,
      details: `Candidate needs ${candidate - baseline} more setup step(s).`,
    });
  }

  if (baseline !== null && candidate < baseline) {
    return makeMetric({
      key,
      label: 'Setup steps',
      baseline,
      candidate,
      status: 'improved',
    });
  }

  return makeMetric({
    key,
    label: 'Setup steps',
    baseline,
    candidate,
    status: baseline === null ? 'new' : 'same',
  });
}

function compareElapsedMs({ baseline, candidate, acceptedKnownIssues }) {
  const key = 'elapsed_ms';
  const accepted = metricAccepted(key, acceptedKnownIssues);

  if (candidate === null) {
    return makeMetric({
      key,
      label: 'Elapsed time',
      baseline,
      candidate,
      status: 'unknown',
      details: 'Candidate did not report elapsed time.',
    });
  }

  const regressionThreshold = baseline === null ? null : Math.max(baseline * 1.25, baseline + 5000);
  if (regressionThreshold !== null && candidate > regressionThreshold) {
    return makeMetric({
      key,
      label: 'Elapsed time',
      baseline,
      candidate,
      status: 'regressed',
      severity: 'warning',
      acceptedKnownIssue: accepted,
      details: 'Candidate elapsed time is more than 25% or 5s slower than baseline.',
    });
  }

  if (baseline !== null && candidate < baseline * 0.75) {
    return makeMetric({
      key,
      label: 'Elapsed time',
      baseline,
      candidate,
      status: 'improved',
    });
  }

  return makeMetric({
    key,
    label: 'Elapsed time',
    baseline,
    candidate,
    status: baseline === null ? 'new' : 'same',
  });
}

function compareDocsAmbiguity({ baseline, candidate, acceptedKnownIssues }) {
  const key = 'docs_ambiguity';
  const accepted = metricAccepted(key, acceptedKnownIssues);
  const baselineCount = baseline?.count ?? null;
  const candidateCount = candidate?.count ?? null;

  if (candidateCount === null) {
    return makeMetric({
      key,
      label: 'Docs ambiguity',
      baseline,
      candidate,
      status: 'unknown',
      details: 'Candidate did not report docs ambiguity.',
    });
  }

  if (baselineCount !== null && candidateCount > baselineCount) {
    return makeMetric({
      key,
      label: 'Docs ambiguity',
      baseline,
      candidate,
      status: 'regressed',
      severity: 'warning',
      acceptedKnownIssue: accepted,
      details: `Candidate reports ${candidateCount - baselineCount} more docs ambiguity item(s).`,
    });
  }

  if (baselineCount !== null && candidateCount < baselineCount) {
    return makeMetric({
      key,
      label: 'Docs ambiguity',
      baseline,
      candidate,
      status: 'improved',
    });
  }

  return makeMetric({
    key,
    label: 'Docs ambiguity',
    baseline,
    candidate,
    status: baselineCount === null ? 'new' : 'same',
  });
}

export function normalizeSmokeSummary(input, { source = null } = {}) {
  const candidate = input?.candidate ?? {};
  const checks = input?.checks ?? {};
  const metrics = input?.metrics ?? {};
  const setup = checks.setup ?? input?.setup ?? {};
  const docs = checks.docs ?? input?.docs ?? {};
  const hosted = input?.hosted ?? {};
  const mcpSurface = checks.mcpSurface ?? checks.mcp ?? input?.mcpSurface ?? {};
  const graphAccess = checks.graphAccess ?? checks.graph ?? input?.graphAccess ?? {};
  const externalRun = checks.externalRun ?? input?.externalRun ?? {};
  const install = checks.install ?? input?.install ?? {};
  const auth = checks.auth ?? input?.auth ?? {};
  const toolsList = hosted.toolsList ?? {};
  const graphListing = hosted.graphListing ?? {};
  const importedGraph = hosted.importedGraph ?? {};
  const hostedExternalRun = hosted.externalRun ?? {};
  const docsAmbiguities = normalizeStringList(
    firstValue(input, [
      ['checks', 'docs', 'ambiguities'],
      ['docs', 'ambiguities'],
      ['docsAmbiguity'],
      ['docsAmbiguities'],
    ]),
  );

  return {
    schemaVersion: 1,
    source,
    version: normalizeText(
      candidate.version ??
        input?.candidateVersion ??
        input?.version ??
        input?.pluginVersion ??
        input?.summary?.version,
    ),
    ref: normalizeText(
      candidate.ref ??
        candidate.sha ??
        input?.candidateRef ??
        input?.testedRef ??
        input?.ref ??
        input?.gitRef,
    ),
    pr: normalizeText(candidate.pr ?? input?.pr ?? input?.pullRequest),
    generatedAt: normalizeText(input?.generatedAt ?? input?.testedAt ?? input?.createdAt),
    metrics: {
      install_success:
        asBoolean(metrics.install_success) ??
        asBoolean(install.success ?? install.ok ?? input?.installSuccess),
      auth_friction: normalizeAuthFriction(
        metrics.auth_friction ?? auth.friction ?? input?.authFriction,
      ),
      mcp_surface: {
        success:
          asBoolean(metrics.mcp_surface?.success) ??
          asBoolean(
            mcpSurface.success ??
              mcpSurface.ok ??
              toolsList.success ??
              toolsList.ok ??
              input?.mcpSurfaceSuccess,
          ),
        tools: normalizeStringList(
          metrics.mcp_surface?.tools ??
            mcpSurface.tools ??
            mcpSurface.toolNames ??
            toolsList.tools ??
            toolsList.toolNames,
        ),
        resources: normalizeStringList(metrics.mcp_surface?.resources ?? mcpSurface.resources),
        missingTools: normalizeStringList(
          metrics.mcp_surface?.missingTools ??
            metrics.mcp_surface?.missing_tools ??
            mcpSurface.missingTools ??
            mcpSurface.missing_tools,
        ),
      },
      graph_access: {
        listSuccess:
          asBoolean(metrics.graph_access?.listSuccess) ??
          asBoolean(
            graphAccess.listSuccess ??
              graphAccess.success ??
              graphListing.listSuccess ??
              graphListing.success ??
              graphListing.ok ??
              input?.graphListSuccess,
          ),
        readSuccess:
          asBoolean(metrics.graph_access?.readSuccess) ??
          asBoolean(
            graphAccess.readSuccess ??
              importedGraph.readSuccess ??
              importedGraph.success ??
              importedGraph.ok ??
              input?.graphReadSuccess,
          ),
      },
      external_run_success:
        asBoolean(metrics.external_run_success) ??
        asBoolean(
          externalRun.success ??
            externalRun.ok ??
            hostedExternalRun.success ??
            hostedExternalRun.ok ??
            input?.externalRunSuccess,
        ),
      setup_steps:
        asNumber(metrics.setup_steps) ??
        asNumber(
          setup.stepCount ??
            setup.steps ??
            setup.attemptedSteps ??
            install.commands?.length ??
            input?.setupSteps,
        ),
      elapsed_ms:
        asNumber(metrics.elapsed_ms) ??
        asNumber(setup.elapsedMs ?? input?.elapsedMs ?? input?.durationMs),
      docs_ambiguity: {
        count:
          asNumber(metrics.docs_ambiguity?.count) ??
          asNumber(docs.ambiguityCount ?? docsAmbiguities.length),
        items: docsAmbiguities,
      },
    },
    newFeedback: normalizeStringList(
      input?.newFeedback ?? input?.feedback?.new ?? input?.feedback ?? input?.recommendations,
    ),
    notes: normalizeStringList(input?.notes),
  };
}

export function comparePluginReleaseSmoke({
  candidate,
  baseline,
  acceptedKnownIssues = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!candidate) {
    throw new Error('Candidate smoke summary is required.');
  }

  const normalizedCandidate = normalizeSmokeSummary(candidate);
  const normalizedBaseline = baseline
    ? normalizeSmokeSummary(baseline)
    : normalizeSmokeSummary({
        version: '',
        ref: '',
        metrics: {},
      });
  const acceptedIssues = normalizeIssueIds(acceptedKnownIssues);

  const metrics = [
    compareBooleanMetric({
      key: 'install_success',
      label: 'Install success',
      baseline: metricValue(normalizedBaseline, 'install_success'),
      candidate: metricValue(normalizedCandidate, 'install_success'),
      acceptedKnownIssues: acceptedIssues,
    }),
    compareAuthFriction({
      baseline: metricValue(normalizedBaseline, 'auth_friction'),
      candidate: metricValue(normalizedCandidate, 'auth_friction'),
      acceptedKnownIssues: acceptedIssues,
    }),
    compareMcpSurface({
      baseline: metricValue(normalizedBaseline, 'mcp_surface'),
      candidate: metricValue(normalizedCandidate, 'mcp_surface'),
      acceptedKnownIssues: acceptedIssues,
    }),
    compareGraphAccess({
      baseline: metricValue(normalizedBaseline, 'graph_access'),
      candidate: metricValue(normalizedCandidate, 'graph_access'),
      acceptedKnownIssues: acceptedIssues,
    }),
    compareBooleanMetric({
      key: 'external_run_success',
      label: 'External run success',
      baseline: metricValue(normalizedBaseline, 'external_run_success'),
      candidate: metricValue(normalizedCandidate, 'external_run_success'),
      acceptedKnownIssues: acceptedIssues,
    }),
    compareSetupSteps({
      baseline: metricValue(normalizedBaseline, 'setup_steps'),
      candidate: metricValue(normalizedCandidate, 'setup_steps'),
      acceptedKnownIssues: acceptedIssues,
    }),
    compareElapsedMs({
      baseline: metricValue(normalizedBaseline, 'elapsed_ms'),
      candidate: metricValue(normalizedCandidate, 'elapsed_ms'),
      acceptedKnownIssues: acceptedIssues,
    }),
    compareDocsAmbiguity({
      baseline: metricValue(normalizedBaseline, 'docs_ambiguity'),
      candidate: metricValue(normalizedCandidate, 'docs_ambiguity'),
      acceptedKnownIssues: acceptedIssues,
    }),
  ];

  const regressions = metrics.filter((metric) => metric.status === 'regressed');
  const unacceptedRegressions = regressions.filter((metric) => !metric.acceptedKnownIssue);
  const blockingRegressions = unacceptedRegressions.filter(
    (metric) => metric.severity === 'blocker',
  );
  const warningRegressions = unacceptedRegressions.filter(
    (metric) => metric.severity === 'warning',
  );
  const hasKnownIssues = regressions.length !== unacceptedRegressions.length;
  const hasNewFeedback =
    normalizedCandidate.newFeedback.length > 0 ||
    (metricValue(normalizedCandidate, 'docs_ambiguity')?.items?.length ?? 0) > 0;

  let recommendation = 'promote';
  if (blockingRegressions.length > 0 || warningRegressions.length > 0) {
    recommendation = 'block';
  } else if (hasKnownIssues || hasNewFeedback) {
    recommendation = 'promote-with-known-issues';
  }

  return {
    schemaVersion: 1,
    generatedAt,
    candidate: {
      version: normalizedCandidate.version,
      ref: normalizedCandidate.ref,
      pr: normalizedCandidate.pr,
    },
    baseline: {
      version: normalizedBaseline.version,
      ref: normalizedBaseline.ref,
      generatedAt: normalizedBaseline.generatedAt,
    },
    recommendation,
    metrics,
    regressions,
    newFeedback: normalizedCandidate.newFeedback,
    acceptedKnownIssues: acceptedIssues,
    comparedKeys: REQUIRED_KEYS,
  };
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return 'not reported';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function renderComparisonMarkdown(comparison) {
  const lines = [
    '# Plugin Smoke Test Comparison',
    '',
    `Recommendation: \`${comparison.recommendation}\``,
    '',
    `Candidate: ${comparison.candidate.version || 'unknown version'} @ ${
      comparison.candidate.ref || 'unknown ref'
    }`,
    `Baseline: ${comparison.baseline.version || 'unknown version'} @ ${
      comparison.baseline.ref || 'unknown ref'
    }`,
    '',
    '## Regressions',
    '',
  ];

  if (comparison.regressions.length === 0) {
    lines.push('- None');
  } else {
    for (const regression of comparison.regressions) {
      const accepted = regression.acceptedKnownIssue
        ? ` Accepted known issue: ${regression.acceptedKnownIssue.reason || regression.key}.`
        : '';
      lines.push(
        `- ${regression.label}: ${regression.details || 'Regressed versus baseline.'}${accepted}`,
      );
    }
  }

  lines.push('', '## New Feedback', '');
  if (comparison.newFeedback.length === 0) {
    lines.push('- None');
  } else {
    for (const feedback of comparison.newFeedback) {
      lines.push(`- ${feedback}`);
    }
  }

  lines.push('', '## Metrics', '');
  lines.push('| Metric | Status | Baseline | Candidate |');
  lines.push('| --- | --- | --- | --- |');
  for (const metric of comparison.metrics) {
    lines.push(
      `| ${metric.label} | ${metric.status} | ${formatValue(metric.baseline)} | ${formatValue(
        metric.candidate,
      )} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}
