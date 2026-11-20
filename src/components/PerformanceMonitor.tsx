import { useEffect, useState, type RefObject } from 'react'
import {
  framesPerSecond,
  longestFrame,
  type DurationStatistics,
  type PerformanceProbe,
} from '../presentation/performanceProbe'

/** How often the shown figures are refreshed, in milliseconds. */
export const PERFORMANCE_REFRESH_MS = 500
/** The span of frames the frame rate is measured over, in milliseconds. */
const FRAME_WINDOW_MS = 1000

type PerformanceMonitorProps = Readonly<{
  probe: PerformanceProbe
  /** The canvas whose drawn elements are counted. */
  canvasRef: RefObject<SVGSVGElement | null>
  expressionCount: number
}>

type Readings = Readonly<{
  fps: number | null
  longestFrame: number | null
  evaluation: DurationStatistics
  render: DurationStatistics
  svgNodes: number | null
  heapMegabytes: number | null
}>

/** Chromium only: the JavaScript heap the page uses. */
function usedHeapMegabytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize / 1048576 : null
}

const milliseconds = (value: number | null) => value === null ? '–' : `${value.toFixed(1)} ms`

/**
 * A frame in the bottom-right corner of the canvas with the app's performance:
 * the frame rate and the longest frame of the last second, the time the
 * document takes to evaluate and the app to render, and the size of the
 * drawing. Shown on request only (a per-browser setting); it measures frames
 * only while it is shown.
 */
export function PerformanceMonitor({ probe, canvasRef, expressionCount }: PerformanceMonitorProps) {
  const [readings, setReadings] = useState<Readings | null>(null)

  useEffect(() => {
    let timestamps: number[] = []
    let frame = requestAnimationFrame(function tick(now) {
      timestamps.push(now)
      while (timestamps.length > 2 && now - timestamps[0] > FRAME_WINDOW_MS) timestamps.shift()
      frame = requestAnimationFrame(tick)
    })
    const read = () => setReadings({
      fps: framesPerSecond(timestamps),
      longestFrame: longestFrame(timestamps),
      evaluation: probe.evaluation.statistics(),
      render: probe.render.statistics(),
      svgNodes: canvasRef.current?.getElementsByTagName('*').length ?? null,
      heapMegabytes: usedHeapMegabytes(),
    })
    read()
    const interval = window.setInterval(read, PERFORMANCE_REFRESH_MS)
    return () => {
      cancelAnimationFrame(frame)
      window.clearInterval(interval)
      timestamps = []
    }
  }, [probe, canvasRef])

  if (readings === null) return null
  // Evaluation and render show the mean of their recent measures.
  const rows: [string, string][] = [
    ['FPS', readings.fps === null ? '–' : readings.fps.toFixed(0)],
    ['Frame max', milliseconds(readings.longestFrame)],
    ['Evaluate', milliseconds(readings.evaluation.average)],
    ['Render', milliseconds(readings.render.average)],
    ['Expressions', String(expressionCount)],
    ['SVG nodes', readings.svgNodes === null ? '–' : String(readings.svgNodes)],
  ]
  if (readings.heapMegabytes !== null) rows.push(['Heap', `${readings.heapMegabytes.toFixed(0)} MB`])
  return (
    <section className="performance-monitor" aria-label="Performance monitor">
      <dl>
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
