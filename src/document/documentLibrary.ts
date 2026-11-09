import {
  parseCanonicalDocument,
  serializeCanonicalDocument,
  type CanonicalDocument,
} from './canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './documentStorage'

/**
 * A local library of named graphs (#212). A versioned index lists the
 * graphs; each graph is stored under its own key as the canonical JSON of
 * the document format, so the library adds no second document format. The
 * library entry of a graph is its document identity.
 */
export const LIBRARY_INDEX_KEY = 'gamut.library.v1'
export const LIBRARY_DOCUMENT_PREFIX = 'gamut.library.v1.document.'
export const libraryDocumentKey = (id: string): string => LIBRARY_DOCUMENT_PREFIX + id

export type LibraryEntry = Readonly<{
  id: string
  name: string
  /** Algebra of the stored document, which the library groups by. */
  algebraId: string
  /** ISO 8601 instants. */
  createdAt: string
  updatedAt: string
}>

/** The subset of `Storage` the library uses; any member may throw. */
export type LibraryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

/** Thrown with a user-facing diagnostic when a library operation fails. */
export class LibraryError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
  get diagnostic(): string {
    return `${this.code}: ${this.message}`
  }
}

const UNAVAILABLE = new LibraryError(
  'LIBRARY_UNAVAILABLE',
  'Browser storage is unavailable, so the library cannot be read or saved. The open graph keeps working; JSON export is available.',
)

/** The browser's local storage, or `null` when even reaching it throws. */
export function browserLibraryStorage(): LibraryStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

type IndexFile = Readonly<{ version: 1; entries: readonly LibraryEntry[] }>

const isEntry = (value: unknown): value is LibraryEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return ['id', 'name', 'algebraId', 'createdAt', 'updatedAt']
    .every((field) => typeof entry[field] === 'string') && entry.id !== ''
}

/** Index entries for every stored graph, read from the graphs themselves. */
function rebuiltEntries(storage: LibraryStorage, now: string): LibraryEntry[] {
  const entries: LibraryEntry[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(LIBRARY_DOCUMENT_PREFIX)) continue
    const id = key.slice(LIBRARY_DOCUMENT_PREFIX.length)
    let name = id
    let algebraId = ''
    try {
      const document = parseCanonicalDocument(storage.getItem(key) ?? '')
      name = document.metadata.title || 'Untitled graph'
      algebraId = document.algebra.algebraId
    } catch {
      // Kept with its key as name; opening it reports the problem.
    }
    entries.push({ id, name, algebraId, createdAt: now, updatedAt: now })
  }
  return entries
}

export type LibraryRead = Readonly<{
  entries: readonly LibraryEntry[]
  /** Set when the library could not be read in full; the entries are what could. */
  diagnostic: string | null
}>

/**
 * Reads the library index. A missing index is migrated once from the former
 * single active document (#212): it becomes the first entry, and the active
 * document itself is left in place. A corrupted index is rebuilt from the
 * stored graphs. Never throws: unavailable storage yields an empty library
 * with a diagnostic.
 */
export function readLibrary(storage: LibraryStorage | null, now = new Date().toISOString()): LibraryRead {
  if (!storage) return { entries: [], diagnostic: UNAVAILABLE.diagnostic }
  let source: string | null
  try {
    source = storage.getItem(LIBRARY_INDEX_KEY)
  } catch {
    return { entries: [], diagnostic: UNAVAILABLE.diagnostic }
  }
  if (source === null) return migrateActiveDocument(storage, now)
  try {
    const parsed = JSON.parse(source) as Partial<IndexFile>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('unsupported index')
    const entries = parsed.entries.filter(isEntry)
    return {
      entries,
      diagnostic: entries.length === parsed.entries.length
        ? null
        : 'LIBRARY_ENTRY_INVALID: Some library entries were unreadable and are not listed.',
    }
  } catch {
    let entries: LibraryEntry[] = []
    try {
      entries = rebuiltEntries(storage, now)
      storage.setItem(LIBRARY_INDEX_KEY, JSON.stringify({ version: 1, entries }))
    } catch {
      // The rebuilt list is still shown; the next successful write stores it.
    }
    return {
      entries,
      diagnostic: 'LIBRARY_INDEX_REBUILT: The library index was unreadable and was rebuilt from the stored graphs; names and dates may have been reset.',
    }
  }
}

function migrateActiveDocument(storage: LibraryStorage, now: string): LibraryRead {
  let entries: LibraryEntry[] = []
  let diagnostic: string | null = null
  try {
    const active = storage.getItem(ACTIVE_DOCUMENT_KEY)
    if (active !== null) {
      const document = parseCanonicalDocument(active)
      storage.setItem(libraryDocumentKey(document.id), serializeCanonicalDocument(document))
      entries = [{
        id: document.id,
        name: document.metadata.title || 'Untitled graph',
        algebraId: document.algebra.algebraId,
        createdAt: now,
        updatedAt: now,
      }]
    }
  } catch {
    diagnostic = 'LIBRARY_MIGRATION_SKIPPED: The previously saved document could not be added to the library; it is still open as before.'
    entries = []
  }
  try {
    storage.setItem(LIBRARY_INDEX_KEY, JSON.stringify({ version: 1, entries }))
  } catch {
    // Without an index the migration runs again next time, which is harmless:
    // it rewrites the same entry.
    return { entries, diagnostic: diagnostic ?? UNAVAILABLE.diagnostic }
  }
  return { entries, diagnostic }
}

