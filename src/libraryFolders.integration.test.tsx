import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { LIBRARY_FOLDERS_KEY, LIBRARY_INDEX_KEY, libraryDocumentKey } from './document/documentLibrary'
import { expressionDocument } from './document/expressionDocument'
import { encodeSceneFragment } from './document/sceneLink'
import { LIBRARY_COLLAPSED_FOLDERS_KEY } from './hooks/useLibraryFolderCollapse'

beforeEach(() => {
  // Browser storage is used outside the test mode only.
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
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
const index = () => JSON.parse(window.localStorage.getItem(LIBRARY_INDEX_KEY)!) as { version: number; entries: { name: string; folder?: string[] }[] }
const folderButton = (name: string) => within(panel()).getByRole('button', { name: new RegExp(`^Folder ${name}, level`) })
const createFolder = (name: string, inside?: string) => {
  fireEvent.click(within(panel()).getByRole('button', { name: inside ? `New folder in ${inside}` : '+ New folder' }))
  const field = within(panel()).getByRole('textbox', { name: /^Name of folder / })
  fireEvent.change(field, { target: { value: name } })
  fireEvent.keyDown(field, { key: 'Enter' })
}

describe('library folders (STORE-016, A11Y-011)', () => {
  it('creates, nests, and renames folders, and moves a graph by its menu', async () => {
    render(<App />)
    saveAs('Rotation talk')
    openLibrary()
    createFolder('Talks')
    expect(folderButton('Talks')).toHaveAccessibleName('Folder Talks, level 1, 0 graphs')
    createFolder('2026', 'Talks')
    expect(folderButton('2026')).toHaveAccessibleName('Folder 2026, level 2, 0 graphs')
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_FOLDERS_KEY)!)).toEqual({ version: 1, folders: [['Talks'], ['Talks', '2026']] })

    const move = within(panel()).getByRole('combobox', { name: 'Move Rotation talk to folder' })
    fireEvent.change(move, { target: { value: JSON.stringify(['Talks', '2026']) } })
    expect(index().entries[0].folder).toEqual(['Talks', '2026'])
    expect(index().version).toBe(1)
    expect(folderButton('Talks')).toHaveAccessibleName('Folder Talks, level 1, 1 graph')
    expect(within(panel()).getByText('Moved Rotation talk to folder Talks › 2026.')).toBeInTheDocument()
    await waitFor(() => expect(within(panel()).getByRole('combobox', { name: 'Move Rotation talk to folder' })).toHaveFocus())

    fireEvent.click(within(panel()).getByRole('button', { name: 'Rename folder Talks' }))
    const field = within(panel()).getByRole('textbox', { name: 'Name of folder Talks' })
    fireEvent.change(field, { target: { value: 'Lectures/2026' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(index().entries[0].folder).toEqual(['Lectures/2026', '2026'])
  })

  it('remembers collapsed folders per browser', () => {
    render(<App />)
    saveAs('Rotation talk')
    openLibrary()
    createFolder('Talks')
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Move Rotation talk to folder' }),
      { target: { value: JSON.stringify(['Talks']) } })
    fireEvent.click(folderButton('Talks'))
    expect(folderButton('Talks')).toHaveAttribute('aria-expanded', 'false')
    expect(within(panel()).queryByRole('button', { name: 'Open Rotation talk' })).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Open Rotation talk', hidden: true }).closest('li')).not.toBeVisible()
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_COLLAPSED_FOLDERS_KEY)!).mine).toEqual([JSON.stringify(['Talks'])])
    cleanup()
    render(<App />)
    openLibrary()
    expect(folderButton('Talks')).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps focus on a renamed folder, with its collapsed state, and forgets it once deleted', async () => {
    render(<App />)
    openLibrary()
    createFolder('Talks')
    await waitFor(() => expect(folderButton('Talks')).toHaveFocus())
    fireEvent.click(folderButton('Talks'))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Rename folder Talks' }))
    const field = within(panel()).getByRole('textbox', { name: 'Name of folder Talks' })
    fireEvent.change(field, { target: { value: 'Lectures' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(folderButton('Lectures')).toHaveAttribute('aria-expanded', 'false')
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_COLLAPSED_FOLDERS_KEY)!).mine).toEqual([JSON.stringify(['Lectures'])])
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove folder Lectures' }))
    expect(within(panel()).getByText('Folder Lectures deleted.')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(LIBRARY_COLLAPSED_FOLDERS_KEY)!).mine).toEqual([])
  })

  it('shows a new folder while an algebra filter is active', () => {
    render(<App />)
    saveAs('Rotation talk')
    openLibrary()
    const filters = within(within(panel()).getByRole('group', { name: 'Filter by algebra' })).getAllByRole('button')
    fireEvent.click(filters[filters.length - 1])
    createFolder('Talks')
    expect(folderButton('Talks')).toBeInTheDocument()
  })

  it('opens every collapsed folder above a graph moved into a subfolder', () => {
    render(<App />)
    saveAs('Rotation talk')
    openLibrary()
    createFolder('Talks')
    createFolder('2026', 'Talks')
    fireEvent.click(folderButton('Talks'))
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Move Rotation talk to folder' }),
      { target: { value: JSON.stringify(['Talks', '2026']) } })
    expect(folderButton('Talks')).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel()).getByRole('button', { name: 'Open Rotation talk' })).toBeVisible()
  })

  it('follows a folder created in another tab', () => {
    render(<App />)
    openLibrary()
    window.localStorage.setItem(LIBRARY_FOLDERS_KEY, JSON.stringify({ version: 1, folders: [['Elsewhere']] }))
    fireEvent(window, new StorageEvent('storage', { key: LIBRARY_FOLDERS_KEY }))
    expect(folderButton('Elsewhere')).toBeInTheDocument()
  })

  it('deletes a non-empty folder after a confirmation that states how many graphs', () => {
    render(<App />)
    saveAs('One')
    openLibrary()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save as new graph…' }))
    fireEvent.change(within(panel()).getByRole('textbox', { name: 'Graph name' }), { target: { value: 'Two' } })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }))
    openLibrary()
    createFolder('Old')
    for (const name of ['One', 'Two']) {
      fireEvent.change(within(panel()).getByRole('combobox', { name: `Move ${name} to folder` }),
        { target: { value: JSON.stringify(['Old']) } })
    }
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove folder Old' }))
    const confirm = within(panel()).getByRole('alertdialog', { name: 'Confirm' })
    expect(confirm).toHaveTextContent('Delete the folder “Old” with its subfolders and the 2 graphs it contains?')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(index().entries).toHaveLength(2)
    fireEvent.click(within(panel()).getByRole('button', { name: 'Remove folder Old' }))
    fireEvent.click(within(panel()).getByRole('button', { name: 'Delete folder and 2 graphs' }))
    expect(index().entries).toHaveLength(0)
    expect(within(panel()).queryByRole('button', { name: /^Folder Old/ })).not.toBeInTheDocument()
  })

  it('shows Examples in a read-only folder tree and adds an example under its folder path', () => {
    render(<App />)
    openLibrary()
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Examples' }))
    const examples = within(panel()).getByRole('list', { name: 'Examples' })
    expect(within(examples).getByRole('button', { name: /^Folder VGA\(2\), level 1, 1 graph$/ })).toBeInTheDocument()
    expect(within(examples).queryByRole('button', { name: /^(Rename|Remove) folder/ })).not.toBeInTheDocument()
    fireEvent.click(within(examples).getByRole('button', { name: 'Add PGA 2D Triangle Example to my library' }))
    expect(index().entries.find((entry) => entry.name === 'PGA 2D Triangle Example')?.folder).toEqual(['PGA(2)'])
  })

  it('moves a graph by drag and drop onto a folder', () => {
    render(<App />)
    saveAs('Rotation talk')
    openLibrary()
    createFolder('Talks')
    const graphRow = within(panel()).getByRole('button', { name: 'Open Rotation talk' }).closest('li')!
    fireEvent.dragStart(graphRow)
    const folderRow = folderButton('Talks').closest('li')!
    fireEvent.dragOver(folderRow)
    fireEvent.drop(folderRow)
    expect(index().entries[0].folder).toEqual(['Talks'])
    // Dropping on the list moves it back to the root.
    fireEvent.dragStart(within(panel()).getByRole('button', { name: 'Open Rotation talk' }).closest('li')!)
    fireEvent.drop(within(panel()).getByRole('list', { name: 'Saved graphs' }))
    expect(index().entries[0].folder).toBeUndefined()
  })

  it('does not write the collapsed state in a temporary shared-scene session', async () => {
    const stored = { id: 'stored', name: 'Stored', algebraId: 'org.multivector.vga', createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', folder: ['Talks'] }
    window.localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify({ version: 1, entries: [stored] }))
    window.localStorage.setItem(libraryDocumentKey('stored'), serializeCanonicalDocument(toCanonicalDocument(
      expressionDocument([{ id: 'item-1', source: 'S = 1' }], {}, { id: 'stored', title: 'Stored' }), 'light')))
    const shared = toCanonicalDocument(expressionDocument([{ id: 'item-1', source: 'Shared = vector(3, 4)' }], {}, { id: 'shared', title: 'A shared scene' }), 'light')
    window.history.replaceState(null, '', '/' + await encodeSceneFragment(shared))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('Shared = vector(3, 4)'))
    openLibrary()
    fireEvent.click(folderButton('Talks'))
    expect(folderButton('Talks')).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem(LIBRARY_COLLAPSED_FOLDERS_KEY)).toBeNull()
  })
})
