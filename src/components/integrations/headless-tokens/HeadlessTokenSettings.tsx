'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const SCOPE_LABELS: Record<BreakdownScope, string> = {
  'graphs:read': 'Read graphs',
  'graphs:write': 'Edit graphs',
  'runs:execute': 'Run graphs',
  'runs:external_execute': 'External runs',
  'runs:write_results': 'Write results',
  'runs:cancel': 'Cancel runs',
};

const PURPOSE_LABELS: Record<IntegrationTokenPurpose, string> = {
  mcp_client: 'MCP client',
  release_test: 'Release test',
};

async function readTokens(): Promise<HeadlessTokensResponse> {
  const response = await fetch('/api/integrations/headless-tokens');
  const data = (await response.json().catch(() => null)) as HeadlessTokensResponse | null;

  if (!response.ok || !data) {
    throw new Error(data?.error ?? 'Failed to load MCP access tokens');
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

function markActivePurposeRevoked(
  tokens: HeadlessToken[],
  purpose: IntegrationTokenPurpose,
  revokedAt: string,
) {
  return tokens.map((token) =>
    token.purpose === purpose && !token.revokedAt ? { ...token, revokedAt } : token,
  );
}

export function HeadlessTokenSettings() {
  const [configured, setConfigured] = useState(true);
  const [availableScopes, setAvailableScopes] = useState<BreakdownScope[]>(ALL_BREAKDOWN_SCOPES);
  const [selectedScopes, setSelectedScopes] = useState<BreakdownScope[]>(ALL_BREAKDOWN_SCOPES);
  const [tokens, setTokens] = useState<HeadlessToken[]>([]);
  const [name, setName] = useState('MCP client');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [rotatingReleaseTest, setRotatingReleaseTest] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const activeTokens = useMemo(() => tokens.filter((token) => !token.revokedAt), [tokens]);
  const activeReleaseTestToken = useMemo(
    () => activeTokens.find((token) => token.purpose === 'release_test') ?? null,
    [activeTokens],
  );

  const refreshTokens = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readTokens();
      setConfigured(result.configured);
      setAvailableScopes(result.scopes.length > 0 ? result.scopes : ALL_BREAKDOWN_SCOPES);
      setTokens(result.tokens);
      if (result.error) {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load MCP access tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTokens();
  }, [refreshTokens]);

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
      throw new Error(result?.error ?? 'Failed to create MCP access token');
    }

    return result;
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      toast.error('Name this token first');
      return;
    }

    if (selectedScopes.length === 0) {
      toast.error('Select at least one scope');
      return;
    }

    setCreating(true);
    setCreatedToken(null);
    try {
      const result = await createToken({
        tokenName: trimmedName,
        scopes: selectedScopes,
        purpose: 'mcp_client',
      });

      setCreatedToken(result.token);
      setTokens((current) => [result.record, ...current]);
      setName('MCP client');
      toast.success('MCP access token created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create MCP access token');
    } finally {
      setCreating(false);
    }
  };

  const handleRotateReleaseTest = async () => {
    setRotatingReleaseTest(true);
    setCreatedToken(null);
    try {
      const result = await createToken({
        tokenName: 'Release test token',
        scopes: RELEASE_TEST_SCOPES,
        purpose: 'release_test',
      });
      const revokedAt = new Date().toISOString();

      setCreatedToken(result.token);
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

  const handleCopyToken = async () => {
    if (!createdToken) return;

    try {
      await navigator.clipboard.writeText(createdToken);
      toast.success('Token copied');
    } catch {
      toast.error('Could not copy token');
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
        throw new Error(result?.error ?? 'Failed to revoke MCP access token');
      }

      setTokens((current) =>
        current.map((token) =>
          token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      );
      toast.success('MCP access token revoked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke MCP access token');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4" />
            <h2 className="text-base font-medium">MCP Access</h2>
            {loading ? (
              <Badge variant="secondary">Checking</Badge>
            ) : activeTokens.length > 0 ? (
              <Badge>
                <CheckCircle2 className="size-3" />
                {activeTokens.length} active
              </Badge>
            ) : (
              <Badge variant="secondary">No tokens</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Create bearer tokens for local and remote MCP clients.
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

      {createdToken && (
        <div className="mt-5 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
              Copy this token now. It will not be shown again.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={handleCopyToken}>
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
          <textarea
            readOnly
            value={createdToken}
            className="mt-3 min-h-20 w-full resize-none rounded-md border bg-background p-2 font-mono text-xs text-foreground outline-none"
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}

      <div className="mt-5 rounded-md border bg-muted/20 p-3">
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

      <form className="mt-5 grid gap-4" onSubmit={(event) => void handleCreate(event)}>
        <div className="grid gap-2">
          <Label htmlFor="headless-token-name">Token name</Label>
          <Input
            id="headless-token-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!configured || creating}
            placeholder="MCP client"
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
            Create token
          </Button>
        </div>
      </form>

      <div className="mt-5 divide-y">
        {loading ? (
          <div className="py-4 text-sm text-muted-foreground">Loading tokens...</div>
        ) : tokens.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">No MCP access tokens yet.</div>
        ) : (
          tokens.map((token) => {
            const revoked = Boolean(token.revokedAt);
            const revoking = revokingId === token.id;

            return (
              <div
                key={token.id}
                className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium">{token.name}</span>
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

                {!revoked && (
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
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
