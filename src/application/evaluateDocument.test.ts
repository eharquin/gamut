import { describe, expect, it } from 'vitest'
import { createPga2Engine } from '../algebra/pgaEngine'
import { createVga2Engine } from '../algebra/vgaEngine'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { VGA_2D_INTERPRETATION, type Vector2dEntity } from '../geometry/vga2Interpretation'
import { expressionDocument } from '../document/expressionDocument'
import type { ExpressionItem } from '../document/expressionDocument'
import { declarationDependsOn, evaluateDocument } from './evaluateDocument'

const engine = createVga2Engine()
const context = { engine, interpretation: VGA_2D_INTERPRETATION }

function evaluate(...sources: string[]) {
  return evaluateDocument(
    expressionDocument(
      sources.map((source, index) => ({ id: `item-${index + 1}`, source })),
    ),
    context,
  )
}

function evaluateItems(items: readonly ExpressionItem[]) {
  return evaluateDocument(expressionDocument(items), context)
}

describe('document dependency evaluation', () => {
  it('avoids source-truncation noise at the full-turn VGA example endpoint', () => {
    const fullTurn = (angle: string) => evaluate(
      'V1 = vector(0.66, 3.042)',
      `a = ${angle}`,
      'R = exp(0.5*a*e12)',
      'V2 = R >>> V1',
      'B = V1 ^ V2',
    )[4].evaluation
    const precise = fullTurn((Math.PI * 2).toString())
    const truncated = fullTurn(Number((Math.PI * 2).toPrecision(12)).toString())
    if (precise?.status !== 'valid' || precise.valueType !== 'single' ||
        truncated?.status !== 'valid' || truncated.valueType !== 'single') {
      throw new Error('Expected valid full-turn bivectors')
    }
    const preciseResidual = Math.abs(precise.value.coefficients[3])
    const truncatedResidual = Math.abs(truncated.value.coefficients[3])
    expect(preciseResidual).toBeLessThan(1e-12)
    expect(preciseResidual).toBeLessThan(truncatedResidual)
  })

  it('preserves annotations without parsing or evaluating their source', () => {
    const [annotation, expression] = evaluateItems([
      { id: 'note', kind: 'annotation', source: 'This is prose, not an expression!' },
      { id: 'value', source: 'A = e1' },
    ])

    expect(annotation).toMatchObject({
      item: { id: 'note', kind: 'annotation' },
      evaluation: null,
      positionEvaluation: null,
    })
    expect(expression.evaluation).toMatchObject({ status: 'valid', inspection: 'e1' })
  })

  it('preserves but does not apply positions when document position support is disabled', () => {
    const document = expressionDocument([
      { id: 'vector', source: 'V = e1', positionSource: '(4, 5)' },
    ])
    const [vector] = evaluateDocument({
      ...document,
      view: { ...document.view, positionEnabled: false },
    }, context)

    expect(vector.item.positionSource).toBe('(4, 5)')
    expect(vector.positionEvaluation).toBeNull()
    expect(vector.evaluation).toMatchObject({
      status: 'valid',
      entity: { kind: 'vector-2d' },
      primitive: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
    })
  })

  it('applies natural normalization before dependent expressions resolve', () => {
    const [vector, doubled] = evaluateItems([
      { id: 'vector', source: 'V = vector(3, 4)', normalization: 'natural' },
      { id: 'doubled', source: 'W = 2 * V' },
    ])

    if (vector.evaluation?.status !== 'valid' || vector.evaluation.valueType !== 'single' ||
        doubled.evaluation?.status !== 'valid' || doubled.evaluation.valueType !== 'single') {
      throw new Error('Expected valid single values')
    }
    expect(vector.evaluation.value.coefficients).toEqual([
      0, expect.closeTo(0.6), expect.closeTo(0.8), 0,
    ])
    expect(doubled.evaluation.value.coefficients).toEqual([
      0, expect.closeTo(1.2), expect.closeTo(1.6), 0,
    ])
  })

  it('broadcasts named lists and preserves stable derived identities', () => {
    const items = [
      { id: 'list', source: 'L = [e1, e2]' },
      { id: 'sum', source: 'M = L + [e2]' },
      { id: 'selected', source: 'S = M[1]' },
    ]
    const first = evaluateItems(items)
    const second = evaluateItems(items)

    expect(first.map((result) => result.evaluation)).toMatchObject([
      { status: 'valid', inspection: '[e1, e2]' },
      { status: 'valid', inspection: '[e1 + e2, 2e2]' },
      { status: 'valid', inspection: '2e2', elementId: expect.any(String) },
    ])
    const firstList = first[1].evaluation
    const secondList = second[1].evaluation
    if (firstList?.status !== 'valid' || firstList.valueType !== 'list' ||
        secondList?.status !== 'valid' || secondList.valueType !== 'list') return
    expect(firstList.value.elements.map((element) => element.id)).toEqual(
      secondList.value.elements.map((element) => element.id),
    )
  })

  it('distributes positions and heads over vector lists', () => {
    const results = evaluateItems([
      { id: 'vector-1', source: 'V1 = e1', positionSource: '(1, 2)' },
      { id: 'vector-2', source: 'V2 = 2e2', positionSource: '(-1, 3)' },
      { id: 'vectors', source: 'V = [V1, V2]' },
      { id: 'positions', source: 'P = V.position' },
      { id: 'heads', source: 'H = V.head' },
      { id: 'derived', source: 'W = V + e1' },
      { id: 'derived-positions', source: 'WP = W.position' },
      { id: 'derived-heads', source: 'WH = W.head' },
    ])

    expect(results.map((result) => result.evaluation)).toMatchObject([
      { status: 'valid', inspection: 'e1' },
      { status: 'valid', inspection: '2e2' },
      { status: 'valid', inspection: '[e1, 2e2]' },
      { status: 'valid', inspection: '[e1 + 2e2, -e1 + 3e2]' },
      { status: 'valid', inspection: '[2e1 + 2e2, -e1 + 5e2]' },
      {
        status: 'valid',
        inspection: '[2e1, e1 + 2e2]',
        elements: [
          { primitive: { start: { x: 1, y: 2 }, end: { x: 3, y: 2 } } },
          { primitive: { start: { x: -1, y: 3 }, end: { x: 0, y: 5 } } },
        ],
      },
      { status: 'valid', inspection: '[e1 + 2e2, -e1 + 3e2]' },
      { status: 'valid', inspection: '[3e1 + 2e2, 5e2]' },
    ])
    expect(results[2].headInspection).toBe('[2e1 + 2e2, -e1 + 5e2]')
  })

  it('preserves the individual positions of named vectors collected in a list', () => {
    const results = evaluateItems([
      { id: 'vector-1', source: 'V1 = vector(2, 1)', positionSource: '(1, 1)' },
      { id: 'vector-2', source: 'V2 = vector(1, -1)', positionSource: '(0.1, 0.1)' },
      { id: 'list', source: 'L = [V1, V2]', positionSource: '(9, 9)' },
      { id: 'positions', source: 'P = L.position' },
    ])

    expect(results[2].evaluation).toMatchObject({
      status: 'valid',
      inspection: '[2e1 + e2, e1 - e2]',
      elements: [
        { primitive: { start: { x: 1, y: 1 }, end: { x: 3, y: 2 } } },
        { primitive: { start: { x: 0.1, y: 0.1 }, end: { x: 1.1, y: -0.9 } } },
      ],
    })
    expect(results[3].evaluation).toMatchObject({
      status: 'valid',
      inspection: '[e1 + e2, 0.1e1 + 0.1e2]',
    })
  })

  it('reports conflicting inherited list positions without changing values', () => {
    const [,,,, result] = evaluateItems([
      { id: 'vector-a', source: 'VA = e1', positionSource: '(1, 0)' },
      { id: 'vector-b', source: 'VB = e2', positionSource: '(2, 0)' },
      { id: 'a', source: 'A = [VA]' },
      { id: 'b', source: 'B = [VB]' },
      { id: 'sum', source: 'C = A + B' },
    ])

    expect(result.evaluation).toMatchObject({
      status: 'valid', inspection: '[e1 + e2]',
    })
    expect(result.positionEvaluation).toMatchObject({
      status: 'invalid', diagnostic: { code: 'GEOM_POSITION_CONFLICT' },
    })
  })
  it('evaluates named expressions and forward references by dependency order', () => {
    const results = evaluate(
      'B = V1 * V2',
      'V2 = vector(2, 1)',
      'V1 = vector(1, 1)',
    )

    expect(results.map((result) => result.evaluation)).toMatchObject([
      { status: 'valid', inspection: '3 - e12' },
      { status: 'valid', inspection: '2e1 + e2' },
      { status: 'valid', inspection: 'e1 + e2' },
    ])
  })

  it('allows anonymous expressions to reference scalar and multivector values', () => {
    const results = evaluate('S = 12', 'V = e1 + e2', 'S + V')

    expect(results[2].evaluation).toMatchObject({
      status: 'valid',
      inspection: '12 + e1 + e2',
    })
  })

  it('gathers through referenced and computed index lists', () => {
    const results = evaluate(
      'List = [10, 20, 30, 40]',
      'sampling = 4',
      'index = 1',
      'T = [0, 1, 2, 3]',
      'Selected = List[(index - T) % sampling]',
      'I = [3, 1, 1]',
      'Repeated = List[I]',
    )

    expect(results[4].evaluation).toMatchObject({
      status: 'valid', valueType: 'list', inspection: '[20, 10, 40, 30]',
    })
    expect(results[6].evaluation).toMatchObject({
      status: 'valid', valueType: 'list', inspection: '[40, 20, 20]',
    })
  })

  it('preserves selected element positions through gather indexing', () => {
    const results = evaluateItems([
      { id: 'vector-1', source: 'V1 = e1', positionSource: '(1, 2)' },
      { id: 'vector-2', source: 'V2 = 2e2', positionSource: '(-1, 3)' },
      { id: 'vectors', source: 'V = [V1, V2]' },
      { id: 'gather', source: 'G = V[[1, 0, 1]]' },
      { id: 'positions', source: 'P = G.position' },
    ])

    expect(results[3].evaluation).toMatchObject({
      status: 'valid',
      inspection: '[2e2, e1, 2e2]',
      elements: [
        { primitive: { start: { x: -1, y: 3 }, end: { x: -1, y: 5 } } },
        { primitive: { start: { x: 1, y: 2 }, end: { x: 2, y: 2 } } },
        { primitive: { start: { x: -1, y: 3 }, end: { x: -1, y: 5 } } },
      ],
    })
    expect(results[4].evaluation).toMatchObject({
      status: 'valid', inspection: '[-e1 + 3e2, e1 + 2e2, -e1 + 3e2]',
    })
  })

  it('reports undefined names without invalidating unrelated rows', () => {
    const results = evaluate('A = Missing + 1', 'V = e2')

    expect(results[0].evaluation).toMatchObject({
      status: 'invalid',
      diagnostic: {
        code: 'LANG_UNDEFINED_NAME',
        span: { start: 4, end: 11 },
      },
    })
    expect(results[1].evaluation).toMatchObject({
      status: 'valid',
      inspection: 'e2',
    })
  })

  it('reports every duplicate declaration and ambiguous dependent reference', () => {
    const results = evaluate('A = 1', 'A = 2', 'A + e1')

    expect(results.map((result) => result.evaluation)).toMatchObject([
      { status: 'invalid', diagnostic: { code: 'LANG_DUPLICATE_NAME' } },
      { status: 'invalid', diagnostic: { code: 'LANG_DUPLICATE_NAME' } },
      { status: 'invalid', diagnostic: { code: 'LANG_DUPLICATE_NAME' } },
    ])
  })

  it('marks cycles and propagates invalid dependency state', () => {
    const results = evaluate('A = B', 'B = A', 'C = A + 1', 'e2')

    expect(results.map((result) => result.evaluation)).toMatchObject([
      { status: 'invalid', diagnostic: { code: 'LANG_DEPENDENCY_CYCLE' } },
      { status: 'invalid', diagnostic: { code: 'LANG_DEPENDENCY_CYCLE' } },
      { status: 'invalid', diagnostic: { code: 'LANG_INVALID_DEPENDENCY' } },
      { status: 'valid', inspection: 'e2' },
    ])
  })

  it('keeps positions separate and resolves position and head properties', () => {
    const results = evaluateItems([
      {
        id: 'vector',
        source: 'V = vector(2, 1)',
        positionSource: 'vector(-1, 2)',
      },
      { id: 'position', source: 'P = V.position' },
      { id: 'head', source: 'H = V.head' },
    ])

    expect(results[0]).toMatchObject({
      evaluation: {
        status: 'valid',
        inspection: '2e1 + e2',
        primitive: {
          start: { x: -1, y: 2 },
          end: { x: 1, y: 3 },
        },
      },
      positionEvaluation: {
        status: 'valid',
        inspection: '-e1 + 2e2',
      },
      headInspection: 'e1 + 3e2',
    })
    expect(results[1].evaluation).toMatchObject({
      status: 'valid',
      inspection: '-e1 + 2e2',
    })
    expect(results[2].evaluation).toMatchObject({
      status: 'valid',
      inspection: 'e1 + 3e2',
    })
  })

  it('resolves position dependencies independently of row order', () => {
    const results = evaluateItems([
      {
        id: 'vector',
        source: 'V = (2, 1)',
        positionSource: 'P',
      },
      { id: 'position', source: 'P = (-1, 2)' },
      { id: 'head', source: 'V.head' },
    ])

    expect(results[0]).toMatchObject({
      evaluation: {
        status: 'valid',
        primitive: {
          start: { x: -1, y: 2 },
          end: { x: 1, y: 3 },
        },
      },
      positionEvaluation: {
        status: 'valid',
        inspection: '-e1 + 2e2',
      },
    })
    expect(results[2].evaluation).toMatchObject({
      status: 'valid',
      inspection: 'e1 + 3e2',
    })
  })

  it('detects cycles across position nodes', () => {
    const results = evaluateItems([
      { id: 'a', source: 'A = e1', positionSource: 'B.position' },
      { id: 'b', source: 'B = e2', positionSource: 'A.position' },
    ])

    expect(results.map((result) => result.positionEvaluation)).toMatchObject([
      { status: 'invalid', diagnostic: { code: 'LANG_DEPENDENCY_CYCLE' } },
      { status: 'invalid', diagnostic: { code: 'LANG_DEPENDENCY_CYCLE' } },
    ])
    expect(results.map((result) => result.evaluation)).toMatchObject([
      { status: 'valid', inspection: 'e1' },
      { status: 'valid', inspection: 'e2' },
    ])
  })

  it('distinguishes a vector value from its displayed base and head in positions', () => {
    const results = evaluateItems([
      { id: 'source', source: 'V1 = vector(2, 1)', positionSource: '(3, 4)' },
      { id: 'value', source: 'A = e1', positionSource: 'V1' },
      { id: 'base', source: 'B = e1', positionSource: 'V1.position' },
      { id: 'head', source: 'H = e1', positionSource: 'V1.head' },
    ])

    expect(results.slice(1).map((result) => result.evaluation)).toMatchObject([
      { status: 'valid', primitive: { start: { x: 2, y: 1 } } },
      { status: 'valid', primitive: { start: { x: 3, y: 4 } } },
      { status: 'valid', primitive: { start: { x: 5, y: 5 } } },
    ])
  })

  it('renders an invalid position at the origin without invalidating the value', () => {
    const [result] = evaluateItems([
      { id: 'v', source: 'V = e1', positionSource: '12' },
    ])

    expect(result).toMatchObject({
      evaluation: {
        status: 'valid',
        inspection: 'e1',
        primitive: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      },
      positionEvaluation: {
        status: 'invalid',
        diagnostic: { code: 'GEOM_INVALID_POSITION' },
      },
    })
  })

  it('does not activate a stored position for a scalar value', () => {
    const [result] = evaluateItems([
      { id: 'scalar', source: 'S = 12', positionSource: 'Missing' },
    ])

    expect(result.evaluation).toMatchObject({
      status: 'valid',
      inspection: '12',
    })
    expect(result.positionEvaluation).toBeNull()
  })

  it('rejects position access on a scalar value', () => {
    const results = evaluate('S = 12', 'S.position')

    expect(results[1].evaluation).toMatchObject({
      status: 'invalid',
      diagnostic: { code: 'LANG_UNSUPPORTED_PROPERTY' },
    })
  })

  it('renders a bivector at its separately evaluated position', () => {
    const results = evaluateItems([
      {
        id: 'bivector',
        source: 'B = 3e12',
        positionSource: '(2, 1)',
      },
      { id: 'position', source: 'P = B.position' },
      { id: 'head', source: 'B.head' },
    ])

    expect(results[0]).toMatchObject({
      evaluation: {
        status: 'valid',
        entity: { kind: 'bivector-2d', value: 3 },
        primitive: {
          kind: 'oriented-area',
          area: 3,
          orientation: 'counterclockwise',
          shape: { kind: 'loop', center: { x: 2, y: 1 } },
        },
      },
      positionEvaluation: {
        status: 'valid',
        inspection: '2e1 + e2',
      },
      headInspection: null,
    })
    expect(results[1].evaluation).toMatchObject({
      status: 'valid',
      inspection: '2e1 + e2',
    })
    expect(results[2].evaluation).toMatchObject({
      status: 'invalid',
      diagnostic: { code: 'LANG_UNSUPPORTED_PROPERTY' },
    })
  })

  it('keeps an invalid bivector position separate from its valid value', () => {
    const [result] = evaluateItems([
      { id: 'bivector', source: 'B = -2e12', positionSource: '12' },
    ])

    expect(result).toMatchObject({
      evaluation: {
        status: 'valid',
        inspection: '-2e12',
        entity: { kind: 'bivector-2d', value: -2 },
        primitive: {
          kind: 'oriented-area',
          area: 2,
          orientation: 'clockwise',
          shape: { kind: 'loop', center: { x: 0, y: 0 } },
        },
      },
      positionEvaluation: {
        status: 'invalid',
        diagnostic: { code: 'GEOM_INVALID_POSITION' },
      },
      headInspection: null,
    })
  })

  it('returns the origin for an unpositioned bivector reference', () => {
    const results = evaluate('B = e12', 'B.position')

    expect(results[1].evaluation).toMatchObject({
      status: 'valid',
      inspection: '0',
      entity: { kind: 'scalar', value: 0 },
    })
  })

  it('resolves algebra properties and products through named dependencies', () => {
    const results = evaluate(
      'area = V ^ W',
      'dot = V | W',
      'V = (2, 1)',
      'W = (1, 3)',
      'axis = (!V).e2',
    )

    expect(results.map((result) => result.evaluation)).toMatchObject([
      { status: 'valid', inspection: '5e12' },
      { status: 'valid', inspection: '5' },
      { status: 'valid', inspection: '2e1 + e2' },
      { status: 'valid', inspection: 'e1 + 3e2' },
      { status: 'valid', inspection: '2' },
    ])
  })

  it('renders a direct named-vector outer product as a parallelogram', () => {
    const results = evaluate(
      'area = V ^ W',
      'V = (2, 1)',
      'W = (1, 3)',
    )

    expect(results[0].evaluation).toMatchObject({
      status: 'valid',
      entity: { kind: 'bivector-2d', value: 5 },
      primitive: {
        kind: 'oriented-area',
        area: 5,
        shape: {
          kind: 'parallelogram',
          vertices: [
            { x: 0, y: 0 },
            { x: 2, y: 1 },
            { x: 3, y: 4 },
            { x: 1, y: 3 },
          ],
        },
      },
    })
  })

  describe('outer-product construction and lineage (#85, #87, #88)', () => {
    const positioned = [
      { id: 'v1', source: 'V1 = (1, 0)', positionSource: '(2, 1)' },
      { id: 'v2', source: 'V2 = (0, 1)', positionSource: '(2, 1)' },
    ]
    const unitSquareAt = (x: number, y: number) => ({
      kind: 'oriented-area',
      area: 1,
      shape: {
        kind: 'parallelogram',
        vertices: [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }],
      },
    })
    const elementAt = (
      result: ReturnType<typeof evaluateDocument>[number],
      index: number,
    ) => {
      const evaluation = result.evaluation
      if (evaluation?.status !== 'valid' || evaluation.valueType !== 'list') {
        throw new Error('Expected a valid list')
      }
      return evaluation.elements[index]
    }

    it('draws an outer product of list elements as a parallelogram (#85)', () => {
      const [, result] = evaluate('L2 = [(1, 0), (0, 1)]', 'B2 = L2[0] ^ L2[1]')
      expect(result.evaluation).toMatchObject({
        status: 'valid', primitive: unitSquareAt(0, 0),
      })
    })

    it('keeps the construction through a reference to the bivector', () => {
      const [,,, result] = evaluate('V = (1, 0)', 'W = (0, 1)', 'B = V ^ W', 'C = B')
      expect(result.evaluation).toMatchObject({
        status: 'valid', primitive: unitSquareAt(0, 0),
      })
    })

    it('draws an inline outer product inside a list literal as a parallelogram at the shared inherited position (#87, #88)', () => {
      const [,, list, selected] = evaluateItems([
        ...positioned,
        { id: 'l1', source: 'L1 = [V1, V2, V1 ^ V2]' },
        { id: 'x', source: 'X = L1[2]' },
      ])
      expect(list.positionEvaluation).toBeNull()
      expect(elementAt(list, 0)).toMatchObject({ position: { x: 2, y: 1 } })
      expect(elementAt(list, 2)).toMatchObject({
        entity: { kind: 'bivector-2d', value: 1 },
        position: { x: 2, y: 1 },
        positionConflict: false,
        primitive: unitSquareAt(2, 1),
      })
      expect(selected.evaluation).toMatchObject({
        status: 'valid', primitive: unitSquareAt(2, 1),
      })
    })

    it('reports a conflict when the operands of a derived list element disagree (#88)', () => {
      const [,, list] = evaluateItems([
        { id: 'v1', source: 'V1 = (1, 0)', positionSource: '(2, 1)' },
        { id: 'v2', source: 'V2 = (0, 1)', positionSource: '(0, 3)' },
        { id: 'l', source: 'L = [V1 ^ V2]' },
      ])
      expect(list.positionEvaluation).toMatchObject({
        status: 'invalid', diagnostic: { code: 'GEOM_POSITION_CONFLICT' },
      })
      expect(elementAt(list, 0)).toMatchObject({
        position: null, positionConflict: true, entity: { value: 1 },
      })
    })

    it('lets one positioned operand supply a derived element position', () => {
      const [, list] = evaluateItems([
        { id: 'v1', source: 'V1 = (1, 0)', positionSource: '(2, 1)' },
        { id: 'l', source: 'L = [V1 ^ e2]' },
      ])
      expect(list.positionEvaluation).toBeNull()
      expect(elementAt(list, 0)).toMatchObject({
        position: { x: 2, y: 1 }, primitive: unitSquareAt(2, 1),
      })
    })

    it('keeps a top-level outer product on its own position source', () => {
      const [,, result] = evaluateItems([
        ...positioned,
        { id: 'b1', source: 'B1 = V1 ^ V2' },
      ])
      expect(result.positionEvaluation).toBeNull()
      expect(result.evaluation).toMatchObject({
        status: 'valid', primitive: unitSquareAt(0, 0),
      })
    })

    it('rotates the spanning sides of a transformed bivector element (#87)', () => {
      const [,,,, rotated] = evaluateItems([
        ...positioned,
        { id: 'l1', source: 'L1 = [V1, V2, V1 ^ V2]' },
        { id: 'r', source: 'R = exp(0.5*pi/4*e12)' },
        { id: 'l3', source: 'L3 = R >>> L1' },
      ])
      const element = elementAt(rotated, 2)
      const side = elementAt(rotated, 0).entity as Vector2dEntity
      expect(element).toMatchObject({
        position: { x: 2, y: 1 },
        primitive: { kind: 'oriented-area', shape: { kind: 'parallelogram' } },
      })
      if (element.primitive?.kind !== 'oriented-area' ||
          element.primitive.shape.kind !== 'parallelogram') return
      const [origin, first] = element.primitive.shape.vertices
      expect(origin).toEqual({ x: 2, y: 1 })
      expect(first.x - origin.x).toBeCloseTo(side.x, 12)
      expect(first.y - origin.y).toBeCloseTo(side.y, 12)
      expect(side.x).toBeCloseTo(Math.SQRT1_2, 12)
      expect(element.primitive.area).toBeCloseTo(1, 12)
    })

    it('rotates the construction of a single transformed bivector', () => {
      const [,, result] = evaluate(
        'B = (2, 0) ^ (0, 1)', 'R = exp(0.5*pi/2*e12)', 'C = R >>> B',
      )
      expect(result.evaluation).toMatchObject({
        status: 'valid',
        primitive: { kind: 'oriented-area', shape: { kind: 'parallelogram' } },
      })
    })
  })

  it('keeps independent branches valid after an unsupported property', () => {
    const results = evaluate('A = e1.unknown', 'B = ps')

    expect(results.map((result) => result.evaluation)).toMatchObject([
      {
        status: 'invalid',
        diagnostic: {
          code: 'LANG_UNSUPPORTED_PROPERTY',
          span: { start: 7, end: 14 },
        },
      },
      { status: 'valid', inspection: 'e12' },
    ])
  })

  it('resolves named scalar parameters inside rotor expressions', () => {
    const results = evaluate(
      'alpha = pi/2',
      'R = exp(-(alpha/2)e12)',
      'V = R >>> e1',
    )

    expect(results[1].evaluation).toMatchObject({
      status: 'valid',
      entity: { kind: 'rotor-2d' },
    })
    const vector = results[2].evaluation
    expect(vector).toMatchObject({ status: 'valid', entity: { kind: 'vector-2d' } })
    if (vector?.status !== 'valid' || vector.entity.kind !== 'vector-2d') return
    const entity = vector.entity as Vector2dEntity
    expect(entity.x).toBeCloseTo(0, 14)
    expect(entity.y).toBeCloseTo(1, 14)
  })
})

