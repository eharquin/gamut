import type { Point2d } from '../geometry/interpretation'
import type { RenderedPrimitive } from './layout'
import type { VisualizationPrimitive } from './primitives'
import { toScreen, type Viewport2d } from './viewport'

export type AnchorProperty = 'position' | 'head'

export type AnchorCandidate = Readonly<{
  draggedId: string
  targetId: string
  targetName: string
  property: AnchorProperty
  point: Point2d
  mathematical: Point2d
  order: number
  distance: number
}>

/** Snap radius for taking a new anchor and the wider radius that keeps one (INTERACT2D). */
export const ANCHOR_SNAP_DISTANCE = 16
export const ANCHOR_RETAIN_DISTANCE = 22

/** The points of a primitive another object's base may anchor to, in property order. */
export function anchorPoints(
  primitive: VisualizationPrimitive,
): readonly Readonly<{ property: AnchorProperty; mathematical: Point2d }>[] {
  switch (primitive.kind) {
    case 'oriented-segment':
      return [
        { property: 'position', mathematical: primitive.start },
        { property: 'head', mathematical: primitive.end },
      ]
    case 'oriented-area':
      return [{
        property: 'position',
        mathematical: primitive.shape.kind === 'loop'
          ? primitive.shape.center
          : primitive.shape.vertices[0],
      }]
    case 'point-marker':
      return [{ property: 'position', mathematical: primitive.point }]
    case 'ideal-point':
      return [
        { property: 'position', mathematical: primitive.position },
        {
          property: 'head',
          mathematical: {
            x: primitive.position.x + primitive.direction.x * primitive.magnitude,
            y: primitive.position.y + primitive.direction.y * primitive.magnitude,
          },
        },
      ]
    case 'unbounded-line':
    case 'line-at-infinity':
      return []
  }
}

/** The base of a primitive: where a head drag measures its components from. */
export function primitiveBase(primitive: VisualizationPrimitive): Point2d | null {
  return anchorPoints(primitive).find((anchor) => anchor.property === 'position')?.mathematical ?? null
}

/** Identifies an anchor point of a target across pointer moves. */
export const anchorKey = (anchor: Pick<AnchorCandidate, 'targetId' | 'property'>): string =>
  `${anchor.targetId}:${anchor.property}`

export type AnchorProximity = Readonly<{
  draggedId: string
  rendered: readonly RenderedPrimitive[]
  viewport: Viewport2d
  /** Screen-space pointer in viewport coordinates. */
  pointer: Point2d
  /** CSS pixels per viewport unit on each axis, so distances are in CSS pixels. */
  cssScale: Point2d
  /** Declared name of a document item, or `null` when it cannot be referenced. */
  nameOf(itemId: string): string | null
}>

export type AnchorSearch = AnchorProximity & Readonly<{
  /** Whether linking the dragged base to `target.property` evaluates validly. */
  isValid(candidate: AnchorCandidate): boolean
  /** Anchors that cannot be taken yet, by {@link anchorKey}. */
  disarmed?: ReadonlySet<string>
}>

/**
 * Lists the anchors within the retain radius of the pointer, nearest first,
 * excluding list elements and the dragged object itself, without checking
 * whether linking to them is valid.
 */
export function nearbyAnchors(search: AnchorProximity): readonly AnchorCandidate[] {
  return search.rendered.flatMap((rendered) => {
    if (rendered.id.includes(':') || rendered.id === search.draggedId) return []
    const targetName = search.nameOf(rendered.id)
    if (!targetName) return []
    return anchorPoints(rendered.primitive).map(({ property, mathematical }, order): AnchorCandidate => {
      const point = toScreen(search.viewport, mathematical)
      return {
        draggedId: search.draggedId,
        targetId: rendered.id,
        targetName,
        property,
        point,
        mathematical,
        order,
        distance: Math.hypot(
          (search.pointer.x - point.x) * search.cssScale.x,
          (search.pointer.y - point.y) * search.cssScale.y,
        ),
      }
    })
  })
    .filter((candidate) => candidate.distance <= ANCHOR_RETAIN_DISTANCE)
    .sort((left, right) => left.distance - right.distance ||
      left.targetId.localeCompare(right.targetId) || left.order - right.order)
}

/**
 * Lists the anchors within the retain radius of the pointer that may be
 * taken, nearest first: not disarmed, and valid to link to.
 */
export function findAnchorCandidates(search: AnchorSearch): readonly AnchorCandidate[] {
  return nearbyAnchors(search)
    .filter((candidate) => !search.disarmed?.has(anchorKey(candidate)))
    .filter((candidate) => search.isValid(candidate))
}

/**
 * A base drag separates its object from the anchors it starts on (#100):
 * every anchor within the retain radius of the press is disarmed, and stays
 * so until the pointer has left its retain radius once. Returns the anchors
 * still disarmed, given those near the pointer now.
 */
export function rearmAnchors(
  disarmed: ReadonlySet<string>,
  nearby: readonly AnchorCandidate[],
): ReadonlySet<string> {
  if (disarmed.size === 0) return disarmed
  const near = new Set(nearby.map(anchorKey))
  return new Set([...disarmed].filter((key) => near.has(key)))
}

/**
 * Keeps the previously previewed anchor while it stays within the retain
 * radius; otherwise takes the nearest candidate within the snap radius.
 */
export function selectAnchor(
  candidates: readonly AnchorCandidate[],
  previous: AnchorCandidate | null,
): AnchorCandidate | null {
  const retained = previous
    ? candidates.find((candidate) =>
        candidate.targetId === previous.targetId &&
        candidate.property === previous.property) ?? null
    : null
  if (retained) return retained
  const nearest = candidates[0]
  return nearest && nearest.distance <= ANCHOR_SNAP_DISTANCE ? nearest : null
}
