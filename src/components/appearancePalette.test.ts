import { describe, expect, it } from 'vitest'
import { describeVga2Entity } from '../geometry/vga2Interpretation'
import type { StandardVga2Entity } from '../geometry/vga2Interpretation'
import {
  DEFAULT_OBJECT_STYLES,
  defaultStyleForKind,
  paletteEntry,
  RAMP_ORDER,
  resolveItemAppearance,
  STUDIO_COLORS,
} from './appearancePalette'

const entities: readonly StandardVga2Entity[] = [
  { kind: 'scalar', value: 0, approximated: false },
  { kind: 'vector-2d', x: 1, y: 0, approximated: false },
  { kind: 'bivector-2d', value: 1, approximated: false },
  { kind: 'rotor-2d', scalar: 1, bivector: 0, approximated: false },
  { kind: 'mixed-multivector' },
]

describe('default object styles', () => {
  it('documents every semantic kind the interpretation can produce', () => {
    const documented = DEFAULT_OBJECT_STYLES.map(([kind]) => kind)

    for (const entity of entities) {
      expect(documented).toContain(describeVga2Entity(entity))
    }
    expect(documented).toContain('List')
  })

  it('names a real palette entry for every documented kind', () => {
    for (const [kind, style] of DEFAULT_OBJECT_STYLES) {
      expect(paletteEntry(style), `${kind} uses unknown style ${style}`)
        .toBeDefined()
    }
  })

  it('resolves each documented kind to its documented style', () => {
    for (const [kind, style] of DEFAULT_OBJECT_STYLES) {
      expect(defaultStyleForKind(kind)).toBe(style)
    }
  })

  it('applies the list style to a counted list kind', () => {
    expect(defaultStyleForKind('List (3)')).toBe(defaultStyleForKind('List'))
  })

  it('falls back to a defined style for an unknown kind', () => {
    expect(paletteEntry(defaultStyleForKind('Trivector'))).toBeDefined()
  })
})

describe('resolveItemAppearance', () => {
  it('draws the declared name when no label text is stored', () => {
    const resolved = resolveItemAppearance(undefined, 'Vector', 'V')
    expect(resolved.displayLabel).toBe('V')
    expect(resolved.labelVisible).toBe(false)
  })

  it('keeps stored label text authoritative for editing and drawing', () => {
    const resolved = resolveItemAppearance({ label: 'Velocity' }, 'Vector', 'V')

    expect(resolved.label).toBe('Velocity')
    expect(resolved.displayLabel).toBe('Velocity')
  })

  it('returns to the declared name when label text is cleared', () => {
    const resolved = resolveItemAppearance({ label: '' }, 'Vector', 'V')

    expect(resolved.label).toBe('')
    expect(resolved.displayLabel).toBe('V')
  })
})

describe('style registry', () => {
  it('orders nine hues of six shades', () => {
    expect(RAMP_ORDER).toEqual(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'neutral'])
    expect(STUDIO_COLORS.map(({ id }) => id)).toEqual(
      RAMP_ORDER.flatMap((ramp) => [1, 2, 3, 4, 5, 6].map((shade) => `${ramp}-${shade}`)),
    )
  })

  it('uses the validated values of the four new hues', () => {
    const hexes = (ramp: string) => STUDIO_COLORS.filter((entry) => entry.ramp === ramp).map(({ hex }) => hex)
    expect(hexes('orange')).toEqual(['#FDE3CF', '#F9C08E', '#F2914A', '#E06A12', '#A84E0D', '#6E3308'])
    expect(hexes('teal')).toEqual(['#CDF1F0', '#93DEDB', '#45C0BB', '#0E9E99', '#0A7470', '#064A48'])
    expect(hexes('purple')).toEqual(['#E9DDFA', '#CDB3F3', '#A47FE6', '#7B4BD0', '#5A339C', '#3A2066'])
    expect(hexes('pink')).toEqual(['#FBDCEF', '#F5ABD7', '#E86AB5', '#CC2E8E', '#9A1F6A', '#651345'])
  })

  it('keeps the values of the five existing hues', () => {
    expect(paletteEntry('red-4')?.hex).toBe('#C30A3A')
    expect(paletteEntry('blue-4')?.hex).toBe('#1482C8')
    expect(paletteEntry('green-4')?.hex).toBe('#0F9D57')
    expect(paletteEntry('yellow-4')?.hex).toBe('#E8A000')
    expect(paletteEntry('neutral-4')?.hex).toBe('#8B93A4')
  })
})

describe('list primitive styles', () => {
  it('draws a list from its points block', () => {
    const resolved = resolveItemAppearance(
      { primitiveStyles: { points: { connection: 'open-polyline', visible: false } } }, 'List (3)', 'P',
    )
    expect(resolved.pointListDisplay).toBe('open-polyline')
    expect(resolved.pointMarkersVisible).toBe(false)
  })

  it('defaults to separate visible markers', () => {
    const resolved = resolveItemAppearance(undefined, 'List (3)', 'P')
    expect(resolved.pointListDisplay).toBe('none')
    expect(resolved.pointMarkersVisible).toBe(true)
  })
})
