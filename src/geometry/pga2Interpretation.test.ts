import { describe, expect, it } from 'vitest'
import { createPga2Engine, PGA_2D_BASIS } from '../algebra/pgaEngine'
import { line, point, scale, type Pga2Coefficients } from '../algebra/pga2ReferenceFixtures'
import { ownedMultivector } from '../domain/multivector'
import {
  detailPga2Entity,
  interpretPga2,
  pga2Residue,
  PGA_2D_INTERPRETATION,
  STANDARD_PGA2_CLASSIFICATION_POLICY,
} from './pga2Interpretation'

const owned = (coefficients: Pga2Coefficients) => ownedMultivector(coefficients, PGA_2D_BASIS)
const engine = createPga2Engine()
const c = (values: Partial<Record<'e' | 'e0' | 'e1' | 'e2' | 'e01' | 'e02' | 'e12' | 'e012', number>>) =>
  owned(['e', 'e0', 'e1', 'e2', 'e01', 'e02', 'e12', 'e012'].map((name) => values[name as keyof typeof values] ?? 0) as unknown as Pga2Coefficients)

describe('standard PGA(2) interpretation', () => {
  it('classifies every entity kind of PGA-INT-003', () => {
    expect(interpretPga2(owned([0, 0, 0, 0, 0, 0, 0, 0]))).toMatchObject({ kind: 'scalar', value: 0 })
    expect(interpretPga2(c({ e: 3 }))).toMatchObject({ kind: 'scalar', value: 3 })
    expect(interpretPga2(owned(point(1, 2)))).toMatchObject({ kind: 'euclidean-point', x: 1, y: 2, weight: 1 })
    expect(interpretPga2(owned(point(3, 4, 0)))).toMatchObject({ kind: 'ideal-point', x: 3, y: 4 })
    expect(interpretPga2(owned(line(1, -1, 2)))).toMatchObject({ kind: 'euclidean-line', a: 1, b: -1, c: 2 })
    expect(interpretPga2(owned(line(0, 0, -2)))).toMatchObject({ kind: 'line-at-infinity', c: -2 })
    expect(interpretPga2(c({ e: Math.SQRT1_2, e12: -Math.SQRT1_2 }))).toMatchObject({ kind: 'rotor' })
    expect(interpretPga2(c({ e: 1, e01: -1.5 }))).toMatchObject({ kind: 'translator' })
    expect(interpretPga2(engine.multiply(c({ e: 1, e01: -0.5, e02: -1 }), c({ e: Math.SQRT1_2, e12: -Math.SQRT1_2 }))))
      .toMatchObject({ kind: 'motor' })
    expect(interpretPga2(c({ e2: 1, e012: -0.5 }))).toMatchObject({ kind: 'reflection' })
    expect(interpretPga2(c({ e: 1, e1: 1 }))).toMatchObject({ kind: 'mixed-multivector' })
    expect(interpretPga2(c({ e: 2, e12: 1 }))).toMatchObject({ kind: 'mixed-multivector' })
  })

  it('applies the tolerance to the Euclidean norm first, then the ideal norm', () => {
    const almostIdeal = owned([0, 0, 0, 0, 2, -1, 1e-12, 0])
    expect(interpretPga2(almostIdeal)).toMatchObject({ kind: 'ideal-point', approximated: true })
    const almostAtInfinity = owned([0, 5, 1e-12, 0, 0, 0, 0, 0])
    expect(interpretPga2(almostAtInfinity)).toMatchObject({ kind: 'line-at-infinity', approximated: true })
    const nearlyPoint = owned([1e-12, 0, 0, 0, 2, -1, 1, 0])
    expect(interpretPga2(nearlyPoint)).toMatchObject({ kind: 'euclidean-point', approximated: true })
    expect(interpretPga2(owned(point(1, 2)))).toMatchObject({ approximated: false })
  })

  it('describes projective equivalence through position and weight or scale', () => {
    const doubled = interpretPga2(owned(scale(point(1, 2), 2)))
    expect(doubled).toMatchObject({ kind: 'euclidean-point', weight: 2 })
    expect(detailPga2Entity(doubled)).toBe('at (1, 2), weight 2')
    const reflected = interpretPga2(engine.sandwich(engine.basisBlade('e1'), owned(point(1, 0))))
    expect(reflected).toMatchObject({ kind: 'euclidean-point', weight: -1 })
    expect(detailPga2Entity(reflected)).toBe('at (-1, 0), weight -1')
    expect(detailPga2Entity(interpretPga2(owned(line(3, 4, -10))))).toBe('scale 5')
    expect(detailPga2Entity(interpretPga2(owned(line(1, -1, 0))))).toBe('scale 1.41421')
    expect(detailPga2Entity(interpretPga2(owned(line(0.6, 0.8, -2))))).toBeNull()
    expect(detailPga2Entity(interpretPga2(owned(point(3, 4, 0))))).toBe('direction (3, 4)')
    expect(detailPga2Entity(interpretPga2(c({ e: 1 })))).toBeNull()
  })

  it('gives ideal points, and only them, a rendering position and a head', () => {
    const interpretation = PGA_2D_INTERPRETATION
    const p = interpretation.interpret(owned(scale(point(1, 2), 2)))
    const d = interpretation.interpret(owned(point(3, 4, 0)))
    const l = interpretation.interpret(owned(line(0, 1, -2)))
    expect(interpretation.supportsPosition(p)).toBe(false)
    expect(interpretation.supportsHead(p)).toBe(false)
    expect(interpretation.supportsPosition(d)).toBe(true)
    expect(interpretation.supportsHead(d)).toBe(true)
    expect(interpretation.supportsPosition(l)).toBe(false)
    // A position is an exact Euclidean point; its head is position + value.
    expect(interpretation.isPositionValue(owned(point(1, 2)))).toBe(true)
    expect(interpretation.isPositionValue(owned(scale(point(1, 2), 3)))).toBe(true)
    expect(interpretation.isPositionValue(owned(point(3, 4, 0)))).toBe(false)
    expect(interpretation.isPositionValue(owned(line(1, 0, 0)))).toBe(false)
    expect(interpretation.positionOf(owned(scale(point(1, 2), 2)))).toEqual({ x: 1, y: 2 })
    expect(interpretation.positionOf(interpretation.positionValue({ x: 4, y: -5 }, PGA_2D_BASIS))).toEqual({ x: 4, y: -5 })
    const head = engine.add(interpretation.positionValue({ x: 1, y: 1 }, PGA_2D_BASIS), owned(point(3, 4, 0)))
    expect(interpretation.interpret(head)).toMatchObject({ kind: 'euclidean-point', x: 4, y: 5, weight: 1 })
    expect(interpretation.formatPosition('1', '2')).toBe('point(1, 2)')
    // A weighted point(x, y, w) is edited too; point(x, y, 0) is the ideal
    // point, edited like ipoint(x, y) (#181).
    expect(interpretation.literalEdit(p)).toEqual({ constructor: 'point', arity: 2, weightedConstructor: 'point' })
    expect(interpretation.literalEdit(d)).toEqual({ constructor: 'ipoint', arity: 2, weightedConstructor: 'point' })
    expect(interpretation.literalEdit(l)).toEqual({ constructor: 'line', arity: 3 })
  })

  it('maps entities to the PGA primitives', () => {
    const interpretation = PGA_2D_INTERPRETATION
    const p = interpretation.interpret(owned(scale(point(1, 2), 2)))
    expect(interpretation.toPrimitive(p, { accessibleName: 'P', position: { x: 0, y: 0 } }))
      .toEqual({ kind: 'point-marker', point: { x: 1, y: 2 }, accessibleName: 'P' })
    const l = interpretation.interpret(owned(line(0, 1, -2)))
    expect(interpretation.toPrimitive(l, { accessibleName: 'L', position: { x: 0, y: 0 } }))
      .toMatchObject({ kind: 'unbounded-line', point: { x: 0, y: 2 }, direction: { x: -1, y: 0 } })
    const d = interpretation.interpret(owned(point(3, 4, 0)))
    expect(interpretation.toPrimitive(d, { accessibleName: 'D', position: { x: 1, y: 1 } }))
      .toEqual({ kind: 'ideal-point', position: { x: 1, y: 1 }, direction: { x: 0.6, y: 0.8 }, magnitude: 5, accessibleName: 'D' })
    const infinity = interpretation.interpret(owned(line(0, 0, 1)))
    expect(interpretation.toPrimitive(infinity, { accessibleName: 'I', position: { x: 0, y: 0 } }))
      .toEqual({ kind: 'line-at-infinity', accessibleName: 'I' })
    expect(interpretation.visualization(infinity)).toEqual({ status: 'available' })
    expect(interpretation.visualization(interpretation.interpret(c({ e: 2 })))).toEqual({ status: 'non-spatial' })
    expect(interpretation.defaultName(l, 0)).toBe('Line 1')
    expect(interpretation.defaultName(d, 1)).toBe('Direction 2')
    expect(interpretation.creation).toEqual({ constructor: 'point', objectName: 'Point' })
    expect(interpretation.model).toBe('plane-based')
  })
})

