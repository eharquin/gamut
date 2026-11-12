import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  it('turns a row starting with # into an annotation that is neither evaluated nor drawn', () => {
    render(<App />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    expect(viewportDescription()).toContain('Vector 1')

    fireEvent.change(input, { target: { value: '# Titre **gras**' } })

    const note = screen.getByRole('textbox', { name: 'Annotation 1' })
    expect(note).toBe(input)
    expect(note).toHaveValue('# Titre **gras**')
    const article = row('Annotation 1')
    // Text without the # marker or the delimiters, as a screen reader reads it.
    expect(note).toHaveAccessibleDescription('Titre gras')
    expect(within(article).getByText('gras').tagName).toBe('STRONG')
    expect(within(article).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(article).queryByRole('status')).not.toBeInTheDocument()
    expect(within(article).queryByText('2e1 + e2')).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: /menu for/ })).not.toBeInTheDocument()
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
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveValue('# Titre **gras**')
  })

  it('turns back into an evaluated expression when the # is removed', () => {
    render(<App />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(input, { target: { value: '# V = vector(1, 3)' } })
    fireEvent.blur(input)
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'V = vector(1, 3)' } })
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toBe(input)
    expect(screen.getByText('e1 + 3e2')).toBeInTheDocument()
    expect(viewportDescription()).toMatch(/V runs from the origin to 1, 3/)

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Annotation 1' })).toHaveValue('# V = vector(1, 3)')
  })

  it('comments out a positioned row and restores its position with one undo', () => {
    openStored([{ id: 'v', source: 'V = vector(2, 1)', positionSource: '(1, 1)' }])
    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('(1, 1)')

    fireEvent.change(input, { target: { value: '#V = vector(2, 1)' } })
    expect(screen.queryByRole('textbox', { name: 'Position 1' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('V = vector(2, 1)')
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('(1, 1)')
  })

  it('renders safe links and shows any other destination as text', () => {
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(input, {
      target: { value: '# See [the docs](https://example.org/docs), [bad](javascript:alert(1)) and <b>x</b>' },
    })
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
    expect(within(article).getByText(/\[bad\]\(javascript:alert\(1\)\) and <b>x<\/b>/)).toBeInTheDocument()
    // The link follows the source editor in reading and Tab order.
    expect(input.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  it('opens stored annotations without # unchanged (format fixtures stay valid)', () => {
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

    fireEvent.change(input, { target: { value: '# ' + playing } })
    act(() => vi.advanceTimersByTime(1000))
    expect(input).toHaveValue('# ' + playing)
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
