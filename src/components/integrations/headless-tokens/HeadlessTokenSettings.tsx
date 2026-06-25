'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Pencil,
  PlugZap,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ALL_BREAKDOWN_SCOPES,
  RELEASE_TEST_SCOPES,
  type BreakdownScope,
} from '@/lib/breakdown-service/scopes';
import type { IntegrationTokenPurpose } from '@/lib/breakdown-service/tokens';

type HeadlessToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: BreakdownScope[];
  purpose: IntegrationTokenPurpose;
  createdByUserId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
};

type HeadlessTokensResponse = {
  configured: boolean;
  scopes: BreakdownScope[];
  tokens: HeadlessToken[];
  error?: string;
};

type CreatedTokenResponse = {
  token: string;
  record: HeadlessToken;
  error?: string;
};

type RotatedTokenResponse = CreatedTokenResponse & {
  rotatedTokenId: string;
};

type UpdatedTokenResponse = {
  token: HeadlessToken;
  error?: string;
};

type ClientPresetId = 'codex' | 'claude' | 'cursor' | 'openai' | 'other';

type ClientPreset = {
  id: ClientPresetId;
  label: string;
  provider: string;
  defaultName: string;
  defaultScopes: BreakdownScope[];
  icon: ComponentType<{ className?: string }>;
};

type CreatedCredential = {
  token: string;
  record: HeadlessToken;
  clientId: ClientPresetId;
  rotatedTokenId?: string;
};

const MCP_ENDPOINT = 'https://www.breakdown.sh/api/mcp';
const TOKEN_ENV_VAR = 'BREAKDOWN_API_TOKEN';

const SCOPE_LABELS: Record<BreakdownScope, string> = {
  'graphs:read': 'Read graphs',
  'graphs:write': 'Edit graphs',
  'runs:execute': 'Run graphs',
  'runs:external_execute': 'External runs',
  'runs:write_results': 'Write results',
  'runs:cancel': 'Cancel runs',
};

const PURPOSE_LABELS: Record<IntegrationTokenPurpose, string> = {
  mcp_client: 'Client connection',
  release_test: 'Release test',
};

const CLIENT_PRESETS: ClientPreset[] = [
  {
    id: 'codex',
    label: 'Codex',
    provider: 'OpenAI',
    defaultName: 'Codex Desktop',
    defaultScopes: RELEASE_TEST_SCOPES,
    icon: Terminal,
  },
  {
    id: 'claude',
    label: 'Claude',
    provider: 'Anthropic',
    defaultName: 'Claude Desktop',
    defaultScopes: ALL_BREAKDOWN_SCOPES,
    icon: Bot,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    provider: 'Cursor',
    defaultName: 'Cursor',
    defaultScopes: ALL_BREAKDOWN_SCOPES,
    icon: Code2,
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    provider: 'Responses API',
    defaultName: 'OpenAI API',
    defaultScopes: RELEASE_TEST_SCOPES,
    icon: PlugZap,
  },
  {
    id: 'other',
    label: 'Other',
    provider: 'MCP client',
    defaultName: 'MCP client',
    defaultScopes: ALL_BREAKDOWN_SCOPES,
    icon: Server,
  },
];

const CLIENT_PRESET_BY_ID = Object.fromEntries(
  CLIENT_PRESETS.map((preset) => [preset.id, preset]),
) as Record<ClientPresetId, ClientPreset>;

