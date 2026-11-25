import { toScreen, type AdaptiveGrid, type Viewport2d } from './viewport'

export type CanvasBackgroundProps = Readonly<{
  viewport: Viewport2d
  grid: AdaptiveGrid
  display: Readonly<{ gridVisible: boolean; axisLabelsVisible: boolean; graduationsVisible: boolean }>
  /** The scale objects are drawn at, which sizes the origin. */
  scale: number
  formatNumber: (value: number) => string
}>

/** The grid, the axes and their graduations behind the scene (#173). */
export function CanvasBackground({ viewport, grid, display, scale, formatNumber }: CanvasBackgroundProps) {
  const origin = toScreen(viewport, { x: 0, y: 0 })
  return <>
    {display.gridVisible && <g aria-hidden="true">
      {grid.vertical.map((line) => <line
        key={`grid-x-${line.coordinate}`}
        className={line.major ? 'grid-line is-major' : 'grid-line'}
        x1={line.screen} y1="0" x2={line.screen} y2={viewport.height}
      />)}
      {grid.horizontal.map((line) => <line
        key={`grid-y-${line.coordinate}`}
        className={line.major ? 'grid-line is-major' : 'grid-line'}
        x1="0" y1={line.screen} x2={viewport.width} y2={line.screen}
      />)}
    </g>}

    {display.axisLabelsVisible && <g aria-hidden="true">
      <line className="axis" x1="0" y1={origin.y} x2={viewport.width} y2={origin.y} />
      <line className="axis" x1={origin.x} y1="0" x2={origin.x} y2={viewport.height} />
      <circle className="origin" cx={origin.x} cy={origin.y} r={3 * scale} />
      <text className="axis-name" x={viewport.width - 14} y={Math.max(16, Math.min(viewport.height - 8, origin.y - 8))}>x</text>
      <text className="axis-name" x={Math.max(8, Math.min(viewport.width - 18, origin.x + 8))} y="16">y</text>
    </g>}

    {display.graduationsVisible && <g aria-hidden="true">
      {grid.vertical.filter((line) => line.major && line.coordinate !== 0).map((line) => {
        const axisY = Math.max(16, Math.min(viewport.height - 18, origin.y))
        return <g key={`graduation-x-${line.coordinate}`}>
          <line className="graduation" x1={line.screen} y1={axisY - 4} x2={line.screen} y2={axisY + 4} />
          <text className="graduation-label" x={line.screen} y={axisY + 16}>{formatNumber(line.coordinate)}</text>
        </g>
      })}
      {grid.horizontal.filter((line) => line.major && line.coordinate !== 0).map((line) => {
        const axisX = Math.max(28, Math.min(viewport.width - 28, origin.x))
        return <g key={`graduation-y-${line.coordinate}`}>
          <line className="graduation" x1={axisX - 4} y1={line.screen} x2={axisX + 4} y2={line.screen} />
          <text className="graduation-label is-y" x={axisX - 8} y={line.screen + 4}>{formatNumber(line.coordinate)}</text>
        </g>
      })}
    </g>}
  </>
}
