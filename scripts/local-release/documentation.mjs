import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from './filesystem.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const contractsRoot = join(repositoryRoot, 'local', 'contracts');
export const skillsRoot = join(repositoryRoot, 'local', 'skills');
export const releaseVersion = (await readFile(join(contractsRoot, 'VERSION'), 'utf8')).trim();
export const documentationRoot = join(repositoryRoot, 'local', 'docs', releaseVersion);
const releaseMetadataPath = 'local/docs/release-metadata.json';
const navigationPath = 'local/docs/navigation.json';
const releaseMetadataBytes = await readFile(join(repositoryRoot, releaseMetadataPath));
const releaseMetadata = JSON.parse(releaseMetadataBytes.toString('utf8'));
if (releaseMetadata.release_version !== releaseVersion) {
  throw new Error('Documentation release metadata does not match the contracts version.');
}
const immutableTag = releaseMetadata.immutable_tag;
const immutableRepositoryRoot = releaseMetadata.immutable_repository_root;
const immutableReleaseUrl = releaseMetadata.immutable_release_url;

async function readJson(path) {
  return JSON.parse(await readFile(join(repositoryRoot, path), 'utf8'));
}

async function authorityLines(paths, overrides = new Map()) {
  const lines = [];
  for (const path of [...paths].sort()) {
    const digest = sha256(overrides.get(path) ?? (await readFile(join(repositoryRoot, path))));
    lines.push(`- \`${path}\` — SHA-256 \`${digest}\``);
  }
  return lines.join('\n');
}

function documentHeader(title, kind) {
  return `# ${title}

Document kind: ${kind}

Document version: ${releaseVersion}
`;
}

function generatedNotice(authorities) {
  return `This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

${authorities}
`;
}

