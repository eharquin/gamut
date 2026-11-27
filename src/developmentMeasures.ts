/** Interval between two clears of the performance timeline's measures. */
export const MEASURE_CLEAR_INTERVAL_MS = 1_000

/**
 * React's development build records a `performance.measure` entry for every
 * component render, for its DevTools performance tracks, and the browser keeps
 * each entry until the page clears it. On a heavy graph a drag adds about
 * 1 MB of entries per move, so a long session freezes the tab (#371). The
 * development entry point clears them at a fixed interval; a DevTools profile
 * still shows them, since the trace captures each measure when it is made.
 * Returns the function that stops the clearing.
 */
export function clearMeasuresPeriodically(
  timeline: Pick<Performance, 'clearMeasures'> = performance,
): () => void {
  const timer = setInterval(() => timeline.clearMeasures(), MEASURE_CLEAR_INTERVAL_MS)
  return () => clearInterval(timer)
}
