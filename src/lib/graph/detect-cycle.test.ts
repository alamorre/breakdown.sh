import { describe, it, expect } from 'vitest';
import { wouldCreateCycle } from '@/lib/graph/detect-cycle';

describe('wouldCreateCycle', () => {
  it('should return false for a simple valid edge', () => {
    const edges = [{ source: 'A', target: 'B' }];
    expect(wouldCreateCycle(edges, 'B', 'C')).toBe(false);
  });

  it('should return true when adding edge would create a direct cycle', () => {
    const edges = [{ source: 'A', target: 'B' }];
    expect(wouldCreateCycle(edges, 'B', 'A')).toBe(true);
  });

  it('should return true when adding edge would create an indirect cycle', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(true);
  });

  it('should return false for parallel paths without cycles', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'D' },
      { source: 'C', target: 'D' },
    ];
    expect(wouldCreateCycle(edges, 'D', 'E')).toBe(false);
  });

  it('should return false with empty edges', () => {
    expect(wouldCreateCycle([], 'A', 'B')).toBe(false);
  });

  it('should detect cycle through a long chain', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'C', target: 'D' },
      { source: 'D', target: 'E' },
    ];
    expect(wouldCreateCycle(edges, 'E', 'A')).toBe(true);
  });

  it('should return false when source equals target in disconnected graph', () => {
    const edges = [{ source: 'X', target: 'Y' }];
    expect(wouldCreateCycle(edges, 'A', 'B')).toBe(false);
  });
});
