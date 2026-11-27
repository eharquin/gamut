import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEASURE_CLEAR_INTERVAL_MS, clearMeasuresPeriodically } from './developmentMeasures'

describe('clearMeasuresPeriodically', () => {
  afterEach(() => vi.useRealTimers())

  it('clears the measures at each interval until it is stopped', () => {
    vi.useFakeTimers()
    const timeline = { clearMeasures: vi.fn() }
    const stop = clearMeasuresPeriodically(timeline)

    vi.advanceTimersByTime(MEASURE_CLEAR_INTERVAL_MS - 1)
    expect(timeline.clearMeasures).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(timeline.clearMeasures).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2 * MEASURE_CLEAR_INTERVAL_MS)
    expect(timeline.clearMeasures).toHaveBeenCalledTimes(3)

    stop()
    vi.advanceTimersByTime(10 * MEASURE_CLEAR_INTERVAL_MS)
    expect(timeline.clearMeasures).toHaveBeenCalledTimes(3)
  })

  it('empties the real performance timeline', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    performance.mark('start')
    performance.measure('​PointMarkerGlyph', 'start')
    expect(performance.getEntriesByType('measure')).toHaveLength(1)
    const stop = clearMeasuresPeriodically()
    vi.advanceTimersByTime(MEASURE_CLEAR_INTERVAL_MS)
    expect(performance.getEntriesByType('measure')).toHaveLength(0)
    stop()
  })
})