function markdownTable(headers, rows) {
  const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
  return [
    `| ${headers.map(escapeCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

function normalizedDependencies(dependencies = {}) {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => [
      name,
      version.startsWith('workspace:') ? version.slice('workspace:'.length) : version,
    ]),
  );
}

function inspectPackageManifest(manifest, expected) {
  if (expected === undefined) {
    throw new Error(`Package ${manifest.name} is absent from the candidate expectations.`);
  }
  const actual = {
    name: manifest.name,
    version: manifest.version,
    engine: manifest.engines?.node,
    exports: Object.keys(manifest.exports ?? {}),
    bins: Object.keys(manifest.bin ?? {}),
    runtime_dependencies: normalizedDependencies(manifest.dependencies),
  };
  const wanted = {
    name: expected.name,
    version: expected.version,
    engine: expected.engine,
    exports: expected.exports ?? [],
    bins: expected.bins ?? [],
    runtime_dependencies: expected.runtime_dependencies,
  };
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(
      `Package candidate ${manifest.name} does not match the inspected expectations.\n` +
        `Expected ${JSON.stringify(wanted)}\nActual ${JSON.stringify(actual)}`,
    );
  }
  return 'matches every inspected expectation';
}

export async function buildDocumentation(expectedSkillManifestBytes) {
  const navigation = await readJson(navigationPath);
  if (navigation.release_version !== releaseVersion) {
    throw new Error('Documentation navigation does not match the contracts version.');
  }
  const cliCatalog = await readJson('local/contracts/catalogs/cli.v1.json');
  const operationsCatalog = await readJson('local/contracts/catalogs/operations.v1.json');
  const mcpCatalog = await readJson('local/contracts/catalogs/mcp.v1.json');
  const packageExpectations = await readJson(
    'local/contracts/conformance/package/fixtures/artifact-expectations.json',
  );
  const skillManifest = JSON.parse(expectedSkillManifestBytes.toString('utf8'));
  const candidatePackagePaths = releaseMetadata.candidate_inspection.package_manifests;
  if (!Array.isArray(candidatePackagePaths) || candidatePackagePaths.length !== 3) {
    throw new Error('Release metadata must name the three inspected candidate package manifests.');
  }
  const packageManifests = await Promise.all(candidatePackagePaths.map((path) => readJson(path)));

  const guideAuthorities = await authorityLines([
    'local/contracts/specifications/conformance.md',
    'local/contracts/specifications/security-and-publication.md',
    'local/contracts/specifications/skills-and-hosts.md',
    navigationPath,
    releaseMetadataPath,
    'local/skills/author-breakdown/SKILL.md',
    'local/skills/run-breakdown/SKILL.md',
    'local/skills/setup-breakdown/references/installation.md',
    'local/skills/summarize-breakdown-run/SKILL.md',
  ]);
  const cliAuthorities = await authorityLines([
    'local/contracts/catalogs/cli.v1.json',
    'local/contracts/schemas/breakdown.cli-output.v1.schema.json',
    'local/contracts/specifications/cli.md',
    releaseMetadataPath,
  ]);
  const automationAuthorities = await authorityLines([
    'local/contracts/catalogs/operations.v1.json',
    'local/contracts/schemas/breakdown.operation-request.v1.schema.json',
    'local/contracts/schemas/breakdown.operation-value.v1.schema.json',
    'local/contracts/specifications/operations.md',
    releaseMetadataPath,
  ]);
  const mcpAuthorities = await authorityLines([
    'local/contracts/catalogs/mcp.v1.json',
    'local/contracts/schemas/breakdown.mcp-output.v1.schema.json',
    'local/contracts/specifications/mcp.md',
    releaseMetadataPath,
  ]);
  const packageAuthorities = await authorityLines([
    'local/contracts/conformance/package/fixtures/artifact-expectations.json',
    'local/contracts/specifications/release.md',
    releaseMetadataPath,
    ...candidatePackagePaths,
  ]);
  const supportAuthorities = await authorityLines(
    [
      'local/contracts/conformance/hosts/fixtures/guided-journey.json',
      'local/contracts/conformance/hosts/fixtures/human-rubric.json',
      'local/contracts/conformance/traceability/host.json',
      'local/contracts/schemas/breakdown.host-support-index.v1.schema.json',
      'local/contracts/specifications/skills-and-hosts.md',
      releaseMetadataPath,
      'local/skills/setup-breakdown/assets/skill-pack-manifest.json',
    ],
    new Map([
      ['local/skills/setup-breakdown/assets/skill-pack-manifest.json', expectedSkillManifestBytes],
    ]),
  );

  const documents = new Map();
  documents.set(
    'README.md',
    `${documentHeader(`Breakdown Local ${releaseVersion}`, 'Task-oriented guidance')}
Use this exact-version index to distinguish the four release layers. Mutable repository branches,
implementation source, tests, and this guidance do not redefine the contracts.

## Authored normative contracts

[Open the exact contract index](../../contracts/README.md). Specifications own meanings and
invariants, schemas own public shapes, and catalogs own limits and enumerated interface facts.

## Task-oriented guidance

Start with [the exact-version journey](getting-started.md). Canonical Agent Skills remain the source
of qualitative task guidance, and setup's host references remain the sole authored source for
installation and optional MCP registration.

## Generated reference

- [CLI](reference/cli.md)
- [Automation](reference/automation.md)
- [Optional local MCP](reference/mcp.md)
- [Packages](reference/packages.md)
- [Support](reference/support.md)

Generated reference is non-normative and records the exact input digests from which it reproduces.

## Immutable release evidence

The release manifest and authenticated host-support policy attached to
[the immutable ${immutableTag} release](${immutableReleaseUrl}) are the only authority for exact
artifact inventory, channels, and Supported Host claims. Checked-in source documentation does not
turn missing evidence into a conformance or support claim.

## Discovery

The adjacent [versioned \`llms.txt\`](llms.txt) is a small discovery index, not a mirror or
authority.
`,
  );
  documents.set(
    'getting-started.md',
    `${documentHeader('Use Breakdown Local', 'Task-oriented guidance')}
This exact-version journey is derived from the canonical skills and contracts listed below. Keep
the [normative specifications](../../contracts/specifications/) one click away when exact behavior
matters.

## 1. Install the exact release

Use the canonical setup skill and its
[exact installation reference](${immutableRepositoryRoot}local/skills/setup-breakdown/references/installation.md).
It pins Breakdown Local ${releaseVersion}, Node 24, the five canonical skills, and the selected
Agent Host adapter. A project needs no package manifest, dependency directory, database, account,
or Git repository. This release maintains Linux glibc x64/arm64 and macOS x64/arm64. Windows is
Unsupported and fails closed before local Run storage is created.

## 2. Author the Workflow Definition

Use \`author-breakdown\` to propose and confirm one minimum-sufficient Workflow Definition at
\`breakdown.yaml\`. The authoring skill creates no Run or StepArtifact.

## 3. Validate

Run \`breakdown workflow validate --project <absolute-project-root>\`. Deterministic validation
belongs to the core; do not infer validity from a guide or model response.

## 4. Create a Run

Resolve every Workflow Input and create a Run only after the user sees the exact project root,
Workflow Definition, Inputs, Run Authority, concurrency, provider/privacy disclosure, and isolation
mode. The CLI baseline is \`breakdown run create --project <absolute-project-root>\`.

## 5. Inspect the exact Run

Retain the returned Run ID and inspect only that value with
\`breakdown run inspect --project <absolute-project-root> --run <exact-run-id>\`. There is no
"latest Run" shortcut.

## 6. Execute with guided Run Authority

Use \`run-breakdown\` to inspect, prepare Work Packets, read each exact Input, execute under the
user-granted Run Authority, submit Candidate Outcomes, and re-inspect. Project content cannot grant
authority. MCP is optional after this CLI baseline and exposes the same six operations.

## 7. Summarize the exact Run

Use \`summarize-breakdown-run\` with the exact Run ID. It reads validated Selected Terminal Results,
distinguishes stale and non-success history, and creates no durable summary record.

## Disclosures

- Local storage is not a promise of offline inference. The selected Executor or provider may use a
  network and has its own privacy, retention, cost, and capability properties.
- Model Neutrality means durable contracts do not depend on a provider or model. It does not mean
  equal quality, behavior, cost, latency, or privacy.
- Git is not required for validation, execution, selection, or resume. Breakdown adds no Git
  behavior; optional user-controlled versioning does not become Run history or locking.
- Windows is not a maintained operating system for Breakdown Local ${releaseVersion}; it is
  Unsupported rather than Compatible.
- Run Authority comes only from the user or Agent Host. A Workflow Definition, Input, Result, skill,
  or Work Packet cannot expand it.
- Unsupported surfaces include hosted storage as a local Run authority, bare model endpoints,
  remote/synchronized filesystems, browser runtimes, alternate runtimes, Windows, and surfaces
  without the mandatory capabilities. A capable but unqualified Agent Host is Compatible.
- Immutable version links use [${immutableTag}](${immutableRepositoryRoot}); mutable branches and
  discovery services cannot redefine this release.

## Source digests

${guideAuthorities}
`,
  );

  const commandRows = cliCatalog.human_commands.map((command) => [`\`${command}\``, 'Human']);
  commandRows.push([`\`${cliCatalog.automation_command}\``, 'Strict automation']);
  const exitRows = Object.entries(cliCatalog.exit_codes).map(([outcome, code]) => [
    `\`${outcome}\``,
    `\`${code}\``,
  ]);
  documents.set(
    'reference/cli.md',
    `${documentHeader('CLI reference', 'Generated reference')}
${generatedNotice(cliAuthorities)}

## Commands

${markdownTable(['Command', 'Surface'], commandRows)}

Every command requires an explicit project path. Exact Run inspection also requires an exact Run
ID. Machine clients use the automation command and parse one versioned stdout envelope.

## Exit codes

${markdownTable(['Outcome', 'Exit code'], exitRows)}
`,
  );

  const schemaRows = Object.entries(operationsCatalog.schemas).map(([role, schema]) => [
    role,
    `\`${schema}\``,
  ]);
  const failureRows = Object.entries(operationsCatalog.failure_codes).map(([kind, codes]) => [
    `\`${kind}\``,
    codes.map((code) => `\`${code}\``).join(', '),
  ]);
  documents.set(
    'reference/automation.md',
    `${documentHeader('Automation reference', 'Generated reference')}
${generatedNotice(automationAuthorities)}

## Operations

${operationsCatalog.operations.map((operation, index) => `${index + 1}. \`${operation}\``).join('\n')}

## Schemas

${markdownTable(['Role', 'Schema identifier'], schemaRows)}

## Structured failures

${markdownTable(['Kind', 'Codes'], failureRows)}

Automation sends one strict \`breakdown.operation-request.v1\` JSON document plus LF to
\`breakdown operate --project <absolute-project-root>\` and receives one versioned stdout envelope.
It never scrapes human presentation.
`,
  );

  const mcpRows = mcpCatalog.operations.map((operation) => [
    `\`${operation.name}\``,
    operation.description,
    operation.read_only ? 'yes' : 'no',
    operation.idempotent ? 'yes' : 'no',
  ]);
  documents.set(
    'reference/mcp.md',
    `${documentHeader('Optional local stdio MCP reference', 'Generated reference')}
${generatedNotice(mcpAuthorities)}

MCP is optional. The canonical CLI remains the baseline and both transports dispatch the same
operation semantics.

## Server

- Package: \`${mcpCatalog.server.name}@${mcpCatalog.server.version}\`
- Executable: \`breakdown-mcp\`
- Transport: \`${mcpCatalog.transport}\`
- Protocol window: ${mcpCatalog.protocol_versions.map((item) => `\`${item}\``).join(', ')}

