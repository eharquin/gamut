import { describe, expect, it } from 'vitest'
import { createVga2Engine } from '../algebra/vgaEngine'
import { createPga2Engine } from '../algebra/pgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { expressionDocument } from '../document/expressionDocument'
import { evaluateDocument } from './evaluateDocument'
import { parseExpression } from '../language/parseExpression'

const vga = { engine: createVga2Engine(), interpretation: VGA_2D_INTERPRETATION }
const pga = { engine: createPga2Engine(), interpretation: PGA_2D_INTERPRETATION }

function evaluated(context: typeof vga | typeof pga, ...sources: string[]) {
  const document = expressionDocument(sources.map((source, index) => ({ id: `item-${index}`, source })))
  return evaluateDocument(context === pga
    ? { ...document, algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } } }
    : document, context)
}

function rows(context: typeof vga | typeof pga, ...sources: string[]) {
  return evaluated(context, ...sources).map(({ evaluation }) =>
    evaluation?.status === 'valid' ? evaluation.inspection
      : evaluation?.status === 'function' ? `function ${evaluation.signature}`
        : evaluation?.status === 'invalid' ? `${evaluation.diagnostic.code}: ${evaluation.diagnostic.message}` : null)
}

describe('map(f, L1, …, Lk) (#360)', () => {
  it('applies a function element by element, to one or several lists', () => {
    expect(rows(vga, 'twice(x) = 2 * x', 'map(twice, [1, 2, 3])')[1]).toBe('[2, 4, 6]')
    expect(rows(vga, 'add(a, b) = a + b', 'map(add, [1, 2], [10, 20])')[1]).toBe('[11, 22]')
    expect(rows(vga, 'f(x) = x', 'map(f, [])')[1]).toBe('[]')
    // A constant is a free name of the body, not an argument.
    expect(rows(vga, 'k = 3', 'scaled(x) = k * x', 'map(scaled, [0...2])')[2]).toBe('[0, 3, 6]')
  })

  it('makes a list of lists when every call returns a list, of any lengths', () => {
    expect(rows(vga, 'upto(n) = [0...n]', 'map(upto, [0, 2])')[1]).toBe('[[0], [0, 1, 2]]')
    expect(rows(vga, 'pair(x) = [x, -x]', 'L = map(pair, [1, 2])', 'L[1]', 'L[1][0]', 'L[[1, 0]]').slice(2))
      .toEqual(['[2, -2]', '2', '[[2, -2], [1, -1]]'])
  })

  it.each([
    ['map(f, [1], [1, 2])', 'f(a, b) = a', 'LANG_LIST_LENGTH: The lists of “map” have lengths 1, 2; they must be equal.'],
    ['map(f, [1, 2])', 'f(a, b) = a', 'LANG_ARITY: “map” passes 1 list, but “f” takes 2 parameters.'],
    ['map(f, 3)', 'f(x) = x', 'LANG_LIST_REQUIRED: Argument 2 of “map” must be a list; a value used by every call is a name in the body of “f”.'],
    ['map(3, [1])', 'f(x) = x', 'LANG_FUNCTION_ARGUMENT: The first argument of “map” shall be the name of a declared function.'],
    ['map(sin, [1])', 'f(x) = x', 'LANG_FUNCTION_ARGUMENT: “sin” is not a declared function.'],
    ['map(f, [1, 2])', 'f(x) = if(x > 1, [x], x)', 'LANG_NESTED_LIST: Element 1: “f” returns a list, but element 0 was one value; every call must return the same.'],
    ['map(f, [1, 0])', 'f(x) = 1 / x', 'ALG_SINGULAR: Element 1: In “f”: This multivector is not invertible.'],
  ])('reports %s', (source, declaration, message) => {
    expect(rows(vga, declaration, source)[1]).toBe(message)
  })

  it('refuses a list of lists as an operand, a reduction, an argument or a state', () => {
    const base = ['pair(x) = [x, -x]', 'L = map(pair, [1, 2])']
    for (const source of ['L + 1', '-L', 'sum(L)', 'norm(L)', 'map(pair, L)', 'iterate(pair, L, 1)', '[L]', 'if([1, 0], L, L)']) {
      expect(rows(vga, ...base, source)[2], source)
        .toBe('LANG_NESTED_LIST: This is a list of lists, made by “map”; only indexing, such as L[i], can use it.')
    }
    // One condition selects a whole list of lists.
    expect(rows(vga, ...base, 'if(1, L, L)')[2]).toBe('[[1, -1], [2, -2]]')
  })

  it('counts every inner element against the generated-value limit', () => {
    expect(rows(vga, 'run(x) = [0...99]', 'map(run, [0...99])')[1]).toMatch(/^\[\[0, 1/)
    expect(rows(vga, 'run(x) = [0...100]', 'map(run, [0...99])')[1])
      .toBe('LIMIT_GENERATED_VALUES: This “map” would generate more than 10000 elements, the limit.')
  })

  it('gives every element an identity of the map node and its ordinal, stable when a length changes', () => {
    const ids = (count: number) => {
      const [, , row] = evaluated(vga, 'pair(x) = [x, -x]', `n = ${count}`, 'L = map(pair, [0...n])')
      return row.evaluation?.status === 'valid' && row.evaluation.valueType === 'list'
        ? row.evaluation.elements.map((element) => element.id) : []
    }
    const short = ids(1)
    const long = ids(2)
    expect(short).toHaveLength(4)
    expect(long.slice(0, 4)).toEqual(short)
    expect(new Set(long).size).toBe(6)
  })

  it('reserves the name map', () => {
    expect(parseExpression('map(f)').ok).toBe(false)
    expect(rows(vga, 'map = 3')[0]).toMatch(/^LANG_/)
    expect(rows(vga, 'map(x) = x')[0]).toMatch(/^LANG_/)
  })

  it('maps PGA(2) motors over a shape, as in the boxes of G-08', () => {
    const shape = 'cor = [point(0, 0), point(1, 0), point(1, 1), point(0, 1)]'
    const motors = 'Mk = exp(-0.5 * [0...7] * pi / 4 * point(3, 0))'
    const unrolled = Array.from({ length: 8 }, (_, k) => `box${k} = Mk[${k}] >>> cor`)
    const all = rows(pga, shape, motors, 'place(M) = M >>> cor', 'boxes = map(place, Mk)', ...unrolled)
    const boxes = all[3]!
    expect(boxes).toBe(`[${all.slice(4).join(', ')}]`)
  })

  it('draws the balls of a sphere-traced ray as the flattened index arithmetic of #341 does', () => {
    const scene = [
      'C = point(4, 1)', 'rc = 1', 'G = line(0, 1, -3)', 'O = point(0, 0)', 'Dir = ipoint(1, 0.4) / norm(!ipoint(1, 0.4))',
      'sdf(P) = min(norm(P & C) - rc, abs((G ^ P).e012) / norm(G))', 'step(P) = P + sdf(P) * Dir',
      'th = [0...72] * tau / 72',
    ]
    const elementsOf = (context: typeof pga, sources: string[]) => {
      const last = evaluated(context, ...sources).at(-1)!.evaluation
      return last?.status === 'valid' && last.valueType === 'list'
        ? { values: last.elements.map((element) => element.inspection), groups: last.value.groups ?? null }
        : { values: [String(last?.status === 'invalid' ? last.diagnostic.message : last?.status)], groups: null }
    }
    for (const n of [0, 1, 7, 30]) {
      const traced = [...scene, `path = iterate(step, O, ${n})`, 'ds = sdf(path)']
      const mapped = elementsOf(pga, [...traced, 'ball(P, d) = exp(-0.5 * th * P) >>> (P + abs(d) * Dir)', 'balls = map(ball, path, ds)'])
      const flattened = elementsOf(pga, [...traced,
        `J = [0...${(n + 1) * 73 - 1}]`, 'k = (J - J % 73) / 73',
        'balls = exp(-0.5 * th[J % 73] * path[k]) >>> (path[k] + abs(ds[k]) * Dir)'])
      expect(mapped.groups).toEqual(Array.from({ length: n + 1 }, () => 73))
      expect(mapped.values).toHaveLength((n + 1) * 73)
      expect(mapped.values).toEqual(flattened.values)
    }
  })
})
