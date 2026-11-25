import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { AlgebraRegistry } from '../algebra/registry'
import { requireAvailableAlgebra } from '../application/algebraAvailability'
import type { LibraryArchiveReport } from '../components/LibraryPanel'
import {
  documentMigration,
  DocumentFormatError,
  fromCanonicalDocument,
  parseCanonicalDocument,
  toCanonicalDocument,
  type CanonicalDocument,
  type DocumentMigration,
  type RestoreOptions,
  type ThemeMode,
} from '../document/canonicalDocument'
import { hasContent } from '../document/documentCommands'
import { downloadBytes } from '../document/documentFile'
import type { HistoryAction } from '../document/documentHistory'
import {
  addCopyToLibrary,
  browserLibraryStorage,
  comparableSource,
  duplicateInLibrary,
  LIBRARY_DOCUMENT_PREFIX,
  LIBRARY_FOLDERS_KEY,
  LIBRARY_INDEX_KEY,
  LIBRARY_OPEN_KEY,
  libraryDocumentKey,
  LibraryError,
  loadFromLibrary,
  prepareLibrary,
  readLibrary,
  removeFromLibrary,
  renameInLibrary,
  saveToLibrary,
  type LibraryEntry,
  type LibraryRead,
} from '../document/documentLibrary'
import { ACTIVE_DOCUMENT_KEY, discardKeptDocument, readKeptDocument } from '../document/documentStorage'
import type { ExpressionDocument } from '../document/expressionDocument'
import { describeArchiveImport, exportLibraryArchive, importLibraryArchive } from '../document/libraryArchive'
import { MIGRATION_NOTICE_MS } from '../document/migrationNotice'
import { ArchiveError } from '../document/zipArchive'
import type { LibraryExample } from '../examples'
import { useLibraryFolderActions } from './useLibraryFolderActions'
import type { ScalarPlayback } from './useScalarPlayback'

type CopyNotice = Readonly<{ message: string; durationMs: number; kind?: 'migration' }>

export type LibrarySessionOptions = Readonly<{
  registry: AlgebraRegistry
  restoreOptions: RestoreOptions
  /** A scene link or embed mode: nothing is read or written until an explicit save. */
  temporary: boolean
  ephemeral: boolean
  endTemporarySession: () => void
  /** How the editor opened: a restored active document has a `restored` field. */
  initial: Readonly<{ document: ExpressionDocument }>
  document: ExpressionDocument
  theme: ThemeMode
  resolvedStyles: Parameters<typeof toCanonicalDocument>[2]
  resolvedOrientation: Parameters<typeof toCanonicalDocument>[3]
  playback: ScalarPlayback
  dispatchHistory: (action: HistoryAction) => void
  /** Replaces the open document in the editor, with its theme and diagnostic. */
  replaceDocument: (document: ExpressionDocument, theme: ThemeMode, diagnostic: string | null) => void
  setDocumentDiagnostic: (diagnostic: string | null) => void
  setCopyNotice: Dispatch<SetStateAction<CopyNotice | null>>
  showMigrationNotice: (migration: DocumentMigration | null) => void
  /** Where a dropped library archive is imported. */
  importDroppedArchive: MutableRefObject<(file: File) => void>
}>

/**
 * The library session of the editor (#212, #173): My library as last read,
 * the library graph the open document is and its saved revision, the panel,
 * and every library action. Only an explicit action writes the library.
 */
