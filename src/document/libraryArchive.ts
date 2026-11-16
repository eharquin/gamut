import {
  DocumentFormatError,
  MAX_DOCUMENT_BYTES,
  parseCanonicalDocument,
  parseCanonicalDocumentBytes,
  serializeCanonicalDocument,
  type CanonicalDocument,
} from './canonicalDocument'
import {
  entryFolder,
  importGraphsToLibrary,
  LIBRARY_INDEX_KEY,
  LibraryError,
  loadFromLibrary,
  readLibrary,
  type LibraryFolderWrite,
  type LibraryImportGraph,
  type LibraryOptions,
  type LibraryStorage,
} from './documentLibrary'
import { ACTIVE_DOCUMENT_KEY } from './documentStorage'
import {
  describeFolder,
  folderKey,
  folderNameProblem,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_NAME_LENGTH,
  withAncestors,
  type FolderPath,
} from './folderModel'
import {
  ArchiveError,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_PATH_BYTES,
  openZip,
  readZipEntry,
  writeZip,
  type ZipFile,
} from './zipArchive'

/**
 * The whole of My library as one `.zip` archive (STORE-017), and the import
 * of such an archive (STORE-018). The archive holds one canonical JSON
 * document per graph, in directories that reproduce the library folders, and
 * a manifest that is only a hint (SEC-011): names and identities come from
 * the documents, folders from the archive paths.
 */

export const ARCHIVE_MANIFEST_PATH = 'manifest.json'
export const ARCHIVE_MANIFEST_VERSION = 1
export const MAX_ARCHIVE_MANIFEST_BYTES = 1024 * 1024
export const MAX_ARCHIVE_DECODED_BYTES = 64 * 1024 * 1024
const DOCUMENT_SUFFIX = '.gamut.json'
/** Longest file name written, in code points; real graph names stay in the documents and the manifest. */
const MAX_WRITTEN_NAME = 100
/** Shorter directory names, used when the folders would not fit in an entry path otherwise. */
const SHORT_WRITTEN_NAME = 24

const pad = (value: number) => String(value).padStart(2, '0')

/** The local calendar date `YYYY-MM-DD` of an instant, for the archive and import folder names. */
export function archiveDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export const libraryArchiveName = (now: Date): string => `gamut-library-${archiveDate(now)}.zip`
export const importFolderName = (now: Date): string => `Imported ${archiveDate(now)}`

/**
 * A graph or folder name as a path segment: characters that are unsafe in a
 * path on some system are replaced, as are a leading dot and trailing dots
 * and spaces, and the name is shortened to `length` code points.
 */
function safeSegment(name: string, fallback: string, length: number): string {
  const unsafe = (character: string) => character < ' ' || character === '\u007f' || '/\\:*?"<>|'.includes(character)
  // Trimmed first, so that no surrounding space can leave a `.` or `..` segment.
  const cleaned = Array.from(name.normalize('NFC'), (character) => unsafe(character) ? '-' : character)
    .slice(0, length).join('').trim().replace(/^\.+/, '-').replace(/[.\s]+$/, '')
  return cleaned === '' ? fallback : cleaned
}

/** `name`, or `name 2`, `name 3`… : the first one not taken in its directory, compared without case. */
function uniqueSegment(taken: Set<string>, stem: string, suffix = ''): string {
  for (let index = 1; ; index += 1) {
    const candidate = `${index === 1 ? stem : `${stem} ${index}`}${suffix}`
    const key = candidate.toLowerCase()
    if (taken.has(key)) continue
    taken.add(key)
    return candidate
  }
}

export type ArchiveManifestEntry = Readonly<{ path: string; name: string; id: string; updatedAt: string }>
export type ArchiveManifest = Readonly<{ version: number; exportedAt: string; entries: readonly ArchiveManifestEntry[] }>

export type LibraryArchiveExport = Readonly<{
  bytes: Uint8Array
  fileName: string
  /** Graphs written to the archive. */
  count: number
  /** Graphs that could not be read from storage and are not in the archive, each with its diagnostic. */
  skipped: readonly Readonly<{ name: string; diagnostic: string }>[]
  /** Reasons why the archive, though complete, could not be imported back as it is. */
  warnings: readonly string[]
}>

