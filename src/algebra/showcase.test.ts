import { describe, expect, it } from 'vitest'
import { evaluateDocument } from '../application/evaluateDocument'
import { expressionDocument } from '../document/expressionDocument'
import { fromCanonicalDocument } from '../document/canonicalDocument'
import { readExamples } from '../examples'
import { createBuiltinAlgebraRegistry, DEFAULT_ALGEBRA_ID } from './builtinAlgebras'
import { OPAQUE_INTERPRETATION } from '../geometry/interpretation'

/** The triangle of the PGA(2) showcase, as first shipped. */
const TRIANGLE = [
  'A = point(-2, 1)', 'B = point(2, 2)', 'C = point(1, -2)', 'L = A & B', 'M = A & C',
  'dAB = norm(A & B)', 'dBC = norm(B & C)', 'alpha = atan2((L ^ M).e12, L | M)', 'deg = alpha * 180 / pi',
  'hC = (L ^ C).e012 / norm(L)', 'area = (A & B & C) / 2', 'N = line(1, 0, -1)', 'beta = atan2((L ^ N).e12, L | N)',
  'R = sqrt(M * L / (norm(M) * norm(L)))', 't = 0.5', 'S = exp(t * log(R)) >>> B',
]
const triangleItems = (sources: readonly string[]) => sources.map((source, index) => ({ id: `item-${index + 1}`, source }))

describe('definition showcases', () => {
  const registry = createBuiltinAlgebraRegistry()

  for (const definition of registry.definitions()) {
    it(`${definition.badge}: its showcase example evaluates every row and draws`, () => {
      const example = readExamples().examples.find((candidate) => candidate.id === definition.showcaseExampleId)!
      const document = fromCanonicalDocument(example.document).document
      const resolution = registry.resolve(document.algebra)
      const interpretation = registry.resolveInterpretation(document.interpretation)
      if (resolution.status !== 'resolved' || interpretation.status !== 'resolved') throw new Error('unresolved')
      const evaluated = evaluateDocument(document, { engine: resolution.engine, interpretation: interpretation.interpretation })
      const invalid = evaluated.filter((item) => item.item.kind !== 'annotation' && item.evaluation?.status !== 'valid')
      expect(invalid.map((item) => item.item.source)).toEqual([])
      const drawn = evaluated.filter((item) => item.evaluation?.status === 'valid' && item.evaluation.valueType === 'single' && item.evaluation.primitive)
      expect(drawn.length).toBeGreaterThanOrEqual(2)
    })
  }

  it('makes the default algebra an explicit, registered choice', () => {
    expect(registry.definitions().map((definition) => definition.algebraId)).toContain(DEFAULT_ALGEBRA_ID)
  })

  // The triangle formulas, kept here as written, check the PGA(2) engine whatever the shipped example becomes.
  it('PGA triangle classifies its rows as the documented kinds', () => {
    const resolution = registry.resolve({ algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: {} })
    const interpretation = registry.resolveInterpretation({ interpretationId: 'org.multivector.pga-2d', interpretationVersion: 1 })
    if (resolution.status !== 'resolved' || interpretation.status !== 'resolved') throw new Error('unresolved')
    const document = { ...expressionDocument(triangleItems(TRIANGLE)), algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } } }
    const kinds = evaluateDocument(document, { engine: resolution.engine, interpretation: interpretation.interpretation })
      .map((item) => item.evaluation?.status === 'valid' && item.evaluation.valueType === 'single'
        ? interpretation.interpretation.describe(item.evaluation.entity) : '?')
    expect(kinds).toEqual([
      'Point', 'Point', 'Point', 'Line', 'Line', 'Scalar', 'Scalar', 'Scalar', 'Scalar', 'Scalar', 'Scalar', 'Line', 'Scalar',
      'Motor', 'Scalar', 'Point',
    ])
  })

  it('PGA triangle reads the documented distances, angles, height, and area', () => {
    const resolution = registry.resolve({ algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: {} })
    const interpretation = registry.resolveInterpretation({ interpretationId: 'org.multivector.pga-2d', interpretationVersion: 1 })
    if (resolution.status !== 'resolved' || interpretation.status !== 'resolved') throw new Error('unresolved')
    const document = { ...expressionDocument(triangleItems(TRIANGLE)), algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } } }
    const scalars = new Map(evaluateDocument(document, { engine: resolution.engine, interpretation: interpretation.interpretation })
      .flatMap((item) => item.evaluation?.status === 'valid' && item.evaluation.valueType === 'single'
        ? [[item.item.source.split(' = ')[0], item.evaluation.value.coefficients[0]] as const] : []))
    expect(scalars.get('dAB')).toBeCloseTo(Math.hypot(4, 1), 12)
    expect(scalars.get('dBC')).toBeCloseTo(Math.hypot(1, 4), 12)
    // From AB, direction (4, 1), to AC, direction (3, -3): clockwise, about -59°.
    expect(scalars.get('alpha')).toBeCloseTo(Math.atan2(-3, 3) - Math.atan2(1, 4), 12)
    expect(scalars.get('deg')).toBeCloseTo(-59.0362, 3)
    // C lies on the negative side of L = -x + 4y - 6, 15 / √17 away.
    expect(scalars.get('hC')).toBeCloseTo(-15 / Math.sqrt(17), 12)
    // A, B, C run clockwise, so the signed area is negative.
    expect(scalars.get('area')).toBeCloseTo(-7.5, 12)
    // From L, normal (-1, 4), to the vertical line x = 1, normal (1, 0): cos = -1, sin = -4.
    expect(scalars.get('beta')).toBeCloseTo(Math.atan2(-4, -1), 12)
  })

  it('PGA triangle turns B about A onto the side AC through exp(t log R)', () => {
    const resolution = registry.resolve({ algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: {} })
    if (resolution.status !== 'resolved') throw new Error('unresolved')
    const engine = resolution.engine
    const at = (t: string) => {
      const rows = TRIANGLE.map((source) => (source.startsWith('t = ') ? `t = ${t}` : source))
      const document = { ...expressionDocument(triangleItems(rows)), algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } } }
      const values = new Map(evaluateDocument(document, { engine, interpretation: OPAQUE_INTERPRETATION })
        .flatMap((item) => item.evaluation?.status === 'valid' && item.evaluation.valueType === 'single'
          ? [[item.item.source.split(' = ')[0], item.evaluation.value] as const] : []))
      const s = values.get('S')!.coefficients
      return { x: -s[5] / s[6], y: s[4] / s[6], values }
    }
    // R is the rotation about A = (-2, 1) by the signed angle alpha from L to M.
    const { values } = at('0.5')
    const log = engine.scalarFunction('log', [values.get('R')!]).coefficients
    expect(-log[5] / log[6]).toBeCloseTo(-2, 12)
    expect(log[4] / log[6]).toBeCloseTo(1, 12)
    expect(log[6]).toBeCloseTo(-values.get('alpha')!.coefficients[0] / 2, 12)
    expect(at('0')).toMatchObject({ x: expect.closeTo(2, 12), y: expect.closeTo(2, 12) })
    // At t = 1, S lies on AC (direction (3, -3) from A) at the distance AB from A.
    const end = at('1')
    expect(end.x + 2).toBeCloseTo(Math.hypot(4, 1) / Math.SQRT2, 12)
    expect(end.y - 1).toBeCloseTo(-Math.hypot(4, 1) / Math.SQRT2, 12)
  })
})
