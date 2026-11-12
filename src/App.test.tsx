import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  DEFAULT_OBJECT_STYLES,
  paletteEntry,
} from './components/appearancePalette'
import { CLEAR_HOLD_MS } from './components/ClearExpressionsButton'
import { serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument } from './document/expressionDocument'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function openSettings(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'Settings' })
  fireEvent.click(trigger)
  return trigger
}

/** Runs a document command from its header button, as a user would. */
function runDocumentCommand(name: 'Import' | 'Export' | 'Copy link'): void {
  fireEvent.click(screen.getByRole('button', { name: name === 'Copy link' ? name : `${name} document` }))
}

function viewportCanvas(): SVGSVGElement {
  return screen.getByRole('img', {
    name: /Two-dimensional [VP]GA viewport/,
  }) as unknown as SVGSVGElement
}

function sizeViewportCanvas(canvas: SVGSVGElement): void {
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 640, height: 480,
    top: 0, right: 640, bottom: 480, left: 0,
    toJSON: () => ({}),
  })
}

describe('VGA 2D vertical slice', () => {
  it('presents the product as GAMUT and accepts current and historical JSON filenames', () => {
    render(<App />)

    expect(screen.getByRole('link', { name: 'GAMUT home' }))
      .toHaveTextContent('GAMUT')
    expect(screen.getByLabelText('Import document file')).toHaveAttribute(
      'accept',
      'application/json,.json,.gamut.json,.multivector.json',
    )
  })

  it('downloads canonical documents with the GAMUT filename suffix', () => {
    const clickedLinks: HTMLAnchorElement[] = []
    class TestURL extends URL {
      static createObjectURL = vi.fn((_blob: Blob) => 'blob:gamut-document')
      static revokeObjectURL = vi.fn((_url: string) => undefined)
    }
    vi.stubGlobal('URL', TestURL)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedLinks.push(this)
    })
    render(<App />)

    runDocumentCommand('Export')

    expect(clickedLinks).toHaveLength(1)
    expect(clickedLinks[0].download).toBe('Untitled-document.gamut.json')
  })

  it('offers Import, Export, and Copy link as header buttons left of the theme button (#249)', () => {
    const fileDialogs = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    render(<App />)
    const header = document.querySelector('header.app-header') as HTMLElement
    const group = header.querySelector('.header-actions') as HTMLElement
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Save (unsaved changes)', 'Library', 'Import document', 'Export document', 'Copy link', 'Switch to dark theme', 'Settings'])
    for (const name of ['Import document', 'Export document', 'Copy link'])
      expect(within(group).getByRole('button', { name })).toHaveAttribute('title', name)

    // The settings menu no longer lists the document commands.
    openSettings()
    const menu = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(menu).queryByRole('region', { name: 'Document' })).not.toBeInTheDocument()
    for (const name of ['Import', 'Export', 'Copy link', 'Copy iframe code'])
      expect(within(menu).queryByRole('button', { name })).not.toBeInTheDocument()
    fireEvent.keyDown(menu, { key: 'Escape' })

    // Import opens the existing file input and keeps focus on its button.
    const importButton = within(group).getByRole('button', { name: 'Import document' })
    importButton.focus()
    fireEvent.click(importButton)
    expect(fileDialogs).toHaveBeenCalledOnce()
    expect(fileDialogs.mock.contexts[0]).toBe(screen.getByLabelText('Import document file'))
    expect(importButton).toHaveFocus()
  })

  it('imports a version 0.1 document with the historical filename suffix', async () => {
    const current = toCanonicalDocument(expressionDocument(
      [{ id: 'legacy-vector', source: 'Legacy = vector(4, 2)' }],
      {},
      { id: 'multivector-0.1.0-export', title: 'Historical export' },
    ), 'dark')
    const historical = {
      ...current,
      formatVersion: 4,
      appearance: Object.fromEntries(Object.entries(current.appearance).map(
        ([id, appearance]) => {
          const {
            idealPointDisplay: _idealPointDisplay, strokeStyle: _strokeStyle, strokeWidthSource: _strokeWidthSource,
            pointStyle: _pointStyle, pointSizeSource: _pointSizeSource, opacitySource: _opacitySource,
            labelAngleSource: _labelAngleSource, labelSizeSource: _labelSizeSource,
            labelDistanceSource: _labelDistanceSource, labelAnchor: _labelAnchor, primitiveStyles: _primitiveStyles,
            ...versionFour
          } = appearance
          return [id, versionFour]
        },
      )),
    }
    const bytes = new TextEncoder().encode(JSON.stringify(historical))
    const file = {
      name: 'historical.multivector.json',
      type: 'application/json',
      arrayBuffer: async () => bytes.slice().buffer,
    } as unknown as File
    render(<App />)

    fireEvent.change(screen.getByLabelText('Import document file'), {
      target: { files: [file] },
    })

    await waitFor(() => expect(
      screen.getByRole('textbox', { name: 'Expression 1' }),
    ).toHaveValue('Legacy = vector(4, 2)'))
  })

  it('undoes and redoes document edits with controls and standard keyboard shortcuts', () => {
    render(<App />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    const panel = screen.getByRole('complementary', { name: 'Expressions' })
    const historyControls = within(panel).getByRole('group', { name: 'Expression history' })
    const undo = within(historyControls).getByRole('button', { name: 'Undo document change' })
    const redo = within(historyControls).getByRole('button', { name: 'Redo document change' })
    expect(undo).toBeDisabled()
    expect(redo).toBeDisabled()
    expect(screen.getByRole('banner')).not.toContainElement(undo)

    fireEvent.change(input, { target: { value: 'V = e1' } })
    expect(undo).toBeEnabled()
    input.focus()
    input.setSelectionRange(2, 4, 'forward')
    fireEvent.select(input)
    fireEvent.click(undo)
    expect(input).toHaveValue('vector(2, 1)')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(2)
    expect(input.selectionEnd).toBe(4)
    expect(redo).toBeEnabled()

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(input).toHaveValue('V = e1')
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(input).toHaveValue('vector(2, 1)')
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(input).toHaveValue('V = e1')
  })

  it('returns focus to the originating expression when undo removes an inserted row', () => {
    render(<App />)
    const first = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    first.focus()
    first.setSelectionRange(3, 3)
    fireEvent.select(first)
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(screen.queryByRole('textbox', { name: 'Expression 2' })).not.toBeInTheDocument()
    expect(first).toHaveFocus()
    expect(first.selectionStart).toBe(3)
    expect(first.selectionEnd).toBe(3)
  })

  it('returns to the end of the originating position editor after insertion undo', () => {
    render(<App />)
    const position = screen.getByRole<HTMLInputElement>('textbox', { name: 'Position 1' })
    fireEvent.change(position, { target: { value: '(1,0)' } })
    position.focus()
    position.setSelectionRange(position.value.length, position.value.length)
    fireEvent.select(position)
    fireEvent.keyDown(position, { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(position).toHaveFocus()
    expect(position.selectionStart).toBe(position.value.length)
    expect(position.selectionEnd).toBe(position.value.length)
  })

  it('authors the documented foundation example with keyboard row insertion', () => {
    render(<App />)
    const enter = (position: number, source: string) => {
      const input = screen.getByRole('textbox', { name: `Expression ${position}` })
      fireEvent.change(input, { target: { value: source } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }

    enter(1, 's = 2')
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Expression 2' }),
    )
    enter(2, 'V1 = vector(s, 1)')
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 2' }), {
      target: { value: '(1, 1)' },
    })
    enter(3, 'V2 = vector(1, -1)')
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 3' }), {
      target: { value: '(0.1, 0.1)' },
    })
    enter(4, 'L = [V1, V2]')
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 5' }), {
      target: { value: 'H = V1.head' },
    })

    expect(screen.getByText('List (2)')).toBeInTheDocument()
    expect(screen.getByText('3e1 + 2e2', { selector: 'output' }))
      .toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      '5 vectors and 0 bivectors are visible.',
    )

    const secondVector = screen.getByRole('textbox', { name: 'Expression 3' })
    fireEvent.change(secondVector, { target: { value: 'V2 = vector(1)' } })
    expect(secondVector).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Expected “,” between vector components.'))
      .toBeInTheDocument()
    fireEvent.change(secondVector, {
      target: { value: 'V2 = vector(1, -1)' },
    })
    expect(secondVector).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('img')).toHaveTextContent(
      '5 vectors and 0 bivectors are visible.',
    )
  })

  it('inspects heterogeneous lists and renders supported elements in order', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'L = [1, e1, -2e12]' },
    })

    expect(screen.getByText('List (3)')).toBeInTheDocument()
    expect(screen.getByText('[1, e1, -2e12]', { selector: 'output' }))
      .toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      '1 vector and 1 bivector are visible.',
    )
    expect(screen.getByRole('img')).toHaveTextContent(
      'L[2] is an oriented loop with signed value -2',
    )
  })

  it('renders a positioned vector list with distinct accessible element names', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V1 = e1' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 1' }), {
      target: { value: '(1, 2)' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'V2 = e2' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 2' }), {
      target: { value: '(-1, 3)' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 3' }), {
      target: { value: 'V = [V1, V2]' },
    })

    expect(screen.getByLabelText('V[0]')).toHaveAttribute('x1', '392')
    expect(screen.getByLabelText('V[1]')).toHaveAttribute('x1', '248')
    expect(
      screen.queryByRole('textbox', { name: 'Position 3' }),
    ).not.toBeInTheDocument()

    const inspectionToggle = screen.getByRole('button', {
      name: 'List (2)',
    })
    expect(inspectionToggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(inspectionToggle)

    const details = screen.getByRole('list', { name: 'Elements of V' })
    const elements = within(details).getAllByRole('listitem')
    expect(elements).toHaveLength(2)
    expect(within(elements[0]).getByLabelText('Element 0')).toHaveTextContent('0')
    expect(elements[0]).toHaveTextContent('Vector')
    expect(elements[0]).toHaveTextContent('e1')
    expect(elements[0]).toHaveTextContent('position (1, 2)')
    expect(elements[1]).toHaveTextContent('Vector')
    expect(elements[1]).toHaveTextContent('e2')
    expect(elements[1]).toHaveTextContent('position (-1, 3)')
  })
  it('edits an expression and exposes its value and SVG vector in text', () => {
    render(<App />)

    expect(
      screen.getByRole('complementary', { name: 'Expressions' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Source')).not.toBeInTheDocument()
    expect(screen.queryByText('Standard interpretation')).not.toBeInTheDocument()
    expect(screen.queryByText('VGA 2D viewport')).not.toBeInTheDocument()
    expect(screen.getByText('2e1 + e2')).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: /Two-dimensional VGA viewport/,
      }),
    ).toHaveTextContent('Vector 1 runs from the origin to 2, 1.')
  })

  it('names the canvas without an SVG title that browsers show as a tooltip', () => {
    const { container } = render(<App />)
    const canvas = screen.getByRole('img', { name: 'Two-dimensional VGA viewport' })

    expect(canvas.querySelector('title')).toBeNull()
    expect(canvas).toHaveAccessibleDescription(/Vector 1 runs from the origin/)
    expect(container.querySelectorAll('svg.canvas title')).toHaveLength(0)
  })

  it('draws one SVG focus ring on the keyboard-focused handle only', () => {
    const { container } = render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    sizeViewportCanvas(viewportCanvas())
    const rings = () => container.querySelectorAll('.manipulation-focus-ring')
    const head = screen.getByRole('button', { name: 'Move head of V' })
    const base = screen.getByRole('button', { name: 'Move base of V' })

    // Pointer focus: no ring, and a later key press does not add one.
    fireEvent.pointerDown(head, { button: 0, pointerId: 5 })
    act(() => head.focus())
    fireEvent.pointerUp(viewportCanvas(), { pointerId: 5 })
    expect(rings()).toHaveLength(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(rings()).toHaveLength(0)

    // Keyboard focus: exactly one ring, on the focused handle.
    fireEvent.keyDown(window, { key: 'Tab' })
    act(() => base.focus())
    expect(rings()).toHaveLength(1)
    expect(base.parentElement?.querySelector('.manipulation-focus-ring')).not.toBeNull()
    act(() => head.focus())
    expect(rings()).toHaveLength(1)
    expect(head.parentElement?.querySelector('.manipulation-focus-ring')).not.toBeNull()
    act(() => head.blur())
    expect(rings()).toHaveLength(0)
  })

  it('keeps focus in the viewport when undoing or redoing a viewport gesture', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    act(() => source.focus())
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    const position = screen.getByRole('textbox', { name: 'Position 1' })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const undo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    const redo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })

    // Pointer head drag: undo and redo leave focus on the canvas.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move head of V' }), { button: 0, pointerId: 8 })
    fireEvent.pointerMove(canvas, { pointerId: 8, clientX: 536, clientY: 96 })
    fireEvent.pointerUp(canvas, { pointerId: 8 })
    expect(source).toHaveValue('V = vector(3, 2)')
    undo()
    expect(source).toHaveValue('V = vector(2, 1)')
    expect(canvas).toHaveFocus()
    redo()
    expect(source).toHaveValue('V = vector(3, 2)')
    expect(canvas).toHaveFocus()

    // Pointer base drag: the same, for a change of the position source.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move base of V' }), { button: 0, pointerId: 9 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 392, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 9 })
    expect(position).toHaveValue('(1, 1)')
    undo()
    expect(screen.getByRole('textbox', { name: 'Position 1' })).not.toHaveValue('(1, 1)')
    expect(canvas).toHaveFocus()
    redo()
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('(1, 1)')
    expect(canvas).toHaveFocus()

    // Keyboard head move: undo and redo return focus to that handle.
    const head = screen.getByRole('button', { name: 'Move head of V' })
    act(() => head.focus())
    fireEvent.keyDown(head, { key: 'ArrowRight' })
    expect(source).toHaveValue('V = vector(3.1, 2)')
    act(() => canvas.focus())
    undo()
    expect(source).toHaveValue('V = vector(3, 2)')
    expect(screen.getByRole('button', { name: 'Move head of V' })).toHaveFocus()
    act(() => canvas.focus())
    redo()
    expect(screen.getByRole('button', { name: 'Move head of V' })).toHaveFocus()

    // An editor change still restores its editor.
    act(() => source.focus())
    fireEvent.change(source, { target: { value: 'V = vector(4, 2)' } })
    act(() => canvas.focus())
    undo()
    expect(source).toHaveValue('V = vector(3.1, 2)')
    expect(source).toHaveFocus()
  })

  it('returns focus to the canvas when a pointer gesture ends', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const head = screen.getByRole('button', { name: 'Move head of V' })
    const base = screen.getByRole('button', { name: 'Move base of V' })

    fireEvent.pointerDown(head, { button: 0, pointerId: 8 })
    act(() => head.focus())
    fireEvent.pointerMove(canvas, { pointerId: 8, clientX: 536, clientY: 96 })
    fireEvent.pointerUp(canvas, { pointerId: 8 })
    expect(canvas).toHaveFocus()
    expect(source).toHaveValue('V = vector(3, 2)')

    fireEvent.pointerDown(base, { button: 0, pointerId: 9 })
    act(() => base.focus())
    fireEvent.pointerCancel(canvas, { pointerId: 9 })
    expect(canvas).toHaveFocus()

    fireEvent.pointerDown(head, { button: 0, pointerId: 10 })
    act(() => head.focus())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(canvas).toHaveFocus()

    // Keyboard focus on a handle is untouched.
    act(() => head.focus())
    fireEvent.keyDown(head, { key: 'ArrowRight' })
    expect(head).toHaveFocus()
  })

  it('zooms on wheel through a listener that can cancel the page zoom', () => {
    render(<App />)
    const canvas = screen.getByRole('img', { name: /Two-dimensional VGA viewport/ })

    expect(fireEvent.wheel(canvas, { deltaY: -200, clientX: 320, clientY: 240 }))
      .toBe(false)
    expect(screen.queryByText('100%', { selector: 'output' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lock viewport' }))
    expect(fireEvent.wheel(canvas, { deltaY: -200, clientX: 320, clientY: 240 }))
      .toBe(false)
  })

  it('navigates the persistent viewport without creating mathematical history', () => {
    const { container } = render(<App />)
    const canvas = screen.getByRole('img', { name: /Two-dimensional VGA viewport/ })
    const vector = screen.getByLabelText('Vector 1')
    const undo = screen.getByRole('button', { name: 'Undo document change' })

    expect(vector).toHaveAttribute('x1', '320')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(Number(vector.getAttribute('x2'))).toBeGreaterThan(480)
    expect(Number(vector.getAttribute('x2'))).toBeLessThan(500)
    expect(container.querySelector('.vector-arrowhead'))
      .toHaveAttribute('points', expect.stringMatching(/^500,/))
    expect(screen.getByText('125%')).toBeInTheDocument()
    expect(undo).toBeDisabled()

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 320, clientY: 240 })
    expect(canvas).toHaveFocus()
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    expect(vector).toHaveAttribute('x1', '360')
    fireEvent.keyDown(canvas, { key: 'Home' })
    expect(vector).toHaveAttribute('x1', '320')
    expect(screen.getByText('100%', { selector: 'output' })).toBeInTheDocument()

    openSettings()
    const grid = screen.getByRole('switch', { name: 'Grid' })
    expect(grid).toBeChecked()
    expect(container.querySelectorAll('.grid-line').length).toBeGreaterThan(0)
    fireEvent.click(grid)
    expect(container.querySelectorAll('.grid-line')).toHaveLength(0)
    expect(undo).toBeDisabled()
  })

  it('recenters at the current scale from the button and 0, and resets to 100% from Home', () => {
    render(<App />)
    const canvas = viewportCanvas()
    const vector = screen.getByLabelText('Vector 1')
    const zoom = screen.getByRole('textbox', { name: 'Zoom level' })
    const undo = screen.getByRole('button', { name: 'Undo document change' })

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    expect(vector).toHaveAttribute('x1', '360')
    fireEvent.click(screen.getByRole('button', { name: 'Recenter view' }))
    expect(vector).toHaveAttribute('x1', '320')
    expect(zoom).toHaveValue('125%')
    expect(screen.getByText('View recentered on the origin.')).toBeInTheDocument()

    fireEvent.keyDown(canvas, { key: 'ArrowUp' })
    expect(vector).not.toHaveAttribute('y1', '240')
    fireEvent.keyDown(canvas, { key: '0' })
    expect(vector).toHaveAttribute('y1', '240')
    expect(zoom).toHaveValue('125%')

    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    fireEvent.keyDown(canvas, { key: 'Home' })
    expect(vector).toHaveAttribute('x1', '320')
    expect(zoom).toHaveValue('100%')
    expect(screen.getByText('View reset to the origin at 100%.')).toBeInTheDocument()
    expect(undo).toBeDisabled()
  })

  it('sets the zoom level from a typed percentage without creating mathematical history', () => {
    render(<App />)
    const vector = screen.getByLabelText('Vector 1')
    const zoom = screen.getByRole('textbox', { name: 'Zoom level' })
    const undo = screen.getByRole('button', { name: 'Undo document change' })
    expect(zoom).toHaveValue('100%')

    fireEvent.change(zoom, { target: { value: '200' } })
    fireEvent.keyDown(zoom, { key: 'Enter' })
    expect(zoom).toHaveValue('200%')
    expect(screen.getByText('200%', { selector: 'output' })).toBeInTheDocument()
    expect(vector).toHaveAttribute('x1', '320')
    expect(Number(vector.getAttribute('x2'))).toBeGreaterThan(560)
    expect(undo).toBeDisabled()

    fireEvent.change(zoom, { target: { value: '1E9%' } })
    fireEvent.keyDown(zoom, { key: 'Enter' })
    expect(zoom).toHaveValue('1.39E6%')

    fireEvent.change(zoom, { target: { value: '1e-9' } })
    fireEvent.keyDown(zoom, { key: 'Enter' })
    expect(zoom).toHaveValue('1.39E-3%')
  })

  it('returns to 100% on text that is not a positive percentage and restores the read-out on Escape or blur', () => {
    render(<App />)
    const zoom = screen.getByRole('textbox', { name: 'Zoom level' })

    for (const invalid of ['abc', '-5', '']) {
      fireEvent.change(zoom, { target: { value: '200' } })
      fireEvent.keyDown(zoom, { key: 'Enter' })
      expect(zoom).toHaveValue('200%')
      fireEvent.change(zoom, { target: { value: invalid } })
      fireEvent.keyDown(zoom, { key: 'Enter' })
      expect(zoom).toHaveValue('100%')
      expect(screen.getByText('100%', { selector: 'output' })).toBeInTheDocument()
    }

    fireEvent.change(zoom, { target: { value: '300' } })
    fireEvent.keyDown(zoom, { key: 'Escape' })
    expect(zoom).toHaveValue('100%')

    fireEvent.change(zoom, { target: { value: '300' } })
    fireEvent.blur(zoom)
    expect(zoom).toHaveValue('100%')
  })

  it('keeps the zoom level read-only while the viewport is locked', () => {
    render(<App />)
    const zoom = screen.getByRole('textbox', { name: 'Zoom level' })

    fireEvent.click(screen.getByRole('button', { name: 'Lock viewport' }))
    expect(zoom).toHaveAttribute('readonly')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock viewport' }))
    expect(zoom).not.toHaveAttribute('readonly')
  })

  it('locks mouse and keyboard navigation, then restores it after unlocking', () => {
    render(<App />)
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const vector = screen.getByLabelText('Vector 1')
    const lock = screen.getByRole('button', { name: 'Lock viewport' })

    fireEvent.click(lock)
    expect(screen.getByRole('button', { name: 'Unlock viewport' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Viewport locked.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Recenter view' })).toBeDisabled()

    fireEvent.wheel(canvas, { deltaY: -200, clientX: 320, clientY: 240 })
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 4, clientX: 320, clientY: 240 })
    fireEvent.pointerMove(canvas, { pointerId: 4, clientX: 400, clientY: 240 })
    fireEvent.pointerUp(canvas, { pointerId: 4 })
    expect(vector).toHaveAttribute('x1', '320')
    expect(screen.getByText('100%', { selector: 'output' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unlock viewport' }))
    expect(screen.getByText('Viewport unlocked.')).toBeInTheDocument()
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' })
    expect(vector).toHaveAttribute('x1', '360')
  })

  it('keeps direct object manipulation available while the viewport is locked', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    fireEvent.click(screen.getByRole('button', { name: 'Lock viewport' }))

    const head = screen.getByRole('button', { name: 'Move head of V' })
    fireEvent.pointerDown(head, { button: 0, pointerId: 12 })
    fireEvent.pointerMove(canvas, { pointerId: 12, clientX: 536, clientY: 96 })
    fireEvent.pointerUp(canvas, { pointerId: 12 })

    expect(source).toHaveValue('V = vector(3, 2)')
  })

  it('restores the viewport lock locally without adding it to document history', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Lock viewport' }))
    expect(screen.getByRole('button', { name: 'Undo document change' })).toBeDisabled()
    expect(window.localStorage.getItem('multivector.viewportLocked')).toBe('true')
    first.unmount()

    render(<App />)
    expect(screen.getByRole('button', { name: 'Unlock viewport' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('creates a collision-free vector from empty viewport coordinates as one history entry', () => {
    render(<App />)
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'A = vector(2, 1)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.doubleClick(canvas, { clientX: 410, clientY: 150 })

    const created = screen.getByRole('textbox', { name: 'Expression 2' })
    expect(created).toHaveValue('B = vector(1, 1)')
    expect(created).toHaveFocus()
    expect(screen.getByText('B created at 1, 1.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.queryByRole('textbox', { name: 'Expression 2' }))
      .not.toBeInTheDocument()
    expect(canvas).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Expression 2' }))
      .toHaveValue('B = vector(1, 1)')
  })

  it('does not create or select when an existing rendered object is double-clicked', () => {
    render(<App />)
    const vector = screen.getByLabelText('Vector 1')

    fireEvent.doubleClick(vector, { clientX: 400, clientY: 200 })

    expect(screen.queryByRole('textbox', { name: 'Expression 2' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo document change' }))
      .toBeDisabled()
    expect(vector).not.toHaveAttribute('role', 'button')
    expect(vector).not.toHaveAttribute('aria-selected')
  })

  it('moves a direct vector head as one undoable source edit', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const head = screen.getByRole('button', { name: 'Move head of V' })

    fireEvent.pointerDown(head, { button: 0, pointerId: 7 })
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 536, clientY: 96 })
    fireEvent.pointerUp(canvas, { pointerId: 7 })

    expect(source).toHaveValue('V = vector(3, 2)')
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(source).toHaveValue('V = vector(2, 1)')
  })

  // Cancelling pointerdown would force a scripted focus, which browsers paint
  // with a focus ring; selection is prevented by the canvas stylesheet instead.
  it('keeps the native pointerdown action on a pressed handle', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    sizeViewportCanvas(viewportCanvas())

    for (const name of ['Move head of V', 'Move base of V']) {
      const handle = screen.getByRole('button', { name })
      expect(fireEvent.pointerDown(handle, { button: 0, pointerId: 9 })).toBe(true)
      expect(document.body).toHaveClass('canvas-gesture', 'canvas-gesture-manipulate')
      fireEvent.pointerUp(viewportCanvas(), { pointerId: 9 })
      expect(document.body).not.toHaveClass('canvas-gesture', 'canvas-gesture-manipulate')
    }
  })

  it('disables document selection while a pan is held', () => {
    render(<App />)
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 3, clientX: 320, clientY: 240 })
    expect(document.body).toHaveClass('canvas-gesture', 'canvas-gesture-pan')
    fireEvent.pointerCancel(canvas, { pointerId: 3 })
    expect(document.body).not.toHaveClass('canvas-gesture', 'canvas-gesture-pan')
  })

  it('cancels a selection starting in the panel only while a gesture is held', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const selectStart = () => {
      const event = new Event('selectstart', { bubbles: true, cancelable: true })
      source.dispatchEvent(event)
      return event.defaultPrevented
    }

    expect(selectStart()).toBe(false)
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 3, clientX: 320, clientY: 240 })
    expect(selectStart()).toBe(true)
    fireEvent.pointerUp(canvas, { pointerId: 3 })
    expect(selectStart()).toBe(false)
  })

  it('renders the vector arrowhead with Studio screen-space geometry', () => {
    const { container } = render(<App />)
    const vector = screen.getByLabelText('Vector 1')
    const arrowhead = container.querySelector('.vector-arrowhead')

    expect(vector).not.toHaveAttribute('marker-end')
    expect(arrowhead).toHaveAttribute('points', expect.stringMatching(/^464,168 /))
    expect(arrowhead?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(3)
  })

  it('shows a head dot only for a draggable vector head', () => {
    const { container } = render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    expect(container.querySelector('.vector-head-point')).toBeInTheDocument()
    // Anonymous literals are as editable as declarations (EDIT-003).
    fireEvent.change(source, { target: { value: 'vector(2, 1)' } })
    expect(screen.getByRole('button', { name: 'Move head of Vector 1' })).toBeInTheDocument()

    fireEvent.change(source, { target: { value: 'V = vector(1 + 1, 1)' } })
    expect(container.querySelector('.vector-head-point')).not.toBeInTheDocument()
  })

  it('cancels vector manipulation through Escape without adding history', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const head = screen.getByRole('button', { name: 'Move head of V' })

    fireEvent.pointerDown(head, { button: 0, pointerId: 9 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 536, clientY: 96 })
    expect(source).toHaveValue('V = vector(3, 2)')
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(source).toHaveValue('V = vector(2, 1)')
    expect(screen.getByText('Object manipulation cancelled.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(source).toHaveValue('vector(2, 1)')
  })

  it('moves a vector head through an eligible direct scalar reference', () => {
    render(<App />)
    const scalar = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(scalar, { target: { value: 's = 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const vector = screen.getByRole('textbox', { name: 'Expression 2' })
    fireEvent.change(vector, { target: { value: 'V1 = vector(s, 1)' } })
    const head = screen.getByRole('button', { name: 'Move head of V1' })

    fireEvent.keyDown(head, { key: 'ArrowRight' })

    expect(scalar).toHaveValue('s = 2.1')
    expect(vector).toHaveValue('V1 = vector(s, 1)')
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(scalar).toHaveValue('s = 2')
  })

  it('moves vector and bivector bases without changing their values', () => {
    render(<App />)
    const vectorSource = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(vectorSource, { target: { value: 'V = vector(2, 1)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    const vectorBase = screen.getByRole('button', { name: 'Move base of V' })
    fireEvent.pointerDown(vectorBase, { button: 0, pointerId: 8 })
    fireEvent.pointerMove(canvas, { pointerId: 8, clientX: 392, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 8 })
    expect(vectorSource).toHaveValue('V = vector(2, 1)')
    expect(screen.getByRole('textbox', { name: 'Position 1' }))
      .toHaveValue('(1, 1)')

    fireEvent.change(vectorSource, { target: { value: 'B = 2e12' } })
    const bivectorBase = screen.getByRole('button', { name: 'Move base of B' })
    fireEvent.keyDown(bivectorBase, { key: 'ArrowRight' })
    expect(screen.getByRole('textbox', { name: 'Position 1' }))
      .toHaveValue('(1.1, 1)')
    expect(vectorSource).toHaveValue('B = 2e12')
  })

  it('scales arrow-key manipulation steps with the viewport zoom', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'V = vector(2, 1)' } })
    const zoom = screen.getByRole('textbox', { name: 'Zoom level' })
    const head = () => screen.getByRole('button', { name: 'Move head of V' })

    fireEvent.keyDown(head(), { key: 'ArrowRight' })
    expect(source).toHaveValue('V = vector(2.1, 1)')
    fireEvent.keyDown(head(), { key: 'ArrowUp', shiftKey: true })
    expect(source).toHaveValue('V = vector(2.1, 2)')

    fireEvent.change(zoom, { target: { value: '1000' } })
    fireEvent.keyDown(zoom, { key: 'Enter' })
    fireEvent.keyDown(head(), { key: 'ArrowLeft' })
    expect(source).toHaveValue('V = vector(2.09, 2)')

    // Zoomed out to 7.2 px per unit, the screen resolves one decimal: the
    // moved head is written at that precision, as creation and drags are.
    fireEvent.change(zoom, { target: { value: '10' } })
    fireEvent.keyDown(zoom, { key: 'Enter' })
    fireEvent.keyDown(head(), { key: 'ArrowDown' })
    expect(source).toHaveValue('V = vector(2.1, 1)')
    fireEvent.keyDown(head(), { key: 'ArrowRight', shiftKey: true })
    expect(source).toHaveValue('V = vector(12.1, 1)')
    expect(screen.getByText('Vector head moved to 12.1, 1.')).toBeInTheDocument()
  })

  it('snaps a vector base to a named vector head and unlinks it by dragging away', () => {
    const { container } = render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'W = vector(1, 0)' },
    })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const base = screen.getByRole('button', { name: 'Move base of W' })

    fireEvent.pointerDown(base, { button: 0, pointerId: 21 })
    fireEvent.pointerMove(canvas, { pointerId: 21, clientX: 464, clientY: 168 })
    expect(container.querySelector('.anchor-preview')).toBeInTheDocument()
    fireEvent.pointerUp(canvas, { pointerId: 21 })

    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('V.head')
    expect(screen.getByText('Object base linked to V head.')).toBeInTheDocument()
    expect(screen.getByLabelText('W')).toHaveAttribute('x1', '464')
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('V.head')

    fireEvent.pointerDown(base, { button: 0, pointerId: 22 })
    fireEvent.pointerMove(canvas, { pointerId: 22, clientX: 392, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 22 })

    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('(1, 1)')
    expect(container.querySelector('.anchor-preview')).not.toBeInTheDocument()
  })

  it('separates coinciding bases instead of linking them back (#100)', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'W = vector(1, 0)' },
    })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const base = screen.getByRole('button', { name: 'Move base of W' })

    // Both bases are at the origin; a short drag away keeps W separate.
    fireEvent.pointerDown(base, { button: 0, pointerId: 41, clientX: 320, clientY: 240 })
    fireEvent.pointerMove(canvas, { pointerId: 41, clientX: 330, clientY: 240 })
    fireEvent.pointerUp(canvas, { pointerId: 41 })
    expect(screen.getByRole('textbox', { name: 'Position 2' })).not.toHaveValue('V.position')
    expect(screen.getByText('Object manipulation committed.')).toBeInTheDocument()

    // Leaving the anchor and coming back to it is a deliberate link.
    fireEvent.pointerDown(base, { button: 0, pointerId: 42, clientX: 330, clientY: 240 })
    fireEvent.pointerMove(canvas, { pointerId: 42, clientX: 400, clientY: 240 })
    fireEvent.pointerMove(canvas, { pointerId: 42, clientX: 322, clientY: 240 })
    fireEvent.pointerUp(canvas, { pointerId: 42 })
    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('V.position')
  })

  it('unlinks a linked base with a short drag instead of keeping the link (#100)', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'W = vector(1, 0)' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 2' }), {
      target: { value: 'V.head' },
    })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move base of W' }), {
      button: 0, pointerId: 43, clientX: 464, clientY: 168,
    })
    fireEvent.pointerMove(canvas, { pointerId: 43, clientX: 464, clientY: 180 })
    fireEvent.pointerUp(canvas, { pointerId: 43 })
    expect(screen.getByRole('textbox', { name: 'Position 2' })).not.toHaveValue('V.head')
  })

  it('raises the handles of the focused, hovered or last manipulated object (#100)', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V1 = vector(1, 0)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'V2 = vector(0, 1)' },
    })
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    const base = (name: string) => screen.getByRole('button', { name: `Move base of ${name}` })
    // A later element is drawn above an earlier one and takes the press.
    const onTop = (upper: string, lower: string) =>
      (base(lower).compareDocumentPosition(base(upper)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(onTop('V2', 'V1')).toBe(true)

    const source1 = screen.getByRole('textbox', { name: 'Expression 1' })
    act(() => source1.focus())
    expect(onTop('V1', 'V2')).toBe(true)
    act(() => source1.blur())
    expect(onTop('V2', 'V1')).toBe(true)

    const row1 = source1.closest('article') as HTMLElement
    fireEvent.pointerEnter(row1)
    expect(onTop('V1', 'V2')).toBe(true)
    fireEvent.pointerLeave(row1)
    expect(onTop('V2', 'V1')).toBe(true)

    // The order holds during a drag and follows the dragged object after it.
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    fireEvent.pointerDown(base('V1'), { button: 0, pointerId: 44, clientX: 320, clientY: 240 })
    expect(onTop('V2', 'V1')).toBe(true)
    fireEvent.pointerMove(canvas, { pointerId: 44, clientX: 330, clientY: 240 })
    fireEvent.pointerUp(canvas, { pointerId: 44 })
    expect(onTop('V1', 'V2')).toBe(true)
  })

  it('keeps a click on a linked base from unlinking it (#100)', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'W = vector(1, 0)' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 2' }), {
      target: { value: 'V.head' },
    })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const base = screen.getByRole('button', { name: 'Move base of W' })
    const position = () => screen.getByRole('textbox', { name: 'Position 2' })

    // Moving less than 3 px is a click: nothing is written, so the last
    // history entry is still the link.
    fireEvent.pointerDown(base, { button: 0, pointerId: 45, clientX: 464, clientY: 168 })
    fireEvent.pointerMove(canvas, { pointerId: 45, clientX: 466, clientY: 170 })
    fireEvent.pointerUp(canvas, { pointerId: 45 })
    expect(position()).toHaveValue('V.head')
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(position()).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
    expect(position()).toHaveValue('V.head')

    // From 3 px on, the drag starts and unlinks the base.
    fireEvent.pointerDown(base, { button: 0, pointerId: 46, clientX: 464, clientY: 168 })
    fireEvent.pointerMove(canvas, { pointerId: 46, clientX: 467, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 46 })
    expect(position()).not.toHaveValue('V.head')
  })

  it('keeps the draw order while a handle has focus (#100)', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V1 = vector(1, 0)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'V2 = vector(0, 1)' },
    })
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    const base = (name: string) => screen.getByRole('button', { name: `Move base of ${name}` })
    const onTop = (upper: string, lower: string) =>
      (base(lower).compareDocumentPosition(base(upper)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const row1 = screen.getByRole('textbox', { name: 'Expression 1' }).closest('article') as HTMLElement

    // Hovering the row of the focused handle's object does not move it.
    const handle = base('V1')
    act(() => (handle as unknown as HTMLElement).focus())
    expect(onTop('V2', 'V1')).toBe(true)
    fireEvent.pointerEnter(row1)
    expect(onTop('V2', 'V1')).toBe(true)
    expect(document.activeElement).toBe(handle)

    // Tab between handles keeps the order; leaving the canvas releases it.
    act(() => (base('V2') as unknown as HTMLElement).focus())
    expect(onTop('V2', 'V1')).toBe(true)
    act(() => (base('V2') as unknown as HTMLElement).blur())
    expect(onTop('V1', 'V2')).toBe(true)
  })

  it('forgets the hovered row of a deleted object (#100)', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V1 = vector(1, 0)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'V2 = vector(0, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 3' }), {
      target: { value: 'V3 = vector(-1, 0)' },
    })
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    const base = (name: string) => screen.getByRole('button', { name: `Move base of ${name}` })
    const onTop = (upper: string, lower: string) =>
      (base(lower).compareDocumentPosition(base(upper)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    fireEvent.pointerDown(base('V1'), { button: 0, pointerId: 47, clientX: 320, clientY: 240 })
    fireEvent.pointerUp(canvas, { pointerId: 47 })
    expect(onTop('V1', 'V3')).toBe(true)

    // The deleted row fires no pointer leave. Deleting focuses the previous
    // row, so focus is moved away to observe the hovered row alone.
    const row2 = screen.getByRole('textbox', { name: 'Expression 2' }).closest('article') as HTMLElement
    fireEvent.pointerEnter(row2)
    expect(onTop('V2', 'V1')).toBe(true)
    fireEvent.click(within(row2).getByRole('button', { name: 'Delete expression 2' }))
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(screen.queryByRole('button', { name: 'Move base of V2' })).not.toBeInTheDocument()
    expect(onTop('V1', 'V3')).toBe(true)

    // Restoring the object does not select it again.
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    act(() => (document.activeElement as HTMLElement | null)?.blur())
    expect(onTop('V1', 'V2')).toBe(true)
  })

  it('snaps a vector base to a named bivector position', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'B = e12' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 1' }), {
      target: { value: '(1, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'V = vector(1, 0)' },
    })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move base of V' }), {
      button: 0, pointerId: 23,
    })
    fireEvent.pointerMove(canvas, { pointerId: 23, clientX: 392, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 23 })

    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('B.position')
    expect(screen.getByText('Object base linked to B position.')).toBeInTheDocument()
  })

  it('moves a bivector base without snapping to vectors that inherit its position', () => {
    const { container } = render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V1 = vector(0.66, 3.042)' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 1' }), {
      target: { value: 'V2.position' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'V2 = vector(1, 0)' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 2' }), {
      target: { value: 'B.position' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 3' }), {
      target: { value: 'B = V1 ^ V2' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 3' }), {
      target: { value: '(0, 0)' },
    })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move base of B' }), {
      button: 0, pointerId: 24,
    })
    fireEvent.pointerMove(canvas, { pointerId: 24, clientX: 392, clientY: 168 })
    expect(container.querySelector('.anchor-preview')).not.toBeInTheDocument()
    fireEvent.pointerUp(canvas, { pointerId: 24 })

    expect(screen.getByRole('textbox', { name: 'Position 3' })).toHaveValue('(1, 1)')
    expect(screen.getByText('Object manipulation committed.')).toBeInTheDocument()
  })

  it('cycles anchor targets and unlinks from a vector base with the keyboard', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'W = vector(1, 0)' },
    })
    const base = screen.getByRole('button', { name: 'Move base of W' })
    expect(base).toHaveAttribute('aria-keyshortcuts', 'Enter Delete')

    fireEvent.keyDown(base, { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('V.position')
    fireEvent.keyDown(base, { key: 'Enter' })
    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('V.head')
    fireEvent.keyDown(base, { key: 'Delete' })
    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('(2, 1)')
    expect(screen.getByText('Object base unlinked and kept at its resolved position.'))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('V.head')
  })

  it('refuses a keyboard anchor that would create a position cycle', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'A = vector(1, 0)' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 1' }), {
      target: { value: 'B.head' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'B = vector(0, 1)' },
    })

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move base of B' }), {
      key: 'Enter',
    })

    expect(screen.getByRole('textbox', { name: 'Position 2' })).toHaveValue('')
    expect(screen.getByText('No valid anchor target is available.')).toBeInTheDocument()
  })

  it('keeps a vector base draggable through an overlapping bivector area', () => {
    const { container } = render(<App />)
    const vectorSource = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(vectorSource, { target: { value: 'V = vector(2, 1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'B = 4e12' },
    })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const bivector = container.querySelector('.bivector')

    expect(bivector).toHaveAttribute('pointer-events', 'none')
    const vectorBase = screen.getByRole('button', { name: 'Move base of V' })
    fireEvent.pointerDown(vectorBase, { button: 0, pointerId: 18 })
    fireEvent.pointerMove(canvas, { pointerId: 18, clientX: 392, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 18 })

    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('(1, 1)')
    expect(vectorSource).toHaveValue('V = vector(2, 1)')
    expect(screen.getByRole('button', { name: 'Move base of B' })).toBeInTheDocument()
  })

  it('keeps locked bases as solid points and gives list copies no handles', () => {
    const { container } = render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    const position = screen.getByRole('textbox', { name: 'Position 1' })
    fireEvent.change(source, { target: { value: 'V = vector(1 + 1, 2)' } })
    fireEvent.change(position, { target: { value: '(1 / 2, 0)' } })

    expect(screen.queryByRole('button', { name: 'Move head of V' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move base of V' }))
      .not.toBeInTheDocument()
    expect(container.querySelector('.manipulation-base-point')).toBeInTheDocument()
    expect(container.querySelector('.manipulation-base-contour.is-movable'))
      .not.toBeInTheDocument()

    fireEvent.change(source, {
      target: { value: 'L = [vector(1, 0), vector(0, 1)]' },
    })
    expect(container.querySelector('.manipulation-base-point')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Move (?:head|base)/ }))
      .not.toBeInTheDocument()
  })

  it('controls axes, graduations, and object scale independently', () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('.axis')).toHaveLength(2)
    expect(container.querySelectorAll('.graduation').length).toBeGreaterThan(0)
    openSettings()
    expect(screen.getByText('1.00×')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Axes and labels' }))
    expect(container.querySelectorAll('.axis')).toHaveLength(0)
    expect(container.querySelectorAll('.graduation').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('switch', { name: 'Graduations' }))
    expect(container.querySelectorAll('.graduation')).toHaveLength(0)

    fireEvent.change(screen.getByRole('slider', { name: 'Object scale' }), {
      target: { value: '1.5' },
    })
    expect(screen.getByLabelText('Vector 1')).toHaveAttribute('stroke-width', '9')
    expect(screen.getByText('1.50×')).toBeInTheDocument()
  })

  it('places the appearance menu from its measured height and follows its row', () => {
    vi.stubGlobal('innerHeight', 600)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('appearance-popover') ? 480 : 0
    })
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'V = e1' } })
    const trigger = screen.getByRole('button', { name: /^Open .* menu for V$/ })
    let rowTop = 560
    trigger.getBoundingClientRect = () =>
      ({ top: rowTop, bottom: rowTop + 24, left: 40, right: 64, width: 24, height: 24, x: 40, y: rowTop }) as DOMRect

    // From the last row of a short window, the measured 480 px menu opens above it.
    fireEvent.click(trigger)
    const menu = screen.getByRole('dialog', { name: 'Vector' })
    expect(menu.style.top).toBe(`${560 - 6 - 480}px`)

    // Scrolling the expression list moves the row: the menu follows it below.
    rowTop = 40
    fireEvent.scroll(document.querySelector('.expression-panel') ?? document)
    expect(menu.style.top).toBe(`${40 + 24 + 6}px`)

    // A resize re-places it as well.
    rowTop = 500
    fireEvent(window, new Event('resize'))
    expect(menu.style.top).toBe(`${500 - 6 - 480}px`)
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('configures a direct scalar slider that rewrites source and supports undo', () => {
    render(<App />)
    const source = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Expression 1',
    })
    source.focus()
    fireEvent.change(source, { target: { value: 'a = ((2))' } })
    expect(screen.getByRole('slider', { name: 'Value for a' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Minimum source' }))
      .toHaveValue('-10')
    fireEvent.blur(source)
    expect(screen.getByRole('textbox', { name: 'Minimum source' }))
      .toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Maximum source' }))
      .toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Step source' }))
      .toBeVisible()
    const interval = screen.getByRole('group', { name: 'Interval of a' })
    expect(interval).toHaveTextContent(/^≤ a ≤step$/)
    expect(within(interval).getAllByRole('textbox').map((field) => field.getAttribute('aria-label')))
      .toEqual(['Minimum source', 'Maximum source', 'Step source'])
    const trigger = screen.getByRole('button', {
      name: 'Open Scalar menu for a',
    })
    // Play sits at the start of the slider row, left of the bar.
    const play = screen.getByRole('button', { name: 'Play scalar animation' })
    expect(play).toHaveClass('scalar-play-button')
    expect(play.closest('.scalar-slider-row')).toBe(screen.getByRole('slider', { name: 'Value for a' }).closest('.scalar-slider-row'))
    expect(play.compareDocumentPosition(screen.getByRole('slider', { name: 'Value for a' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(trigger.parentElement as HTMLElement).queryByRole('button', { name: 'Play scalar animation' })).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Scalar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close Scalar menu' })).toHaveFocus()
    // A new scalar is an animated slider.
    expect(screen.getByRole('switch', { name: 'Animate' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Minimum source' }))
      .toHaveValue('-10')
    const slider = screen.getByRole('slider', { name: 'Value for a' })
    expect(slider).toBeEnabled()

    fireEvent.pointerDown(slider, { pointerId: 1 })
    fireEvent.change(slider, { target: { value: '3' } })
    fireEvent.change(slider, { target: { value: '3.5' } })
    fireEvent.pointerUp(slider, { pointerId: 1 })
    expect(source).toHaveValue('a = ((3.5))')

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(source).toHaveValue('a = ((2))')

    // Pressing the row's slider closes the menu, as any press outside it does.
    expect(screen.queryByRole('dialog', { name: 'Scalar' })).not.toBeInTheDocument()
    fireEvent.click(trigger)

    // Turning Animate off makes it a number field.
    fireEvent.click(screen.getByRole('switch', { name: 'Animate' }))
    expect(screen.getByRole('switch', { name: 'Animate' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Once' })).not.toBeInTheDocument()
    expect(trigger.parentElement?.querySelector('.expression-action-spacer'))
      .toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: 'Value for a' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play scalar animation' }))
      .not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Minimum source' }))
      .not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Scalar' }))
      .not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('reorders expression rows with Shift+Arrow keys on the drag handle, with undo/redo', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'A = 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'B = 2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 3' }), {
      target: { value: 'C = 3' },
    })

    const sourceValues = () => screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .map((element) => (element as HTMLInputElement).value)
    const handleFor = (value: string) => {
      const input = screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
        .find((element) => (element as HTMLInputElement).value === value) as HTMLInputElement
      return within(input.closest('.expression-item') as HTMLElement)
        .getByRole('button', { name: /^Reorder / })
    }
    expect(sourceValues()).toEqual(['A = 1', 'B = 2', 'C = 3'])

    fireEvent.keyDown(handleFor('A = 1'), { key: 'ArrowDown' })
    expect(sourceValues()).toEqual(['A = 1', 'B = 2', 'C = 3']) // no shift: no-op

    fireEvent.keyDown(handleFor('A = 1'), { key: 'ArrowDown', shiftKey: true })
    expect(sourceValues()).toEqual(['B = 2', 'A = 1', 'C = 3'])
    expect(screen.getByText('Moved A to position 2 of 3.')).toBeInTheDocument()

    fireEvent.keyDown(handleFor('C = 3'), { key: 'ArrowUp', shiftKey: true })
    expect(sourceValues()).toEqual(['B = 2', 'C = 3', 'A = 1'])

    fireEvent.keyDown(handleFor('B = 2'), { key: 'End', shiftKey: true })
    expect(sourceValues()).toEqual(['C = 3', 'A = 1', 'B = 2'])

    fireEvent.keyDown(handleFor('B = 2'), { key: 'Home', shiftKey: true })
    expect(sourceValues()).toEqual(['B = 2', 'C = 3', 'A = 1'])

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(sourceValues()).toEqual(['C = 3', 'A = 1', 'B = 2'])
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(sourceValues()).toEqual(['A = 1', 'B = 2', 'C = 3'])

    fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
    expect(sourceValues()).toEqual(['B = 2', 'A = 1', 'C = 3'])

    fireEvent.keyDown(handleFor('C = 3'), { key: 'ArrowUp', altKey: true })
    expect(sourceValues()).toEqual(['B = 2', 'C = 3', 'A = 1'])
  })

  it('moves the row of a focused expression with Alt+Arrow and keeps its caret', () => {
    render(<App />)
    for (const [index, value] of ['A = 1', 'B = 2', 'C = 3'].entries()) {
      if (index > 0) fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
      fireEvent.change(screen.getByRole('textbox', { name: `Expression ${index + 1}` }), {
        target: { value },
      })
    }
    const sourceValues = () => screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .map((element) => (element as HTMLInputElement).value)
    const editorOf = (value: string) => screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .find((element) => (element as HTMLInputElement).value === value) as HTMLInputElement

    const editor = editorOf('A = 1')
    editor.focus()
    editor.setSelectionRange(2, 2)
    fireEvent.keyDown(editor, { key: 'ArrowDown', altKey: true })
    expect(sourceValues()).toEqual(['B = 2', 'A = 1', 'C = 3'])
    expect(editorOf('A = 1')).toHaveFocus()
    expect(editorOf('A = 1').selectionStart).toBe(2)
    expect(screen.getByText('Moved A to position 2 of 3.')).toBeInTheDocument()

    fireEvent.keyDown(editorOf('A = 1'), { key: 'ArrowDown', altKey: true })
    fireEvent.keyDown(editorOf('A = 1'), { key: 'ArrowDown', altKey: true }) // at the end: no-op
    expect(sourceValues()).toEqual(['B = 2', 'C = 3', 'A = 1'])
    fireEvent.keyDown(editorOf('A = 1'), { key: 'ArrowUp', altKey: true })
    expect(sourceValues()).toEqual(['B = 2', 'A = 1', 'C = 3'])
    expect(editorOf('A = 1')).toHaveFocus()

    // Plain arrows still move focus between fields.
    fireEvent.keyDown(editorOf('A = 1'), { key: 'ArrowUp' })
    expect(editorOf('B = 2')).toHaveFocus()
    expect(sourceValues()).toEqual(['B = 2', 'A = 1', 'C = 3'])
  })

  it('moves a row via pointer drag onto another row, and cancels on pointercancel', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'A = 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'B = 2' },
    })

    const sourceValues = () => screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .map((element) => (element as HTMLInputElement).value)
    const handle = within(
      screen.getByRole('textbox', { name: 'Expression 1' })
        .closest('.expression-item') as HTMLElement,
    ).getByRole('button', { name: /^Reorder / })
    const rows = screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .map((element) => element.closest('.expression-item') as HTMLElement)
    rows[0].getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40 }) as DOMRect
    rows[1].getBoundingClientRect = () => ({ top: 40, bottom: 80, height: 40 }) as DOMRect

    fireEvent.pointerDown(handle, { pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 70 })
    fireEvent.pointerCancel(window, { pointerId: 1 })
    expect(sourceValues()).toEqual(['A = 1', 'B = 2'])

    fireEvent.pointerDown(handle, { pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 70 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(sourceValues()).toEqual(['B = 2', 'A = 1'])
  })

  it('drops a dragged row exactly where the indicator was shown', () => {
    render(<App />)
    for (const [index, value] of ['A = 1', 'B = 2', 'C = 3', 'D = 4'].entries()) {
      if (index > 0) fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
      fireEvent.change(screen.getByRole('textbox', { name: `Expression ${index + 1}` }), {
        target: { value },
      })
    }
    const sourceValues = () => screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .map((element) => (element as HTMLInputElement).value)
    const layoutRows = () => screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .map((element) => element.closest('.expression-item') as HTMLElement)
      .forEach((row, index) => {
        row.getBoundingClientRect = () =>
          ({ top: index * 40, bottom: index * 40 + 40, height: 40 }) as DOMRect
      })
    const handleFor = (value: string) => within(
      (screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
        .find((element) => (element as HTMLInputElement).value === value) as HTMLElement)
        .closest('.expression-item') as HTMLElement,
    ).getByRole('button', { name: /^Reorder / })

    // Downward: the indicator sits above D (insertion index 3), so A lands before D.
    layoutRows()
    fireEvent.pointerDown(handleFor('A = 1'), { pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 125 })
    expect(screen.getAllByRole('textbox', { name: /^Expression \d+$/ })[3]
      .closest('.expression-item')).toHaveClass('drop-before')
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(sourceValues()).toEqual(['B = 2', 'C = 3', 'A = 1', 'D = 4'])

    // Upward: the indicator sits above B (insertion index 0), so D lands first.
    layoutRows()
    fireEvent.pointerDown(handleFor('D = 4'), { pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 5 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(sourceValues()).toEqual(['D = 4', 'B = 2', 'C = 3', 'A = 1'])

    // Dropping on its own slot is a no-op that adds no history entry, so the
    // redo stack survives it.
    const undo = screen.getByRole('button', { name: 'Undo document change' })
    const redo = screen.getByRole('button', { name: 'Redo document change' })
    fireEvent.click(undo)
    fireEvent.click(undo)
    expect(sourceValues()).toEqual(['A = 1', 'B = 2', 'C = 3', 'D = 4'])
    expect(redo).toBeEnabled()
    layoutRows()
    fireEvent.pointerDown(handleFor('B = 2'), { pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 85 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(sourceValues()).toEqual(['A = 1', 'B = 2', 'C = 3', 'D = 4'])
    expect(redo).toBeEnabled()
  })

  it('preserves unsupported or out-of-range scalar source without clamping', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'a = 20' } })
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Scalar menu for a',
    }))

    expect(screen.getByRole('slider', { name: 'Value for a' })).toBeDisabled()
    expect(screen.getByText('Value is outside the configured interval.'))
      .toBeInTheDocument()
    expect(source).toHaveValue('a = 20')

    fireEvent.change(screen.getByRole('textbox', { name: 'Minimum source' }), {
      target: { value: 'e1' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A control bound must evaluate to a pure scalar.',
    )
    expect(source).toHaveValue('a = 20')
  })

  it('keeps a stored control dormant while its scalar is computed', () => {
    render(<App />)
    const source = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'translation = 0' } })
    // Store a control: a custom minimum and a loop animation.
    fireEvent.change(screen.getByRole('textbox', { name: 'Minimum source' }), { target: { value: '-3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open Scalar menu for translation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    // A computed value shows no control at all.
    fireEvent.change(source, { target: { value: 'translation = 2*3 - 1' } })
    expect(screen.queryByRole('slider', { name: 'Value for translation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Interval of translation' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Minimum source' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play scalar animation' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Direct control requires/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Scalar menu for translation' }))
    expect(screen.getByRole('dialog', { name: 'Scalar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Slider' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Loop' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    // Back to a literal: the stored interval and animation return.
    fireEvent.change(source, { target: { value: 'translation = 0' } })
    expect(screen.getByRole('slider', { name: 'Value for translation' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Minimum source' })).toHaveValue('-3')
    fireEvent.click(screen.getByRole('button', { name: 'Open Scalar menu for translation' }))
    expect(screen.getByRole('button', { name: 'Loop' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('stops playback when the played scalar becomes computed', () => {
    vi.useFakeTimers()
    render(<App />)
    const source = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(source, { target: { value: 'a = 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Play scalar animation' }))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole('button', { name: 'Pause scalar animation' })).toBeInTheDocument()

    fireEvent.change(source, { target: { value: 'a = 2*3' } })
    act(() => vi.advanceTimersByTime(1000))
    expect(source).toHaveValue('a = 2*3')
    expect(screen.queryByRole('button', { name: /scalar animation$/ })).not.toBeInTheDocument()
  })

  it('plays scalar animation as one transaction and cancels through Escape', () => {
    vi.useFakeTimers()
    render(<App />)
    const source = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Expression 1',
    })
    fireEvent.change(source, { target: { value: 'a = 2' } })
    fireEvent.click(screen.getByRole('button', {
      name: 'Open Scalar menu for a',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }))
    expect(screen.getByRole('button', { name: 'Loop' }))
      .toHaveAttribute('aria-pressed', 'true')

    const play = screen.getByRole('button', { name: 'Play scalar animation' })
    fireEvent.click(play)
    act(() => vi.advanceTimersByTime(1000))
    expect(source).not.toHaveValue('a = 2')
    expect(screen.getByRole('button', { name: 'Pause scalar animation' }))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pause scalar animation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(source).toHaveValue('a = 2')

    fireEvent.click(screen.getByRole('button', { name: 'Play scalar animation' }))
    act(() => vi.advanceTimersByTime(500))
    expect(source).not.toHaveValue('a = 2')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(source).toHaveValue('a = 2')
    expect(screen.getByText('a animation cancelled.')).toBeInTheDocument()
  })

  it('plays multiple scalar animations and pauses or resumes each independently', () => {
    vi.useFakeTimers()
    render(<App />)
    const first = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'a = 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const second = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'b = 2' } })
    const firstRow = first.closest('.expression-item') as HTMLElement
    const secondRow = second.closest('.expression-item') as HTMLElement

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Play scalar animation' }))
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Play scalar animation' }))
    expect(within(firstRow).getByRole('button', { name: 'Pause scalar animation' }))
      .toBeInTheDocument()
    expect(within(secondRow).getByRole('button', { name: 'Pause scalar animation' }))
      .toBeInTheDocument()

    act(() => vi.advanceTimersByTime(500))
    expect(first).not.toHaveValue('a = 1')
    expect(second).not.toHaveValue('b = 2')

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Pause scalar animation' }))
    const pausedFirst = first.value
    const movingSecond = second.value
    act(() => vi.advanceTimersByTime(250))
    expect(first).toHaveValue(pausedFirst)
    expect(second).not.toHaveValue(movingSecond)
    expect(within(secondRow).getByRole('button', { name: 'Pause scalar animation' }))
      .toBeInTheDocument()

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Play scalar animation' }))
    act(() => vi.advanceTimersByTime(250))
    expect(first).not.toHaveValue(pausedFirst)

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Pause scalar animation' }))
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Pause scalar animation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(first).toHaveValue('a = 1')
    expect(second).toHaveValue('b = 2')
  })

  it('keeps other scalar animations running when one completes', () => {
    vi.useFakeTimers()
    render(<App />)
    const first = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'a = 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const second = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'b = 2' } })
    const firstRow = first.closest('.expression-item') as HTMLElement
    const secondRow = second.closest('.expression-item') as HTMLElement

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Open Scalar menu for a' }))
    fireEvent.click(screen.getByRole('button', { name: 'Once' }))
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Play scalar animation' }))
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Play scalar animation' }))
    act(() => vi.advanceTimersByTime(2100))

    expect(within(firstRow).getByRole('button', { name: 'Play scalar animation' }))
      .toBeInTheDocument()
    expect(within(secondRow).getByRole('button', { name: 'Pause scalar animation' }))
      .toBeInTheDocument()
    expect(screen.getByText('a animation completed.')).toBeInTheDocument()

    fireEvent.click(within(secondRow).getByRole('button', { name: 'Pause scalar animation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(first).toHaveValue('a = 1')
    expect(second).toHaveValue('b = 2')
  })

  it('cancels all concurrent scalar animations through Escape', () => {
    vi.useFakeTimers()
    render(<App />)
    const first = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'a = 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const second = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'b = 2' } })
    const firstRow = first.closest('.expression-item') as HTMLElement
    const secondRow = second.closest('.expression-item') as HTMLElement

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Play scalar animation' }))
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Play scalar animation' }))
    act(() => vi.advanceTimersByTime(500))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(first).toHaveValue('a = 1')
    expect(second).toHaveValue('b = 2')
    expect(within(firstRow).getByRole('button', { name: 'Play scalar animation' }))
      .toBeInTheDocument()
    expect(within(secondRow).getByRole('button', { name: 'Play scalar animation' }))
      .toBeInTheDocument()
    expect(screen.getByText('a and b animations cancelled.')).toBeInTheDocument()
  })

  it('keeps other scalar animations running when one animated row is removed', () => {
    vi.useFakeTimers()
    render(<App />)
    const first = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'a = 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const second = screen.getByRole<HTMLInputElement>('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'b = 2' } })
    const firstRow = first.closest('.expression-item') as HTMLElement
    const secondRow = second.closest('.expression-item') as HTMLElement

    fireEvent.click(within(firstRow).getByRole('button', { name: 'Play scalar animation' }))
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Play scalar animation' }))
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Delete expression 1' }))
    act(() => vi.advanceTimersByTime(250))

    expect(screen.queryByDisplayValue(/a =/)).not.toBeInTheDocument()
    expect(second).not.toHaveValue('b = 2')
    expect(within(secondRow).getByRole('button', { name: 'Pause scalar animation' }))
      .toBeInTheDocument()
  })

  it('refreshes dependent scalar animation bounds and stops on invalid bounds', () => {
    vi.useFakeTimers()
    render(<App />)

    const samplingSource = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Expression 1',
    })
    fireEvent.change(samplingSource, { target: { value: 'sampling = 30' } })
    const samplingRow = samplingSource.closest('.expression-item') as HTMLElement
    fireEvent.change(within(samplingRow).getByRole('textbox', {
      name: 'Minimum source',
    }), { target: { value: '1' } })
    fireEvent.change(within(samplingRow).getByRole('textbox', {
      name: 'Maximum source',
    }), { target: { value: '30' } })
    fireEvent.change(within(samplingRow).getByRole('textbox', {
      name: 'Step source',
    }), { target: { value: '1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const animatedSource = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Expression 2',
    })
    fireEvent.change(animatedSource, { target: { value: 'M = 1' } })
    const animatedRow = animatedSource.closest('.expression-item') as HTMLElement
    fireEvent.change(within(animatedRow).getByRole('textbox', {
      name: 'Minimum source',
    }), { target: { value: '0' } })
    fireEvent.change(within(animatedRow).getByRole('textbox', {
      name: 'Maximum source',
    }), { target: { value: 'sampling - 1' } })
    fireEvent.change(within(animatedRow).getByRole('textbox', {
      name: 'Step source',
    }), { target: { value: '1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const independentSource = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Expression 3',
    })
    fireEvent.change(independentSource, { target: { value: 'N = 2' } })
    const independentRow = independentSource.closest('.expression-item') as HTMLElement

    fireEvent.click(within(animatedRow).getByRole('button', {
      name: 'Open Scalar menu for M',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }))
    fireEvent.click(within(animatedRow).getByRole('button', {
      name: 'Play scalar animation',
    }))
    fireEvent.click(within(independentRow).getByRole('button', {
      name: 'Play scalar animation',
    }))
    act(() => vi.advanceTimersByTime(1000))
    expect(Number(animatedSource.value.split('=')[1])).toBeGreaterThan(12)

    fireEvent.change(within(samplingRow).getByRole('slider', {
      name: 'Value for sampling',
    }), { target: { value: '13' } })
    act(() => vi.advanceTimersByTime(20))
    expect(Number(animatedSource.value.split('=')[1])).toBeLessThanOrEqual(12)

    fireEvent.change(samplingSource, { target: { value: 'sampling = e1' } })
    act(() => vi.advanceTimersByTime(20))
    expect(screen.getByText(
      'M animation stopped because its interval became invalid.',
    )).toBeInTheDocument()
    expect(within(animatedRow).getByRole('button', {
      name: 'Play scalar animation',
    })).toBeDisabled()
    expect(within(independentRow).getByRole('button', {
      name: 'Pause scalar animation',
    })).toBeInTheDocument()
  })

  it('refreshes minimum, maximum, and step dependencies during playback', () => {
    vi.useFakeTimers()
    render(<App />)

    const sources = ['lower = 0', 'upper = 20', 'increment = 1', 'M = 5']
    const inputs: HTMLInputElement[] = []
    sources.forEach((source, index) => {
      if (index > 0) {
        fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
      }
      const input = screen.getByRole<HTMLInputElement>('textbox', {
        name: `Expression ${index + 1}`,
      })
      fireEvent.change(input, { target: { value: source } })
      inputs.push(input)
    })

    const animatedSource = inputs[3]
    const animatedRow = animatedSource.closest('.expression-item') as HTMLElement
    fireEvent.change(within(animatedRow).getByRole('textbox', {
      name: 'Minimum source',
    }), { target: { value: 'lower' } })
    fireEvent.change(within(animatedRow).getByRole('textbox', {
      name: 'Maximum source',
    }), { target: { value: 'upper' } })
    fireEvent.change(within(animatedRow).getByRole('textbox', {
      name: 'Step source',
    }), { target: { value: 'increment' } })
    fireEvent.click(within(animatedRow).getByRole('button', {
      name: 'Open Scalar menu for M',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Loop' }))
    fireEvent.click(within(animatedRow).getByRole('button', {
      name: 'Play scalar animation',
    }))
    act(() => vi.advanceTimersByTime(500))

    fireEvent.change(inputs[0], { target: { value: 'lower = 4' } })
    fireEvent.change(inputs[1], { target: { value: 'upper = 8' } })
    fireEvent.change(inputs[2], { target: { value: 'increment = 0.5' } })
    act(() => vi.advanceTimersByTime(20))

    const value = Number(animatedSource.value.split('=')[1])
    expect(value).toBeGreaterThanOrEqual(4)
    expect(value).toBeLessThanOrEqual(8)
    expect((value - 4) / 0.5).toBe(Math.round((value - 4) / 0.5))
    expect(within(animatedRow).getByRole('button', {
      name: 'Pause scalar animation',
    })).toBeInTheDocument()
  })

  it('opens display settings, restores focus on close, and records no history', () => {
    render(<App />)
    const undo = screen.getByRole('button', { name: 'Undo document change' })
    expect(screen.queryByRole('switch', { name: 'Grid' })).not.toBeInTheDocument()

    const trigger = openSettings()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('switch', { name: 'Grid' })).toHaveFocus()
    expect(screen.getByRole('spinbutton', { name: 'Decimal places' }))
      .toHaveValue(4)

    fireEvent.click(screen.getByRole('switch', { name: 'Grid' }))
    expect(undo).toBeDisabled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('switch', { name: 'Grid' })).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()

    openSettings()
    const outsideControl = screen.getByRole('button', { name: 'Add expression' })
    fireEvent.pointerDown(outsideControl)
    expect(screen.queryByRole('switch', { name: 'Grid' })).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('changes numeric presentation without changing source, value kind, or history', () => {
    render(<App />)
    openSettings()
    fireEvent.click(screen.getByRole('switch', { name: 'Show approximated residue' }))
    openSettings()
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, {
      target: { value: 'R = -1 + 0.0000000035897930298416118e12' },
    })
    expect(screen.getByText('Scalar')).toBeInTheDocument()
    expect(screen.getByText('-1 + 3.5898E-9e12')).toBeInTheDocument()

    const undo = screen.getByRole('button', { name: 'Undo document change' })
    fireEvent.click(undo)
    expect(source).toHaveValue('vector(2, 1)')
    fireEvent.change(source, {
      target: { value: 'R = -1 + 0.0000000035897930298416118e12' },
    })
    openSettings()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Decimal places' }), {
      target: { value: '2' },
    })

    expect(source).toHaveValue('R = -1 + 0.0000000035897930298416118e12')
    expect(screen.getByText('Scalar')).toBeInTheDocument()
    expect(screen.getByText('-1 + 3.59E-9e12')).toBeInTheDocument()
    fireEvent.click(undo)
    expect(source).toHaveValue('vector(2, 1)')
  })

  it('hides approximated residue by default and reveals it via the display setting', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(source, {
      target: { value: 'R = -1 + 0.0000000035897930298416118e12' },
    })
    const item = source.closest('.expression-item') as HTMLElement
    expect(within(item).getByText('Scalar')).toBeInTheDocument()
    expect(within(item).getByText('-1')).toBeInTheDocument()
    expect(within(item).queryByText('-1 + 3.5898E-9e12')).not.toBeInTheDocument()

    openSettings()
    fireEvent.click(screen.getByRole('switch', { name: 'Show approximated residue' }))
    expect(within(item).getByText('Scalar')).toBeInTheDocument()
    expect(within(item).getByText('-1 + 3.5898E-9e12')).toBeInTheDocument()
  })

  it('shows a textual, source-associated diagnostic and removes stale output', () => {
    render(<App />)

    const input = screen.getByRole('textbox', {
      name: 'Expression 1',
    })
    fireEvent.change(input, { target: { value: 'vector(2)' } })

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Expected “,” between vector components.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Source characters')
    expect(screen.queryByText('2e1 + e2')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent('No spatial objects are visible')
  })

  it('recovers immediately when invalid source is corrected', () => {
    render(<App />)

    const input = screen.getByRole('textbox', {
      name: 'Expression 1',
    })
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.change(input, { target: { value: 'vector(-3, 4)' } })

    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByText('-3e1 + 4e2')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      'Vector 1 runs from the origin to -3, 4.',
    )
  })

  it('interprets equivalent zero expressions as the same scalar value', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(input, { target: { value: 'vector(0, 0)' } })

    expect(screen.getByText('0', { selector: 'output' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Vector 1')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: '0' } })

    expect(screen.getByText('0', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent('No spatial objects are visible')
  })

  it('evaluates a nonzero scalar without treating it as invalid', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(input, { target: { value: '12' } })

    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByText('12', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent('No spatial objects are visible')
  })

  it('shows gray and error pastilles for empty and invalid expressions', () => {
    const { container } = render(<App />)
    const expression = screen.getByRole('textbox', { name: 'Expression 1' })

    fireEvent.change(expression, { target: { value: '' } })
    expect(screen.queryByText(/Enter an expression/)).not.toBeInTheDocument()
    expect(container.querySelector('.expression-status-pastille.is-empty'))
      .toBeInTheDocument()

    fireEvent.change(expression, { target: { value: 'Missing' } })
    expect(expression).toHaveAttribute('aria-invalid', 'true')
    expect(container.querySelector('.expression-status-pastille.is-error'))
      .toBeInTheDocument()
  })

  it('offers color-only appearance for a scalar', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: '12' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Scalar menu for Scalar' }))

    expect(screen.getByRole('dialog', { name: 'Scalar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use color green 4' })).toBeInTheDocument()
    expect(screen.queryByText('Visibility')).not.toBeInTheDocument()
    expect(screen.queryByText('Show label')).not.toBeInTheDocument()
  })

  it('accepts basis-blade notation through the same visual workflow', () => {
    render(<App />)

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Expression 1' }),
      { target: { value: 'e1 + 2e2' } },
    )

    expect(
      screen.getByText('e1 + 2e2', { selector: 'output' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      'Vector 1 runs from the origin to 1, 2.',
    )
  })

  it('shows a minimal object kind above the canonical value', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(input, { target: { value: '12 + 2e1 + 80e12' } })

    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(
      screen.getByText('12 + 2e1 + 80e12', { selector: 'output' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Mixed multivector')).toBeInTheDocument()
  })

  it('adds independent expressions and renders their vectors in list order', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const second = screen.getByRole('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'vector(-1, 2)' } })

    expect(screen.getAllByLabelText(/^Vector [12]$/)).toHaveLength(2)
    expect(screen.getByRole('img')).toHaveTextContent(
      '2 vectors and 0 bivectors are visible.',
    )
    expect(screen.getByRole('img')).toHaveTextContent(
      'Vector 2 runs from the origin to -1, 2.',
    )
  })

  it('re-evaluates named expressions and their transitive dependents', () => {
    render(<App />)

    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'V1 = vector(1, 1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const second = screen.getByRole('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'V2 = vector(2, 1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const third = screen.getByRole('textbox', { name: 'Expression 3' })
    fireEvent.change(third, { target: { value: 'B = V1 * V2' } })

    expect(screen.getByText('3 - e12', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByLabelText('V1')).toBeInTheDocument()
    expect(screen.getByLabelText('V2')).toBeInTheDocument()

    fireEvent.change(first, { target: { value: 'V1 = vector(3, 0)' } })

    expect(screen.getByText('6 + 3e12', { selector: 'output' })).toBeInTheDocument()
  })

  it('shows document-level undefined-name diagnostics', () => {
    render(<App />)

    const input = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(input, { target: { value: 'B = Missing * e1' } })

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('LANG_UNDEFINED_NAME')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The name “Missing” is not defined.',
    )
  })

  it('edits a separate position source and renders translated endpoints', () => {
    render(<App />)

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Expression 1' }),
      { target: { value: 'V = vector(2, 1)' } },
    )
    const position = screen.getByRole('textbox', { name: 'Position 1' })
    expect(position).toHaveAttribute('placeholder', '(0, 0)')
    fireEvent.change(position, { target: { value: '(-1, 2)' } })

    expect(position).toHaveAttribute('aria-invalid', 'false')
    expect(screen.queryByText('Position: -e1 + 2e2')).not.toBeInTheDocument()
    expect(screen.queryByText('Head: e1 + 3e2')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      'V runs from -1, 2 to 1, 3.',
    )
    expect(screen.getByLabelText('V')).toHaveAttribute('x1', '248')
    expect(screen.getByLabelText('V')).toHaveAttribute('y1', '96')
  })

  it('hides a rendered object without changing its evaluated text', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Hide Vector' }))

    expect(screen.getByText('2e1 + e2', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Vector' })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent('No spatial objects are visible')
  })

  it('shares visibility between the menu eye and the row eye', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for Vector' }))
    const eye = within(screen.getByRole('dialog', { name: 'Vector' })).getByRole('switch', { name: 'Visible' })
    expect(eye).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(eye)
    expect(eye).toHaveAttribute('aria-checked', 'false')
    expect(eye).toHaveAttribute('title', 'Show')
    expect(screen.getByRole('button', { name: 'Show Vector' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('img')).toHaveTextContent('No spatial objects are visible')

    fireEvent.click(screen.getByRole('button', { name: 'Show Vector' }))
    expect(eye).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the visibility eye on row hover or focus, and always for a hidden object', () => {
    render(<App />)
    const hide = screen.getByRole('button', { name: 'Hide Vector' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    expect(hide.querySelector('svg.visibility-icon')).not.toBeNull()
    expect(hide.querySelector('.visibility-icon-slash')).toBeNull()
    hide.focus()
    expect(hide).toHaveFocus()

    fireEvent.click(hide)
    const show = screen.getByRole('button', { name: 'Show Vector' })
    expect(show).toHaveAttribute('aria-pressed', 'false')
    expect(show.querySelector('.visibility-icon-slash')).not.toBeNull()
    expect(show.closest('.expression-item')).toHaveClass('is-hidden')

    // jsdom does not evaluate :hover, :focus-within, or media queries, so the
    // reveal rules are checked in the stylesheet. Opacity, not visibility or
    // display, hides the eye so that it stays in the tab order.
    const appStyles = readFileSync(`${import.meta.dirname}/App.css`, 'utf8')
    const rule = (selector: string) => [...appStyles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .find(([, selectors]) => selectors.replace(/\/\*[\s\S]*?\*\//g, '').trim().split(/,\s*/).join(', ') === selector)
      ?.[0] ?? ''
    expect(rule('.visibility-toggle')).toMatch(/opacity: 0;/)
    expect(rule('.visibility-toggle')).not.toMatch(/visibility:|display:/)
    expect(rule([
      '.expression-item:hover .visibility-toggle',
      '.expression-item:focus-within .visibility-toggle',
      '.expression-item.is-hidden .visibility-toggle',
    ].join(', '))).toMatch(/opacity: 1;/)
    expect(appStyles).toMatch(/@media \(hover: none\) \{\s*\.visibility-toggle \{\s*opacity: 1;/)
  })

  it('applies deterministic default styles per semantic object kind', () => {
    render(<App />)
    const expression = screen.getByRole('textbox', { name: 'Expression 1' })

    expect(screen.getByText('Vector')).toHaveStyle({ color: '#E8A000' })

    fireEvent.change(expression, { target: { value: 'e1 ^ e2' } })
    expect(screen.getByText('Bivector')).toHaveStyle({ color: '#C30A3A' })

    fireEvent.change(expression, { target: { value: '3' } })
    expect(screen.getByText('Scalar')).toHaveStyle({ color: '#0F9D57' })
  })

  it('edits common color and label appearance independently of the value', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for Vector' }))
    expect(screen.getByRole('dialog', { name: 'Vector' })).toBeInTheDocument()

    // A hue keeps the selected shade; the shade bar then picks any shade of it.
    expect(screen.getByRole('button', { name: 'Yellow' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Green' }))
    expect(screen.getByRole('button', { name: 'Use color green 4' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Use color green 4' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show label' }))
    // The text is edited under the expression, not in the menu (#226).
    expect(screen.queryByRole('textbox', { name: 'Text' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Label of expression 1' }), {
      target: { value: 'Velocity' },
    })

    expect(screen.getByText('2e1 + e2', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByText('Velocity', { selector: 'text' })).toBeInTheDocument()
    expect(screen.getByText('Vector', { selector: '.object-kind' }))
      .toHaveStyle({ color: '#0F9D57' })
  })

  it('renders bivectors without a border by default and enables it from appearance', () => {
    const { container } = render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'B = e12' },
    })
    const bivector = container.querySelector('.bivector')
    expect(bivector).not.toHaveClass('has-border')
    expect(container.querySelector('.bivector-orientation')).toBeInTheDocument()
    expect(bivector).not.toHaveAttribute('marker-end')

    fireEvent.click(screen.getByRole('button', { name: 'Open Bivector menu for B' }))
    expect(screen.getByRole('button', { name: 'From vectors' })).toBeDisabled()
    const border = screen.getByRole('switch', { name: 'Outline' })
    expect(border).not.toBeChecked()
    fireEvent.click(border)

    expect(border).toBeChecked()
    expect(bivector).toHaveClass('has-border')

    fireEvent.click(screen.getByRole('switch', { name: 'Orientation visible' }))
    expect(screen.getByRole('switch', { name: 'Orientation visible' })).not.toBeChecked()
    expect(container.querySelector('.bivector-orientation')).not.toBeInTheDocument()
  })

  it('selects visual bivector shapes while preserving construction availability', () => {
    const { container } = render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 0)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'W = vector(0, 2)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 3' }), {
      target: { value: 'B = V ^ W' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open Bivector menu for B' }))

    const fromVectors = screen.getByRole('button', { name: 'From vectors' })
    expect(fromVectors).toBeEnabled()
    expect(fromVectors).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.bivector')).toHaveAttribute('d', expect.stringContaining('L'))

    fireEvent.click(screen.getByRole('button', { name: 'Disk' }))
    expect(screen.getByRole('button', { name: 'Disk' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.bivector')).toHaveAttribute('d', expect.stringContaining('A'))

    fireEvent.click(screen.getByRole('button', { name: 'Square' }))
    expect(screen.getByRole('button', { name: 'Square' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.bivector')).toHaveAttribute('d', expect.stringContaining('H'))
  })

  it('restores the declared name when the label text is cleared', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for V' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show label' }))

    const label = screen.getByRole('textbox', { name: 'Label of expression 1' })
    fireEvent.change(label, { target: { value: 'Velocity' } })
    expect(screen.getByText('Velocity', { selector: 'text' })).toBeInTheDocument()

    fireEvent.change(label, { target: { value: '' } })

    expect(label).toHaveValue('')
    expect(screen.getByText('V', { selector: 'text' })).toBeInTheDocument()
  })

  it('keeps focus in the label field while its text changes', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'V = vector(2, 1)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for V' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show label' }))
    const label = screen.getByRole('textbox', { name: 'Label of expression 1' })

    label.focus()
    fireEvent.change(label, { target: { value: 'V' } })
    expect(label).toHaveFocus()
    fireEvent.change(label, { target: { value: 'Ve' } })
    expect(label).toHaveFocus()
  })

  it('returns focus to the swatch when the appearance popover closes', () => {
    render(<App />)
    const swatch = screen.getByRole('button', { name: 'Open Vector menu for Vector' })

    fireEvent.click(swatch)
    fireEvent.click(screen.getByRole('button', { name: 'Close Vector menu' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(swatch).toHaveFocus()
  })

  it('closes appearance with Escape and restores focus without a keyboard trap', () => {
    render(<App />)
    const swatch = screen.getByRole('button', {
      name: 'Open Vector menu for Vector',
    })

    fireEvent.click(swatch)
    expect(screen.getByRole('dialog', { name: 'Vector' }))
      .toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Visible' })).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(swatch).toHaveFocus()
  })

  it('closes an expression menu when the canvas is clicked', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for Vector' }))
    expect(screen.getByRole('dialog', { name: 'Vector' })).toBeInTheDocument()

    fireEvent.pointerDown(viewportCanvas(), {
      button: 0, pointerId: 1, clientX: 320, clientY: 240,
    })

    expect(screen.queryByRole('dialog', { name: 'Vector' })).not.toBeInTheDocument()
  })

  it('offers system, light, and dark application themes', () => {
    render(<App />)
    openSettings()
    const theme = screen.getByRole('combobox', { name: 'Theme' })

    fireEvent.change(theme, { target: { value: 'dark' } })
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    fireEvent.change(theme, { target: { value: 'light' } })
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  })

  it('switches between light and dark from the header, starting from the system theme', () => {
    render(<App />)
    expect(document.documentElement).toHaveAttribute('data-theme', 'system')
    const header = screen.getByRole('banner')
    const settings = within(header).getByRole('button', { name: 'Settings' })
    const toggle = within(header).getByRole('button', { name: 'Switch to dark theme' })
    expect(toggle.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(toggle)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    fireEvent.click(within(header).getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')

    // The settings menu still offers the system theme.
    openSettings()
    fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), { target: { value: 'system' } })
    expect(document.documentElement).toHaveAttribute('data-theme', 'system')
  })

  it('switches VGA normalization from the row button, without a menu or rewriting the expression', () => {
    render(<App />)
    const expression = screen.getByRole('textbox', { name: 'Expression 1' })
    const normalize = screen.getByRole('button', { name: 'Normalization: off' })
    expect(normalize).toHaveTextContent(/^norm$/)
    // VGA has one norm: the button switches off and auto directly.
    expect(normalize).toHaveAttribute('aria-pressed', 'false')
    expect(normalize).not.toHaveAttribute('aria-haspopup')

    fireEvent.click(normalize)
    expect(screen.queryByRole('dialog', { name: 'Normalize' })).not.toBeInTheDocument()
    expect(normalize).toHaveAccessibleName('Normalization: auto')
    expect(normalize).toHaveAttribute('aria-pressed', 'true')
    expect(normalize).toHaveTextContent(/^auto$/)
    expect(expression).toHaveValue('vector(2, 1)')
    expect(screen.queryByText('2e1 + e2', { selector: 'output' })).not.toBeInTheDocument()

    fireEvent.click(normalize)
    expect(screen.getByText('2e1 + e2', { selector: 'output' })).toBeInTheDocument()
    expect(normalize).toHaveAccessibleName('Normalization: off')
    expect(normalize).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers normalization for rotors and mixed multivectors but not scalars', () => {
    render(<App />)
    const expression = screen.getByRole('textbox', { name: 'Expression 1' })

    fireEvent.change(expression, { target: { value: 'R = 2 + e12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Normalization: off' }))
    expect(screen.getByRole('button', { name: 'Normalization: auto' })).toBeInTheDocument()
    expect(expression).toHaveValue('R = 2 + e12')

    fireEvent.change(expression, { target: { value: 'M = 1 + e1' } })
    expect(screen.getByRole('button', { name: 'Normalization: auto' })).toBeInTheDocument()
    expect(screen.getByText('Normalization unavailable')).toBeInTheDocument()
    expect(screen.getByText(/zero natural norm/)).toBeInTheDocument()

    fireEvent.change(expression, { target: { value: 's = 2' } })
    expect(screen.queryByRole('button', { name: /^Normalization/ })).not.toBeInTheDocument()
  })

  it('marks unit-norm multivectors independently of the normalization mode', () => {
    render(<App />)
    const expression = screen.getByRole('textbox', { name: 'Expression 1' })
    expect(screen.getByRole('button', { name: 'Normalization: off' })).toBeInTheDocument()
    expect(screen.queryByText('Unit norm')).not.toBeInTheDocument()

    fireEvent.change(expression, { target: { value: 'V = e1' } })
    expect(screen.getByText('Unit norm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Normalization: off' })).toBeInTheDocument()

    fireEvent.change(expression, { target: { value: 'V = 2*e1' } })
    expect(screen.queryByText('Unit norm')).not.toBeInTheDocument()
  })

  it('shows a position diagnostic while retaining the vector output', () => {
    render(<App />)

    const position = screen.getByRole('textbox', { name: 'Position 1' })
    fireEvent.change(position, { target: { value: '12' } })

    expect(position).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('GEOM_INVALID_POSITION')
    expect(screen.getByText('2e1 + e2', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      'Vector 1 runs from the origin to 2, 1.',
    )
  })

  it('offers editable positions for vectors and bivectors but not scalars or lists', () => {
    render(<App />)

    const expression = screen.getByRole('textbox', { name: 'Expression 1' })
    expect(
      screen.getByRole('textbox', { name: 'Position 1' }),
    ).toBeInTheDocument()

    fireEvent.change(expression, { target: { value: '12' } })

    expect(
      screen.queryByRole('textbox', { name: 'Position 1' }),
    ).not.toBeInTheDocument()

    fireEvent.change(expression, { target: { value: '3e12' } })

    expect(screen.getByText('Bivector')).toBeInTheDocument()
    expect(
      screen.getByText('3e12', { selector: 'output' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Position 1' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      'Bivector 1 is an oriented loop with signed value 3, area 3, counterclockwise orientation, positioned at the origin.',
    )

    fireEvent.change(expression, { target: { value: '[e1, e2]' } })

    expect(screen.getByText('List (2)')).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Position 1' }),
    ).not.toBeInTheDocument()
  })

  it.each([
    ['12', 'Scalar'],
    ['(2, 1)', 'Vector'],
    ['3e12', 'Bivector'],
    ['1 + e12', 'Rotor'],
    ['1 + e1 + e12', 'Mixed multivector'],
  ])('labels %s as %s without derived details', (source, kind) => {
    render(<App />)

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Expression 1' }),
      { target: { value: source } },
    )

    expect(screen.getByText(kind)).toBeInTheDocument()
    expect(screen.queryByText(/‖/)).not.toBeInTheDocument()
  })

  it('evaluates an outer product as a textual and visual bivector object', () => {
    render(<App />)

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Expression 1' }),
      { target: { value: '(1, 0) ^ (0, 1)' } },
    )

    expect(screen.getByText('Bivector')).toBeInTheDocument()
    expect(screen.getByText('e12', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveTextContent(
      'Bivector 1 is an oriented parallelogram with signed value 1, area 1, counterclockwise orientation, positioned at the origin.',
    )
  })

  it('inserts after the active row with Enter and deletes an empty row', () => {
    render(<App />)

    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.keyDown(first, { key: 'Enter' })

    const second = screen.getByRole('textbox', { name: 'Expression 2' })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second, { key: 'Backspace' })

    expect(
      screen.queryByRole('textbox', { name: 'Expression 2' }),
    ).not.toBeInTheDocument()
    expect(first).toHaveFocus()
  })

  it('inserts below from a position field with Enter', () => {
    render(<App />)
    const position = screen.getByRole('textbox', { name: 'Position 1' })
    fireEvent.change(position, { target: { value: '(1, 1)' } })

    fireEvent.keyDown(position, { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: 'Position 1' }))
      .toHaveValue('(1, 1)')
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus()
  })

  it('inserts above from expression and position fields with Shift+Enter', () => {
    render(<App />)
    const expression = screen.getByRole('textbox', { name: 'Expression 1' })

    fireEvent.keyDown(expression, { key: 'Enter', shiftKey: true })

    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Expression 2' }))
      .toHaveValue('vector(2, 1)')

    const position = screen.getByRole('textbox', { name: 'Position 2' })
    fireEvent.keyDown(position, { key: 'Enter', shiftKey: true })

    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Expression 3' }))
      .toHaveValue('vector(2, 1)')
  })

  it('keeps sibling results when one expression is invalid or deleted', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    const second = screen.getByRole('textbox', { name: 'Expression 2' })
    fireEvent.change(first, { target: { value: 'vector(1)' } })
    fireEvent.change(second, { target: { value: 'e2' } })

    expect(first).toHaveAttribute('aria-invalid', 'true')
    expect(second).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByLabelText('Vector 2')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete expression 1' }),
    )

    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue(
      'e2',
    )
    expect(screen.getByLabelText('Vector 1')).toBeInTheDocument()
  })

  it('resizes the expression panel with an accessible separator', () => {
    render(<App />)

    const separator = screen.getByRole('separator', {
      name: 'Resize expression panel',
    })
    expect(separator).toHaveAttribute('aria-valuenow', '340')

    fireEvent.keyDown(separator, { key: 'ArrowRight' })

    expect(separator).toHaveAttribute('aria-valuenow', '356')
    expect(
      screen.getByRole('complementary', { name: 'Expressions' }),
    ).toHaveStyle({ width: '356px' })
  })

  it('squares the canvas by widening the expression panel past the drag cap', () => {
    render(<App />)
    const separator = screen.getByRole('separator', {
      name: 'Resize expression panel',
    })
    const workspace = screen.getByRole('main')
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      width: 2000,
      height: 1200,
      top: 0,
      left: 0,
      right: 2000,
      bottom: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Make canvas square' }))

    // 2000 workspace − 6 separator − 1200 tall canvas leaves a square canvas,
    // which needs more panel width than the former fixed 720 pixel cap allowed.
    expect(separator).toHaveAttribute('aria-valuenow', '794')
    expect(
      screen.getByRole('complementary', { name: 'Expressions' }),
    ).toHaveStyle({ width: '794px' })
  })

  it('opens the VGA algebra information and restores focus on Escape', () => {
    render(<App />)

    const trigger = screen.getByRole('button', { name: 'Algebra information' })
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', {
      name: 'Vector Geometric Algebra ℝ(2,0,0)',
    })
    expect(dialog).toHaveTextContent('Basis & metric')
    expect(dialog).toHaveTextContent('Cayley table')
    expect(dialog).toHaveTextContent('Geometric interpretation')
    expect(dialog).toHaveTextContent('Sub-algebras')
    expect(dialog).not.toHaveTextContent('Available operations')
    expect(dialog).not.toHaveTextContent('A.involution')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('switches algebra from the capsule menu, clearing content only after confirmation', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    expect(source).toHaveValue('vector(2, 1)')

    const badge = screen.getByRole('button', { name: 'VGA · 2D. Change algebra' })
    fireEvent.click(badge)
    const menu = screen.getByRole('menu', { name: 'Document algebra' })
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual([
      'VGA · 2DVector Geometric Algebra', 'PGA · 2DProjective Geometric Algebra',
    ])
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
    expect(items[0]).toHaveFocus()

    // Declining keeps the document and the algebra.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(items[1])
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0]).toMatch(/replaces every expression/)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(source).toHaveValue('vector(2, 1)')
    expect(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' })).toHaveFocus()

    // Accepting clears and switches in one history entry.
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    expect(screen.getByRole('button', { name: 'PGA · 2D. Change algebra' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('A = point(-2, 1)')
    expect(screen.getAllByRole('textbox', { name: /^Expression \d+$/ })).toHaveLength(16)
    expect(screen.getByText('PGA · 2D selected; its example document was loaded.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('vector(2, 1)')
    expect(screen.getAllByRole('textbox', { name: /^Expression \d+$/ })).toHaveLength(1)

    // Re-selecting the current algebra asks nothing and changes nothing.
    confirm.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[0])
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' })).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('names the document and its export after the example of the selected algebra', () => {
    const downloads: string[] = []
    class TestURL extends URL {
      static createObjectURL = vi.fn((_blob: Blob) => 'blob:gamut-document')
      static revokeObjectURL = vi.fn((_url: string) => undefined)
    }
    vi.stubGlobal('URL', TestURL)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const switchTo = (current: string, index: number) => {
      fireEvent.click(screen.getByRole('button', { name: `${current}. Change algebra` }))
      fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[index])
    }

    switchTo('VGA · 2D', 1)
    runDocumentCommand('Export')
    switchTo('PGA · 2D', 0)
    runDocumentCommand('Export')

    expect(downloads).toEqual([
      'PGA-2D-Triangle-Example.gamut.json',
      'VGA-2D-Rotation-Example.gamut.json',
    ])
  })

  it('navigates the algebra menu by keyboard and closes it with Escape', () => {
    render(<App />)
    const badge = screen.getByRole('button', { name: 'VGA · 2D. Change algebra' })
    fireEvent.click(badge)
    const menu = screen.getByRole('menu', { name: 'Document algebra' })
    const items = within(menu).getAllByRole('menuitemradio')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(items[1]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(items[1]).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(badge).toHaveFocus()
  })

  it('keeps only the algebra in the algebra dialog, without colors, constructors, or source spellings', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const vga = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Algebra information' }))
      return screen.getByRole('dialog', { name: 'Vector Geometric Algebra ℝ(2,0,0)' })
    }
    let dialog = vga()
    expect(dialog).toHaveTextContent('a·e1 + b·e2')
    expect(dialog).not.toHaveTextContent('Object colors')
    expect(dialog).not.toHaveTextContent(/render|parallelogram|positionable|separate position/i)
    for (const [, style] of DEFAULT_OBJECT_STYLES)
      expect(dialog).not.toHaveTextContent(paletteEntry(style)?.name ?? style)
    expect(dialog.querySelector('.object-color-swatch')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Algebra information' }))
    dialog = screen.getByRole('dialog', { name: 'Projective Geometric Algebra ℝ(2,0,1)' })
    expect(dialog).toHaveTextContent('w·e12 − x·e02 + y·e01')
    expect(dialog).toHaveTextContent('y·e01 − x·e02')
    expect(dialog).toHaveTextContent('A ∨ B = J(J(A) ∧ J(B))')
    expect(dialog).not.toHaveTextContent(/ipoint|point\(|line\(|A & B|e20|normalization|Object colors/)
  })

  it('clears every expression after the clear control is held', () => {
    vi.useFakeTimers()
    try {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
        target: { value: 'e1 ^ e2' },
      })
      const clear = screen.getByRole('button', { name: 'Clear all expressions' })

      fireEvent.pointerDown(clear)
      act(() => void vi.advanceTimersByTime(CLEAR_HOLD_MS - 1))
      expect(screen.getByRole('textbox', { name: 'Expression 1' })).toBeInTheDocument()

      act(() => void vi.advanceTimersByTime(1))

      expect(screen.queryByRole('textbox', { name: 'Expression 1' }))
        .not.toBeInTheDocument()
      expect(clear).toBeDisabled()
      expect(screen.getByRole('img')).toHaveTextContent(
        'No spatial objects are visible from 0 expressions',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps every expression when the hold is released early', () => {
    vi.useFakeTimers()
    try {
      render(<App />)
      const clear = screen.getByRole('button', { name: 'Clear all expressions' })

      fireEvent.pointerDown(clear)
      act(() => void vi.advanceTimersByTime(CLEAR_HOLD_MS / 2))
      fireEvent.pointerUp(clear)
      act(() => void vi.advanceTimersByTime(CLEAR_HOLD_MS))

      expect(screen.getByRole('textbox', { name: 'Expression 1' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers the same hold gesture to the keyboard', () => {
    vi.useFakeTimers()
    try {
      render(<App />)
      const clear = screen.getByRole('button', { name: 'Clear all expressions' })

      fireEvent.keyDown(clear, { key: 'Enter' })
      act(() => void vi.advanceTimersByTime(CLEAR_HOLD_MS))

      expect(screen.queryByRole('textbox', { name: 'Expression 1' }))
        .not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('places the clear-all cross at the bottom of the list, outside the reference band', () => {
    render(<App />)
    const clear = screen.getByRole('button', { name: 'Clear all expressions' })
    const band = screen.getByRole('button', { name: /Expression reference/ })
    expect(clear.closest('.expression-list-footer')).not.toBeNull()
    expect(clear.closest('.expression-panel-footer')).toBeNull()
    const list = document.querySelector('.expression-list')!
    expect(list.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(clear.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

/** Opens the reference from its band and returns the band and the reference region. */
function openReference() {
  const band = screen.getByRole('button', { name: /Expression reference/ })
  fireEvent.click(band)
  return { band, reference: screen.getByRole('region', { name: 'Expression reference' }) }
}

/** Shows one category of the open reference: `General`, `VGA` or `PGA`. */
function showReferenceTab(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

describe('expression reference docked in the expression panel', () => {
  it('opens and closes under its band, never as a modal, and closes with Escape', () => {
    render(<App />)
    const band = screen.getByRole('button', { name: /Expression reference/ })
    expect(band).toHaveAttribute('aria-expanded', 'false')
    expect(band).toHaveAttribute('aria-controls', 'expression-reference')
    expect(band).toHaveTextContent('VGA · 2D')
    expect(screen.queryByRole('region', { name: 'Expression reference' })).not.toBeInTheDocument()
    expect(screen.queryByRole('separator', { name: 'Resize the expression reference' })).not.toBeInTheDocument()

    fireEvent.click(band)
    const reference = screen.getByRole('region', { name: 'Expression reference' })
    expect(band).toHaveAttribute('aria-expanded', 'true')
    expect(reference).toHaveAttribute('id', 'expression-reference')
    expect(screen.getByRole('complementary', { name: 'Expressions' })).toContainElement(reference)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(viewportCanvas()).toBeInTheDocument()
    expect(reference).toHaveTextContent('L[[2, 0, 2]]')
    showReferenceTab('VGA')
    expect(reference).toHaveTextContent('V = (2, 1)')
    expect(reference).toHaveTextContent('position (0, 0)')
    expect(reference).not.toHaveTextContent('@')

    fireEvent.click(band)
    expect(screen.queryByRole('region', { name: 'Expression reference' })).not.toBeInTheDocument()

    fireEvent.click(band)
    const reopened = screen.getByRole('region', { name: 'Expression reference' })
    fireEvent.keyDown(within(reopened).getAllByRole('button', { name: /^Add / })[0], { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Expression reference' })).not.toBeInTheDocument()
    expect(band).toHaveAttribute('aria-expanded', 'false')
    expect(band).toHaveFocus()
  })

  it('shows one category at a time from the General | algebra tabs, with no search, chips or tags', () => {
    render(<App />)
    const { reference } = openReference()
    const tabs = within(reference).getAllByRole('tab')
    expect(within(reference).getByRole('tablist', { name: 'Expression categories' })).toBeInTheDocument()
    expect(tabs.map((tab) => tab.textContent)).toEqual(['General', 'VGA'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    const panel = () => within(reference).getByRole('tabpanel')
    const titles = () => within(panel()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)

    // General: true in every algebra, ending with Style.
    expect(panel()).toHaveAccessibleName('General')
    expect(titles()).toEqual(['Values and names', 'Lists and ranges', 'Operators', 'Properties', 'Functions', 'Precedence', 'Comments', 'Style'])
    expect(panel()).toHaveTextContent('A ^ B')
    expect(panel()).toHaveTextContent('Comment # text')
    expect(panel()).toHaveTextContent('Color 9 hues × 6 shades')
    expect(panel()).not.toHaveTextContent('vector(2, 1)')

    // The algebra's own syntax, from its tab or with the arrow keys.
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveFocus()
    expect(titles()).toEqual(['Primitives', 'Values', 'Properties', 'Positioning'])
    expect(panel()).toHaveTextContent('Rotor exp(a/2*e12)')
    expect(panel()).toHaveTextContent('Normalization norm buttonoff · auto')
    expect(panel()).toHaveTextContent('vector(2, 1)')
    expect(panel()).not.toHaveTextContent('A ^ B')
    fireEvent.keyDown(tabs[1], { key: 'ArrowRight' })
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    expect(within(reference).queryByRole('searchbox')).not.toBeInTheDocument()
    expect(within(reference).queryByRole('group', { name: 'Reference sections' })).not.toBeInTheDocument()
    expect(reference).not.toHaveTextContent(/ only/)
    expect(reference).not.toHaveTextContent(/default colou?r|green 4|yellow 4|red 4|blue 4/i)
  })

  it('adds an example as a new focused expression with its position', () => {
    render(<App />)
    const { reference } = openReference()
    fireEvent.click(within(reference).getByRole('button', { name: 'Add [1...5] as a new expression' }))
    const added = screen.getByRole('textbox', { name: 'Expression 2' })
    expect(added).toHaveValue('[1...5]')
    expect(added).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Expression reference' })).toBeInTheDocument()

    showReferenceTab('VGA')
    fireEvent.click(within(reference).getAllByRole('button', { name: 'Add V = vector(1, 0) as a new expression' })[0])
    expect(screen.getByRole('textbox', { name: 'Expression 3' })).toHaveValue('V = vector(1, 0)')
    expect(screen.getByRole('textbox', { name: 'Position 3' })).toHaveValue('(1, 2)')

    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(screen.queryByRole('textbox', { name: 'Expression 3' })).not.toBeInTheDocument()
  })

  it('adds the examples of a primitive, including a rotation shown without its float result', () => {
    render(<App />)
    const { reference } = openReference()
    showReferenceTab('VGA')
    const primitives = within(reference).getByRole('heading', { level: 3, name: 'Primitives' }).closest('section') as HTMLElement
    const rotor = within(primitives).getByText('Rotor').closest('article') as HTMLElement
    expect(rotor).toHaveTextContent('with R = exp(pi/4*e12)')
    expect(rotor).toHaveTextContent('R >>> e1')
    expect(rotor).not.toHaveTextContent('E-16')
    expect(within(primitives).queryAllByRole('button', { name: /^Add / })).toHaveLength(9)
    expect(within(primitives).getByText('Normalization').closest('article')).not.toHaveTextContent('+')

    fireEvent.click(within(primitives).getByRole('button', { name: 'Add U = vector(1, 2) as a new expression' }))
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('U = vector(1, 2)')
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus()
  })

  it('resizes the reference from its handle with the keyboard and remembers the height', () => {
    const { unmount } = render(<App />)
    const { reference } = openReference()
    const handle = screen.getByRole('separator', { name: 'Resize the expression reference' })
    expect(handle).toHaveAttribute('aria-valuenow', '58')
    expect(reference).toHaveStyle({ flexBasis: '58%' })

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle).toHaveAttribute('aria-valuenow', '68')
    expect(reference).toHaveStyle({ flexBasis: '68%' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(handle).toHaveAttribute('aria-valuenow', '63')
    expect(window.localStorage.getItem('gamut.expressionReferenceHeight')).toBe('0.63')
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(handle).toHaveAttribute('aria-valuenow', '25')

    unmount()
    window.localStorage.setItem('gamut.expressionReferenceHeight', '0.7')
    render(<App />)
    openReference()
    expect(screen.getByRole('separator', { name: 'Resize the expression reference' }))
      .toHaveAttribute('aria-valuenow', '70')
  })

  it('falls back to the default height for a corrupt stored value', () => {
    window.localStorage.setItem('gamut.expressionReferenceHeight', 'tall')
    render(<App />)
    openReference()
    expect(screen.getByRole('separator', { name: 'Resize the expression reference' }))
      .toHaveAttribute('aria-valuenow', '58')
  })

  it('resizes the reference by dragging its handle', () => {
    render(<App />)
    const { reference } = openReference()
    const panel = screen.getByRole('complementary', { name: 'Expressions' })
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 400, height: 1000, top: 0, right: 400, bottom: 1000, left: 0, toJSON: () => ({}),
    })
    const handle = screen.getByRole('separator', { name: 'Resize the expression reference' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 420 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300 })
    expect(handle).toHaveAttribute('aria-valuenow', '70')
    expect(reference).toHaveStyle({ flexBasis: '70%' })
    expect(window.localStorage.getItem('gamut.expressionReferenceHeight')).toBe('0.7')
  })
})

describe('expression reference of a PGA(2) document', () => {
  it('shows the PGA expressions category, constructors, blades, norms, and motor functions, and no VGA-only syntax', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    const { band, reference } = openReference()

    expect(band).toHaveTextContent('PGA · 2D')
    expect(within(reference).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['General', 'PGA'])
    // General expressions hold in PGA too, with PGA results for & and !.
    for (const syntax of ['L[[2, 0, 2]]', 'a % m', 'point(0, 0) & point(1, 0)']) expect(reference).toHaveTextContent(syntax)
    showReferenceTab('PGA')
    const algebra = within(reference).getByRole('tabpanel')
    expect(within(algebra).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Primitives')
    expect(algebra).toHaveTextContent('point(x, y, w)')
    expect(algebra).toHaveTextContent('A.inorm')
    expect(reference).toHaveTextContent('Line line(a, b, c), A & Ba·x + b·y + c = 0, or the line through A and B')
    expect(reference).toHaveTextContent('off · auto · norm · inorm')
    for (const syntax of [
      'point(x, y)', 'point(x, y, w)', 'ipoint(x, y)', 'line(a, b, c)',
      'e0, e1, e2, e01, e02, e12, e012', 'A.inorm', 'A.e012', 'log(M), sqrt(M)', 'I.head',
      'position point(x, y)', 'log(M)', '-0.5e12',
    ]) expect(reference).toHaveTextContent(syntax)
    expect(reference).not.toHaveTextContent('VGA')
    expect(reference).not.toHaveTextContent('vector(2, 1)')
    expect(reference).not.toHaveTextContent('V = (2, 1)')
  })
})

describe('opening a document by dropping a file onto the window', () => {
  const documentFile = (name: string, contents: string, type = 'application/json') => {
    const bytes = new TextEncoder().encode(contents)
    return { name, type, arrayBuffer: async () => bytes.slice().buffer } as unknown as File
  }
  const droppedDocument = () => JSON.stringify(toCanonicalDocument(expressionDocument(
    [{ id: 'dropped-vector', source: 'Dropped = vector(5, 6)' }], {}, { id: 'dropped-document', title: 'Dropped' },
  ), 'dark'))
  const fileTransfer = (files: File[]) => ({ types: ['Files'], files, dropEffect: 'none' })
  const overlay = () => screen.queryByText('Drop a JSON document to open it')

  it('shows an announced overlay while a file is dragged, and hides it on leave', () => {
    render(<App />)
    const target = screen.getByRole('textbox', { name: 'Expression 1' })
    expect(overlay()).not.toBeInTheDocument()
    fireEvent.dragEnter(document.body, { dataTransfer: fileTransfer([]) })
    fireEvent.dragEnter(target, { dataTransfer: fileTransfer([]) })
    expect(overlay()).toBeInTheDocument()
    expect(overlay()!.closest('[role="status"]')).not.toBeNull()
    // Leaving a child keeps the overlay; leaving the window hides it.
    fireEvent.dragLeave(target, { dataTransfer: fileTransfer([]) })
    expect(overlay()).toBeInTheDocument()
    fireEvent.dragLeave(document.body, { dataTransfer: fileTransfer([]) })
    expect(overlay()).not.toBeInTheDocument()
  })

  it('hides the overlay when the drag leaves the window even if a nested leave was missed', () => {
    render(<App />)
    const target = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.dragEnter(document.body, { dataTransfer: fileTransfer([]) })
    fireEvent.dragEnter(target, { dataTransfer: fileTransfer([]) })
    expect(overlay()).toBeInTheDocument()
    // The browser skipped the dragleave of the expression field; the next
    // leave has no related target because the pointer left the window.
    const leaveWindow = createEvent.dragLeave(document.body, { dataTransfer: fileTransfer([]) })
    Object.defineProperty(leaveWindow, 'relatedTarget', { value: null })
    fireEvent(document.body, leaveWindow)
    expect(overlay()).not.toBeInTheDocument()
  })

  it('opens a dropped document exactly as Import would', async () => {
    render(<App />)
    fireEvent.dragEnter(document.body, { dataTransfer: fileTransfer([]) })
    const dropped = fireEvent.drop(document.body, {
      dataTransfer: fileTransfer([documentFile('dropped.gamut.json', droppedDocument())]),
    })
    expect(dropped).toBe(false)
    expect(overlay()).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Dropped = vector(5, 6)'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Like an import, the opened document starts a fresh history.
    expect(screen.getByRole('button', { name: 'Undo document change' })).toBeDisabled()
  })

  it('reports an invalid, a non-JSON, or several dropped files and keeps the document', async () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })

    fireEvent.drop(document.body, { dataTransfer: fileTransfer([documentFile('broken.json', '{"formatVersion":')]) })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^DOCUMENT_/))
    expect(source).toHaveValue('vector(2, 1)')

    fireEvent.drop(document.body, { dataTransfer: fileTransfer([documentFile('notes.txt', droppedDocument(), 'text/plain')]) })
    expect(screen.getByRole('alert')).toHaveTextContent('DOCUMENT_DROP_TYPE: “notes.txt” is not a JSON document.')

    fireEvent.drop(document.body, {
      dataTransfer: fileTransfer([documentFile('a.json', droppedDocument()), documentFile('b.json', droppedDocument())]),
    })
    expect(screen.getByRole('alert')).toHaveTextContent('DOCUMENT_DROP_MULTIPLE: 2 files were dropped.')
    await act(async () => {})
    expect(source).toHaveValue('vector(2, 1)')
  })

  it('leaves drags that carry no file to the page', () => {
    render(<App />)
    const source = screen.getByRole('textbox', { name: 'Expression 1' })
    const text = { types: ['text/plain'], files: [], getData: () => 'e1' }
    expect(fireEvent.dragEnter(source, { dataTransfer: text })).toBe(true)
    expect(fireEvent.dragOver(source, { dataTransfer: text })).toBe(true)
    expect(overlay()).not.toBeInTheDocument()
    expect(fireEvent.drop(source, { dataTransfer: text })).toBe(true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(source).toHaveValue('vector(2, 1)')
    // A file drag whose drop holds no file is ignored without a diagnostic.
    fireEvent.drop(document.body, { dataTransfer: fileTransfer([]) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('point-list connection eligibility outside PGA', () => {
  it('offers no connection for a list of VGA vectors', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'Z = [e1, e2]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (2) menu for Z' }))
    expect(screen.getByRole('switch', { name: 'Visible' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Point list display' })).not.toBeInTheDocument()
    expect(document.querySelector('.point-list-connection')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
  })
})

describe('PGA 2D foundation workflow', () => {
  function selectPga() {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    expect(screen.getByRole('button', { name: 'PGA · 2D. Change algebra' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Every showcase row evaluates; the tests below start from a single blank row.
    expect(screen.queryByText(/^(LANG|ALG)_/)).not.toBeInTheDocument()
    for (const textbox of screen.getAllByRole('textbox', { name: /^Expression \d+$/ }).slice(1)) {
      fireEvent.change(textbox, { target: { value: '' } })
      fireEvent.keyDown(textbox, { key: 'Backspace' })
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: '' } })
  }

  it('reads position and head on a list of ideal points without crashing', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'L = [e01, e02]' } })
    fireEvent.keyDown(first, { key: 'Enter' })
    const second = screen.getByRole('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'P = L.position' } })
    expect(second).toHaveAttribute('aria-invalid', 'false')
    fireEvent.change(second, { target: { value: 'H = L.head' } })
    expect(second).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('button', { name: 'PGA · 2D. Change algebra' })).toBeInTheDocument()
  })

  it('evaluates, classifies, and draws points, lines, and ideal points', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'P = point(1, 2)' } })
    fireEvent.keyDown(first, { key: 'Enter' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), { target: { value: 'L = line(1, -1, 0)' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Expression 2' }), { key: 'Enter' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 3' }), { target: { value: 'D = ipoint(0, 1)' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Expression 3' }), { key: 'Enter' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 4' }), { target: { value: 'I = line(0, 0, 1)' } })

    expect(screen.getByText('Point')).toHaveTextContent('at (1, 2)')
    expect(screen.getByText('Line')).toHaveTextContent('scale 1.41421')
    expect(screen.getByText('Ideal point')).toHaveTextContent('direction (0, 1)')
    expect(screen.getByText('Line at infinity')).toBeInTheDocument()
    expect(screen.getByLabelText('P')).toHaveClass('point-marker')
    expect(screen.getByLabelText('L')).toHaveClass('unbounded-line')
    // An ideal point is an arrow by default, with head and base handles.
    expect(screen.getByLabelText('D')).toHaveClass('vector')
    expect(screen.queryByLabelText('D at infinity')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move head of D' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move base of D' })).toBeInTheDocument()
    expect(screen.getByLabelText('I')).toHaveClass('line-at-infinity')
    expect(screen.getByRole('button', { name: 'Move P' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move head of P' })).not.toBeInTheDocument()
  })

  it('connects a point list as an open polyline or a closed loop', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'P = [point(0, 0), point(1, 0), point(1, 1)]' } })
    const connection = () => document.querySelector('.point-list-connection')
    const segmentCount = () => connection()?.getAttribute('d')?.match(/M/g)?.length ?? 0

    // No connection is the default: markers only.
    fireEvent.click(screen.getByRole('button', { name: 'Open List (3) menu for P' }))
    const display = screen.getByRole('group', { name: 'Point list display' })
    expect(within(display).getByRole('button', { name: 'No connection' })).toHaveAttribute('aria-pressed', 'true')
    expect(connection()).toBeNull()

    fireEvent.click(within(display).getByRole('button', { name: 'Open polyline' }))
    expect(segmentCount()).toBe(2)
    expect(screen.getAllByLabelText(/^P\[\d\]$/)).toHaveLength(3)
    fireEvent.click(within(display).getByRole('button', { name: 'Closed loop' }))
    expect(segmentCount()).toBe(3)
    // The segments take the item's color, like the markers.
    const markerColor = (screen.getByLabelText('P[0]').parentElement as HTMLElement).style.color
    expect((connection() as SVGElement).style.color).toBe(markerColor)

    // Undo and redo traverse the display change.
    const history = screen.getByRole('group', { name: 'Expression history' })
    fireEvent.click(within(history).getByRole('button', { name: 'Undo document change' }))
    expect(segmentCount()).toBe(2)
    fireEvent.click(within(history).getByRole('button', { name: 'Redo document change' }))
    expect(segmentCount()).toBe(3)

    // Hiding the item hides markers and segments together.
    fireEvent.click(screen.getByRole('switch', { name: 'Visible' }))
    expect(connection()).toBeNull()
    expect(screen.queryByLabelText('P[0]')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('lets an automatic label ignore the markers a connected list hides', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'A = point(0, 0)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    // P's first point sits just above and right of A, where A's label goes.
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), {
      target: { value: 'P = [point(0.15, 0.15), point(3, 0), point(3, 3)]' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open Point menu for A' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Point' })).getByRole('switch', { name: 'Show label' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    const label = () => screen.getByText('A', { selector: 'text' })
    // The visible marker pushes the label away from top right.
    expect(label().getAttribute('dominant-baseline') ?? label().getAttribute('text-anchor')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open List (3) menu for P' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open polyline' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show point markers' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    // Hidden, it no longer does: the label returns to top right.
    expect(label()).not.toHaveAttribute('dominant-baseline')
    expect(label()).not.toHaveAttribute('text-anchor')
  })

  it('draws a connected point list as segments alone, keeping its accessible names', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'P = [point(0, 0), point(1, 0), point(1, 1)]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (3) menu for P' }))
    const markers = screen.getByRole('switch', { name: 'Show point markers' })
    // Hiding markers only makes sense once the points are connected.
    expect(markers).toBeChecked()
    expect(markers).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Closed loop' }))
    expect(markers).toBeEnabled()
    fireEvent.click(markers)
    expect(markers).not.toBeChecked()
    expect(screen.queryByLabelText(/^P\[\d\]$/)).not.toBeInTheDocument()
    expect(document.querySelector('.point-list-connection')!.getAttribute('d')!.match(/M/g)).toHaveLength(3)
    // A list has no label: no Label section and no numbered labels (#226).
    expect(screen.queryByRole('switch', { name: 'Show label' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.object-label')).toHaveLength(0)

    // Without a connection, markers return, whatever the stored marker visibility.
    fireEvent.click(screen.getByRole('button', { name: 'No connection' }))
    expect(markers).toBeDisabled()
    expect(markers).toBeChecked()
    expect(screen.getAllByLabelText(/^P\[\d\]$/)).toHaveLength(3)
    expect(document.querySelector('.point-list-connection')).toBeNull()

    // Undo restores the segments-only display.
    const history = screen.getByRole('group', { name: 'Expression history' })
    fireEvent.click(within(history).getByRole('button', { name: 'Undo document change' }))
    expect(screen.queryByLabelText(/^P\[\d\]$/)).not.toBeInTheDocument()
    expect(document.querySelector('.point-list-connection')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('connects points in evaluated order and offers connections only for point lists', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'P = point([0...3], [0, 1, 0, 1])' } })
    fireEvent.keyDown(first, { key: 'Enter' })
    const second = screen.getByRole('textbox', { name: 'Expression 2' })
    fireEvent.change(second, { target: { value: 'Q = P[[3, 0, 0, 2]]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (4) menu for Q' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open polyline' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    // Gathered order, including the repeated point, gives the segment order.
    const marker = (name: string) => {
      const circle = screen.getByLabelText(name)
      return `${circle.getAttribute('cx')} ${circle.getAttribute('cy')}`
    }
    const path = document.querySelector('.point-list-connection')!.getAttribute('d')!
    expect(path).toBe([
      `M ${marker('Q[0]')} L ${marker('Q[1]')}`,
      `M ${marker('Q[1]')} L ${marker('Q[2]')}`,
      `M ${marker('Q[2]')} L ${marker('Q[3]')}`,
    ].join(' '))
    expect(path).not.toMatch(/NaN|Infinity/)

    // Mixed lists, empty lists, and other lists do not offer connected modes.
    for (const source of ['M = [point(0, 0), line(1, 0, 0)]', 'E = []', 'D = [ipoint(1, 0), ipoint(0, 1)]']) {
      fireEvent.change(second, { target: { value: source } })
      const name = source.slice(0, 1)
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Open .* menu for ${name}$`) }))
      expect(screen.queryByRole('group', { name: 'Point list display' })).not.toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
    }
  })

  it('joins finite points to an ideal point with rays in its direction', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'L = [point(-1, 0), e01, point(1, 0)]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (3) menu for L' }))
    const display = screen.getByRole('group', { name: 'Point list display' })
    const marker = (name: string) => {
      const circle = screen.getByLabelText(name)
      return { x: circle.getAttribute('cx'), y: circle.getAttribute('cy') }
    }
    const links = () => document.querySelector('.point-list-connection')!.getAttribute('d')!
      .split('M').slice(1).map((link) => link.trim().split(/\s+/))

    // Open polyline: the vertical rays from L[0] and L[2] towards e01, upwards.
    fireEvent.click(within(display).getByRole('button', { name: 'Open polyline' }))
    const [a, b] = [marker('L[0]'), marker('L[2]')]
    const rays = links()
    expect(rays).toHaveLength(2)
    for (const [ray, origin] of [[rays[0], a], [rays[1], b]] as const) {
      expect(ray.slice(0, 2)).toEqual([origin.x, origin.y])
      expect(ray[3]).toBe(origin.x)
      expect(Number(ray[4])).toBeLessThan(Number(origin.y))
    }
    // Closed loop adds the segment from L[2] back to L[0].
    fireEvent.click(within(display).getByRole('button', { name: 'Closed loop' }))
    expect(links()).toHaveLength(3)
    expect(links()[2]).toEqual([b.x, b.y, 'L', a.x, a.y])
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('moves the links with a referenced point, list elements having no handle', () => {
    selectPga()
    const rows = ['A = point(0, 0)', 'B = point(1, 0)', 'L = [A, B]']
    rows.forEach((source, index) => {
      const row = screen.getByRole('textbox', { name: `Expression ${index + 1}` })
      fireEvent.change(row, { target: { value: source } })
      if (index < rows.length - 1) fireEvent.keyDown(row, { key: 'Enter' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (2) menu for L' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open polyline' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    const path = () => document.querySelector('.point-list-connection')!.getAttribute('d')
    const marker = (name: string) => {
      const circle = screen.getByLabelText(name)
      return `${circle.getAttribute('cx')} ${circle.getAttribute('cy')}`
    }
    const before = path()
    expect(before).toBe(`M ${marker('L[0]')} L ${marker('L[1]')}`)
    expect(screen.queryByRole('button', { name: /^Move L\[/ })).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move B' }), { key: 'ArrowRight', shiftKey: true })
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('B = point(2, 0)')
    expect(path()).not.toBe(before)
    expect(path()).toBe(`M ${marker('L[0]')} L ${marker('L[1]')}`)
  })

  it('drops and restores a stored connection as the list leaves and regains eligibility', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    const points = 'P = [point(0, 0), point(1, 0), point(1, 1)]'
    fireEvent.change(first, { target: { value: points } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (3) menu for P' }))
    fireEvent.click(screen.getByRole('button', { name: 'Closed loop' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show point markers' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText(/^P\[\d\]$/)).not.toBeInTheDocument()

    // A mixed list neither connects nor hides its markers, whatever is stored.
    fireEvent.change(first, { target: { value: 'P = [point(0, 0), line(1, 0, 0)]' } })
    expect(document.querySelector('.point-list-connection')).toBeNull()
    expect(screen.getByLabelText('P[0]')).toHaveClass('point-marker')
    expect(screen.getByLabelText('P[1]')).toHaveClass('unbounded-line')

    // Back to points only: the stored closed loop without markers returns.
    fireEvent.change(first, { target: { value: points } })
    expect(document.querySelector('.point-list-connection')!.getAttribute('d')!.match(/M/g)).toHaveLength(3)
    expect(screen.queryByLabelText(/^P\[\d\]$/)).not.toBeInTheDocument()
  })

  it('hides the ideal points of a connected list along with its markers', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'L = [point(-1, 0), e01, point(1, 0)]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (3) menu for L' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open polyline' }))
    expect(screen.getByLabelText('L[1]')).toHaveClass('vector')

    fireEvent.click(screen.getByRole('switch', { name: 'Show point markers' }))
    expect(screen.queryByLabelText(/^L\[\d\]$/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('L[1] at infinity')).not.toBeInTheDocument()
    expect(document.querySelector('.point-list-connection')!.getAttribute('d')!.match(/M/g)).toHaveLength(2)

    // Without a connection, the ideal point is drawn again.
    fireEvent.click(screen.getByRole('button', { name: 'No connection' }))
    expect(screen.getByLabelText('L[1]')).toHaveClass('vector')
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('hides the lines of a list from its Lines section, keeping element indices', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'M = [line(1, 0, 0), point(0, 0), line(0, 1, 0)]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (3) menu for M' }))
    expect(screen.getByRole('dialog', { name: 'List' })).toBeInTheDocument()
    expect(screen.getByLabelText('M[0]')).toHaveClass('unbounded-line')
    const lines = screen.getByRole('switch', { name: 'Show lines' })
    expect(lines).toBeChecked()

    fireEvent.click(lines)
    expect(lines).not.toBeChecked()
    expect(screen.queryByLabelText('M[0]')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('M[2]')).not.toBeInTheDocument()
    expect(screen.getByLabelText('M[1]')).toHaveClass('point-marker')

    const history = screen.getByRole('group', { name: 'Expression history' })
    fireEvent.click(within(history).getByRole('button', { name: 'Undo document change' }))
    expect(screen.getByLabelText('M[2]')).toHaveClass('unbounded-line')
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('offers no Lines section for a list without lines', () => {
    selectPga()
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'P = [point(0, 0), point(1, 0)]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (2) menu for P' }))
    expect(screen.queryByRole('switch', { name: 'Show lines' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Show point markers' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('offers no connection for a single point', () => {
    selectPga()
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'P = point(1, 2)' } })
    fireEvent.click(screen.getByRole('button', { name: /^Open .* menu for P$/ }))
    expect(screen.queryByRole('group', { name: 'Point list display' })).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('connects only the rendered prefix of a truncated point list', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'P = point([0...1199], 0)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (1200) menu for P' }))
    fireEvent.click(screen.getByRole('button', { name: 'Closed loop' }))
    expect(document.querySelector('.point-list-connection')!.getAttribute('d')!.match(/M/g)).toHaveLength(1_000)
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('draws no connection for a singleton point list', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'S = [point(1, 1)]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open List (1) menu for S' }))
    fireEvent.click(screen.getByRole('button', { name: 'Closed loop' }))
    expect(document.querySelector('.point-list-connection')).toBeNull()
    expect(screen.getByLabelText('S[0]')).toHaveClass('point-marker')
    // Two points close to a single visible segment.
    fireEvent.change(first, { target: { value: 'S = [point(1, 1), point(2, 1)]' } })
    expect(document.querySelector('.point-list-connection')!.getAttribute('d')!.match(/M/g)).toHaveLength(1)
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('positions an ideal point, drags its head and base, and switches its display', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'D = ipoint(1, 0)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    // Head drag rewrites the ipoint literal relative to the base at the origin.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move head of D' }), { button: 0, pointerId: 31 })
    fireEvent.pointerMove(canvas, { pointerId: 31, clientX: 464, clientY: 96 })
    fireEvent.pointerUp(canvas, { pointerId: 31 })
    expect(first).toHaveValue('D = ipoint(2, 2)')
    expect(screen.getByText('Ideal point')).toHaveTextContent('direction (2, 2)')

    // Base drag writes a position in the interpretation's syntax; the head follows.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move base of D' }), { button: 0, pointerId: 32 })
    fireEvent.pointerMove(canvas, { pointerId: 32, clientX: 392, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 32 })
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('point(1, 1)')
    expect(first).toHaveValue('D = ipoint(2, 2)')
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'D = ipoint(2, 2)' } })
    fireEvent.keyDown(first, { key: 'Enter' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), { target: { value: 'H = D.head' } })
    expect(screen.getAllByText('Point')[0]).toHaveTextContent('at (3, 3)')

    // Display modes: arrow by default, marker at infinity, or both.
    fireEvent.click(screen.getByRole('button', { name: 'Open Ideal point menu for D' }))
    fireEvent.click(screen.getByRole('button', { name: 'At infinity' }))
    expect(screen.queryByLabelText('D')).not.toBeInTheDocument()
    expect(screen.getByLabelText('D at infinity')).toHaveClass('direction-marker')
    expect(screen.queryByRole('button', { name: 'Move head of D' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Both' }))
    expect(screen.getByLabelText('D')).toHaveClass('vector')
    expect(screen.getByLabelText('D at infinity')).toHaveClass('direction-marker')
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('rotates a line about its translated anchor after dragging it', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'L = line(1, 1, 0)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    // Press at (1, -1), on the line, and drag one unit to the right: the anchor follows to (2, -1).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move L' }), { button: 0, pointerId: 43, clientX: 392, clientY: 312 })
    fireEvent.pointerMove(canvas, { pointerId: 43, clientX: 464, clientY: 312 })
    fireEvent.pointerUp(canvas, { pointerId: 43 })
    expect(first).toHaveValue('L = line(1, 1, -1)')
    // Rotating now pivots about (2, -1): the line does not snap back through (1, -1).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Rotate L' }), { button: 0, pointerId: 44 })
    fireEvent.pointerMove(canvas, { pointerId: 44, clientX: 536, clientY: 312 })
    fireEvent.pointerUp(canvas, { pointerId: 44 })
    const [a, b, c] = /^L = line\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)$/.exec((first as HTMLInputElement).value)!.slice(1).map(Number)
    expect(a).toBeCloseTo(Math.SQRT2, 3)
    expect(b).toBeCloseTo(0, 3)
    expect(a * 2 + b * -1 + c).toBeCloseTo(0, 3)
    // The helper is drawn dashed and hollow, unlike a vector.
    expect(document.querySelector('.line-normal-shaft')?.getAttribute('stroke-dasharray')).not.toBeNull()
    expect(document.querySelector('.line-normal-head')).not.toBeNull()
  })

  it('keeps a rotated line through its anchor far from the origin at a coarse zoom', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'L = line(-0.6, 0.8, -30000)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    // Zoom far out: about 0.0089 pixels per unit, so one pixel spans 112 units.
    fireEvent.wheel(canvas, { deltaY: 6000, clientX: 320, clientY: 240 })
    const pixelsPerUnit = 72 * Math.exp(-6000 * 0.0015)
    const pressed = { x: (160 - 320) / pixelsPerUnit, y: (240 - 27) / pixelsPerUnit }
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move L' }), { button: 0, pointerId: 45, clientX: 160, clientY: 27 })
    fireEvent.pointerUp(canvas, { pointerId: 45 })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Rotate L' }), { button: 0, pointerId: 46 })
    fireEvent.pointerMove(canvas, { pointerId: 46, clientX: 232, clientY: -9 })
    fireEvent.pointerUp(canvas, { pointerId: 46 })
    const [a, b, c] = /^L = line\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)$/.exec((first as HTMLInputElement).value)!.slice(1).map(Number)
    // The norm survives the rounding, and the line still passes within a pixel of the press.
    expect(Math.hypot(a, b)).toBeCloseTo(1, 3)
    expect(a).toBeCloseTo(2 / Math.sqrt(5), 2)
    expect(b).toBeCloseTo(1 / Math.sqrt(5), 2)
    expect(Math.abs(a * pressed.x + b * pressed.y + c) * pixelsPerUnit).toBeLessThan(1)
  })

  it('translates a literal line by dragging it and rotates it about the pressed anchor', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'L = line(1, 1, 0)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    const body = screen.getByRole('button', { name: 'Move L' })
    // A new line starts without its orientation (#221).
    expect(document.querySelector('.line-orientation')).toBeNull()
    expect(document.querySelector('.unbounded-line-halo')).toBeNull()

    // Hover shows the translucent double border.
    fireEvent.pointerEnter(body)
    expect(document.querySelector('.unbounded-line-halo')).not.toBeNull()
    fireEvent.pointerLeave(body)

    // Dragging translates: only c changes; the press selects the line.
    fireEvent.pointerDown(body, { button: 0, pointerId: 41, clientX: 392, clientY: 312 })
    fireEvent.pointerMove(canvas, { pointerId: 41, clientX: 464, clientY: 312 })
    fireEvent.pointerUp(canvas, { pointerId: 41 })
    expect(first).toHaveValue('L = line(1, 1, -1)')
    const normal = screen.getByRole('button', { name: 'Rotate L' })
    expect(normal).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(first).toHaveValue('L = line(1, 1, 0)')

    // Rotating the unit normal keeps the norm of (a, b) and the anchor on the
    // line: the anchor followed the drag to (2, -1) and, after the undo, is
    // projected back onto x + y = 0 at (1.5, -1.5).
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Rotate L' }), { button: 0, pointerId: 42 })
    fireEvent.pointerMove(canvas, { pointerId: 42, clientX: 536, clientY: 348 })
    fireEvent.pointerUp(canvas, { pointerId: 42 })
    const match = /^L = line\(([-\d.]+), ([-\d.]+), ([-\d.]+)\)$/.exec((first as HTMLInputElement).value)
    expect(match).not.toBeNull()
    const [a, b, c] = match!.slice(1).map(Number)
    // The pointer sits to the right of the anchor: the normal becomes (√2, 0).
    expect(a).toBeCloseTo(Math.SQRT2, 3)
    expect(b).toBeCloseTo(0, 3)
    expect(a * 1.5 + b * -1.5 + c).toBeCloseTo(0, 3)

    // Escape drops the selection; Enter on the focused line shows it again.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Rotate L' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move L' }), { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Rotate L' })).toBeInTheDocument()

    // Keyboard: arrows translate the focused line.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move L' }), { key: 'ArrowRight', shiftKey: true })
    expect(/^L = line\([-\d.]+, [-\d.]+, [-\d.]+\)$/.test((first as HTMLInputElement).value)).toBe(true)

    // The orientation switch shows the ticks; a non-literal line has no handles.
    fireEvent.click(screen.getByRole('button', { name: 'Open Line menu for L' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Orientation visible' }))
    expect(document.querySelector('.line-orientation')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(first, { target: { value: 'L = 2 * line(1, 1, 0)' } })
    expect(screen.queryByRole('button', { name: 'Move L' })).not.toBeInTheDocument()
  })

  it('names and describes the viewport after the PGA visualizer', () => {
    selectPga()
    expect(screen.getByRole('region', { name: 'PGA 2D viewport' })).toBeInTheDocument()
    const canvas = screen.getByRole('img', { name: 'Two-dimensional PGA viewport' })
    const description = canvas.querySelector('desc')
    expect(screen.queryByRole('img', { name: /VGA/ })).not.toBeInTheDocument()
    expect(description).toHaveTextContent(
      'No spatial objects are visible from 1 expressions. Double-click empty viewport space to create a point.',
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'P = point(1, 2)' },
    })
    expect(description).toHaveTextContent(
      /^1 point, 0 lines, 0 ideal points, and 0 lines at infinity are visible\. .*P is a point at 1, 2\. Double-click empty viewport space to create a point\.$/,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'L = line(1, 0, -1)' },
    })
    expect(description).toHaveTextContent(/0 points, 1 line, .* L is a line through 1, 0 with direction 0, -?1\./)

    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), {
      target: { value: 'I = ipoint(1, 0)' },
    })
    expect(description).toHaveTextContent(/1 ideal point, .* I is an ideal point in direction 1, 0 with magnitude 1\./)
  })

  it('drags a literal point as one undoable source rewrite and creates points by double-click', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'P = point(1, 2)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)

    const handle = screen.getByRole('button', { name: 'Move P' })
    fireEvent.pointerDown(handle, { button: 0, pointerId: 21 })
    fireEvent.pointerMove(canvas, { pointerId: 21, clientX: 536, clientY: 96 })
    fireEvent.pointerMove(canvas, { pointerId: 21, clientX: 464, clientY: 168 })
    fireEvent.pointerUp(canvas, { pointerId: 21 })
    expect(first).toHaveValue('P = point(2, 1)')
    expect(screen.getByText('Object manipulation committed.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(first).toHaveValue('P = point(1, 2)')

    fireEvent.keyDown(screen.getByRole('button', { name: 'Move P' }), { key: 'ArrowRight', shiftKey: true })
    expect(first).toHaveValue('P = point(2, 2)')

    fireEvent.doubleClick(canvas, { clientX: 392, clientY: 168 })
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('A = point(1, 1)')
    expect(screen.getByText('A created at 1, 1.')).toBeInTheDocument()
  })

  it('writes created, dragged, and rotated coordinates at the visible screen resolution', () => {
    selectPga()
    const first = screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(first, { target: { value: 'P = point(1, 2)' } })
    const canvas = viewportCanvas()
    sizeViewportCanvas(canvas)
    // 220% is 158.4 px per unit: about four units across the 640 px canvas,
    // where the screen resolves two decimals.
    const zoom = screen.getByRole('textbox', { name: 'Zoom level' })
    fireEvent.change(zoom, { target: { value: '220' } })
    fireEvent.keyDown(zoom, { key: 'Enter' })
    const pixelsPerUnit = 158.4
    const screenPoint = (x: number, y: number) => ({ clientX: 320 + x * pixelsPerUnit, clientY: 240 - y * pixelsPerUnit })

    fireEvent.doubleClick(canvas, screenPoint(-0.95531, -0.86449))
    expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('A = point(-0.96, -0.86)')
    expect(screen.getByText('A created at -0.96, -0.86.')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move P' }), { button: 0, pointerId: 31 })
    fireEvent.pointerMove(canvas, { pointerId: 31, ...screenPoint(0.50694, 0.87942) })
    fireEvent.pointerUp(canvas, { pointerId: 31 })
    expect(first).toHaveValue('P = point(0.51, 0.88)')

    // Line coefficients keep a ten times finer step, so rotation stays smooth.
    fireEvent.change(first, { target: { value: 'L = line(1, 0, 0)' } })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Move L' }), { button: 0, pointerId: 32, ...screenPoint(0, 0) })
    fireEvent.pointerUp(canvas, { pointerId: 32 })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Rotate L' }), { button: 0, pointerId: 33 })
    fireEvent.pointerMove(canvas, { pointerId: 33, ...screenPoint(Math.cos(0.3), Math.sin(0.3)) })
    fireEvent.pointerUp(canvas, { pointerId: 33 })
    expect(first).toHaveValue('L = line(0.955, 0.296, 0)')
  })
})

describe('stroke width and opacity from the appearance menu (#221)', () => {
  it('draws a width that follows a scalar, and falls back to the default with a red line', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'V = vector(2, 1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), { target: { value: 'w = 2' } })
    const shaft = () => document.querySelector('line.vector[aria-label="V"]') as SVGLineElement
    expect(shaft()).not.toHaveAttribute('style')

    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for V' }))
    const dialog = screen.getByRole('dialog', { name: 'Vector' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dashed' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Width' }), { target: { value: 'w' } })
    // 2 reference pixels at object scale 1 (render scale 1.5); dashes follow the width.
    expect(shaft().style.strokeWidth).toBe('3')
    expect(shaft().style.strokeDasharray).toBe('12 9')
    expect(dialog.querySelector('.appearance-error')).toBeNull()

    // The width follows the scalar, as it would while a slider animates.
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), { target: { value: 'w = 4' } })
    expect(shaft().style.strokeWidth).toBe('6')

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Width' }), { target: { value: 'zz' } })
    expect(shaft().style.strokeWidth).toBe('')
    expect(within(dialog).getByRole('textbox', { name: 'Width' })).toHaveAttribute('aria-invalid', 'true')
    expect(dialog.querySelector('.appearance-error')).toHaveTextContent('Width: The name “zz” is not defined. Default used.')

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Opacity' }), { target: { value: '25' } })
    // Opacity fades the drawn marks only; handles stay fully visible.
    expect(shaft().parentElement).toHaveAttribute('opacity', '0.25')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Opacity' }), { target: { value: '' } })
    expect(shaft().parentElement).not.toHaveAttribute('opacity')
  })
})

describe('point style and size from the appearance menu (#222)', () => {
  it('draws the chosen style and size, the outer shape following the core', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    for (const textbox of screen.getAllByRole('textbox', { name: /^Expression \d+$/ }).slice(1)) {
      fireEvent.change(textbox, { target: { value: '' } })
      fireEvent.keyDown(textbox, { key: 'Backspace' })
    }
    expect(screen.getAllByRole('textbox', { name: /^Expression \d+$/ })).toHaveLength(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'A = point(1, 1)' } })
    expect(document.querySelector('circle.manipulation-base-point')).toHaveAttribute('r', '6.75')

    fireEvent.click(screen.getByRole('button', { name: 'Open Point menu for A' }))
    const dialog = screen.getByRole('dialog', { name: 'Point' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Square' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Size' }), { target: { value: '6' } })
    expect(document.querySelector('rect.manipulation-base-point')).toHaveAttribute('width', '18')
    expect(Number(document.querySelector('rect.point-outer')!.getAttribute('width'))).toBeCloseTo(40)

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Size' }), { target: { value: '40' } })
    expect(document.querySelector('rect.manipulation-base-point')).toHaveAttribute('width', '13.5')
    expect(dialog.querySelector('.appearance-error')).toHaveTextContent('Size: 40 is outside 1 to 20. Default used.')
  })
})

describe('labels edited under the expression and placed from the menu (#226)', () => {
  it('edits the text under the expression and places the label from the menu', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'V = vector(2, 1)' } })
    expect(screen.queryByRole('textbox', { name: 'Label of expression 1' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for V' }))
    const dialog = screen.getByRole('dialog', { name: 'Vector' })
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Show label' }))

    const field = screen.getByRole('textbox', { name: 'Label of expression 1' })
    expect(field).toHaveAttribute('placeholder', 'V')
    // Under the expression, inside its row.
    expect(screen.getByRole('textbox', { name: 'Expression 1' }).closest('article')).toContainElement(field)
    const text = () => screen.getByText(/^(V|Velocity)$/, { selector: 'text' })
    const tip = document.querySelector('line.vector[aria-label="V"]')!
    expect(text()).not.toHaveAttribute('text-anchor')
    expect(Number(text().getAttribute('y'))).toBeLessThan(Number(tip.getAttribute('y2')))

    fireEvent.change(field, { target: { value: 'Velocity' } })
    expect(text()).toHaveTextContent('Velocity')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Bottom left' }))
    expect(text()).toHaveAttribute('text-anchor', 'end')
    expect(text()).toHaveAttribute('dominant-baseline', 'hanging')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Angle' }), { target: { value: '30' } })
    expect(text().getAttribute('transform')).toMatch(/^rotate\(-30 /)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Size' }), { target: { value: '20' } })
    expect(text().style.fontSize).toBe('20px')
  })

  it('moves an automatic label away from another point', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'V = vector(2, 1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    // W's base handle sits just above and right of V's head.
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), { target: { value: 'W = vector(1, 1)' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 2' }), { target: { value: '(2.15, 1.15)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open Vector menu for V' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Vector' })).getByRole('switch', { name: 'Show label' }))
    // Top right would cover W's base, so the label takes a later position.
    const label = screen.getByText('V', { selector: 'text' })
    expect(label.getAttribute('dominant-baseline') ?? label.getAttribute('text-anchor')).not.toBeNull()
  })
})

describe('documents whose positions are turned off', () => {
  function openWithPositionsOff(positionSource = '(1, 1)') {
    const document = expressionDocument([
      { id: 'v', source: 'V = vector(2, 1)', ...(positionSource ? { positionSource } : {}) },
    ], {}, { id: 'positions-off' })
    const stored = toCanonicalDocument({ ...document, view: { ...document.view, positionEnabled: false } }, 'light')
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(stored))
    vi.stubEnv('MODE', 'development')
    render(<App />)
  }
  const base = () => {
    const line = document.querySelector('line.vector[aria-label="V"]')!
    return [line.getAttribute('x1'), line.getAttribute('y1')]
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    window.localStorage.clear()
  })

  it('applies the stored positions, since a canvas is shown', () => {
    openWithPositionsOff('')
    const origin = base()
    cleanup()
    openWithPositionsOff()
    expect(base()).not.toEqual(origin)
    expect(screen.queryByText(/Positions are turned off/)).not.toBeInTheDocument()
  })

  it('moves the object when its position is edited', () => {
    openWithPositionsOff()
    const before = base()
    fireEvent.change(screen.getByRole('textbox', { name: 'Position 1' }), { target: { value: '(2, 2)' } })
    expect(base()).not.toEqual(before)
  })
})

describe('normalization chosen from the expression row (#185)', () => {
  it('closes the normalization popover and the library menu on a press on the canvas', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    // The canvas prevents the default of its pointerdown, so no mousedown follows.
    const pressCanvas = () => fireEvent.pointerDown(viewportCanvas(), { button: 0, pointerId: 1, clientX: 400, clientY: 300 })

    fireEvent.click(screen.getAllByRole('button', { name: 'Normalization: off' })[0])
    expect(screen.getByRole('dialog', { name: 'Normalize' })).toBeInTheDocument()
    pressCanvas()
    expect(screen.queryByRole('dialog', { name: 'Normalize' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('dialog', { name: 'Library' })).toBeInTheDocument()
    pressCanvas()
    expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument()
  })

  it('opens the choice in a popover that closes on Escape, a click outside, or its close button', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    const toggle = screen.getAllByRole('button', { name: 'Normalization: off' })[0]
    expect(toggle).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(toggle)
    const popover = () => screen.queryByRole('dialog', { name: 'Normalize' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // Rendered over the page like the appearance menu, not inside the row.
    expect(popover()!.parentElement).toBe(document.body)
    expect(popover()!.closest('article')).toBeNull()
    expect(within(popover()!).getByRole('button', { name: 'off' })).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(popover()).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()

    fireEvent.click(toggle)
    fireEvent.pointerDown(within(popover()!).getByRole('group', { name: 'Normalize with' }))
    expect(popover()).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(popover()).not.toBeInTheDocument()

    fireEvent.click(toggle)
    fireEvent.click(within(popover()!).getByRole('button', { name: 'Close Normalize menu' }))
    expect(popover()).not.toBeInTheDocument()
  })

  it('reads a forced mode stored in a VGA document as auto', () => {
    const stored = toCanonicalDocument(expressionDocument([
      { id: 'v', source: 'V = vector(3, 4)', normalization: 'ideal' },
    ], {}, { id: 'imported-vga' }), 'light')
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(stored))
    vi.stubEnv('MODE', 'development')
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'Normalization: auto' })
    expect(toggle).toHaveAttribute('title', 'Normalized by the Euclidean norm (automatic)')
    expect(screen.getByText('0.6e1 + 0.8e2', { selector: 'output' })).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // The button switches it off directly, with no menu.
    fireEvent.click(toggle)
    expect(screen.queryByRole('dialog', { name: 'Normalize' })).not.toBeInTheDocument()
    expect(toggle).toHaveAccessibleName('Normalization: off')
    vi.unstubAllEnvs()
    window.localStorage.clear()
  })

  it('offers off, auto, norm and inorm in PGA, and shows the applied mode and unit badge', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'VGA · 2D. Change algebra' }))
    fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[1])
    for (const textbox of screen.getAllByRole('textbox', { name: /^Expression \d+$/ }).slice(1)) {
      fireEvent.change(textbox, { target: { value: '' } })
      fireEvent.keyDown(textbox, { key: 'Backspace' })
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'I = ipoint(3, 4)' } })
    const toggle = screen.getByRole('button', { name: 'Normalization: off' })
    expect(toggle).toHaveTextContent(/^norm$/)
    expect(toggle).not.toHaveClass('active')

    const choose = (mode: string) => {
      fireEvent.click(toggle)
      const choice = screen.getByRole('group', { name: 'Normalize with' })
      expect(within(choice).getAllByRole('button').map((button) => button.textContent)).toEqual(['off', 'auto', 'norm', 'inorm'])
      fireEvent.click(within(choice).getByRole('button', { name: mode }))
      expect(screen.queryByRole('group', { name: 'Normalize with' })).not.toBeInTheDocument()
    }

    // Auto divides an ideal point by inorm, and the badge follows that norm.
    choose('auto')
    expect(toggle).toHaveAccessibleName('Normalization: auto')
    expect(toggle).toHaveClass('active')
    expect(toggle).toHaveAttribute('title', 'Normalized by the ideal norm (automatic)')
    expect(screen.getByText('Unit ideal norm')).toBeInTheDocument()
    expect(screen.getByText('0.8e01 - 0.6e02', { selector: 'output' })).toBeInTheDocument()

    choose('inorm')
    expect(toggle).toHaveAccessibleName('Normalization: inorm')
    expect(toggle).toHaveTextContent(/^inorm$/)
    expect(screen.getByText('Unit ideal norm')).toBeInTheDocument()

    // An ideal point has no Euclidean norm: the value stays unchanged.
    choose('norm')
    expect(toggle).toHaveTextContent(/^norm$/)
    expect(screen.getByText('Normalization unavailable')).toBeInTheDocument()
    expect(screen.getByText(/zero Euclidean norm/)).toBeInTheDocument()
    expect(screen.queryByText('Unit ideal norm')).not.toBeInTheDocument()
    expect(screen.getByText('4e01 - 3e02', { selector: 'output' })).toBeInTheDocument()
  })
})

describe('collapsing the expression panel (#234)', () => {
  const panel = () => document.getElementById('expression-panel') as HTMLElement

  it('collapses to the left, moves focus, and expands back', () => {
    render(<App />)
    const collapse = screen.getByRole('button', { name: 'Collapse expression panel' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAttribute('aria-controls', 'expression-panel')

    fireEvent.click(collapse)
    expect(panel()).toHaveClass('is-collapsed')
    expect(panel()).toHaveAttribute('inert')
    expect(screen.queryByRole('separator', { name: 'Resize expression panel' })).not.toBeInTheDocument()
    const expand = screen.getByRole('button', { name: 'Expand expression panel' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(expand).toHaveFocus()
    // The canvas keeps running: it is still there and takes the freed room.
    expect(viewportCanvas()).toBeInTheDocument()

    fireEvent.click(expand)
    expect(panel()).not.toHaveClass('is-collapsed')
    expect(panel()).not.toHaveAttribute('inert')
    expect(screen.getByRole('separator', { name: 'Resize expression panel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand expression panel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse expression panel' })).toHaveFocus()
  })

  it('remembers the collapsed panel locally, outside the document and its history', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse expression panel' }))
    expect(window.localStorage.getItem('gamut.expressionPanelCollapsed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Undo document change' })).toBeDisabled()
    first.unmount()

    render(<App />)
    expect(panel()).toHaveClass('is-collapsed')
    fireEvent.click(screen.getByRole('button', { name: 'Expand expression panel' }))
    expect(window.localStorage.getItem('gamut.expressionPanelCollapsed')).toBe('false')
  })

  it('reopens a collapsed panel and keeps the focus when a document without a canvas opens', async () => {
    const documentFile = (contents: string) => {
      const bytes = new TextEncoder().encode(contents)
      return { name: 'opened.gamut.json', type: 'application/json', arrayBuffer: async () => bytes.slice().buffer } as unknown as File
    }
    const canonical = (id: string, source: string) => toCanonicalDocument(expressionDocument(
      [{ id: 'v', source }], {}, { id },
    ), 'light')
    const withoutCanvas = canonical('no-canvas', 'Calc = vector(5, 6)')
    const drop = (contents: object) => fireEvent.drop(document.body, {
      dataTransfer: { types: ['Files'], files: [documentFile(JSON.stringify(contents))], dropEffect: 'none' },
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse expression panel' }))
    expect(screen.getByRole('button', { name: 'Expand expression panel' })).toHaveFocus()

    drop({ ...withoutCanvas, view: { ...withoutCanvas.view, visualizerId: null, positionEnabled: false, viewport: { kind: 'none' } } })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Calc = vector(5, 6)'))
    expect(panel()).not.toHaveClass('is-collapsed')
    expect(panel()).not.toHaveAttribute('inert')
    // The focused expand button went away with the canvas; focus lands on
    // the button that brings the canvas back (#55).
    expect(screen.getByRole('button', { name: 'Show canvas' })).toHaveFocus()
    expect(window.localStorage.getItem('gamut.expressionPanelCollapsed')).toBe('false')

    // A document with a canvas afterwards does not collapse the panel again.
    drop(canonical('with-canvas', 'Drawn = vector(1, 2)'))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Drawn = vector(1, 2)'))
    expect(viewportCanvas()).toBeInTheDocument()
    expect(panel()).not.toHaveClass('is-collapsed')
    expect(screen.getByRole('button', { name: 'Collapse expression panel' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps the panel collapsible when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<App />)
    expect(panel()).not.toHaveClass('is-collapsed')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse expression panel' }))
    expect(panel()).toHaveClass('is-collapsed')
  })
})

describe('NoViz calculator mode (#55)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    window.localStorage.clear()
  })
  const storedView = () => JSON.parse(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!).view
  const canvas = () => screen.queryByRole('img', { name: /Two-dimensional [VP]GA viewport/ })

  it('shows a hidden expression like the others, and hides it again with the canvas', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'V1 = vector(2, 1)' } })
    const row = () => screen.getByRole('textbox', { name: 'Expression 1' }).closest('.expression-item')!
    fireEvent.click(screen.getByRole('button', { name: 'Hide V1' }))
    expect(row()).toHaveClass('is-hidden')

    // Nothing is drawn in NoViz, so visibility does not apply there.
    fireEvent.click(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' }))
    expect(row()).not.toHaveClass('is-hidden')

    // The setting is kept and applies again with the canvas.
    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(row()).toHaveClass('is-hidden')
    expect(screen.getByRole('button', { name: 'Show V1' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('collapses the canvas into a full-width calculator and brings it back', () => {
    vi.stubEnv('MODE', 'development')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const zoom = (screen.getByRole('textbox', { name: 'Zoom level' }) as HTMLInputElement).value
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' }))

    // Nothing is rendered; the panel takes the whole width and says so.
    expect(canvas()).not.toBeInTheDocument()
    expect(document.querySelector('svg.canvas')).not.toBeInTheDocument()
    expect(screen.getByText('NoViz calculator')).toBeInTheDocument()
    expect(document.getElementById('expression-panel')).toHaveClass('is-full-width')
    expect(screen.queryByRole('separator', { name: 'Resize expression panel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse expression panel' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show canvas' })).toHaveFocus()
    // Render-only fields and settings are gone; evaluation goes on.
    expect(screen.queryByRole('textbox', { name: 'Position 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Hide|Show) V1$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Open .* menu for V1/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('0.66e1 + 3.042e2').length).toBeGreaterThan(0)
    openSettings()
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(settings).queryByRole('switch', { name: 'Grid' })).not.toBeInTheDocument()
    expect(within(settings).queryByRole('slider', { name: 'Object scale' })).not.toBeInTheDocument()
    expect(within(settings).getByRole('spinbutton', { name: 'Decimal places' })).toBeInTheDocument()
    fireEvent.keyDown(settings, { key: 'Escape' })

    // NoViz is document state: saved with no visualizer and positions off.
    expect(storedView()).toMatchObject({ visualizerId: null, positionEnabled: false, viewport: { kind: 'none' } })
    expect(screen.getByRole('button', { name: 'Undo document change' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(canvas()).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Zoom level' })).toHaveValue(zoom)
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' })).toHaveFocus()
    expect(storedView()).toMatchObject({
      visualizerId: 'org.multivector.vga-2d', positionEnabled: true, viewport: { kind: 'two-dimensional' },
    })
  })

  it('opens a stored NoViz document as a calculator and shows the canvas at the default view', () => {
    const stored = toCanonicalDocument(expressionDocument([
      { id: 'v', source: 'V = vector(2, 1)', positionSource: '(1, 1)' },
    ], {}, { id: 'noviz' }), 'light')
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument({
      ...stored,
      view: { ...stored.view, visualizerId: null, positionEnabled: false, viewport: { kind: 'none' } },
    }))
    vi.stubEnv('MODE', 'development')
    render(<App />)
    expect(canvas()).not.toBeInTheDocument()
    expect(screen.queryByText(/DOCUMENT_VIEW_UNSUPPORTED/)).not.toBeInTheDocument()
    expect(screen.getByText('NoViz calculator')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(canvas()).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Zoom level' })).toHaveValue('100%')
    // Positions apply again: the vector starts at (1, 1), not at the origin.
    expect(screen.getByRole('textbox', { name: 'Position 1' })).toHaveValue('(1, 1)')
    expect(storedView()).toMatchObject({ positionEnabled: true })
  })

  it('opens with the whole panel when the expression panel was collapsed', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse expression panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' }))
    expect(document.getElementById('expression-panel')).not.toHaveClass('is-collapsed')
    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(document.getElementById('expression-panel')).not.toHaveClass('is-collapsed')
  })

  it.each([
    ['no visualizer but a two-dimensional viewport', { visualizerId: null, viewport: { kind: 'two-dimensional', centerX: 1, centerY: 2, zoom: 144 } }, {}],
    ['a visualizer but no viewport', { viewport: { kind: 'none' } }, {}],
    ['an unknown visualizer', { visualizerId: 'org.example.unknown-2d' }, {}],
    ['an unavailable interpretation', {}, { interpretation: { interpretationId: 'org.example.unknown', interpretationVersion: 1 } }],
  ])('offers Show canvas for a stored document with %s', (_case, view, document) => {
    const stored = toCanonicalDocument(expressionDocument([
      { id: 'v', source: 'V = vector(2, 1)' },
    ], {}, { id: 'undisplayable' }), 'light')
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument({
      ...stored, ...document, view: { ...stored.view, ...view } as typeof stored.view,
    }))
    vi.stubEnv('MODE', 'development')
    render(<App />)
    expect(canvas()).not.toBeInTheDocument()
    expect(screen.getByText('NoViz calculator')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(canvas()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' })).toHaveFocus()
    expect(screen.queryByText(/INT_UNKNOWN_INTERPRETATION/)).not.toBeInTheDocument()
    expect(storedView()).toMatchObject({
      visualizerId: 'org.multivector.vga-2d', positionEnabled: true, viewport: { kind: 'two-dimensional' },
    })
  })

  it('keeps the stored centre and zoom of a document that only lacks its visualizer', () => {
    const stored = toCanonicalDocument(expressionDocument([{ id: 'v', source: 'V = vector(2, 1)' }], {}, { id: 'zoomed' }), 'light')
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument({
      ...stored, view: { ...stored.view, visualizerId: null, viewport: { kind: 'two-dimensional', centerX: 1, centerY: 2, zoom: 144 } },
    }))
    vi.stubEnv('MODE', 'development')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(screen.getByRole('textbox', { name: 'Zoom level' })).toHaveValue('200%')
  })

  it('takes the standard interpretation in an undoable step when the stored one is unavailable', () => {
    const stored = toCanonicalDocument(expressionDocument([{ id: 'v', source: 'V = vector(2, 1)' }], {}, { id: 'unknown-interpretation' }), 'light')
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument({
      ...stored, interpretation: { interpretationId: 'org.example.unknown', interpretationVersion: 1 },
    }))
    vi.stubEnv('MODE', 'development')
    render(<App />)
    expect(screen.getByRole('alert')).toHaveTextContent(/INT_UNKNOWN_INTERPRETATION/)
    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(canvas()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(canvas()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show canvas' })).toBeInTheDocument()
  })

  it('forgets the view kept for the return when another document opens', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByRole('textbox', { name: 'Zoom level' })).not.toHaveValue('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' }))

    const opened = toCanonicalDocument(expressionDocument([{ id: 'v', source: 'Opened = vector(3, 4)' }], {}, { id: 'opened' }), 'light')
    const bytes = new TextEncoder().encode(JSON.stringify({
      ...opened, view: { ...opened.view, visualizerId: null, positionEnabled: false, viewport: { kind: 'none' } },
    }))
    fireEvent.drop(document.body, { dataTransfer: {
      types: ['Files'], dropEffect: 'none',
      files: [{ name: 'opened.gamut.json', type: 'application/json', arrayBuffer: async () => bytes.slice().buffer }],
    } })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Opened = vector(3, 4)'))

    fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
    expect(canvas()).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Zoom level' })).toHaveValue('100%')
  })

  describe('undo and redo across an algebra change', () => {
    const switchTo = (current: string, index: number) => {
      fireEvent.click(screen.getByRole('button', { name: `${current}. Change algebra` }))
      fireEvent.click(within(screen.getByRole('menu')).getAllByRole('menuitemradio')[index])
    }
    const undo = () => fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    const redo = () => fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
    const expectCanvasOf = (algebra: 'VGA' | 'PGA') => {
      expect(screen.getByRole('button', { name: `${algebra} · 2D. Change algebra` })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: `Two-dimensional ${algebra} viewport` })).toBeInTheDocument()
    }

    it('keeps the visualizer of each algebra after a view change on the canvas', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<App />)
      switchTo('VGA · 2D', 1)
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      expectCanvasOf('PGA')
      undo()
      expectCanvasOf('VGA')
      redo()
      expectCanvasOf('PGA')
    })

    it('shows the canvas of the algebra undo or redo lands on after NoViz', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<App />)
      switchTo('VGA · 2D', 1)
      fireEvent.click(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' }))
      undo()
      // NoViz is a view state: undo keeps it.
      expect(canvas()).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
      expectCanvasOf('VGA')
      redo()
      expectCanvasOf('PGA')
    })

    it('does not bring back the visualizer kept for another algebra', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: 'Hide canvas (NoViz calculator)' }))
      switchTo('VGA · 2D', 1)
      fireEvent.click(screen.getByRole('button', { name: 'Show canvas' }))
      expectCanvasOf('PGA')
      undo()
      expectCanvasOf('VGA')
      redo()
      expectCanvasOf('PGA')
    })
  })
})

describe('local library of named graphs (#212)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    window.localStorage.clear()
  })
  const libraryMenu = () => screen.getByRole('dialog', { name: 'Library' })
  const openLibrary = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    return libraryMenu()
  }
  const saveButton = () => screen.getByRole('button', { name: /^Save( \(unsaved changes\))?$/ })
  const saveAs = (name: string) => {
    fireEvent.click(saveButton())
    const menu = libraryMenu()
    fireEvent.change(within(menu).getByRole('textbox', { name: 'Graph name' }), { target: { value: name } })
    fireEvent.click(within(menu).getByRole('button', { name: 'Save' }))
  }
  const source = () => screen.getByRole('textbox', { name: 'Expression 1' })
  const nameField = () => screen.getByRole('textbox', { name: 'Open graph name' })
  const index = () => JSON.parse(window.localStorage.getItem('gamut.library.v1')!).entries as { id: string; name: string }[]
  const stored = (id: string) => JSON.parse(window.localStorage.getItem(`gamut.library.v1.document.${id}`)!)

  it('saves the open graph as a new graph, leaving the saved one untouched', () => {
    vi.stubEnv('MODE', 'development')
    render(<App />)
    saveAs('Rotation talk')
    const original = index().find((entry) => entry.name === 'Rotation talk')!
    const originalSource = stored(original.id).items[0].source

    fireEvent.change(source(), { target: { value: 'V1 = vector(9, 9)' } })
    const menu = openLibrary()
    fireEvent.click(within(menu).getByRole('button', { name: 'Save as new graph…' }))
    const name = within(menu).getByRole('textbox', { name: 'Graph name' })
    expect(name).toHaveValue('Rotation talk copy')
    fireEvent.change(name, { target: { value: 'Rotation variant' } })
    fireEvent.click(within(menu).getByRole('button', { name: 'Save' }))

    // Two graphs: the original keeps its saved content, the new one has the edit and is open.
    expect(index().map((entry) => entry.name).sort()).toEqual(['Rotation talk', 'Rotation variant'])
    const variant = index().find((entry) => entry.name === 'Rotation variant')!
    expect(variant.id).not.toBe(original.id)
    expect(stored(original.id).items[0].source).toBe(originalSource)
    expect(stored(variant.id).items[0].source).toBe('V1 = vector(9, 9)')
    expect(nameField()).toHaveValue('Rotation variant')
    expect(saveButton()).toHaveAccessibleName('Save')
  })

  describe('saving while sliders play (#265)', () => {
    const addScalar = (index: number, text: string) => {
      if (index > 1) fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
      const field = screen.getByRole<HTMLInputElement>('textbox', { name: `Expression ${index}` })
      fireEvent.change(field, { target: { value: text } })
      return { field, row: field.closest('.expression-item') as HTMLElement }
    }
    const play = (row: HTMLElement) =>
      fireEvent.click(within(row).getByRole('button', { name: 'Play scalar animation' }))

    afterEach(() => {
      vi.useRealTimers()
    })

    it('stops one playing slider, saves its stopped value, and keeps the graph saved', () => {
      vi.useFakeTimers()
      render(<App />)
      const a = addScalar(1, 'a = 1')
      saveAs('Playing')
      expect(saveButton()).toHaveAccessibleName('Save')

      play(a.row)
      act(() => vi.advanceTimersByTime(500))
      expect(saveButton()).toHaveAccessibleName('Save (unsaved changes)')
      fireEvent.click(saveButton())

      expect(within(a.row).getByRole('button', { name: 'Play scalar animation' })).toBeInTheDocument()
      expect(screen.getByText('a animation stopped because the graph was saved.')).toBeInTheDocument()
      const stoppedValue = a.field.value
      expect(stoppedValue).not.toBe('a = 1')
      expect(stored(index()[0].id).items[0].source).toBe(stoppedValue)
      expect(saveButton()).toHaveAccessibleName('Save')
      act(() => vi.advanceTimersByTime(1000))
      expect(a.field).toHaveValue(stoppedValue)
      expect(saveButton()).toHaveAccessibleName('Save')

      // Playing again is an ordinary change.
      play(a.row)
      act(() => vi.advanceTimersByTime(250))
      expect(saveButton()).toHaveAccessibleName('Save (unsaved changes)')
    })

    it('stops several playing sliders and undoes as after a manual pause', () => {
      vi.useFakeTimers()
      render(<App />)
      const a = addScalar(1, 'a = 1')
      const b = addScalar(2, 'b = 2')
      saveAs('Playing')

      play(a.row)
      play(b.row)
      act(() => vi.advanceTimersByTime(500))
      fireEvent.click(saveButton())

      expect(screen.getByText('a and b animations stopped because the graph was saved.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Pause scalar animation' })).not.toBeInTheDocument()
      expect(saveButton()).toHaveAccessibleName('Save')
      const saved = stored(index()[0].id).items.map((item: { source: string }) => item.source)
      expect(saved).toEqual([a.field.value, b.field.value])
      act(() => vi.advanceTimersByTime(1000))
      expect(saveButton()).toHaveAccessibleName('Save')

      // One undo reverts the whole playback session, like after a manual pause.
      fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
      expect(a.field).toHaveValue('a = 1')
      expect(b.field).toHaveValue('b = 2')
      expect(saveButton()).toHaveAccessibleName('Save (unsaved changes)')
    })
  })

  it('groups the header: graph name, Save, and Library; the document file; the display', () => {
    render(<App />)
    const groups = within(document.querySelector('.header-actions') as HTMLElement).getAllByRole('group')
    expect(groups.map((group) => [
      group.getAttribute('aria-label'),
      within(group).queryAllByRole('textbox').map((field) => field.getAttribute('aria-label')),
      within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ])).toEqual([
      ['Graph', ['Open graph name'], ['Save (unsaved changes)', 'Library']],
      ['Document file', [], ['Import document', 'Export document', 'Copy link']],
      ['Display', [], ['Switch to dark theme', 'Settings']],
    ])
  })

  it('names a graph never saved “Untitled” and marks unsaved changes on Save', () => {
    render(<App />)
    expect(nameField()).toHaveValue('')
    expect(nameField()).toHaveAttribute('placeholder', 'Untitled')
    expect(document.title).toBe('Untitled · GAMUT')
    expect(saveButton()).toHaveAttribute('title', 'Save (unsaved changes)')
    expect(saveButton().querySelector('.unsaved-dot')).not.toBeNull()

    saveAs('Rotation talk')
    expect(nameField()).toHaveValue('Rotation talk')
    expect(document.title).toBe('Rotation talk · GAMUT')
    expect(saveButton()).toHaveAccessibleName('Save')
    expect(saveButton()).toHaveAttribute('title', 'Save')
    expect(saveButton().querySelector('.unsaved-dot')).toBeNull()

    // Zooming and panning are view settings, not changes to save.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(saveButton()).toHaveAccessibleName('Save')
    fireEvent.change(source(), { target: { value: 'vector(5, 6)' } })
    expect(saveButton()).toHaveAccessibleName('Save (unsaved changes)')
    fireEvent.click(saveButton())
    expect(saveButton()).toHaveAccessibleName('Save')
  })

  it('renames the open graph from its name in the header', () => {
    render(<App />)
    saveAs('Draft')
    fireEvent.focus(nameField())
    fireEvent.change(nameField(), { target: { value: 'Final' } })
    fireEvent.keyDown(nameField(), { key: 'Enter' })
    fireEvent.blur(nameField())
    expect(nameField()).toHaveValue('Final')
    expect(document.title).toBe('Final · GAMUT')
    expect(index()).toMatchObject([{ name: 'Final' }])
    expect(stored(index()[0].id).metadata.title).toBe('Final')
    expect(saveButton()).toHaveAccessibleName('Save')

    // Escape abandons the draft; an empty name is not kept.
    fireEvent.focus(nameField())
    fireEvent.change(nameField(), { target: { value: 'Abandoned' } })
    fireEvent.keyDown(nameField(), { key: 'Escape' })
    expect(nameField()).toHaveValue('Final')
    fireEvent.focus(nameField())
    fireEvent.change(nameField(), { target: { value: '  ' } })
    fireEvent.blur(nameField())
    expect(nameField()).toHaveValue('Final')
    expect(index()).toMatchObject([{ name: 'Final' }])
  })

  it('saves a graph never saved when it is named in the header', () => {
    render(<App />)
    fireEvent.focus(nameField())
    fireEvent.change(nameField(), { target: { value: 'Named here' } })
    fireEvent.blur(nameField())
    expect(index()).toMatchObject([{ name: 'Named here' }])
    expect(saveButton()).toHaveAccessibleName('Save')
  })

  it('asks for a name in the library menu the first time, then saves under the title', () => {
    const prompt = vi.spyOn(window, 'prompt')
    render(<App />)
    fireEvent.click(saveButton())
    const menu = libraryMenu()
    const name = within(menu).getByRole('textbox', { name: 'Graph name' })
    expect(name).toHaveValue('Untitled document')
    expect(name).toHaveFocus()
    fireEvent.change(name, { target: { value: 'Rotation talk' } })
    fireEvent.click(within(menu).getByRole('button', { name: 'Save' }))
    expect(prompt).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument()
    expect(screen.getByText('Saved “Rotation talk” to the library.')).toBeInTheDocument()

    // The next save does not ask again, and stores the current revision.
    fireEvent.change(source(), { target: { value: 'vector(5, 6)' } })
    fireEvent.click(saveButton())
    expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument()
    expect(stored('local-document').metadata.title).toBe('Rotation talk')
    expect(stored('local-document').items[0].source).toBe('vector(5, 6)')

    const group = within(openLibrary()).getByRole('region', { name: 'VGA · 2D' })
    const open = within(group).getByRole('button', { name: 'Open Rotation talk' })
    expect(open).toHaveAttribute('aria-current', 'true')
    expect(open.closest('li')!.querySelector('time')).toHaveAttribute('dateTime', expect.stringMatching(/^\d{4}-\d\d-\d\dT/))
  })

  it('creates, opens, renames, duplicates, and deletes graphs, which survive a reload', () => {
    const first = render(<App />)
    fireEvent.change(source(), { target: { value: 'A = vector(1, 0)' } })
    saveAs('First')

    // New asks before discarding unsaved changes, inside the menu.
    fireEvent.change(source(), { target: { value: 'A = vector(9, 9)' } })
    fireEvent.click(within(openLibrary()).getByRole('button', { name: '+ New graph' }))
    const confirm = within(libraryMenu()).getByRole('alertdialog', { name: 'Confirm' })
    expect(confirm).toHaveTextContent('not saved in the library')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard and create' }))
    expect(source()).toHaveValue('')
    expect(nameField()).toHaveValue('')
    fireEvent.change(source(), { target: { value: 'B = vector(0, 1)' } })
    saveAs('Second')

    let menu = openLibrary()
    fireEvent.click(within(menu).getByRole('button', { name: 'Open First' }))
    expect(source()).toHaveValue('A = vector(1, 0)')
    expect(nameField()).toHaveValue('First')
    expect(saveButton()).toHaveAccessibleName('Save')

    menu = openLibrary()
    fireEvent.click(within(menu).getByRole('button', { name: 'Rename Second' }))
    fireEvent.change(within(menu).getByRole('textbox', { name: 'New name for Second' }), { target: { value: 'Second, renamed' } })
    fireEvent.click(within(menu).getByRole('button', { name: 'Rename' }))
    fireEvent.click(within(menu).getByRole('button', { name: 'Duplicate First' }))
    fireEvent.click(within(menu).getByRole('button', { name: 'Duplicate First' }))
    expect(within(menu).getByRole('button', { name: 'Open First copy' })).toBeInTheDocument()
    expect(within(menu).getByRole('button', { name: 'Open First copy 2' })).toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('button', { name: 'Delete First copy 2' }))
    fireEvent.click(within(within(menu).getByRole('alertdialog', { name: 'Confirm' })).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(menu).getByRole('button', { name: 'Delete First copy' }))
    const deletion = within(menu).getByRole('alertdialog', { name: 'Confirm' })
    expect(deletion).toHaveTextContent('Delete “First copy” from the library?')
    fireEvent.click(within(deletion).getByRole('button', { name: 'Cancel' }))
    expect(within(menu).getByRole('button', { name: 'Open First copy' })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('button', { name: 'Delete First copy' }))
    fireEvent.click(within(within(menu).getByRole('alertdialog', { name: 'Confirm' })).getByRole('button', { name: 'Delete' }))
    expect(within(menu).queryByRole('button', { name: 'Open First copy' })).not.toBeInTheDocument()
    first.unmount()

    render(<App />)
    menu = openLibrary()
    expect(within(menu).getAllByRole('button', { name: /^Open / }).map((button) => button.getAttribute('aria-label')).sort())
      .toEqual(['Open First', 'Open Second, renamed'])
    // The reloaded test document is not a library graph, so opening asks first.
    fireEvent.click(within(menu).getByRole('button', { name: 'Open Second, renamed' }))
    fireEvent.click(within(within(menu).getByRole('alertdialog', { name: 'Confirm' }))
      .getByRole('button', { name: 'Discard and open' }))
    expect(source()).toHaveValue('B = vector(0, 1)')
  })

  it('never discards unsaved changes when the open graph is opened again', () => {
    render(<App />)
    saveAs('Kept')
    fireEvent.change(source(), { target: { value: 'vector(8, 8)' } })
    const menu = openLibrary()
    expect(within(menu).getByRole('button', { name: 'Open Kept' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(menu).getByRole('button', { name: 'Open Kept' }))
    expect(source()).toHaveValue('vector(8, 8)')
    expect(saveButton()).toHaveAccessibleName('Save (unsaved changes)')
  })

  it('never overwrites a library graph that only shares the identity of the open document', () => {
    const saved = toCanonicalDocument(expressionDocument(
      [{ id: 'item-1', source: 'Saved = vector(1, 1)' }], {}, { id: 'local-document', title: 'Saved default' },
    ), 'light')
    window.localStorage.setItem('gamut.library.v1', JSON.stringify({ version: 1, entries: [
      { id: 'local-document', name: 'Saved default', algebraId: 'org.multivector.vga', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' },
    ] }))
    window.localStorage.setItem('gamut.library.v1.document.local-document', serializeCanonicalDocument(saved))
    // The default document of this visit has the same identity.
    render(<App />)
    expect(nameField()).toHaveValue('')
    expect(within(openLibrary()).getByRole('button', { name: 'Open Saved default' })).not.toHaveAttribute('aria-current')
    fireEvent.click(screen.getByRole('button', { name: 'Close Library menu' }))
    saveAs('This visit')

    expect(stored('local-document').items[0].source).toBe('Saved = vector(1, 1)')
    const copy = index().find((entry) => entry.name === 'This visit')!
    expect(copy.id).not.toBe('local-document')
    expect(stored(copy.id).items[0].source).toBe('vector(2, 1)')
    // The open graph took that identity, so the next save updates it.
    fireEvent.change(source(), { target: { value: 'vector(4, 4)' } })
    fireEvent.click(saveButton())
    expect(index()).toHaveLength(2)
    expect(stored(copy.id).items[0].source).toBe('vector(4, 4)')
  })

  it('lists the former active document without writing, and migrates it at the first write', () => {
    const active = toCanonicalDocument(expressionDocument(
      [{ id: 'item-1', source: 'V = vector(2, 1)' }], {}, { id: 'former', title: 'Former scene' },
    ), 'light')
    const pga = toCanonicalDocument({
      ...expressionDocument([{ id: 'item-1', source: 'P = point(1, 2)' }], {}, { id: 'pga-graph', title: 'Points' }),
      algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: {} },
      interpretation: { interpretationId: 'org.multivector.pga-2d', interpretationVersion: 1 },
    }, 'light')
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(active))
    window.localStorage.setItem('gamut.library.v1.document.pga-graph', serializeCanonicalDocument(pga))
    vi.stubEnv('MODE', 'development')
    render(<App />)
    expect(nameField()).toHaveValue('Former scene')
    expect(saveButton()).toHaveAccessibleName('Save')
    let menu = openLibrary()
    expect(window.localStorage.getItem('gamut.library.v1')).toBeNull()
    expect(within(within(menu).getByRole('region', { name: 'VGA · 2D' })).getByRole('button', { name: 'Open Former scene' }))
      .toHaveAttribute('aria-current', 'true')
    expect(within(within(menu).getByRole('region', { name: 'PGA · 2D' })).getByRole('button', { name: 'Open Points' }))
      .toBeInTheDocument()

    // Opening another graph stores the former document first.
    fireEvent.click(within(menu).getByRole('button', { name: 'Open Points' }))
    expect(index().map((entry) => entry.id).sort()).toEqual(['former', 'pga-graph'])
    expect(stored('former').items[0].source).toBe('V = vector(2, 1)')
    cleanup()

    window.localStorage.setItem('gamut.library.v1', 'corrupted')
    render(<App />)
    menu = openLibrary()
    expect(menu).toHaveTextContent('LIBRARY_INDEX_REBUILT')
    expect(window.localStorage.getItem('gamut.library.v1')).toBe('corrupted')
    expect(within(menu).getByRole('button', { name: 'Open Former scene' })).toBeInTheDocument()
  })

  it('follows a library changed in another tab, and keeps its graphs when saving', () => {
    render(<App />)
    saveAs('Mine')
    const menu = openLibrary()
    const other = toCanonicalDocument(expressionDocument([{ id: 'item-1', source: 'vector(0, 3)' }], {}, { id: 'other-tab', title: 'Other tab' }), 'light')
    window.localStorage.setItem('gamut.library.v1.document.other-tab', serializeCanonicalDocument(other))
    window.localStorage.setItem('gamut.library.v1', JSON.stringify({ version: 1, entries: [
      ...index(),
      { id: 'other-tab', name: 'Other tab', algebraId: 'org.multivector.vga', createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' },
    ] }))
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'gamut.library.v1' })) })
    expect(within(menu).getByRole('button', { name: 'Open Other tab' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close Library menu' }))

    fireEvent.change(source(), { target: { value: 'vector(1, 1)' } })
    fireEvent.click(saveButton())
    expect(index().map((entry) => entry.name)).toEqual(['Mine', 'Other tab'])
  })

  it('closes a confirmation with Escape and keeps the menu open', () => {
    render(<App />)
    saveAs('Escaped')
    const menu = openLibrary()
    fireEvent.click(within(menu).getByRole('button', { name: 'Delete Escaped' }))
    expect(within(menu).getByRole('alertdialog', { name: 'Confirm' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(libraryMenu()).queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(menu).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Library' })).not.toBeInTheDocument()
  })

  it('keeps editing and reports the problem when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    render(<App />)
    fireEvent.change(source(), { target: { value: 'vector(3, 4)' } })
    saveAs('Blocked')
    const menu = libraryMenu()
    expect(within(menu).getByRole('alert')).toHaveTextContent(/^LIBRARY_UNAVAILABLE/)
    expect(source()).toHaveValue('vector(3, 4)')
  })

  it('reports a full storage on save and keeps the open graph', () => {
    render(<App />)
    saveAs('Kept')
    fireEvent.change(source(), { target: { value: 'vector(7, 7)' } })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    fireEvent.click(saveButton())
    expect(within(libraryMenu()).getByRole('alert')).toHaveTextContent(/^LIBRARY_WRITE_FAILED/)
    vi.restoreAllMocks()
    expect(stored('local-document').items[0].source).toBe('vector(2, 1)')
    expect(saveButton()).toHaveAccessibleName('Save (unsaved changes)')
  })

  it('reports a corrupted graph as unreadable, not as unavailable storage', () => {
    render(<App />)
    saveAs('Broken')
    window.localStorage.setItem('gamut.library.v1.document.local-document', '{"broken"')
    const menu = openLibrary()
    fireEvent.click(within(menu).getByRole('button', { name: 'Duplicate Broken' }))
    expect(within(menu).getByRole('alert')).toHaveTextContent(/^LIBRARY_ENTRY_INVALID/)
  })
})