describe('position diagnostics name what the algebra expects (#236)', () => {
  const pgaContext = { engine: createPga2Engine(), interpretation: PGA_2D_INTERPRETATION }
  const positionMessage = (results: ReturnType<typeof evaluateDocument>) => {
    const position = results[0].positionEvaluation
    if (position?.status !== 'invalid') throw new Error('Expected an invalid position')
    return position.diagnostic
  }

  it('accepts a PGA(2) tuple position as the point it denotes (#180)', () => {
    const [tuple] = evaluateDocument(expressionDocument([
      { id: 'i', source: 'I = ipoint(1, 0)', positionSource: '(1, 2)' },
    ]), pgaContext)
    const [call] = evaluateDocument(expressionDocument([
      { id: 'i', source: 'I = ipoint(1, 0)', positionSource: 'point(1, 2)' },
    ]), pgaContext)
    expect(tuple.positionEvaluation).toMatchObject({ status: 'valid', inspection: '2e01 - e02 + e12' })
    expect(tuple.positionEvaluation).toEqual(call.positionEvaluation)
    const [weighted] = evaluateDocument(expressionDocument([
      { id: 'i', source: 'I = ipoint(1, 0)', positionSource: '(2, 4, 2)' },
    ]), pgaContext)
    expect(weighted.positionEvaluation).toMatchObject({ status: 'valid' })
  })

  it('rejects an ideal or over-long PGA(2) tuple position without naming vector', () => {
    const ideal = positionMessage(evaluateDocument(expressionDocument([
      { id: 'i', source: 'I = ipoint(1, 0)', positionSource: '(1, 2, 0)' },
    ]), pgaContext))
    expect(ideal).toMatchObject({ code: 'GEOM_INVALID_POSITION', message: 'A position must evaluate to a Euclidean point.' })
    const long = positionMessage(evaluateDocument(expressionDocument([
      { id: 'i', source: 'I = ipoint(1, 0)', positionSource: '(1, 2, 3, 4)' },
    ]), pgaContext))
    expect(long).toMatchObject({ code: 'LANG_ARITY', span: { start: 0, end: 12 } })
    expect(long.message).not.toMatch(/vector/)
  })

  it('asks PGA(2) for a Euclidean point when the position is a line', () => {
    const diagnostic = positionMessage(evaluateDocument(expressionDocument([
      { id: 'i', source: 'I = ipoint(1, 0)', positionSource: 'line(1, 0, 0)' },
    ]), pgaContext))
    expect(diagnostic).toMatchObject({
      code: 'GEOM_INVALID_POSITION',
      message: 'A position must evaluate to a Euclidean point.',
    })
  })

  it('keeps the VGA(2) messages', () => {
    const wrongKind = positionMessage(evaluateItems([
      { id: 'v', source: 'V = vector(1, 0)', positionSource: 'e12' },
    ]))
    expect(wrongKind.message).toBe('A position must evaluate to a VGA 2D vector or zero.')
    const [tuple] = evaluateItems([{ id: 'v', source: 'V = vector(1, 0)', positionSource: '(1, 2)' }])
    expect(tuple.positionEvaluation).toMatchObject({ status: 'valid' })
  })
})

