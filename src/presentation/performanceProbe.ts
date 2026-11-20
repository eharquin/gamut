/** How many recent measures each average spans. */
export const PERFORMANCE_SAMPLE_COUNT = 30

export type DurationStatistics = Readonly<{
  /** The most recent measure, in milliseconds; null before the first. */
  last: number | null
  /** The mean of the recent measures, in milliseconds; null before the first. */
  average: number | null
  /** The longest of the recent measures, in milliseconds; null before the first. */
  maximum: number | null
}>

/** The recent durations of one kind of work, kept in a bounded window. */
export class DurationSamples {
  private readonly samples: number[] = []
  private readonly capacity: number

  constructor(capacity = PERFORMANCE_SAMPLE_COUNT) {
    this.capacity = capacity
  }

  record(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return
    this.samples.push(milliseconds)
    if (this.samples.length > this.capacity) this.samples.shift()
  }

  statistics(): DurationStatistics {
    const { samples } = this
    if (samples.length === 0) return { last: null, average: null, maximum: null }
    return {
      last: samples[samples.length - 1],
      average: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
      maximum: Math.max(...samples),
    }
  }
}

/**
 * The measures the performance monitor shows, recorded by the app as it works:
 * the evaluation of the document and the render of the app, each from its
 * start to its commit. Recording costs a subtraction, whether or not the
 * monitor is shown.
 */
export type PerformanceProbe = Readonly<{
  evaluation: DurationSamples
  render: DurationSamples
}>

export function createPerformanceProbe(): PerformanceProbe {
  return { evaluation: new DurationSamples(), render: new DurationSamples() }
}

/** Frames per second over a window of frame timestamps, in milliseconds. */
export function framesPerSecond(timestamps: readonly number[]): number | null {
  if (timestamps.length < 2) return null
  const elapsed = timestamps[timestamps.length - 1] - timestamps[0]
  return elapsed > 0 ? ((timestamps.length - 1) * 1000) / elapsed : null
}

/** The longest interval between consecutive frames, in milliseconds. */
export function longestFrame(timestamps: readonly number[]): number | null {
  let longest: number | null = null
  for (let index = 1; index < timestamps.length; index += 1) {
    const interval = timestamps[index] - timestamps[index - 1]
    if (longest === null || interval > longest) longest = interval
  }
  return longest
}
