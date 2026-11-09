import { describe, expect, it } from 'vitest'
import { AUTO_LABEL_ORDER, DEFAULT_LABEL_SETTINGS, labelAt, labelBox, placeLabels, type LabelRequest, type LabelSettings } from './labels'

const request = (key: string, at = { x: 100, y: 100 }, settings: Partial<LabelSettings> = {}, text = 'P'): LabelRequest => ({
  key, ownerId: key, text, at, settings: { ...DEFAULT_LABEL_SETTINGS, ...settings },
})

describe('label placement', () => {
  it('draws a default top-right label 8 px right of and above its anchor, with nothing else', () => {
    expect(labelAt(request('a'), 'top-right', 1)).toEqual({ text: 'P', x: 108, y: 92 })
    // Defaults do not follow the object scale, as before format version 7.
    expect(labelAt(request('a'), 'top-right', 2)).toEqual({ text: 'P', x: 108, y: 92 })
  })

  it('aligns the text away from its anchor at each of the eight positions', () => {
    const at = (anchor: Parameters<typeof labelAt>[1]) => labelAt(request('a'), anchor, 1)
    expect(at('right')).toEqual({ text: 'P', x: 108, y: 100, baseline: 'middle' })
    expect(at('bottom-right')).toEqual({ text: 'P', x: 108, y: 108, baseline: 'hanging' })
    expect(at('bottom')).toEqual({ text: 'P', x: 100, y: 108, textAnchor: 'middle', baseline: 'hanging' })
    expect(at('bottom-left')).toEqual({ text: 'P', x: 92, y: 108, textAnchor: 'end', baseline: 'hanging' })
    expect(at('left')).toEqual({ text: 'P', x: 92, y: 100, textAnchor: 'end', baseline: 'middle' })
    expect(at('top-left')).toEqual({ text: 'P', x: 92, y: 92, textAnchor: 'end' })
    expect(at('top')).toEqual({ text: 'P', x: 100, y: 92, textAnchor: 'middle' })
  })

  it('scales a set distance and size with the object scale, and keeps the angle', () => {
    expect(labelAt(request('a', undefined, { distance: 10, size: 20, angle: 30 }), 'top-right', 1.5))
      .toEqual({ text: 'P', x: 115, y: 85, fontSize: 30, angle: 30 })
  })

  it('tries top right first, then clockwise', () => {
    expect(AUTO_LABEL_ORDER).toEqual(['top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left', 'top'])
  })

  it('places an automatic label at the first position without collision', () => {
    // Another object's point sits at the top right of the label's anchor.
    const placed = placeLabels([request('a')], [{ ownerId: 'b', center: { x: 112, y: 85 }, radius: 6 }], 1)
    expect(placed.get('a')).toMatchObject({ x: 108, y: 100, baseline: 'middle' })
  })

  it('ignores the points and handles of the labelled object itself', () => {
    const placed = placeLabels([request('a')], [{ ownerId: 'a', center: { x: 100, y: 100 }, radius: 15 }], 1)
    expect(placed.get('a')).toEqual({ text: 'P', x: 108, y: 92 })
  })

  it('avoids labels already placed, fixed ones first', () => {
    const placed = placeLabels([
      request('auto', { x: 100, y: 100 }, {}, 'Auto'),
      request('fixed', { x: 100, y: 100 }, { anchor: 'top-right' }, 'Fixed'),
    ], [], 1)
    expect(placed.get('fixed')).toEqual({ text: 'Fixed', x: 108, y: 92 })
    // Top right is taken, and the box at the right still touches it.
    expect(placed.get('auto')).toEqual({ text: 'Auto', x: 108, y: 108, baseline: 'hanging' })
  })

  it('goes top right when every position collides', () => {
    const everywhere = [{ ownerId: 'b', center: { x: 100, y: 100 }, radius: 200 }]
    expect(placeLabels([request('a')], everywhere, 1).get('a')).toEqual({ text: 'P', x: 108, y: 92 })
  })

  it('keeps a fixed anchor even when it collides', () => {
    const placed = placeLabels([request('a', undefined, { anchor: 'left' })], [{ ownerId: 'b', center: { x: 90, y: 100 }, radius: 20 }], 1)
    expect(placed.get('a')).toMatchObject({ x: 92, textAnchor: 'end' })
  })

  it('estimates the box from the text, the font size and the alignment', () => {
    expect(labelBox({ text: 'AB', x: 10, y: 50 })).toEqual({ left: 10, top: 50 - 0.8 * 13, right: 10 + 2 * 0.62 * 13, bottom: 50 + 0.2 * 13 })
    expect(labelBox({ text: 'A', x: 10, y: 50, textAnchor: 'end', baseline: 'hanging', fontSize: 10 }))
      .toEqual({ left: 10 - 6.2, top: 50, right: 10, bottom: 60 })
  })
})