describe('empty VGA(2) positions (#235)', () => {
  it('keep evaluating to zero', () => {
    const [, position, head] = evaluate('V = vector(2, 1)', 'P = V.position', 'H = V.head')
    expect(position.evaluation).toMatchObject({ status: 'valid', inspection: '0' })
    expect(head.evaluation).toMatchObject({ status: 'valid', inspection: '2e1 + e2' })
  })
})

describe('PGA(2) list positions', () => {
  const pgaContext = { engine: createPga2Engine(), interpretation: PGA_2D_INTERPRETATION }
  const evaluatePga = (items: readonly ExpressionItem[]) =>
    evaluateDocument(expressionDocument(items), pgaContext)

  it('resolves the position and head of an unpositioned list of ideal points', () => {
    const [, position, head] = evaluatePga([
      { id: 'list', source: 'L = [e01, e02]' },
      { id: 'position', source: 'P = L.position' },
      { id: 'head', source: 'H = L.head' },
    ])
    // Without a position, every ideal point sits at the origin point e12.
    expect(position.evaluation).toMatchObject({ status: 'valid', inspection: '[e12, e12]' })
    expect(head.evaluation).toMatchObject({ status: 'valid', inspection: '[e01 + e12, e02 + e12]' })
  })

  it('evaluates the empty position of an ideal point to the origin point (#235)', () => {
    const [, position, head] = evaluatePga([
      { id: 'j', source: 'J = ipoint(0, 1)' },
      { id: 'position', source: 'P = J.position' },
      { id: 'head', source: 'H = J.head' },
    ])
    // The arrow is drawn from the origin point, so J.position is e12 and
    // J.head the displayed head e01 + e12, not e01.
    expect(position.evaluation).toMatchObject({ status: 'valid', inspection: 'e12' })
    expect(head.evaluation).toMatchObject({ status: 'valid', inspection: 'e01 + e12' })
  })

  it('inspects PGA lists with the PGA blade names', () => {
    const [list] = evaluatePga([{ id: 'list', source: 'Q = [point(1, 2), e12]' }])
    expect(list.evaluation).toMatchObject({ status: 'valid', inspection: '[2e01 - e02 + e12, e12]' })
  })

  it('inherits the positions of named ideal points collected in a list', () => {
    const results = evaluatePga([
      { id: 'd1', source: 'D1 = ipoint(1, 0)', positionSource: 'point(1, 2)' },
      { id: 'd2', source: 'D2 = ipoint(0, 1)', positionSource: 'point(-3, 0)' },
      { id: 'list', source: 'L = [D1, D2]' },
      { id: 'position', source: 'P = L.position' },
    ])
    const position = results[3].evaluation
    if (position?.status !== 'valid' || position.valueType !== 'list')
      throw new Error('Expected a valid list of positions')
    expect(position.elements.map((element) => PGA_2D_INTERPRETATION.positionOf(element.value)))
      .toEqual([{ x: 1, y: 2 }, { x: -3, y: 0 }])
  })
})