/** Builds the archive of the whole library. It reads storage only, and never writes. */
export async function exportLibraryArchive(
  storage: LibraryStorage | null,
  options: LibraryOptions & Readonly<{ date?: Date }> = {},
): Promise<LibraryArchiveExport> {
  const date = options.date ?? new Date()
  const library = readLibrary(storage, options)
  // An unreadable library must not be exported as an empty archive.
  if (storage === null || library.diagnostic?.startsWith('LIBRARY_UNAVAILABLE'))
    throw new LibraryError('LIBRARY_UNAVAILABLE', 'Browser storage is unavailable, so the library cannot be exported.')
  // While the library has no index, the former active document is listed but not stored under a library key yet.
  let pending: CanonicalDocument | null = null
  try {
    const source = options.migrationSource === undefined ? storage.getItem(ACTIVE_DOCUMENT_KEY) : options.migrationSource
    if (source !== null && storage.getItem(LIBRARY_INDEX_KEY) === null) pending = parseCanonicalDocument(source)
  } catch {
    pending = null
  }
  const encoder = new TextEncoder()
  const bytesOf = (path: FolderPath, length: number) =>
    path.reduce((sum, name) => sum + encoder.encode(safeSegment(name, 'folder', length)).byteLength + 1, 0)
  // Deep folders with long names would not fit in an entry path the import accepts.
  const roomForFile = MAX_WRITTEN_NAME * 4 + DOCUMENT_SUFFIX.length + 8
  const nameLength = library.folders.some((path) => bytesOf(path, MAX_FOLDER_NAME_LENGTH) + roomForFile > MAX_ARCHIVE_PATH_BYTES)
    ? SHORT_WRITTEN_NAME : MAX_FOLDER_NAME_LENGTH
  const fileLength = Math.min(nameLength, MAX_WRITTEN_NAME)

  const takenIn = new Map<string, Set<string>>()
  const taken = (directory: string) => {
    let names = takenIn.get(directory)
    if (!names) takenIn.set(directory, names = new Set(directory === '' ? [ARCHIVE_MANIFEST_PATH] : []))
    return names
  }
  const directories = new Map<string, string>([[folderKey([]), '']])
  const directoryOf = (path: FolderPath): string => {
    const known = directories.get(folderKey(path))
    if (known !== undefined) return known
    const parent = directoryOf(path.slice(0, -1))
    const directory = `${parent}${uniqueSegment(taken(parent), safeSegment(path[path.length - 1], 'folder', nameLength))}/`
    directories.set(folderKey(path), directory)
    return directory
  }

  const files: ZipFile[] = []
  // A folder that holds a graph, directly or below, is implied by that graph's path.
  const holding = new Set(withAncestors(library.entries.map(entryFolder)).map(folderKey))
  for (const path of library.folders) {
    const directory = directoryOf(path)
    if (!holding.has(folderKey(path))) files.push({ path: directory })
  }
  const manifest: ArchiveManifestEntry[] = []
  const skipped: { name: string; diagnostic: string }[] = []
  for (const entry of library.entries) {
    let document: CanonicalDocument
    try {
      document = pending?.id === entry.id ? pending : loadFromLibrary(storage, entry.id)
    } catch (error) {
      skipped.push({ name: entry.name, diagnostic: error instanceof LibraryError ? error.diagnostic : 'LIBRARY_ENTRY_INVALID: This graph could not be read.' })
      continue
    }
    const directory = directoryOf(entryFolder(entry))
    const path = directory + uniqueSegment(taken(directory), safeSegment(entry.name, 'graph', fileLength), DOCUMENT_SUFFIX)
    files.push({ path, bytes: encoder.encode(serializeCanonicalDocument(document)) })
    manifest.push({ path, name: entry.name, id: entry.id, updatedAt: entry.updatedAt })
  }
  const content: ArchiveManifest = { version: ARCHIVE_MANIFEST_VERSION, exportedAt: date.toISOString(), entries: manifest }
  files.push({ path: ARCHIVE_MANIFEST_PATH, bytes: encoder.encode(`${JSON.stringify(content, null, 2)}\n`) })
  const warnings: string[] = []
  if (files.length > MAX_ARCHIVE_ENTRIES) {
    warnings.push(`LIMIT_ARCHIVE_ENTRIES: The archive holds ${files.length.toLocaleString('en-US')} entries, more than the ${
      MAX_ARCHIVE_ENTRIES.toLocaleString('en-US')} that Import library accepts. It is a complete backup, but must be split to be imported.`)
  }
  if (library.folders.some((path) => path.length >= MAX_FOLDER_DEPTH)) {
    warnings.push(`LIMIT_FOLDER_DEPTH: Some folders are ${MAX_FOLDER_DEPTH} levels deep. Import library adds one level, so it will refuse this archive as it is.`)
  }
  return { bytes: await writeZip(files, date), fileName: libraryArchiveName(date), count: manifest.length, skipped, warnings }
}

