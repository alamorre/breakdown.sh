import { getUserGraphs } from '@/actions/graph-actions';
import { GraphCard } from '@/components/shared/GraphCard';
import { NewGraphDialog } from '@/components/shared/NewGraphDialog';

export default async function DashboardPage() {
  const { data: graphs, error } = await getUserGraphs();

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your Graphs</h1>
        <NewGraphDialog />
      </div>

      {error && <p className="text-sm text-destructive">Failed to load graphs: {error}</p>}

      {!error && graphs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
          <p className="mb-2 text-lg font-medium text-muted-foreground">No graphs yet</p>
          <p className="mb-6 text-sm text-muted-foreground">
            Create your first reasoning graph to get started.
          </p>
          <NewGraphDialog />
        </div>
      )}

      {!error && graphs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {graphs.map((graph) => (
            <GraphCard key={graph.id} graph={graph} />
          ))}
        </div>
      )}
    </div>
  );
}
