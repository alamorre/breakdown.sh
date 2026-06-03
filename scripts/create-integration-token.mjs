#!/usr/bin/env node
/* eslint-disable no-console */

import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ALL_SCOPES = [
  'graphs:read',
  'graphs:write',
  'runs:execute',
  'runs:external_execute',
  'runs:write_results',
  'runs:cancel',
];

function readArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const userId = readArg('user-id');
const name = readArg('name') ?? 'Local MCP';
const scopes = (readArg('scopes') ?? ALL_SCOPES.join(','))
  .split(',')
  .map((scope) => scope.trim())
  .filter(Boolean);

if (!userId) {
  console.error(
    'Usage: pnpm headless:token -- --user-id user_123 [--name "Local MCP"] [--scopes graphs:read,graphs:write]',
  );
  process.exit(1);
}

const invalidScopes = scopes.filter((scope) => !ALL_SCOPES.includes(scope));
if (invalidScopes.length > 0) {
  console.error(`Invalid scopes: ${invalidScopes.join(', ')}`);
  console.error(`Allowed scopes: ${ALL_SCOPES.join(', ')}`);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const prefix = randomBytes(6).toString('base64url');
const secret = randomBytes(32).toString('base64url');
const token = `bdk_${prefix}_${secret}`;
const tokenPrefix = `bdk_${prefix}`;

const supabase = createClient(supabaseUrl, serviceRoleKey);
const { data, error } = await supabase
  .from('integration_tokens')
  .insert({
    user_id: userId,
    name,
    token_hash: hashToken(token),
    token_prefix: tokenPrefix,
    scopes,
  })
  .select('id,user_id,name,token_prefix,scopes,created_at')
  .single();

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(JSON.stringify({ token, record: data }, null, 2));
