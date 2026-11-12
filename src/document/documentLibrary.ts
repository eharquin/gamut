import {
  parseCanonicalDocument,
  resolveCanonicalImport,
  serializeCanonicalDocument,
  type CanonicalDocument,
} from './canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './documentStorage'
import {
  folderKey,
  isFolderPath,
  isWithin,
  MAX_LIBRARY_FOLDERS,
  newFolderProblem,
  parentPath,
  replacePrefix,
  withAncestors,
  type FolderPath,
} from './folderModel'

/**
 * A local library of named graphs (#212). A versioned index lists the
 * graphs; each graph is stored under its own key as the canonical JSON of
 * the document format, so the library adds no second document format. The
 * library entry of a graph is its document identity.
 *
 * Reading never writes. Every write first reads the index again, so that a
 * change made in another tab is not overwritten, and only then migrates the
 * former active document or repairs the index if it has to.
 */
export const LIBRARY_INDEX_KEY = 'gamut.library.v1'
export const LIBRARY_DOCUMENT_PREFIX = 'gamut.library.v1.document.'
/** The library graph the autosaved active document belongs to, if any. */
export const LIBRARY_OPEN_KEY = 'gamut.library.v1.open'
export const libraryDocumentKey = (id: string): string => LIBRARY_DOCUMENT_PREFIX + id
/**
 * The folders that no entry names, as `{ version: 1, folders: [[name, …], …] }`
 * (STORE-016). Earlier versions ignore this key; the index keeps version 1.
 */
export const LIBRARY_FOLDERS_KEY = 'gamut.library.v1.folders'

export type LibraryEntry = Readonly<{
  id: string
  name: string
  /** Algebra of the stored document, which the library groups by. */
  algebraId: string
  /** ISO 8601 instants. */
  createdAt: string
  updatedAt: string
  /**
   * The folder of the graph, as folder names from the root (STORE-016);
   * absent at the root. A value that is not a list of folder names is kept as
   * stored and listed at the root.
   */
  folder?: FolderPath
}>

/** The folder an entry is listed in: its `folder` when it is a valid list of names, the root otherwise. */
export function entryFolder(entry: LibraryEntry): FolderPath {
  return isFolderPath(entry.folder) ? entry.folder : []
}

/** The stored empty folders; an unreadable key reads as none. */
function storedFolders(storage: LibraryStorage): FolderPath[] {
  try {
    const parsed = JSON.parse(storage.getItem(LIBRARY_FOLDERS_KEY) ?? 'null') as { version?: unknown; folders?: unknown } | null
    if (parsed?.version !== 1 || !Array.isArray(parsed.folders)) return []
    return parsed.folders.filter((path): path is FolderPath => isFolderPath(path) && path.length > 0)
  } catch {
    return []
  }
}

/** Every folder of the library: those entries name, the stored empty ones, and their ancestors. */
export function libraryFolders(entries: readonly LibraryEntry[], empty: readonly FolderPath[]): FolderPath[] {
  return withAncestors([...entries.map(entryFolder).filter((path) => path.length > 0), ...empty])
}

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

export type LibraryOptions = Readonly<{
  /** The instant written as creation or update time; defaults to now. */
  now?: string
  /**
   * The former active document to migrate while the library has no index:
   * `undefined` reads it from storage at that moment, `null` means there is
   * none. The application reads it before its first autosave and passes it,
   * so that only a document saved by an earlier visit is migrated.
   */
  migrationSource?: string | null
}>

const isEntry = (value: unknown): value is LibraryEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return ['id', 'name', 'algebraId', 'createdAt', 'updatedAt']
    .every((field) => typeof entry[field] === 'string') && entry.id !== ''
}

const untitled = (document: CanonicalDocument) => document.metadata.title.trim() || 'Untitled graph'

/** An index entry for a stored graph that the index does not list, read from the graph itself. */
function recoveredEntry(storage: LibraryStorage, id: string, now: string): LibraryEntry {
  let name = id
  let algebraId = ''
  try {
    const document = parseCanonicalDocument(storage.getItem(libraryDocumentKey(id)) ?? '')
    name = untitled(document)
    algebraId = document.algebra.algebraId
  } catch {
    // Kept with its key as name; opening it reports the problem.
  }
  return { id, name, algebraId, createdAt: now, updatedAt: now }
}

