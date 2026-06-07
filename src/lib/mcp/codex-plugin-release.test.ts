import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'fs';
import path from 'path';

const repoRoot = process.cwd();
const pluginRoot = path.join(repoRoot, 'plugins/breakdown');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function readText(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectPng(relativePath: string) {
  const absolutePath = path.join(pluginRoot, relativePath);
  const signature = readFileSync(absolutePath).subarray(0, 8);

  expect(statSync(absolutePath).size).toBeGreaterThan(1000);
  expect([...signature]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  skills: string;
  mcpServers: string;
  interface: {
    displayName: string;
    category: string;
    capabilities: string[];
    composerIcon: string;
    logo: string;
    screenshots: string[];
    defaultPrompt: string[];
  };
}

interface McpManifest {
  mcpServers: {
    breakdown: {
      type: string;
      url: string;
      headers: {
        Authorization: string;
      };
    };
  };
}

interface Marketplace {
  plugins: Array<{
    name: string;
    source: {
      source: string;
      path: string;
    };
    policy: {
      installation: string;
      authentication: string;
    };
    category: string;
  }>;
}

describe('Breakdown Codex plugin release package', () => {
  it('ships public release metadata and assets', () => {
    const manifest = readJson<PluginManifest>('plugins/breakdown/.codex-plugin/plugin.json');

    expect(manifest.name).toBe('breakdown');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.description).toContain('hosted breakdown.sh reasoning graphs');
    expect(manifest.keywords).toEqual(expect.arrayContaining(['codex', 'external-evaluator']));
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.mcpServers).toBe('./.mcp.json');
    expect(manifest.interface.displayName).toBe('Breakdown');
    expect(manifest.interface.category).toBe('Productivity');
    expect(manifest.interface.capabilities).toEqual(
      expect.arrayContaining(['MCP', 'Resources', 'Workflow', 'Write']),
    );
    expect(manifest.interface.defaultPrompt).toHaveLength(3);

    expectPng(manifest.interface.composerIcon);
    expectPng(manifest.interface.logo);
    expect(manifest.interface.screenshots).toHaveLength(3);
    for (const screenshot of manifest.interface.screenshots) {
      expect(screenshot).toMatch(/^\.\/assets\/.+\.png$/);
      expectPng(screenshot);
    }
  });

  it('keeps the marketplace entry installable from the repo marketplace', () => {
    const marketplace = readJson<Marketplace>('.agents/plugins/marketplace.json');
    const plugin = marketplace.plugins.find((entry) => entry.name === 'breakdown');

    expect(plugin).toBeTruthy();
    expect(plugin?.source).toEqual({ source: 'local', path: './plugins/breakdown' });
    expect(plugin?.policy).toEqual({
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    });
    expect(plugin?.category).toBe('Productivity');
  });

  it('points the committed MCP config at hosted Breakdown with token env substitution', () => {
    const mcp = readJson<McpManifest>('plugins/breakdown/.mcp.json');

    expect(mcp.mcpServers.breakdown.type).toBe('http');
    expect(mcp.mcpServers.breakdown.url).toBe('https://www.breakdown.sh/api/mcp');
    expect(mcp.mcpServers.breakdown.headers.Authorization).toBe('Bearer ${BREAKDOWN_API_TOKEN}');
  });

  it('documents public install, bearer-token onboarding, revocation, and local overrides', () => {
    const docs = readText('docs/codex-plugin.md');
    const page = readText('src/app/docs/codex-plugin/page.tsx');
    const combined = `${docs}\n${page}`;

    expect(combined).toContain('codex plugin marketplace add alamorre/breakdown.sh');
    expect(combined).toContain('codex plugin add breakdown@breakdown');
    expect(combined).toContain('BREAKDOWN_API_TOKEN');
    expect(combined).toContain('~/.codex/config.toml');
    expect(combined).toContain('~/Library/LaunchAgents/sh.breakdown.codex-env.plist');
    expect(combined).toContain('~/.config/environment.d/breakdown-codex.conf');
    expect(combined).toContain('HKEY_CURRENT_USER\\Environment');
    expect(combined).toContain('OAuth connector registration can be added later');
    expect(combined).toContain('Revoke plugin tokens from Settings under MCP Access');
    expect(combined).toContain('do not edit and commit');
    expect(combined).toContain('http://localhost:3000/api/mcp');
    expect(combined).not.toContain('public plugin path is not yet shipped');
    expect(combined).not.toContain('future public plugin path');
  });
});
