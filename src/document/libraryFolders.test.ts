import { describe, expect, it } from 'vitest'
import { serializeCanonicalDocument, toCanonicalDocument, type CanonicalDocument } from './canonicalDocument'
import {
  addCopyToLibrary,
  createLibraryFolder,
  deleteLibraryFolder,
  duplicateInLibrary,
  entryFolder,
  LIBRARY_FOLDERS_KEY,
  LIBRARY_INDEX_KEY,
  libraryDocumentKey,
  libraryFolderEntries,
  moveInLibrary,
  readLibrary,
  removeFromLibrary,
  renameInLibrary,
  renameLibraryFolder,
  saveToLibrary,
  type LibraryEntry,
  type LibraryStorage,
} from './documentLibrary'
import { expressionDocument } from './expressionDocument'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const state = { failWrites: (_key: string) => false }
  const storage: LibraryStorage = {
    get length() { return values.size },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (state.failWrites(key)) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      values.set(key, value)
    },
    removeItem: (key) => { values.delete(key) },
  }
  return { storage, values, state }
}

function graph(id: string, title: string): CanonicalDocument {
  return toCanonicalDocument(expressionDocument([{ id: 'item-1', source: 'vector(1, 2)' }], {}, { id, title }), 'light')
}

const NOW = '2026-11-12T10:00:00.000Z'
const options = { now: NOW, migrationSource: null }

/** The index parsing rules of release 0.2.0 (`documentLibrary.ts` of v0.2.0), kept here as a fixture. */
function read020(source: string): string[] {
  const isEntry020 = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return false
    const entry = value as Record<string, unknown>
    return ['id', 'name', 'algebraId', 'createdAt', 'updatedAt']
      .every((field) => typeof entry[field] === 'string') && entry.id !== ''
  }
  const parsed = JSON.parse(source) as { version?: unknown; entries?: unknown }
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('0.2.0 rebuilds the index')
  return parsed.entries.filter(isEntry020).map((entry) => (entry as LibraryEntry).id)
}

/** A library with a graph in `VGA › Rotors`, one at the root, and an empty folder `Drafts`. */
function sample() {
  const memory = memoryStorage()
  const { storage } = memory
  saveToLibrary(storage, graph('rotor', 'Rotor'), 'Rotor', { ...options, boundId: null, folder: ['VGA', 'Rotors'] })
  saveToLibrary(storage, graph('root', 'Root'), 'Root', { ...options, boundId: null })
  createLibraryFolder(storage, ['Drafts'], options)
  return memory
}

const folderOf = (storage: LibraryStorage, id: string) =>
  entryFolder(readLibrary(storage, options).entries.find((entry) => entry.id === id)!)

