import { describe, expect, it } from 'vitest'
import { serializeCanonicalDocument, toCanonicalDocument, type CanonicalDocument } from './canonicalDocument'
import {
  comparableSource,
  copyName,
  duplicateInLibrary,
  groupLibraryEntries,
  LIBRARY_INDEX_KEY,
  libraryDocumentKey,
  LibraryError,
  loadFromLibrary,
  prepareLibrary,
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
  const state = { failWrites: (_key: string) => false, writes: 0 }
  const storage: LibraryStorage = {
    get length() { return values.size },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (state.failWrites(key)) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      state.writes += 1
      values.set(key, value)
    },
    removeItem: (key) => {
      state.writes += 1
      values.delete(key)
    },
  }
  return { storage, values, state }
}

function graph(id: string, title: string, source = 'vector(1, 2)'): CanonicalDocument {
  return toCanonicalDocument(expressionDocument([{ id: 'item-1', source }], {}, { id, title }), 'light')
}

const NOW = '2026-11-09T10:00:00.000Z'
const LATER = '2026-11-09T11:00:00.000Z'
const ids = (storage: LibraryStorage) => readLibrary(storage).entries.map((entry) => entry.id)
const save = (storage: LibraryStorage, document: CanonicalDocument, name: string, boundId: string | null = document.id, now = NOW) =>
  saveToLibrary(storage, document, name, { boundId, now })