export function useLibrarySession(options: LibrarySessionOptions) {
  const {
    registry: algebraRegistry,
    restoreOptions,
    temporary,
    ephemeral,
    initial,
    document: expressionDoc,
    theme,
    resolvedStyles,
    resolvedOrientation,
    playback,
    dispatchHistory,
    replaceDocument,
    setDocumentDiagnostic,
    setCopyNotice,
    showMigrationNotice,
    importDroppedArchive,
  } = options
  // The local library of named graphs (#212). Reading the library never
  // writes; a write reads the index again first, and only then migrates the
  // former active document. That document is read here, during the first
  // render and so before the first autosave, so that only a document saved by
  // an earlier visit is migrated. A temporary scene-link session reads nothing
  // until the user opens the library or saves, and reads the former active
  // document at its first write instead.
  const [libraryStart] = useState(() => {
    if (temporary) return { migrationSource: undefined, library: null, boundId: null, saved: null }
    const storage = browserLibraryStorage()
    let migrationSource: string | null = null
    let indexMissing = false
    let openKey: string | null = null
    try {
      migrationSource = storage?.getItem(ACTIVE_DOCUMENT_KEY) ?? null
      indexMissing = storage?.getItem(LIBRARY_INDEX_KEY) === null
      openKey = storage?.getItem(LIBRARY_OPEN_KEY) ?? null
    } catch {
      // Unavailable storage: the library read below reports it.
    }
    const library = readLibrary(storage, { migrationSource })
    // The open graph is a library graph only when it was restored from the
    // active document and that document was recorded as this graph, or is
    // the former active document awaiting migration. A default, recovery, or
    // imported document with a library identity is not that graph.
    const id = initial.document.id
    const bound = 'restored' in initial && library.entries.some((entry) => entry.id === id) &&
      (openKey === id || indexMissing)
    let saved: CanonicalDocument | null = null
    if (bound) {
      try {
        saved = indexMissing && migrationSource !== null
          ? parseCanonicalDocument(migrationSource)
          : loadFromLibrary(storage, id)
      } catch {
        saved = null
      }
    }
    return { migrationSource, library, boundId: bound ? id : null, saved }
  })
  const libraryOptions = () => ({ migrationSource: libraryStart.migrationSource })
  // A document an earlier version could not restore, and kept (#275), goes
  // to My library once a version that reads it opens, and the reader is told.
  useEffect(() => {
    if (temporary || import.meta.env.MODE === 'test') return
    const storage = browserLibraryStorage()
    if (storage === null) return
    const kept = readKeptDocument(storage, (document) => {
      requireAvailableAlgebra(algebraRegistry, fromCanonicalDocument(document, restoreOptions).document.algebra)
    })
    // Still the stored document, restored here: nothing was saved over it.
    if (kept.status === 'unchanged' && 'restored' in initial) discardKeptDocument(storage)
    if (kept.status !== 'readable') return
    try {
      // Already in My library as it is, as when the version that wrote it
      // saved it there: nothing to add.
      let stored: CanonicalDocument | null = null
      try {
        stored = loadFromLibrary(storage, kept.document.id)
      } catch {
        // Not a library graph, or unreadable: the copy is added.
      }
      if (stored !== null && comparableSource(stored) === comparableSource(kept.document)) {
        discardKeptDocument(storage)
        return
      }
      const added = addCopyToLibrary(storage, kept.document, libraryOptions())
      discardKeptDocument(storage)
      reportLibrary(added.entries, null)
      const message = `“${added.name}”, which an earlier version of GAMUT could not open, was added to My library.`
      // After the notice of a migrated working copy (#343), not instead of it.
      setCopyNotice((current) => ({
        message: current?.kind === 'migration' ? current.message + ' ' + message : message,
        durationMs: MIGRATION_NOTICE_MS,
        kind: current?.kind,
      }))
    } catch (error) {
      reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: A graph kept from an earlier visit could not be added to the library; it stays kept.')
    }
    // Once, as the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [library, setLibrary] = useState<LibraryRead | null>(libraryStart.library)
  /** The library graph the open document is, or `null` for a graph not saved there. */
  const [boundId, setBoundId] = useState<string | null>(libraryStart.boundId)
  /** The last saved revision of the open graph, which unsaved changes are measured against. */
  const [savedRevision, setSavedRevision] = useState<CanonicalDocument | null>(libraryStart.saved)
  const markSavedOnRender = useRef(false)
  /**
   * The example the open graph was opened from, as rendered, while the graph is
   * not in the library: leaving it asks for confirmation only once it differs.
   */
  const [exampleRevision, setExampleRevision] = useState<CanonicalDocument | null>(null)
  const markExampleOnRender = useRef(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryNaming, setLibraryNaming] = useState<Readonly<{ initialName: string }> | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement | null>(null)
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null)
  const libraryReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const currentCanonical = useMemo(
    () => toCanonicalDocument(expressionDoc, theme, resolvedStyles, resolvedOrientation),
    [expressionDoc, theme, resolvedStyles, resolvedOrientation],
  )
  // A graph just opened is its own saved revision, as the canonical document
  // of the render that shows it, once its appearance is resolved.
  useLayoutEffect(() => {
    if (!markSavedOnRender.current) return
    markSavedOnRender.current = false
    setSavedRevision(currentCanonical)
  }, [currentCanonical])
  useLayoutEffect(() => {
    if (!markExampleOnRender.current) return
    markExampleOnRender.current = false
    setExampleRevision(currentCanonical)
  }, [currentCanonical])
  /**
   * Whether the open graph differs from its last saved revision; a graph that
   * was never saved has changes once it has content. The viewport centre and
   * zoom are view settings and do not count.
   */
  const unsavedChanges = useMemo(() => {
    if (boundId === null || savedRevision === null) return hasContent(expressionDoc)
    return comparableSource(currentCanonical) !== comparableSource(savedRevision)
  }, [boundId, savedRevision, currentCanonical, expressionDoc])
  /**
   * Whether leaving the open graph discards work: its unsaved changes, except
   * that an example opened unchanged can be left without confirmation, although
   * Save still shows it as unsaved until it is in the library.
   */
  const discardableChanges = boundId === null && exampleRevision !== null
    ? comparableSource(currentCanonical) !== comparableSource(exampleRevision)
    : unsavedChanges
  const graphName = ephemeral ? 'Shared scene (temporary)' : boundId === null ? '' : expressionDoc.title.trim() || 'Untitled graph'
  useEffect(() => {
    document.title = `${graphName || 'Untitled'} · GAMUT`
  }, [graphName])
  // Records which library graph the autosaved active document is, so that a
  // reload binds it again; nothing is written in a temporary session.
  useEffect(() => {
    if (ephemeral || import.meta.env.MODE === 'test') return
    try {
      window.localStorage.setItem(LIBRARY_OPEN_KEY, boundId ?? '')
    } catch {
      // The binding is a convenience; without it Save asks for a name again.
    }
  }, [boundId, ephemeral])
  // Another tab may change the library: its list follows, and so does the
  // saved revision of the open graph.
  const storageListener = useRef<(event: StorageEvent) => void>(() => {})
  useEffect(() => {
    storageListener.current = (event: StorageEvent) => {
      if (event.key !== null && event.key !== LIBRARY_INDEX_KEY && event.key !== LIBRARY_FOLDERS_KEY
        && !event.key.startsWith(LIBRARY_DOCUMENT_PREFIX)) return
      if (library === null && !libraryOpen) return
      setLibrary(readLibrary(browserLibraryStorage(), libraryOptions()))
      if (boundId !== null && (event.key === null || event.key === libraryDocumentKey(boundId))) {
        try {
          setSavedRevision(loadFromLibrary(browserLibraryStorage(), boundId))
        } catch {
          setSavedRevision(null)
        }
      }
    }
  })
  useEffect(() => {
    const listener = (event: StorageEvent) => storageListener.current(event)
    window.addEventListener('storage', listener)
    return () => window.removeEventListener('storage', listener)
  }, [])

  const currentLibrary = (): LibraryRead => {
    if (library) return library
    const read = readLibrary(browserLibraryStorage(), libraryOptions())
    setLibrary(read)
    return read
  }
  /** Shows the library after a write; its folders are read again with it. */
  const reportLibrary = (entries: readonly LibraryEntry[], diagnostic: string | null) =>
    setLibrary({ entries, folders: readLibrary(browserLibraryStorage(), libraryOptions()).folders, diagnostic })
  const reportLibraryFailure = (error: unknown, fallback: string) => {
    setLibrary({
      ...readLibrary(browserLibraryStorage(), libraryOptions()),
      diagnostic: error instanceof LibraryError || error instanceof ArchiveError ? error.diagnostic : fallback,
    })
  }
  /** What the last library export or import did, shown in the panel until dismissed. */
  const [archiveReport, setArchiveReport] = useState<LibraryArchiveReport | null>(null)
  /** Downloads the whole library as one archive (STORE-017); it reads storage only. */
  const exportLibrary = async () => {
    try {
      const exported = await exportLibraryArchive(browserLibraryStorage(), libraryOptions())
      downloadBytes(exported.bytes, exported.fileName, 'application/zip')
      setLibrary((current) => current && { ...current, diagnostic: null })
      setArchiveReport({
        message: `Exported ${exported.count} ${exported.count === 1 ? 'graph' : 'graphs'} to ${exported.fileName}.${
          exported.skipped.length === 0 ? '' : ` ${exported.skipped.length} could not be read and ${exported.skipped.length === 1 ? 'is' : 'are'} not in the archive.`}`,
        details: [...exported.skipped.map(({ name, diagnostic }) => `${name} — ${diagnostic}`), ...exported.warnings],
      })
    } catch (error) {
      setArchiveReport(null)
      reportLibraryFailure(error, 'LIBRARY_EXPORT_FAILED: The library could not be exported.')
    }
  }
  /**
   * Imports a chosen or dropped library archive into a new folder
   * (STORE-018). A temporary session writes no storage, so it imports nothing.
   */
  const importLibrary = async (file: File) => {
    setArchiveReport(null)
    if (ephemeral) {
      reportLibraryFailure(null, 'LIBRARY_IMPORT_TEMPORARY: A library cannot be imported in a temporary shared scene, which does not use browser storage. Add the scene to your library first, or open GAMUT without a scene link.')
      return
    }
    try {
      const imported = await importLibraryArchive(browserLibraryStorage(), file, {
        ...libraryOptions(),
        validate: (document) => requireAvailableAlgebra(algebraRegistry, fromCanonicalDocument(document, restoreOptions).document.algebra),
      })
      setLibrary({ entries: imported.entries, folders: imported.folders, diagnostic: null })
      setArchiveReport({
        message: describeArchiveImport(imported),
        details: [...imported.skipped.map(({ path, diagnostic }) => `${path} — ${diagnostic}`), ...imported.warnings],
      })
    } catch (error) {
      reportLibraryFailure(error, 'ARCHIVE_IMPORT_FAILED: The archive could not be imported. Nothing was imported.')
    }
  }
  const libraryFolderActions = useLibraryFolderActions({
    library,
    libraryOptions,
    setLibrary,
    reportLibraryFailure,
    // The open graph stays open, as a graph that is no longer saved.
    onGraphsDeleted: (ids) => {
      if (boundId === null || !ids.includes(boundId)) return
      setBoundId(null)
      setSavedRevision(null)
    },
  })
  // A dropped archive takes the path of Import library, with its summary in the panel.
  useEffect(() => {
    importDroppedArchive.current = (file) => {
      if (!libraryOpen) {
        libraryReturnFocusRef.current = libraryButtonRef.current
        setLibraryNaming(null)
        setLibraryOpen(true)
      }
      void importLibrary(file)
    }
  })
  /**
   * The stored document of a graph for its card, read once per revision: a
   * card redraws when its graph is saved again, not on every render.
   */
  const thumbnailDocuments = useRef(new Map<string, CanonicalDocument | null>())
  const libraryThumbnailDocument = (entry: LibraryEntry): CanonicalDocument | null => {
    const key = `${entry.id}\u0000${entry.updatedAt}`
    const cached = thumbnailDocuments.current.get(key)
    if (cached !== undefined) return cached
    let document: CanonicalDocument | null
    try {
      document = loadFromLibrary(browserLibraryStorage(), entry.id)
    } catch {
      document = null
    }
    thumbnailDocuments.current.set(key, document)
    return document
  }
  const closeLibrary = useCallback(() => {
    setLibraryOpen(false)
    setLibraryNaming(null)
  }, [])
  const toggleLibrary = () => {
    if (libraryOpen) {
      closeLibrary()
      return
    }
    // Opening the panel reads the library again and writes nothing.
    setLibrary(readLibrary(browserLibraryStorage(), libraryOptions()))
    libraryReturnFocusRef.current = libraryButtonRef.current
    setLibraryNaming(null)
    setLibraryOpen(true)
  }
  /**
   * Stores the former active document in the library, if it still has to be,
   * before an action replaces it. Returns false, with the problem reported in
   * the menu, when that failed and the action must not go on.
   */
  const keepFormerDocument = (): boolean => {
    try {
      reportLibrary(prepareLibrary(browserLibraryStorage(), libraryOptions()), library?.diagnostic ?? null)
      return true
    } catch (error) {
      reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: The library could not be written.')
      return false
    }
  }
  /**
   * Stores the open graph under `name`. A graph that is not already this
   * library graph takes a fresh identity when its own is taken. In a
   * temporary scene-link session the graph takes a new identity, keeping its
   * undo history, and the session ends.
   */
  const commitLibrarySave = (name: string, asNew = false): boolean => {
    // Save as new graph stores a fresh identity and leaves the bound graph as saved.
    // The graph is saved with the values the sliders stop on, and stays saved.
    if (playback.anyPlaying) playback.stopAll('the graph was saved')
    const candidate = ephemeral || asNew ? crypto.randomUUID() : expressionDoc.id
    let id: string
    try {
      const saved = saveToLibrary(
        browserLibraryStorage(),
        toCanonicalDocument({ ...expressionDoc, id: candidate, title: name }, theme, resolvedStyles, resolvedOrientation),
        name,
        { ...libraryOptions(), boundId: ephemeral || asNew ? null : boundId },
      )
      reportLibrary(saved.entries, null)
      id = saved.id
    } catch (error) {
      reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: The graph could not be saved to the library.')
      setLibraryOpen(true)
      return false
    }
    if (id !== expressionDoc.id) dispatchHistory({ type: 'update-identity', id })
    if (name !== expressionDoc.title) dispatchHistory({ type: 'update-title', title: name })
    setBoundId(id)
    setSavedRevision(toCanonicalDocument({ ...expressionDoc, id, title: name }, theme, resolvedStyles, resolvedOrientation))
    if (ephemeral) {
      // Reloading must reopen the saved copy, not the original shared scene.
      options.endTemporarySession()
      setDocumentDiagnostic(null)
    }
    setLibraryNaming(null)
    setLibraryOpen(false)
    setCopyNotice({ message: `Saved “${name}” to the library.`, durationMs: 2500 })
    return true
  }
  const saveToLibraryRequest = () => {
    if (boundId !== null && !ephemeral) {
      commitLibrarySave(expressionDoc.title.trim() || 'Untitled graph')
      return
    }
    // The first save asks for a name in the library panel.
    currentLibrary()
    libraryReturnFocusRef.current = saveButtonRef.current
    setLibraryNaming({ initialName: expressionDoc.title.trim() || 'Untitled graph' })
    setLibraryOpen(true)
  }
  /** Replaces the open graph, as opening a file does, and ends a temporary session. */
  const openGraph = (
    document: ExpressionDocument,
    nextTheme: ThemeMode,
    diagnostic: string | null,
    libraryId: string | null,
  ) => {
    replaceDocument(document, nextTheme, diagnostic)
    setBoundId(libraryId)
    setExampleRevision(null)
    setSavedRevision(null)
    markSavedOnRender.current = libraryId !== null
    if (ephemeral) options.endTemporarySession()
    closeLibrary()
  }
  const openLibraryEntry = (entry: LibraryEntry) => {
    // The open graph is already there: reopening it would discard its changes.
    if (entry.id === boundId && !ephemeral) {
      closeLibrary()
      return
    }
    try {
      const stored = loadFromLibrary(browserLibraryStorage(), entry.id)
      const restored = fromCanonicalDocument(stored, restoreOptions)
      requireAvailableAlgebra(algebraRegistry, restored.document.algebra)
      if (!keepFormerDocument()) return
      openGraph(restored.document, restored.theme, restored.recoveryDiagnostic, entry.id)
      // The entry stays in its stored format until it is saved; a current one withdraws an earlier notice.
      showMigrationNotice(documentMigration(stored))
    } catch (error) {
      reportLibraryFailure(error, error instanceof DocumentFormatError
        ? `LIBRARY_ENTRY_INVALID: “${entry.name}” could not be opened. ${error.code}: ${error.message}`
        : `LIBRARY_ENTRY_INVALID: “${entry.name}” could not be opened.`)
    }
  }
  /** A new empty graph in the current algebra and view. */
  const newLibraryGraph = () => {
    if (!keepFormerDocument()) return
    showMigrationNotice(null)
    openGraph({
      ...expressionDoc,
      id: crypto.randomUUID(),
      title: 'Untitled graph',
      description: '',
      items: [{ id: 'item-1', source: '' }],
      appearance: {},
      folders: [],
    }, theme, null, null)
  }
  const renameLibraryEntry = (id: string, name: string) => {
    try {
      reportLibrary(renameInLibrary(browserLibraryStorage(), id, name, libraryOptions()), null)
    } catch (error) {
      reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: The graph could not be renamed.')
      return false
    }
    if (id === boundId && !ephemeral) {
      setSavedRevision((saved) => saved && { ...saved, metadata: { ...saved.metadata, title: name } })
      dispatchHistory({ type: 'update-title', title: name })
    }
    return true
  }
  /**
   * Renames the open graph from the header. A graph not yet in the library is
   * saved there under that name, as its first save would.
   */
  const renameOpenGraph = (name: string) => {
    if (ephemeral || name === graphName) return
    if (boundId === null) {
      if (!commitLibrarySave(name)) libraryReturnFocusRef.current = libraryButtonRef.current
      return
    }
    if (!renameLibraryEntry(boundId, name)) {
      libraryReturnFocusRef.current = libraryButtonRef.current
      setLibraryOpen(true)
    }
  }
  const duplicateLibraryEntry = (entry: LibraryEntry) => {
    try {
      reportLibrary(duplicateInLibrary(browserLibraryStorage(), entry.id, libraryOptions()).entries, null)
    } catch (error) {
      reportLibraryFailure(error, `LIBRARY_WRITE_FAILED: “${entry.name}” could not be duplicated.`)
    }
  }
  const deleteLibraryEntry = (entry: LibraryEntry) => {
    try {
      reportLibrary(removeFromLibrary(browserLibraryStorage(), entry.id, libraryOptions()), null)
    } catch (error) {
      reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: The graph could not be deleted.')
      return
    }
    // The open graph stays open, as a graph that is no longer saved.
    if (entry.id === boundId) {
      setBoundId(null)
      setSavedRevision(null)
    }
  }
  /** Opens a shipped example unbound from the library, as a new graph with its own identity (#266). */
  const openExample = (example: LibraryExample) => {
    const restored = fromCanonicalDocument({ ...example.document, id: crypto.randomUUID() }, restoreOptions)
    try {
      requireAvailableAlgebra(algebraRegistry, restored.document.algebra)
    } catch (error) {
      reportLibraryFailure(error, `EXAMPLE_INVALID: “${example.name}” could not be opened.${
        error instanceof DocumentFormatError ? ` ${error.code}: ${error.message}` : ''}`)
      return
    }
    if (!keepFormerDocument()) return
    // An example stores the system theme only because a canonical document
    // needs one; it is not a choice of its author, so the reader's theme stays.
    openGraph(restored.document, theme, restored.recoveryDiagnostic, null)
    showMigrationNotice(null)
    markExampleOnRender.current = true
  }
  const addExampleToLibrary = (example: LibraryExample) => {
    try {
      // The copy keeps the example's folder path, created when missing (STORE-015).
      const added = addCopyToLibrary(browserLibraryStorage(), example.document, { ...libraryOptions(), folder: example.folder })
      reportLibrary(added.entries, null)
      setCopyNotice({ message: `Added “${added.name}” to my library.`, durationMs: 2500 })
    } catch (error) {
      reportLibraryFailure(error, `LIBRARY_WRITE_FAILED: “${example.name}” could not be added to the library.`)
    }
  }


  return {
    library,
    boundId,
    libraryOpen,
    libraryNaming,
    saveButtonRef,
    libraryButtonRef,
    libraryReturnFocusRef,
    unsavedChanges,
    discardableChanges,
    graphName,
    archiveReport,
    dismissArchiveReport: () => setArchiveReport(null),
    exportLibrary,
    importLibrary,
    libraryFolderActions,
    libraryThumbnailDocument,
    closeLibrary,
    toggleLibrary,
    keepFormerDocument,
    commitLibrarySave,
    saveToLibraryRequest,
    openLibraryEntry,
    newLibraryGraph,
    renameLibraryEntry,
    renameOpenGraph,
    duplicateLibraryEntry,
    deleteLibraryEntry,
    openExample,
    addExampleToLibrary,
    /** The open graph is no longer a library graph, as after an import. */
    unbind: () => {
      setBoundId(null)
      setSavedRevision(null)
      setExampleRevision(null)
    },
  }
}
