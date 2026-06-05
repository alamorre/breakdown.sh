'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type BreakdownScope } from '@/lib/breakdown-service/scopes';

type AgentSetupStatus =
  | 'pending'
  | 'approved'
  | 'exchanging'
  | 'exchanged'
  | 'cancelled'
  | 'expired';

type AgentSetupSession = {
  id: string;
  userCode: string;
  clientName: string;
  providerName: string | null;
  tokenName: string | null;
  scopes: BreakdownScope[];
  status: AgentSetupStatus;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  exchangedAt: string | null;
};

type AgentSetupApprovalProps = {
  sessionId: string;
  initialUserCode?: string;
};

const SCOPE_LABELS: Record<BreakdownScope, string> = {
  'graphs:read': 'Read graphs',
  'graphs:write': 'Edit graphs',
  'runs:execute': 'Run graphs',
  'runs:external_execute': 'External runs',
  'runs:write_results': 'Write results',
  'runs:cancel': 'Cancel runs',
};

function readErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') {
    return fallback;
  }

  const error = (data as { error?: unknown }).error;
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not yet';
}

function statusBadgeVariant(status: AgentSetupStatus) {
  if (status === 'pending' || status === 'approved' || status === 'exchanging') {
    return 'default' as const;
  }

  if (status === 'expired' || status === 'cancelled') {
    return 'destructive' as const;
  }

  return 'secondary' as const;
}

export function AgentSetupApproval({ sessionId, initialUserCode }: AgentSetupApprovalProps) {
  const [session, setSession] = useState<AgentSetupSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestedBy = useMemo(() => {
    if (!session) return '';
    return [session.providerName, session.clientName].filter(Boolean).join(' / ');
  }, [session]);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/agent-setup-sessions/${sessionId}`);
      const data = (await response.json().catch(() => null)) as AgentSetupSession | null;

      if (!response.ok || !data) {
        throw new Error(readErrorMessage(data, 'Failed to load agent setup session'));
      }

      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent setup session');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleApprove = async () => {
    if (!session) return;

    setApproving(true);
    try {
      const response = await fetch(`/api/integrations/agent-setup-sessions/${sessionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode: initialUserCode ?? session.userCode }),
      });
      const data = (await response.json().catch(() => null)) as AgentSetupSession | null;

      if (!response.ok || !data) {
        throw new Error(readErrorMessage(data, 'Failed to approve agent setup'));
      }

      setSession(data);
      toast.success('Agent setup approved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve agent setup');
    } finally {
      setApproving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4" />
          Agent setup unavailable
        </div>
        <p className="mt-2">{error ?? 'Agent setup session was not found.'}</p>
      </div>
    );
  }

  const canApprove = session.status === 'pending';
  const approved = session.status === 'approved' || session.status === 'exchanging';
  const completed = session.status === 'exchanged';

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4" />
            <h1 className="text-lg font-semibold tracking-normal">Approve agent setup</h1>
            <Badge variant={statusBadgeVariant(session.status)}>{session.status}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {requestedBy} is requesting scoped Breakdown MCP access.
          </p>
        </div>

        <div className="rounded-md bg-muted/60 px-3 py-2 text-center">
          <div className="text-xs font-medium uppercase text-muted-foreground">Setup code</div>
          <div className="mt-1 font-mono text-lg font-semibold tracking-normal">
            {session.userCode}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-y-4 border-y py-4 text-sm sm:grid-cols-2 sm:gap-x-6">
        <div>
          <div className="font-medium">Client</div>
          <div className="mt-1 text-muted-foreground">{session.clientName}</div>
        </div>
        <div>
          <div className="font-medium">Provider</div>
          <div className="mt-1 text-muted-foreground">
            {session.providerName ?? 'Not specified'}
          </div>
        </div>
        <div>
          <div className="font-medium">Token name</div>
          <div className="mt-1 text-muted-foreground">
            {session.tokenName ?? 'Default agent token'}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1 font-medium">
            <Clock className="size-3.5" />
            Expires
          </div>
          <div className="mt-1 text-muted-foreground">{formatDate(session.expiresAt)}</div>
        </div>
      </div>

      <div className="mt-5 border-b pb-5">
        <div className="text-sm font-medium">Requested scopes</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {session.scopes.map((scope) => (
            <Badge key={scope} variant="secondary">
              {SCOPE_LABELS[scope]}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {completed
            ? 'The agent exchanged this approval for a scoped token.'
            : approved
              ? 'Approved. Return to the agent session to finish connecting.'
              : session.status === 'expired'
                ? 'This setup session has expired.'
                : 'Approve only if the setup code matches the agent session.'}
        </div>

        {canApprove && (
          <Button type="button" onClick={() => void handleApprove()} disabled={approving}>
            {approving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Approve
          </Button>
        )}
      </div>
    </div>
  );
}
