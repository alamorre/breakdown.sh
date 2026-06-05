import { AgentSetupApproval } from '@/components/integrations/agent-setup/AgentSetupApproval';

interface AgentSetupPageProps {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ code?: string | string[] }>;
}

export default async function AgentSetupPage({ params, searchParams }: AgentSetupPageProps) {
  const { sessionId } = await params;
  const { code } = await searchParams;
  const initialUserCode = Array.isArray(code) ? code[0] : code;

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Agent Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and approve scoped MCP access for a coding agent.
        </p>
      </div>

      <AgentSetupApproval sessionId={sessionId} initialUserCode={initialUserCode} />
    </section>
  );
}
