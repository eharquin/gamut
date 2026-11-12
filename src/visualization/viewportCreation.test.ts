import { describe, expect, it } from 'vitest'
import {
  creationSource,
  formatViewportCoordinate,
  nextObjectName,
  vectorCreationSource,
  viewportCoordinateDecimals,
  weightedViewportCoordinates,
} from './viewportCreation'
import { MAX_PIXELS_PER_UNIT, MIN_PIXELS_PER_UNIT } from './viewport'

describe('viewport vector creation', () => {
  it('names created objects A to Z, then A1 to Z1, skipping declared names', () => {
    expect(nextObjectName([])).toBe('A')
    expect(nextObjectName([
      'A = point(1, 2)',
      '  B = vector(3, 0)',
      'Cvalue = 2',
      'c = 3',
      'vector(1, 1)',
    ])).toBe('C')
    const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    expect(nextObjectName(alphabet.map((letter) => `${letter} = 1`))).toBe('A1')
    expect(nextObjectName([
      ...alphabet.map((letter) => `${letter} = 1`),
      'A1 = 1',
      'B1 = 1',
    ])).toBe('C1')
    expect(nextObjectName([
      ...alphabet.map((letter) => `${letter} = 1`),
      ...alphabet.map((letter) => `${letter}1 = 1`),
    ])).toBe('A2')
  })

  it('rounds coordinates to about one screen pixel: round(log10(pixelsPerUnit)) decimals, from 0 to 8', () => {
    // pixels per unit -> decimals, across the zoom range.
    expect([
      MIN_PIXELS_PER_UNIT, 1, 3.16, 3.17, 16, 31.6, 32, 72, 160, 316, 317, 1000, 3162, 3163, MAX_PIXELS_PER_UNIT,
    ].map(viewportCoordinateDecimals)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 6])
    expect(viewportCoordinateDecimals(1e12)).toBe(8)

    // About five units across a 500 to 1500 px canvas: two decimals.
    for (const pixelsPerUnit of [100, 160, 300])
      expect(formatViewportCoordinate(-0.9553, pixelsPerUnit)).toBe('-0.96')
    expect(formatViewportCoordinate(1 / 3, 16)).toBe('0.3')
    expect(formatViewportCoordinate(1 / 3, 72)).toBe('0.33')
    expect(formatViewportCoordinate(1 / 3, 1000)).toBe('0.333')
    expect(formatViewportCoordinate(1 / 3, MIN_PIXELS_PER_UNIT)).toBe('0')
    expect(formatViewportCoordinate(1 / 3, MAX_PIXELS_PER_UNIT)).toBe('0.333333')
    expect(formatViewportCoordinate(1e-6, MAX_PIXELS_PER_UNIT)).toBe('0.000001')
  })

  it('removes trailing zeroes and writes negative zero as 0', () => {
    expect(formatViewportCoordinate(1.5, 160)).toBe('1.5')
    expect(formatViewportCoordinate(2, 160)).toBe('2')
    expect(formatViewportCoordinate(-0.004, 160)).toBe('0')
    expect(formatViewportCoordinate(-0, 72)).toBe('0')
  })

  it('creates a point at the visible precision', () => {
    expect(creationSource('point', 'K', { x: -0.95531, y: -0.86449 }, 160)).toBe('K = point(-0.96, -0.86)')
    expect(creationSource('point', 'K', { x: -0.95531, y: -0.86449 }, 1000)).toBe('K = point(-0.955, -0.864)')
    expect(creationSource('point', 'K', { x: -0.95531, y: -0.86449 }, 16)).toBe('K = point(-1, -0.9)')
  })

  it('builds documented VGA vector source', () => {
    expect(vectorCreationSource('V4', { x: 1.25, y: -2.5 }, 72))
      .toBe('V4 = vector(1.25, -2.5)')
  })
})

describe('weighted point drag coordinates (#181)', () => {
  it('multiplies the pointer by the weight, with the step scaled by |w|', () => {
    // At 100 pixels per unit, a pointer at (3, 1) over point(x, y, 2).
    expect(weightedViewportCoordinates({ x: 3, y: 1 }, 2, 100)).toEqual([6, 2])
    // X·w is formatted at the scale 100 / |w| = 50 pixels per unit, the
    // creation rule for a step of |w| / 100.
    expect(weightedViewportCoordinates({ x: 1.234, y: -0.456 }, 2, 100))
      .toEqual([Number(formatViewportCoordinate(2.468, 50)), Number(formatViewportCoordinate(-0.912, 50))])
    expect(weightedViewportCoordinates({ x: 1.234, y: -0.456 }, 20, 100)).toEqual([24.7, -9.1])
    expect(weightedViewportCoordinates({ x: 1.234, y: -0.456 }, 1, 100)).toEqual([1.23, -0.46])
    expect(weightedViewportCoordinates({ x: 1.234, y: -0.456 }, 1, 100))
      .toEqual([Number(formatViewportCoordinate(1.234, 100)), Number(formatViewportCoordinate(-0.456, 100))])
  })

  it('keeps the sign of a negative weight and refines a fractional one', () => {
    expect(weightedViewportCoordinates({ x: 3, y: 1 }, -1, 100)).toEqual([-3, -1])
    expect(weightedViewportCoordinates({ x: 1.234, y: 2 }, 0.5, 100))
      .toEqual([Number(formatViewportCoordinate(0.617, 200)), 1])
    expect(weightedViewportCoordinates({ x: 1.2345, y: 2 }, 0.01, 100)).toEqual([0.0123, 0.02])
  })
})
