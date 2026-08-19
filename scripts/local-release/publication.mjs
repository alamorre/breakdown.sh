import { execFile } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { sha256, sha512 } from './filesystem.mjs';
import {
  DEFERRED_HOST_SUPPORT_POLICY,
  generatedHostSupportJson,
  generatedHostSupportMarkdown,
  validateHostSupportIndex,
} from './host-evidence.mjs';
import { releaseChannel } from './release-channel.mjs';
import {
  RELEASE_CONTROL_POLICY,
  validateApprovalSignatureEvidence,
  validateRetainedGithubReleaseControls,
  validateWorkflowIdentityEvidence,
} from './release-controls.mjs';

const execFileAsync = promisify(execFile);
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const expectedPackageNames = ['@breakdown-sh/core', '@breakdown-sh/cli', '@breakdown-sh/mcp'];
const maintainedPlatformTuples = [
  { os: 'linux-glibc', architecture: 'x64' },
  { os: 'linux-glibc', architecture: 'arm64' },
  { os: 'macos', architecture: 'x64' },
  { os: 'macos', architecture: 'arm64' },
];
const DEFERRED_APPROVAL_POLICY = Object.freeze({
  state: DEFERRED_HOST_SUPPORT_POLICY.state,
  certification_issue: DEFERRED_HOST_SUPPORT_POLICY.certification_issue,
  supported_hosts: Object.freeze([]),
});
const DEFERRED_APPROVAL_STATEMENT =
  'I approve publication of only the identified candidate bytes after reviewing and accepting the Breakdown Local 1.0 deferred host-certification policy with supported_hosts: [].';
const QUALIFIED_APPROVAL_STATEMENT =
  'I approve publication of only the identified candidate bytes after reviewing and accepting the fully qualified passing host-support policy and its exact supported_hosts claims.';