function storedIds(storage: LibraryStorage): string[] {
  const ids: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(LIBRARY_DOCUMENT_PREFIX)) ids.push(key.slice(LIBRARY_DOCUMENT_PREFIX.length))
  }
  return ids
}

/** What a write must do before its own change: migrate the former active document, or nothing. */
type Migration = Readonly<{ document: CanonicalDocument; entry: LibraryEntry }> | null

type Snapshot = Readonly<{
  entries: readonly LibraryEntry[]
  /** Every folder, empty ones included. */
  folders: readonly FolderPath[]
  diagnostic: string | null
  migration: Migration
  /** No index is stored yet: the first write stores one, which ends the migration. */
  indexMissing: boolean
}>

/**
 * The library as stored, without writing anything. Entries of the index that
 * are invalid, and stored graphs that the index does not list (an index that
 * could not be updated after its graph was written), are recovered from the
 * graphs themselves, so the next write lists them again instead of dropping
 * them.
 */
function snapshot(storage: LibraryStorage, options: LibraryOptions): Snapshot {
  const now = options.now ?? new Date().toISOString()
  const source = storage.getItem(LIBRARY_INDEX_KEY)
  if (source === null) return migrationSnapshot(storage, options, now)
  let listed: LibraryEntry[]
  let diagnostic: string | null = null
  try {
    const parsed = JSON.parse(source) as { version?: unknown; entries?: unknown }
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('unsupported index')
    listed = parsed.entries.filter(isEntry)
    if (listed.length !== parsed.entries.length) {
      diagnostic = 'LIBRARY_ENTRY_INVALID: Some library entries were unreadable; the graphs still stored are listed again under their titles.'
    }
  } catch {
    listed = []
    diagnostic = 'LIBRARY_INDEX_REBUILT: The library index was unreadable and was rebuilt from the stored graphs; names and dates may have been reset.'
  }
  const seen = new Set<string>()
  const entries = listed.filter((entry) => !seen.has(entry.id) && seen.add(entry.id))
  for (const id of storedIds(storage)) {
    if (!seen.has(id)) entries.push(recoveredEntry(storage, id, now))
  }
  const folders = libraryFolders(entries, storedFolders(storage))
  return { entries, folders, diagnostic, migration: null, indexMissing: false }
}

function migrationSnapshot(storage: LibraryStorage, options: LibraryOptions, now: string): Snapshot {
  const entries = storedIds(storage).map((id) => recoveredEntry(storage, id, now))
  const folders = libraryFolders([], storedFolders(storage))
  const active = options.migrationSource === undefined ? storage.getItem(ACTIVE_DOCUMENT_KEY) : options.migrationSource
  if (active === null) return { entries, folders, diagnostic: null, migration: null, indexMissing: true }
  let document: CanonicalDocument
  try {
    document = parseCanonicalDocument(active)
  } catch {
    return {
      entries,
      folders,
      diagnostic: 'LIBRARY_MIGRATION_SKIPPED: The previously saved document could not be added to the library; it is still open as before.',
      migration: null,
      indexMissing: true,
    }
  }
  const existing = entries.find((entry) => entry.id === document.id)
  if (existing) return { entries, folders, diagnostic: null, migration: null, indexMissing: true }
  const entry: LibraryEntry = {
    id: document.id, name: untitled(document), algebraId: document.algebra.algebraId, createdAt: now, updatedAt: now,
  }
  return { entries: [entry, ...entries], folders, diagnostic: null, migration: { document, entry }, indexMissing: true }
}

export type LibraryRead = Readonly<{
  entries: readonly LibraryEntry[]
  /** Every folder of My library, empty ones included (STORE-016). */
  folders: readonly FolderPath[]
  /** Set when the library could not be read in full; the entries are what could. */
  diagnostic: string | null
}>

/**
 * Reads the library, and never writes. While there is no index yet, the
 * former single active document is listed as the first entry; the first write
 * stores it (#212). A corrupted index is rebuilt in memory from the stored
 * graphs. Unavailable storage yields an empty library with a diagnostic.
 */
export function readLibrary(storage: LibraryStorage | null, options: LibraryOptions = {}): LibraryRead {
  if (!storage) return { entries: [], folders: [], diagnostic: UNAVAILABLE.diagnostic }
  try {
    const { entries, folders, diagnostic } = snapshot(storage, options)
    return { entries, folders, diagnostic }
  } catch {
    return { entries: [], folders: [], diagnostic: UNAVAILABLE.diagnostic }
  }
}

