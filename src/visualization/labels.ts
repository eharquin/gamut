import type { LabelAnchor } from '../document/expressionDocument'
import type { Point2d } from '../geometry/interpretation'

/** Label size and offset drawn before format version 7, in screen pixels. */
export const DEFAULT_LABEL_SIZE = 13
export const DEFAULT_LABEL_DISTANCE = 8

/** Placement settings of one object's label; `null` selects the default. */
export type LabelSettings = Readonly<{
  anchor: LabelAnchor
  /** Degrees, counterclockwise. */
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
}

/**
 * Places a label at a fixed anchor. Top right with default settings is the
 * label drawn before version 7: 8 px right of and 8 px above the anchor
 * point, with no other attribute. Sizes and distances are multiplied by the
 * object scale; the defaults are drawn as before at every scale.
 */
export function labelAt(
  request: LabelRequest,
  anchor: FixedAnchor,
  objectScale: number,
): PlacedLabel {
  const { settings } = request
  const distance = settings.distance === null ? DEFAULT_LABEL_DISTANCE : settings.distance * objectScale
  const [dx, dy] = DIRECTIONS[anchor]
  return {
    text: request.text,
    x: request.at.x + dx * distance,
    y: request.at.y + dy * distance,
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

/**
 * Places every label. Labels with a fixed anchor go where they are told.
 * An automatic label takes the first position, in `AUTO_LABEL_ORDER`, where
 * it overlaps no other label and no point or handle of another object; when
 * none is free it goes top right. Labels are placed in document order.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  obstacles: readonly LabelObstacle[],
  objectScale: number,
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
    const free = AUTO_LABEL_ORDER.map((anchor) => labelAt(request, anchor, objectScale)).find((candidate) => {
      const box = labelBox(candidate)
      return !boxes.some((other) => boxesOverlap(box, other.box)) &&
        !obstacles.some((obstacle) => obstacle.ownerId !== request.ownerId && circleOverlaps(box, obstacle))
    })
    const label = free ?? labelAt(request, 'top-right', objectScale)
    placed.set(request.key, label)
    boxes.push({ ownerId: request.ownerId, box: labelBox(label) })
  }
  return placed
}
