import { describe, expect, it } from 'vitest'
import {
  anchorKey,
  findAnchorCandidates,
  nearbyAnchors,
  rearmAnchors,
  selectAnchor,
  type AnchorProximity,
} from './anchoring'
import type { RenderedPrimitive } from './layout'

const viewport = { width: 640, height: 480, centerX: 0, centerY: 0, pixelsPerUnit: 72 }

/** A named vector `id` from the origin to (x, y). */
function vector(id: string, x: number, y: number): RenderedPrimitive {
  return {
    id,
    primitive: { kind: 'oriented-segment', start: { x: 0, y: 0 }, end: { x, y }, accessibleName: id },
  } as unknown as RenderedPrimitive
}

function proximity(pointer: Readonly<{ x: number; y: number }>): AnchorProximity {
  return {
    draggedId: 'W',
    rendered: [vector('V', 2, 1), vector('W', 1, 0)],
    viewport,
    pointer,
    cssScale: { x: 1, y: 1 },
    nameOf: (id) => id,
  }
}

describe('anchor disarming (#100)', () => {
  it('does not offer an anchor the drag started on until the pointer has left it', () => {
    // The press lands on the shared origin, where V.position is.
    const start = proximity({ x: 320, y: 240 })
    const disarmed = new Set(nearbyAnchors(start).map(anchorKey))
    expect([...disarmed]).toEqual(['V:position'])

    // A small separating move stays near V.position: it is not taken.
    const near = proximity({ x: 330, y: 240 })
    const stillDisarmed = rearmAnchors(disarmed, nearbyAnchors(near))
    expect(stillDisarmed.has('V:position')).toBe(true)
    expect(selectAnchor(findAnchorCandidates({
      ...near, disarmed: stillDisarmed, isValid: () => true,
    }), null)).toBeNull()

    // Once the pointer has left the retain radius, coming back links again.
    const away = rearmAnchors(stillDisarmed, nearbyAnchors(proximity({ x: 400, y: 240 })))
    expect(away.size).toBe(0)
    const back = proximity({ x: 325, y: 240 })
    expect(selectAnchor(findAnchorCandidates({
      ...back, disarmed: away, isValid: () => true,
    }), null)?.targetName).toBe('V')
  })

  it('still offers the other anchors during a separating drag', () => {
    const disarmed = new Set(['V:position'])
    const head = proximity({ x: 464, y: 168 })
    expect(selectAnchor(findAnchorCandidates({
      ...head, disarmed, isValid: () => true,
    }), null)).toMatchObject({ targetName: 'V', property: 'head' })
  })
})
