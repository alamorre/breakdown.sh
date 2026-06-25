#!/usr/bin/env node
/* eslint-disable no-console */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAINTAINER_ASSOCIATIONS = new Set(['COLLABORATOR', 'MEMBER', 'OWNER']);
const RELEASE_TEST_LABEL = 'release-test';
const RELEASE_TEST_COMMAND = /^\/release-test(?:\s+ref=([^\s]+))?\s*$/m;
const SAFE_REF = /^[A-Za-z0-9._/@:-]+$/;

function readJsonEnv(name, fallback = null) {
  const value = process.env[name];
  if (!value) return fallback;
  return JSON.parse(value);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseReleaseTestCommand(body) {
  const match = String(body ?? '').match(RELEASE_TEST_COMMAND);
  if (!match) {
    return null;
  }

  const ref = match[1] ?? null;
  if (ref && (!SAFE_REF.test(ref) || ref.startsWith('-'))) {
    throw new Error(`Unsupported release-test ref: ${ref}`);
  }

  return { ref };
}

function validateMaintainerAssociation(association, context) {
  if (!MAINTAINER_ASSOCIATIONS.has(association)) {
    throw new Error(
      `${context} must be requested by a maintainer. Received association: ${association}`,
    );
  }
}

function normalizePullRequest(pr) {
  if (!pr?.number || !pr?.head?.repo?.full_name || !pr?.head?.sha) {
    throw new Error('Pull request metadata is incomplete.');
  }

  return {
    number: pr.number,
    title: pr.title ?? '',
    headRepository: pr.head.repo.full_name,
    headRef: pr.head.ref ?? pr.head.sha,
    headSha: pr.head.sha,
    baseRef: pr.base?.ref ?? 'main',
  };
}

export function resolveReleaseTestRequest({
  eventName,
  event,
  pullRequest,
  actorPermission,
  allowedRepository,
}) {
  if (eventName === 'pull_request_target') {
    if (event.action !== 'labeled' || event.label?.name !== RELEASE_TEST_LABEL) {
      return { shouldRun: false, reason: 'Pull request was not labeled release-test.' };
    }

    if (actorPermission && !['admin', 'maintain', 'write'].includes(actorPermission)) {
      throw new Error(
        `release-test label requires write, maintain, or admin permission. Received: ${actorPermission}`,
      );
    }

    const pr = normalizePullRequest(event.pull_request);
    validateAllowedRepository(pr.headRepository, allowedRepository);
    return {
      shouldRun: true,
      trigger: 'label',
      requestedBy: event.sender?.login ?? '',
      explicitRef: null,
      testedRef: pr.headSha,
      checkoutRepository: pr.headRepository,
      checkoutRef: pr.headSha,
      pullRequest: pr,
    };
  }

  if (eventName === 'issue_comment') {
    if (!event.issue?.pull_request) {
      return { shouldRun: false, reason: 'Comment is not on a pull request.' };
    }

    const command = parseReleaseTestCommand(event.comment?.body);
    if (!command) {
      return { shouldRun: false, reason: 'Comment does not contain /release-test.' };
    }

    validateMaintainerAssociation(event.comment?.author_association, '/release-test');
    if (actorPermission && !['admin', 'maintain', 'write'].includes(actorPermission)) {
      throw new Error(
        `/release-test requires write, maintain, or admin permission. Received: ${actorPermission}`,
      );
    }

    const pr = normalizePullRequest(pullRequest);
    validateAllowedRepository(pr.headRepository, allowedRepository);
    const checkoutRef = command.ref ?? pr.headSha;
    return {
      shouldRun: true,
      trigger: 'comment',
      requestedBy: event.comment?.user?.login ?? '',
      explicitRef: command.ref,
      testedRef: checkoutRef,
      checkoutRepository: pr.headRepository,
      checkoutRef,
      pullRequest: pr,
    };
  }

  return { shouldRun: false, reason: `Unsupported event: ${eventName}` };
}

function validateAllowedRepository(headRepository, allowedRepository) {
  if (!allowedRepository || headRepository === allowedRepository) {
    return;
  }

  throw new Error(
    `Release tests with secrets must run from ${allowedRepository}. Received PR head repository: ${headRepository}`,
  );
}

function outputValue(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  const normalized = value == null ? '' : String(value);
  if (outputPath) {
    appendFileSync(outputPath, `${key}=${normalized}\n`);
    return;
  }

  console.log(`${key}=${normalized}`);
}

export async function main() {
  const eventPath = requireEnv('GITHUB_EVENT_PATH');
  const eventName = requireEnv('GITHUB_EVENT_NAME');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pullRequest = readJsonEnv('RELEASE_TEST_PULL_REQUEST');
  const actorPermission = process.env.RELEASE_TEST_ACTOR_PERMISSION ?? null;
  const allowedRepository = process.env.RELEASE_TEST_ALLOWED_REPOSITORY ?? null;
  const result = resolveReleaseTestRequest({
    eventName,
    event,
    pullRequest,
    actorPermission,
    allowedRepository,
  });

  outputValue('should_run', result.shouldRun ? 'true' : 'false');
  outputValue('skip_reason', result.reason ?? '');

  if (!result.shouldRun) {
    return;
  }

  outputValue('trigger', result.trigger);
  outputValue('requested_by', result.requestedBy);
  outputValue('pr_number', result.pullRequest.number);
  outputValue('pr_title', result.pullRequest.title);
  outputValue('head_repository', result.pullRequest.headRepository);
  outputValue('head_ref', result.pullRequest.headRef);
  outputValue('head_sha', result.pullRequest.headSha);
  outputValue('base_ref', result.pullRequest.baseRef);
  outputValue('explicit_ref', result.explicitRef ?? '');
  outputValue('tested_ref', result.testedRef);
  outputValue('checkout_repository', result.checkoutRepository);
  outputValue('checkout_ref', result.checkoutRef);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