const isQuota = (error: unknown) => {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

/** A failed write: a full quota is reported as such; a refused access means no storage. */
function writeFailure(error: unknown, full: LibraryError): LibraryError {
  if (error instanceof LibraryError) return error
  if (isQuota(error)) return full
  if (error instanceof DOMException) return UNAVAILABLE
  return new LibraryError('LIBRARY_WRITE_FAILED', 'The library could not be written.')
}

function required(storage: LibraryStorage | null): LibraryStorage {
  if (!storage) throw UNAVAILABLE
  return storage
}

function writeIndex(storage: LibraryStorage, entries: readonly LibraryEntry[]): void {
  storage.setItem(LIBRARY_INDEX_KEY, JSON.stringify({ version: 1, entries }))
}

const INDEX_NOT_UPDATED = new LibraryError(
  'LIBRARY_WRITE_FAILED',
  'The library list could not be updated. The graph itself was written and is listed again the next time the library is read.',
)

/**
 * Writes graphs, then the index. If the index write fails, every graph is put
 * back as it was, so no graph is left without its entry and the previous
 * revision stays readable. Each `setItem` replaces one key at once.
 */
function commit(
  storage: LibraryStorage,
  graphs: readonly Readonly<{ id: string; source: string }>[],
  entries: readonly LibraryEntry[],
  /** Every folder after the write; the empty ones are stored under their own key. */
  folders?: readonly FolderPath[],
): void {
  const previous: { id: string; source: string | null }[] = []
  let previousFolders: string | null | undefined
  const rollBack = () => {
    let restored = true
    if (previousFolders !== undefined) {
      try {
        if (previousFolders === null) storage.removeItem(LIBRARY_FOLDERS_KEY)
        else storage.setItem(LIBRARY_FOLDERS_KEY, previousFolders)
      } catch {
        restored = false
      }
    }
    for (const { id, source } of previous.reverse()) {
      try {
        if (source === null) storage.removeItem(libraryDocumentKey(id))
        else storage.setItem(libraryDocumentKey(id), source)
      } catch {
        restored = false
      }
    }
    return restored
  }
  try {
    for (const { id, source } of graphs) {
      previous.push({ id, source: storage.getItem(libraryDocumentKey(id)) })
      storage.setItem(libraryDocumentKey(id), source)
    }
    if (folders) {
      const named = new Set(libraryFolders(entries, []).map(folderKey))
      const empty = folders.filter((path) => !named.has(folderKey(path)))
      const current = storage.getItem(LIBRARY_FOLDERS_KEY)
      const next = empty.length === 0 ? null : JSON.stringify({ version: 1, folders: empty })
      if (next !== current) {
        previousFolders = current
        if (next === null) storage.removeItem(LIBRARY_FOLDERS_KEY)
        else storage.setItem(LIBRARY_FOLDERS_KEY, next)
      }
    }
    writeIndex(storage, entries)
  } catch (error) {
    if (!rollBack()) throw INDEX_NOT_UPDATED
    throw error
  }
}

/** Reads the index again just before a write, with the migration it still needs. */
function beginWrite(storage: LibraryStorage, options: LibraryOptions): Snapshot {
  try {
    return snapshot(storage, options)
  } catch {
    throw UNAVAILABLE
  }
}

const migrationGraphs = (migration: Migration) => migration
  ? [{ id: migration.document.id, source: serializeCanonicalDocument(migration.document) }]
  : []

/**
 * Stores the pending migration of the former active document, if any, and
 * writes the index as read. A temporary scene-link session calls it before it
 * writes the active document, which the migration must have kept first.
 */
export function prepareLibrary(storage: LibraryStorage | null, options: LibraryOptions = {}): readonly LibraryEntry[] {
  const target = required(storage)
  const current = beginWrite(target, options)
  if (!current.indexMissing) return current.entries
  try {
    commit(target, migrationGraphs(current.migration), current.entries, current.folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError(
      'LIBRARY_WRITE_FAILED',
      'The previously saved document could not be moved to the library because browser storage is full; it was left as it was.',
    ))
  }
  return current.entries
}

export type LibrarySave = Readonly<{
  entries: readonly LibraryEntry[]
  /** The identity the graph was stored under; it differs from the document's when that one was taken. */
  id: string
}>

/**
 * Stores a graph, creating its entry or updating its name and date. A graph
 * replaces the stored graph of its identity only when it is that graph
 * (`boundId`); otherwise, when its identity is already in the library, it is
 * stored under a fresh one, so that saving never overwrites another graph.
 */
export function saveToLibrary(
  storage: LibraryStorage | null,
  document: CanonicalDocument,
  name: string,
  options: LibraryOptions & Readonly<{
    boundId: string | null
    createId?: () => string
    /** The folder of a new graph; an existing graph keeps its own (STORE-016). */
    folder?: FolderPath
  }>,
): LibrarySave {
  const target = required(storage)
  const now = options.now ?? new Date().toISOString()
  const current = beginWrite(target, { ...options, now })
  const taken = new Set(current.entries.map((entry) => entry.id))
  let id = document.id
  if (id !== options.boundId && taken.has(id)) {
    const createId = options.createId ?? (() => crypto.randomUUID())
    do id = createId()
    while (taken.has(id) || id === '')
  }
  const existing = current.entries.find((entry) => entry.id === id)
  const entry: LibraryEntry = {
    id,
    name,
    algebraId: document.algebra.algebraId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(existing
      ? existing.folder === undefined ? {} : { folder: existing.folder }
      : options.folder && options.folder.length > 0 ? { folder: [...options.folder] } : {}),
  }
  if (!existing && options.folder && options.folder.length > 0) {
    const added = libraryFolders([entry], []).filter((path) => !current.folders.some((known) => folderKey(known) === folderKey(path)))
    if (current.folders.length + added.length > MAX_LIBRARY_FOLDERS)
      throw new LibraryError('LIMIT_FOLDER_COUNT', `The library may contain at most ${MAX_LIBRARY_FOLDERS} folders.`)
  }
  const entries = existing
    ? current.entries.map((candidate) => candidate.id === id ? entry : candidate)
    : [...current.entries, entry]
  try {
    commit(target, [
      ...migrationGraphs(current.migration).filter((graph) => graph.id !== id),
      { id, source: serializeCanonicalDocument({ ...document, id, metadata: { ...document.metadata, title: name } }) },
    ], entries, current.folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError(
      'LIBRARY_WRITE_FAILED',
      'The graph could not be saved because browser storage is full. The last saved revision was kept.',
    ))
  }
  return { entries, id }
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

/** Renames a graph in the index and in its stored title. */
export function renameInLibrary(
  storage: LibraryStorage | null,
  id: string,
  name: string,
  options: LibraryOptions = {},
): readonly LibraryEntry[] {
  const target = required(storage)
  const now = options.now ?? new Date().toISOString()
  const current = beginWrite(target, { ...options, now })
  if (!current.entries.some((entry) => entry.id === id)) {
    throw new LibraryError('LIBRARY_ENTRY_MISSING', 'This graph is no longer stored in the library.')
  }
  // A graph that cannot be read is reported as such, not as missing storage.
  const document = current.migration?.document.id === id ? current.migration.document : loadFromLibrary(target, id)
  const entries = current.entries.map((entry) => entry.id === id ? { ...entry, name, updatedAt: now } : entry)
  try {
    commit(target, [
      ...migrationGraphs(current.migration).filter((graph) => graph.id !== id),
      { id, source: serializeCanonicalDocument({ ...document, metadata: { ...document.metadata, title: name } }) },
    ], entries, current.folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError(
      'LIBRARY_WRITE_FAILED',
      'The graph could not be renamed because browser storage is full; its previous name was kept.',
    ))
  }
  return entries
}

/** “X copy”, then “X copy 2”, “X copy 3”, … whichever is not already a name in the library. */
export function copyName(name: string, names: readonly string[]): string {
  const taken = new Set(names)
  const base = `${name} copy`
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

/** Stores a copy of a graph with fresh identities and a name distinct from the others. */
export function duplicateInLibrary(
  storage: LibraryStorage | null,
  id: string,
  options: LibraryOptions & Readonly<{ createId?: () => string }> = {},
): LibrarySave {
  const target = required(storage)
  const now = options.now ?? new Date().toISOString()
  const current = beginWrite(target, { ...options, now })
  const source = current.migration?.document.id === id ? current.migration.document : loadFromLibrary(target, id)
  const original = current.entries.find((entry) => entry.id === id)
  const name = copyName(original?.name ?? untitled(source), current.entries.map((entry) => entry.name))
  const taken = new Set(current.entries.map((entry) => entry.id))
  const createId = options.createId ?? (() => crypto.randomUUID())
  const fresh = () => {
    let candidate: string
    do candidate = createId()
    while (taken.has(candidate) || candidate === '')
    return candidate
  }
  const copy = resolveCanonicalImport(source.id, source, 'duplicate', fresh)
  const entry: LibraryEntry = {
    id: copy.id, name, algebraId: copy.algebra.algebraId, createdAt: now, updatedAt: now,
    // The copy is listed next to the original.
    ...(original?.folder === undefined ? {} : { folder: original.folder }),
  }
  const entries = [...current.entries, entry]
  try {
    commit(target, [
      ...migrationGraphs(current.migration),
      { id: copy.id, source: serializeCanonicalDocument({ ...copy, metadata: { ...copy.metadata, title: name } }) },
    ], entries, current.folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError(
      'LIBRARY_WRITE_FAILED',
      'The graph could not be duplicated because browser storage is full.',
    ))
  }
  return { entries, id: copy.id }
}

/** Removes a graph: its entry first, then its stored graph. */
export function removeFromLibrary(
  storage: LibraryStorage | null,
  id: string,
  options: LibraryOptions = {},
): readonly LibraryEntry[] {
  const target = required(storage)
  const current = beginWrite(target, options)
  const entries = current.entries.filter((entry) => entry.id !== id)
  try {
    // A migrated graph that is deleted at once never needs to be written.
    commit(target, migrationGraphs(current.migration).filter((graph) => graph.id !== id), entries, current.folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError('LIBRARY_WRITE_FAILED', 'The graph could not be deleted.'))
  }
  try {
    target.removeItem(libraryDocumentKey(id))
  } catch {
    // The graph stays stored and is listed again on the next read; nothing is lost.
  }
  return entries
}

/**
 * Stores a copy of a document that is not a library graph, such as a shipped
 * example (#266), under a fresh identity and its title, or a copy name when a
 * graph already has that name. The document itself is never changed.
 */
export function addCopyToLibrary(
  storage: LibraryStorage | null,
  document: CanonicalDocument,
  options: LibraryOptions & Readonly<{
    createId?: () => string
    /** The folder to store the copy in, created with its ancestors when missing (STORE-015). */
    folder?: FolderPath
  }> = {},
): LibrarySave & Readonly<{ name: string }> {
  const title = untitled(document)
  const names = readLibrary(storage, options).entries.map((entry) => entry.name)
  const name = names.includes(title) ? copyName(title, names) : title
  const createId = options.createId ?? (() => crypto.randomUUID())
  const saved = saveToLibrary(storage, { ...document, id: createId() }, name, { ...options, boundId: null, createId })
  return { ...saved, name }
}

export type LibraryFolderWrite = Readonly<{
  entries: readonly LibraryEntry[]
  folders: readonly FolderPath[]
}>

/** Creates an empty folder in My library, inside an existing parent (STORE-016). */
export function createLibraryFolder(
  storage: LibraryStorage | null,
  path: FolderPath,
  options: LibraryOptions = {},
): LibraryFolderWrite {
  const target = required(storage)
  const current = beginWrite(target, options)
  const parent = parentPath(path)
  if (path.length === 0 || (parent.length > 0 && !current.folders.some((known) => folderKey(known) === folderKey(parent))))
    throw new LibraryError('LIBRARY_FOLDER_MISSING', 'The parent folder no longer exists.')
  const problem = newFolderProblem(current.folders, parent, path[path.length - 1], { maxCount: MAX_LIBRARY_FOLDERS })
  if (problem) throw new LibraryError(problem.code, problem.message)
  const folders = [...current.folders, [...path]]
  try {
    commit(target, migrationGraphs(current.migration), current.entries, folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError('LIBRARY_WRITE_FAILED', 'The folder could not be created because browser storage is full.'))
  }
  return { entries: current.entries, folders }
}

/** Renames a folder; its graphs and subfolders follow it. */
export function renameLibraryFolder(
  storage: LibraryStorage | null,
  path: FolderPath,
  name: string,
  options: LibraryOptions = {},
): LibraryFolderWrite {
  const target = required(storage)
  const current = beginWrite(target, options)
  if (!current.folders.some((known) => folderKey(known) === folderKey(path)))
    throw new LibraryError('LIBRARY_FOLDER_MISSING', 'This folder no longer exists.')
  const parent = parentPath(path)
  const problem = newFolderProblem(current.folders, parent, name, { maxCount: MAX_LIBRARY_FOLDERS }, path)
  if (problem) throw new LibraryError(problem.code, problem.message)
  const renamed = [...parent, name]
  const folders = current.folders.map((known) => replacePrefix(known, path, renamed))
  const entries = current.entries.map((entry) => isWithin(entryFolder(entry), path) && entryFolder(entry).length > 0
    ? { ...entry, folder: replacePrefix(entryFolder(entry), path, renamed) }
    : entry)
  try {
    commit(target, migrationGraphs(current.migration), entries, folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError('LIBRARY_WRITE_FAILED', 'The folder could not be renamed; its previous name was kept.'))
  }
  return { entries, folders }
}

/** The graphs a folder and its subfolders hold, which deleting it deletes. */
export function libraryFolderEntries(entries: readonly LibraryEntry[], path: FolderPath): LibraryEntry[] {
  return entries.filter((entry) => isWithin(entryFolder(entry), path))
}

/**
 * Deletes a folder with its subfolders and every graph they hold: the index
 * first, then the stored graphs, as for one graph. The interface asks for
 * confirmation, stating the number of graphs, before calling it.
 */
export function deleteLibraryFolder(
  storage: LibraryStorage | null,
  path: FolderPath,
  options: LibraryOptions = {},
): LibraryFolderWrite & Readonly<{ deletedIds: readonly string[] }> {
  const target = required(storage)
  const current = beginWrite(target, options)
  if (path.length === 0) throw new LibraryError('LIBRARY_FOLDER_MISSING', 'This folder no longer exists.')
  const deletedIds = libraryFolderEntries(current.entries, path).map((entry) => entry.id)
  const deleted = new Set(deletedIds)
  const entries = current.entries.filter((entry) => !deleted.has(entry.id))
  const folders = current.folders.filter((known) => !isWithin(known, path))
  try {
    commit(target, migrationGraphs(current.migration).filter((graph) => !deleted.has(graph.id)), entries, folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError('LIBRARY_WRITE_FAILED', 'The folder could not be deleted.'))
  }
  for (const id of deletedIds) {
    try {
      target.removeItem(libraryDocumentKey(id))
    } catch {
      // Listed again on the next read; nothing is lost.
    }
  }
  return { entries, folders, deletedIds }
}

/** Moves a graph into a folder, or to the root for the empty path. */
export function moveInLibrary(
  storage: LibraryStorage | null,
  id: string,
  folder: FolderPath,
  options: LibraryOptions = {},
): LibraryFolderWrite {
  const target = required(storage)
  const current = beginWrite(target, options)
  if (!current.entries.some((entry) => entry.id === id))
    throw new LibraryError('LIBRARY_ENTRY_MISSING', 'This graph is no longer stored in the library.')
  if (folder.length > 0 && !current.folders.some((known) => folderKey(known) === folderKey(folder)))
    throw new LibraryError('LIBRARY_FOLDER_MISSING', 'This folder no longer exists.')
  const entries = current.entries.map((entry) => {
    if (entry.id !== id) return entry
    const { folder: _previous, ...rest } = entry
    return folder.length > 0 ? { ...rest, folder: [...folder] } : rest
  })
  try {
    commit(target, migrationGraphs(current.migration), entries, current.folders)
  } catch (error) {
    throw writeFailure(error, new LibraryError('LIBRARY_WRITE_FAILED', 'The graph could not be moved.'))
  }
  return { entries, folders: current.folders }
}

/**
 * The canonical text that tells whether a graph has changes to save: the
 * document without its viewport centre and zoom, which are view settings and
 * not content.
 */
export function comparableSource(document: CanonicalDocument): string {
  const viewport = document.view.viewport.kind === 'none'
    ? document.view.viewport
    : { kind: 'two-dimensional' as const, centerX: 0, centerY: 0, zoom: 1 }
  return serializeCanonicalDocument({ ...document, view: { ...document.view, viewport } })
}

/**
 * The entries of one algebra, or all of them for `null`, most recently
 * modified first: the algebra filter of the library panel (#266).
 */
export function filterLibraryEntries(
  entries: readonly LibraryEntry[],
  algebraId: string | null,
): readonly LibraryEntry[] {
  return entries
    .filter((entry) => algebraId === null || entry.algebraId === algebraId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) ||
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}
