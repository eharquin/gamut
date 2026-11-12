/// <reference types="node" />
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import {
  parseCanonicalDocument,
  serializeCanonicalDocument,
  toCanonicalDocument,
  type CanonicalDocument,
} from './document/canonicalDocument'
import { loadFromLibrary, saveToLibrary } from './document/documentLibrary'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument } from './document/expressionDocument'
import { decodeSceneFragment, encodeSceneFragment } from './document/sceneLink'

/** One row per value type: a single value, a computed scalar, and a list. */
const SOURCES = ['v = 2e1 - e2', 's = 3 * 2', 'L = [e1, 2e2]'] as const

function graph(valuesVisible: boolean): CanonicalDocument {
  const document = expressionDocument(
    SOURCES.map((source, index) => ({ id: `item-${index}`, source })),
    {},
    { id: 'hidden-values', title: 'Hidden values' },
  )
  return toCanonicalDocument({
    ...document,
    view: { ...document.view, display: { ...document.view.display, valuesVisible } },
  }, 'light')
}

function row(index: number): HTMLElement {
  return screen.getByRole('textbox', { name: `Expression ${index + 1}` })
    .closest('.expression-item') as HTMLElement
}

async function openRows(document: CanonicalDocument) {
  window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(document))
  render(<App />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue(SOURCES[0]))
  fireEvent.click(within(row(2)).getByRole('button', { name: 'List (2)' }))
}

function valuesSwitch(): HTMLElement {
  if (!screen.queryByRole('dialog', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  return screen.getByRole('switch', { name: 'Show multivector values' })
}

/** The coefficients printed for each row, and for the list's elements. */
const COEFFICIENTS = ['2e1 - e2', '6', '[e1, 2e2]', 'e1', '2e2']

function expectValuesShown() {
  expect(within(row(0)).getByText('2e1 - e2')).toBeInTheDocument()
  expect(within(row(1)).getByText('6')).toBeInTheDocument()
  expect(within(row(2)).getByText('[e1, 2e2]')).toBeInTheDocument()
  const elements = within(row(2)).getByRole('list', { name: /^Elements of/ })
  expect(within(elements).getByText('e1')).toBeInTheDocument()
  expect(within(elements).getByText('2e2')).toBeInTheDocument()
  expect(screen.queryByText('Value hidden')).not.toBeInTheDocument()
}

function expectValuesHidden() {
  for (const index of [0, 1, 2]) {
    const item = row(index)
    const feedback = item.querySelector('.expression-feedback') as HTMLElement
    expect(feedback.querySelector('output')).toBeNull()
    for (const coefficients of COEFFICIENTS)
      expect(within(item).queryByText(coefficients)).not.toBeInTheDocument()
    // The hidden value is announced as hidden, and the source field's
    // description never carries the coefficients.
    expect(within(feedback).getByText('Value hidden')).toHaveClass('visually-hidden')
    const source = within(item).getByRole('textbox', { name: `Expression ${index + 1}` })
    expect(source).toHaveAccessibleDescription(expect.stringContaining('Value hidden'))
  }
  const elements = within(row(2)).getByRole('list', { name: /^Elements of/ })
  expect(elements.querySelector('code')).toBeNull()
  expect(within(elements).getAllByText('Value hidden')).toHaveLength(2)
}

/** What stays visible whatever the setting: descriptions, list toggle, drawing. */
function expectRowsUnchanged() {
  expect(within(row(0)).getByText('Vector')).toBeInTheDocument()
  expect(within(row(1)).getByText('Scalar')).toBeInTheDocument()
  expect(within(row(2)).getByRole('button', { name: 'List (2)' })).toBeInTheDocument()
  expect(within(row(2)).getAllByText('Vector')).toHaveLength(2)
}

// Outside the test mode, the application restores the stored document.
beforeEach(() => {
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
})

describe('Show multivector values (#191)', () => {
  it('shows every value by default and offers the setting in the display menu', async () => {
    await openRows(graph(true))
    expectValuesShown()
    expectRowsUnchanged()
    expect(valuesSwitch()).toBeChecked()
  })

  it('hides single, scalar, and list values, announcing them as hidden', async () => {
    await openRows(graph(true))
    const drawing = screen.getByRole('img', { name: /Two-dimensional VGA viewport/ }).innerHTML
    fireEvent.click(valuesSwitch())
    expect(valuesSwitch()).not.toBeChecked()
    expectValuesHidden()
    expectRowsUnchanged()
    expect(screen.getByRole('img', { name: /Two-dimensional VGA viewport/ }).innerHTML).toBe(drawing)

    // Turning the setting back on reveals every value at once.
    fireEvent.click(valuesSwitch())
    expectValuesShown()
  })

  it('keeps diagnostics and scalar controls visible while values are hidden', async () => {
    await openRows(graph(false))
    expectValuesHidden()
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'vector(2)' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Expected “,” between vector components.')
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 2' }), { target: { value: 's = 5' } })
    expect(within(row(1)).getByRole('slider')).toBeInTheDocument()
    expect(within(row(1)).queryByRole('status')?.querySelector('output') ?? null).toBeNull()
  })

  it('is an unsaved document change that undo and redo keep, like the other display settings', async () => {
    await openRows(graph(true))
    const expression = () => screen.getByRole('textbox', { name: 'Expression 1' })
    fireEvent.change(expression(), { target: { value: 'v = e1' } })
    fireEvent.click(valuesSwitch())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    // The view is never an undo entry: undo restores the source only.
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(expression()).toHaveValue(SOURCES[0])
    expectValuesHidden()
    fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
    expect(expression()).toHaveValue('v = e1')
    expect(within(row(0)).getByText('Value hidden')).toBeInTheDocument()
  })

  it('travels through export and import', async () => {
    const blobs: Blob[] = []
    class TestURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:gamut-document' })
      static revokeObjectURL = vi.fn((_url: string) => undefined)
    }
    vi.stubGlobal('URL', TestURL)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    await openRows(graph(true))
    fireEvent.click(valuesSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Export document' }))
    expect(blobs).toHaveLength(1)
    const exported = new Uint8Array(await blobs[0].arrayBuffer())
    expect(parseCanonicalDocument(new TextDecoder().decode(exported)).view.display.valuesVisible).toBe(false)
    cleanup()
    window.localStorage.clear()

    render(<App />)
    const file = {
      name: 'hidden.gamut.json',
      type: 'application/json',
      arrayBuffer: async () => exported.slice().buffer,
    } as unknown as File
    fireEvent.change(screen.getByLabelText('Import document file'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue(SOURCES[0]))
    fireEvent.click(within(row(2)).getByRole('button', { name: 'List (2)' }))
    expectValuesHidden()
  })

  it('travels through the library', () => {
    saveToLibrary(window.localStorage, graph(false), 'Hidden values', { boundId: null })
    expect(loadFromLibrary(window.localStorage, 'hidden-values').view.display.valuesVisible).toBe(false)
  })

  describe('scene links', () => {
    beforeEach(() => {
      vi.stubGlobal('crypto', webcrypto)
    })

    it('opens a shared scene with its values hidden and copies the setting into a new link', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
      window.history.replaceState(null, '', '/' + await encodeSceneFragment(graph(false)))
      render(<App />)
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue(SOURCES[0]))
      fireEvent.click(within(row(2)).getByRole('button', { name: 'List (2)' }))
      expectValuesHidden()

      fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
      const url = writeText.mock.calls[0][0] as string
      expect((await decodeSceneFragment(new URL(url).hash)).view.display.valuesVisible).toBe(false)
    })
  })
})
