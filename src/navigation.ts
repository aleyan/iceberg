/** Time-based easing gives wheel motion the same response at 60 Hz and 120 Hz. */
export function easeCamera(current: number, target: number, elapsedMs: number, durationMs: number): number {
  const next = target + (current - target) * Math.exp(-elapsedMs / durationMs);
  // Finish the motion so settled frames no longer reproject every label, and
  // an embedding page can take over scrolling when the camera reaches an end.
  return Math.abs(next - target) < 0.0001 ? target : next;
}
