import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { revealActions } from './test/libraryActions'
import { toCanonicalDocument } from './document/canonicalDocument'
import { LIBRARY_INDEX_KEY } from './document/documentLibrary'
import { expressionDocument } from './document/expressionDocument'
import { encodeSceneFragment } from './document/sceneLink'
import { openZip } from './document/zipArchive'

let blobs: Blob[] = []

beforeEach(() => {
  // Browser storage is used outside the test mode only.
  vi.stubEnv('MODE', 'development')
  blobs = []
  class TestURL extends URL {
    static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:gamut-library' })
    static revokeObjectURL = vi.fn((_url: string) => undefined)
  }
  vi.stubGlobal('URL', TestURL)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const panel = () => screen.getByRole('region', { name: 'Library' })
const openLibrary = () => {
  if (!screen.queryByRole('region', { name: 'Library' })) fireEvent.click(screen.getByRole('button', { name: 'Library' }))
  return panel()
}
const saveAs = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: /^Save( \(unsaved changes\))?$/ }))
  fireEvent.change(within(panel()).getByRole('textbox', { name: 'Graph name' }), { target: { value: name } })
  fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }))
}
const index = () => JSON.parse(window.localStorage.getItem(LIBRARY_INDEX_KEY)!) as { entries: { name: string; folder?: string[] }[] }
const archiveFile = (bytes: Uint8Array, name = 'library.zip') =>
  ({ name, type: 'application/zip', size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer }) as unknown as File

async function exportedArchive(): Promise<Uint8Array> {
  const library = openLibrary()
  revealActions(library, 'More library actions')
  fireEvent.click(within(library).getByRole('button', { name: 'Export library' }))
  await waitFor(() => expect(blobs).toHaveLength(1))
  return new Uint8Array(await blobs[0].arrayBuffer())
}

describe('library archives (STORE-017, STORE-018)', () => {
  it('exports the library as a .zip and imports it back into an Imported folder', async () => {
    render(<App />)
    saveAs('Rotation talk')
    const bytes = await exportedArchive()
    expect(openZip(bytes).map((entry) => entry.path)).toEqual(['Rotation talk.gamut.json', 'manifest.json'])
    expect(within(panel()).getByRole('group', { name: 'Library archive' })).toHaveTextContent(/^Exported 1 graph to gamut-library-\d{4}-\d{2}-\d{2}\.zip\./)

    fireEvent.change(within(panel()).getByLabelText('Library archive to import'), { target: { files: [archiveFile(bytes)] } })
    await waitFor(() => expect(index().entries).toHaveLength(2))
    expect(index().entries[1]).toMatchObject({ name: 'Rotation talk', folder: [expect.stringMatching(/^Imported \d{4}-\d{2}-\d{2}$/)] })
    expect(within(panel()).getByRole('group', { name: 'Library archive' })).toHaveTextContent(/^Imported 1 graph into the folder Imported \d{4}-\d{2}-\d{2}\./)
    expect(within(panel()).getByRole('button', { name: /^Folder Imported .*, level 1, 1 graph$/ })).toBeInTheDocument()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Dismiss' }))
    expect(within(panel()).queryByRole('group', { name: 'Library archive' })).not.toBeInTheDocument()
  })

  it('imports a .zip dropped on the window and opens the library', async () => {
    render(<App />)
    saveAs('Rotation talk')
    const bytes = await exportedArchive()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close library' }))
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [archiveFile(bytes)] } })
    await waitFor(() => expect(index().entries).toHaveLength(2))
    // Dropped while Examples is shown, the summary still appears, in My library.
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Examples' }))
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [archiveFile(bytes)] } })
    await waitFor(() => expect(index().entries).toHaveLength(3))
    await waitFor(() => expect(within(panel()).getByRole('tab', { name: 'My library' })).toHaveAttribute('aria-selected', 'true'))
    expect(within(panel()).getByRole('group', { name: 'Library archive' })).toHaveTextContent(/^Imported 1 graph/)
    // The open graph is untouched.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('rejects a file that is not an archive, with a diagnostic and no write', async () => {
    render(<App />)
    saveAs('Rotation talk')
    openLibrary()
    const before = window.localStorage.getItem(LIBRARY_INDEX_KEY)
    fireEvent.change(within(panel()).getByLabelText('Library archive to import'),
      { target: { files: [archiveFile(new TextEncoder().encode('this is not a zip archive'))] } })
    await waitFor(() => expect(within(panel()).getByRole('alert')).toHaveTextContent('ARCHIVE_INVALID: The file is not a valid .zip archive.'))
    expect(window.localStorage.getItem(LIBRARY_INDEX_KEY)).toBe(before)
  })

  it('keeps export but not import in a temporary shared-scene session', async () => {
    const shared = toCanonicalDocument(expressionDocument([{ id: 'item-1', source: 'Shared = vector(3, 4)' }], {}, { id: 'shared', title: 'A shared scene' }), 'light')
    window.history.replaceState(null, '', '/' + await encodeSceneFragment(shared))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)'))
    openLibrary()
    revealActions(panel(), 'More library actions')
    const importButton = within(panel()).getByRole('button', { name: 'Import library' })
    expect(importButton).toHaveAttribute('aria-disabled', 'true')
    expect(importButton).toHaveAccessibleDescription('Import library is unavailable in a temporary shared scene, which does not use browser storage.')
    const bytes = await exportedArchive()
    expect(openZip(bytes).map((entry) => entry.path)).toEqual(['manifest.json'])
    fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [archiveFile(bytes)] } })
    await waitFor(() => expect(within(panel()).getByRole('alert')).toHaveTextContent(/^LIBRARY_IMPORT_TEMPORARY: /))
    expect(window.localStorage.getItem(LIBRARY_INDEX_KEY)).toBeNull()
  })
})
