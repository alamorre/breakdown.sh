import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function normalizeTitle(title) {
  const normalized = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  return (normalized || 'Untitled PR').slice(0, 140);
}

function slugifyTitle(title) {
  const slug = normalizeTitle(title)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'preview';
}

function normalizeDnsLabel(value) {
  const label = slugifyTitle(value);
  return label.slice(0, 63).replace(/-+$/g, '') || 'preview';
}

function normalizeBaseDomain(value) {
  const domain = String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/g, '')
    .replace(/^\*\./g, '')
    .replace(/\.$/g, '')
    .toLowerCase();

  if (!domain) {
    throw new Error('PREVIEW_BASE_DOMAIN is required');
  }

  const labels = domain.split('.');
  const isValid = labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!isValid) {
    throw new Error(`PREVIEW_BASE_DOMAIN is not a valid DNS domain: ${value}`);
  }

  return domain;
}

function buildPreviewLabel({ prefix, prNumber, title }) {
  const safePrefix = normalizeDnsLabel(prefix || 'thesis-pr');
  const safePrNumber = String(prNumber).replace(/[^0-9]/g, '');

  if (!safePrNumber) {
    throw new Error('A numeric PR number is required');
  }

  const base = `${safePrefix}-${safePrNumber}`;
  const maxSlugLength = 63 - base.length - 1;
  if (maxSlugLength < 1) {
    throw new Error(`Preview label prefix is too long: ${safePrefix}`);
  }

  const titleSlug = slugifyTitle(title).slice(0, maxSlugLength).replace(/-+$/g, '');
  return `${base}-${titleSlug || 'preview'}`;
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is required');
  }

  return JSON.parse(fs.readFileSync(eventPath, 'utf8'));
}

function writeOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  const output = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  if (outputPath) {
    fs.appendFileSync(outputPath, `${output}\n`);
    return;
  }

  process.stdout.write(`${output}\n`);
}

function main() {
  const event = readEvent();
  const pr = event.pull_request;
  if (!pr) {
    throw new Error('This script must run for a pull_request event');
  }

  const baseDomain = normalizeBaseDomain(process.env.PREVIEW_BASE_DOMAIN);
  const label = buildPreviewLabel({
    prefix: process.env.PREVIEW_DOMAIN_PREFIX || 'thesis-pr',
    prNumber: pr.number,
    title: pr.title,
  });
  const host = `${label}.${baseDomain}`;

  writeOutputs({
    preview_label: label,
    preview_host: host,
    preview_url: `https://${host}`,
    safe_pr_title: normalizeTitle(pr.title),
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export {
  buildPreviewLabel,
  normalizeBaseDomain,
  normalizeTitle,
  slugifyTitle,
};