describe('coordinate tuples resolved by the active algebra (#180)', () => {
  const pgaContext = { engine: createPga2Engine(), interpretation: PGA_2D_INTERPRETATION }
  const evaluatePga = (...sources: string[]) => evaluateDocument(
    expressionDocument(sources.map((source, index) => ({ id: `item-${index + 1}`, source }))),
    pgaContext,
  )
  const invalid = (state: ReturnType<typeof evaluate>[number]['evaluation']) => {
    if (state?.status !== 'invalid') throw new Error('Expected an invalid evaluation')
    return state.diagnostic
  }

  it('reads a VGA(2) pair as vector(x, y)', () => {
    const [tuple, call] = evaluate('V = (2, 1)', 'W = vector(2, 1)')
    expect(tuple.evaluation).toMatchObject({ status: 'valid', inspection: '2e1 + e2', entity: { kind: 'vector-2d' } })
    expect(call.evaluation).toMatchObject({ status: 'valid', inspection: '2e1 + e2' })
  })

  it('rejects every other VGA(2) arity at the tuple span, without naming vector', () => {
    for (const [source, received] of [['V = (1,)', 1], ['V = (1, 2, 3)', 3], ['V = (1, 2, 3, 4)', 4]] as const) {
      const diagnostic = invalid(evaluate(source)[0].evaluation)
      expect(diagnostic).toEqual({
        code: 'LANG_ARITY',
        severity: 'error',
        message: `A coordinate tuple takes 2 components in this algebra, received ${received}.`,
        span: { start: 4, end: source.length },
      })
      expect(diagnostic.message).not.toMatch(/vector/)
    }
  })

  it('reads a PGA(2) pair as point(x, y) and a triple as point(x, y, w)', () => {
    const [pair, pairCall, triple, tripleCall] = evaluatePga(
      'P = (2, 1)', 'Q = point(2, 1)', 'R = (4, 2, 2)', 'S = point(4, 2, 2)')
    expect(pair.evaluation).toMatchObject({ status: 'valid', entity: { kind: 'euclidean-point', x: 2, y: 1, weight: 1 } })
    expect(pair.evaluation).toMatchObject({ inspection: (pairCall.evaluation as { inspection: string }).inspection })
    expect(triple.evaluation).toMatchObject({ status: 'valid', entity: { kind: 'euclidean-point', x: 4, y: 2, weight: 2 } })
    expect(triple.evaluation).toMatchObject({ inspection: (tripleCall.evaluation as { inspection: string }).inspection })
  })

  it('reads a PGA(2) triple with a zero weight as the ideal point, never a line', () => {
    const [ideal, ipoint] = evaluatePga('D = (1, 2, 0)', 'E = ipoint(1, 2)')
    expect(ideal.evaluation).toMatchObject({ status: 'valid', entity: { kind: 'ideal-point', x: 1, y: 2 } })
    expect(ideal.evaluation).toMatchObject({ inspection: (ipoint.evaluation as { inspection: string }).inspection })
  })

  it('follows scalar names and broadcasts lists like the constructor', () => {
    const [, , named] = evaluatePga('t = 3', 'w = 2', 'P = (t, 1, w)')
    expect(named.evaluation).toMatchObject({ status: 'valid', entity: { kind: 'euclidean-point', x: 3, y: 1, weight: 2 } })
    const [, list] = evaluatePga('X = [0, 1]', 'L = (X, 2)')
    expect(list.evaluation).toMatchObject({ status: 'valid', inspection: '[2e01 + e12, 2e01 - e02 + e12]' })
  })

  it('rejects other PGA(2) arities at the tuple span, without naming vector', () => {
    for (const [source, received] of [['P = (1,)', 1], ['P = (1, 2, 3, 4)', 4]] as const) {
      const diagnostic = invalid(evaluatePga(source)[0].evaluation)
      expect(diagnostic).toEqual({
        code: 'LANG_ARITY',
        severity: 'error',
        message: `A coordinate tuple takes 2 or 3 components in this algebra, received ${received}.`,
        span: { start: 4, end: source.length },
      })
    }
  })

  it('evaluates a PGA list of tuples element by element', () => {
    const [list] = evaluatePga('L = [(1, 2), (3, 4, 1)]')
    expect(list.evaluation).toMatchObject({ status: 'valid', inspection: '[2e01 - e02 + e12, 4e01 - 3e02 + e12]' })
  })

  it('accepts any component expression and broadcasts a list literal like the constructor', () => {
    const [vgaTuple, vgaCall] = evaluate('T = ([0, 1], 2)', 'C = vector([0, 1], 2)')
    expect(vgaTuple.evaluation).toMatchObject({ status: 'valid', inspection: '[2e2, e1 + 2e2]' })
    expect(vgaCall.evaluation).toMatchObject({ status: 'valid', inspection: '[2e2, e1 + 2e2]' })
    const [pgaTuple, pgaCall] = evaluatePga('T = ([0, 1], 2)', 'C = point([0, 1], 2)')
    expect(pgaTuple.evaluation).toMatchObject({ status: 'valid', inspection: '[2e01 + e12, 2e01 - e02 + e12]' })
    expect(pgaTuple.evaluation).toMatchObject({ inspection: (pgaCall.evaluation as { inspection: string }).inspection })
    const [, , indexed, norm] = evaluatePga('X = [3, 4]', 'A = line(3, 4, 0)', 'P = (X[1], 2)', 'Q = (A.norm, 1)')
    expect(indexed.evaluation).toMatchObject({ status: 'valid', entity: { kind: 'euclidean-point', x: 4, y: 2 } })
    expect(norm.evaluation).toMatchObject({ status: 'valid', entity: { kind: 'euclidean-point', x: 5, y: 1 } })
  })

  it('rejects a non-scalar component at evaluation with the constructor message', () => {
    expect(invalid(evaluate('V = (e1, 2)')[0].evaluation)).toMatchObject({
      code: 'ALG_DOMAIN', message: 'A vector component must be scalar.', span: { start: 4, end: 11 },
    })
    expect(invalid(evaluate('V = vector(e1, 2)')[0].evaluation)).toMatchObject({
      code: 'ALG_DOMAIN', message: 'A vector component must be scalar.',
    })
    expect(invalid(evaluatePga('P = (e1, 2, 1)')[0].evaluation)).toMatchObject({
      code: 'ALG_DOMAIN', message: 'A point coordinate must be scalar.', span: { start: 4, end: 14 },
    })
    expect(invalid(evaluatePga('P = (1, 2, e0)')[0].evaluation)).toMatchObject({
      code: 'ALG_DOMAIN', message: 'A point weight must be scalar.',
    })
  })

  it('rejects every tuple in an algebra that declares no tuple constructor', () => {
    const { tuple: _tuple, ...withoutTuple } = createVga2Engine()
    const [result] = evaluateDocument(
      expressionDocument([{ id: 'v', source: 'V = (1, 2)' }]),
      { engine: withoutTuple, interpretation: VGA_2D_INTERPRETATION },
    )
    expect(invalid(result.evaluation)).toEqual({
      code: 'LANG_UNSUPPORTED_TUPLE',
      severity: 'error',
      message: 'Coordinate tuples are not supported by the active algebra.',
      span: { start: 4, end: 10 },
    })
  })

  it('keeps vector(x, y) a VGA constructor that PGA does not register', () => {
    expect(invalid(evaluatePga('V = vector(1, 2)')[0].evaluation)).toMatchObject({ code: 'LANG_UNSUPPORTED_FUNCTION' })
  })
})

