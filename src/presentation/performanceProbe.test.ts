import { describe, expect, it } from 'vitest'
import { DurationSamples, framesPerSecond, longestFrame } from './performanceProbe'

describe('DurationSamples', () => {
  it('has no statistics before its first measure', () => {
    expect(new DurationSamples().statistics()).toEqual({ last: null, average: null, maximum: null })
  })

  it('keeps the last, mean and longest of its recent measures only', () => {
    const samples = new DurationSamples(3)
    for (const measure of [100, 2, 4, 6]) samples.record(measure)
    // 100 left the window of three.
    expect(samples.statistics()).toEqual({ last: 6, average: 4, maximum: 6 })
  })

  it('ignores a measure that is not a duration', () => {
    const samples = new DurationSamples()
    samples.record(Number.NaN)
    samples.record(-1)
    samples.record(Number.POSITIVE_INFINITY)
    expect(samples.statistics().last).toBeNull()
  })
})

describe('frame statistics', () => {
  it('counts frames per second over the span of the timestamps', () => {
    expect(framesPerSecond([0, 16, 32, 48, 64])).toBeCloseTo(62.5)
    expect(framesPerSecond([0, 500, 1000])).toBe(2)
  })

  it('has no frame rate with fewer than two frames or no elapsed time', () => {
    expect(framesPerSecond([])).toBeNull()
    expect(framesPerSecond([5])).toBeNull()
    expect(framesPerSecond([5, 5])).toBeNull()
  })

  it('finds the longest interval between frames', () => {
    expect(longestFrame([0, 16, 50, 66])).toBe(34)
    expect(longestFrame([0])).toBeNull()
  })
})
