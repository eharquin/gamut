import type { Point2d } from '../geometry/interpretation'
import {
  layoutIdealArrow,
  layoutIdealMarker,
  layoutLineAtInfinity,
  layoutOrientedArea,
  layoutOrientedSegment,
  layoutUnboundedLine,
  type RenderedPointListConnection,
  type RenderedPrimitive,
} from './layout'
import type { LabelObstacle, LabelRequest } from './labels'
import { DEFAULT_POINT_SIZE, POINT_OUTER_SCALE, segmentSizeFactor } from './stroke'
import { toScreen, type Viewport2d } from './viewport'

type Of<K extends RenderedPrimitive['primitive']['kind']> = RenderedPrimitive & Readonly<{
  primitive: Extract<RenderedPrimitive['primitive'], { kind: K }>
}>

/**
 * The rendered primitives of a scene laid out on the screen, one layer per
 * primitive kind (#173): the application hands primitives over and never
 * names their kinds.
 */
export type SceneLayout = Readonly<{
  vectors: readonly (Of<'oriented-segment'> & Readonly<{ layout: ReturnType<typeof layoutOrientedSegment> }>)[]
  areas: readonly (Of<'oriented-area'> & Readonly<{ layout: ReturnType<typeof layoutOrientedArea> }>)[]
  points: readonly (Of<'point-marker'> & Readonly<{ point: Point2d }>)[]
  lines: readonly (Of<'unbounded-line'> & Readonly<{ layout: NonNullable<ReturnType<typeof layoutUnboundedLine>> }>)[]
  idealPoints: readonly (Of<'ideal-point'> & Readonly<{
    arrow: ReturnType<typeof layoutIdealArrow> | null
    marker: ReturnType<typeof layoutIdealMarker> | null
  }>)[]
  infinity: readonly (Of<'line-at-infinity'> & Readonly<{ layout: ReturnType<typeof layoutLineAtInfinity> }>)[]
  connections: readonly RenderedPointListConnection[]
}>

const is = <K extends RenderedPrimitive['primitive']['kind']>(entry: RenderedPrimitive, kind: K): entry is Of<K> =>
  entry.primitive.kind === kind

/** Lays out every rendered primitive at the scale objects are drawn at. */
export function layoutScene(
  primitives: readonly RenderedPrimitive[],
  connections: readonly RenderedPointListConnection[],
  viewport: Viewport2d,
  scale: number,
): SceneLayout {
  return {
    vectors: primitives.flatMap((entry) => is(entry, 'oriented-segment')
      ? [{ ...entry, layout: layoutOrientedSegment(entry.primitive, viewport, scale * segmentSizeFactor(entry.pointSize, entry.strokeWidth)) }]
      : []),
    areas: primitives.flatMap((entry) => is(entry, 'oriented-area')
      ? [{ ...entry, layout: layoutOrientedArea(entry.primitive, viewport, entry.bivectorShape) }]
      : []),
    points: primitives.flatMap((entry) => is(entry, 'point-marker')
      ? [{ ...entry, point: toScreen(viewport, entry.primitive.point) }]
      : []),
    lines: primitives.flatMap((entry) => {
      if (!is(entry, 'unbounded-line')) return []
      const layout = layoutUnboundedLine(entry.primitive, viewport)
      return layout ? [{ ...entry, layout }] : []
    }),
    // A connected list showing its links alone hides its ideal points as well.
    idealPoints: primitives.flatMap((entry) => is(entry, 'ideal-point') && entry.markerVisible
      ? [{
          ...entry,
          arrow: entry.idealPointDisplay === 'ideal' ? null : layoutIdealArrow(entry.primitive, viewport, scale * segmentSizeFactor(entry.pointSize, entry.strokeWidth)),
          marker: entry.idealPointDisplay === 'vector' ? null : layoutIdealMarker(entry.primitive.direction, viewport, scale),
        }]
      : []),
    infinity: primitives.flatMap((entry) => is(entry, 'line-at-infinity')
      ? [{ ...entry, layout: layoutLineAtInfinity(viewport, scale) }]
      : []),
    connections,
  }
}

/** The item a rendered element belongs to: list elements are `id:index`. */
export const ownerOf = (id: string): string => id.split(':')[0]

/**
 * What label placement needs (#226): where each label is anchored, the
 * points and handles an automatic label avoids, and the filled point lists
 * it keeps out of.
 */
export function labelPlacementInputs(
  scene: SceneLayout,
  primitives: readonly RenderedPrimitive[],
  viewport: Viewport2d,
  scale: number,
): Readonly<{ requests: LabelRequest[]; obstacles: LabelObstacle[]; areas: Point2d[][] }> {
  const anchors = new Map<string, Point2d>()
  const obstacles: LabelObstacle[] = []
  const handleRadius = 10 * scale
  const addSegmentObstacles = (id: string, layout: Readonly<{ start: Point2d; end: Point2d }>) => {
    if (ownerOf(id) !== id) return
    obstacles.push({ ownerId: id, center: layout.start, radius: handleRadius })
    obstacles.push({ ownerId: id, center: layout.end, radius: 12 })
  }
  scene.vectors.forEach(({ id, layout }) => {
    anchors.set(id, layout.end)
    addSegmentObstacles(id, layout)
  })
  scene.areas.forEach(({ id, layout }) => {
    anchors.set(id, layout.labelPoint)
    if (ownerOf(id) === id) obstacles.push({ ownerId: id, center: layout.base, radius: handleRadius })
  })
  scene.points.forEach(({ id, point, pointSize, markerVisible }) => {
    anchors.set(id, point)
    // A hidden marker is not drawn, so it does not push labels away.
    if (markerVisible === false) return
    const core = (pointSize ?? DEFAULT_POINT_SIZE) * scale
    obstacles.push({ ownerId: ownerOf(id), center: point, radius: ownerOf(id) === id ? core * POINT_OUTER_SCALE : core })
  })
  scene.lines.forEach(({ id, layout }) => anchors.set(id, layout.labelPoint))
  scene.infinity.forEach(({ id, layout }) => anchors.set(id, {
    x: layout.center.x + layout.radiusX * Math.SQRT1_2,
    y: layout.center.y - layout.radiusY * Math.SQRT1_2,
  }))
  scene.idealPoints.forEach(({ id, arrow, marker }) => {
    if (arrow) {
      anchors.set(id, arrow.end)
      addSegmentObstacles(id, arrow)
    } else if (marker) anchors.set(id, marker.tail)
  })
  // Automatic labels keep out of filled point lists when they can.
  const areas = scene.connections.flatMap(({ fill }) =>
    fill ? [fill.map((point) => toScreen(viewport, point))] : [])
  const requests = primitives.flatMap(({ id, label, labelSettings }) => {
    const at = anchors.get(id)
    return label && at ? [{ key: id, ownerId: ownerOf(id), text: label, at, settings: labelSettings }] : []
  })
  return { requests, obstacles, areas }
}
