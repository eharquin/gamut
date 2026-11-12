/// <reference types="node" />
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import { parseCanonicalDocument, serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument } from './document/expressionDocument'
import { decodeSceneFragment, encodeSceneFragment } from './document/sceneLink'

const shared = toCanonicalDocument(expressionDocument([
  { id: 'shared-vector', source: 'Shared = vector(3, 4)' },
], {}, { id: 'shared-document', title: 'A shared scene' }), 'dark')
const saved = toCanonicalDocument(expressionDocument([
  { id: 'saved-vector', source: 'Saved = vector(8, 9)' },
], {}, { id: 'saved-document' }), 'light')

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

function copyLink() {
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
}

/** `timeout` widens the wait on slow CI runners; the default is Testing Library's 1 s. */
async function openSharedScene(timeout?: number) {
  window.history.replaceState(null, '', '/' + await encodeSceneFragment(shared))
  render(<App />)
  await waitFor(
    () => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)'),
    { timeout },
  )
}

describe('scene sharing in the application', () => {
  it('loads and edits a temporary scene without reading or writing any local storage, even for viewport lock', async () => {
    const fragment = await encodeSceneFragment(shared)
    window.history.replaceState(null, '', '/' + fragment)
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Storage blocked') })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'Shared = vector(6, 7)' } })
    fireEvent.click(screen.getByRole('button', { name: /Lock viewport/ }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(storage).not.toHaveBeenCalled()
    expect(window.location.hash).toBe(fragment)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  /** Saves the temporary session with the Save button and the library panel's name field. */
  const saveFromHeader = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Library' })).getByRole('button', { name: 'Save' }))
  }
  const expectNoBanner = () => {
    expect(screen.queryByText(/Temporary session/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save local copy' })).not.toBeInTheDocument()
  }

  it('keeps the saved document intact until an explicit save creates a new local identity', async () => {
    const source = serializeCanonicalDocument(saved)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    await openSharedScene()
    expectNoBanner()
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'Shared = vector(6, 7)' } })
    expect(writes).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(source)
    saveFromHeader()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('A shared scene'))
    expectNoBanner()
    const copy = parseCanonicalDocument(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!)
    expect(copy.id).not.toBe(shared.id)
    expect(copy.id).not.toBe(saved.id)
    expect(copy.items[0].source).toBe('Shared = vector(6, 7)')
    expect(window.location.hash).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)')
  })

  it('saves a temporary session into the library as a local copy (#212)', async () => {
    await openSharedScene()
    expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('Shared scene (temporary)')
    expect(document.title).toBe('Shared scene (temporary) · GAMUT')
    fireEvent.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
    const menu = screen.getByRole('region', { name: 'Library' })
    expect(within(menu).getByRole('textbox', { name: 'Graph name' })).toHaveValue('A shared scene')
    fireEvent.click(within(menu).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('A shared scene'))
    expect(window.location.hash).toBe('')
    const [entry] = JSON.parse(window.localStorage.getItem('gamut.library.v1')!).entries
    expect(entry).toMatchObject({ name: 'A shared scene' })
    expect(entry.id).not.toBe(shared.id)
    expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('A shared scene')
    await waitFor(() => expect(parseCanonicalDocument(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!).id).toBe(entry.id))
  })

  it('adds a temporary scene to my library from the library panel, which opens the copy and ends the session (#266)', async () => {
    await openSharedScene()
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    const panel = screen.getByRole('region', { name: 'Library' })
    expect(panel).toHaveTextContent('browser storage is not used')
    fireEvent.click(within(panel).getByRole('button', { name: 'Add to my library' }))

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('A shared scene'))
    expect(window.location.hash).toBe('')
    const [entry] = JSON.parse(window.localStorage.getItem('gamut.library.v1')!).entries
    expect(entry).toMatchObject({ name: 'A shared scene' })
    expect(entry.id).not.toBe(shared.id)
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('adds an example to my library in a temporary session without ending the session (#266)', async () => {
    const source = serializeCanonicalDocument(saved)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    await openSharedScene()
    const hash = window.location.hash
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    const panel = screen.getByRole('region', { name: 'Library' })
    fireEvent.click(within(panel).getByRole('tab', { name: 'Examples' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Add VGA 2D Rotation Example to my library' }))

    // The former active document is migrated, and the example copy is stored.
    const entries: { id: string; name: string }[] = JSON.parse(window.localStorage.getItem('gamut.library.v1')!).entries
    expect(entries.map((entry) => entry.id)).toContain('saved-document')
    expect(window.localStorage.getItem('gamut.library.v1.document.saved-document')).toBe(source)
    const copy = entries.find((entry) => entry.name === 'VGA 2D Rotation Example')!
    expect(parseCanonicalDocument(window.localStorage.getItem(`gamut.library.v1.document.${copy.id}`)!).items[0].source)
      .toBe('V1 = vector(0.66, 3.042)')
    // The scene stays open and temporary; the active document is untouched.
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(source)
    expect(writes.mock.calls.map(([key]) => key)).not.toContain(ACTIVE_DOCUMENT_KEY)
    expect(window.location.hash).toBe(hash)
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    expectNoBanner()
    expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('Shared scene (temporary)')
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)')
  })

  it('writes nothing when the library panel opens in a temporary session (#212)', async () => {
    const source = serializeCanonicalDocument(saved)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    window.localStorage.setItem('gamut.library.v1', 'corrupted')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const removals = vi.spyOn(Storage.prototype, 'removeItem')
    await openSharedScene()
    const menu = (() => {
      fireEvent.click(screen.getByRole('button', { name: 'Library' }))
      return screen.getByRole('region', { name: 'Library' })
    })()
    expect(menu).toHaveTextContent('LIBRARY_INDEX_REBUILT')
    fireEvent.click(within(menu).getByRole('button', { name: 'Close library' }))
    expect(writes).not.toHaveBeenCalled()
    expect(removals).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('gamut.library.v1')).toBe('corrupted')
  })

  for (const action of ['Save', 'New', 'Open', 'Open example', 'Add to my library'] as const) {
    it(`keeps the former active document in the library before ${action} replaces it (#212)`, async () => {
      const source = serializeCanonicalDocument(saved)
      window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
      const other = toCanonicalDocument(expressionDocument([{ id: 'item-1', source: 'Other = vector(0, 2)' }], {}, { id: 'other', title: 'Other' }), 'light')
      if (action === 'Open') window.localStorage.setItem('gamut.library.v1.document.other', serializeCanonicalDocument(other))
      await openSharedScene()
      const menu = () => screen.getByRole('region', { name: 'Library' })
      if (action === 'Save') {
        fireEvent.click(screen.getByRole('button', { name: 'Save (unsaved changes)' }))
        fireEvent.click(within(menu()).getByRole('button', { name: 'Save' }))
      } else if (action === 'Add to my library') {
        fireEvent.click(screen.getByRole('button', { name: 'Library' }))
        fireEvent.click(within(menu()).getByRole('button', { name: 'Add to my library' }))
      } else if (action === 'Open example') {
        fireEvent.click(screen.getByRole('button', { name: 'Library' }))
        fireEvent.click(within(menu()).getByRole('tab', { name: 'Examples' }))
        fireEvent.click(within(menu()).getByRole('button', { name: 'Open example VGA 2D Rotation Example' }))
        fireEvent.click(within(within(menu()).getByRole('alertdialog')).getByRole('button', { name: /^Discard/ }))
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Library' }))
        fireEvent.click(within(menu()).getByRole('button', { name: action === 'New' ? '+ New graph' : 'Open Other' }))
        fireEvent.click(within(within(menu()).getByRole('alertdialog')).getByRole('button', { name: /^Discard/ }))
      }
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Open graph name' })).not.toHaveValue('Shared scene (temporary)'))
      expect(window.localStorage.getItem('gamut.library.v1.document.saved-document')).toBe(source)
      expect(JSON.parse(window.localStorage.getItem('gamut.library.v1')!).entries.map((entry: { id: string }) => entry.id))
        .toContain('saved-document')
    })
  }

  it('keeps a temporary session and the former active document when the library cannot take it (#212)', async () => {
    const source = serializeCanonicalDocument(saved)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    await openSharedScene()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (key === 'gamut.library.v1') throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    saveFromHeader()
    expect(screen.getByRole('region', { name: 'Library' })).toHaveTextContent(/write|stor|quota/i)
    expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('Shared scene (temporary)')
    vi.restoreAllMocks()
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(source)
    expect(window.localStorage.getItem('gamut.library.v1.document.saved-document')).toBeNull()
  })

  // Opening a scene and then importing a dropped one evaluates two documents,
  // which can exceed the default 1 s wait on a loaded runner.
  it('keeps a document dropped into a temporary session temporary', { timeout: 15_000 }, async () => {
    const source = serializeCanonicalDocument(saved)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    await openSharedScene(5000)
    const bytes = new TextEncoder().encode(serializeCanonicalDocument(toCanonicalDocument(expressionDocument(
      [{ id: 'dropped-vector', source: 'Dropped = vector(1, 1)' }], {}, { id: 'dropped-document' },
    ), 'light')))
    const file = { name: 'dropped.gamut.json', type: 'application/json', arrayBuffer: async () => bytes.slice().buffer } as unknown as File
    // The window's drop listener is installed by an effect that may run after
    // the scene is displayed. A dragged file shows the drop overlay only once
    // that listener exists, so wait for it before dropping.
    await waitFor(() => {
      fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'], files: [] } })
      expect(screen.getByText('Drop a JSON document to open it')).toBeInTheDocument()
    })
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [file] } })
    await waitFor(
      () => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Dropped = vector(1, 1)'),
      { timeout: 5000 },
    )
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    expectNoBanner()
    expect(writes).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(source)
  })

  it('retains the temporary session and offers export if explicit saving fails', async () => {
    await openSharedScene()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
    saveFromHeader()
    expect(screen.getByRole('region', { name: 'Library' })).toHaveTextContent(/write|stor|quota/i)
    expect(screen.getByRole('textbox', { name: 'Open graph name' })).toHaveValue('Shared scene (temporary)')
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)')
  })

  it('rejects an invalid link without replacing or writing the saved document', async () => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(saved))
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    window.history.replaceState(null, '', '/#scene=999.bad')
    render(<App />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('SHARE_VERSION'))
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Saved = vector(8, 9)')
    expect(writes).not.toHaveBeenCalled()
  })

  it('copies a self-contained link representing the current edits, and no iframe code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await openSharedScene()
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'Shared = vector(6, 7)' } })
    copyLink()
    // A successful copy is confirmed briefly, without opening the link panel.
    await waitFor(() => expect(screen.getByText('Link copied.')).toBeInTheDocument())
    expect(screen.queryByRole('textbox', { name: 'Scene link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Share scene' })).not.toBeInTheDocument()
    expect(writeText).toHaveBeenCalledOnce()
    const url = writeText.mock.calls[0][0] as string
    expect((await decodeSceneFragment(new URL(url).hash)).items[0].source).toBe('Shared = vector(6, 7)')
    expect(screen.queryByRole('button', { name: 'Copy iframe code' })).not.toBeInTheDocument()
    expect(screen.queryByText(/<iframe/)).not.toBeInTheDocument()
  })

  it('warns from the menu when a copied link exceeds 8 KiB', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    // A pseudo-random description keeps the link above 8 KiB after compression
    // while rendering a single item, so the test stays fast on CI.
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const description = Array.from({ length: 12_000 }, () => Math.floor(random() * 36).toString(36)).join('')
    const large = toCanonicalDocument(expressionDocument([
      { id: 'v', source: 'V = vector(2, 1)' },
    ], {}, { id: 'large-document', description }), 'dark')
    window.history.replaceState(null, '', '/' + await encodeSceneFragment(large))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue(large.items[0].source))
    const writeText = vi.mocked(navigator.clipboard.writeText)
    copyLink()
    await waitFor(() => expect(screen.getByText(/^Link copied\. This link exceeds 8 KiB/)).toBeInTheDocument())
    expect((writeText.mock.calls[0][0] as string).length).toBeGreaterThan(8 * 1024)
    expect(screen.queryByRole('textbox', { name: 'Scene link' })).not.toBeInTheDocument()
  })

  it('offers selectable text when clipboard permission is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } })
    await openSharedScene()
    copyLink()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Scene link' })).toBeInTheDocument())
    expect(screen.getByText('Select and copy the text below.')).toBeInTheDocument()
    expect(screen.queryByText(/^Link copied/)).not.toBeInTheDocument()
  })

  it('hides the copy confirmation after a moment', { timeout: 15_000 }, async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await openSharedScene(5000)
    copyLink()
    await waitFor(() => expect(screen.getByText('Link copied.')).toBeInTheDocument(), { timeout: 5000 })
    // The notice lasts 2.5 s; real timers keep the test independent of the runner.
    await waitFor(() => expect(screen.queryByText('Link copied.')).not.toBeInTheDocument(), { timeout: 6000 })
  })
})
