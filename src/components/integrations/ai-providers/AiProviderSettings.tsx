'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AI_PROVIDER_OPTIONS, type AiProviderId } from '@/lib/ai/models';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ProviderCredential = {
  id: string;
  apiKeyHint: string;
  lastValidatedAt: string | null;
  updatedAt: string;
};

type ProviderStatus = {
  provider: AiProviderId;
  connected: boolean;
  credential: ProviderCredential | null;
};

type AiProviderStatusResponse = {
  configured: boolean;
  providers: ProviderStatus[];
  error?: string;
};

const EMPTY_STATUSES: ProviderStatus[] = AI_PROVIDER_OPTIONS.map((provider) => ({
  provider: provider.id,
  connected: false,
  credential: null,
}));

function getStatusByProvider(statuses: ProviderStatus[]) {
  return new Map(statuses.map((status) => [status.provider, status]));
}

async function readStatus(): Promise<AiProviderStatusResponse> {
  const response = await fetch('/api/integrations/ai-providers/status');
  const data = (await response.json().catch(() => null)) as AiProviderStatusResponse | null;

  if (!response.ok || !data) {
    throw new Error(data?.error ?? 'Failed to load AI provider status');
  }

  return data;
}

export function AiProviderSettings() {
  const [configured, setConfigured] = useState(true);
  const [statuses, setStatuses] = useState<ProviderStatus[]>(EMPTY_STATUSES);
  const [loading, setLoading] = useState(true);
  const [savingProvider, setSavingProvider] = useState<AiProviderId | null>(null);
  const [removingProvider, setRemovingProvider] = useState<AiProviderId | null>(null);
  const formRefs = useRef<Record<string, HTMLFormElement | null>>({});

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readStatus();
      setConfigured(result.configured);
      setStatuses(result.providers.length > 0 ? result.providers : EMPTY_STATUSES);
      if (result.error) {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load AI provider status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleSave = async (event: FormEvent<HTMLFormElement>, providerId: AiProviderId) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const apiKey = String(formData.get('apiKey') ?? '').trim();

    if (!apiKey) {
      toast.error('Enter an API key first');
      return;
    }

    setSavingProvider(providerId);
    try {
      const response = await fetch(`/api/integrations/ai-providers/${providerId}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const result = (await response.json().catch(() => null)) as
        | (Omit<ProviderStatus, 'provider'> & { error?: string })
        | null;

      if (!response.ok || !result) {
        throw new Error(result?.error ?? 'Failed to save API key');
      }

      setStatuses((current) =>
        current.map((status) =>
          status.provider === providerId
            ? {
                provider: providerId,
                connected: result.connected,
                credential: result.credential,
              }
            : status,
        ),
      );
      form.reset();
      toast.success(
        `${AI_PROVIDER_OPTIONS.find((provider) => provider.id === providerId)?.label} key saved`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleRemove = async (providerId: AiProviderId) => {
    setRemovingProvider(providerId);
    try {
      const response = await fetch(`/api/integrations/ai-providers/${providerId}/key`, {
        method: 'DELETE',
      });
      const result = (await response.json().catch(() => null)) as
        | (Omit<ProviderStatus, 'provider'> & { error?: string })
        | null;

      if (!response.ok || !result) {
        throw new Error(result?.error ?? 'Failed to remove API key');
      }

      setStatuses((current) =>
        current.map((status) =>
          status.provider === providerId
            ? {
                provider: providerId,
                connected: result.connected,
                credential: result.credential,
              }
            : status,
        ),
      );
      formRefs.current[providerId]?.reset();
      toast.success('API key removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove API key');
    } finally {
      setRemovingProvider(null);
    }
  };

  const statusByProvider = getStatusByProvider(statuses);

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4" />
            <h2 className="text-base font-medium">AI Providers</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Manage provider keys for graph runs.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshStatus} disabled={loading}>
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
          Stored provider keys are not configured for this deployment.
        </p>
      )}

      <div className="mt-5 divide-y">
        {AI_PROVIDER_OPTIONS.map((provider) => {
          const providerStatus = statusByProvider.get(provider.id);
          const connected = Boolean(providerStatus?.connected);
          const credential = providerStatus?.credential ?? null;
          const saving = savingProvider === provider.id;
          const removing = removingProvider === provider.id;

          return (
            <div
              key={provider.id}
              className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[9rem_1fr]"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{provider.label}</span>
                {loading ? (
                  <Badge variant="secondary">Checking</Badge>
                ) : connected ? (
                  <Badge>
                    <CheckCircle2 className="size-3" />
                    Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not connected</Badge>
                )}
              </div>

              <div className="grid gap-2">
                {credential && (
                  <div className="text-sm text-muted-foreground">
                    Key {credential.apiKeyHint}
                    {credential.lastValidatedAt && (
                      <> · validated {new Date(credential.lastValidatedAt).toLocaleString()}</>
                    )}
                  </div>
                )}

                <form
                  ref={(node) => {
                    formRefs.current[provider.id] = node;
                  }}
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => void handleSave(event, provider.id)}
                >
                  <Input
                    name="apiKey"
                    type="password"
                    autoComplete="off"
                    placeholder={connected ? 'Replace API key' : 'API key'}
                    disabled={!configured || saving || removing}
                    className="min-w-0"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={!configured || saving || removing}
                      className="shrink-0"
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <KeyRound className="size-4" />
                      )}
                      Save
                    </Button>
                    {connected && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving || removing}
                        onClick={() => void handleRemove(provider.id)}
                        className="shrink-0"
                      >
                        {removing ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                        Remove
                      </Button>
                    )}
                  </div>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
