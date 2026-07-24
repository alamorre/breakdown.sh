interface DecimalNumber {
  coefficient: bigint;
  scale: bigint;
}

interface RawNumberFacts {
  integer: boolean;
  nonNegative: boolean;
}

const json = JSON as typeof JSON & {
  isRawJSON(value: unknown): boolean;
  rawJSON(text: string): object;
};
const rawNumberFacts = new WeakMap<object, RawNumberFacts>();
const maximumExpandedIntegerDigits = 10_000n;

function parseDecimalNumber(source: string): DecimalNumber | undefined {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source);
  if (match === null) return undefined;

  const sign = match[1] === '-' ? -1n : 1n;
  const integerDigits = match[2] ?? '0';
  const fractionDigits = match[3] ?? match[4] ?? '';
  const exponent = BigInt(match[5] ?? '0');
  let coefficient = sign * BigInt(`${integerDigits}${fractionDigits}`);
  let scale = BigInt(fractionDigits.length) - exponent;

  if (coefficient === 0n) return { coefficient: 0n, scale: 0n };
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1n;
  }
  return { coefficient, scale };
}

function decimalNumbersEqual(left: DecimalNumber, right: DecimalNumber) {
  return left.coefficient === right.coefficient && left.scale === right.scale;
}

function canonicalJsonNumber(value: DecimalNumber) {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString();
  const exponent = BigInt(digits.length) - value.scale - 1n;
  const significand = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
  return `${negative ? '-' : ''}${significand}${exponent === 0n ? '' : `e${exponent}`}`;
}

function expandedInteger(value: DecimalNumber) {
  if (value.scale > 0n) return undefined;

  const coefficientDigits = (
    value.coefficient < 0n ? -value.coefficient : value.coefficient
  ).toString().length;
  if (BigInt(coefficientDigits) - value.scale > maximumExpandedIntegerDigits) {
    return undefined;
  }
  return value.coefficient * 10n ** -value.scale;
}

export function preserveYamlJsonNumber(source: string, parsed: number | bigint) {
  if (typeof parsed === 'bigint') return parsed;

  const exact = parseDecimalNumber(source);
  if (exact === undefined) return undefined;

  if (Number.isFinite(parsed)) {
    const parsedDecimal = parseDecimalNumber(String(parsed));
    if (parsedDecimal !== undefined && decimalNumbersEqual(exact, parsedDecimal)) {
      return parsed;
    }
  }

  const integer = expandedInteger(exact);
  if (integer !== undefined) return integer;

  const raw = json.rawJSON(canonicalJsonNumber(exact));
  rawNumberFacts.set(raw, {
    integer: exact.scale <= 0n,
    nonNegative: exact.coefficient >= 0n,
  });
  return raw;
}

export function isRawJsonNumber(value: unknown): value is object {
  return json.isRawJSON(value);
}

export function isNonNegativeRawJsonInteger(value: unknown) {
  return isRawJsonNumber(value) && rawNumberFacts.get(value)?.integer === true
    ? rawNumberFacts.get(value)?.nonNegative === true
    : false;
}
