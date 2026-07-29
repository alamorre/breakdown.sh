import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('hex');
}

export async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return nested.flat().sort();
}
