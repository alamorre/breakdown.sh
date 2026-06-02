'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type GoogleDriveStatus = {
  configured: boolean;
  connected: boolean;
  connection: {
    id: string;
    accountEmail: string;
    scopes: string[];
    lastConnectedAt: string;
    lastRefreshAt: string | null;
    expiresAt: string | null;
  } | null;
};

async function readStatus(): Promise<GoogleDriveStatus> {
  const response = await fetch('/api/integrations/google-drive/status');
  const data = (await response.json().catch(() => null)) as
    | (GoogleDriveStatus & { error?: string })
    | null;

  if (!response.ok || !data) {
    throw new Error(data?.error ?? 'Failed to load Google Drive status');
  }

  return data;
}

export function GoogleDriveSettings() {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await readStatus());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load Google Drive status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const response = await fetch('/api/integrations/google-drive/disconnect', { method: 'POST' });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error ?? 'Failed to disconnect Google Drive');
      }
      toast.success('Google Drive disconnected');
      await refreshStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect Google Drive');
    } finally {
      setDisconnecting(false);
    }
  };

  const connectHref = '/api/integrations/google-drive/connect?returnTo=/settings';

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage connected source integrations.</p>
      </div>

      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">Google Drive</h2>
              {loading ? (
                <Badge variant="secondary">Checking</Badge>
              ) : status?.connected ? (
                <Badge>Connected</Badge>
              ) : (
                <Badge variant="secondary">Not connected</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick private Docs, Sheets, and Presentations as graph source nodes.
            </p>
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

        <div className="mt-5 space-y-3 text-sm">
          {!status?.configured && !loading && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
              Google Drive is not configured for this deployment.
            </p>
          )}

          {status?.connected && status.connection && (
            <div className="grid gap-2 text-muted-foreground">
              <div>
                Account: <span className="text-foreground">{status.connection.accountEmail}</span>
              </div>
              <div>
                Last connected:{' '}
                <span className="text-foreground">
                  {new Date(status.connection.lastConnectedAt).toLocaleString()}
                </span>
              </div>
              {status.connection.lastRefreshAt && (
                <div>
                  Last token refresh:{' '}
                  <span className="text-foreground">
                    {new Date(status.connection.lastRefreshAt).toLocaleString()}
                  </span>
                </div>
              )}
              <div>
                Scope:{' '}
                <span className="text-foreground">
                  Files selected for breakdown.sh plus account identity.
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          {status?.connected ? (
            <>
              <a className={buttonVariants()} href={connectHref}>
                Reconnect
              </a>
              <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Unplug className="size-4" />
                )}
                Disconnect
              </Button>
            </>
          ) : (
            <a
              className={buttonVariants({
                className: !status?.configured && !loading ? 'pointer-events-none opacity-50' : '',
              })}
              href={connectHref}
            >
              Connect Google Drive
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
