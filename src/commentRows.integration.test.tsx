import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument, type ExpressionItem } from './document/expressionDocument'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

function viewportDescription(): string {
  return screen.getByRole('img', { name: /Two-dimensional VGA viewport/ }).textContent ?? ''
}

function openStored(items: ExpressionItem[]) {
  const stored = toCanonicalDocument(expressionDocument(items, {}, { id: 'comments' }), 'light')
  window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(stored))
  vi.stubEnv('MODE', 'development')
  render(<App />)
}

function row(name: string): HTMLElement {
  return screen.getByRole('textbox', { name }).closest('article')!
}

describe('comment rows (#187)', () => {
  it('turns a row into a note when a quotation mark is typed first, neither evaluated nor drawn', () => {
    render(<App />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    expect(viewportDescription()).toContain('Vector 1')

    fireEvent.change(input, { target: { value: '"Titre **gras**' } })

    const note = screen.getByRole('textbox', { name: 'Annotation 1' })
    // A note is edited in a textarea, which takes the focus of the row.
    expect(note.tagName).toBe('TEXTAREA')
    expect(note).toHaveFocus()
    // The quotation mark is not stored.
    expect(note).toHaveValue('Titre **gras**')
    fireEvent.blur(note)
    const article = row('Annotation 1')
    // Text without the delimiters, as a screen reader reads it.
    expect(note).toHaveAccessibleDescription('Titre gras')
    expect(within(article).getByText('gras').tagName).toBe('STRONG')
    expect(within(article).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(article).queryByRole('status')).not.toBeInTheDocument()
    expect(within(article).queryByText('2e1 + e2')).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: /menu for/ })).not.toBeInTheDocument()
    // A note shows no status pastille.
    expect(article.querySelector('.expression-status-pastille')).toBeNull()
    expect(within(article).queryByRole('button', { name: /^(Hide|Show) / })).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: /^Normalization/ })).not.toBeInTheDocument()
    expect(within(article).queryByRole('textbox', { name: 'Position 1' })).not.toBeInTheDocument()
    expect(viewportDescription()).not.toContain('Vector 1')
    expect(document.querySelectorAll('line.vector')).toHaveLength(0)

    // One undo restores the expression, its value, and its drawing.
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('vector(2, 1)')
    expect(screen.getByText('2e1 + e2')).toBeInTheDocument()
    expect(viewportDescription()).toContain('Vector 1')
    fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveValue('Titre **gras**')

    // A note keeps its kind whatever it starts with: # and a quotation mark are text.
    fireEvent.change(screen.getByRole('textbox', { name: 'Annotation 1' }), { target: { value: '# "quoted"' } })
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveValue('# "quoted"')
  })

  it('leaves a quotation mark elsewhere in an expression alone', () => {
    render(<App />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(input, { target: { value: 'vector(2, 1) "' } })
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('vector(2, 1) "')
  })

  it('turns back into an evaluated expression on Backspace before its first character', () => {
    render(<App />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(input, { target: { value: '"V = vector(1, 3)' } })
    const note = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Annotation 1' })

    // Backspace elsewhere in the note edits its text only.
    note.setSelectionRange(3, 3)
    fireEvent.keyDown(note, { key: 'Backspace' })
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toBeInTheDocument()
    note.setSelectionRange(0, 0)
    fireEvent.keyDown(note, { key: 'Backspace' })
    const expression = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    expect(expression).toHaveValue('V = vector(1, 3)')
    // The row keeps the focus, with the caret where the note started.
    expect(expression).toHaveFocus()
    expect(expression.selectionStart).toBe(0)
    expect(screen.getByText('e1 + 3e2')).toBeInTheDocument()
    expect(viewportDescription()).toMatch(/V runs from the origin to 1, 3/)

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveValue('V = vector(1, 3)')
  })

  it('comments out a positioned row and restores its position with one undo', () => {
    openStored([{ id: 'v', source: 'V = vector(2, 1)', positionSource: '(1, 1)' }])
    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('(1, 1)')

    fireEvent.change(input, { target: { value: '"V = vector(2, 1)' } })
    expect(screen.queryByRole('textbox', { name: 'Position 1' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('V = vector(2, 1)')
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('(1, 1)')
  })

  it('renders safe links and shows any other destination as text', () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(input, {
      target: { value: '"See [the docs](https://example.org/docs), [bad](javascript:alert(1)) and <b>x</b>' },
    })
    fireEvent.blur(screen.getByRole('textbox', { name: 'Annotation 1' }))
    const article = row('Annotation 1')
    const links = within(article).getAllByRole('link')
    expect(links).toHaveLength(1)
    const [link] = links
    expect(link).toHaveAccessibleName('the docs')
    expect(link).toHaveAttribute('href', 'https://example.org/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('title', 'https://example.org/docs')
    expect(link).toHaveAccessibleDescription('https://example.org/docs (opens in a new tab)')
    expect(article.querySelector('a[href^="javascript"], b, script')).toBeNull()
    expect(article.querySelector('.note-rendered')).toHaveTextContent('[bad](javascript:alert(1)) and <b>x</b>')
    // The link follows the source editor in reading and Tab order.
    expect(screen.getByRole('textbox', { name: 'Annotation 1' }).compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('edits a note on several lines and shows only its rendered text when it is not edited', () => {
    openStored([{ id: 'note', kind: 'annotation', source: 'First **line**' }, { id: 'v', source: 'V = vector(2, 1)' }])
    const note = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Annotation 1' })
    const rendered = () => row('Annotation 1').querySelector('.note-rendered') as HTMLElement
    // Not edited: the rendered text shows and the textarea stays in the Tab order.
    expect(rendered()).not.toHaveAttribute('hidden')
    expect(note).toHaveClass('is-collapsed')
    expect(note.tabIndex).toBe(0)

    // A click on the rendered text edits the source.
    fireEvent.mouseDown(within(rendered()).getByText('line'))
    expect(note).toHaveFocus()
    expect(rendered()).toHaveAttribute('hidden')
    expect(note).not.toHaveClass('is-collapsed')

    // Enter adds a line to the note, not a row to the document.
    fireEvent.keyDown(note, { key: 'Enter' })
    fireEvent.change(note, { target: { value: 'First **line**\nSecond line' } })
    expect(screen.getAllByRole('textbox', { name: /^(Annotation|Expression) \d+$/ })).toHaveLength(2)
    expect(note).toHaveValue('First **line**\nSecond line')

    // Escape shows the rendered text again and keeps the focus on the row.
    fireEvent.keyDown(note, { key: 'Escape' })
    expect(rendered()).not.toHaveAttribute('hidden')
    expect(rendered()).toHaveTextContent('First line Second line')
    expect(note).toHaveFocus()
    // Enter edits it again.
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(rendered()).toHaveAttribute('hidden')

    // Ctrl with Enter adds the next row, an expression.
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true })
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Expression 3' })).toHaveValue('V = vector(2, 1)')
  })

  it('renders the blocks of a note: headings, lists, quotes, code, and rules', () => {
    openStored([{
      id: 'note', kind: 'annotation',
      source: '# Triangle\nIts **angles**\n\n- one\n  - inner\n- two\n\n1. first\n\n> quoted\n\n---\n\n```\nA = **raw**\n```',
    }])
    const rendered = row('Annotation 1').querySelector('.note-rendered') as HTMLElement
    // Below the headings of the panel.
    expect(within(rendered).getByRole('heading', { level: 4, name: 'Triangle' })).toBeInTheDocument()
    expect(within(rendered).getByText('angles').tagName).toBe('STRONG')
    const lists = within(rendered).getAllByRole('list')
    expect(lists.map((list) => list.tagName)).toEqual(['UL', 'UL', 'OL'])
    expect(within(lists[1]).getByText('inner')).toBeInTheDocument()
    expect(rendered.querySelector('blockquote')).toHaveTextContent('quoted')
    expect(within(rendered).getByRole('separator')).toBeInTheDocument()
    // A code block shows its text as written.
    expect(rendered.querySelector('pre')).toHaveTextContent('A = **raw**')
    expect(rendered.querySelector('pre strong')).toBeNull()
    // The row is described by the whole rendered text.
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveAccessibleDescription(/^Triangle\s+Its angles\s+one\s+inner\s+two\s+first\s+quoted\s+A = \*\*raw\*\*$/)
  })

  it('typesets the mathematics of a note and describes the row by its TeX source', async () => {
    openStored([{ id: 'note', kind: 'annotation', source: 'Rotor $R = e^{-\\theta B/2}$' }])
    const article = row('Annotation 1')
    await waitFor(() => expect(article.querySelector('.katex')).not.toBeNull())
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveAccessibleDescription('Rotor R = e^{-\\theta B/2}')
  })

  it('moves between rows with the arrows only from the first and last position of a note', () => {
    openStored([
      { id: 'a', source: 'a = 1' },
      { id: 'note', kind: 'annotation', source: 'one\ntwo' },
      { id: 'b', source: 'b = 2' },
    ])
    const note = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Annotation 2' })
    act(() => note.focus())
    note.setSelectionRange(2, 2)
    fireEvent.keyDown(note, { key: 'ArrowDown' })
    fireEvent.keyDown(note, { key: 'ArrowUp' })
    expect(note).toHaveFocus()
    note.setSelectionRange(7, 7)
    fireEvent.keyDown(note, { key: 'ArrowDown' })
    expect(screen.getByRole('textbox', { name: 'Expression 3' })).toHaveFocus()
    act(() => note.focus())
    note.setSelectionRange(0, 0)
    fireEvent.keyDown(note, { key: 'ArrowUp' })
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveFocus()
  })

  it('makes a note of several lines one line when it becomes an expression', () => {
    openStored([{ id: 'note', kind: 'annotation', source: 'V =\n  vector(2, 1)' }])
    const note = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Annotation 1' })
    act(() => note.focus())
    note.setSelectionRange(0, 0)
    fireEvent.keyDown(note, { key: 'Backspace' })
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('V = vector(2, 1)')
  })

  it('keeps annotations out of names and dependencies', () => {
    openStored([
      { id: 'note', kind: 'annotation', source: '# A = vector(1, 1)' },
      { id: 'x', source: 'x = A' },
    ])
    expect(within(row('Expression 2')).getByRole('alert')).toHaveTextContent('LANG_UNDEFINED_NAME')
  })

  it('gives no letter to a stored annotation when an object is created in the viewport', () => {
    // A format fixture without #: its source reads like a declaration of A.
    openStored([{ id: 'note', kind: 'annotation', source: 'A = vector(1, 1)' }])
    const canvas = screen.getByRole('img', { name: /Two-dimensional VGA viewport/ })
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 640, height: 480, top: 0, right: 640, bottom: 480, left: 0, toJSON: () => ({}),
    })
    fireEvent.doubleClick(canvas, { clientX: 410, clientY: 150 })
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('A = vector(1.25, 1.25)')
  })

  it('opens stored annotations unchanged', () => {
    openStored([
      { id: 'note', kind: 'annotation', source: 'This is prose, not an expression!' },
      { id: 'v', source: 'V = vector(2, 1)' },
    ])
    const note = screen.getByRole('textbox', { name: 'Annotation 1' })
    expect(note).toHaveValue('This is prose, not an expression!')
    expect(note).toHaveAccessibleDescription('This is prose, not an expression!')
    expect(within(row('Annotation 1')).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toBeInTheDocument()
    expect(screen.getByText('2e1 + e2')).toBeInTheDocument()
  })

  it('comments out a slider row, stopping its playback, and restores the slider with one undo', () => {
    vi.useFakeTimers()
    const control = { mode: 'slider', minimumSource: '0', maximumSource: '10', stepSource: '1', animation: null } as const
    openStored([{ id: 'a', source: 'a = 2', control }])
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    expect(screen.getByRole('slider', { name: 'Value for a' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play scalar animation' }))
    act(() => vi.advanceTimersByTime(500))
    const playing = input.value

    fireEvent.change(input, { target: { value: '"' + playing } })
    act(() => vi.advanceTimersByTime(1000))
    expect(input).toHaveValue(playing)
    expect(screen.queryByRole('slider', { name: 'Value for a' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play scalar animation' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete annotation 1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue(playing)
    expect(screen.getByRole('slider', { name: 'Value for a' })).toHaveAttribute('max', '10')
  })

  it('moves a head through the scalar expression, never through an annotation of the same name', () => {
    openStored([
      { id: 'note', kind: 'annotation', source: 's = 2' },
      { id: 's', source: 's = 3' },
      { id: 'v', source: 'V1 = vector(s, 1)' },
    ])
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move head of V1' }), { key: 'ArrowRight' })
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveValue('s = 2')
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('s = 3.1')
  })
})