describe('local library (#212)', () => {
  it('lists the former active document without writing, and migrates it once at the first write', () => {
    const active = graph('active', 'Course scene')
    const { storage, values, state } = memoryStorage({ [ACTIVE_DOCUMENT_KEY]: serializeCanonicalDocument(active) })

    expect(readLibrary(storage, { now: NOW })).toEqual({
      entries: [{ id: 'active', name: 'Course scene', algebraId: active.algebra.algebraId, createdAt: NOW, updatedAt: NOW }],
      diagnostic: null,
    })
    expect(state.writes).toBe(0)

    // The first write, of another graph, stores the former document first.
    save(storage, graph('b', 'B'), 'B')
    expect(loadFromLibrary(storage, 'active')).toEqual(active)
    expect(values.get(ACTIVE_DOCUMENT_KEY)).toBe(serializeCanonicalDocument(active))
    expect(ids(storage)).toEqual(['active', 'b'])

    // Deleting the migrated entry does not bring it back.
    removeFromLibrary(storage, 'active')
    expect(ids(storage)).toEqual(['b'])
  })

  it('migrates the active document read before the first autosave, not the current one', () => {
    const former = graph('former', 'Former')
    const { storage } = memoryStorage({ [ACTIVE_DOCUMENT_KEY]: serializeCanonicalDocument(graph('former', 'Edited since')) })
    prepareLibrary(storage, { migrationSource: serializeCanonicalDocument(former) })
    expect(loadFromLibrary(storage, 'former').metadata.title).toBe('Former')

    // A first visit has no former document, even once the autosave wrote one.
    const first = memoryStorage({ [ACTIVE_DOCUMENT_KEY]: serializeCanonicalDocument(graph('default', 'Default')) })
    prepareLibrary(first.storage, { migrationSource: null })
    expect(ids(first.storage)).toEqual([])
  })

  it('creates, renames, and deletes graphs that survive a new read', () => {
    const { storage } = memoryStorage()
    save(storage, graph('a', 'A'), 'Talk')
    save(storage, graph('b', 'B'), 'Course')
    renameInLibrary(storage, 'a', 'Talk, final', { now: LATER })
    expect(readLibrary(storage).entries.map((entry) => entry.name)).toEqual(['Talk, final', 'Course'])
    expect(loadFromLibrary(storage, 'a').metadata.title).toBe('Talk, final')

    const { entries } = save(storage, graph('a', 'Talk, final', 'vector(3, 4)'), 'Talk, final', 'a', LATER)
    expect(entries.find((entry) => entry.id === 'a')).toMatchObject({ createdAt: NOW, updatedAt: LATER })
    expect(loadFromLibrary(storage, 'a').items[0].source).toBe('vector(3, 4)')

    removeFromLibrary(storage, 'b')
    expect(ids(storage)).toEqual(['a'])
    expect(() => loadFromLibrary(storage, 'b')).toThrow(LibraryError)
  })

  it('never overwrites another graph with a document that only shares its identity', () => {
    const { storage } = memoryStorage()
    save(storage, graph('local-document', 'Saved default'), 'Saved default')
    const fresh = () => 'fresh-id'
    const imported = saveToLibrary(storage, graph('local-document', 'Import', 'vector(9, 9)'), 'Import', {
      boundId: null, createId: fresh,
    })
    expect(imported.id).toBe('fresh-id')
    expect(loadFromLibrary(storage, 'local-document').metadata.title).toBe('Saved default')
    expect(loadFromLibrary(storage, 'fresh-id').items[0].source).toBe('vector(9, 9)')
    // A graph bound to that identity does replace its own revision.
    save(storage, graph('local-document', 'Saved default', 'vector(5, 5)'), 'Saved default', 'local-document')
    expect(loadFromLibrary(storage, 'local-document').items[0].source).toBe('vector(5, 5)')
  })

  it('reads the index again before each write, so another tab’s graphs are kept', () => {
    const { storage } = memoryStorage()
    save(storage, graph('a', 'A'), 'A')
    const staleTab = readLibrary(storage).entries
    save(storage, graph('b', 'B'), 'B')
    expect(staleTab.map((entry) => entry.id)).toEqual(['a'])
    save(storage, graph('c', 'C'), 'C')
    expect(ids(storage)).toEqual(['a', 'b', 'c'])
    // An identity taken by another tab meanwhile is not overwritten either.
    const collision = saveToLibrary(storage, graph('b', 'Mine'), 'Mine', { boundId: null, createId: () => 'mine' })
    expect(collision.id).toBe('mine')
    expect(loadFromLibrary(storage, 'b').metadata.title).toBe('B')
  })

  it('keeps the last valid revision of a graph when a write fails', () => {
    const { storage, state } = memoryStorage()
    const { entries } = save(storage, graph('a', 'A'), 'A')
    state.failWrites = (key) => key === libraryDocumentKey('a')
    expect(() => save(storage, graph('a', 'A', 'vector(9, 9)'), 'A', 'a', LATER))
      .toThrow(expect.objectContaining({ code: 'LIBRARY_WRITE_FAILED' }))
    expect(loadFromLibrary(storage, 'a').items[0].source).toBe('vector(1, 2)')
    expect(readLibrary(storage).entries).toEqual(entries)
  })

  it('puts a graph back when its index cannot be written, so nothing is orphaned or misreported', () => {
    const { storage, values, state } = memoryStorage()
    save(storage, graph('a', 'A'), 'A')
    state.failWrites = (key) => key === LIBRARY_INDEX_KEY

    // A new graph is removed again.
    expect(() => save(storage, graph('b', 'B'), 'B'))
      .toThrow(expect.objectContaining({ code: 'LIBRARY_WRITE_FAILED', message: expect.stringContaining('last saved revision was kept') }))
    expect(values.has(libraryDocumentKey('b'))).toBe(false)
    expect(ids(storage)).toEqual(['a'])

    // An existing graph gets its previous revision back.
    expect(() => save(storage, graph('a', 'A', 'vector(8, 8)'), 'A', 'a')).toThrow(LibraryError)
    expect(loadFromLibrary(storage, 'a').items[0].source).toBe('vector(1, 2)')
    expect(() => renameInLibrary(storage, 'a', 'Renamed')).toThrow(LibraryError)
    expect(loadFromLibrary(storage, 'a').metadata.title).toBe('A')
  })

  it('lists a graph whose index entry is invalid again, and keeps it at the next write', () => {
    const { storage, values } = memoryStorage()
    save(storage, graph('a', 'Kept'), 'Kept')
    save(storage, graph('b', 'Other'), 'Other')
    const index = JSON.parse(values.get(LIBRARY_INDEX_KEY)!)
    index.entries[0] = { id: 'a', name: 42 }
    values.set(LIBRARY_INDEX_KEY, JSON.stringify(index))

    const read = readLibrary(storage)
    expect(read.diagnostic).toMatch(/^LIBRARY_ENTRY_INVALID/)
    expect(read.entries.map((entry) => [entry.id, entry.name])).toEqual([['b', 'Other'], ['a', 'Kept']])
    save(storage, graph('c', 'C'), 'C')
    expect(ids(storage).sort()).toEqual(['a', 'b', 'c'])
    expect(readLibrary(storage).diagnostic).toBeNull()
  })

  it('isolates a corrupted graph from the others, and reports it as unreadable', () => {
    const { storage, values } = memoryStorage()
    save(storage, graph('good', 'Good'), 'Good')
    save(storage, graph('bad', 'Bad'), 'Bad')
    values.set(libraryDocumentKey('bad'), '{"not": "a document"')

    expect(ids(storage)).toEqual(['good', 'bad'])
    expect(() => loadFromLibrary(storage, 'bad')).toThrow(expect.objectContaining({ code: 'LIBRARY_ENTRY_INVALID' }))
    expect(() => renameInLibrary(storage, 'bad', 'Renamed')).toThrow(expect.objectContaining({ code: 'LIBRARY_ENTRY_INVALID' }))
    expect(() => duplicateInLibrary(storage, 'bad')).toThrow(expect.objectContaining({ code: 'LIBRARY_ENTRY_INVALID' }))
    expect(loadFromLibrary(storage, 'good').metadata.title).toBe('Good')
  })

  it('rebuilds a corrupted index from the stored graphs, without writing until the next write', () => {
    const { storage, values, state } = memoryStorage()
    save(storage, graph('a', 'Kept'), 'Kept')
    values.set(LIBRARY_INDEX_KEY, 'garbage')
    const writes = state.writes
    const read = readLibrary(storage, { now: LATER })
    expect(read.entries).toMatchObject([{ id: 'a', name: 'Kept' }])
    expect(read.diagnostic).toMatch(/^LIBRARY_INDEX_REBUILT/)
    expect(state.writes).toBe(writes)
    expect(values.get(LIBRARY_INDEX_KEY)).toBe('garbage')
    save(storage, graph('b', 'B'), 'B')
    expect(readLibrary(storage)).toMatchObject({ diagnostic: null, entries: [{ id: 'a' }, { id: 'b' }] })
  })

  it('names successive duplicates distinctly', () => {
    const { storage } = memoryStorage()
    save(storage, graph('a', 'Talk'), 'Talk')
    duplicateInLibrary(storage, 'a')
    duplicateInLibrary(storage, 'a')
    duplicateInLibrary(storage, 'a')
    expect(readLibrary(storage).entries.map((entry) => entry.name)).toEqual(['Talk', 'Talk copy', 'Talk copy 2', 'Talk copy 3'])
    expect(copyName('X', ['X', 'X copy', 'X copy 3'])).toBe('X copy 2')
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
    expect(() => saveToLibrary(null, graph('a', 'A'), 'A', { boundId: null })).toThrow(expect.objectContaining({ code: 'LIBRARY_UNAVAILABLE' }))
    expect(() => saveToLibrary(throwing, graph('a', 'A'), 'A', { boundId: null })).toThrow(expect.objectContaining({ code: 'LIBRARY_UNAVAILABLE' }))
  })

  it('ignores the viewport centre and zoom when telling unsaved changes', () => {
    const saved = graph('a', 'A')
    const moved = { ...saved, view: { ...saved.view, viewport: { kind: 'two-dimensional' as const, centerX: 3, centerY: -1, zoom: 2.5 } } }
    expect(comparableSource(moved)).toBe(comparableSource(saved))
    expect(comparableSource(graph('a', 'A', 'vector(0, 1)'))).not.toBe(comparableSource(saved))
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
