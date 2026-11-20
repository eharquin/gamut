import type { LabelAnchor } from '../document/expressionDocument'
import type { Point2d } from '../geometry/interpretation'

/** Default label size (as before format version 7) and distance (from version 12), in screen pixels. */
export const DEFAULT_LABEL_SIZE = 13
export const DEFAULT_LABEL_DISTANCE = 20

/** Placement settings of one object's label; `null` selects the default. */
export type LabelSettings = Readonly<{
  anchor: LabelAnchor
  /** Radians, counterclockwise, in (−π, π]. */
  angle: number | null
  /** Font size in reference pixels. */
  size: number | null
  /** Horizontal and vertical offset from the anchor point, in reference pixels. */
  distance: number | null
}>

export const DEFAULT_LABEL_SETTINGS: LabelSettings = Object.freeze({
  anchor: 'auto', angle: null, size: null, distance: null,
})

/** A label to place: its text, the point it is attached to, and its settings. */
export type LabelRequest = Readonly<{
  key: string
  /** The item it labels; obstacles of the same item never collide with it. */
  ownerId: string
  text: string
  at: Point2d
  settings: LabelSettings
}>

/** A point or a handle that an automatic label avoids. */
export type LabelObstacle = Readonly<{ ownerId: string; center: Point2d; radius: number }>

/**
 * A filled area, in screen space, that an automatic label keeps out of when it
 * can: the polygon of a filled point list. Unlike an obstacle it applies to
 * the labels of its own object too, so that the list's points are labelled
 * outside it.
 */
export type LabelArea = readonly Point2d[]

/** A label as drawn: the attributes it needs beyond those of the default top-right label. */
export type PlacedLabel = Readonly<{
  text: string
  x: number
  y: number
  textAnchor?: 'middle' | 'end'
  baseline?: 'middle' | 'hanging'
  fontSize?: number
  angle?: number
}>

type FixedAnchor = Exclude<LabelAnchor, 'auto'>

/** Automatic placement tries top right first, then clockwise (#226). */
export const AUTO_LABEL_ORDER: readonly FixedAnchor[] = [
  'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left', 'top',
]

const DIRECTIONS: Readonly<Record<FixedAnchor, readonly [number, number]>> = {
  'top-left': [-1, -1], top: [0, -1], 'top-right': [1, -1],
  left: [-1, 0], right: [1, 0],
  'bottom-left': [-1, 1], bottom: [0, 1], 'bottom-right': [1, 1],
  // Centred on the anchor point, where the distance has no direction to act in.
  center: [0, 0],
}

/**
 * Places a label at a fixed anchor. The eight positions lie on the circle
 * whose radius is the label distance, 20 px by default: a diagonal position is
 * the distance divided by √2 along each axis. Sizes and distances are
 * multiplied by the object scale; the defaults are drawn alike at every scale.
 */
export function labelAt(
  request: LabelRequest,
  anchor: FixedAnchor,
  objectScale: number,
): PlacedLabel {
  const { settings } = request
  const distance = settings.distance === null ? DEFAULT_LABEL_DISTANCE : settings.distance * objectScale
  const [dx, dy] = DIRECTIONS[anchor]
  // The eight positions lie on the circle of radius `distance` around the anchor point.
  const length = Math.hypot(dx, dy) || 1
  return {
    text: request.text,
    x: request.at.x + dx / length * distance,
    y: request.at.y + dy / length * distance,
    ...(dx === 0 ? { textAnchor: 'middle' as const } : dx < 0 ? { textAnchor: 'end' as const } : {}),
    ...(dy === 0 ? { baseline: 'middle' as const } : dy > 0 ? { baseline: 'hanging' as const } : {}),
    ...(settings.size === null ? {} : { fontSize: settings.size * objectScale }),
    ...(settings.angle ? { angle: settings.angle } : {}),
  }
}

type Box = Readonly<{ left: number; top: number; right: number; bottom: number }>

/**
 * The box a label occupies, estimated from its text length since layout is
 * not measured: about 0.62 em per character of the bold sans-serif label
 * font. Rotation is ignored.
 */
export function labelBox(label: PlacedLabel): Box {
  const size = label.fontSize ?? DEFAULT_LABEL_SIZE
  const width = label.text.length * 0.62 * size
  const left = label.textAnchor === 'middle' ? label.x - width / 2
    : label.textAnchor === 'end' ? label.x - width : label.x
  const top = label.baseline === 'middle' ? label.y - size / 2
    : label.baseline === 'hanging' ? label.y : label.y - 0.8 * size
  return { left, top, right: left + width, bottom: top + size }
}

const boxesOverlap = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

function circleOverlaps(box: Box, { center, radius }: LabelObstacle): boolean {
  const x = Math.max(box.left, Math.min(center.x, box.right))
  const y = Math.max(box.top, Math.min(center.y, box.bottom))
  return Math.hypot(center.x - x, center.y - y) < radius
}

/** Whether a point lies inside a polygon, by the even-odd rule. */
function insidePolygon(point: Point2d, polygon: LabelArea): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Whether the segments `ab` and `cd` cross. */
function segmentsCross(a: Point2d, b: Point2d, c: Point2d, d: Point2d): boolean {
  const side = (p: Point2d, q: Point2d, r: Point2d) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

/** Whether a label's box and a filled polygon share any of the plane. */
export function boxOverlapsArea(box: Box, polygon: LabelArea): boolean {
  if (polygon.length < 3) return false
  const corners = [
    { x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom },
  ]
  if (corners.some((corner) => insidePolygon(corner, polygon))) return true
  if (polygon.some(({ x, y }) => x > box.left && x < box.right && y > box.top && y < box.bottom)) return true
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length]
    return corners.some((corner, side) => segmentsCross(start, end, corner, corners[(side + 1) % 4]))
  })
}

/**
 * Places every label. Labels with a fixed anchor go where they are told.
 * An automatic label takes the first position, in `AUTO_LABEL_ORDER`, where
 * it overlaps no other label, no point or handle of another object, and no
 * filled area; failing that, the first that overlaps no label, point or
 * handle; then the first outside every filled area; and top right when none
 * is left. Labels are placed in document order.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  obstacles: readonly LabelObstacle[],
  objectScale: number,
  areas: readonly LabelArea[] = [],
): ReadonlyMap<string, PlacedLabel> {
  const placed = new Map<string, PlacedLabel>()
  const boxes: { ownerId: string; box: Box }[] = []
  for (const request of requests) {
    if (request.settings.anchor === 'auto') continue
    const label = labelAt(request, request.settings.anchor, objectScale)
    placed.set(request.key, label)
    boxes.push({ ownerId: request.ownerId, box: labelBox(label) })
  }
  for (const request of requests) {
    if (request.settings.anchor !== 'auto') continue
    const candidates = AUTO_LABEL_ORDER.map((anchor) => {
      const label = labelAt(request, anchor, objectScale)
      const box = labelBox(label)
      return {
        label,
        clear: !boxes.some((other) => boxesOverlap(box, other.box)) &&
          !obstacles.some((obstacle) => obstacle.ownerId !== request.ownerId && circleOverlaps(box, obstacle)),
        outside: !areas.some((area) => boxOverlapsArea(box, area)),
      }
    })
    const chosen = candidates.find(({ clear, outside }) => clear && outside) ??
      candidates.find(({ clear }) => clear) ??
      candidates.find(({ outside }) => outside)
    const label = chosen?.label ?? labelAt(request, 'top-right', objectScale)
    placed.set(request.key, label)
    boxes.push({ ownerId: request.ownerId, box: labelBox(label) })
  }
  return placed
}
