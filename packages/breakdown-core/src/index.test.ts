import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { operate } from './index.js';

const temporaryProjects: string[] = [];
const conformanceRoot = new URL(
  '../../../local/contracts/conformance/workflow-validation/',
  import.meta.url,
);

interface ConformanceRow {
  id: string;
  requirement: string;
  fixture: string;
  encoding?: 'base64';
  oracle:
    | {
        ok: true;
        effect?: {
          absent_path: string;
        };
      }
    | {
        ok: false;
        failure_kind: string;
        failure_code: string;
        diagnostics: Array<{ code: string; path: string }>;
      };
}

const conformanceMatrix = JSON.parse(
  await readFile(new URL('matrix.json', conformanceRoot), 'utf8'),
) as { rows: ConformanceRow[] };

async function createProject(workflow: string | Uint8Array) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-core-'));
  temporaryProjects.push(projectRoot);
  await writeFile(join(projectRoot, 'breakdown.yaml'), workflow, 'utf8');
  return projectRoot;
}

async function createEmptyProject() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-core-'));
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryProjects
      .splice(0)
      .map((projectRoot) => rm(projectRoot, { recursive: true, force: true })),
  );
});

describe('operate', () => {
  it('should validate a minimal Workflow Definition from an explicit project root', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: research
name: Research
nodes:
  - id: investigate
    name: Investigate
    prompt: Gather the relevant evidence.
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toEqual({
      ok: true,
      value: {
        definitionPath: 'breakdown.yaml',
        workflow: {
          schema_version: 'breakdown.workflow.v1',
          id: 'research',
          name: 'Research',
          nodes: [
            {
              id: 'investigate',
              name: 'Investigate',
              prompt: 'Gather the relevant evidence.',
            },
          ],
        },
      },
    });
  });

  it('should reject validation without an explicit project root', async () => {
    const result = await operate({ operation: 'validate_workflow' }, {});

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'project_root_required',
        message: 'An explicit project root is required.',
        diagnostics: [],
      },
    });
  });

  it('should return a structured I/O failure when breakdown.yaml is absent', async () => {
    const projectRoot = await createEmptyProject();

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'io',
        code: 'io_error',
        message: 'Could not read breakdown.yaml.',
        diagnostics: [],
      },
    });
  });

  it('should reject an unsupported dispatcher operation', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: research
name: Research
nodes:
  - id: investigate
    name: Investigate
    prompt: Gather the relevant evidence.
`);

    const result = await operate(
      { operation: 'not_validate_workflow' } as unknown as {
        operation: 'validate_workflow';
      },
      { projectRoot },
    );

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'unsupported',
        code: 'unsupported_operation',
        message: 'The requested operation is not supported.',
        diagnostics: [],
      },
    });
  });

  describe.each(conformanceMatrix.rows)('$id', (row) => {
    it(`should satisfy ${row.id}: ${row.requirement}`, async () => {
      const fixture = await readFile(new URL(row.fixture, conformanceRoot));
      let workflow: string | Uint8Array =
        row.encoding === 'base64'
          ? Buffer.from(fixture.toString('utf8').trim(), 'base64')
          : fixture;
      if (row.oracle.ok && row.oracle.effect !== undefined) {
        workflow = fixture.toString('utf8').replace('{{SENTINEL}}', row.oracle.effect.absent_path);
      }
      const projectRoot = await createProject(workflow);

      const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

      expect(result.ok).toBe(row.oracle.ok);
      if (!row.oracle.ok) {
        expect(result).toMatchObject({
          ok: false,
          failure: {
            kind: row.oracle.failure_kind,
            code: row.oracle.failure_code,
            diagnostics: row.oracle.diagnostics,
          },
        });
      } else if (row.oracle.effect !== undefined) {
        await expect(
          access(join(projectRoot, row.oracle.effect.absent_path)),
        ).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });
  });
});
