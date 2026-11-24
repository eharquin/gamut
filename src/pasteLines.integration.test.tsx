import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { parseCanonicalDocument, serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument, MAX_EXPRESSION_ITEMS, type ExpressionDocument } from './document/expressionDocument'

beforeEach(() => {
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

function open(document: ExpressionDocument) {
  window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(toCanonicalDocument(document, 'light')))
  render(<App />)
}

const editors = () => screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Expression \d+$/ })
const sources = () => editors().map((element) => element.value)
const stored = () => parseCanonicalDocument(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!)

/** Pastes `text` into an editor over the selection from `start` to `end`. */
function paste(editor: HTMLInputElement, text: string, start = editor.value.length, end = start) {
  editor.focus()
  editor.setSelectionRange(start, end)
  fireEvent.paste(editor, { clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') } })
}

const BLOCK = [
  'l = distances_to_transformed_axes',
  'c = [min(max(l[0], -bx), bx), min(max(l[1], -by), by)]',
  'm = min(max(dtb[0], dtb[1]), 0)',
  'kx = (1 + (dtb[0] - dtb[1]) / abs(dtb[0] - dtb[1])) / 2',
  'pu = c[0] - kx * m * l[0] / abs(l[0])',
  'pv = c[1] - (1 - kx) * m * l[1] / abs(l[1])',
  'P = M >>> point(pu, pv)',
  'check = norm(X & P) - abs(sdf)',
]

const rows = (...rowSources: string[]) => expressionDocument(
  rowSources.map((source, index) => ({ id: `item-${index + 1}`, source })), {}, { id: 'paste', title: 'Paste' },
)

describe('pasting several lines into an expression (#336)', () => {
  it('makes one row per line, in one undo step, with the caret after the last line', async () => {
    open(rows('A = 1', ''))
    paste(editors()[1], `${BLOCK.join('\r\n')}\r\n`)
    expect(sources()).toEqual(['A = 1', ...BLOCK])
    await waitFor(() => expect(editors().at(-1)).toHaveFocus())
    expect(editors().at(-1)!.selectionStart).toBe(BLOCK.at(-1)!.length)
    expect(screen.getByText('Pasted 8 rows.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(sources()).toEqual(['A = 1', ''])
  })

  it('pastes into the middle of a row, keeping the text around the selection', () => {
    open(rows('a = x + 1', 'z = 0'))
    paste(editors()[0], 'b\nc = d', 4, 5)
    expect(sources()).toEqual(['a = b', 'c = d + 1', 'z = 0'])
  })

  it('makes notes, never folders, and keeps the rows in the folder pasted into', async () => {
    const document = rows('A = 1', 'B = 2')
    open({ ...document, items: document.items.map((item) => ({ ...item, folder: ['Sums'] })), folders: [{ path: ['Sums'], collapsed: false }] })
    paste(editors()[1], '\n"A note\n/ Points\nC = 3', 5)
    await waitFor(() => expect(stored().items.map(({ kind, source, folder }) => ({ kind, source, folder }))).toEqual([
      { kind: 'expression', source: 'A = 1', folder: ['Sums'] },
      { kind: 'expression', source: 'B = 2', folder: ['Sums'] },
      { kind: 'annotation', source: 'A note', folder: ['Sums'] },
      { kind: 'expression', source: '/ Points', folder: ['Sums'] },
      { kind: 'expression', source: 'C = 3', folder: ['Sums'] },
    ]))
    expect(stored().folders?.map(({ path }) => path)).toEqual([['Sums']])
  })

  it('refuses a paste that would exceed the item limit, changing nothing', () => {
    open(rows(...Array.from({ length: MAX_EXPRESSION_ITEMS - 1 }, (_, index) => `a${index} = ${index}`)))
    const last = editors().at(-1)!
    paste(last, 'x = 1\ny = 2\nz = 3')
    expect(editors()).toHaveLength(MAX_EXPRESSION_ITEMS - 1)
    expect(last.value).toBe(`a${MAX_EXPRESSION_ITEMS - 2} = ${MAX_EXPRESSION_ITEMS - 2}`)
    expect(screen.getByText(`The paste would make more than ${MAX_EXPRESSION_ITEMS} rows; nothing was changed.`)).toBeInTheDocument()
  }, 60_000)

  it('pastes a single line as before', () => {
    open(rows('a = '))
    const editor = editors()[0]
    paste(editor, '1')
    // The browser inserts it: the paste event is not prevented.
    expect(sources()).toEqual(['a = '])
  })
})