describe('declaration dependencies of a kept weight (#181)', () => {
  const items = expressionDocument([
    { id: 't', source: 't = 1' },
    { id: 'u', source: 'u = 3' },
    { id: 'w', source: 'w = 2*t' },
    { id: 'v', source: 'v = w + 1' },
    { id: 'k', source: 'k = 2' },
    { id: 'n', kind: 'annotation', source: 'k = t' },
    { id: 'c', source: 'c = c2', positionSource: '(t, 0)' },
    { id: 'c2', source: 'c2 = c' },
  ]).items

  it('follows references directly and through other declarations', () => {
    expect(declarationDependsOn(items, 'w', new Set(['t']))).toBe(true)
    expect(declarationDependsOn(items, 'v', new Set(['t']))).toBe(true)
    expect(declarationDependsOn(items, 't', new Set(['t']))).toBe(true)
    expect(declarationDependsOn(items, 'w', new Set(['u']))).toBe(false)
    expect(declarationDependsOn(items, 'k', new Set(['t']))).toBe(false)
    expect(declarationDependsOn(items, 'missing', new Set(['t']))).toBe(false)
  })

  it('includes positions and stops on cycles', () => {
    expect(declarationDependsOn(items, 'c2', new Set(['t']))).toBe(true)
    expect(declarationDependsOn(items, 'c2', new Set(['u']))).toBe(false)
  })
})