export type LibraryArchiveContent = Readonly<{
  /** The valid documents, each with its folder from the archive path. */
  graphs: readonly LibraryImportGraph[]
  /** Every directory of the archive, including those without a valid document. */
  folders: readonly FolderPath[]
  /** Entries that are not a valid document, each with its diagnostic. */
  skipped: readonly Readonly<{ path: string; diagnostic: string }>[]
  /** Problems that do not affect the documents, such as an unusable manifest. */
  warnings: readonly string[]
}>

function folderOf(segments: readonly string[], shown: string): FolderPath {
  if (segments.length + 1 > MAX_FOLDER_DEPTH) {
    throw new ArchiveError('LIMIT_FOLDER_DEPTH',
      `The entry ${shown} is nested too deep: with the import folder, folders may be nested at most ${MAX_FOLDER_DEPTH} levels deep.`)
  }
  for (const name of segments) {
    const problem = folderNameProblem(name)
    if (problem) throw new ArchiveError(problem.code, `A directory of the entry ${shown} cannot be a folder name. ${problem.message}`)
  }
  return [...segments]
}

/** The update times the manifest gives, by entry path; a manifest that cannot be used gives none and a warning. */
function manifestDates(source: Uint8Array | null, warnings: string[]): Map<string, Readonly<{ id: string; updatedAt: string }>> {
  const dates = new Map<string, Readonly<{ id: string; updatedAt: string }>>()
  if (source === null) return dates
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source)) as Partial<ArchiveManifest> | null
    if (parsed?.version !== ARCHIVE_MANIFEST_VERSION || !Array.isArray(parsed.entries)) throw new Error('unsupported manifest')
    for (const entry of parsed.entries as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue
      const { path, id, updatedAt } = entry as Record<string, unknown>
      if (typeof path !== 'string' || typeof id !== 'string' || typeof updatedAt !== 'string') continue
      const instant = Date.parse(updatedAt)
      if (Number.isNaN(instant)) continue
      dates.set(path.normalize('NFC'), { id, updatedAt: new Date(instant).toISOString() })
    }
  } catch {
    dates.clear()
    warnings.push('ARCHIVE_MANIFEST_INVALID: The manifest of the archive could not be read and was ignored; the graphs do not depend on it.')
  }
  return dates
}

/**
 * Reads an archive as untrusted input (SEC-010). A failed archive check
 * throws an `ArchiveError` and yields nothing. Otherwise every `.json` entry
 * passes the validation and migration of a single-file import, and
 * `validate`, which may throw for a document the application cannot open;
 * entries that fail are listed, not imported.
 */