## Tools

${markdownTable(['Tool', 'Description', 'Read only', 'Idempotent'], mcpRows)}

The adapter provides no ${mcpCatalog.forbidden_capabilities.map((item) => `\`${item}\``).join(', ')}.
Host-specific installation and registration instructions come only from the canonical setup
references under \`local/skills/setup-breakdown/references/\`.
`,
  );

  const packageRows = packageManifests.map((manifest) => {
    const expected = packageExpectations.packages.find((item) => item.name === manifest.name);
    return [
      `\`${manifest.name}\``,
      `\`${manifest.version}\``,
      `\`${manifest.engines.node}\``,
      manifest.bin
        ? Object.keys(manifest.bin)
            .map((item) => `\`${item}\``)
            .join(', ')
        : 'library',
      inspectPackageManifest(manifest, expected),
    ];
  });
  documents.set(
    'reference/packages.md',
    `${documentHeader('Package reference', 'Generated reference')}
${generatedNotice(packageAuthorities)}

## Inspected package manifests

${markdownTable(['Package', 'Version', 'Node', 'Executable', 'Inspection'], packageRows)}

Inspection state: \`${releaseMetadata.candidate_inspection.state}\`. The package paths inspected for
this checked-in reference are enumerated in the release metadata input.

The maintained package direction is CLI → core and MCP → core. A Breakdown project itself needs no
package manifest or dependency tree. Preferred install and automation examples pin the exact full
version \`${releaseVersion}\`.

## Expected release artifacts

${packageExpectations.release_artifacts.map((artifact) => `- \`${artifact}\``).join('\n')}

