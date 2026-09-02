import { execFile } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, realpath, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function validate(project) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        join(repoRoot, 'packages', 'breakdown-cli', 'dist', 'index.js'),
        'workflow',
        'validate',
        '--project',
        project,
        '--json',
      ],
      { cwd: repoRoot },
    );
    return `EXIT 0: ${stdout.trim()}`;
  } catch (error) {
    return `EXIT ${error.code}: ${(error.stdout ?? '').trim()}`;
  }
}

async function describe(label, dir) {
  const facts = await lstat(dir, { bigint: true });
  const fsFacts = await statfs(dir, { bigint: true });
  console.log(`--- ${label} ---`);
  console.log(`path=${dir}`);
  console.log(`realpath=${await realpath(dir)}`);
  console.log(
    `dev=${facts.dev} ino=${facts.ino} nlink=${facts.nlink} birthtimeNs=${facts.birthtimeNs} isDirectory=${facts.isDirectory()}`,
  );
  console.log(`statfsType=0x${fsFacts.type.toString(16)}`);
}

console.log(`os.tmpdir()=${tmpdir()}`);
console.log(`TMPDIR=${process.env.TMPDIR ?? '(unset)'}`);
console.log(`RUNNER_TEMP=${process.env.RUNNER_TEMP ?? '(unset)'}`);
console.log(`realpath(/tmp)=${await realpath('/tmp')}`);

const mounts = (await readFile('/proc/self/mountinfo', 'utf8')).split('\n').filter(Boolean);
console.log('--- mountinfo lines mentioning tmp, cache, or namespace ---');
for (const line of mounts) {
  if (/tmp|cache|nsc|namespace/i.test(line)) console.log(line);
}

const example = join(repoRoot, 'local', 'skills', 'author-breakdown', 'assets', 'minimal.yaml');

const tmpProject = await mkdtemp(join(tmpdir(), 'breakdown-debug-'));
await cp(example, join(tmpProject, 'breakdown.yaml'));
await describe('tmp project', tmpProject);
await describe('tmp project file', join(tmpProject, 'breakdown.yaml'));
console.log(`validate(tmpProject)=${await validate(tmpProject)}`);

const repoProject = await mkdtemp(join(repoRoot, 'debug-proj-'));
await cp(example, join(repoProject, 'breakdown.yaml'));
await describe('repo project', repoProject);
console.log(`validate(repoProject)=${await validate(repoProject)}`);

await rm(tmpProject, { recursive: true, force: true });
await rm(repoProject, { recursive: true, force: true });
console.log('debug done');
