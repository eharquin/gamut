import { memo, useMemo } from 'react'
import type { AlgebraRegistry } from '../algebra/registry'
import { evaluateAppearanceSources } from '../application/evaluateAppearanceSources'
import { evaluateDocument } from '../application/evaluateDocument'
import { fromCanonicalDocument, type CanonicalDocument } from '../document/canonicalDocument'
import { drawnAppearances } from '../document/expressionFolders'
import { declaredName } from '../language/declaredName'
import {
  collectRenderedPrimitives,
  layoutOrientedArea,
  layoutOrientedSegment,
  layoutUnboundedLine,
  type RenderedPrimitive,
} from '../visualization/layout'
import { toScreen, type Viewport2d } from '../visualization/viewport'

/** The size of a thumbnail, in CSS pixels; it scales with its card. */
export const THUMBNAIL_WIDTH = 240
export const THUMBNAIL_HEIGHT = 150
/** The canvas width the stored zoom of a document is meant for; a thumbnail scales it down. */
const REFERENCE_CANVAS_WIDTH = 720
/** Objects are drawn smaller than on the canvas, so that a small scene stays legible. */
const OBJECT_SCALE = 0.6

type SceneThumbnailProps = Readonly<{
  document: CanonicalDocument
  registry: AlgebraRegistry
}>

type Drawing = Readonly<{
  viewport: Viewport2d
  rendered: ReturnType<typeof collectRenderedPrimitives>
}> | null

function draw(document: CanonicalDocument, registry: AlgebraRegistry): Drawing {
  if (document.view.viewport.kind !== 'two-dimensional' || document.view.visualizerId === null) return null
  const restored = fromCanonicalDocument(document, {
    visualizerAvailable: (visualizerId) => registry.resolveVisualizer(visualizerId) !== null,
  }).document
  const resolution = registry.resolve(restored.algebra)
  const interpretation = registry.resolveInterpretation(restored.interpretation)
  if (resolution.status !== 'resolved' || interpretation.status !== 'resolved') return null
  const evaluated = evaluateDocument(restored, { engine: resolution.engine, interpretation: interpretation.interpretation })
  const drawn = { ...restored, appearance: drawnAppearances(restored) }
  const sources = evaluateAppearanceSources(drawn, evaluated, resolution.engine)
  const rendered = collectRenderedPrimitives(evaluated, drawn.appearance, interpretation.interpretation, declaredName, sources)
  const { centerX, centerY, zoom } = document.view.viewport
  const stored: Viewport2d = {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    centerX,
    centerY,
    pixelsPerUnit: zoom * THUMBNAIL_WIDTH / REFERENCE_CANVAS_WIDTH,
  }
  return { viewport: fitted(rendered) ?? stored, rendered }
}

/** Half the side of the smallest square a thumbnail frames, in scene units, so that one point is not enlarged without end. */
const MIN_HALF_SPAN = 1
/** The margin around the framed objects, as a share of the frame. */
const FRAME_MARGIN = 0.14

/**
 * The view that frames every bounded object of the scene (points, vectors,
 * areas, and point-list links), or null when there is none; unbounded lines
 * then show across it.
 */
function fitted(rendered: ReturnType<typeof collectRenderedPrimitives>): Viewport2d | null {
  const xs: number[] = []
  const ys: number[] = []
  const add = (point: Readonly<{ x: number; y: number }>) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
    xs.push(point.x)
    ys.push(point.y)
  }
  for (const { primitive } of rendered.rendered) {
    if (primitive.kind === 'point-marker') add(primitive.point)
    else if (primitive.kind === 'oriented-segment') { add(primitive.start); add(primitive.end) }
    else if (primitive.kind === 'oriented-area') {
      if (primitive.shape.kind === 'parallelogram') primitive.shape.vertices.forEach(add)
      else {
        const { center, radius } = primitive.shape
        add({ x: center.x - radius, y: center.y - radius })
        add({ x: center.x + radius, y: center.y + radius })
      }
    }
  }
  for (const connection of rendered.connections)
    for (const link of connection.segments) if (link.kind === 'segment') { add(link.start); add(link.end) }
  if (xs.length === 0) return null
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const halfWidth = Math.max((maxX - minX) / 2, MIN_HALF_SPAN)
  const halfHeight = Math.max((maxY - minY) / 2, MIN_HALF_SPAN)
  const usable = 1 - 2 * FRAME_MARGIN
  return {
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    pixelsPerUnit: Math.min(THUMBNAIL_WIDTH * usable / (2 * halfWidth), THUMBNAIL_HEIGHT * usable / (2 * halfHeight)),
  }
}

