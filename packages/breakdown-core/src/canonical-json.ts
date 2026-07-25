import { isRawJsonNumber } from './exact-json-number.js';
import { isUnicodeScalarString } from './unicode.js';

export interface CanonicalJsonDomainIssue {
  code: 'invalid_unicode' | 'number_out_of_range';
  path: Array<string | number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !isRawJsonNumber(value)
  );
}

function binary64Value(value: bigint | object) {
  return Number(typeof value === 'bigint' ? value : JSON.stringify(value));
}

function analyzeCanonicalJson(
  value: unknown,
  path: Array<string | number>,
  issues: CanonicalJsonDomainIssue[],
): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (!isUnicodeScalarString(value)) {
      issues.push({ code: 'invalid_unicode', path });
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      issues.push({ code: 'number_out_of_range', path });
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint' || isRawJsonNumber(value)) {
    const number = binary64Value(value);
    if (!Number.isFinite(number)) {
      issues.push({ code: 'number_out_of_range', path });
    }
    return JSON.stringify(number);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item, index) => analyzeCanonicalJson(item, [...path, index], issues))
      .join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        const itemPath = [...path, key];
        if (!isUnicodeScalarString(key)) {
          issues.push({ code: 'invalid_unicode', path: itemPath });
        }
        return `${JSON.stringify(key)}:${analyzeCanonicalJson(value[key], itemPath, issues)}`;
      })
      .join(',')}}`;
  }
  throw new Error('Canonical JSON cannot encode this value.');
}

export function canonicalJsonDomainIssues(value: unknown) {
  const issues: CanonicalJsonDomainIssue[] = [];
  analyzeCanonicalJson(value, [], issues);
  return issues;
}

export function canonicalizeJson(value: unknown) {
  const issues: CanonicalJsonDomainIssue[] = [];
  const canonical = analyzeCanonicalJson(value, [], issues);
  if (issues.length > 0) {
    throw new Error('Canonical JSON requires valid Unicode and finite IEEE-754 binary64 numbers.');
  }
  return canonical;
}
