/** Full orbit remains the default; arc allows 30 degrees of total rotation. */
export const icebergViews = Object.freeze(['orbit', 'arc', 'list'] as const);
export type IcebergView = typeof icebergViews[number];

export function constrainYaw(view: IcebergView, yaw: number): number {
  if (view === 'list') return 0;
  if (view === 'arc') return Math.max(-Math.PI / 12, Math.min(Math.PI / 12, yaw));
  return yaw;
}

export function assertView(view: IcebergView): void {
  if (!icebergViews.includes(view)) throw new TypeError(`Unknown iceberg view: ${view}`);
}

/** Rearrange fixed world anchors, keeping every view within the same depth range. */
export function placeFrontLabels<T extends { y: number; angle: number }>(
  placements: readonly T[], view: 'arc' | 'list',
): T[] {
  const top = placements[0]?.y ?? 0;
  const bottom = placements.at(-1)?.y ?? top;
  return placements.map((entry, index) => ({
    ...entry,
    angle: view === 'list' ? 0 : entry.angle * 0.7 / Math.PI,
    y: view === 'list'
      ? top + (bottom - top) * index / Math.max(1, placements.length - 1)
      : entry.y,
  }));
}
