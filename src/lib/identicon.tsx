/**
 * identicon.tsx — deterministic pixel-art avatars ("identicons") from any seed.
 *
 * No dependencies, no network: the seed is hashed with SHA-256, the hash bits fill a
 * vertically-mirrored grid, and a small multi-hue palette is derived from the hash.
 * Same seed → same avatar, always. Used for user PFPs (seed = identity fingerprint),
 * room logos (seed = routingId), and DM peers (seed = peer fingerprint).
 */

import { sha256Bytes } from './crypto/kdf';
import { utf8ToBytes } from './crypto/wire';

export interface IdenticonCell {
  x: number;
  y: number;
  color: string;
}

export interface IdenticonData {
  grid: number;
  cells: IdenticonCell[];
  bg: string;
}

/**
 * Compute the filled cells + palette for a seed. `grid` should be odd so the pattern
 * mirrors cleanly around the centre column.
 */
export const identiconCells = (seed: string, grid = 7): IdenticonData => {
  const hash = sha256Bytes(utf8ToBytes(seed || 'kai')); // 32 bytes
  const baseHue = (hash[31] / 255) * 360;
  const palette = [
    `hsl(${Math.round(baseHue)}, 68%, 62%)`,
    `hsl(${Math.round((baseHue + 40) % 360)}, 72%, 56%)`,
    `hsl(${Math.round((baseHue + 320) % 360)}, 62%, 66%)`,
  ];
  const half = Math.ceil(grid / 2);
  const cells: IdenticonCell[] = [];
  let i = 0;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < half; x++) {
      const b = hash[i % hash.length];
      i++;
      if (b > 128) {
        const color = palette[b % palette.length];
        cells.push({ x, y, color });
        const mirror = grid - 1 - x;
        if (mirror !== x) cells.push({ x: mirror, y, color });
      }
    }
  }
  return { grid, cells, bg: 'rgba(255,255,255,0.04)' };
};

interface IdenticonProps {
  seed: string;
  size?: number;
  grid?: number;
  className?: string;
  rounded?: boolean;
}

export function Identicon({ seed, size = 40, grid = 7, className, rounded = true }: IdenticonProps) {
  const { cells, bg } = identiconCells(seed, grid);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      className={className}
      style={{ borderRadius: rounded ? size * 0.28 : 0, display: 'block' }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect x={0} y={0} width={grid} height={grid} fill={bg} />
      {cells.map((c, idx) => (
        <rect key={idx} x={c.x} y={c.y} width={1} height={1} fill={c.color} />
      ))}
    </svg>
  );
}