export const HUMAN_RELEASE_ATTESTATIONS = Object.freeze([
  'legal_licensor_identity_confirmed',
  'publisher_identity_confirmed',
  'publication_authority_confirmed',
  'npm_scope_control_confirmed',
  'dco_1_1_signoff_confirmed',
  'no_cla_policy_confirmed',
  'ai_assisted_provenance_human_reviewed',
  'exact_dependency_review_passed',
  'copied_content_review_passed',
  'secret_scan_passed',
  'private_data_scan_passed',
  'artifact_local_notices_reviewed',
  'final_byte_inventory_reviewed',
  'package_gate_passed',
  'security_gate_passed',
  'documentation_gate_passed',
  'traceability_gate_passed',
  'platform_gate_passed',
  'zero_claim_deferred_host_policy_reviewed',
  'github_release_immutability_enabled',
  'tag_protection_enabled',
  'npm_trusted_publishing_configured',
  'npm_provenance_enabled',
  'npm_registry_signatures_required',
]);
export const QUALIFIED_HUMAN_RELEASE_ATTESTATIONS = Object.freeze(
  HUMAN_RELEASE_ATTESTATIONS.map((name) =>
    name === 'zero_claim_deferred_host_policy_reviewed'
      ? 'qualified_host_support_policy_reviewed'
      : name,
  ),
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function exactString(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function exactSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function exactSha1(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function candidateDigest(subjects) {
  const inventory = subjects
    .map((subject) => `${subject.digest.sha256}  ${subject.name}`)
    .sort()
    .join('\n');
  return sha256(Buffer.from(`${inventory}\n`));
}

async function regularFiles(directory, label) {
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(entries.length > 0, `${label} is empty.`);
  for (const entry of entries) {
    invariant(entry.isFile(), `${label} contains non-file entry ${entry.name}.`);
    invariant(releaseFilePattern.test(entry.name), `${label} contains unsafe file ${entry.name}.`);
    const facts = await lstat(join(directory, entry.name));
    invariant(
      facts.isFile() && !facts.isSymbolicLink(),
      `${label} contains unsafe file ${entry.name}.`,
    );
  }
  return entries.map((entry) => entry.name).sort();
}

async function readJson(path, label) {
  const facts = await lstat(path);
  invariant(facts.isFile() && !facts.isSymbolicLink(), `${label} is not a regular file.`);
  const bytes = await readFile(path);
  return { bytes, value: parseJson(bytes, label) };
}

async function readRegularFile(path, label) {
  const facts = await lstat(path);
  invariant(facts.isFile() && !facts.isSymbolicLink(), `${label} is not a regular file.`);
  return readFile(path);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function validateChecksumInventory({ checksumFile, directory, directoryFiles, label }) {
  const checksumBytes = await readFile(join(directory, checksumFile));
  const checksumLines = checksumBytes.toString('utf8').trimEnd().split('\n');
  const checksummedFiles = [];
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
    invariant(match !== null, `${label} has malformed checksum line: ${line}`);
    const [, expectedHash, file] = match;
    invariant(
      file !== checksumFile && directoryFiles.includes(file),
      `${label} checksum names absent ${file}.`,
    );
    invariant(!checksummedFiles.includes(file), `${label} checksum repeats ${file}.`);
    invariant(
      sha256(await readFile(join(directory, file))) === expectedHash,
      `${label} checksum differs for ${file}.`,
    );
    checksummedFiles.push(file);
  }
  return { checksumBytes, checksummedFiles };
}

async function readCandidate(candidateDirectory, { allowAdditionalFiles = false } = {}) {
  const directoryFiles = await regularFiles(candidateDirectory, 'Candidate directory');
  const manifestFiles = directoryFiles.filter((file) =>
    /^breakdown-release-[0-9]+\.[0-9]+\.[0-9]+\.json$/.test(file),
  );
  invariant(manifestFiles.length === 1, 'Stable candidate must contain one release manifest.');
  const manifestFile = manifestFiles[0];
  const manifestBytes = await readFile(join(candidateDirectory, manifestFile));
  const manifest = parseJson(manifestBytes, 'Candidate release manifest');
  const releaseVersion = manifest.release_version;
  invariant(
    manifest.schema_version === 'breakdown.release-manifest.v1' &&
      stableVersionPattern.test(releaseVersion),
    'Publication requires one stable full-SemVer candidate.',
  );
  const tag = `breakdown-local-v${releaseVersion}`;
  invariant(
    sameJson(manifest.channel, releaseChannel(releaseVersion)),
    'Stable candidate has the wrong npm or GitHub channel.',
  );

  const checksumFile = 'SHA256SUMS';
  invariant(directoryFiles.includes(checksumFile), 'Candidate has no SHA256SUMS.');
  const { checksumBytes, checksummedFiles } = await validateChecksumInventory({
    checksumFile,
    directory: candidateDirectory,
    directoryFiles,
    label: 'Candidate',
  });
  const files = [checksumFile, ...checksummedFiles].sort();
  invariant(
    allowAdditionalFiles || sameJson(files, directoryFiles),
    'Candidate checksums do not cover every exact file once.',
  );

  invariant(Array.isArray(manifest.artifacts), 'Candidate manifest has no artifact inventory.');
  const inventoriedFiles = [];
  for (const artifact of manifest.artifacts) {
    invariant(
      releaseFilePattern.test(artifact.file) &&
        files.includes(artifact.file) &&
        artifact.file !== manifestFile &&
        artifact.file !== checksumFile,
      'Candidate manifest names an invalid artifact.',
    );
    const bytes = await readFile(join(candidateDirectory, artifact.file));
    invariant(
      artifact.bytes === bytes.byteLength && artifact.hashes?.sha256 === sha256(bytes),
      `Candidate manifest digest differs for ${artifact.file}.`,
    );
    inventoriedFiles.push(artifact.file);
  }
  invariant(
    sameJson(
      inventoriedFiles.sort(),
      files.filter((file) => file !== checksumFile && file !== manifestFile),
    ),
    'Candidate manifest does not inventory every payload file once.',
  );

  invariant(
    Array.isArray(manifest.packages) &&
      sameJson(
        manifest.packages.map((entry) => entry.name),
        expectedPackageNames,
      ) &&
      manifest.packages.every(
        (entry) =>
          entry.version === releaseVersion &&
          releaseFilePattern.test(entry.artifact) &&
          files.includes(entry.artifact),
      ),
    'Candidate package inventory is not the exact lockstep package set.',
  );
  const provenanceFile = `breakdown-provenance-inputs-${releaseVersion}.json`;
  invariant(files.includes(provenanceFile), 'Candidate has no provenance inputs.');
  const provenance = parseJson(
    await readFile(join(candidateDirectory, provenanceFile)),
    'Candidate provenance inputs',
  );
  invariant(
    provenance.schema_version === 'breakdown.provenance-inputs.v1' &&
      provenance.release_version === releaseVersion &&
      provenance.source?.clean === true &&
      provenance.source?.clean_scope === 'entire-git-worktree' &&
      exactString(provenance.source?.repository) &&
      exactSha1(provenance.source?.git_commit) &&
      Array.isArray(provenance.subjects) &&
      provenance.subjects.every(
        (subject) =>
          releaseFilePattern.test(subject.name) &&
          files.includes(subject.name) &&
          exactSha256(subject.digest?.sha256),
      ),
    'Candidate provenance inputs are incomplete.',
  );
  for (const subject of provenance.subjects) {
    invariant(
      sha256(await readFile(join(candidateDirectory, subject.name))) === subject.digest.sha256,
      `Candidate provenance differs for ${subject.name}.`,
    );
  }
  const digest = manifest.platform_conformance?.current_build?.candidate_digest;
  const corpusRevision = manifest.platform_conformance?.current_build?.corpus_revision;
  invariant(
    digest?.algorithm === 'SHA-256' &&
      exactSha256(digest.content) &&
      digest.content === candidateDigest(provenance.subjects),
    'Candidate manifest has the wrong exact candidate digest.',
  );
  invariant(
    corpusRevision?.file === 'local/contracts/MANIFEST.json' && exactSha256(corpusRevision.sha256),
    'Candidate manifest has no exact contract corpus revision.',
  );
  invariant(
    sameJson(manifest.platform_conformance?.maintained_tuples, maintainedPlatformTuples),
    'Candidate has the wrong maintained platform set.',
  );
  return {
    corpusRevision,
    checksumInventory: {
      file: checksumFile,
      sha256: sha256(checksumBytes),
    },
    digest,
    files,
    manifest,
    manifestBytes,
    manifestFile,
    provenance,
    releaseVersion,
    tag,
  };
}

function validateBoundEvidence(index, schemaVersion, label, candidate) {
  invariant(index.schema_version === schemaVersion, `${label} has the wrong schema.`);
  invariant(
    index.release_version === candidate.releaseVersion &&
      index.status === 'passed' &&
      index.gate?.satisfied === true,
    `${label} did not pass for the stable release.`,
  );
  invariant(
    sameJson(index.candidate_digest, candidate.digest) &&
      sameJson(index.corpus_revision, candidate.corpusRevision) &&
      index.source?.repository === candidate.provenance.source.repository &&
      index.source?.git_commit === candidate.provenance.source.git_commit,
    `${label} is not bound to the exact candidate source and corpus.`,
  );
}

function validatePlatformIndex(index, candidate) {
  validateBoundEvidence(
    index,
    'breakdown.platform-qualification-index.v1',
    'Platform evidence index',
    candidate,
  );
  invariant(
    Array.isArray(index.rows) &&
      index.rows.length === maintainedPlatformTuples.length &&
      sameJson(
        index.rows.map((row) => row.tuple),
        maintainedPlatformTuples,
      ) &&
      index.rows.every(
        (row) =>
          row.status === 'passed' &&
          row.evidence?.mechanism === 'github-actions-artifact-v7' &&
          exactString(row.evidence?.artifact_name) &&
          /^[1-9]\d*$/.test(row.evidence?.workflow_run_id ?? '') &&
          /^[1-9]\d*$/.test(row.evidence?.workflow_run_attempt ?? '') &&
          exactSha256(row.evidence?.file_sha256),
      ),
    'Platform evidence index does not contain every exact passing immutable row.',
  );
}

function validateHostIndex(index, candidate) {
  invariant(
    index.schema_version === 'breakdown.host-support-index.v1' && index.tag === candidate.tag,
    'Host support index is not bound to the canonical release schema and tag.',
  );
  validateHostSupportIndex(index);
  invariant(
    index.release_version === candidate.releaseVersion &&
      index.gate?.satisfied === true &&
      sameJson(index.candidate_digest, candidate.digest) &&
      sameJson(index.corpus_revision, candidate.corpusRevision) &&
      index.source?.repository === candidate.provenance.source.repository &&
      index.source?.git_commit === candidate.provenance.source.git_commit,
    'Host support index is not bound to the exact candidate, source, corpus, and tag.',
  );
}

function approvalRequirements(hostIndex) {
  if (hostIndex.policy.state === 'deferred') {
    return {
      attestations: HUMAN_RELEASE_ATTESTATIONS,
      policy: DEFERRED_APPROVAL_POLICY,
      statement: DEFERRED_APPROVAL_STATEMENT,
    };
  }
  return {
    attestations: QUALIFIED_HUMAN_RELEASE_ATTESTATIONS,
    policy: {
      state: 'qualified',
      certification_issue: hostIndex.policy.certification_issue,
      supported_hosts: hostIndex.supported_hosts,
    },
    statement: QUALIFIED_APPROVAL_STATEMENT,
  };
}

function validateApproval(approval, candidate, hostIndex) {
  const requirements = approvalRequirements(hostIndex);
  invariant(
    approval.schema_version === 'breakdown.human-release-approval.v1' &&
      approval.release_version === candidate.releaseVersion &&
      sameJson(approval.candidate_digest, candidate.digest) &&
      approval.source?.repository === candidate.provenance.source.repository &&
      approval.source?.git_commit === candidate.provenance.source.git_commit &&
      approval.tag === candidate.tag,
    'Human release approval is not bound to the exact candidate.',
  );
  invariant(
    sameJson(approval.host_support_policy, requirements.policy),
    'Human release approval does not match the authenticated host support policy.',
  );
  invariant(
    exactString(approval.approver?.name) &&
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(approval.approver?.email ?? '') &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(
        approval.approver?.github_login ?? '',
      ) &&
      approval.approver.github_login === RELEASE_CONTROL_POLICY.maintainer &&
      Number.isFinite(Date.parse(approval.approved_at)) &&
      new Date(approval.approved_at).toISOString() === approval.approved_at &&
      approval.statement === requirements.statement,
    'Human release approval has incomplete approver identity or statement.',
  );
  invariant(
    sameJson(
      Object.keys(approval.attestations ?? {}).sort(),
      [...requirements.attestations].sort(),
    ) && requirements.attestations.every((name) => approval.attestations[name] === true),
    'Human release approval does not affirm every required gate.',
  );
}

function validateTagEvidence(evidence, candidate) {
  const protectedIncludes = evidence.protection?.conditions?.ref_name?.include;
  const protectedExcludes = evidence.protection?.conditions?.ref_name?.exclude;
  const protectionRules = evidence.protection?.rules?.map((rule) => rule.type) ?? [];
  const candidateArtifactId = evidence.artifact_ids?.candidate;
  const platformIndexArtifactId = evidence.artifact_ids?.platform_index;
  const expectedMessage = `Breakdown Local ${candidate.releaseVersion}

candidate-digest-sha256: ${candidate.digest.content}
candidate-checksum-inventory-sha256: ${candidate.checksumInventory.sha256}
candidate-artifact-id: ${candidateArtifactId}
platform-index-artifact-id: ${platformIndexArtifactId}`;
  invariant(
    evidence.schema_version === 'breakdown.signed-tag-evidence.v1' &&
      evidence.repository === candidate.provenance.source.repository &&
      evidence.tag === candidate.tag &&
      exactSha1(evidence.tag_object_sha) &&
      evidence.target?.type === 'commit' &&
      evidence.target?.sha === candidate.provenance.source.git_commit &&
      evidence.verification?.verified === true &&
      evidence.verification?.reason === 'valid' &&
      typeof evidence.message === 'string' &&
      evidence.message.trimEnd() === expectedMessage &&
      /^[1-9]\d*$/.test(candidateArtifactId ?? '') &&
      /^[1-9]\d*$/.test(platformIndexArtifactId ?? '') &&
      Number.isSafeInteger(evidence.protection?.ruleset_id) &&
      evidence.protection.ruleset_id === RELEASE_CONTROL_POLICY.rulesetId &&
      evidence.protection?.name === RELEASE_CONTROL_POLICY.rulesetName &&
      evidence.protection?.target === 'tag' &&
      evidence.protection?.enforcement === 'active' &&
      sameJson(protectedIncludes, [RELEASE_CONTROL_POLICY.deploymentTagRefPattern]) &&
      Array.isArray(protectedExcludes) &&
      protectedExcludes.length === 0 &&
      protectionRules.includes('update') &&
      protectionRules.includes('deletion') &&
      Array.isArray(evidence.protection?.bypass_actors) &&
      evidence.protection.bypass_actors.length === 0 &&
      evidence.protection?.current_user_can_bypass === 'never',
    'Signed tag evidence does not bind and protect the exact candidate bytes and source commit.',
  );
}

export async function writeHumanReleaseApprovalTemplate({ candidateDirectory, outputPath }) {
  const candidate = await readCandidate(candidateDirectory);
  const template = {
    schema_version: 'breakdown.human-release-approval.v1',
    release_version: candidate.releaseVersion,
    candidate_digest: candidate.digest,
    source: {
      repository: candidate.provenance.source.repository,
      git_commit: candidate.provenance.source.git_commit,
    },
    tag: candidate.tag,
    approver: {
      name: '',
      email: '',
      github_login: '',
    },
    approved_at: '',
    host_support_policy: DEFERRED_APPROVAL_POLICY,
    attestations: Object.fromEntries(HUMAN_RELEASE_ATTESTATIONS.map((name) => [name, false])),
    statement: DEFERRED_APPROVAL_STATEMENT,
  };
  await writeFile(outputPath, `${JSON.stringify(template, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return template;
}

function mediaType(file) {
  if (file.endsWith('.tgz') || file.endsWith('.tar.gz')) return 'application/gzip';
  if (file.endsWith('.zip')) return 'application/zip';
  if (file.endsWith('.sig')) return 'application/ssh-signature';
  if (file.endsWith('.md') || file.includes('SHA256SUMS')) return 'text/plain';
  return 'application/json';
}

async function artifactRecord(directory, file, role) {
  const bytes = await readFile(join(directory, file));
  return {
    file,
    role,
    media_type: mediaType(file),
    bytes: bytes.byteLength,
    hashes: {
      sha256: sha256(bytes),
      sha512: sha512(bytes),
    },
  };
}

function releaseNotes(candidate, platformIndex, hostIndex) {
  const hostQualification =
    hostIndex.policy?.state === 'deferred'
      ? `- Supported Host certification is deferred for Breakdown Local 1.0.\n- \`supported_hosts: []\`\n- Capable unqualified Agent Hosts are Compatible, not Supported. Windows and surfaces without the mandatory capabilities are Unsupported.`
      : `- ${hostIndex.supported_hosts.length} exact Agent Host rows are Supported.\n- Other capable Agent Hosts remain Compatible unless their exact row appears in the attached\n  generated support evidence.`;
  return `# Breakdown Local ${candidate.releaseVersion}

This stable release publishes the exact once-built candidate identified by
\`${candidate.tag}\` and candidate SHA-256 \`${candidate.digest.content}\`.

## Exact-version installation

\`\`\`sh
npm install --global @breakdown-sh/cli@${candidate.releaseVersion}
npm exec --yes --package=@breakdown-sh/cli@${candidate.releaseVersion} -- breakdown --version
\`\`\`

The npm \`latest\` tag points to this release, but installation guidance remains pinned to the
exact full version.

## Qualification

- ${platformIndex.rows.length} maintained platform rows passed against the exact candidate.
${hostQualification}

The attached publication manifest, evidence indexes, checksums, SBOM, provenance inputs, legal
material, signed human approval, GitHub controls, and workflow identity are the complete release
evidence.
`;
}

async function copyNamedFile(sourcePath, outputDirectory, outputName) {
  const facts = await lstat(sourcePath);
  invariant(
    facts.isFile() && !facts.isSymbolicLink(),
    `Publication input ${outputName} is unsafe.`,
  );
  await copyFile(sourcePath, join(outputDirectory, outputName));
}

export async function prepareLocalPublication({
  approvalPath,
  approvalSignaturePath,
  approvalVerificationPath,
  candidateDirectory,
  githubControlsPath,
  hostIndexPath,
  outputDirectory,
  platformIndexPath,
  supportDirectory,
  tagEvidencePath,
  workflowIdentityPath,
}) {
  invariant(
    (await readdir(outputDirectory)).length === 0,
    `Publication output directory must be empty: ${outputDirectory}`,
  );
  const candidate = await readCandidate(candidateDirectory);
  const platformInput = await readJson(platformIndexPath, 'Platform evidence index');
  const hostInput = await readJson(hostIndexPath, 'Host evidence index');
  const approvalInput = await readJson(approvalPath, 'Human release approval');
  const approvalSignatureBytes = await readRegularFile(
    approvalSignaturePath,
    'Human release approval signature',
  );
  const approvalVerificationInput = await readJson(
    approvalVerificationPath,
    'Human release approval signature verification',
  );
  const githubControlsInput = await readJson(githubControlsPath, 'GitHub release controls');
  const tagInput = await readJson(tagEvidencePath, 'Signed tag evidence');
  const workflowIdentityInput = await readJson(workflowIdentityPath, 'Stable workflow identity');
  validatePlatformIndex(platformInput.value, candidate);
  validateHostIndex(hostInput.value, candidate);
  validateApproval(approvalInput.value, candidate, hostInput.value);
  validateApprovalSignatureEvidence({
    approval: approvalInput.value,
    approvalBytes: approvalInput.bytes,
    evidence: approvalVerificationInput.value,
    signatureBytes: approvalSignatureBytes,
  });
  validateRetainedGithubReleaseControls(githubControlsInput.value, {
    repository: candidate.provenance.source.repository,
    tag: candidate.tag,
  });
  validateTagEvidence(tagInput.value, candidate);
  validateWorkflowIdentityEvidence(workflowIdentityInput.value, {
    approvalVerificationSha256: sha256(approvalVerificationInput.bytes),
    candidate,
    candidateArtifactId: tagInput.value.artifact_ids.candidate,
    controlsSha256: sha256(githubControlsInput.bytes),
    platformIndexArtifactId: tagInput.value.artifact_ids.platform_index,
  });

  const supportFiles = await regularFiles(supportDirectory, 'Generated host support directory');
  const hostFile = 'breakdown-host-support-index.json';
  const hostAttestationFile = 'breakdown-host-support-index.attestation.json';
  const expectedSupportFiles = [
    hostAttestationFile,
    `breakdown-supported-hosts-${candidate.releaseVersion}.json`,
    `breakdown-supported-hosts-${candidate.releaseVersion}.md`,
  ].sort();
  invariant(
    sameJson(supportFiles, expectedSupportFiles),
    'Generated host support directory has an incomplete or unexpected inventory.',
  );
  const supportJsonFile = `breakdown-supported-hosts-${candidate.releaseVersion}.json`;
  const hostDigest = sha256(hostInput.bytes);
  const expectedSupportJson = generatedHostSupportJson(hostInput.value, hostFile, hostDigest);
  const supportJsonBytes = await readFile(join(supportDirectory, supportJsonFile));
  const supportJson = parseJson(supportJsonBytes, 'Generated host support JSON');
  invariant(
    sameJson(supportJson, expectedSupportJson),
    'Generated host support is not derived from the authenticated host support index.',
  );
  const supportMarkdownFile = `breakdown-supported-hosts-${candidate.releaseVersion}.md`;
  invariant(
    (await readFile(join(supportDirectory, supportMarkdownFile), 'utf8')) ===
      generatedHostSupportMarkdown(hostInput.value, hostFile, hostDigest),
    'Generated host support Markdown is not derived from the authenticated host support index.',
  );

  for (const file of candidate.files) {
    await copyNamedFile(join(candidateDirectory, file), outputDirectory, file);
  }
  const platformFile = 'breakdown-platform-evidence-index.json';
  const approvalFile = 'breakdown-human-release-approval.json';
  const approvalSignatureFile = 'breakdown-human-release-approval.json.sig';
  const approvalVerificationFile = 'breakdown-human-release-approval-verification.json';
  const githubControlsFile = 'breakdown-github-release-controls.json';
  const tagFile = 'breakdown-signed-tag-evidence.json';
  const workflowIdentityFile = 'breakdown-stable-workflow-identity.json';
  await copyNamedFile(platformIndexPath, outputDirectory, platformFile);
  await copyNamedFile(hostIndexPath, outputDirectory, hostFile);
  await copyNamedFile(approvalPath, outputDirectory, approvalFile);
  await copyNamedFile(approvalSignaturePath, outputDirectory, approvalSignatureFile);
  await copyNamedFile(approvalVerificationPath, outputDirectory, approvalVerificationFile);
  await copyNamedFile(githubControlsPath, outputDirectory, githubControlsFile);
  await copyNamedFile(tagEvidencePath, outputDirectory, tagFile);
  await copyNamedFile(workflowIdentityPath, outputDirectory, workflowIdentityFile);
  for (const file of supportFiles) {
    await copyNamedFile(join(supportDirectory, file), outputDirectory, file);
  }
  const notesFile = `breakdown-release-notes-${candidate.releaseVersion}.md`;
  await writeFile(
    join(outputDirectory, notesFile),
    releaseNotes(candidate, platformInput.value, hostInput.value),
  );

  const roles = new Map([
    ...candidate.manifest.artifacts.map((artifact) => [artifact.file, artifact.role]),
    [candidate.manifestFile, 'candidate-release-manifest'],
    ['SHA256SUMS', 'candidate-checksum-inventory'],
    [platformFile, 'platform-evidence-index'],
    [hostFile, 'host-support-index'],
    [supportJsonFile, 'generated-supported-hosts'],
    [supportMarkdownFile, 'generated-supported-hosts'],
    [hostAttestationFile, 'host-index-attestation'],
    [approvalFile, 'human-release-approval'],
    [approvalSignatureFile, 'human-release-approval-signature'],
    [approvalVerificationFile, 'human-release-approval-signature-verification'],
    [githubControlsFile, 'github-release-controls'],
    [tagFile, 'signed-tag-evidence'],
    [workflowIdentityFile, 'stable-workflow-identity'],
    [notesFile, 'release-notes'],
  ]);
  const payloadFiles = [...roles.keys()].sort();
  const artifacts = [];
  for (const file of payloadFiles) {
    artifacts.push(await artifactRecord(outputDirectory, file, roles.get(file)));
  }
  const manifestFile = `breakdown-publication-manifest-${candidate.releaseVersion}.json`;
  const checksumFile = `breakdown-publication-SHA256SUMS-${candidate.releaseVersion}`;
  const manifest = {
    schema_version: 'breakdown.publication-manifest.v1',
    release_version: candidate.releaseVersion,
    channel: candidate.manifest.channel,
    source: {
      repository: candidate.provenance.source.repository,
      git_commit: candidate.provenance.source.git_commit,
      signed_tag: candidate.tag,
      signed_tag_object_sha: tagInput.value.tag_object_sha,
      tag_protection: tagInput.value.protection,
    },
    candidate: {
      digest: candidate.digest,
      checksum_inventory: candidate.checksumInventory,
      release_manifest: {
        file: candidate.manifestFile,
        sha256: sha256(candidate.manifestBytes),
      },
      integrity_rule: 'Every candidate file is copied byte-for-byte and retains its original name.',
    },
    artifacts,
    packages: candidate.manifest.packages,
    qualified_platforms: platformInput.value.rows,
    host_support_policy: hostInput.value.policy ?? { state: 'qualified' },
    supported_hosts: hostInput.value.supported_hosts,
    evidence: {
      platform_index: { file: platformFile, sha256: sha256(platformInput.bytes) },
      host_support_index: { file: hostFile, sha256: sha256(hostInput.bytes) },
      human_approval: { file: approvalFile, sha256: sha256(approvalInput.bytes) },
      human_approval_signature: {
        file: approvalSignatureFile,
        sha256: sha256(approvalSignatureBytes),
      },
      human_approval_verification: {
        file: approvalVerificationFile,
        sha256: sha256(approvalVerificationInput.bytes),
      },
      github_release_controls: {
        file: githubControlsFile,
        sha256: sha256(githubControlsInput.bytes),
      },
      signed_tag: { file: tagFile, sha256: sha256(tagInput.bytes) },
      stable_workflow_identity: {
        file: workflowIdentityFile,
        sha256: sha256(workflowIdentityInput.bytes),
      },
    },
    license_scope: candidate.manifest.license_scope,
    publication: {
      state: 'ready-for-human-controlled-publication',
      github_release: {
        immutable: true,
        prerelease: false,
        latest: true,
        required_attestations: true,
      },
      npm: {
        dist_tag: 'latest',
        authentication: 'OIDC trusted publishing',
        provenance: 'required',
        registry_signatures: 'required',
      },
      overwrite_or_rebuild_permitted: false,
      post_publication_inspection_required: true,
    },
    integrity: {
      checksum_inventory: checksumFile,
      rule: 'The publication checksum inventory authenticates every other release asset.',
    },
  };
  await writeJson(join(outputDirectory, manifestFile), manifest);
  const filesBeforeChecksums = (await readdir(outputDirectory)).sort();
  const checksumLines = [];
  for (const file of filesBeforeChecksums) {
    checksumLines.push(`${sha256(await readFile(join(outputDirectory, file)))}  ${file}`);
  }
  await writeFile(join(outputDirectory, checksumFile), `${checksumLines.join('\n')}\n`);
  return inspectLocalPublication({ publicationDirectory: outputDirectory });
}

export async function inspectLocalPublication({ publicationDirectory }) {
  const files = await regularFiles(publicationDirectory, 'Publication directory');
  const manifestFiles = files.filter((file) =>
    /^breakdown-publication-manifest-[0-9]+\.[0-9]+\.[0-9]+\.json$/.test(file),
  );
  invariant(manifestFiles.length === 1, 'Publication has no unique stable manifest.');
  const manifest = parseJson(
    await readFile(join(publicationDirectory, manifestFiles[0])),
    'Publication manifest',
  );
  invariant(
    manifest.schema_version === 'breakdown.publication-manifest.v1' &&
      stableVersionPattern.test(manifest.release_version),
    'Publication manifest is not a stable release.',
  );
  invariant(
    sameJson(manifest.channel, releaseChannel(manifest.release_version)),
    'Publication manifest has the wrong stable channels.',
  );
  const checksumFile = `breakdown-publication-SHA256SUMS-${manifest.release_version}`;
  invariant(files.includes(checksumFile), 'Publication checksum inventory is absent.');
  const { checksummedFiles: coveredFiles } = await validateChecksumInventory({
    checksumFile,
    directory: publicationDirectory,
    directoryFiles: files,
    label: 'Publication',
  });
  invariant(
    sameJson(
      coveredFiles.sort(),
      files.filter((file) => file !== checksumFile),
    ),
    'Publication checksums do not cover every public asset exactly once.',
  );
  invariant(
    Array.isArray(manifest.artifacts) &&
      sameJson(
        manifest.artifacts.map((artifact) => artifact.file).sort(),
        files.filter((file) => ![checksumFile, manifestFiles[0]].includes(file)),
      ),
    'Publication manifest does not inventory every payload asset exactly once.',
  );
  for (const artifact of manifest.artifacts) {
    const bytes = await readFile(join(publicationDirectory, artifact.file));
    invariant(
      artifact.bytes === bytes.byteLength &&
        artifact.hashes?.sha256 === sha256(bytes) &&
        artifact.hashes?.sha512 === sha512(bytes),
      `Publication manifest digest differs for ${artifact.file}.`,
    );
  }
  invariant(
    manifest.publication?.state === 'ready-for-human-controlled-publication' &&
      manifest.publication?.overwrite_or_rebuild_permitted === false &&
      manifest.publication?.post_publication_inspection_required === true,
    'Publication manifest does not preserve the release ceremony.',
  );
  const candidate = await readCandidate(publicationDirectory, { allowAdditionalFiles: true });
  invariant(
    candidate.releaseVersion === manifest.release_version &&
      sameJson(candidate.digest, manifest.candidate?.digest) &&
      sameJson(candidate.checksumInventory, manifest.candidate?.checksum_inventory) &&
      candidate.manifestFile === manifest.candidate?.release_manifest?.file &&
      sha256(candidate.manifestBytes) === manifest.candidate?.release_manifest?.sha256,
    'Publication manifest is not bound to its preserved candidate.',
  );
  const hostIndexFile = manifest.evidence?.host_support_index?.file;
  invariant(
    releaseFilePattern.test(hostIndexFile ?? '') && files.includes(hostIndexFile),
    'Publication manifest has no retained host support index.',
  );
  const hostIndexBytes = await readFile(join(publicationDirectory, hostIndexFile));
  invariant(
    sha256(hostIndexBytes) === manifest.evidence.host_support_index.sha256,
    'Publication host support index digest does not match its evidence binding.',
  );
  const hostIndex = parseJson(hostIndexBytes, 'Publication host support index');
  validateHostIndex(hostIndex, candidate);
  invariant(
    sameJson(manifest.host_support_policy, hostIndex.policy ?? { state: 'qualified' }) &&
      sameJson(manifest.supported_hosts, hostIndex.supported_hosts),
    'Publication host support policy and claims do not match the authenticated index.',
  );
  const supportJsonFile = `breakdown-supported-hosts-${manifest.release_version}.json`;
  const supportMarkdownFile = `breakdown-supported-hosts-${manifest.release_version}.md`;
  invariant(
    files.includes(supportJsonFile) && files.includes(supportMarkdownFile),
    'Publication is missing generated host support material.',
  );
  invariant(
    sameJson(
      parseJson(
        await readFile(join(publicationDirectory, supportJsonFile)),
        'Publication generated host support JSON',
      ),
      generatedHostSupportJson(hostIndex, hostIndexFile, sha256(hostIndexBytes)),
    ) &&
      (await readFile(join(publicationDirectory, supportMarkdownFile), 'utf8')) ===
        generatedHostSupportMarkdown(hostIndex, hostIndexFile, sha256(hostIndexBytes)),
    'Publication generated host support material does not match the authenticated index.',
  );
  const approvalBytes = await readRegularFile(
    join(publicationDirectory, manifest.evidence?.human_approval?.file),
    'Publication human release approval',
  );
  const approval = parseJson(approvalBytes, 'Publication human release approval');
  validateApproval(approval, candidate, hostIndex);
  const approvalSignatureBytes = await readRegularFile(
    join(publicationDirectory, manifest.evidence?.human_approval_signature?.file),
    'Publication human release approval signature',
  );
  const approvalVerificationBytes = await readRegularFile(
    join(publicationDirectory, manifest.evidence?.human_approval_verification?.file),
    'Publication human release approval verification',
  );
  const approvalVerification = parseJson(
    approvalVerificationBytes,
    'Publication human release approval verification',
  );
  validateApprovalSignatureEvidence({
    approval,
    approvalBytes,
    evidence: approvalVerification,
    signatureBytes: approvalSignatureBytes,
  });
  const githubControlsBytes = await readRegularFile(
    join(publicationDirectory, manifest.evidence?.github_release_controls?.file),
    'Publication GitHub release controls',
  );
  const githubControls = parseJson(githubControlsBytes, 'Publication GitHub release controls');
  validateRetainedGithubReleaseControls(githubControls, {
    repository: candidate.provenance.source.repository,
    tag: candidate.tag,
  });
  const tagEvidenceBytes = await readRegularFile(
    join(publicationDirectory, manifest.evidence?.signed_tag?.file),
    'Publication signed tag evidence',
  );
  const tagEvidence = parseJson(tagEvidenceBytes, 'Publication signed tag evidence');
  validateTagEvidence(tagEvidence, candidate);
  const workflowIdentityBytes = await readRegularFile(
    join(publicationDirectory, manifest.evidence?.stable_workflow_identity?.file),
    'Publication stable workflow identity',
  );
  const workflowIdentity = parseJson(workflowIdentityBytes, 'Publication stable workflow identity');
  validateWorkflowIdentityEvidence(workflowIdentity, {
    approvalVerificationSha256: sha256(approvalVerificationBytes),
    candidate,
    candidateArtifactId: tagEvidence.artifact_ids.candidate,
    controlsSha256: sha256(githubControlsBytes),
    platformIndexArtifactId: tagEvidence.artifact_ids.platform_index,
  });
  return {
    schema_version: 'breakdown.publication-inspection.v1',
    release_version: manifest.release_version,
    status: 'passed',
    candidate_digest: manifest.candidate.digest,
    npm_dist_tag: manifest.channel.npm_dist_tag,
    github_prerelease: manifest.channel.github_prerelease,
    qualified_platforms: manifest.qualified_platforms.length,
    supported_hosts: manifest.supported_hosts.length,
    public_assets: files.length,
  };
}

async function defaultCommandRunner(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function assertMatchingDirectories(expectedDirectory, actualDirectory, expectedFiles) {
  const actualFiles = await regularFiles(actualDirectory, 'Downloaded GitHub release directory');
  invariant(
    sameJson(actualFiles, expectedFiles),
    'Downloaded GitHub release asset inventory differs from the qualified publication.',
  );
  for (const file of expectedFiles) {
    const expected = await readFile(join(expectedDirectory, file));
    const actual = await readFile(join(actualDirectory, file));
    invariant(actual.equals(expected), `Downloaded GitHub release asset differs for ${file}.`);
  }
}

export async function verifyPublishedLocalRelease({
  commandRunner = defaultCommandRunner,
  publicationDirectory,
  repository,
  workDirectory,
}) {
  invariant(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),
    'GitHub repository must be an exact owner/name.',
  );
  invariant(
    (await readdir(workDirectory)).length === 0,
    `Post-publication work directory must be empty: ${workDirectory}`,
  );
  const inspection = await inspectLocalPublication({ publicationDirectory });
  const releaseVersion = inspection.release_version;
  const tag = `breakdown-local-v${releaseVersion}`;
  const manifest = parseJson(
    await readFile(
      join(publicationDirectory, `breakdown-publication-manifest-${releaseVersion}.json`),
    ),
    'Publication manifest',
  );
  const candidate = await readCandidate(publicationDirectory, { allowAdditionalFiles: true });
  const retainedTagEvidence = parseJson(
    await readFile(join(publicationDirectory, manifest.evidence.signed_tag.file)),
    'Retained signed tag evidence',
  );
  const publicationFiles = await regularFiles(publicationDirectory, 'Publication directory');
  const releaseAssetsDirectory = join(workDirectory, 'github-release-assets');
  const npmDownloadsDirectory = join(workDirectory, 'npm-tarballs');
  const signatureAuditDirectory = join(workDirectory, 'npm-signature-audit');
  await Promise.all([
    mkdir(releaseAssetsDirectory),
    mkdir(npmDownloadsDirectory),
    mkdir(signatureAuditDirectory),
  ]);

  const releaseView = parseJson(
    Buffer.from(
      (
        await commandRunner(
          'gh',
          [
            'release',
            'view',
            tag,
            '--repo',
            repository,
            '--json',
            'assets,isDraft,isImmutable,isPrerelease,tagName,url',
          ],
          {},
        )
      ).stdout,
    ),
    'Public GitHub release',
  );
  invariant(
    releaseView.tagName === tag &&
      releaseView.isDraft === false &&
      releaseView.isImmutable === true &&
      releaseView.isPrerelease === false &&
      exactString(releaseView.url),
    'GitHub release is not the exact published immutable stable release.',
  );
  const publicTagRef = parseJson(
    Buffer.from(
      (await commandRunner('gh', ['api', `repos/${repository}/git/ref/tags/${tag}`], {})).stdout,
    ),
    'Public GitHub tag ref',
  );
  invariant(
    publicTagRef.object?.type === 'tag' &&
      publicTagRef.object?.sha === retainedTagEvidence.tag_object_sha,
    'Public GitHub tag ref is not the retained signed annotated tag.',
  );
  const publicTagObject = parseJson(
    Buffer.from(
      (
        await commandRunner(
          'gh',
          ['api', `repos/${repository}/git/tags/${publicTagRef.object.sha}`],
          {},
        )
      ).stdout,
    ),
    'Public GitHub annotated tag',
  );
  const publicRuleset = parseJson(
    Buffer.from(
      (
        await commandRunner(
          'gh',
          ['api', `repos/${repository}/rulesets/${retainedTagEvidence.protection.ruleset_id}`],
          {},
        )
      ).stdout,
    ),
    'Public GitHub tag ruleset',
  );
  invariant(
    publicTagObject.tag === tag &&
      publicTagObject.sha === publicTagRef.object.sha &&
      sameJson(publicTagObject.object, retainedTagEvidence.target),
    'Public GitHub annotated tag does not target the retained candidate commit.',
  );
  validateTagEvidence(
    {
      schema_version: retainedTagEvidence.schema_version,
      repository: `https://github.com/${repository}`,
      tag,
      tag_object_sha: publicTagRef.object.sha,
      target: publicTagObject.object,
      message: publicTagObject.message,
      artifact_ids: retainedTagEvidence.artifact_ids,
      verification: publicTagObject.verification,
      protection: {
        ruleset_id: publicRuleset.id,
        name: publicRuleset.name,
        target: publicRuleset.target,
        enforcement: publicRuleset.enforcement,
        conditions: publicRuleset.conditions,
        rules: publicRuleset.rules,
        bypass_actors: publicRuleset.bypass_actors,
        current_user_can_bypass: publicRuleset.current_user_can_bypass,
      },
    },
    candidate,
  );
  const publicAssets = [...(releaseView.assets ?? [])];
  invariant(
    sameJson(publicAssets.map((asset) => asset.name).sort(), publicationFiles),
    'GitHub release inventory differs from the qualified publication.',
  );
  for (const asset of publicAssets) {
    invariant(
      asset.size === (await readFile(join(publicationDirectory, asset.name))).byteLength,
      `GitHub release byte count differs for ${asset.name}.`,
    );
  }
  await commandRunner(
    'gh',
    ['release', 'download', tag, '--repo', repository, '--dir', releaseAssetsDirectory],
    {},
  );
  await assertMatchingDirectories(publicationDirectory, releaseAssetsDirectory, publicationFiles);
  const hostIndexFile = manifest.evidence.host_support_index.file;
  const hostAttestationFile = manifest.artifacts.find(
    (artifact) => artifact.role === 'host-index-attestation',
  )?.file;
  invariant(
    releaseFilePattern.test(hostIndexFile ?? '') &&
      releaseFilePattern.test(hostAttestationFile ?? ''),
    'Publication has no exact host support index and attestation.',
  );
  await commandRunner(
    'gh',
    [
      'attestation',
      'verify',
      join(releaseAssetsDirectory, hostIndexFile),
      '--repo',
      repository,
      '--bundle',
      join(releaseAssetsDirectory, hostAttestationFile),
      '--signer-workflow',
      `${repository}/.github/workflows/local-host-support.yml`,
      '--source-ref',
      `refs/tags/${tag}`,
      '--source-digest',
      candidate.provenance.source.git_commit,
      '--deny-self-hosted-runners',
    ],
    {},
  );
  await commandRunner(
    'gh',
    ['release', 'verify', tag, '--repo', repository, '--format', 'json'],
    {},
  );
  for (const file of publicationFiles) {
    await commandRunner(
      'gh',
      [
        'release',
        'verify-asset',
        tag,
        join(releaseAssetsDirectory, file),
        '--repo',
        repository,
        '--format',
        'json',
      ],
      {},
    );
    await commandRunner(
      'gh',
      [
        'attestation',
        'verify',
        join(releaseAssetsDirectory, file),
        '--repo',
        repository,
        '--signer-workflow',
        `${repository}/.github/workflows/local-stable-publication.yml`,
        '--source-ref',
        `refs/tags/${tag}`,
        '--source-digest',
        candidate.provenance.source.git_commit,
        '--deny-self-hosted-runners',
      ],
      {},
    );
  }

  const dependencies = {};
  for (const entry of manifest.packages) {
    const packageSpecifier = `${entry.name}@${releaseVersion}`;
    const latest = parseJson(
      Buffer.from(
        (await commandRunner('npm', ['view', packageSpecifier, 'dist-tags.latest', '--json'], {}))
          .stdout,
      ),
      `npm latest channel for ${entry.name}`,
    );
    invariant(latest === releaseVersion, `npm latest does not select ${packageSpecifier}.`);
    const packResult = parseJson(
      Buffer.from(
        (
          await commandRunner(
            'npm',
            ['pack', packageSpecifier, '--pack-destination', npmDownloadsDirectory, '--json'],
            {},
          )
        ).stdout,
      ),
      `npm tarball response for ${entry.name}`,
    );
    invariant(
      Array.isArray(packResult) &&
        packResult.length === 1 &&
        releaseFilePattern.test(packResult[0]?.filename),
      `npm did not return one exact tarball for ${entry.name}.`,
    );
    const publishedBytes = await readFile(join(npmDownloadsDirectory, packResult[0].filename));
    const candidateBytes = await readFile(join(publicationDirectory, entry.artifact));
    invariant(
      publishedBytes.equals(candidateBytes),
      `Published npm tarball differs from the inspected candidate for ${entry.name}.`,
    );
    dependencies[entry.name] = releaseVersion;
  }
  await writeJson(join(signatureAuditDirectory, 'package.json'), {
    name: 'breakdown-local-publication-verification',
    version: '0.0.0',
    private: true,
    dependencies,
  });
  await commandRunner(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict', '--save-exact'],
    { cwd: signatureAuditDirectory },
  );
  const signatureAudit = parseJson(
    Buffer.from(
      (
        await commandRunner('npm', ['audit', 'signatures', '--json'], {
          cwd: signatureAuditDirectory,
        })
      ).stdout,
    ),
    'npm registry signature and provenance audit',
  );
  invariant(
    Array.isArray(signatureAudit.invalid) &&
      signatureAudit.invalid.length === 0 &&
      Array.isArray(signatureAudit.missing) &&
      signatureAudit.missing.length === 0,
    'npm registry signature or provenance audit reported invalid or missing evidence.',
  );

  return {
    schema_version: 'breakdown.post-publication-inspection.v1',
    release_version: releaseVersion,
    status: 'passed',
    candidate_digest: manifest.candidate.digest,
    tag,
    github: {
      immutable: true,
      release_url: releaseView.url,
      release_assets: publicAssets.length,
      verified_assets: publicationFiles.length,
      release_attestation: 'passed',
      asset_provenance_attestations: publicationFiles.length,
      signed_tag: {
        object_sha: publicTagRef.object.sha,
        target_commit: publicTagObject.object.sha,
        protection_ruleset_id: publicRuleset.id,
      },
    },
    npm: {
      dist_tag: 'latest',
      packages: manifest.packages.length,
      exact_tarballs: manifest.packages.length,
      signatures_and_provenance: 'passed',
    },
    host_support_policy: manifest.host_support_policy,
    supported_hosts: manifest.supported_hosts.length,
    license_scope: manifest.license_scope,
  };
}
