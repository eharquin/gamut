import { describe, expect, it } from 'vitest'
import { createVga2Engine } from '../algebra/vgaEngine'
import { createPga2Engine } from '../algebra/pgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { expressionDocument } from '../document/expressionDocument'
import { evaluateDocument } from './evaluateDocument'
import { valueSourceEvaluator } from './evaluateScalarControl'

const vga = { engine: createVga2Engine(), interpretation: VGA_2D_INTERPRETATION }
const pga = { engine: createPga2Engine(), interpretation: PGA_2D_INTERPRETATION }

function evaluated(context: typeof vga | typeof pga, ...sources: string[]) {
  return evaluateDocument(
    expressionDocument(sources.map((source, index) => ({ id: `item-${index}`, source }))),
    context,
  )
}

function rows(context: typeof vga | typeof pga, ...sources: string[]) {
  return evaluated(context, ...sources).map(({ evaluation }) =>
    evaluation?.status === 'valid' ? evaluation.inspection
      : evaluation?.status === 'function' ? `function ${evaluation.signature}`
        : evaluation?.status === 'invalid' ? `${evaluation.diagnostic.code}: ${evaluation.diagnostic.message}` : null)
}

describe('iterate(f, x0, n) (#341)', () => {
  it('lists the n + 1 states of the recurrence', () => {
    expect(rows(vga, 'half(x) = x / 2', 'iterate(half, 8, 3)')[1]).toBe('[8, 4, 2, 1]')
    expect(rows(vga, 'half(x) = x / 2', 'iterate(half, 8, 0)')[1]).toBe('[8]')
    expect(rows(vga, 'half(x) = x / 2', 'iterate(half, 8, 1)')[1]).toBe('[8, 4]')
    expect(rows(vga, 'turn(v) = e12 * v', 'iterate(turn, e1, 4)')[1]).toBe('[e1, -e2, -e1, e2, e1]')
  })

  it('follows a slider on n and the names the function uses', () => {
    expect(rows(vga, 'k = 3', 'n = 2', 'f(x) = k * x', 'iterate(f, 1, n)')[3]).toBe('[1, 3, 9]')
    expect(rows(vga, 'k = 2', 'n = 4', 'f(x) = k * x', 'iterate(f, 1, n)')[3]).toBe('[1, 2, 4, 8, 16]')
  })

  it('checks the length before the first step', () => {
    expect(rows(vga, 'f(x) = x + 1', 'P = iterate(f, 0, 9999)', 'P[9999]').slice(1)).toEqual([
      expect.stringMatching(/^\[0, 1, 2, /), '9999',
    ])
    // A step that would fail is never evaluated: the length is refused first.
    expect(rows(vga, 'f(x) = 1 / 0', 'iterate(f, 0, 10000)')[1])
      .toBe('LIMIT_GENERATED_VALUES: This iteration would generate 10001 elements; the limit is 10000.')
  })

  it.each([
    ['iterate(f, 0, 1.5)', 'LANG_INDEX_DOMAIN: The step count of “iterate” must be a non-negative integer.'],
    ['iterate(f, 0, -1)', 'LANG_INDEX_DOMAIN: The step count of “iterate” must be a non-negative integer.'],
    ['iterate(f, 0, e1)', 'ALG_DOMAIN: The step count of “iterate” must be scalar.'],
    ['iterate(f, 0, [1, 2])', 'LANG_SCALAR_REQUIRED: The step count of “iterate” must be one scalar value.'],
    ['iterate(f, [0, 1], 2)', 'LANG_NESTED_LIST: The initial state of “iterate” must be one value, not a list.'],
    ['iterate(g, 0, 2)', 'LANG_ARITY: “iterate” needs a function of one parameter; “g” takes 2.'],
    ['iterate(3, 0, 2)', 'LANG_FUNCTION_ARGUMENT: The first argument of “iterate” shall be the name of a declared function.'],
    ['iterate(sin, 0, 2)', 'LANG_FUNCTION_ARGUMENT: “sin” is not a declared function.'],
    ['iterate(a, 0, 2)', 'LANG_NOT_A_FUNCTION: “a” is not a function.'],
    ['iterate(spread, 0, 2)', 'LANG_NESTED_LIST: Step 1: “spread” returns a list; each state must be one value.'],
    ['iterate(inv, 2.5, 3)', expect.stringMatching(/^ALG_SINGULAR: Step 2: In “inv”: /)],
  ])('reports %s', (source, expected) => {
    expect(rows(vga, 'f(x) = x + 1', 'g(x, y) = x + y', 'a = 2', 'spread(x) = [x, x]', 'inv(x) = 1 / (x - 2)', source)[5])
      .toEqual(expected)
  })

  it('keeps the identity of element k when n changes', () => {
    const ids = (n: number) => {
      const [, result] = evaluated(vga, 'f(x) = x + 1', `iterate(f, 0, ${n})`)
      if (result.evaluation?.status !== 'valid' || result.evaluation.valueType !== 'list') throw new Error('Expected a list')
      return result.evaluation.value.elements.map((element) => element.id)
    }
    expect(ids(5).slice(0, 3)).toEqual(ids(2))
  })

  it('never takes over the identity of the initial item', () => {
    const [O, path] = evaluated(pga, 'O = point(1, 2)', 'same(P) = P', 'path = iterate(same, O, 2)').filter((_, index) => index !== 1)
    if (O.evaluation?.status !== 'valid' || O.evaluation.valueType !== 'single' ||
        path.evaluation?.status !== 'valid' || path.evaluation.valueType !== 'list') throw new Error('Expected values')
    expect(path.evaluation.value.elements.map((element) => element.id)).not.toContain(O.evaluation.elementId)
  })

  it('keeps the positions of positioned vectors, as [v, f(v)] does', () => {
    const positions = (source: string) => {
      const items = evaluateDocument(expressionDocument([
        { id: 'v', source: 'v = e1', positionSource: '(1, 1)' },
        { id: 'f', source: 'f(x) = 2 * x' },
        { id: 'l', source },
      ]), vga)
      const last = items.at(-1)!.evaluation
      if (last?.status !== 'valid' || last.valueType !== 'list') throw new Error(JSON.stringify(last))
      return last.elements.map((element) => element.position)
    }
    expect(positions('L = iterate(f, v, 2)')).toEqual([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }])
    expect(positions('L = iterate(f, v, 1)')).toEqual(positions('L = [v, f(v)]'))
  })

  it('reports a bad function in a label as a row does', () => {
    const items = evaluated(vga, 'a = 2', 'g(x) = x + zz')
    expect(valueSourceEvaluator(items, vga.engine)('iterate(a, 0, 2)')).toMatchObject({
      status: 'invalid', diagnostic: { code: 'LANG_NOT_A_FUNCTION' },
    })
    expect(valueSourceEvaluator(items, vga.engine)('iterate(g, 0, 2)')).toMatchObject({
      status: 'invalid', diagnostic: { code: 'LANG_INVALID_DEPENDENCY' },
    })
  })

  it('may be used in a label', () => {
    const items = evaluated(vga, 'f(x) = 2 * x')
    const result = valueSourceEvaluator(items, vga.engine)('iterate(f, 1, 3)[3]')
    if (result.status !== 'valid' || result.value.kind !== 'multivector') throw new Error(JSON.stringify(result))
    expect(result.value.coefficients[0]).toBe(8)
  })

  it('reproduces the powers of a constant motor in PGA(2)', () => {
    const scene = ['M = exp(-0.3 * point(1, 1))', 'X = point(2, 0)']
    const [, , , iterated, closed] = evaluated(pga, ...scene, 'rot(P) = M >>> P',
      'iterate(rot, X, 6)', 'exp([0...6] * log(M)) >>> X')
    if (iterated.evaluation?.status !== 'valid' || iterated.evaluation.valueType !== 'list' ||
        closed.evaluation?.status !== 'valid' || closed.evaluation.valueType !== 'list') throw new Error('Expected lists')
    const closedElements = closed.evaluation.value.elements
    iterated.evaluation.value.elements.forEach((element, index) => {
      element.value.coefficients.forEach((coefficient, blade) =>
        expect(coefficient).toBeCloseTo(closedElements[index].value.coefficients[blade], 10))
    })
  })

  it('traces a ray with a state-dependent step, as the unrolled graph does (#337)', () => {
    const scene = [
      'C = point(4, 1)', 'rc = 1', 'G = line(0, 1, -3)', 'O = point(0, 0)', 'Dir = ipoint(1, 0.4) / norm(!ipoint(1, 0.4))',
    ]
    const sdf = (P: string) => `min(norm(${P} & C) - rc, abs((G ^ ${P}).e012) / norm(G))`
    const unrolled = ['P0 = O', ...Array.from({ length: 30 }, (_, k) => `P${k + 1} = P${k} + ${sdf(`P${k}`)} * Dir`)]
    const reference = rows(pga, ...scene, ...unrolled).slice(scene.length)
    for (const n of [0, 1, 7, 30]) {
      const traced = rows(pga, ...scene, `sdf(P) = ${sdf('P')}`, 'step(P) = P + sdf(P) * Dir', `path = iterate(step, O, ${n})`)
        .at(-1)
      expect(traced).toBe(`[${reference.slice(0, n + 1).join(', ')}]`)
    }
  })
})
