import { describe, expect, it } from 'vitest'
import { pastedRows } from './pastedLines'

const expressions = (...sources: string[]) => sources.map((source) => ({ kind: 'expression', source }))
const rowsOf = (...args: Parameters<typeof pastedRows>) => pastedRows(...args)?.rows

describe('rows of a pasted block (#336)', () => {
  it('pastes a single line as usual', () => {
    expect(pastedRows('a = 1', 5, 5, ' + 2')).toBeNull()
    expect(pastedRows('', 0, 0, 'b = 2')).toBeNull()
  })

  it('never makes a folder, even of a single line', () => {
    expect(pastedRows('', 0, 0, '/Points')).toEqual({ rows: expressions('/Points'), caret: 7 })
    expect(pastedRows('x', 0, 0, '/')).toEqual({ rows: expressions('/x'), caret: 1 })
    // A slash inside a row is a division, pasted as usual.
    expect(pastedRows('a', 1, 1, ' / 2')).toBeNull()
  })

  it('puts the caret after the pasted text, before the text that followed the selection', () => {
    expect(pastedRows('a = x + 1', 4, 5, 'b\nc = d')).toEqual({ rows: expressions('a = b', 'c = d + 1'), caret: 5 })
    expect(pastedRows('', 0, 0, 'a\nb = 22\n')).toEqual({ rows: expressions('a', 'b = 22'), caret: 6 })
  })

  it.each([
    ['\n', 'a = 1\nb = 2'],
    ['\r\n', 'a = 1\r\nb = 2'],
    ['\r', 'a = 1\rb = 2'],
  ])('breaks lines at %j', (_, pasted) => {
    expect(rowsOf('', 0, 0, pasted)).toEqual(expressions('a = 1', 'b = 2'))
  })

  it('skips empty and blank lines', () => {
    expect(rowsOf('', 0, 0, '\na = 1\n\n   \n\tb = 2\n')).toEqual(expressions('a = 1', '\tb = 2'))
    expect(rowsOf('', 0, 0, '\n \n')).toEqual(expressions(''))
  })

  it('keeps the text around the selection, before the first line and after the last', () => {
    // a = |x| + 1, with x selected.
    expect(rowsOf('a = x + 1', 4, 5, 'b\nc = d')).toEqual(expressions('a = b', 'c = d + 1'))
    expect(rowsOf('A = ', 4, 4, '1\nB = 2\n')).toEqual(expressions('A = 1', 'B = 2'))
  })

  it('makes notes of lines that start with a quotation mark, and never folders', () => {
    expect(rowsOf('', 0, 0, '"A note\n/ not a folder\nP = 1')).toEqual([
      { kind: 'annotation', source: 'A note' },
      { kind: 'expression', source: '/ not a folder' },
      { kind: 'expression', source: 'P = 1' },
    ])
  })

  it('splits the example of the issue into eight rows', () => {
    const block = [
      'l = distances_to_transformed_axes',
      'c = [min(max(l[0], -bx), bx), min(max(l[1], -by), by)]',
      'm = min(max(dtb[0], dtb[1]), 0)',
      'kx = (1 + (dtb[0] - dtb[1]) / abs(dtb[0] - dtb[1])) / 2',
      'pu = c[0] - kx * m * l[0] / abs(l[0])',
      'pv = c[1] - (1 - kx) * m * l[1] / abs(l[1])',
      'P = M >>> point(pu, pv)',
      'check = norm(X & P) - abs(sdf)',
    ]
    expect(rowsOf('', 0, 0, `${block.join('\n')}\n`)).toEqual(expressions(...block))
  })
})
