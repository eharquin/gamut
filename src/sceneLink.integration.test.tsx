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
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', { name: 'Copy link' }))
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

  it('keeps the saved document intact until an explicit save creates a new local identity', async () => {
    const source = serializeCanonicalDocument(saved)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    await openSharedScene()
    fireEvent.change(screen.getByRole('textbox', { name: 'Expression 1' }), { target: { value: 'Shared = vector(6, 7)' } })
    expect(writes).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(source)
    fireEvent.click(screen.getByRole('button', { name: 'Save local copy' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save local copy' })).not.toBeInTheDocument())
    const copy = parseCanonicalDocument(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!)
    expect(copy.id).not.toBe(shared.id)
    expect(copy.id).not.toBe(saved.id)
    expect(copy.items[0].source).toBe('Shared = vector(6, 7)')
    expect(window.location.hash).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }))
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)')
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
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [file] } })
    await waitFor(
      () => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Dropped = vector(1, 1)'),
      { timeout: 5000 },
    )
    expect(screen.getByRole('button', { name: 'Save local copy' })).toBeInTheDocument()
    expect(writes).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(source)
  })

  it('retains the temporary session and offers export if explicit saving fails', async () => {
    await openSharedScene()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
    fireEvent.click(screen.getByRole('button', { name: 'Save local copy' }))
    expect(screen.getByRole('alert')).toHaveTextContent('STORE_WRITE_FAILED')
    expect(screen.getByRole('button', { name: 'Save local copy' })).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Scene link' })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledOnce()
    const url = writeText.mock.calls[0][0] as string
    expect(screen.getByRole('textbox', { name: 'Scene link' })).toHaveValue(url)
    expect(screen.getByText('Copied.')).toBeInTheDocument()
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
    copyLink()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Scene link' })).toBeInTheDocument())
    expect((screen.getByRole('textbox', { name: 'Scene link' }) as HTMLTextAreaElement).value.length).toBeGreaterThan(8 * 1024)
    expect(within(screen.getByRole('region', { name: 'Share scene' })).getByRole('status'))
      .toHaveTextContent('Copied. This link exceeds 8 KiB')
  })

  it('offers selectable text when clipboard permission is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } })
    await openSharedScene()
    copyLink()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Scene link' })).toBeInTheDocument())
    expect(screen.getByText('Select and copy the text below.')).toBeInTheDocument()
  })
})