const dash = (style: RenderedPrimitive['strokeStyle']) => style === 'dashed' ? '6 4' : style === 'dotted' ? '1.5 3' : undefined

/**
 * A small drawing of a scene for the library gallery (STORE-014): its points,
 * vectors, lines, areas, and connected point lists in their colours, without
 * labels, handles, or interaction, framed on its bounded objects. A document without a canvas, or that
 * cannot be evaluated, shows an empty frame. Decorative: the card names the
 * scene.
 */
export const SceneThumbnail = memo(function SceneThumbnail({ document, registry }: SceneThumbnailProps) {
  const drawing = useMemo(() => {
    try {
      return draw(document, registry)
    } catch {
      return null
    }
  }, [document, registry])
  const viewport = drawing?.viewport
  const origin = viewport ? toScreen(viewport, { x: 0, y: 0 }) : null
  return (
    <svg
      className="scene-thumbnail"
      viewBox={`0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {origin && <>
        <line className="scene-thumbnail-axis" x1="0" y1={origin.y} x2={THUMBNAIL_WIDTH} y2={origin.y} />
        <line className="scene-thumbnail-axis" x1={origin.x} y1="0" x2={origin.x} y2={THUMBNAIL_HEIGHT} />
      </>}
      {drawing && viewport && <>
        {drawing.rendered.rendered.map((entry) => {
          if (entry.primitive.kind !== 'oriented-area') return null
          const layout = layoutOrientedArea(entry.primitive, viewport, entry.bivectorShape)
          return <path key={`area-${entry.id}`} d={layout.path} fill={entry.color} fillOpacity={0.25 * (entry.opacity ?? 1)}
            stroke={entry.borderVisible ? entry.color : 'none'} strokeOpacity={entry.opacity ?? 1} />
        })}
        {drawing.rendered.connections.map((connection) => connection.segments.map((segment, index) => {
          if (segment.kind !== 'segment') return null
          const start = toScreen(viewport, segment.start)
          const end = toScreen(viewport, segment.end)
          return <line key={`link-${connection.id}-${index}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y}
            stroke={connection.color} strokeOpacity={connection.opacity ?? 1} strokeWidth={1.5}
            strokeDasharray={dash(connection.strokeStyle)} />
        }))}
        {drawing.rendered.rendered.map((entry) => {
          const opacity = entry.opacity ?? 1
          if (entry.primitive.kind === 'unbounded-line') {
            const layout = layoutUnboundedLine(entry.primitive, viewport)
            if (!layout) return null
            return <line key={`line-${entry.id}`} x1={layout.start.x} y1={layout.start.y} x2={layout.end.x} y2={layout.end.y}
              stroke={entry.color} strokeOpacity={opacity} strokeWidth={1.5} strokeDasharray={dash(entry.strokeStyle)} />
          }
          if (entry.primitive.kind === 'oriented-segment') {
            const layout = layoutOrientedSegment(entry.primitive, viewport, OBJECT_SCALE)
            return (
              <g key={`segment-${entry.id}`} opacity={opacity}>
                <line x1={layout.start.x} y1={layout.start.y} x2={layout.shaftEnd.x} y2={layout.shaftEnd.y}
                  stroke={entry.color} strokeWidth={1.8} strokeDasharray={dash(entry.strokeStyle)} />
                {layout.arrowPoints && <polygon points={layout.arrowPoints} fill={entry.color} />}
              </g>
            )
          }
          return null
        })}
        {drawing.rendered.rendered.map((entry) => {
          if (entry.primitive.kind !== 'point-marker' || !entry.markerVisible) return null
          const point = toScreen(viewport, entry.primitive.point)
          return <circle key={`point-${entry.id}`} cx={point.x} cy={point.y} r={2.6}
            fill={entry.color} fillOpacity={entry.opacity ?? 1} />
        })}
      </>}
    </svg>
  )
})