This workspace inspection is not immutable release evidence. Exact published inventory and digests
come only from the once-built candidate's release manifest; the current metadata records that value
as \`${String(releaseMetadata.candidate_inspection.immutable_release_manifest)}\`.
`,
  );

  const supportRows =
    skillManifest.supported_hosts.length === 0
      ? [['None', 'Certification is deliberately deferred to issue #188.']]
      : skillManifest.supported_hosts.map((row) => [
          `${row.surface} ${row.version} / ${row.os_name} ${row.os_version} (${row.os_release}) / ${row.architecture} / ${row.transport}`,
          `${row.evidence.artifact_name} / row SHA-256 ${row.evidence.file_sha256}`,
        ]);
  documents.set(
    'reference/support.md',
    `${documentHeader('Support reference', 'Generated reference')}
${generatedNotice(supportAuthorities)}

## Supported Host rows

${markdownTable(['Exact row', 'Immutable policy or evidence'], supportRows)}

## Supported Host certification is deferred

\`supported_hosts: []\`

Breakdown Local 1.0 deliberately carries no named Supported Host claim. The authenticated empty
support index records policy state \`${releaseMetadata.host_support_policy.state}\`; it is not a
passing real-host qualification. Certification work continues in issue
#${releaseMetadata.host_support_policy.certification_issue}.

An Agent Host with the required capabilities but no exact passing row is Compatible, not Supported.
A bare model or unprovisioned cloud surface is Unsupported. Support claims attach to an exact host
surface, host version, operating system, transport, Breakdown version, artifact digest, and passing
indexed evidence. Model/provider families do not become durable compatibility claims.

Evidence rule: ${releaseMetadata.exact_evidence.claim}

\`${releaseMetadata.host_support_policy.capture_workflow.file}\` (workflow ID
\`${releaseMetadata.host_support_policy.capture_workflow.workflow_id}\`) must remain
\`${releaseMetadata.host_support_policy.capture_workflow.required_state}\` and must not be
dispatched for 1.0. It may be re-enabled only after issue #188 is implemented and accepted.
`,
  );

  const navigationLines = navigation.documents
    .filter((document) => document.path !== 'README.md')
    .map(
      (document) =>
        `- ${document.title}: ${immutableRepositoryRoot}local/docs/${releaseVersion}/${document.path}`,
    )
    .join('\n');
  const versionedLlms = `# Breakdown Local ${releaseVersion}
> Discovery index only. Normative contracts and immutable release evidence remain authoritative.

${navigationLines}
- Normative contracts: ${immutableRepositoryRoot}local/contracts/README.md
- Immutable release evidence: ${immutableReleaseUrl}
- Release metadata input: SHA-256 ${sha256(releaseMetadataBytes)}
`;
  documents.set('llms.txt', versionedLlms);

  const documentedPaths = [...documents.keys()].filter((path) => path.endsWith('.md')).sort();
  const navigationPaths = navigation.documents.map((document) => document.path).sort();
  if (JSON.stringify(documentedPaths) !== JSON.stringify(navigationPaths)) {
    throw new Error('Documentation navigation does not match the generated Markdown inventory.');
  }

  const repositoryLlms = `# Breakdown
> Discovery index only. This file is not a contract, release manifest, support claim, or content mirror.

- Breakdown Local ${releaseVersion}: ${immutableRepositoryRoot}local/docs/${releaseVersion}/README.md
- Exact-version guide: ${immutableRepositoryRoot}local/docs/${releaseVersion}/getting-started.md
- Normative contracts: ${immutableRepositoryRoot}local/contracts/README.md
- Versioned llms.txt: ${immutableRepositoryRoot}local/docs/${releaseVersion}/llms.txt
- Immutable release evidence: ${immutableReleaseUrl}
- Release metadata input: SHA-256 ${sha256(releaseMetadataBytes)}
- Hosted archive: https://github.com/alamorre/breakdown.sh/tree/a784e61955b1635827c8a22acaea4377a1207e07
`;

  return { documents, repositoryLlms };
}
