export const DATA_CONTRACT_TYPES = [
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
] as const;

export const DATA_CONTRACT_KEYWORD_KINDS = {
  type: 'type',
  enum: 'enum',
  const: 'any',
  title: 'string',
  description: 'string',
  properties: 'schemas',
  required: 'string-array',
  additionalProperties: 'schema',
  items: 'schema',
  minItems: 'non-negative-integer',
  maxItems: 'non-negative-integer',
  minLength: 'non-negative-integer',
  maxLength: 'non-negative-integer',
  minimum: 'number',
  maximum: 'number',
  exclusiveMinimum: 'number',
  exclusiveMaximum: 'number',
} as const;