/*
 * The audit of #68: the VGA(2) tolerance measured the weight, which decides
 * Euclidean or ideal, against the bulk, which grows with the distance from
 * the origin. Each fixture records the classification of a value written or
 * computed in a real document.
 */
describe('PGA(2) classification policy (#68)', () => {
  it('has its own constants: the VGA ones for the bulk, a finer relative term for the weight', () => {
    expect(STANDARD_PGA2_CLASSIFICATION_POLICY).toEqual({ absoluteFloor: 1e-10, relativeTerm: 1e-6, weightRelativeTerm: 1e-9 })
  })

  it('keeps far Euclidean points and lines Euclidean, up to the horizon of about 1E+9 units', () => {
    expect(interpretPga2(owned(point(1e6, 0)))).toMatchObject({ kind: 'euclidean-point', approximated: false })
    expect(interpretPga2(owned(point(1e8, -3e8)))).toMatchObject({ kind: 'euclidean-point', approximated: false })
    expect(interpretPga2(owned(line(1, 0, -1e6)))).toMatchObject({ kind: 'euclidean-line', approximated: false })
    // The join of two far points is a far line, not the line at infinity.
    expect(interpretPga2(engine.regressive(owned(point(1e6, 0)), owned(point(1e6, 1)))))
      .toMatchObject({ kind: 'euclidean-line' })
    // A point with an authored small weight is a far point.
    expect(interpretPga2(owned(point(1, 1, 1e-7)))).toMatchObject({ kind: 'euclidean-point', weight: 1e-7 })
    // Beyond the horizon, the weight is residue: the point reads as ideal, approximated.
    expect(interpretPga2(owned(point(1e10, 0)))).toMatchObject({ kind: 'ideal-point', approximated: true })
    expect(interpretPga2(owned(line(1, 0, -1e10)))).toMatchObject({ kind: 'line-at-infinity', approximated: true })
  })

  it('still reads the meet of parallel lines computed by a motor as an ideal point', () => {
    // line(1, 2, 3) and its image under a half turn about (5, 7), as evaluated.
    const meet = owned([0, 0, 0, 0, -44, -88, 8.881784197001252e-16, 0])
    expect(interpretPga2(meet)).toMatchObject({ kind: 'ideal-point', x: 88, y: -44, approximated: true })
    const quarterTurns = owned([0, 0, 0, 0, -15, -30, 1.7763568394002505e-15, 0])
    expect(interpretPga2(quarterTurns)).toMatchObject({ kind: 'ideal-point', approximated: true })
    // Lines of weight 1000 leak about 1E-10 into the weight of their meet; it
    // stays ideal unless the lines are closer than about 1E-4 units.
    const heavy = owned([0, 0, 0, 0, -1000, -2000, 2e-10, 0])
    expect(interpretPga2(heavy)).toMatchObject({ kind: 'ideal-point' })
  })

  it('keeps complete turns, and turns about a far centre, as before', () => {
    const turn = owned([-1, 0, 0, 0, -1.2246e-16, 1.2246e-16, -1.2246e-16, 0])
    expect(interpretPga2(turn)).toMatchObject({ kind: 'scalar', value: -1, approximated: true })
    const farTurn = owned([-1, 0, 0, 0, -1.2246e-12, 1.2246e-12, -1.2246e-16, 0])
    expect(interpretPga2(farTurn)).toMatchObject({ kind: 'scalar', value: -1, approximated: true })
    expect(interpretPga2(owned([0, 0, 0, 0, 2, -1, 1, 0]))).toMatchObject({ kind: 'euclidean-point', approximated: false })
  })

  it('reports as residue exactly the coefficients the classification ignored', () => {
    expect(pga2Residue(owned(point(1e6, 0)))).toEqual([false, false, false, false, false, false, false, false])
    expect(pga2Residue(owned([0, 0, 0, 0, -44, -88, 8.881784197001252e-16, 0])))
      .toEqual([false, false, false, false, false, false, true, false])
    expect(PGA_2D_INTERPRETATION.residue(owned([-1, 0, 0, 0, -1.2246e-16, 1.2246e-16, -1.2246e-16, 0])))
      .toEqual([false, false, false, false, true, true, true, false])
  })
})
