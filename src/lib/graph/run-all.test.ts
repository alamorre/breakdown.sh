import { describe, expect, it } from 'vitest';
import {
  getRunAllInitialPlan,
  isParallelRunEligibleNode,
  RunAllCycleError,
  runDependencyAwareBatches,
} from '@/lib/graph/run-all';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runDependencyAwareBatches', () => {
  it('identifies the initial running and queued nodes without marking downstream ready', () => {
    const plan = getRunAllInitialPlan(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
      [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'b', target: 'd' },
      ],
      2,
    );

    expect(plan).toEqual({
      runningNodeIds: ['a', 'e'],
      readyQueuedNodeIds: [],
      dependencyQueuedNodeIds: ['b', 'c', 'd'],
    });
  });

  it('queues extra ready roots when they exceed the concurrency cap', () => {
    const plan = getRunAllInitialPlan([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], [], 3);

    expect(plan).toEqual({
      runningNodeIds: ['a', 'b', 'c'],
      readyQueuedNodeIds: ['d'],
      dependencyQueuedNodeIds: [],
    });
  });

  it('keeps dependents behind their successful dependencies', async () => {
    const events: string[] = [];

    await runDependencyAwareBatches({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'b', target: 'd' },
        { source: 'c', target: 'd' },
      ],
      maxConcurrency: 2,
      runNode: async (node) => {
        events.push(`start:${node.id}`);
        await wait(5);
        events.push(`finish:${node.id}`);
        return node.id;
      },
    });

    expect(events.indexOf('start:b')).toBeGreaterThan(events.indexOf('finish:a'));
    expect(events.indexOf('start:c')).toBeGreaterThan(events.indexOf('finish:a'));
    expect(events.indexOf('start:d')).toBeGreaterThan(events.indexOf('finish:b'));
    expect(events.indexOf('start:d')).toBeGreaterThan(events.indexOf('finish:c'));
  });

  it('runs disconnected ready branches concurrently up to the cap', async () => {
    const startOrder: string[] = [];
    let activeCount = 0;
    let maxActiveCount = 0;

    await runDependencyAwareBatches({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'c', target: 'd' },
      ],
      maxConcurrency: 2,
      runNode: async (node) => {
        startOrder.push(node.id);
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await wait(5);
        activeCount--;
        return node.id;
      },
    });

    expect(startOrder.slice(0, 2)).toEqual(['a', 'c']);
    expect(maxActiveCount).toBe(2);
  });

  it('never exceeds the configured concurrency cap', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;

    await runDependencyAwareBatches({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
      edges: [],
      maxConcurrency: 3,
      runNode: async (node) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await wait(5);
        activeCount--;
        return node.id;
      },
    });

    expect(maxActiveCount).toBe(3);
  });

  it('records per-node timing metadata', async () => {
    const summary = await runDependencyAwareBatches({
      nodes: [{ id: 'a' }],
      edges: [],
      runNode: async (node) => {
        await wait(1);
        return node.id;
      },
    });

    expect(summary.results[0]).toMatchObject({
      nodeId: 'a',
      startedAt: expect.any(String),
      settledAt: expect.any(String),
      durationMs: expect.any(Number),
    });
    expect(summary.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('skips dependents after an upstream failure while independent work continues', async () => {
    const summary = await runDependencyAwareBatches({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [{ source: 'a', target: 'b' }],
      maxConcurrency: 2,
      runNode: async (node) => {
        await wait(1);
        if (node.id === 'a') {
          throw new Error('source failed');
        }
        return node.id;
      },
    });

    expect(summary.results).toMatchObject([
      { nodeId: 'a', status: 'failed', error: 'source failed' },
      { nodeId: 'b', status: 'skipped', upstreamNodeIds: ['a'] },
      { nodeId: 'c', status: 'success' },
    ]);
  });

  it('stops scheduling new nodes after cancellation and lets in-flight work settle', async () => {
    let cancelled = false;

    const summary = await runDependencyAwareBatches({
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [{ source: 'a', target: 'b' }],
      maxConcurrency: 1,
      shouldCancel: () => cancelled,
      runNode: async (node) => {
        cancelled = true;
        await wait(1);
        return node.id;
      },
    });

    expect(summary.cancelled).toBe(true);
    expect(summary.results).toMatchObject([
      { nodeId: 'a', status: 'success' },
      { nodeId: 'b', status: 'cancelled' },
      { nodeId: 'c', status: 'cancelled' },
    ]);
  });

  it('supports async cancellation checks for durable cancellation stores', async () => {
    let cancelled = false;
    const started: string[] = [];

    const summary = await runDependencyAwareBatches({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{ source: 'a', target: 'b' }],
      maxConcurrency: 1,
      shouldCancel: async () => cancelled,
      runNode: async (node) => {
        started.push(node.id);
        cancelled = true;
        await wait(1);
        return node.id;
      },
    });

    expect(started).toEqual(['a']);
    expect(summary.results).toMatchObject([
      { nodeId: 'a', status: 'success' },
      { nodeId: 'b', status: 'cancelled' },
    ]);
  });

  it('reports cycles before scheduling any nodes', async () => {
    const starts: string[] = [];

    await expect(
      runDependencyAwareBatches({
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'a' },
        ],
        runNode: async (node) => {
          starts.push(node.id);
          return node.id;
        },
      }),
    ).rejects.toBeInstanceOf(RunAllCycleError);

    expect(starts).toEqual([]);
  });

  it('defines all current node types as eligible for the first parallel lane', () => {
    expect(isParallelRunEligibleNode({ node_type: 'default' })).toBe(true);
    expect(isParallelRunEligibleNode({ node_type: 'source-web-url' })).toBe(true);
    expect(isParallelRunEligibleNode({ node_type: 'source-text' })).toBe(true);
  });
});
