export const V1_RELEASE_RECOVERY_POLICY = Object.freeze({
  authorizationArtifact: Object.freeze({
    digest: 'sha256:258888039646987261171c72e751646280bffafe18760893b32bd970b5ec4e4a',
    id: '9415223409',
    name: 'breakdown-release-authorization-32391936576',
  }),
  authorizationSha256: '2176405c1210221b6d1d13f026a7b5f678f8fb36b2437c9d216e117218788247',
  candidateArtifact: Object.freeze({
    digest: 'sha256:133ef1cec0bbe7aa02482cfd8e9e5a793895f127ee0ba0959d9d76306266d8a3',
    id: '9413780200',
    name: 'breakdown-local-candidate',
  }),
  candidateDigest: '373bc7135e2bd43eef872a97903c68e426b4f5597b76857040a491bbec530ca0',
  candidateChecksumInventorySha256:
    '7c46f715ebfd0a1ee413b31fce174e61b4805bb6cd54fc04a05908fc2d09ed44',
  ceremonyRunId: '32391936576',
  ceremonyWorkflowId: 338665094,
  confirmation: 'CONTINUE EXACT BREAKDOWN LOCAL 1.0.0 FROM CEREMONY 32391936576 WITHOUT RETAGGING',
  hostSupportArtifact: Object.freeze({
    digest: 'sha256:a29b6fb317ce1b94be4e704113dced212e2680e4f06538fcec55b8d1d85928da',
    id: '9420331832',
    name: 'breakdown-host-support',
    runId: '32406103756',
  }),
  hostSupportWorkflowId: 323419478,
  planArtifact: Object.freeze({
    digest: 'sha256:c234692cd6b602e8ae58860419ea16cb51ad0142bf1d6495a07b89ff7eb9b605',
    id: '9415176744',
    name: 'breakdown-release-ceremony-plan-32391936576',
  }),
  planSha256: '9567580b29ef3709552be88d358631d6d71a2caffb92db6bee39960a8eeb7d7e',
  platformArtifact: Object.freeze({
    digest: 'sha256:438f4a603af5ad896ee711aadac55a2a9f3a5f8157f482d086caaca31bc1d16d',
    id: '9413912347',
    name: 'breakdown-platform-evidence-index',
  }),
  qualificationRunId: '32388197461',
  sourceSha: '723e296c5a0ab5431a02022830adff8bcf0dd818',
  stablePublication: Object.freeze({
    dispatch: Object.freeze({
      inputs: Object.freeze({
        authorization_artifact_id: '9415223409',
        candidate_artifact_id: '9413780200',
        ceremony_run_id: '32391936576',
        host_support_artifact_id: '9420331832',
        npm_bootstrap_artifact_id: '',
        npm_bootstrap_confirmation:
          'CREATE EXACT @breakdown-sh/core @breakdown-sh/cli @breakdown-sh/mcp 1.0.0',
        npm_publication_mode: 'first-package-bootstrap',
        npm_trusted_publishing_artifact_id: '',
        platform_index_artifact_id: '9413912347',
      }),
      ref: 'breakdown-local-v1.0.0',
    }),
    npmPackages: Object.freeze(['@breakdown-sh/core', '@breakdown-sh/cli', '@breakdown-sh/mcp']),
    title: 'Breakdown Local stable publication for ceremony 32391936576',
    workflowId: 323419480,
    workflowPath: '.github/workflows/local-stable-publication.yml',
  }),
  tag: 'breakdown-local-v1.0.0',
  tagObjectSha: '222766090da2ad070e8b45619d8f0f844829144f',
});