describe('library folders (STORE-016)', () => {
  it('stores the folder as a name list on the entry and empty folders under their own key', () => {
    const { storage, values } = sample()
    const index = JSON.parse(values.get(LIBRARY_INDEX_KEY)!) as { version: number; entries: LibraryEntry[] }
    expect(index.version).toBe(1)
    expect(index.entries.map((entry) => [entry.id, entry.folder])).toEqual([['rotor', ['VGA', 'Rotors']], ['root', undefined]])
    expect(JSON.parse(values.get(LIBRARY_FOLDERS_KEY)!)).toEqual({ version: 1, folders: [['Drafts']] })
    expect(readLibrary(storage, options).folders).toEqual([['VGA'], ['VGA', 'Rotors'], ['Drafts']])
  })

  it('keeps every entry under the 0.2.0 parsing rules', () => {
    const { values } = sample()
    expect(read020(values.get(LIBRARY_INDEX_KEY)!)).toEqual(['rotor', 'root'])
  })

  it('opens a 0.2.0 index unchanged, with every graph at the root', () => {
    const entry = { id: 'old', name: 'Old', algebraId: 'org.multivector.vga', createdAt: NOW, updatedAt: NOW }
    const { storage } = memoryStorage({
      [LIBRARY_INDEX_KEY]: JSON.stringify({ version: 1, entries: [entry] }),
      [libraryDocumentKey('old')]: serializeCanonicalDocument(graph('old', 'Old')),
    })
    expect(readLibrary(storage, options)).toEqual({ entries: [entry], folders: [], diagnostic: null })
    expect(entryFolder(entry)).toEqual([])
  })

  it('lists at the root an entry whose folder is not a list of names, and keeps the value', () => {
    const entries = [
      { id: 'a', name: 'A', algebraId: '', createdAt: NOW, updatedAt: NOW, folder: 'VGA/Rotors' },
      { id: 'b', name: 'B', algebraId: '', createdAt: NOW, updatedAt: NOW, folder: ['', 'x'] },
      { id: 'c', name: 'C', algebraId: '', createdAt: NOW, updatedAt: NOW, folder: [] },
    ]
    const { storage, values } = memoryStorage({
      [LIBRARY_INDEX_KEY]: JSON.stringify({ version: 1, entries }),
      [libraryDocumentKey('a')]: serializeCanonicalDocument(graph('a', 'A')),
    })
    const read = readLibrary(storage, options)
    expect(read.entries.map(entryFolder)).toEqual([[], [], []])
    expect(read.folders).toEqual([])
    renameInLibrary(storage, 'a', 'A2', options)
    expect((JSON.parse(values.get(LIBRARY_INDEX_KEY)!) as { entries: LibraryEntry[] }).entries[0].folder).toBe('VGA/Rotors')
  })

  it('moves a graph to the root when 0.2.0 saves it, since it rewrites the entry without folder', () => {
    const { storage, values } = sample()
    // 0.2.0 rebuilds the entry from its five fields when it saves a graph.
    const index = JSON.parse(values.get(LIBRARY_INDEX_KEY)!) as { version: 1; entries: LibraryEntry[] }
    values.set(LIBRARY_INDEX_KEY, JSON.stringify({
      version: 1,
      entries: index.entries.map(({ folder: _folder, ...rest }) => rest),
    }))
    expect(folderOf(storage, 'rotor')).toEqual([])
    expect(readLibrary(storage, options).entries).toHaveLength(2)
  })

  it('keeps the folder when a graph is saved again, renamed, or duplicated', () => {
    const { storage } = sample()
    saveToLibrary(storage, graph('rotor', 'Rotor'), 'Rotor v2', { ...options, boundId: 'rotor' })
    expect(folderOf(storage, 'rotor')).toEqual(['VGA', 'Rotors'])
    renameInLibrary(storage, 'rotor', 'Rotor v3', options)
    expect(folderOf(storage, 'rotor')).toEqual(['VGA', 'Rotors'])
    let next = 0
    const copy = duplicateInLibrary(storage, 'rotor', { ...options, createId: () => `copy-${next++}` })
    expect(folderOf(storage, copy.id)).toEqual(['VGA', 'Rotors'])
  })

  it('accepts folder names containing a slash', () => {
    const { storage } = memoryStorage()
    createLibraryFolder(storage, ['a/b'], options)
    createLibraryFolder(storage, ['a'], options)
    expect(readLibrary(storage, options).folders).toEqual([['a/b'], ['a']])
  })

  it('refuses empty, duplicate, too deep, and orphan folders', () => {
    const { storage } = sample()
    expect(() => createLibraryFolder(storage, [''], options)).toThrow(expect.objectContaining({ code: 'FOLDER_NAME_EMPTY' }))
    expect(() => createLibraryFolder(storage, ['Drafts'], options)).toThrow(expect.objectContaining({ code: 'FOLDER_NAME_TAKEN' }))
    expect(() => createLibraryFolder(storage, ['Missing', 'X'], options)).toThrow(expect.objectContaining({ code: 'LIBRARY_FOLDER_MISSING' }))
    let path: string[] = []
    for (let depth = 1; depth <= 8; depth += 1) {
      path = [...path, `L${depth}`]
      createLibraryFolder(storage, path, options)
    }
    expect(() => createLibraryFolder(storage, [...path, 'L9'], options)).toThrow(expect.objectContaining({ code: 'LIMIT_FOLDER_DEPTH' }))
  })

  it('moves a graph into, between, and out of folders, and keeps a folder it empties', () => {
    const { storage, values } = sample()
    moveInLibrary(storage, 'root', ['Drafts'], options)
    expect(folderOf(storage, 'root')).toEqual(['Drafts'])
    expect(values.has(LIBRARY_FOLDERS_KEY)).toBe(false)
    moveInLibrary(storage, 'rotor', [], options)
    expect(folderOf(storage, 'rotor')).toEqual([])
    expect(readLibrary(storage, options).folders).toEqual([['Drafts'], ['VGA'], ['VGA', 'Rotors']])
    expect(() => moveInLibrary(storage, 'rotor', ['Nowhere'], options)).toThrow(expect.objectContaining({ code: 'LIBRARY_FOLDER_MISSING' }))
  })

  it('keeps the folder of a deleted graph', () => {
    const { storage } = sample()
    removeFromLibrary(storage, 'rotor', options)
    expect(readLibrary(storage, options).folders).toEqual([['VGA'], ['VGA', 'Rotors'], ['Drafts']])
  })

  it('renames a folder with its graphs and subfolders', () => {
    const { storage } = sample()
    renameLibraryFolder(storage, ['VGA'], 'Vectors', options)
    expect(folderOf(storage, 'rotor')).toEqual(['Vectors', 'Rotors'])
    expect(readLibrary(storage, options).folders).toEqual([['Vectors'], ['Vectors', 'Rotors'], ['Drafts']])
    expect(() => renameLibraryFolder(storage, ['Vectors'], 'Drafts', options)).toThrow(expect.objectContaining({ code: 'FOLDER_NAME_TAKEN' }))
  })

  it('deletes a non-empty folder with its subfolders and graphs', () => {
    const { storage, values } = sample()
    createLibraryFolder(storage, ['VGA', 'Empty'], options)
    expect(libraryFolderEntries(readLibrary(storage, options).entries, ['VGA']).map((entry) => entry.id)).toEqual(['rotor'])
    const deleted = deleteLibraryFolder(storage, ['VGA'], options)
    expect(deleted.deletedIds).toEqual(['rotor'])
    expect(values.has(libraryDocumentKey('rotor'))).toBe(false)
    expect(readLibrary(storage, options)).toEqual(expect.objectContaining({
      entries: [expect.objectContaining({ id: 'root' })],
      folders: [['Drafts']],
    }))
  })

  it('leaves the library as it was when a folder write fails', () => {
    const { storage, values, state } = sample()
    const before = new Map(values)
    state.failWrites = (key) => key === LIBRARY_INDEX_KEY
    expect(() => renameLibraryFolder(storage, ['Drafts'], 'Later', options)).toThrow()
    expect(() => createLibraryFolder(storage, ['New'], options)).toThrow()
    expect(values).toEqual(before)
  })

  it('adds an example under its folder path, creating the folders that are missing', () => {
    const { storage } = sample()
    const added = addCopyToLibrary(storage, graph('example', 'Example'), { ...options, folder: ['VGA', 'Rotors'], createId: () => 'copy-1' })
    expect(folderOf(storage, added.id)).toEqual(['VGA', 'Rotors'])
    const other = addCopyToLibrary(storage, graph('example', 'Example'), { ...options, folder: ['PGA(2)'], createId: () => 'copy-2' })
    expect(folderOf(storage, other.id)).toEqual(['PGA(2)'])
    expect(readLibrary(storage, options).folders).toContainEqual(['PGA(2)'])
  })
})
