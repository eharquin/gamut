import { describe, expect, it } from 'vitest'
import { createVga2Engine } from '../algebra/vgaEngine'
import { createPga2Engine } from '../algebra/pgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { expressionDocument } from '../document/expressionDocument'
import { evaluateDocument } from './evaluateDocument'
import { evaluateSource } from './evaluateSource'

const vga = { engine: createVga2Engine(), interpretation: VGA_2D_INTERPRETATION }
const pga = { engine: createPga2Engine(), interpretation: PGA_2D_INTERPRETATION }

/** The inspection of each row of a document, or its diagnostic code. */
function rows(context: typeof vga | typeof pga, ...sources: string[]) {
  return evaluateDocument(
    expressionDocument(sources.map((source, index) => ({ id: `item-${index}`, source }))),
    context,
  ).map(({ evaluation }) => evaluation?.status === 'valid' ? evaluation.inspection
    : evaluation?.status === 'invalid' ? evaluation.diagnostic.code : evaluation?.status)
}

describe('comparisons, if and sign (#339)', () => {
  it.each([
    ['1 < 2', '1'], ['2 < 2', '0'], ['2 <= 2', '1'], ['3 <= 2', '0'],
    ['3 > 2', '1'], ['2 > 2', '0'], ['2 >= 2', '1'], ['1 >= 2', '0'],
    ['2 == 2', '1'], ['2 == 3', '0'], ['2 != 3', '1'], ['2 != 2', '0'],
    ['0.1 + 0.2 == 0.3', '0'],
    ['[1, 2, 3] > 2', '[0, 0, 1]'],
    ['[1, 2] == [1, 3]', '[1, 0]'],
  ])('compares %s exactly to %s', (source, inspection) => {
    expect(evaluateSource(source, vga)).toMatchObject({ status: 'valid', inspection })
    expect(evaluateSource(source, pga)).toMatchObject({ status: 'valid', inspection })
  })

  it('refuses a non-scalar operand', () => {
    expect(evaluateSource('e1 < 2', vga)).toMatchObject({
      status: 'invalid', diagnostic: { code: 'ALG_DOMAIN', message: 'The left operand of a comparison must be scalar.' },
    })
    expect(evaluateSource('[1, 2] < [e1, 1]', vga)).toMatchObject({
      status: 'invalid', diagnostic: { code: 'ALG_DOMAIN', message: 'List element 0: The right operand of a comparison must be scalar.' },
    })
  })

  it.each([
    ['sign(-3)', '-1'], ['sign(0)', '0'], ['sign(-0)', '0'], ['sign(0.5)', '1'],
    ['sign([-2, 0, 2])', '[-1, 0, 1]'],
  ])('evaluates %s to %s', (source, inspection) => {
    expect(evaluateSource(source, vga)).toMatchObject({ status: 'valid', inspection })
  })

  it('selects a branch and evaluates only that one', () => {
    expect(evaluateSource('if(1, e1, e2)', vga)).toMatchObject({ status: 'valid', inspection: 'e1' })
    expect(evaluateSource('if(0, e1, e2)', vga)).toMatchObject({ status: 'valid', inspection: 'e2' })
    expect(evaluateSource('if(-0.5, e1, e2)', vga)).toMatchObject({ status: 'valid', inspection: 'e1' })
    // The other branch would fail: a division by zero, an index out of range.
    expect(rows(vga, 'u = 0', 'if(u != 0, u / abs(u), 0)')[1]).toBe('0')
    expect(rows(vga, 'u = -2', 'if(u != 0, u / abs(u), 0)')[1]).toBe('-1')
    expect(rows(vga, 'L = [4, 5]', 'i = 3', 'if(i < 2, L[i], -1)')[2]).toBe('-1')
    expect(rows(vga, 'L = [4, 5]', 'i = 1', 'if(i < 2, L[i], -1)')[2]).toBe('5')
  })

  it('selects element by element with a list condition', () => {
    expect(evaluateSource('if([1, 0, 2], e1, e2)', vga)).toMatchObject({ status: 'valid', inspection: '[e1, e2, e1]' })
    expect(evaluateSource('if([1, 0, 1], [10, 20, 30], [-1])', vga)).toMatchObject({ status: 'valid', inspection: '[10, -1, 30]' })
    // A branch that no element selects is not evaluated.
    expect(evaluateSource('if([1, 1], 3, 1 / 0)', vga)).toMatchObject({ status: 'valid', inspection: '[3, 3]' })
    expect(evaluateSource('if([1, 0], [1, 2, 3], 0)', vga)).toMatchObject({ status: 'invalid', diagnostic: { code: 'LANG_LIST_LENGTH' } })
    // The condition and the branches broadcast together, as in a binary operation.
    expect(evaluateSource('if([1], [1, 2, 3], 0)', vga)).toMatchObject({ status: 'valid', inspection: '[1, 2, 3]' })
    expect(evaluateSource('if([0], [1, 2, 3], [7])', vga)).toMatchObject({ status: 'valid', inspection: '[7]' })
    expect(evaluateSource('if([1, 0], [], 1)', vga)).toMatchObject({
      status: 'invalid', diagnostic: { code: 'LANG_LIST_LENGTH', message: 'An empty list is incompatible with a non-empty list.' },
    })
    // An empty condition selects nothing.
    expect(evaluateSource('if([], 1 / 0, 2)', vga)).toMatchObject({ status: 'valid', inspection: '[]' })
  })

  it('evaluates in PGA(2) as in VGA(2)', () => {
    expect(evaluateSource('if(1 < 2, point(1, 2), ipoint(1, 0))', pga)).toMatchObject({ status: 'valid', inspection: '2e01 - e02 + e12' })
    expect(evaluateSource('if([1, 0], point(1, 2), ipoint(1, 0))', pga)).toMatchObject({
      status: 'valid', inspection: '[2e01 - e02 + e12, -e02]',
    })
    expect(evaluateSource('sign([-2, 0, 3])', pga)).toMatchObject({ status: 'valid', inspection: '[-1, 0, 1]' })
    expect(evaluateSource('if(point(1, 2), 1, 2)', pga)).toMatchObject({ status: 'invalid', diagnostic: { code: 'ALG_DOMAIN' } })
    expect(rows(pga, 'u = 0', 'if(u != 0, 1 / u, 0)')[1]).toBe('0')
  })

  it('keeps the positions of the items a list condition selects (#339 review)', () => {
    const positions = (...items: { id: string; source: string; positionSource?: string }[]) => {
      const evaluated = evaluateDocument(expressionDocument(items), pga)
      const last = evaluated.at(-1)!.evaluation
      if (last?.status !== 'valid' || last.valueType !== 'list') throw new Error(JSON.stringify(last))
      return last.inspection
    }
    const d1 = { id: 'd1', source: 'D1 = ipoint(1, 0)', positionSource: 'point(1, 2)' }
    const d2 = { id: 'd2', source: 'D2 = ipoint(0, 1)', positionSource: 'point(-3, 0)' }
    const expected = positions(d1, d2, { id: 'l', source: 'L = [D1, D2]' }, { id: 'p', source: 'L.position' })
    expect(positions(d1, d2, { id: 'l', source: 'L = if([1, 0], D1, D2)' }, { id: 'p', source: 'L.position' }))
      .toBe(expected)
    // A later list of D1 keeps its position after an unrelated if.
    expect(positions(d1, d2, { id: 'l', source: 'L = if([1, 1], D1, D2)' }, { id: 'm', source: 'M = [D1]' }, { id: 'p', source: 'M.position' }))
      .toBe(positions(d1, d2, { id: 'm', source: 'M = [D1]' }, { id: 'p', source: 'M.position' }))
  })

  it('refuses a non-scalar condition', () => {
    expect(evaluateSource('if(e1, 1, 2)', vga)).toMatchObject({
      status: 'invalid', diagnostic: { code: 'ALG_DOMAIN', message: 'The condition of “if” must be scalar.' },
    })
    expect(evaluateSource('if([1, e1], 1, 2)', vga)).toMatchObject({
      status: 'invalid', diagnostic: { code: 'ALG_DOMAIN', message: 'Condition element 1: The condition of “if” must be scalar.' },
    })
  })

  it('keeps names in both branches as dependencies', () => {
    // b is invalid, and the branch that uses it is not selected: the row still depends on it.
    expect(rows(vga, 'b = 1 / 0', 'c = 1', 'if(c, 2, b)')).toEqual(['ALG_SINGULAR', '1', 'LANG_INVALID_DEPENDENCY'])
  })

  it('replaces the arithmetic encodings of real documents (#337)', () => {
    // Away from their boundaries, the encodings and the conditionals agree.
    for (const [qx, qy] of [[3, 1], [1, 3]]) {
      const [, , encoded, conditional] = rows(vga, `qx = ${qx}`, `qy = ${qy}`,
        '(1 + (qx - qy) / abs(qx - qy)) / 2', 'if(qx > qy, 1, 0)')
      expect(conditional).toBe(encoded)
    }
    for (const [n, k] of [[5, 2], [2, 5]]) {
      const [, , encoded, conditional] = rows(vga, `n = ${n}`, `k = ${k}`, 'min(max(n - k, 0), 1)', 'if(k < n, 1, 0)')
      expect(conditional).toBe(encoded)
    }
    expect(rows(vga, 'u = -2', 'u / abs(u)', 'sign(u)').slice(1)).toEqual(['-1', '-1'])
    // On a boundary, the encodings fail and the conditionals have a value.
    expect(rows(vga, 'qx = 2', 'qy = 2', '(1 + (qx - qy) / abs(qx - qy)) / 2', 'if(qx > qy, 1, 0)').slice(2))
      .toEqual(['ALG_SINGULAR', '0'])
    expect(rows(vga, 'u = 0', 'u / abs(u)', 'sign(u)').slice(1)).toEqual(['ALG_SINGULAR', '0'])
    // The index (1 - su) / 2 is rejected once su is computed; the conditional needs no index arithmetic.
    for (const [u, side] of [['0.3', 'e1'], ['-0.3', 'e2'], ['0', 'e1']]) {
      expect(rows(vga, 'sides = [e1, e2]', `u = ${u}`, 'if(u >= 0, sides[0], sides[1])')[2]).toBe(side)
    }
    // The encoding fails even away from the boundary: (1 - su) / 2 is 5.6e-17, not the index 0.
    expect(rows(vga, 'sides = [e1, e2]', 'u = 0.3', 'su = u / abs(u)', 'sides[(1 - su) / 2]')[3]).toBe('LANG_INDEX_DOMAIN')
    expect(rows(vga, 'sides = [e1, e2]', 'u = 0', 'su = u / abs(u)', 'sides[(1 - su) / 2]')[3]).toBe('LANG_INVALID_DEPENDENCY')
  })
})
