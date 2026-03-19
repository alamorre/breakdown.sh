'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteGraph } from '@/actions/graph-actions';
import type { Graph } from '@/types/graph';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function GraphCard({ graph }: { graph: Graph }) {
  const router = useRouter();

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    const result = await deleteGraph({ graphId: graph.id });
    if (result.error) {
      toast.error('Failed to delete graph', { description: result.error });
    } else {
      toast.success('Graph deleted');
    }
  }

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent"
      onClick={() => router.push(`/graph/${graph.id}`)}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{graph.name}</CardTitle>
          <CardDescription>
            {graph.description || `Updated ${formatDate(graph.updated_at)}`}
          </CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0" />}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="sr-only">Open menu</span>
            <span className="text-lg leading-none">&#8942;</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleDelete}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
    </Card>
  );
}
