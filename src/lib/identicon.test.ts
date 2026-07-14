import { describe, it, expect } from 'vitest';
import { identiconCells } from './identicon';

describe('identicon', () => {
  it('is deterministic for a seed', () => {
    const a = identiconCells('AAAA1111AAAA1111');
    const b = identiconCells('AAAA1111AAAA1111');
    expect(a.cells).toEqual(b.cells);
  });

  it('produces different patterns for different seeds', () => {
    const a = identiconCells('AAAA1111AAAA1111');
    const b = identiconCells('ZZZZ9999ZZZZ9999');
    expect(a.cells).not.toEqual(b.cells);
  });

  it('is horizontally mirrored around the centre column', () => {
    const grid = 7;
    const { cells } = identiconCells('mirror-seed', grid);
    const set = new Set(cells.map((c) => `${c.x},${c.y}`));
    for (const c of cells) {
      expect(set.has(`${grid - 1 - c.x},${c.y}`)).toBe(true);
    }
  });

  it('stays within the grid bounds', () => {
    const grid = 7;
    const { cells } = identiconCells('bounds', grid);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(grid);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThan(grid);
    }
    expect(cells.length).toBeGreaterThan(0);
  });
});