function writeIndex(storage: LibraryStorage, entries: readonly LibraryEntry[]): void {
  storage.setItem(LIBRARY_INDEX_KEY, JSON.stringify({ version: 1, entries }))
}

/** A failed write: a full quota keeps the last revision; anything else means no storage. */
function writeFailure(error: unknown, full: LibraryError): LibraryError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' ? full : UNAVAILABLE
}

function required(storage: LibraryStorage | null): LibraryStorage {
  if (!storage) throw UNAVAILABLE
  return storage
}

/**
 * Stores a graph under its document identity, creating its entry or updating
 * its name and date. The graph is written before the index, and each write
 * replaces one key at once, so a failed write keeps the last valid revision.
 */
export function saveToLibrary(
  storage: LibraryStorage | null,
  entries: readonly LibraryEntry[],
  document: CanonicalDocument,
  name: string,
  now = new Date().toISOString(),
): readonly LibraryEntry[] {
  const target = required(storage)
  const existing = entries.find((entry) => entry.id === document.id)
  const entry: LibraryEntry = {
    id: document.id,
    name,
    algebraId: document.algebra.algebraId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  const next = existing
    ? entries.map((candidate) => candidate.id === entry.id ? entry : candidate)
    : [...entries, entry]
  try {
    target.setItem(libraryDocumentKey(document.id), serializeCanonicalDocument(document))
    writeIndex(target, next)
  } catch (error) {
    throw writeFailure(error, new LibraryError(
      'LIBRARY_WRITE_FAILED',
      'The graph could not be saved because browser storage is full. The last saved revision was kept.',
    ))
  }
  return next
}

/** Reads one stored graph; a corrupted graph throws its diagnostic without touching others. */
export function loadFromLibrary(storage: LibraryStorage | null, id: string): CanonicalDocument {
  const target = required(storage)
  let source: string | null
  try {
    source = target.getItem(libraryDocumentKey(id))
  } catch {
    throw UNAVAILABLE
  }
  if (source === null) {
    throw new LibraryError('LIBRARY_ENTRY_MISSING', 'This graph is no longer stored in the library.')
  }
  try {
    return parseCanonicalDocument(source)
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new LibraryError('LIBRARY_ENTRY_INVALID', `This graph could not be read.${detail}`)
  }
}

/** The stored canonical text of a graph, or `null`; used to tell unsaved changes. */
export function storedLibrarySource(storage: LibraryStorage | null, id: string): string | null {
  try {
    return storage?.getItem(libraryDocumentKey(id)) ?? null
  } catch {
    return null
  }
}

export function renameInLibrary(
  storage: LibraryStorage | null,
  entries: readonly LibraryEntry[],
  id: string,
  name: string,
  now = new Date().toISOString(),
): readonly LibraryEntry[] {
  const target = required(storage)
  const next = entries.map((entry) => entry.id === id ? { ...entry, name, updatedAt: now } : entry)
  try {
    // The stored title follows the name, so an opened graph shows it.
    const source = target.getItem(libraryDocumentKey(id))
    if (source !== null) {
      const document = parseCanonicalDocument(source)
      target.setItem(libraryDocumentKey(id), serializeCanonicalDocument({
        ...document, metadata: { ...document.metadata, title: name },
      }))
    }
    writeIndex(target, next)
  } catch (error) {
    throw writeFailure(error, new LibraryError('LIBRARY_WRITE_FAILED', 'The graph could not be renamed because browser storage is full; its previous name was kept.'))
  }
  return next
}

export function removeFromLibrary(
  storage: LibraryStorage | null,
  entries: readonly LibraryEntry[],
  id: string,
): readonly LibraryEntry[] {
  const target = required(storage)
  const next = entries.filter((entry) => entry.id !== id)
  try {
    writeIndex(target, next)
    target.removeItem(libraryDocumentKey(id))
  } catch (error) {
    throw writeFailure(error, new LibraryError('LIBRARY_WRITE_FAILED', 'The graph could not be deleted.'))
  }
  return next
}

/** Groups entries by algebra in the given algebra order, most recently modified first within a group. */
export function groupLibraryEntries(
  entries: readonly LibraryEntry[],
  algebraOrder: readonly string[],
): readonly Readonly<{ algebraId: string; entries: readonly LibraryEntry[] }>[] {
  const rank = (algebraId: string) => {
    const index = algebraOrder.indexOf(algebraId)
    return index < 0 ? algebraOrder.length : index
  }
  const ids = [...new Set(entries.map((entry) => entry.algebraId))]
    .sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
  return ids.map((algebraId) => ({
    algebraId,
    entries: entries
      .filter((entry) => entry.algebraId === algebraId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) ||
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
  }))
}