async function readTokens(): Promise<HeadlessTokensResponse> {
  const response = await fetch('/api/integrations/headless-tokens');
  const data = (await response.json().catch(() => null)) as HeadlessTokensResponse | null;

  if (!response.ok || !data) {
    throw new Error(data?.error ?? 'Failed to load MCP connections');
  }

  return data;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function formatScopes(scopes: BreakdownScope[]) {
  if (scopes.length === ALL_BREAKDOWN_SCOPES.length) {
    return 'Full MCP access';
  }

  return scopes.map((scope) => SCOPE_LABELS[scope]).join(', ');
}

function tokenAuthHeader(token?: string | null) {
  return `Authorization: Bearer ${token ?? '<bdk_token>'}`;
}

function tokenUrl(token?: string | null) {
  return token
    ? `${MCP_ENDPOINT}?access_token=${encodeURIComponent(token)}`
    : `${MCP_ENDPOINT}?access_token=<bdk_token>`;
}

function scopeDefaultsForPreset(preset: ClientPreset, availableScopes: BreakdownScope[]) {
  const scopes = preset.defaultScopes.filter((scope) => availableScopes.includes(scope));
  return scopes.length > 0 ? scopes : availableScopes;
}

function setupSnippetForClient(presetId: ClientPresetId) {
  switch (presetId) {
    case 'codex':
      return `[mcp_servers.breakdown]
url = "${MCP_ENDPOINT}"
bearer_token_env_var = "${TOKEN_ENV_VAR}"`;
    case 'claude':
      return `{
  "mcpServers": {
    "breakdown": {
      "type": "http",
      "url": "${MCP_ENDPOINT}",
      "headers": {
        "Authorization": "Bearer \${${TOKEN_ENV_VAR}}"
      }
    }
  }
}`;
    case 'cursor':
      return `{
  "mcpServers": {
    "breakdown": {
      "url": "${MCP_ENDPOINT}",
      "headers": {
        "Authorization": "Bearer \${${TOKEN_ENV_VAR}}"
      }
    }
  }
}`;
    case 'openai':
      return `import OpenAI from "openai";

const client = new OpenAI();

await client.responses.create({
  model: "gpt-5.5",
  tools: [{
    type: "mcp",
    server_label: "breakdown",
    server_url: "${MCP_ENDPOINT}",
    authorization: process.env.${TOKEN_ENV_VAR},
    require_approval: "always"
  }],
  input: "Use Breakdown."
});`;
    case 'other':
      return `Endpoint: ${MCP_ENDPOINT}
Header: ${tokenAuthHeader()}`;
  }
}

function markActivePurposeRevoked(
  tokens: HeadlessToken[],
  purpose: IntegrationTokenPurpose,
  revokedAt: string,
) {
  return tokens.map((token) =>
    token.purpose === purpose && !token.revokedAt ? { ...token, revokedAt } : token,
  );
}

function CopyBlock({
  title,
  value,
  onCopy,
  warning,
}: {
  title: string;
  value: string;
  onCopy: (value: string, label: string) => void;
  warning?: string;
}) {
  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {warning ? (
            <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-300" />
          ) : (
            <Copy className="size-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onCopy(value, title)}>
          <Copy className="size-3.5" />
          Copy
        </Button>
      </div>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-muted-foreground">
        {value}
      </pre>
      {warning && (
        <p className="border-t px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
          {warning}
        </p>
      )}
    </div>
  );
}

export function HeadlessTokenSettings() {
  const [configured, setConfigured] = useState(true);
  const [availableScopes, setAvailableScopes] = useState<BreakdownScope[]>(ALL_BREAKDOWN_SCOPES);
  const [selectedClientId, setSelectedClientId] = useState<ClientPresetId>('codex');
  const [selectedScopes, setSelectedScopes] = useState<BreakdownScope[]>(
    CLIENT_PRESET_BY_ID.codex.defaultScopes,
  );
  const [tokens, setTokens] = useState<HeadlessToken[]>([]);
  const [name, setName] = useState(CLIENT_PRESET_BY_ID.codex.defaultName);
  const [createdCredential, setCreatedCredential] = useState<CreatedCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [rotatingReleaseTest, setRotatingReleaseTest] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmToken, setDeleteConfirmToken] = useState<HeadlessToken | null>(null);

  const selectedClient = CLIENT_PRESET_BY_ID[selectedClientId];
  const activeTokens = useMemo(() => tokens.filter((token) => !token.revokedAt), [tokens]);
  const clientConnections = useMemo(
    () => tokens.filter((token) => token.purpose === 'mcp_client'),
    [tokens],
  );
  const activeClientConnections = useMemo(
    () => clientConnections.filter((token) => !token.revokedAt),
    [clientConnections],
  );
  const activeReleaseTestToken = useMemo(
    () => activeTokens.find((token) => token.purpose === 'release_test') ?? null,
    [activeTokens],
  );

  const refreshTokens = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readTokens();
      const scopes = result.scopes.length > 0 ? result.scopes : ALL_BREAKDOWN_SCOPES;
      setConfigured(result.configured);
      setAvailableScopes(scopes);
      setSelectedScopes((current) => current.filter((scope) => scopes.includes(scope)));
      setTokens(result.tokens);
      if (result.error) {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load MCP connections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTokens();
  }, [refreshTokens]);

  const handleCopy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  }, []);

  const handleSelectClient = (clientId: ClientPresetId) => {
    const preset = CLIENT_PRESET_BY_ID[clientId];
    setSelectedClientId(clientId);
    setName(preset.defaultName);
    setSelectedScopes(scopeDefaultsForPreset(preset, availableScopes));
  };

  const toggleScope = (scope: BreakdownScope) => {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((selectedScope) => selectedScope !== scope)
        : [...current, scope],
    );
  };

  const createToken = async (input: {
    tokenName: string;
    scopes: BreakdownScope[];
    purpose: IntegrationTokenPurpose;
  }) => {
    const response = await fetch('/api/integrations/headless-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.tokenName,
        scopes: input.scopes,
        purpose: input.purpose,
      }),
    });
    const result = (await response.json().catch(() => null)) as CreatedTokenResponse | null;

    if (!response.ok || !result) {
      throw new Error(result?.error ?? 'Failed to create MCP connection');
    }

    return result;
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      toast.error('Name this connection first');
      return;
    }

    if (selectedScopes.length === 0) {
      toast.error('Select at least one scope');
      return;
    }

    setCreating(true);
    setCreatedCredential(null);
    try {
      const result = await createToken({
        tokenName: trimmedName,
        scopes: selectedScopes,
        purpose: 'mcp_client',
      });

      setCreatedCredential({
        token: result.token,
        record: result.record,
        clientId: selectedClientId,
      });
      setTokens((current) => [result.record, ...current]);
      toast.success('MCP client connection created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create MCP connection');
    } finally {
      setCreating(false);
    }
  };

  const handleRotateToken = async (token: HeadlessToken) => {
    setRotatingId(token.id);
    setCreatedCredential(null);
    try {
      const response = await fetch(`/api/integrations/headless-tokens/${token.id}/rotate`, {
        method: 'POST',
      });
      const result = (await response.json().catch(() => null)) as RotatedTokenResponse | null;
      if (!response.ok || !result?.record || !result.token) {
        throw new Error(result?.error ?? 'Failed to rotate MCP connection');
      }

      const revokedAt = new Date().toISOString();
      setCreatedCredential({
        token: result.token,
        record: result.record,
        clientId: selectedClientId,
        rotatedTokenId: result.rotatedTokenId,
      });
      setTokens((current) => [
        result.record,
        ...current.map((currentToken) =>
          currentToken.id === result.rotatedTokenId
            ? { ...currentToken, revokedAt: currentToken.revokedAt ?? revokedAt }
            : currentToken,
        ),
      ]);
      toast.success('MCP client connection rotated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rotate MCP connection');
    } finally {
      setRotatingId(null);
    }
  };

  const handleRotateReleaseTest = async () => {
    setRotatingReleaseTest(true);
    setCreatedCredential(null);
    try {
      const result = await createToken({
        tokenName: 'Release test token',
        scopes: RELEASE_TEST_SCOPES,
        purpose: 'release_test',
      });
      const revokedAt = new Date().toISOString();

      setCreatedCredential({ token: result.token, record: result.record, clientId: 'codex' });
      setTokens((current) => [
        result.record,
        ...markActivePurposeRevoked(current, 'release_test', revokedAt),
      ]);
      toast.success(
        activeReleaseTestToken ? 'Release-test token rotated' : 'Release-test token created',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rotate release-test token');
    } finally {
      setRotatingReleaseTest(false);
    }
  };

  const handleStartRename = (token: HeadlessToken) => {
    setEditingTokenId(token.id);
    setEditingName(token.name);
  };

  const handleCancelRename = () => {
    setEditingTokenId(null);
    setEditingName('');
  };

  const handleRename = async (event: FormEvent<HTMLFormElement>, tokenId: string) => {
    event.preventDefault();

    const trimmedName = editingName.trim();
    if (!trimmedName) {
      toast.error('Name this connection first');
      return;
    }

    const currentToken = tokens.find((token) => token.id === tokenId);
    if (currentToken?.name === trimmedName) {
      handleCancelRename();
      return;
    }

    setRenamingId(tokenId);
    try {
      const response = await fetch(`/api/integrations/headless-tokens/${tokenId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });
      const result = (await response.json().catch(() => null)) as UpdatedTokenResponse | null;
      if (!response.ok || !result?.token) {
        throw new Error(result?.error ?? 'Failed to rename MCP connection');
      }

      setTokens((current) => current.map((token) => (token.id === tokenId ? result.token : token)));
      handleCancelRename();
      toast.success('MCP connection renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename MCP connection');
    } finally {
      setRenamingId(null);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    setRevokingId(tokenId);
    try {
      const response = await fetch(`/api/integrations/headless-tokens/${tokenId}`, {
        method: 'DELETE',
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? 'Failed to revoke MCP connection');
      }

      setTokens((current) =>
        current.map((token) =>
          token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      );
      toast.success('MCP connection revoked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke MCP connection');
    } finally {
      setRevokingId(null);
    }
  };

  const handlePermanentDelete = async () => {
    if (!deleteConfirmToken) return;

    const tokenId = deleteConfirmToken.id;
    setDeletingId(tokenId);
    try {
      const response = await fetch(`/api/integrations/headless-tokens/${tokenId}/hard-delete`, {
        method: 'DELETE',
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? 'Failed to permanently delete MCP connection');
      }

      setTokens((current) => current.filter((token) => token.id !== tokenId));
      setDeleteConfirmToken(null);
      toast.success('MCP connection permanently deleted');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to permanently delete MCP connection',
      );
    } finally {
      setDeletingId(null);
    }
  };

  const credentialPreset = createdCredential
    ? CLIENT_PRESET_BY_ID[createdCredential.clientId]
    : selectedClient;
  const credentialToken = createdCredential?.token ?? null;
  const connectionSnippet = setupSnippetForClient(credentialPreset.id);

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4" />
            <h2 className="text-base font-medium">MCP Client Connections</h2>
            {loading ? (
              <Badge variant="secondary">Checking</Badge>
            ) : activeClientConnections.length > 0 ? (
              <Badge>
                <CheckCircle2 className="size-3" />
                {activeClientConnections.length} active
              </Badge>
            ) : (
              <Badge variant="secondary">No connections</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Create durable copy-once credentials for Codex, Claude, Cursor, OpenAI API, and other
            MCP clients.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshTokens} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {!configured && !loading && (
        <p className="mt-5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Integration token storage is not configured for this deployment.
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <form className="grid content-start gap-4" onSubmit={(event) => void handleCreate(event)}>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Client</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CLIENT_PRESETS.map((preset) => {
                const Icon = preset.icon;
                const selected = preset.id === selectedClientId;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={selected}
                    className="flex min-h-16 items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 aria-pressed:border-primary aria-pressed:bg-primary/10"
                    onClick={() => handleSelectClient(preset.id)}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block font-medium">{preset.label}</span>
                      <span className="block text-xs text-muted-foreground">{preset.provider}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="headless-token-name">Connection name</Label>
            <Input
              id="headless-token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!configured || creating}
              placeholder={selectedClient.defaultName}
            />
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium">Scopes</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {availableScopes.map((scope) => (
                <label
                  key={scope}
                  className="flex min-h-8 items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={selectedScopes.includes(scope)}
                    disabled={!configured || creating}
                    onChange={() => toggleScope(scope)}
                  />
                  <span>{SCOPE_LABELS[scope]}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Button type="submit" disabled={!configured || creating}>
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Create connection
            </Button>
          </div>
        </form>

        <div className="grid content-start gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link2 className="size-4" />
            <h3 className="text-sm font-medium">Connection Setup</h3>
            <Badge variant="outline">{credentialPreset.label}</Badge>
          </div>

          {createdCredential && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    Copy this raw credential now. It will not be shown again.
                  </p>
                  <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                    Rotate the connection if this value is lost or exposed.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopy(createdCredential.token, 'Raw credential')}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
              <textarea
                readOnly
                value={createdCredential.token}
                className="mt-3 min-h-20 w-full resize-none rounded-md border bg-background p-2 font-mono text-xs text-foreground outline-none"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}

          <CopyBlock title="Server URL" value={MCP_ENDPOINT} onCopy={handleCopy} />
          <CopyBlock
            title="Authorization header"
            value={tokenAuthHeader(credentialToken)}
            onCopy={handleCopy}
          />
          <CopyBlock title="Client snippet" value={connectionSnippet} onCopy={handleCopy} />
          <CopyBlock
            title="Full URL fallback"
            value={tokenUrl(credentialToken)}
            onCopy={handleCopy}
            warning="Use only when a client cannot set headers. URLs are easier to leak through logs, browser history, and shell history."
          />

          <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>
                Agent setup sessions are short-lived approval steps. After approval, the exchange
                creates the same durable <code className="font-mono text-xs">bdk_...</code>{' '}
                credential listed here.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-md border bg-muted/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="size-4" />
              <h3 className="text-sm font-medium">Release Testing</h3>
              <Badge variant={activeReleaseTestToken ? 'default' : 'secondary'}>
                {activeReleaseTestToken ? 'Ready' : 'No token'}
              </Badge>
            </div>
            <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
              <div>{formatScopes(RELEASE_TEST_SCOPES)}</div>
              <div>
                Store the copied value as{' '}
                <code className="font-mono text-xs">BREAKDOWN_RELEASE_TEST_TOKEN</code>.
              </div>
              {activeReleaseTestToken && (
                <div>Last used {formatDate(activeReleaseTestToken.lastUsedAt)}</div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!configured || rotatingReleaseTest}
              onClick={() => void handleRotateReleaseTest()}
            >
              {rotatingReleaseTest ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {activeReleaseTestToken ? 'Rotate' : 'Create'}
            </Button>
            {activeReleaseTestToken && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={revokingId === activeReleaseTestToken.id}
                onClick={() => void handleRevoke(activeReleaseTestToken.id)}
              >
                {revokingId === activeReleaseTestToken.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Revoke
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Saved Client Connections</h3>
          <Badge variant="secondary">{clientConnections.length}</Badge>
        </div>

        <div className="mt-3 divide-y">
          {loading ? (
            <div className="py-4 text-sm text-muted-foreground">Loading connections...</div>
          ) : clientConnections.length === 0 ? (
            <div className="py-4 text-sm text-muted-foreground">No MCP client connections yet.</div>
          ) : (
            clientConnections.map((token) => {
              const revoked = Boolean(token.revokedAt);
              const editing = editingTokenId === token.id;
              const renaming = renamingId === token.id;
              const revoking = revokingId === token.id;
              const rotating = rotatingId === token.id;
              const deleting = deletingId === token.id;

              return (
                <div
                  key={token.id}
                  className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {editing ? (
                        <form
                          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                          onSubmit={(event) => void handleRename(event, token.id)}
                        >
                          <Input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            className="min-w-40 max-w-xs flex-1"
                            maxLength={100}
                            disabled={renaming}
                            aria-label="Connection name"
                            autoFocus
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            size="icon-sm"
                            disabled={renaming}
                            title="Save name"
                            aria-label="Save connection name"
                          >
                            {renaming ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            <span className="sr-only">Save connection name</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={renaming}
                            onClick={handleCancelRename}
                            title="Cancel rename"
                            aria-label="Cancel connection rename"
                          >
                            <X className="size-3.5" />
                            <span className="sr-only">Cancel connection rename</span>
                          </Button>
                        </form>
                      ) : (
                        <>
                          <span className="min-w-0 break-words font-medium">{token.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={Boolean(renamingId)}
                            onClick={() => handleStartRename(token)}
                            title="Rename connection"
                            aria-label={`Rename ${token.name}`}
                          >
                            <Pencil className="size-3.5" />
                            <span className="sr-only">Rename connection</span>
                          </Button>
                        </>
                      )}
                      <Badge variant="outline">{PURPOSE_LABELS[token.purpose]}</Badge>
                      <Badge variant={revoked ? 'secondary' : 'default'}>
                        {revoked ? 'Revoked' : 'Active'}
                      </Badge>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {token.tokenPrefix}...
                    </div>
                    <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
                      <div>{formatScopes(token.scopes)}</div>
                      <div>Created {formatDate(token.createdAt)}</div>
                      <div>Last used {formatDate(token.lastUsedAt)}</div>
                      {token.expiresAt && <div>Expires {formatDate(token.expiresAt)}</div>}
                    </div>
                  </div>

                  {!revoked ? (
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={rotating}
                        onClick={() => void handleRotateToken(token)}
                      >
                        {rotating ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        Rotate
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={revoking}
                        onClick={() => void handleRevoke(token.id)}
                      >
                        {revoking ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        Revoke
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={deleting}
                      onClick={() => setDeleteConfirmToken(token)}
                    >
                      {deleting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      Delete permanently
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(deleteConfirmToken)}
        onOpenChange={(open) => {
          if (!open && !deletingId) {
            setDeleteConfirmToken(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete connection permanently</DialogTitle>
            <DialogDescription>
              This will remove &quot;{deleteConfirmToken?.name}&quot; (
              <span className="font-mono">{deleteConfirmToken?.tokenPrefix}...</span>) from
              connection history. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(deletingId)}
              onClick={() => setDeleteConfirmToken(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={Boolean(deletingId)}
              onClick={() => void handlePermanentDelete()}
            >
              {deletingId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
