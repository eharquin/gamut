import { describe, expect, it } from 'vitest'
import {
  directConstructorComponents,
  directItemConstructorComponents,
  directItemLiteralEdit,
  literalComponentValue,
  rewriteConstructorLiterals,
} from './constructorLiteralEdit'

const VGA_TUPLE = { constructor: 'vector', arities: [2] }
const PGA_TUPLE = { constructor: 'point', arities: [2, 3] }
const EUCLIDEAN_POINT = { constructor: 'point', arity: 2, weightedConstructor: 'point' }
const IDEAL_POINT = { constructor: 'ipoint', arity: 2, weightedConstructor: 'point' }

describe('constructor literal editing', () => {
  it('edits any registered constructor call by name and arity', () => {
    const source = 'P = point(1, -2, 1)'
    const components = directItemConstructorComponents(source, 'point', 3)
    expect(components).toEqual([
      { kind: 'literal', span: { start: 10, end: 11 } },
      { kind: 'literal', span: { start: 13, end: 15 } },
      { kind: 'literal', span: { start: 17, end: 18 } },
    ])
    expect(rewriteConstructorLiterals(source, components!, [3.5, 4, 1])).toBe('P = point(3.5, 4, 1)')
  })

  it('reads a tuple as the constructor the active algebra gives it (#180)', () => {
    expect(directConstructorComponents('(1, 2)', 'vector', 2, VGA_TUPLE)).toHaveLength(2)
    expect(directConstructorComponents('(1, 2)', 'point', 2, VGA_TUPLE)).toBeNull()
    expect(directConstructorComponents('(1, 2)', 'point', 2, PGA_TUPLE)).toHaveLength(2)
    expect(directConstructorComponents('(1, 2)', 'vector', 2, PGA_TUPLE)).toBeNull()
    expect(directItemConstructorComponents('P = (1, 2, 2)', 'point', 3, PGA_TUPLE)).toHaveLength(3)
    // An arity the algebra does not accept is not that constructor.
    expect(directConstructorComponents('(1, 2, 3)', 'vector', 3, VGA_TUPLE)).toBeNull()
    expect(directConstructorComponents('(1, 2, 3, 4)', 'point', 4, PGA_TUPLE)).toBeNull()
    // Without a tuple constructor, no tuple is editable.
    expect(directConstructorComponents('(1, 2)', 'vector', 2)).toBeNull()
  })

  it('rewrites a tuple in place, keeping its spelling', () => {
    const source = 'P = (2, 1)'
    const components = directItemConstructorComponents(source, 'point', 2, PGA_TUPLE)
    expect(rewriteConstructorLiterals(source, components!, [2.5, 1])).toBe('P = (2.5, 1)')
    const position = '( -1 ,2 )'
    expect(rewriteConstructorLiterals(position, directConstructorComponents(position, 'point', 2, PGA_TUPLE)!, [3, 4]))
      .toBe('( 3 ,4 )')
  })

  it('edits vector(x, y) and VGA tuples, signs and references included', () => {
    const source = 'V = vector(-2, +3)'
    const components = directItemConstructorComponents(source, 'vector', 2, VGA_TUPLE)
    expect(rewriteConstructorLiterals(source, components!, [1.25, -4])).toBe('V = vector(1.25, -4)')
    const referenced = directItemConstructorComponents('V = vector(-a, 2)', 'vector', 2, VGA_TUPLE)
    expect(referenced).toEqual([
      { kind: 'reference', name: 'a', sign: -1 },
      { kind: 'literal', span: { start: 15, end: 16 } },
    ])
    expect(rewriteConstructorLiterals('V = vector(-a, 2)', referenced!, [3, 4])).toBe('V = vector(-a, 4)')
    expect(directItemConstructorComponents('V = vector(a + 1, 2)', 'vector', 2, VGA_TUPLE)).toBeNull()
    expect(directConstructorComponents('(1 / 2, 3)', 'vector', 2, VGA_TUPLE)).toBeNull()
  })

  it('refuses a different constructor, arity, or compound argument', () => {
    expect(directItemConstructorComponents('P = point(1, 2)', 'point', 3)).toBeNull()
    expect(directItemConstructorComponents('P = line(1, 2, 3)', 'point', 3)).toBeNull()
    expect(directItemConstructorComponents('P = point(1 + 1, 2, 3)', 'point', 3)).toBeNull()
  })

  it('edits anonymous expressions as well as declarations', () => {
    expect(directItemConstructorComponents('point(1, 2, 3)', 'point', 3)).toHaveLength(3)
    expect(rewriteConstructorLiterals('ipoint(1, 2)', directItemConstructorComponents('ipoint(1, 2)', 'ipoint', 2)!, [3, 4]))
      .toBe('ipoint(3, 4)')
  })

  it('rewrites literals around signed references without touching them', () => {
    const source = 'P = point(-a, 2, w)'
    const components = directItemConstructorComponents(source, 'point', 3)
    expect(components).toMatchObject([
      { kind: 'reference', name: 'a', sign: -1 },
      { kind: 'literal' },
      { kind: 'reference', name: 'w', sign: 1 },
    ])
    expect(rewriteConstructorLiterals(source, components!, [9, 7.25, 9])).toBe('P = point(-a, 7.25, w)')
  })

  describe('weighted points (#181)', () => {
    it('edits the coordinates of point(x, y) and of point(x, y, w), never the weight', () => {
      expect(directItemLiteralEdit('P = point(1, 2)', EUCLIDEAN_POINT)).toEqual({
        components: [
          { kind: 'literal', span: { start: 10, end: 11 } },
          { kind: 'literal', span: { start: 13, end: 14 } },
        ],
        weight: null,
      })
      const source = 'P = point(4, 2, 2)'
      const edit = directItemLiteralEdit(source, EUCLIDEAN_POINT)
      expect(edit).toEqual({
        components: [
          { kind: 'literal', span: { start: 10, end: 11 } },
          { kind: 'literal', span: { start: 13, end: 14 } },
        ],
        weight: { kind: 'literal', span: { start: 16, end: 17 } },
      })
      expect(literalComponentValue(source, edit!.weight!)).toBe(2)
      expect(rewriteConstructorLiterals(source, edit!.components, [6, 2])).toBe('P = point(6, 2, 2)')
    })

    it('reads negative and fractional weights', () => {
      const negative = 'P = point(-2, -1, -1)'
      expect(literalComponentValue(negative, directItemLiteralEdit(negative, EUCLIDEAN_POINT)!.weight!)).toBe(-1)
      const fractional = 'P = point(1, 1, 0.5)'
      expect(literalComponentValue(fractional, directItemLiteralEdit(fractional, EUCLIDEAN_POINT)!.weight!)).toBe(0.5)
      const spaced = 'P = point(1, 1, - 2.5e+0)'
      expect(literalComponentValue(spaced, directItemLiteralEdit(spaced, EUCLIDEAN_POINT)!.weight!)).toBe(-2.5)
    })

    it('keeps a weight written as a name, and refuses one shared with a coordinate', () => {
      const edit = directItemLiteralEdit('P = point(a, 2, w)', EUCLIDEAN_POINT)
      expect(edit).toMatchObject({
        components: [{ kind: 'reference', name: 'a', sign: 1 }, { kind: 'literal' }],
        weight: { kind: 'reference', name: 'w', sign: 1 },
      })
      expect(literalComponentValue('P = point(a, 2, w)', edit!.weight!)).toBeNull()
      expect(directItemLiteralEdit('P = point(w, 2, w)', EUCLIDEAN_POINT)).toBeNull()
      expect(directItemLiteralEdit('P = point(1, 2, 1 + 1)', EUCLIDEAN_POINT)).toBeNull()
    })

    it('edits a tuple (x, y, w) like point(x, y, w)', () => {
      const source = 'P = (4, 2, 2)'
      const edit = directItemLiteralEdit(source, EUCLIDEAN_POINT, PGA_TUPLE)
      expect(edit?.weight).toEqual({ kind: 'literal', span: { start: 11, end: 12 } })
      expect(rewriteConstructorLiterals(source, edit!.components, [6, 2])).toBe('P = (6, 2, 2)')
      expect(directItemLiteralEdit('P = (1, 2)', EUCLIDEAN_POINT, PGA_TUPLE)).toMatchObject({ weight: null })
      expect(directItemLiteralEdit(source, EUCLIDEAN_POINT)).toBeNull()
    })

    it('edits point(x, y, 0) and (x, y, 0) like ipoint(x, y), keeping the zero', () => {
      for (const [source, rewritten] of [
        ['D = point(1, 2, 0)', 'D = point(3, -4, 0)'],
        ['D = (1, 2, 0)', 'D = (3, -4, 0)'],
        ['D = ipoint(1, 2)', 'D = ipoint(3, -4)'],
      ] as const) {
        const edit = directItemLiteralEdit(source, IDEAL_POINT, PGA_TUPLE)
        expect(edit?.components).toHaveLength(2)
        expect(rewriteConstructorLiterals(source, edit!.components, [3, -4])).toBe(rewritten)
      }
    })
  })
})