export async function readLibraryArchive(
  bytes: Uint8Array,
  options: Readonly<{
    validate?: (document: CanonicalDocument) => void
    now?: Date
    /** A lower total decompressed size, for tests; the normative limit otherwise. */
    maxDecodedBytes?: number
  }> = {},
): Promise<LibraryArchiveContent> {
  const maxDecodedBytes = Math.min(options.maxDecodedBytes ?? MAX_ARCHIVE_DECODED_BYTES, MAX_ARCHIVE_DECODED_BYTES)
  const entries = openZip(bytes)
  const folders: FolderPath[] = []
  const graphs: LibraryImportGraph[] = []
  const paths: string[] = []
  const skipped: { path: string; diagnostic: string }[] = []
  const warnings: string[] = []
  let total = 0
  const counted = (limit: number, code: string, message: string) => {
    const before = total
    return (length: number) => {
      if (length > limit) throw new ArchiveError(code, message)
      total = before + length
      if (total > maxDecodedBytes)
        throw new ArchiveError('LIMIT_ARCHIVE_DECODED_SIZE', 'The archive decompresses to more than 64 MiB.')
    }
  }
  let manifest: Uint8Array | null = null
  for (const entry of entries) {
    const shown = JSON.stringify(entry.path)
    if (entry.directory) {
      folders.push(folderOf(entry.segments, shown))
      continue
    }
    if (entry.path === ARCHIVE_MANIFEST_PATH) {
      try {
        manifest = await readZipEntry(bytes, entry, counted(MAX_ARCHIVE_MANIFEST_BYTES, 'LIMIT_ARCHIVE_MANIFEST_SIZE', ''))
      } catch (error) {
        if (!(error instanceof ArchiveError) || error.code !== 'LIMIT_ARCHIVE_MANIFEST_SIZE') throw error
        warnings.push('LIMIT_ARCHIVE_MANIFEST_SIZE: The manifest of the archive exceeds 1 MiB and was ignored; the graphs do not depend on it.')
      }
      continue
    }
    const folder = folderOf(entry.segments.slice(0, -1), shown)
    if (!/\.json$/i.test(entry.path)) {
      skipped.push({ path: entry.path, diagnostic: 'ARCHIVE_ENTRY_TYPE: Not a JSON document.' })
      continue
    }
    const content = await readZipEntry(bytes, entry, counted(MAX_DOCUMENT_BYTES, 'LIMIT_DOCUMENT_DECODED_SIZE',
      `The entry ${shown} exceeds the 4 MiB limit of a document.`))
    try {
      const document = parseCanonicalDocumentBytes(content)
      options.validate?.(document)
      folders.push(folder)
      graphs.push({ document, name: document.metadata.title.trim() || 'Untitled graph', folder })
      paths.push(entry.path)
    } catch (error) {
      skipped.push({
        path: entry.path,
        diagnostic: error instanceof DocumentFormatError ? `${error.code}: ${error.message}`
          : error instanceof Error && error.message ? error.message : 'DOCUMENT_IMPORT_FAILED: The document could not be imported.',
      })
    }
  }
  // The manifest only supplies the last update of a graph it describes exactly.
  const dates = manifestDates(manifest, warnings)
  const latest = (options.now ?? new Date()).getTime()
  const dated = graphs.map((graph, index) => {
    const hint = dates.get(paths[index])
    return hint && hint.id === graph.document.id && Date.parse(hint.updatedAt) <= latest ? { ...graph, updatedAt: hint.updatedAt } : graph
  })
  return { graphs: dated, folders: withAncestors(folders), skipped, warnings }
}

export type LibraryArchiveImport = LibraryFolderWrite & Readonly<{
  /** The folder the graphs went into, or null when the archive held no valid document. */
  folder: FolderPath | null
  imported: number
  skipped: LibraryArchiveContent['skipped']
  warnings: readonly string[]
}>

/**
 * Imports an archive into a new top-level folder `Imported YYYY-MM-DD`
 * (STORE-018). The archive is checked and every document validated before
 * anything is written, and the graphs are then stored in one write.
 */
export async function importLibraryArchive(
  storage: LibraryStorage | null,
  file: Blob,
  options: LibraryOptions & Readonly<{
    date?: Date
    createId?: () => string
    validate?: (document: CanonicalDocument) => void
  }> = {},
): Promise<LibraryArchiveImport> {
  // The size is known before the file is read.
  if (file.size > MAX_ARCHIVE_BYTES) throw new ArchiveError('LIMIT_ARCHIVE_SIZE', 'The archive exceeds 32 MiB.')
  const date = options.date ?? new Date()
  const content = await readLibraryArchive(new Uint8Array(await file.arrayBuffer()), { validate: options.validate, now: date })
  if (content.graphs.length === 0) {
    const library = readLibrary(storage, options)
    return { entries: library.entries, folders: library.folders, folder: null, imported: 0, skipped: content.skipped, warnings: content.warnings }
  }
  const written = importGraphsToLibrary(storage, importFolderName(date), content.graphs, content.folders, options)
  return { ...written, imported: content.graphs.length, skipped: content.skipped, warnings: content.warnings }
}

/** One sentence that states what an import did, for the panel and its live region. */
export function describeArchiveImport(result: LibraryArchiveImport): string {
  const graphs = (count: number) => `${count} ${count === 1 ? 'graph' : 'graphs'}`
  const skipped = result.skipped.length === 0 ? '' : ` ${result.skipped.length} ${result.skipped.length === 1 ? 'entry was' : 'entries were'} skipped.`
  return result.folder === null
    ? `No graph was imported: the archive holds no valid document.${skipped}`
    : `Imported ${graphs(result.imported)} into the folder ${describeFolder(result.folder)}.${skipped}`
}
