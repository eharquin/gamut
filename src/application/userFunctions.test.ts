import { describe, expect, it } from 'vitest'
import { createVga2Engine } from '../algebra/vgaEngine'
import { createPga2Engine } from '../algebra/pgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { expressionDocument } from '../document/expressionDocument'
import { declaredName } from '../language/declaredName'
import { parseDocumentExpression } from '../language/parseExpression'
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

/** Each row as its inspection, `function f(x)`, or its diagnostic code and message. */
function rows(context: typeof vga | typeof pga, ...sources: string[]) {
  return evaluated(context, ...sources).map(({ evaluation }) =>
    evaluation?.status === 'valid' ? evaluation.inspection
      : evaluation?.status === 'function' ? `function ${evaluation.signature}`
        : evaluation?.status === 'invalid' ? `${evaluation.diagnostic.code}: ${evaluation.diagnostic.message}` : null)
}

describe('declaring a function (#340)', () => {
  it('parses a declaration with distinct parameters', () => {
    expect(parseDocumentExpression('f(x) = x * x')).toMatchObject({
      ok: true, source: { declaration: { name: 'f', parameters: [{ name: 'x' }] } },
    })
    expect(parseDocumentExpression('dist(P, Q) = norm(P & Q)')).toMatchObject({
      ok: true, source: { declaration: { name: 'dist', parameters: [{ name: 'P' }, { name: 'Q' }] } },
    })
    // A call, not a declaration.
    expect(parseDocumentExpression('f(x)')).toMatchObject({ ok: true, source: { declaration: null } })
    expect(parseDocumentExpression('f(x) == 2')).toMatchObject({ ok: true, source: { declaration: null } })
    expect(parseDocumentExpression('A = f(x)')).toMatchObject({ ok: true, source: { declaration: { name: 'A' } } })
    expect(parseDocumentExpression('A = f(x)')).not.toMatchObject({ source: { declaration: { parameters: expect.anything() } } })
  })

  it.each([
    ['f() = 1', '“f” needs at least one parameter.'],
    ['f(x, x) = x', 'The parameter “x” is repeated.'],
    ['f(e1) = 1', 'A parameter of “f” must be a name.'],
    ['f(2) = 1', 'A parameter of “f” must be a name.'],
    ['f(x y) = 1', 'Expected “,” between the parameters.'],
    ['f(x,) = 1', 'Expected a parameter after “,”.'],
    ['f(sin) = 1', 'The built-in name “sin” cannot be a parameter.'],
    ['norm(x) = x', 'The built-in name “norm” cannot be redefined.'],
  ])('refuses %s', (source, message) => {
    expect(parseDocumentExpression(source)).toMatchObject({ ok: false, diagnostic: { code: 'LANG_SYNTAX', message } })
  })

  it('names the row in the interface', () => {
    expect(declaredName('f(x) = x')).toBe('f')
    expect(declaredName(' dist ( P , Q ) = 1')).toBe('dist')
    expect(declaredName('f(x)')).toBeNull()
    expect(declaredName('f(x) == 2')).toBeNull()
  })
})

