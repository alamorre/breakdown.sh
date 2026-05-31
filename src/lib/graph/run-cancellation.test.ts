import { describe, expect, it, vi } from 'vitest';
import { cancelRun, isRunCancelled } from '@/lib/graph/run-cancellation';

function createSupabase(overrides: Record<string, unknown> = {}) {
  const chain = {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn(),
    ...overrides,
  };

  return {
    chain,
    supabase: {
      from: vi.fn(() => chain),
    },
  };
}

describe('run cancellation persistence', () => {
  it('stores cancellation markers in Supabase', async () => {
    const { chain, supabase } = createSupabase();
    chain.eq.mockReturnValueOnce(chain).mockResolvedValueOnce({ error: null });

    await cancelRun(supabase as never, { graphId: 'graph-1' });

    expect(supabase.from).toHaveBeenCalledWith('nodes');
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        run_error: expect.stringContaining('Run cancellation requested'),
        run_status: 'cancelled',
      }),
    );
    expect(chain.eq).toHaveBeenCalledWith('graph_id', 'graph-1');
    expect(chain.eq).toHaveBeenCalledWith('run_status', 'queued');
  });

  it('reads cancelled queued-node markers from Supabase', async () => {
    const { chain, supabase } = createSupabase({
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'node-1' }], error: null }),
    });

    await expect(isRunCancelled(supabase as never, 'graph-1')).resolves.toBe(true);

    expect(chain.select).toHaveBeenCalledWith('id');
    expect(chain.eq).toHaveBeenCalledWith('graph_id', 'graph-1');
    expect(chain.eq).toHaveBeenCalledWith('run_status', 'cancelled');
    expect(chain.limit).toHaveBeenCalledWith(1);
  });
});
