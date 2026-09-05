import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

function prose(source) {
  return source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
}

function headingIds(source) {
  const counts = new Map();
  const ids = new Set();
  for (const match of prose(source).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    ids.add(count === 0 ? slug : `${slug}-${count}`);
  }
  for (const match of source.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) ids.add(match[1]);
  return ids;
}

// Repository Markdown uses inline links and reference definitions. External links are not fetched.
export async function checkDocLinks(files) {
  const failures = [];
  for (const file of files) {
    const source = prose(await readFile(file, 'utf8'));
    const targets = [
      ...Array.from(source.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g), (match) => match[1]),
      ...Array.from(source.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm), (match) => match[1]),
    ];
    for (const target of targets) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
      const [path, fragment] = target.split('#');
      const destination = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      try {
        await access(destination);
        if (fragment && destination.endsWith('.md')) {
          const ids = headingIds(await readFile(destination, 'utf8'));
          if (!ids.has(decodeURIComponent(fragment))) throw new Error('missing heading');
        }
      } catch {
        failures.push(`${file}: ${target}`);
      }
    }
  }
  return failures;
}

export async function checkRepositoryDocLinks(repositoryRoot) {
  const files = ['README.md', 'CONTRIBUTING.md', 'AGENTS.md'].map((path) =>
    join(repositoryRoot, path),
  );
  // Vendored bytes and provenance remain untouched; generated/versioned Local docs are included.
  for (const directory of [
    'docs',
    'local/docs',
    'local/contracts',
    'local/skills',
    'scripts/local-release',
  ]) {
    files.push(...(await markdownFiles(join(repositoryRoot, directory))));
  }
  const failures = await checkDocLinks(files);
  if (failures.length) {
    throw new Error(
      `Broken internal documentation links:\n${failures.map((path) => relative(repositoryRoot, path)).join('\n')}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await checkRepositoryDocLinks(resolve(import.meta.dirname, '..'));
}
