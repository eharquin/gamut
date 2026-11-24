import { describe, expect, it } from 'vitest'
import { migrateLabelToVersion2, migrateSourceToVersion2 } from './migrateLanguage'

describe('language version 1 to 2 (#342)', () => {
  it.each([
    ['A.norm', 'norm(A)'],
    ['d = A.inorm', 'd = inorm(A)'],
    ['B.dual + C.inverse', 'dual(B) + inverse(C)'],
    ['X.reverse * Y.involution', 'reverse(X) * involution(Y)'],
    ['(A + B).norm', 'norm(A + B)'],
    ['(A & B).norm / 2', 'norm(A & B) / 2'],
    ['A.inverse.norm', 'norm(inverse(A))'],
    ['((A)).norm', 'norm((A))'],
    ['(a, b).norm', 'norm((a, b))'],
    ['-A.norm', '-norm(A)'],
    ['2e1.norm', '(2 * norm(e1))'],
    // `1 / 2e12` is `(1 / 2) e12`, so the group keeps that reading.
    ['1 / 2e12.inverse', '(1 / 2 * inverse(e12))'],
    ['line(1, 0, 2).norm', 'norm(line(1, 0, 2))'],
    ['[A, B].norm[0]', 'norm([A, B])[0]'],
    ['L[A.norm]', 'L[norm(A)]'],
    ['R = sqrt(M * L / (M.norm * L.norm))', 'R = sqrt(M * L / (norm(M) * norm(L)))'],
    ['  A .norm  ', '  norm(A)  '],
  ])('rewrites %s as %s', (source, expected) => {
    expect(migrateSourceToVersion2(source)).toBe(expected)
  })

  it.each([
    'A.e12 + A.g1',
    'P.position + V.head',
    'normal = 1',
    'A.norm +',
    '2A.norm',
    '',
  ])('leaves %j unchanged', (source) => {
    expect(migrateSourceToVersion2(source)).toBe(source)
  })

  it('rewrites the insertions of a label and nothing else', () => {
    expect(migrateLabelToVersion2('|AB| = ${(A & B).norm} and A.norm')).toBe('|AB| = ${norm(A & B)} and A.norm')
    expect(migrateLabelToVersion2('\\${A.norm} ${A.norm')).toBe('\\${A.norm} ${A.norm')
    expect(migrateLabelToVersion2('plain')).toBe('plain')
  })
})
