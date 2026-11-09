import { describe, expect, it } from 'vitest'
import { serializeCanonicalDocument, toCanonicalDocument, type CanonicalDocument } from './canonicalDocument'
import {
  groupLibraryEntries,
  LIBRARY_INDEX_KEY,
  libraryDocumentKey,
  LibraryError,
  loadFromLibrary,
  readLibrary,
  removeFromLibrary,
  renameInLibrary,
  saveToLibrary,
  type LibraryStorage,
} from './documentLibrary'
import { ACTIVE_DOCUMENT_KEY } from './documentStorage'
import { expressionDocument } from './expressionDocument'

/** An in-memory `Storage` whose writes can be made to fail like a full quota. */
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

function graph(id: string, title: string, source = 'vector(1, 2)'): CanonicalDocument {
  return toCanonicalDocument(expressionDocument([{ id: 'item-1', source }], {}, { id, title }), 'light')
}

const NOW = '2026-11-09T10:00:00.000Z'
const LATER = '2026-11-09T11:00:00.000Z'

describe('local library (#212)', () => {
  it('migrates the former active document once, as the first entry', () => {
    const active = graph('active', 'Course scene')
    const { storage, values } = memoryStorage({ [ACTIVE_DOCUMENT_KEY]: serializeCanonicalDocument(active) })

    const first = readLibrary(storage, NOW)
    expect(first).toEqual({
      entries: [{ id: 'active', name: 'Course scene', algebraId: active.algebra.algebraId, createdAt: NOW, updatedAt: NOW }],
      diagnostic: null,
    })
    expect(loadFromLibrary(storage, 'active')).toEqual(active)
    expect(values.get(ACTIVE_DOCUMENT_KEY)).toBe(serializeCanonicalDocument(active))

    // Deleting the migrated entry does not bring it back on the next launch.
    removeFromLibrary(storage, first.entries, 'active')
    expect(readLibrary(storage, LATER).entries).toEqual([])
  })

  it('creates, renames, and deletes graphs that survive a new read', () => {
    const { storage } = memoryStorage()
    let entries = readLibrary(storage, NOW).entries
    entries = saveToLibrary(storage, entries, graph('a', 'A'), 'Talk', NOW)
    entries = saveToLibrary(storage, entries, graph('b', 'B'), 'Course', NOW)
    entries = renameInLibrary(storage, entries, 'a', 'Talk, final', LATER)
    expect(readLibrary(storage).entries.map((entry) => entry.name)).toEqual(['Talk, final', 'Course'])
    expect(loadFromLibrary(storage, 'a').metadata.title).toBe('Talk, final')

    entries = saveToLibrary(storage, entries, graph('a', 'Talk, final', 'vector(3, 4)'), 'Talk, final', LATER)
    expect(entries.find((entry) => entry.id === 'a')).toMatchObject({ createdAt: NOW, updatedAt: LATER })
    expect(loadFromLibrary(storage, 'a').items[0].source).toBe('vector(3, 4)')

    removeFromLibrary(storage, entries, 'b')
    expect(readLibrary(storage).entries.map((entry) => entry.id)).toEqual(['a'])
    expect(() => loadFromLibrary(storage, 'b')).toThrow(LibraryError)
  })

  it('keeps the last valid revision of a graph when a write fails', () => {
    const { storage, state } = memoryStorage()
    const entries = saveToLibrary(storage, readLibrary(storage, NOW).entries, graph('a', 'A'), 'A', NOW)
    state.failWrites = (key) => key === libraryDocumentKey('a')
    expect(() => saveToLibrary(storage, entries, graph('a', 'A', 'vector(9, 9)'), 'A', LATER))
      .toThrow(expect.objectContaining({ code: 'LIBRARY_WRITE_FAILED' }))
    expect(loadFromLibrary(storage, 'a').items[0].source).toBe('vector(1, 2)')
    expect(readLibrary(storage).entries).toEqual(entries)
  })

  it('isolates a corrupted graph from the others', () => {
    const { storage, values } = memoryStorage()
    let entries = readLibrary(storage, NOW).entries
    entries = saveToLibrary(storage, entries, graph('good', 'Good'), 'Good', NOW)
    entries = saveToLibrary(storage, entries, graph('bad', 'Bad'), 'Bad', NOW)
    values.set(libraryDocumentKey('bad'), '{"not": "a document"')

    expect(readLibrary(storage).entries.map((entry) => entry.id)).toEqual(['good', 'bad'])
    expect(() => loadFromLibrary(storage, 'bad')).toThrow(expect.objectContaining({ code: 'LIBRARY_ENTRY_INVALID' }))
    expect(loadFromLibrary(storage, 'good').metadata.title).toBe('Good')
  })

  it('rebuilds a corrupted index from the stored graphs', () => {
    const { storage, values } = memoryStorage()
    saveToLibrary(storage, readLibrary(storage, NOW).entries, graph('a', 'Kept'), 'Kept', NOW)
    values.set(LIBRARY_INDEX_KEY, 'garbage')
    const read = readLibrary(storage, LATER)
    expect(read.entries).toMatchObject([{ id: 'a', name: 'Kept' }])
    expect(read.diagnostic).toMatch(/^LIBRARY_INDEX_REBUILT/)
  })

  it('reports unavailable storage instead of throwing', () => {
    expect(readLibrary(null).diagnostic).toMatch(/^LIBRARY_UNAVAILABLE/)
    const throwing = {
      get length(): number { throw new DOMException('denied', 'SecurityError') },
      key: () => { throw new DOMException('denied', 'SecurityError') },
      getItem: () => { throw new DOMException('denied', 'SecurityError') },
      setItem: () => { throw new DOMException('denied', 'SecurityError') },
      removeItem: () => { throw new DOMException('denied', 'SecurityError') },
    } satisfies LibraryStorage
    expect(readLibrary(throwing)).toMatchObject({ entries: [], diagnostic: expect.stringMatching(/^LIBRARY_UNAVAILABLE/) })
    expect(() => saveToLibrary(null, [], graph('a', 'A'), 'A')).toThrow(expect.objectContaining({ code: 'LIBRARY_UNAVAILABLE' }))
  })

  it('groups graphs by algebra, most recently modified first', () => {
    const entry = (id: string, algebraId: string, updatedAt: string) =>
      ({ id, name: id, algebraId, createdAt: NOW, updatedAt })
    const groups = groupLibraryEntries([
      entry('p', 'org.multivector.pga', NOW),
      entry('v1', 'org.multivector.vga', NOW),
      entry('v2', 'org.multivector.vga', LATER),
    ], ['org.multivector.vga', 'org.multivector.pga'])
    expect(groups.map((group) => [group.algebraId, group.entries.map((item) => item.id)])).toEqual([
      ['org.multivector.vga', ['v2', 'v1']],
      ['org.multivector.pga', ['p']],
    ])
  })
})
