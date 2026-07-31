import { COPYFILE_EXCL } from 'node:constants';
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedSkills = [
  'author-breakdown',
  'critique-breakdown',
  'run-breakdown',
  'setup-breakdown',
  'summarize-breakdown-run',
];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function filesBelow(root, current = root) {
  const facts = lstatSync(current);
  if (facts.isSymbolicLink()) fail(`Candidate skill source contains a symbolic link: ${current}`);
  if (facts.isFile()) return [current];
  if (!facts.isDirectory()) fail(`Candidate skill source contains a special file: ${current}`);
  return readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => filesBelow(root, join(current, entry.name)));
}

const source = process.env.BREAKDOWN_QUALIFICATION_SKILL_SOURCE;
if (source === undefined || !source.startsWith('/')) {
  fail('BREAKDOWN_QUALIFICATION_SKILL_SOURCE must name the harness-selected absolute source.');
}
const sourceRoot = resolve(source);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
if (resolve('.') !== resolve(projectRoot)) {
  fail('The fixed candidate skill installer must run from the qualification project root.');
}
const destinationRoot = join(projectRoot, '.agents', 'skills');
const actualSkills = readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills)) {
  fail('Candidate skill source does not contain the exact canonical skill set.');
}

let copied = 0;
for (const skill of expectedSkills) {
  const skillSource = join(sourceRoot, skill);
  for (const sourcePath of filesBelow(skillSource)) {
    const path = relative(sourceRoot, sourcePath);
    if (basename(path).length === 0 || path.startsWith('..')) fail('Unsafe candidate skill path.');
    const destinationPath = join(destinationRoot, path);
    mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
    try {
      const existing = readFileSync(destinationPath);
      if (!existing.equals(readFileSync(sourcePath))) {
        fail(`Existing candidate skill byte mismatch: ${path}`);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      copyFileSync(sourcePath, destinationPath, COPYFILE_EXCL);
      copied += 1;
    }
  }
}

process.stdout.write(
  `${JSON.stringify({ schema_version: 'breakdown.qualification-skill-install.v1', copied, skills: expectedSkills })}\n`,
);