describe('calling a declared function (#340)', () => {
  it('evaluates scalars, multivectors and lists', () => {
    expect(rows(vga, 'sq(x) = x * x', 'sq(3)', 'sq(e1 + e2)', 'sq([1, 2, 3])')).toEqual([
      'function sq(x)', '9', '2', '[1, 4, 9]',
    ])
    expect(rows(vga, 'lerp(a, b, t) = a + t * (b - a)', 'lerp(e1, e2, 0.25)')[1]).toBe('0.75e1 + 0.25e2')
  })

  it('lets functions call functions, declared in any order', () => {
    expect(rows(vga, 'q(x) = sq(x) + 1', 'q(2)', 'sq(x) = x * x')).toEqual(['function q(x)', '5', 'function sq(x)'])
  })

  it('resolves the other names of the body in the document', () => {
    expect(rows(vga, 'k = 2', 'g(x) = k * x', 'g(3)')[2]).toBe('6')
    expect(rows(vga, 'k = 5', 'g(x) = k * x', 'g(3)')[2]).toBe('15')
  })

  it('may be called from a label or a slider bound', () => {
    const items = evaluated(vga, 'sq(x) = x * x', 'a = 3')
    expect(valueSourceEvaluator(items, vga.engine)('sq(a) + 1')).toMatchObject({ status: 'valid' })
    const result = valueSourceEvaluator(items, vga.engine)('sq(a) + 1')
    if (result.status !== 'valid' || result.value.kind !== 'multivector') throw new Error(JSON.stringify(result))
    expect(result.value.coefficients[0]).toBe(10)
    expect(valueSourceEvaluator(items, vga.engine)('sq')).toMatchObject({
      status: 'invalid', diagnostic: { code: 'LANG_FUNCTION_VALUE' },
    })
  })

  it('reports the errors of a call', () => {
    expect(rows(vga, 'sq(x) = x * x', 'sq(1, 2)')[1]).toBe('LANG_ARITY: “sq” takes 1 argument, received 2.')
    expect(rows(vga, 'inv(x) = 1 / x', 'inv(0)')[1]).toMatch(/^ALG_SINGULAR: In “inv”: /)
    expect(rows(vga, 'sq(x) = x * x', 'd = sq')[1]).toBe('LANG_FUNCTION_VALUE: “sq” is a function: call it, as in sq(x).')
    expect(rows(vga, 'a = 2', 'a(3)')[1]).toBe('LANG_NOT_A_FUNCTION: “a” is not a function.')
    expect(rows(vga, 'h(3)')[0]).toMatch(/^LANG_UNSUPPORTED_FUNCTION/)
    expect(rows(vga, 'f(x) = x.position', 'f(e1)')[1]).toMatch(/^LANG_UNSUPPORTED_PROPERTY/)
  })

  it('reports the errors of a declaration on its row', () => {
    // An unknown name is an error of the function even if it is never called.
    expect(rows(vga, 'f(x) = x + missing')[0]).toBe('LANG_UNDEFINED_NAME: The name “missing” is not defined.')
    expect(rows(vga, 'f(x) = x + missing', 'f(1)')[1]).toBe('LANG_INVALID_DEPENDENCY: The function “f” is invalid.')
    expect(rows(vga, 'x = 1', 'f(x) = x')[1]).toBe('LANG_PARAMETER_NAME: The parameter “x” has the name of an item of the document.')
    expect(rows(pga, 'point(x) = x')[0]).toBe('LANG_RESERVED_NAME: “point” is a function of the active algebra.')
    expect(rows(vga, 'f(x) = 1', 'f(y) = 2', 'f(3)')[2]).toBe('LANG_DUPLICATE_NAME: The name “f” is declared more than once.')
  })

  it('reports direct and mutual recursion as cycles', () => {
    expect(rows(vga, 'f(x) = f(x - 1)', 'f(3)')[0]).toMatch(/^LANG_DEPENDENCY_CYCLE/)
    const mutual = rows(vga, 'f(x) = g(x)', 'g(x) = f(x)')
    expect(mutual.every((row) => row?.startsWith('LANG_DEPENDENCY_CYCLE'))).toBe(true)
  })

  it('limits how deeply calls nest', () => {
    const chain = Array.from({ length: 40 }, (_, index) => index === 0 ? 'f0(x) = x' : `f${index}(x) = f${index - 1}(x)`)
    const result = rows(vga, ...chain, 'f39(1)', 'f20(1)')
    expect(result.at(-2)).toBe('LIMIT_CALL_DEPTH: Calls to declared functions are nested more than 32 deep.')
    expect(result.at(-1)).toBe('1')
  })

  it('writes the sphere-tracing distance once (#337)', () => {
    const scene = ['C = point(3, 0)', 'rc = 1', 'G = line(0, 1, -2)', 'O = point(0, 0.5)', 'X = point(1, -1)']
    const unrolled = (P: string) => `min(norm(${P} & C) - rc, (G ^ ${P}).e012 / norm(G))`
    const declared = rows(pga, ...scene, 'sdf(P) = min(norm(P & C) - rc, (G ^ P).e012 / norm(G))',
      'sdf(O)', 'sdf(X)', 'sdf([O, X])')
    const reference = rows(pga, ...scene, unrolled('O'), unrolled('X'))
    expect(declared.slice(6, 8)).toEqual(reference.slice(5, 7))
    expect(declared[8]).toBe(`[${reference[5]}, ${reference[6]}]`)
  })
})
