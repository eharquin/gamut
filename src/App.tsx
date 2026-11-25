import type { PastedRows } from './application/pastedLines'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createBuiltinAlgebraRegistry, DEFAULT_ALGEBRA_ID } from './algebra/builtinAlgebras'
import type { AlgebraDefinition } from './algebra/algebraDefinition'
import { evaluateDocument } from './application/evaluateDocument'
import { AlgebraInfoDialog } from './components/AlgebraInfoDialog'
import {
  DocumentHeader,
  DocumentNotices,
  type DocumentHeaderActions,
  type DocumentHeaderRefs,
} from './components/DocumentHeader'
import { ExpressionReference } from './components/ExpressionReference'
import { EmbedControls, EmbeddedSceneUnavailable } from './components/EmbedControls'
import { isFramed, resolveEmbedMode, type EmbedOptions } from './application/embedMode'
import type { ReferenceExample } from './language/expressionReference'
import type { PanelStyle } from './components/SettingsMenu'
import { AddMenu } from './components/AddMenu'
import { PerformanceMonitor } from './components/PerformanceMonitor'
import { createPerformanceProbe } from './presentation/performanceProbe'
import { ClearExpressionsButton } from './components/ClearExpressionsButton'
import { ExpressionRow, type ExpressionRowActions, type ExpressionRowRefs } from './components/ExpressionRow'
import { isSourceEditor, type SourceEditor } from './components/sourceEditor'
import { ExpressionTree } from './components/ExpressionTree'
import { useExpressionFolders } from './hooks/useExpressionFolders'
import { documentFolders, drawnAppearances, expressionRows, isFolderCollapsed, itemFolder, overwritingFolder, rowAppearance } from './document/expressionFolders'
import { folderKey, folderName, isWithin, samePath, type FolderPath } from './document/folderModel'
import { AppearancePopover, FOLDER_STYLE_KINDS } from './components/AppearancePopover'
import { ZoomLevelField } from './components/ZoomLevelField'
import type { DisplaySettings } from './components/SettingsMenu'
import { defaultStyleForKind, resolveItemAppearance, studioColor } from './components/appearancePalette'
import { OPAQUE_INTERPRETATION } from './geometry/interpretation'
import {
  expressionDocument,
  MAX_EXPRESSION_ITEMS,
  type ExpressionAppearance,
  type ExpressionDocument,
  type ExpressionItem,
} from './document/expressionDocument'
import { hasContent, type DocumentCommand } from './document/documentCommands'
import {
  createDocumentHistory,
  documentHistoryReducer,
  type HistoryAction,
} from './document/documentHistory'
import {
  adaptiveGrid,
  clampZoom,
  DEFAULT_PIXELS_PER_UNIT,
  toMathematical,
  zoomAt,
  type Viewport2d,
} from './visualization/viewport'
import {
  creationSource,
  nextObjectName,
} from './visualization/viewportCreation'
import { describeViewport } from './visualization/viewportDescription'
import { collectRenderedPrimitives } from './visualization/layout'
import { requireAvailableAlgebra } from './application/algebraAvailability'
import {
  DocumentFormatError,
  fromCanonicalDocument,
  documentMigration,
  resolveCanonicalImport,
  type DocumentMigration,
  toCanonicalDocument,
  type CanonicalDocument,
  type ThemeMode,
} from './document/canonicalDocument'
import { documentFileDiagnostic, downloadDocumentFile, readDocumentFile } from './document/documentFile'
import { browserDocumentStorage, keepUnreadableDocument } from './document/documentStorage'
import { LibraryPanel } from './components/LibraryPanel'
import { SceneThumbnail } from './components/SceneThumbnail'
import { showcaseExample } from './examples'
import { selectDroppedDocument } from './document/droppedDocument'
import { MIGRATION_NOTICE_MS, migrationNotice } from './document/migrationNotice'
import { createSceneLink, decodeSceneFragment, hasSceneFragment, SHARE_URL_WARNING_LENGTH } from './document/sceneLink'
import { formatDisplayNumber } from './presentation/formatNumber'
import { evaluateScalarControl } from './application/evaluateScalarControl'
import { DEFAULT_APPEARANCE_SOURCES, evaluateAppearanceSources } from './application/evaluateAppearanceSources'
import { CanvasBackground } from './visualization/CanvasBackground'
import { SceneGlyphs, type GlyphMovability } from './visualization/SceneGlyphs'
import { labelPlacementInputs, layoutScene } from './visualization/sceneLayout'
import { useLabelPlacement } from './hooks/useLabelPlacement'
import { directScalarEdit } from './language/directScalarEdit'
import { CanvasSliders } from './components/CanvasSliders'
import { useScalarPlayback } from './hooks/useScalarPlayback'
import { useViewportNavigation } from './hooks/useViewportNavigation'
import { useObjectSelection } from './hooks/useObjectSelection'
import { useManipulation } from './hooks/useManipulation'
import { useLibrarySession } from './hooks/useLibrarySession'
import { declaredName } from './language/declaredName'
import { dragTargets, type ManipulationContext } from './application/viewportManipulation'
import './App.css'

// Composition root: the runtime's registered definitions. A document's
// algebra record is resolved against it whenever a document is restored,
// imported, or evaluated (ALG-004, ALG-005).
const algebraRegistry = createBuiltinAlgebraRegistry()
const restoreOptions = {
  visualizerAvailable: (visualizerId: string) => algebraRegistry.resolveVisualizer(visualizerId) !== null,
}

/**
 * The showcase example of an algebra as a new document, unbound from the
 * library like any opened example (#217), or null when it is not shipped.
 */
function showcaseDocument(definition: AlgebraDefinition): ExpressionDocument | null {
  const example = showcaseExample(definition)
  if (!example) return null
  try {
    return fromCanonicalDocument({ ...example.document, id: crypto.randomUUID() }, restoreOptions).document
  } catch {
    return null
  }
}

/** The document of a first run: the showcase example of the default algebra. */
function firstRunDocument(): ExpressionDocument {
  const definition = algebraRegistry.definitions().find((candidate) => candidate.algebraId === DEFAULT_ALGEBRA_ID)
  return (definition && showcaseDocument(definition)) ?? expressionDocument([{ id: 'item-1', source: '' }])
}

/** The standard visualizer of an algebra, so that undo and redo keep each algebra's own visualizer. */
function standardVisualizerId(algebra: ExpressionDocument['algebra']): string | null {
  const resolution = algebraRegistry.resolve(algebra)
  return resolution.status === 'resolved' ? resolution.definition.standardVisualizerId : null
}
const MIN_PANEL_WIDTH = 240
/** Keeps the `.panel-resize` separator reachable at any panel width. */
const PANEL_RESIZE_WIDTH = 6


type EditorFocus = Readonly<{
  id: string
  start: number
  end: number
  direction: 'forward' | 'backward' | 'none'
}>


const defaultViewport: Viewport2d = {
  width: 640,
  height: 480,
  centerX: 0,
  centerY: 0,
  pixelsPerUnit: 72,
}
const VIEWPORT_LOCK_STORAGE_KEY = 'multivector.viewportLocked'

function restoredViewportLock(): boolean {
  try {
    return window.localStorage.getItem(VIEWPORT_LOCK_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function persistViewportLock(locked: boolean): void {
  try {
    window.localStorage.setItem(VIEWPORT_LOCK_STORAGE_KEY, String(locked))
  } catch {
    // The lock remains usable for this session when browser storage is unavailable.
  }
}

/**
 * Whether the expression panel is collapsed is a local view preference, kept
 * like the viewport lock; it is never part of the document (#234).
 */
const PANEL_COLLAPSED_STORAGE_KEY = 'gamut.expressionPanelCollapsed'

function restoredPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function persistPanelCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(PANEL_COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {
    // The panel still collapses for this session when browser storage is unavailable.
  }
}

/**
 * Share of the expression panel's height that the open expression reference
 * takes, a local view preference kept like the viewport lock (#259).
 */
const REFERENCE_HEIGHT_STORAGE_KEY = 'gamut.expressionReferenceHeight'
const DEFAULT_REFERENCE_HEIGHT = 0.58
const MIN_REFERENCE_HEIGHT = 0.25
const MAX_REFERENCE_HEIGHT = 0.85
const REFERENCE_HEIGHT_STEP = 0.05

function clampedReferenceHeight(height: number): number {
  return Math.round(Math.min(MAX_REFERENCE_HEIGHT, Math.max(MIN_REFERENCE_HEIGHT, height)) * 100) / 100
}

function restoredReferenceHeight(): number {
  try {
    const stored = Number(window.localStorage.getItem(REFERENCE_HEIGHT_STORAGE_KEY) ?? Number.NaN)
    return Number.isFinite(stored) ? clampedReferenceHeight(stored) : DEFAULT_REFERENCE_HEIGHT
  } catch {
    return DEFAULT_REFERENCE_HEIGHT
  }
}

/** Per-browser preference: how the rows of the expression panel are drawn. */
const PANEL_STYLE_STORAGE_KEY = 'gamut.panelStyle'

function restoredPanelStyle(): PanelStyle {
  try {
    return window.localStorage.getItem(PANEL_STYLE_STORAGE_KEY) === 'cards' ? 'cards' : 'lines'
  } catch {
    return 'lines'
  }
}

function persistPanelStyle(style: PanelStyle): void {
  try {
    window.localStorage.setItem(PANEL_STYLE_STORAGE_KEY, style)
  } catch {
    // The style still applies for this visit when browser storage is unavailable.
  }
}

/** Per-browser preference: whether the performance monitor is shown over the canvas. */
const PERFORMANCE_MONITOR_STORAGE_KEY = 'gamut.performanceMonitor'

function restoredPerformanceMonitor(): boolean {
  try {
    return window.localStorage.getItem(PERFORMANCE_MONITOR_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

function persistPerformanceMonitor(shown: boolean): void {
  try {
    if (shown) window.localStorage.setItem(PERFORMANCE_MONITOR_STORAGE_KEY, 'on')
    else window.localStorage.removeItem(PERFORMANCE_MONITOR_STORAGE_KEY)
  } catch {
    // The monitor still shows for this visit when browser storage is unavailable.
  }
}

function persistReferenceHeight(height: number): void {
  try {
    window.localStorage.setItem(REFERENCE_HEIGHT_STORAGE_KEY, String(height))
  } catch {
    // The height still applies for this session when browser storage is unavailable.
  }
}

/** How long the notice of a migrated graph stays (#343). */
/** The status after a failed restore (#275). */
const HELD_STORED_DOCUMENT = 'Nothing is saved over it until you edit this graph, and it is then kept for a version of GAMUT that can read it.'
const UNKEPT_STORED_DOCUMENT = 'STORE_NOT_KEPT: The stored graph that could not be restored cannot be kept, so this graph is not saved automatically; save it in My library.'

type SharedDocument = ReturnType<typeof fromCanonicalDocument>

function SharedScene({ embed }: { embed: EmbedOptions | null }) {
  const [result, setResult] = useState<{
    document?: SharedDocument; diagnostic?: string; code?: string; migrationNotice?: string | null
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const canonical = await decodeSceneFragment(window.location.hash)
        const restored = fromCanonicalDocument(canonical, restoreOptions)
        requireAvailableAlgebra(algebraRegistry, restored.document.algebra)
        if (!cancelled) setResult({ document: restored, migrationNotice: migrationNotice(documentMigration(canonical)) })
      } catch (error) {
        const code = error instanceof DocumentFormatError ? error.code : 'SHARE_LOAD_FAILED'
        if (!cancelled) setResult({ code, diagnostic: error instanceof DocumentFormatError
          ? error.code + ': ' + error.message
          : 'SHARE_LOAD_FAILED: The scene link could not be opened.' })
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])
  if (!result) return <p role="status">Opening shared scene…</p>
  // The editor falls back on the active document, which embed mode never reads.
  if (embed && !result.document) {
    return <EmbeddedSceneUnavailable message={`This scene could not be opened: its link may be incomplete or damaged. (${result.code})`} />
  }
  return <Editor sharedDocument={result.document} sceneDiagnostic={result.diagnostic}
    sharedMigrationNotice={result.migrationNotice ?? null} sharedSession embed={embed} />
}

function App() {
  const [embed] = useState(() => resolveEmbedMode(window.location.hash, isFramed(window)))
  // The page-level minimum width would overflow a small frame.
  useEffect(() => {
    if (!embed) return
    const root = document.documentElement
    root.classList.add('is-embedded')
    // The background is a validated colour or `transparent`, never text from the link as written.
    if (embed.background) {
      root.classList.add('has-embed-background')
      root.style.setProperty('--embed-background', embed.background)
    }
    return () => {
      root.classList.remove('is-embedded', 'has-embed-background')
      root.style.removeProperty('--embed-background')
    }
  }, [embed])
  if (hasSceneFragment(window.location.hash)) return <SharedScene embed={embed} />
  // Without a scene, embed mode shows the default example and stores nothing.
  return embed ? <Editor embed={embed} /> : <Editor />
}

function Editor({ sharedDocument, sceneDiagnostic, sharedMigrationNotice = null, sharedSession = false, embed = null }: {
  sharedDocument?: SharedDocument
  sceneDiagnostic?: string
  /** What a scene link written by an earlier version changed as it opened (#343). */
  sharedMigrationNotice?: string | null
  sharedSession?: boolean
  /** Embed mode (#215): the canvas alone, in a session that never touches storage. */
  embed?: EmbedOptions | null
}) {
  // The time from the start of each render to its commit, for the performance monitor.
  const [performanceProbe] = useState(createPerformanceProbe)
  const renderStarted = performance.now()
  useLayoutEffect(() => {
    performanceProbe.render.record(performance.now() - renderStarted)
  })
  /**
   * A shared scene and embed mode never read or write browser storage until
   * an explicit save; embed mode offers none, so it never touches storage.
   */
  const temporary = sharedSession || embed !== null
  const [ephemeral, setEphemeral] = useState(temporary)
  const persistence = useMemo(
    () => ({
      load: () => browserDocumentStorage(window.localStorage).load(),
      save: (document: CanonicalDocument) => browserDocumentStorage(window.localStorage).save(document),
    }),
    [],
  )
  const [initial] = useState(() => {
    if (sharedDocument) return { ...sharedDocument, diagnostic: sharedDocument.recoveryDiagnostic }
    const fallback = {
      document: import.meta.env.MODE === 'test'
        ? expressionDocument([{ id: 'item-1', source: 'vector(2, 1)' }])
        : firstRunDocument(),
      theme: 'system' as ThemeMode,
      diagnostic: (sceneDiagnostic ?? null) as string | null,
    }
    if (import.meta.env.MODE === 'test' || embed !== null) return fallback
    try {
      const stored = persistence.load()
      if (stored === null) return fallback
      const restored = fromCanonicalDocument(stored, restoreOptions)
      requireAvailableAlgebra(algebraRegistry, restored.document.algebra)
      return {
        ...restored, diagnostic: sceneDiagnostic ?? restored.recoveryDiagnostic, restored: true,
        // The working copy an earlier version autosaved says so too (#343).
        migrationNotice: migrationNotice(documentMigration(stored)),
      }
    } catch (error) {
      const failure = error instanceof DocumentFormatError
        ? error.code + ': ' + error.message
        : 'STORE_READ_FAILED: The saved document could not be restored.'
      // The stored document, perhaps written by a later version, is not
      // saved over before an edit, and is kept first (#275).
      const restore = failure + ' ' + HELD_STORED_DOCUMENT
      return {
        ...fallback,
        diagnostic: sceneDiagnostic ? sceneDiagnostic + ' ' + restore : restore,
        holdStored: 'until-edit' as const,
      }
    }
  })
  const [history, dispatchDocumentHistory] = useReducer(
    documentHistoryReducer,
    initial.document,
    createDocumentHistory,
  )
  /**
   * The visualizer and viewport left for NoViz, restored on the way back
   * (#55). It belongs to the open document only.
   */
  const retainedVisualView = useRef<Readonly<{
    algebraId: string
    visualizerId: string
    viewport: Extract<ExpressionDocument['view']['viewport'], { kind: 'two-dimensional' }>
  }> | null>(null)
  // Every document replacement (import, drop, and any later open or new)
  // goes through `replace`, which forgets the view kept for the previous one.
  const dispatchHistory = useCallback((action: HistoryAction) => {
    if (action.type === 'replace') retainedVisualView.current = null
    dispatchDocumentHistory(action)
  }, [])
  const expressionDoc = history.present
  // Documents entering the history are checked at restore and import, so a
  // failed resolution here is a programming error, not a user-facing state.
  const algebraResolution = useMemo(
    () => algebraRegistry.resolve(expressionDoc.algebra),
    [expressionDoc.algebra],
  )
  if (algebraResolution.status !== 'resolved') {
    throw new Error(`${algebraResolution.code}: ${algebraResolution.message}`)
  }
  const { engine, definition: algebraDefinition } = algebraResolution
  // The interpretation may be unavailable without blocking evaluation: values
  // still evaluate and inspect, only geometry and visualization are withheld.
  const interpretationResolution = useMemo(
    () => algebraRegistry.resolveInterpretation(expressionDoc.interpretation),
    [expressionDoc.interpretation],
  )
  const interpretation = interpretationResolution.status === 'resolved'
    ? interpretationResolution.interpretation
    : OPAQUE_INTERPRETATION
  const evaluationContext = useMemo(() => ({ engine, interpretation }), [engine, interpretation])
  const executeCommand = useCallback((
    command: DocumentCommand,
    coalesceKey?: string,
  ) => dispatchHistory({ type: 'execute', command, coalesceKey }), [dispatchHistory])
  const nextId = useRef(2)
  const inputRefs = useRef(new Map<string, SourceEditor>())
  const pendingFocus = useRef<string | null>(null)
  const lastEditorFocus = useRef<EditorFocus | null>(null)
  const pendingHistoryFocus = useRef(lastEditorFocus.current)
  /** Set by an undo or redo that traverses a step, read once the document renders. */
  const pendingTraversal = useRef(false)
  const removedEditorFallbacks = useRef(new Map<string, EditorFocus>())
  const viewportCreatedItemIds = useRef(new Set<string>())
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const algebraInfoButtonRef = useRef<HTMLButtonElement>(null)
  const expressionReferenceButtonRef = useRef<HTMLButtonElement>(null)
  const resizeDrag = useRef<Readonly<{ startX: number; startWidth: number }> | null>(
    null,
  )
  const expressionRowRefs = useRef(new Map<string, HTMLElement>())
  const appearanceAnchorRef = useRef<HTMLButtonElement | null>(null)
  const viewportSvgRef = useRef<SVGSVGElement>(null)
  const canvasFrameRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const objectSelection = useObjectSelection(expressionDoc.items)
  const { selectedObjectId } = objectSelection
  const handleController = objectSelection.handleController(
    (event, itemId, kind) => manipulation.beginManipulation(event, itemId, kind),
    (event, itemId, kind, current) => manipulation.manipulateWithKeyboard(event, itemId, kind, current),
  )
  const [panelWidth, setPanelWidth] = useState(340)
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const maximumPanelWidth = Math.max(
    MIN_PANEL_WIDTH,
    (workspaceWidth || window.innerWidth) - PANEL_RESIZE_WIDTH,
  )
  const [viewportSize, setViewportSize] = useState({
    width: defaultViewport.width,
    height: defaultViewport.height,
  })
  const [appearanceItemId, setAppearanceItemId] = useState<string | null>(null)
  /** The folder whose appearance menu is open (DOC-013). */
  const [folderMenuPath, setFolderMenuPath] = useState<FolderPath | null>(null)
  const folderMenuAnchorRef = useRef<HTMLButtonElement | null>(null)
  /** The row whose normalization choice is open under its expression. */
  const [normalizationChoiceId, setNormalizationChoiceId] = useState<string | null>(null)
  // The popover closes itself on a choice, Escape, or a click outside; it is
  // also closed when its row can no longer be normalized (its button is gone).
  useEffect(() => {
    if (normalizationChoiceId !== null && !normalizationToggleRefs.current.has(normalizationChoiceId))
      setNormalizationChoiceId(null)
  }, [normalizationChoiceId, expressionDoc])
  const closeNormalizationChoice = useCallback(() => setNormalizationChoiceId(null), [])
  // Only one normalization popover is open at a time: the button that opened it.
  const normalizationAnchorRef = useRef<HTMLButtonElement | null>(null)
  const normalizationToggleRefs = useRef(new Map<string, HTMLButtonElement>())
  const [expandedListIds, setExpandedListIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [theme, setTheme] = useState<ThemeMode>(embed?.theme ?? initial.theme)
  const [documentDiagnostic, setDocumentDiagnostic] = useState<string | null>(
    initial.diagnostic,
  )
  const [viewportAnnouncement, setViewportAnnouncement] = useState('')
  const [reorderAnnouncement, setReorderAnnouncement] = useState('')
  const folders = useExpressionFolders({
    document: expressionDoc,
    executeCommand,
    dispatchHistory,
    rowElements: expressionRowRefs,
    announce: setReorderAnnouncement,
  })
  const [viewportLocked, setViewportLocked] = useState(() => embed ? embed.viewportLocked : temporary ? false : restoredViewportLock())
  const [panelCollapsed, setPanelCollapsed] = useState(() => temporary ? false : restoredPanelCollapsed())
  const collapsePanelButtonRef = useRef<HTMLButtonElement | null>(null)
  const expandPanelButtonRef = useRef<HTMLButtonElement | null>(null)
  const expressionPanelRef = useRef<HTMLElement | null>(null)
  /** The button that receives focus after the user collapses or expands the panel. */
  const panelToggleFocus = useRef<'collapse' | 'expand' | null>(null)
  const [shareResult, setShareResult] = useState<{ content: string; label: string; message: string } | null>(null)
  // A copied link is confirmed briefly; the panel with the text only appears
  // when the clipboard refuses the copy.
  const [copyNotice, setCopyNotice] = useState<Readonly<{
    message: string
    durationMs: number
    /** A migration notice describes the open graph and goes when another opens. */
    kind?: 'migration'
  }> | null>(null)
  /**
   * Tells the reader that the graph just opened was migrated from an earlier
   * version (#343), or withdraws the notice of a previous graph.
   */
  const showMigrationNotice = (migration: DocumentMigration | null) => {
    const message = migrationNotice(migration)
    if (message) setCopyNotice({ message, durationMs: MIGRATION_NOTICE_MS, kind: 'migration' })
    else setCopyNotice((current) => current?.kind === 'migration' ? null : current)
  }
  // A scene link or a restored working copy written by an earlier version
  // says so once the page is there, so that the status is announced.
  useEffect(() => {
    const message = embed ? null : sharedMigrationNotice ?? ('migrationNotice' in initial ? initial.migrationNotice : null)
    if (message) setCopyNotice({ message, durationMs: MIGRATION_NOTICE_MS, kind: 'migration' })
    // Once, as the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!copyNotice) return
    const timer = window.setTimeout(() => setCopyNotice(null), copyNotice.durationMs)
    return () => window.clearTimeout(timer)
  }, [copyNotice])
  const [sharing, setSharing] = useState(false)
  const [fileDragActive, setFileDragActive] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  const [infoDialog, setInfoDialog] = useState<'algebra' | null>(null)
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [referenceHeight, setReferenceHeight] = useState(() => temporary ? DEFAULT_REFERENCE_HEIGHT : restoredReferenceHeight())
  // A temporary session reads no browser storage and writes none.
  const [panelStyle, setPanelStyle] = useState<PanelStyle>(() => temporary ? 'lines' : restoredPanelStyle())
  const changePanelStyle = (style: PanelStyle) => {
    setPanelStyle(style)
    if (!ephemeral) persistPanelStyle(style)
  }
  const [performanceMonitor, setPerformanceMonitor] = useState(() => !temporary && restoredPerformanceMonitor())
  const changePerformanceMonitor = (shown: boolean) => {
    setPerformanceMonitor(shown)
    if (!ephemeral) persistPerformanceMonitor(shown)
  }
  const closeInfoDialog = useCallback(() => setInfoDialog(null), [])
  const closeAppearance = useCallback(() => {
    setAppearanceItemId(null)
    dispatchHistory({ type: 'boundary' })
  }, [dispatchHistory])
  const rememberEditorFocus = (element: SourceEditor) => {
    lastEditorFocus.current = {
      id: element.id,
      start: element.selectionStart ?? 0,
      end: element.selectionEnd ?? element.selectionStart ?? 0,
      direction: element.selectionDirection ?? 'none',
    }
  }
  const dispatchHistoryWithFocus = useCallback((type: 'undo' | 'redo') => {
    pendingHistoryFocus.current = lastEditorFocus.current
    pendingTraversal.current = !history.transaction &&
      (type === 'undo' ? history.past.length > 0 : history.future.length > 0)
    dispatchHistory({ type })
  }, [history.past.length, history.future.length, history.transaction, dispatchHistory])

  const viewport: Viewport2d = expressionDoc.view.viewport.kind === 'two-dimensional'
    ? {
        ...viewportSize,
        centerX: expressionDoc.view.viewport.centerX,
        centerY: expressionDoc.view.viewport.centerY,
        pixelsPerUnit: clampZoom(expressionDoc.view.viewport.zoom),
      }
    : { ...defaultViewport, ...viewportSize }
  const visualizer = algebraRegistry.resolveVisualizer(expressionDoc.view.visualizerId)
  const visualizerActive = interpretationResolution.status === 'resolved' &&
    visualizer !== null &&
    expressionDoc.view.viewport.kind === 'two-dimensional'
  // Without a canvas there is nothing to give the room to, so the panel stays open.
  const panelHidden = panelCollapsed && visualizerActive
  /**
   * The NoViz calculator (#55): the document has no visualizer, so nothing is
   * drawn, positions are off, and the panel takes the whole width. Any
   * document without a canvas is shown this way, so that **Show canvas** is
   * always offered: besides the NoViz state itself (`visualizerId: null` and
   * viewport `none`), a document with only one of the two markers, an unknown
   * visualizer, or an unavailable interpretation.
   */
  const noViz = !visualizerActive
  /** The button that receives focus after the user enters or leaves NoViz. */
  const workspaceModeFocus = useRef<'show-canvas' | 'hide-canvas' | null>(null)
  const showCanvasButtonRef = useRef<HTMLButtonElement | null>(null)
  const hideCanvasButtonRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const target = workspaceModeFocus.current
    workspaceModeFocus.current = null
    if (target === 'show-canvas') showCanvasButtonRef.current?.focus()
    else if (target === 'hide-canvas') hideCanvasButtonRef.current?.focus()
  }, [noViz])
  const grid = adaptiveGrid(viewport)
  const updateView = useCallback((view: typeof expressionDoc.view) => {
    dispatchHistory({ type: 'update-view', view, standardVisualizerId })
  }, [dispatchHistory])
  const updateDisplay = useCallback((change: Partial<DisplaySettings>) => {
    updateView({
      ...expressionDoc.view,
      display: { ...expressionDoc.view.display, ...change },
    })
  }, [expressionDoc.view, updateView])
  const updateViewport = useCallback((next: Viewport2d) => {
    updateView({
      ...expressionDoc.view,
      viewport: {
        kind: 'two-dimensional',
        centerX: next.centerX,
        centerY: next.centerY,
        zoom: next.pixelsPerUnit,
      },
    })
  }, [expressionDoc.view, updateView])
  const navigation = useViewportNavigation({
    viewport,
    locked: viewportLocked,
    updateViewport,
    announce: setViewportAnnouncement,
    svgRef: viewportSvgRef,
  })
  const { screenPoint, guardGestureSelection } = navigation
  const beginViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    setAppearanceItemId(null)
    manipulation.deselectLine()
    navigation.beginPan(event)
  }
  const itemOf = (id: string) => expressionDoc.items.find((candidate) => candidate.id === id)
  /** What the glyph of a rendered element offers: nothing to an element that is no item, such as a list element. */
  const glyphMovability: GlyphMovability = {
    present: (id) => !!itemOf(id),
    head: (id, entity) => { const item = itemOf(id); return !!item && targets.headMovable(item, entity) },
    base: (id, entity) => { const item = itemOf(id); return !!item && targets.baseMovable(item, entity) },
    line: (id, entity) => { const item = itemOf(id); return !!item && targets.lineMovable(item, entity) },
  }
  const moveViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!manipulation.movePointer(event)) navigation.movePan(event)
  }
  const endViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!manipulation.endPointer(event)) navigation.endPan(event)
  }
  const cancelViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!manipulation.cancelPointer(event)) navigation.cancelPan(event.pointerId)
  }
  const loseViewportCapture = () => {
    if (!manipulation.loseCapture()) navigation.cancelPan(null)
  }

  const togglePanelCollapsed = () => {
    const collapsed = !panelCollapsed
    panelToggleFocus.current = collapsed ? 'expand' : 'collapse'
    setPanelCollapsed(collapsed)
    if (!ephemeral) persistPanelCollapsed(collapsed)
  }
  useEffect(() => {
    const target = panelToggleFocus.current
    panelToggleFocus.current = null
    if (target === 'expand') expandPanelButtonRef.current?.focus()
    else if (target === 'collapse') collapsePanelButtonRef.current?.focus()
  }, [panelCollapsed])
  // A document without a canvas (imported, dropped, restored or linked)
  // reopens a collapsed panel: nothing would be left on screen to expand it
  // from, and it must not collapse again when a canvas comes back. Focus left
  // in the removed canvas moves to Show canvas (or the panel) instead of the page.
  const hadCanvas = useRef(visualizerActive)
  useEffect(() => {
    const lostCanvas = hadCanvas.current && !visualizerActive
    hadCanvas.current = visualizerActive
    if (visualizerActive) return
    if (panelCollapsed) {
      setPanelCollapsed(false)
      if (!ephemeral) persistPanelCollapsed(false)
    }
    const focused = document.activeElement
    if (lostCanvas && (focused === null || focused === document.body || !focused.isConnected)) {
      const target = showCanvasButtonRef.current ?? expressionPanelRef.current
      target?.focus()
    }
  }, [visualizerActive, panelCollapsed, ephemeral])

  /** Collapses the canvas to the right into the NoViz calculator (#55). */
  const enterNoViz = () => {
    const { visualizerId, viewport: currentViewport } = expressionDoc.view
    if (visualizerId === null || currentViewport.kind !== 'two-dimensional') return
    retainedVisualView.current = {
      algebraId: expressionDoc.algebra.algebraId, visualizerId, viewport: currentViewport,
    }
    navigation.forgetPan()
    manipulation.forget()
    setAppearanceItemId(null)
    // A collapsed panel reopens with every loss of the canvas (#234).
    workspaceModeFocus.current = 'show-canvas'
    // NoViz is the only state in which positions are off (#248).
    updateView({ ...expressionDoc.view, visualizerId: null, positionEnabled: false, viewport: { kind: 'none' } })
  }
  /**
   * Brings the canvas back with the visualizer and viewport NoViz left, or
   * the algebra's standard visualizer at the stored or default view. It also
   * repairs a document that cannot be displayed (one NoViz marker only, an
   * unknown visualizer, or an unavailable interpretation, which takes the
   * algebra's standard interpretation in an undoable step).
   */
  const leaveNoViz = () => {
    const retained = retainedVisualView.current?.algebraId === expressionDoc.algebra.algebraId
      ? retainedVisualView.current
      : null
    const storedViewport = expressionDoc.view.viewport.kind === 'two-dimensional' ? expressionDoc.view.viewport : null
    workspaceModeFocus.current = 'hide-canvas'
    updateView({
      ...expressionDoc.view,
      visualizerId: retained?.visualizerId ?? algebraDefinition.standardVisualizerId,
      positionEnabled: true,
      viewport: retained?.viewport ?? storedViewport ?? {
        kind: 'two-dimensional', centerX: 0, centerY: 0, zoom: DEFAULT_PIXELS_PER_UNIT,
      },
    })
    if (interpretationResolution.status !== 'resolved') {
      dispatchHistory({ type: 'boundary' })
      executeCommand({
        kind: 'update-algebra',
        algebra: expressionDoc.algebra,
        interpretation: { interpretationId: algebraDefinition.standardInterpretationId, interpretationVersion: 1 },
      })
    }
  }

  const toggleViewportLock = () => {
    const locked = !viewportLocked
    navigation.forgetPan()
    setViewportLocked(locked)
    setViewportAnnouncement(locked ? 'Viewport locked.' : 'Viewport unlocked.')
    if (!ephemeral) persistViewportLock(locked)
  }

  const createVectorFromViewport = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return
    if (expressionDoc.items.length >= MAX_EXPRESSION_ITEMS) {
      setViewportAnnouncement(
        `${interpretation.creation.objectName} not created. The document already contains the maximum of ${MAX_EXPRESSION_ITEMS} expressions.`,
      )
      return
    }
    let id = `item-${nextId.current++}`
    while (expressionDoc.items.some((item) => item.id === id)) {
      id = `item-${nextId.current++}`
    }
    const point = toMathematical(
      viewport,
      screenPoint(event.clientX, event.clientY),
    )
    // An annotation has no name and takes no letter (#187).
    const name = nextObjectName(expressionDoc.items
      .filter((item) => item.kind !== 'annotation').map(({ source }) => source))
    const source = creationSource(interpretation.creation.constructor, name, point, viewport.pixelsPerUnit)
    viewportCreatedItemIds.current.add(id)
    pendingFocus.current = id
    executeCommand({ kind: 'insert-item', item: { id, source } })
    setViewportAnnouncement(`${name} created at ${
      source.slice(source.indexOf('(') + 1, -1)
    }.`)
  }

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const change = () => setReducedMotion(query.matches)
    query.addEventListener?.('change', change)
    return () => query.removeEventListener?.('change', change)
  }, [])

  useEffect(() => {
    const element = workspaceRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      setWorkspaceWidth(Math.max(0, Math.round(entry.contentRect.width))),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = canvasFrameRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width))
      const height = Math.max(1, Math.round(entry.contentRect.height))
      setViewportSize((current) => current.width === width && current.height === height
        ? current
        : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [visualizerActive])

  const evaluatedItems = useMemo(() => {
    const started = performance.now()
    const evaluated = evaluateDocument(expressionDoc, evaluationContext)
    performanceProbe.evaluation.record(performance.now() - started)
    return evaluated
  }, [expressionDoc, performanceProbe])
  const scalarControlEvaluations = useMemo(
    () => new Map(evaluatedItems.flatMap((evaluated) => evaluated.item.control
      ? [[evaluated.item.id, evaluateScalarControl(
          evaluated.item.control,
          evaluatedItems,
          engine,
          directScalarEdit(evaluated.item.source)?.value ?? null,
        )] as const]
      : [])),
    [evaluatedItems],
  )
  // Rows are drawn with the appearance their folders overwrite and hidden
  // with their folders; the stored appearance of each row is unchanged (DOC-013).
  const drawnDocument = useMemo(() => {
    const appearance = drawnAppearances(expressionDoc)
    return appearance === expressionDoc.appearance ? expressionDoc : { ...expressionDoc, appearance }
  }, [expressionDoc])
  const appearanceSources = useMemo(
    () => evaluateAppearanceSources(drawnDocument, evaluatedItems, engine),
    [evaluatedItems, drawnDocument, engine],
  )

  const playback = useScalarPlayback({
    items: expressionDoc.items,
    scalarControlEvaluations,
    executeCommand,
    dispatchHistory,
    reducedMotion,
  })

  const resolvedAppearances = useMemo(
    () => evaluatedItems.map(({ item, evaluation }) => {
      const kind = evaluation?.status === 'valid'
        ? evaluation.valueType === 'list'
          ? 'List'
          : interpretation.describe(evaluation.entity)
        : 'Object'
      return [item.id, resolveItemAppearance(expressionDoc.appearance[item.id], kind, declaredName(item.source))] as const
    }),
    [evaluatedItems, expressionDoc.appearance],
  )
  const resolvedStyles = useMemo(
    () => Object.fromEntries(resolvedAppearances.map(([id, resolved]) => [id, resolved.styleId])),
    [resolvedAppearances],
  )
  // A line with no stored orientation is saved without it, as it is drawn.
  const resolvedOrientation = useMemo(
    () => Object.fromEntries(resolvedAppearances.map(([id, resolved]) => [id, resolved.orientationVisible])),
    [resolvedAppearances],
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const handleHistoryShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const action = key === 'z'
        ? event.shiftKey ? 'redo' : 'undo'
        : key === 'y' && !event.shiftKey ? 'redo' : null
      if (!action) return
      event.preventDefault()
      dispatchHistoryWithFocus(action)
    }
    window.addEventListener('keydown', handleHistoryShortcut)
    return () => window.removeEventListener('keydown', handleHistoryShortcut)
  }, [dispatchHistoryWithFocus])

  useEffect(() => {
    const result = history.lastResult
    if (result && result.status !== 'applied') {
      setDocumentDiagnostic(`COMMAND_${result.status.toUpperCase()}: ${result.reason}`)
    }
  }, [history.lastResult])

  /**
   * After a failed restore the stored document is not saved over until the
   * graph is edited, then kept first; when it cannot be kept, it is never
   * saved over, and the status says so whenever it is free (#275).
   */
  const holdStored = useRef<'until-edit' | 'always' | null>('holdStored' in initial ? initial.holdStored : null)
  useEffect(() => {
    if (ephemeral || import.meta.env.MODE === 'test') return
    if (holdStored.current === 'until-edit') {
      if (expressionDoc === initial.document) return
      if (!keepUnreadableDocument(window.localStorage)) {
        holdStored.current = 'always'
        setDocumentDiagnostic(UNKEPT_STORED_DOCUMENT)
        return
      }
      holdStored.current = null
    }
    if (holdStored.current === 'always') {
      setDocumentDiagnostic((current) => current ?? UNKEPT_STORED_DOCUMENT)
      return
    }
    try {
      persistence.save(toCanonicalDocument(expressionDoc, theme, resolvedStyles, resolvedOrientation))
      setDocumentDiagnostic((current) => current?.startsWith('DOCUMENT_VIEW_UNSUPPORTED') ? current : null)
    } catch {
      setDocumentDiagnostic('STORE_WRITE_FAILED: Changes remain open, but the last saved revision was retained.')
    }
  }, [expressionDoc, persistence, resolvedStyles, resolvedOrientation, theme, ephemeral, initial.document])

  // The Studio-sized glyphs are the 1× baseline exposed to users. The
  // historical renderer used 1.5 as that baseline, so keep the visual size
  // while restoring a meaningful multiplicative setting.
  const objectRenderScale = expressionDoc.view.display.objectScale * 1.5
  // What a drag can move, and the edits it writes (#173).
  const manipulationContext: ManipulationContext = {
    document: expressionDoc,
    evaluatedItems,
    interpretation,
    tuple: engine.tuple ?? null,
    pixelsPerUnit: viewport.pixelsPerUnit,
  }
  const targets = dragTargets(manipulationContext)
  // NoViz builds no render primitives (#55).
  const { rendered: renderedPrimitives, connections: renderedConnections, omitted: omittedRenderElements } = noViz
    ? { rendered: [], connections: [], omitted: 0 }
    : collectRenderedPrimitives(
        evaluatedItems, drawnDocument.appearance, interpretation, declaredName, appearanceSources,
        expressionDoc.view.display.labelsVisible,
      )
  const manipulation = useManipulation({
    document: expressionDoc,
    evaluationContext,
    rendered: renderedPrimitives,
    context: manipulationContext,
    targets,
    viewport,
    objectRenderScale,
    svgRef: viewportSvgRef,
    screenPoint,
    guardGestureSelection,
    beginDrag: objectSelection.beginDrag,
    endDrag: objectSelection.endDrag,
    executeCommand,
    dispatchHistory,
    announce: setViewportAnnouncement,
  })
  const { selectedLine, anchorPreview } = manipulation
  const scene = layoutScene(renderedPrimitives, renderedConnections, viewport, objectRenderScale)
  // Labels are placed together, so that an automatic label can avoid the
  // other labels and the points and handles of other objects (#226).
  const placedLabel = useLabelPlacement(
    labelPlacementInputs(scene, renderedPrimitives, viewport, objectRenderScale),
    expressionDoc.view.display.objectScale,
  )

  useEffect(() => {
    const id = pendingFocus.current
    if (id) {
      inputRefs.current.get(id)?.focus()
      pendingFocus.current = null
      return
    }
    // Undoing or redoing a viewport gesture keeps focus in the viewport: on
    // the handle a keyboard gesture moved, when it still exists, otherwise on
    // the canvas, as after the gesture itself (#115).
    const traversal = pendingTraversal.current ? history.lastTraversal : null
    pendingTraversal.current = false
    if (traversal?.kind === 'viewport') {
      pendingHistoryFocus.current = null
      const handle = traversal.handleKey === null
        ? undefined
        : [...viewportSvgRef.current?.querySelectorAll('[data-handle-key]') ?? []]
          .find((element) => element.getAttribute('data-handle-key') === traversal.handleKey)
      if (handle instanceof SVGElement) handle.focus({ preventScroll: true })
      else viewportSvgRef.current?.focus({ preventScroll: true })
      return
    }
    const selection = pendingHistoryFocus.current
    if (!selection) return
    pendingHistoryFocus.current = null
    let restoredSelection = selection
    let input = document.getElementById(restoredSelection.id)
    if (!(isSourceEditor(input))) {
      const fallback = removedEditorFallbacks.current.get(selection.id)
      if (fallback) {
        restoredSelection = fallback
        input = document.getElementById(fallback.id)
      }
    }
    if (!(isSourceEditor(input)) &&
        viewportCreatedItemIds.current.has(selection.id.replace('expression-source-', ''))) {
      viewportSvgRef.current?.focus({ preventScroll: true })
      return
    }
    if (!(isSourceEditor(input))) return
    input.focus()
    const maximum = input.value.length
    input.setSelectionRange(
      Math.min(restoredSelection.start, maximum),
      Math.min(restoredSelection.end, maximum),
      restoredSelection.direction,
    )
    rememberEditorFocus(input)
  }, [expressionDoc, history.lastTraversal])

  useEffect(() => {
    const resize = (clientX: number) => {
      const drag = resizeDrag.current
      if (!drag) return
      const maximum = Math.max(
        MIN_PANEL_WIDTH,
        (workspaceRef.current?.getBoundingClientRect().width ??
          window.innerWidth) - PANEL_RESIZE_WIDTH,
      )
      setPanelWidth(
        Math.max(
          MIN_PANEL_WIDTH,
          Math.min(maximum, drag.startWidth + clientX - drag.startX),
        ),
      )
    }
    const handlePointerMove = (event: PointerEvent) => resize(event.clientX)
    const handlePointerUp = () => {
      resizeDrag.current = null
      document.body.classList.remove('resizing-panel')
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.classList.remove('resizing-panel')
    }
  }, [])

  const beginPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeDrag.current = {
      startX: event.clientX,
      startWidth: panelWidth,
    }
    document.body.classList.add('resizing-panel')
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }

  const resizePanelWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = panelWidth
    if (event.key === 'ArrowLeft') next -= 16
    else if (event.key === 'ArrowRight') next += 16
    else if (event.key === 'Home') next = MIN_PANEL_WIDTH
    else if (event.key === 'End') next = maximumPanelWidth
    else return

    event.preventDefault()
    setPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maximumPanelWidth, next)))
  }

  /**
   * Widens the expression panel until the remaining canvas is as wide as it is
   * tall. The panel cap does not apply: squaring needs the exact width the
   * workspace geometry demands.
   */
  const squareCanvas = () => {
    const workspace = workspaceRef.current?.getBoundingClientRect()
    if (!workspace || workspace.width <= 0) return
    const available = workspace.width - PANEL_RESIZE_WIDTH
    setPanelWidth(
      Math.max(MIN_PANEL_WIDTH, Math.min(available, available - workspace.height)),
    )
  }

  const insertExpression = (
    anchorId?: string,
    placement: 'before' | 'after' = 'after',
    content: Readonly<{ source: string; positionSource?: string; folder?: FolderPath; kind?: 'annotation' }> = { source: '' },
  ) => {
    if (expressionDoc.items.length >= MAX_EXPRESSION_ITEMS) return
    let id = `item-${nextId.current++}`
    while (expressionDoc.items.some((item) => item.id === id)) {
      id = `item-${nextId.current++}`
    }
    const originatingEditor = lastEditorFocus.current
    const fallbackItemId = anchorId ?? expressionDoc.items.at(-1)?.id
    if (originatingEditor) {
      removedEditorFallbacks.current.set(`expression-source-${id}`, originatingEditor)
    } else if (fallbackItemId) {
      removedEditorFallbacks.current.set(`expression-source-${id}`, {
        id: `expression-source-${fallbackItemId}`,
        start: 0,
        end: 0,
        direction: 'none',
      })
    }
    pendingFocus.current = id
    executeCommand({
      kind: 'insert-item', item: { id, ...content }, anchorId, placement,
    })
  }

  /**
   * Enter in the name field of a folder goes on to write in the folder: its
   * first row when that one is empty, as after `/`, or a new empty row at
   * the start of the folder, which opens if it is collapsed. The folder had
   * `path` before its name was validated, in the document this render shows,
   * and has `renamed` once the rename is applied, before this insertion.
   */
  const enterFolder = (path: FolderPath, renamed: FolderPath) => {
    if (isFolderCollapsed(expressionDoc, path)) dispatchHistory({ type: 'set-folder-collapsed', path: renamed, collapsed: false })
    const first = expressionDoc.items.find((item) => isWithin(itemFolder(item), path))
    if (first && first.kind !== 'annotation' && first.source === '') {
      requestAnimationFrame(() => document.getElementById(`expression-source-${first.id}`)?.focus())
      return
    }
    if (first) {
      insertExpression(first.id, 'before')
      return
    }
    // An empty folder shows before the row it names: the new row takes that place.
    const before = documentFolders(expressionDoc).find((folder) => samePath(folder.path, path))?.before
    const anchor = before !== undefined && expressionDoc.items.some((item) => item.id === before) ? before : undefined
    insertExpression(anchor, anchor === undefined ? 'after' : 'before', { source: '', folder: renamed })
  }

  /**
   * Writes the rows of a pasted block (#336): the first replaces the source of
   * the row pasted into, the others are new rows after it, in its folder. The
   * whole paste is one step, refused with a message when it would exceed the
   * item limit; the caret ends after the last line.
   */
  const pasteRows = (itemId: string, { rows, caret }: PastedRows) => {
    const added = rows.length - 1
    if (expressionDoc.items.length + added > MAX_EXPRESSION_ITEMS) {
      setCopyNotice({ message: `The paste would make more than ${MAX_EXPRESSION_ITEMS} rows; nothing was changed.`, durationMs: 6000 })
      return
    }
    // A playing slider keeps a transaction open: the paste is its own step.
    if (playback.anyPlaying) playback.stopAll()
    const taken = new Set(expressionDoc.items.map((item) => item.id))
    const ids = rows.slice(1).map(() => {
      let id = `item-${nextId.current++}`
      while (taken.has(id)) id = `item-${nextId.current++}`
      taken.add(id)
      return id
    })
    // Undoing the paste returns to the editor it was made in.
    const originatingEditor = lastEditorFocus.current ??
      { id: `expression-source-${itemId}`, start: 0, end: 0, direction: 'none' as const }
    ids.forEach((id) => removedEditorFallbacks.current.set(`expression-source-${id}`, originatingEditor))
    const [first, ...rest] = rows
    dispatchHistory({ type: 'begin-transaction' })
    executeCommand(first.kind === 'annotation'
      ? { kind: 'set-item-kind', itemId, itemKind: 'annotation', source: first.source }
      : { kind: 'update-source', itemId, source: first.source })
    rest.forEach((row, index) => executeCommand({
      kind: 'insert-item',
      item: { id: ids[index], source: row.source, ...(row.kind === 'annotation' ? { kind: 'annotation' as const } : {}) },
      anchorId: index === 0 ? itemId : ids[index - 1],
      placement: 'after',
    }))
    dispatchHistory({ type: 'commit-transaction' })
    if (added > 0) setReorderAnnouncement(`Pasted ${rows.length} rows.`)
    const lastId = ids.at(-1) ?? itemId
    requestAnimationFrame(() => {
      const editor = inputRefs.current.get(lastId)
      editor?.focus()
      editor?.setSelectionRange(caret, caret)
    })
  }

  /**
   * Turns an empty folder back into a row, where the folder shows, written
   * `source`, as Backspace turns a note back into an expression: one step.
   */
  const folderToRow = (path: FolderPath, source: string) => {
    if (expressionDoc.items.length >= MAX_EXPRESSION_ITEMS) return
    const before = documentFolders(expressionDoc).find((folder) => samePath(folder.path, path))?.before
    const anchor = before !== undefined && expressionDoc.items.some((item) => item.id === before) ? before : undefined
    let id = `item-${nextId.current++}`
    while (expressionDoc.items.some((item) => item.id === id)) id = `item-${nextId.current++}`
    // A playing slider keeps a transaction open: this change is its own step.
    if (playback.anyPlaying) playback.stopAll()
    dispatchHistory({ type: 'begin-transaction' })
    executeCommand({ kind: 'insert-item', item: { id, source }, anchorId: anchor, placement: anchor === undefined ? 'after' : 'before' })
    executeCommand({ kind: 'delete-folder', path })
    dispatchHistory({ type: 'commit-transaction' })
    // The caret goes before the text, where the slash was.
    requestAnimationFrame(() => {
      const editor = inputRefs.current.get(id)
      editor?.focus()
      editor?.setSelectionRange(0, 0)
    })
  }

  /** Adds a reference example as a new expression at the end of the list (#259). */
  const addReferenceExample = (example: ReferenceExample) => insertExpression(undefined, 'after', {
    source: example.source,
    ...(example.positionSource === undefined ? {} : { positionSource: example.positionSource }),
  })

  const closeReference = () => {
    setReferenceOpen(false)
    expressionReferenceButtonRef.current?.focus()
  }

  const changeReferenceHeight = (height: number) => {
    const next = clampedReferenceHeight(height)
    setReferenceHeight(next)
    if (!ephemeral) persistReferenceHeight(next)
  }

  const resizeReferenceWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    changeReferenceHeight(referenceHeight + (event.key === 'ArrowUp' ? REFERENCE_HEIGHT_STEP : -REFERENCE_HEIGHT_STEP))
  }

  /** Dragging the handle shares the panel height between the list and the reference. */
  const beginReferenceResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const panel = expressionPanelRef.current
    if (!panel || event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const band = panel.querySelector<HTMLElement>('.expression-panel-footer')?.offsetHeight ?? 0
    const heightAt = (clientY: number) => {
      const box = panel.getBoundingClientRect()
      return box.height > 0 ? (box.bottom - band - clientY) / box.height : referenceHeight
    }
    let latest = referenceHeight
    const move = (moveEvent: PointerEvent) => {
      latest = clampedReferenceHeight(heightAt(moveEvent.clientY))
      setReferenceHeight(latest)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      if (!ephemeral) persistReferenceHeight(latest)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  /**
   * Opens a chosen or dropped document file: size limit, parsing, migration,
   * validation, the replace or duplicate choice, and diagnostics. A temporary
   * scene-link session stays temporary.
   */
  const importDocumentFile = async (file: File) => {
    if (playback.anyPlaying) playback.stopAll()
    try {
      const parsed = await readDocumentFile(file)
      const collision = parsed.id === expressionDoc.id
      const choice = collision && !window.confirm(
        'A document with this identity is already open. Choose OK to replace it, or Cancel to duplicate the import with fresh identities.',
      ) ? 'duplicate' : 'replace'
      const imported = fromCanonicalDocument(
        resolveCanonicalImport(expressionDoc.id, parsed, choice),
        restoreOptions,
      )
      requireAvailableAlgebra(algebraRegistry, imported.document.algebra)
      // The import replaces the autosaved active document, which the library
      // keeps first if it still has to; a temporary session writes nothing.
      if (!ephemeral) keepFormerDocument()
      dispatchHistory({ type: 'replace', document: imported.document })
      // An imported graph is not a library graph, even with a library identity.
      librarySession.unbind()
      setTheme(imported.theme)
      setAppearanceItemId(null)
      setExpandedListIds(new Set())
      viewportCreatedItemIds.current.clear()
      nextId.current = imported.document.items.length + 1
      setDocumentDiagnostic(imported.recoveryDiagnostic)
      showMigrationNotice(documentMigration(parsed))
    } catch (error) {
      setDocumentDiagnostic(
        documentFileDiagnostic(error, 'DOCUMENT_IMPORT_FAILED: The document could not be imported.'),
      )
    }
  }

  // Dropping a document file anywhere on the window opens it through the
  // import path. Only drags that carry files are handled, so text dragged
  // into an editor and the pointer-driven reordering and viewport drags are
  // unaffected.
  const importDroppedFile = useRef(importDocumentFile)
  const importDroppedArchive = useRef<(file: File) => void>(() => undefined)
  useEffect(() => { importDroppedFile.current = importDocumentFile })
  useEffect(() => {
    // An embedded scene opens no other document.
    if (embed) return
    let depth = 0
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth += 1
      setFileDragActive(true)
    }
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      // Browsers may drop a nested dragleave, or skip it when the drag is
      // cancelled; leaving the window (no related target) always resets the
      // count so the overlay cannot stay stuck.
      depth = event.relatedTarget === null ? 0 : Math.max(0, depth - 1)
      if (depth === 0) setFileDragActive(false)
    }
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      setFileDragActive(false)
      const dropped = selectDroppedDocument(event.dataTransfer?.files ?? [])
      if (dropped.status === 'rejected') setDocumentDiagnostic(dropped.diagnostic)
      else if (dropped.status === 'file') void importDroppedFile.current(dropped.file)
      else if (dropped.status === 'archive') importDroppedArchive.current(dropped.file)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [embed])

  const copyScene = async () => {
    setSharing(true)
    setShareResult(null)
    setCopyNotice(null)
    try {
      const url = await createSceneLink(toCanonicalDocument(expressionDoc, theme, resolvedStyles, resolvedOrientation), new URL(import.meta.env.BASE_URL, window.location.href).href)
      let copied = false
      try { await navigator.clipboard.writeText(url); copied = true } catch { /* The selectable text remains available when clipboard access is blocked. */ }
      const warning = url.length > SHARE_URL_WARNING_LENGTH
        ? ' This link exceeds 8 KiB and some presentation tools may reject it. JSON export is also available.' : ''
      if (copied) {
        setCopyNotice({ message: 'Link copied.' + warning, durationMs: warning ? 8000 : 2500 })
      } else {
        setShareResult({ content: url, label: 'Scene link', message: 'Select and copy the text below.' + warning })
      }
    } catch (error) {
      setDocumentDiagnostic(documentFileDiagnostic(error, 'SHARE_EXPORT_FAILED: The scene link could not be created. Use JSON export instead.'))
    } finally { setSharing(false) }
  }

  /** The editor's part of opening another graph; the library session does the rest. */
  const replaceDocument = (document: ExpressionDocument, nextTheme: ThemeMode, diagnostic: string | null) => {
    if (playback.anyPlaying) playback.stopAll()
    dispatchHistory({ type: 'replace', document })
    setTheme(nextTheme)
    setAppearanceItemId(null)
    setExpandedListIds(new Set())
    viewportCreatedItemIds.current.clear()
    nextId.current = document.items.length + 1
    setDocumentDiagnostic(diagnostic)
  }
  // The local library of named graphs (#212).
  const librarySession = useLibrarySession({
    registry: algebraRegistry,
    restoreOptions,
    temporary,
    ephemeral,
    endTemporarySession: () => {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      setEphemeral(false)
    },
    initialDocument: initial.document,
    restored: 'restored' in initial,
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
  })
  const {
    library, boundId, libraryOpen, libraryNaming, saveButtonRef, libraryButtonRef, libraryReturnFocusRef,
    unsavedChanges, discardableChanges, graphName, archiveReport, libraryFolderActions,
    closeLibrary, toggleLibrary, keepFormerDocument, commitLibrarySave, saveToLibraryRequest,
    openLibraryEntry, newLibraryGraph, renameLibraryEntry, renameOpenGraph, duplicateLibraryEntry,
    deleteLibraryEntry, openExample, addExampleToLibrary, exportLibrary, importLibrary,
  } = librarySession
  /** The viewport the library panel is laid over on a narrow window. */
  const [viewportHost, setViewportHost] = useState<HTMLElement | null>(null)

  const exportDocument = () => {
    try {
      downloadDocumentFile(
        toCanonicalDocument(expressionDoc, theme, resolvedStyles, resolvedOrientation),
        expressionDoc.title,
      )
      setDocumentDiagnostic(null)
    } catch (error) {
      setDocumentDiagnostic(
        documentFileDiagnostic(error, 'DOCUMENT_EXPORT_FAILED: The document could not be exported.'),
      )
    }
  }

  const removeExpression = (id: string) => {
    if (playback.isPlaying(id)) playback.stop(id)
    // Focus goes to a visible row: those of a collapsed folder cannot take it.
    const visible = expressionRows(expressionDoc).flatMap((row) => row.kind === 'entry' ? [row.entry.id] : [])
    const index = visible.indexOf(id)
    const neighbor = index < 0 ? null : visible[index - 1] ?? visible[index + 1] ?? null
    pendingFocus.current = neighbor
    setExpandedListIds((current) => {
      if (!current.has(id)) return current
      const next = new Set(current)
      next.delete(id)
      return next
    })
    executeCommand({ kind: 'delete-item', itemId: id })
    if (!neighbor) {
      requestAnimationFrame(() => addButtonRef.current?.focus())
    }
  }

  /**
   * Applies a registered definition with its standard interpretation and
   * visualizer (ALG-004). A document with content is cleared first, after
   * confirmation, in the same history entry so one undo restores both.
   */
  const selectAlgebra = (algebraId: string) => {
    const definition = algebraRegistry.definitions().find((candidate) => candidate.algebraId === algebraId)
    if (!definition || definition.algebraId === expressionDoc.algebra.algebraId) return
    const conventionVersion = definition.conventionVersions[definition.conventionVersions.length - 1]
    const validation = definition.validateParameters({})
    if (validation.status !== 'valid') return
    const showcase = showcaseDocument(definition)
    const clearing = hasContent(expressionDoc)
    if (clearing && !window.confirm(
      `Switching to ${definition.badge} replaces every expression of this document with its example. Continue?`,
    )) return
    if (playback.anyPlaying) playback.stopAll()
    setAppearanceItemId(null)
    setExpandedListIds(new Set())
    dispatchHistory({ type: 'begin-transaction' })
    if (expressionDoc.items.length > 0 || documentFolders(expressionDoc).length > 0) executeCommand({ kind: 'clear-items' })
    executeCommand({
      kind: 'select-algebra',
      algebra: {
        algebraId: definition.algebraId,
        definitionVersion: definition.definitionVersion,
        conventionVersion,
        parameters: validation.parameters,
      },
      interpretation: { interpretationId: definition.standardInterpretationId, interpretationVersion: 1 },
      // A NoViz document stays a calculator in the new algebra.
      visualizerId: noViz ? null : definition.standardVisualizerId,
      title: showcase?.title ?? `${definition.badge} example`,
      description: showcase?.description ?? '',
    })
    // The switch lands on the algebra's showcase example, as listed in Examples (#217).
    if (showcase) {
      for (const folder of documentFolders(showcase)) executeCommand({ kind: 'create-folder', path: folder.path })
      for (const item of showcase.items) executeCommand({ kind: 'insert-item', item })
      for (const [itemId, appearance] of Object.entries(showcase.appearance))
        if (appearance) executeCommand({ kind: 'update-appearance', itemId, appearance })
      for (const folder of documentFolders(showcase)) {
        if (folder.collapsed) dispatchHistory({ type: 'set-folder-collapsed', path: folder.path, collapsed: true })
        if (folder.appearance || folder.overwriteAppearance)
          executeCommand({ kind: 'update-folder-appearance', path: folder.path, appearance: folder.appearance, overwriteAppearance: folder.overwriteAppearance })
      }
    }
    nextId.current = (showcase?.items.length ?? 0) + 1
    dispatchHistory({ type: 'commit-transaction' })
    setViewportAnnouncement(`${definition.badge} selected; its example document was loaded.`)
  }

  const clearAllExpressions = () => {
    if (playback.anyPlaying) playback.stopAll()
    setAppearanceItemId(null)
    setExpandedListIds(new Set())
    executeCommand({ kind: 'clear-items' })
    requestAnimationFrame(() => addButtonRef.current?.focus())
  }

  /** Moves the row of a focused editor and restores its caret afterwards. */
  const moveItemFromEditor = (
    editor: SourceEditor,
    itemId: string,
    step: 'up' | 'down',
  ) => {
    rememberEditorFocus(editor)
    pendingHistoryFocus.current = lastEditorFocus.current
    // A refused move changes no document, so nothing would consume the focus.
    if (!folders.moveStep(itemId, step)) pendingHistoryFocus.current = null
  }

  const handleItemKeyDown = (
    event: KeyboardEvent<SourceEditor>,
    item: ExpressionItem,
    _index: number,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      insertExpression(item.id, event.shiftKey ? 'before' : 'after')
    } else if (event.key === 'Backspace' && item.source === '') {
      event.preventDefault()
      removeExpression(item.id)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const up = event.key === 'ArrowUp'
      if (event.altKey) {
        event.preventDefault()
        moveItemFromEditor(event.currentTarget, item.id, up ? 'up' : 'down')
        return
      }
      // Focus moves through the visible rows: those of a collapsed folder are skipped.
      const visible = expressionRows(expressionDoc).flatMap((row) => row.kind === 'entry' ? [row.entry.id] : [])
      const neighbor = visible[visible.indexOf(item.id) + (up ? -1 : 1)]
      if (neighbor === undefined) return
      event.preventDefault()
      inputRefs.current.get(neighbor)?.focus()
    }
  }

  const displayedNumber = (value: number) => formatDisplayNumber(
    value,
    expressionDoc.view.display.decimalPlaces,
  )
  const canvasDescription = describeViewport({
    primitives: renderedPrimitives.map(({ primitive }) => primitive),
    describedKinds: visualizer?.describedKinds ?? [],
    expressionCount: expressionDoc.items.length,
    omittedElements: omittedRenderElements,
    creationObject: embed ? null : interpretation.creation.objectName.toLowerCase(),
    formatNumber: displayedNumber,
  })

  const expressionRowElementRefs: ExpressionRowRefs = {
    expressionRowRefs,
    inputRefs,
    normalizationToggleRefs,
    appearanceAnchorRef,
    normalizationAnchorRef,
  }
  /** The kinds of objects a folder holds, which its appearance menu shows a section for. */
  const folderKinds = (path: FolderPath): string[] => {
    const kinds = new Set<string>()
    for (const { item, evaluation } of evaluatedItems) {
      if (!isWithin(itemFolder(item), path) || evaluation?.status !== 'valid' || evaluation.valueType !== 'single') continue
      kinds.add(interpretation.describe(evaluation.entity))
    }
    return FOLDER_STYLE_KINDS.filter((kind) => kinds.has(kind))
  }
  /** The eye and the appearance swatch of a folder, before its remove button. */
  const renderFolderActions = (path: FolderPath, name: string) => {
    const folder = documentFolders(expressionDoc).find((candidate) => samePath(candidate.path, path))
    const visible = folder?.appearance?.visible ?? true
    const style = folder?.appearance?.style ?? defaultStyleForKind('Object')
    const menuOpen = folderMenuPath !== null && samePath(folderMenuPath, path)
    return <>
      <button
        type="button"
        className="folder-action folder-visibility"
        aria-label={`${visible ? 'Hide' : 'Show'} folder ${name}`}
        aria-pressed={visible}
        title={visible ? 'Hide the rows of the folder' : 'Show the rows of the folder'}
        onClick={() => executeCommand({ kind: 'update-folder-appearance', path, appearance: { visible: !visible } })}
      >
        <svg className="visibility-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
          {!visible && <path className="visibility-icon-slash" d="M2.5 13.5 13.5 2.5" />}
        </svg>
      </button>
      {!noViz && (
        <button
          type="button"
          className={`appearance-swatch folder-swatch${folder?.overwriteAppearance ? '' : ' is-inactive'}`}
          aria-label={`Open appearance menu for folder ${name}`}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          title={folder?.overwriteAppearance ? 'Appearance of the folder, overwriting its rows' : 'Appearance of the folder'}
          onClick={(event) => {
            folderMenuAnchorRef.current = event.currentTarget
            setFolderMenuPath(menuOpen ? null : path)
          }}
        >
          <span className="appearance-swatch-fill" style={{ backgroundColor: studioColor(style) }} aria-hidden="true" />
        </button>
      )}
    </>
  }
  const folderMenu = (() => {
    if (folderMenuPath === null || noViz) return null
    const folder = documentFolders(expressionDoc).find((candidate) => samePath(candidate.path, folderMenuPath))
    if (!folder) return null
    const path = folder.path
    const appearance = folder.appearance ?? {}
    const style = appearance.style ?? defaultStyleForKind('Object')
    const update = (change: ExpressionAppearance, coalesceKey?: string) =>
      executeCommand({ kind: 'update-folder-appearance', path, appearance: change }, coalesceKey ? `folder-appearance:${folderKey(path)}:${coalesceKey}` : undefined)
    return (
      <AppearancePopover
        kind={`Folder ${folderName(path)}`}
        styleId={style}
        visible={appearance.visible ?? true}
        labelVisible={false}
        borderVisible={appearance.borderVisible ?? false}
        orientationVisible={appearance.orientationVisible ?? true}
        bivectorShape={appearance.bivectorShape ?? 'from-vectors'}
        parallelogramAvailable
        idealPointDisplay={appearance.idealPointDisplay ?? 'vector'}
        appearance={appearance}
        reducedMotion={reducedMotion}
        anchorRef={folderMenuAnchorRef}
        folder={{
          kinds: folderKinds(path),
          overwrite: folder.overwriteAppearance ?? false,
          // Turning it on fixes the colour shown, so that every row takes it.
          onOverwriteChange: (overwriteAppearance) => executeCommand({
            kind: 'update-folder-appearance', path, overwriteAppearance,
            ...(overwriteAppearance && appearance.style === undefined ? { appearance: { style } } : {}),
          }),
        }}
        onStyleChange={(style) => update({ style })}
        onVisibleChange={(visible) => update({ visible })}
        onLabelVisibleChange={() => undefined}
        onBorderVisibleChange={(borderVisible) => update({ borderVisible })}
        onOrientationVisibleChange={(orientationVisible) => update({ orientationVisible })}
        onBivectorShapeChange={(bivectorShape) => update({ bivectorShape })}
        onIdealPointDisplayChange={(idealPointDisplay) => update({ idealPointDisplay })}
        onAppearanceChange={(change, coalesceKey) => update(change, coalesceKey)}
        onClose={() => setFolderMenuPath(null)}
      />
    )
  })()

  const expressionRowActions: ExpressionRowActions = {
    executeCommand,
    dispatchHistory,
    rememberEditorFocus,
    handleItemKeyDown,
    insertExpression,
    removeExpression,
    beginRowReorder: folders.beginRowReorder,
    reorderRowWithKeyboard: folders.reorderRowWithKeyboard,
    convertRowToFolder: folders.convertRowToFolder,
    pasteRows,
    focusRow: objectSelection.row.focus,
    blurRow: objectSelection.row.blur,
    hoverRow: objectSelection.row.hover,
    leaveRow: objectSelection.row.leave,
    toggleAppearance: (itemId) => setAppearanceItemId((current) => current === itemId ? null : itemId),
    closeAppearance,
    toggleNormalizationChoice: (itemId) => setNormalizationChoiceId((current) => current === itemId ? null : itemId),
    closeNormalizationChoice,
    toggleListExpanded: (itemId) => setExpandedListIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    }),
  }
  const documentHeaderRefs: DocumentHeaderRefs = {
    algebraInfoButtonRef,
    saveButtonRef,
    libraryButtonRef,
  }
  const documentHeaderActions: DocumentHeaderActions = {
    selectAlgebra,
    showAlgebraInfo: () => setInfoDialog('algebra'),
    renameGraph: renameOpenGraph,
    saveToLibrary: saveToLibraryRequest,
    toggleLibrary,
    importFile: importDocumentFile,
    exportDocument,
    copyLink: () => void copyScene(),
    changeTheme: setTheme,
    changeDisplay: updateDisplay,
    changePanelStyle,
    changePerformanceMonitor,
  }
  return (
    <div className={`app-shell${embed ? ' is-embedded' : ''}`}>
      {/* Embed mode (#215) keeps the canvas alone: no header, notices, or panels. */}
      {!embed && <>
      <DocumentHeader
        algebraBadge={algebraDefinition.badge}
        algebraChoices={algebraRegistry.definitions().map((definition) => ({
          algebraId: definition.algebraId,
          badge: definition.badge,
          name: definition.info({}).name,
        }))}
        selectedAlgebraId={algebraDefinition.algebraId}
        graphName={graphName}
        temporarySession={ephemeral}
        unsavedChanges={unsavedChanges}
        libraryOpen={libraryOpen}
        sharing={sharing}
        theme={theme}
        display={expressionDoc.view.display}
        panelStyle={panelStyle}
        performanceMonitor={performanceMonitor}
        renderingSettings={!noViz}
        refs={documentHeaderRefs}
        actions={documentHeaderActions}
      />

      <DocumentNotices
        copyNotice={copyNotice?.message ?? null}
        shareResult={shareResult}
        onCloseShare={() => setShareResult(null)}
        documentDiagnostic={documentDiagnostic}
      />
      {interpretationResolution.status === 'unavailable' && (
        <div className="document-diagnostic" role="alert">
          {interpretationResolution.code}: {interpretationResolution.message}
        </div>
      )}
      </>}

      <div className="workspace-frame">
      <main className="workspace" ref={workspaceRef}>
        {embed && noViz && <p className="embed-unavailable" role="status">
          This scene has no canvas to show. Open it in GAMUT to see its expressions.
        </p>}
        {!embed && <aside
          ref={expressionPanelRef}
          id="expression-panel"
          tabIndex={-1}
          className={`expression-panel${panelStyle === 'cards' ? ' is-cards' : ''}${panelHidden ? ' is-collapsed' : ''}${noViz ? ' is-full-width' : ''}${referenceOpen ? ' has-reference' : ''}`}
          aria-label="Expressions"
          style={noViz ? undefined : { width: panelWidth, '--panel-width': `${panelWidth}px` } as CSSProperties}
          inert={panelHidden}
        >
          <div className="expression-toolbar">
            <AddMenu
              addButtonRef={addButtonRef}
              full={expressionDoc.items.length >= MAX_EXPRESSION_ITEMS}
              onAddExpression={() => insertExpression()}
              onAddComment={() => insertExpression(undefined, 'after', { source: '', kind: 'annotation' })}
              onAddFolder={folders.createFolder}
            />
            <div className="expression-history-controls" role="group" aria-label="Expression history">
              <button
                type="button"
                className="history-command"
                disabled={history.past.length === 0}
                aria-label="Undo document change"
                title="Undo (Ctrl/Cmd+Z)"
                onClick={() => dispatchHistoryWithFocus('undo')}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M6.5 3.5L3 7l3.5 3.5" />
                  <path d="M3.5 7h7.25a4.25 4.25 0 0 1 0 8.5H8" />
                </svg>
              </button>
              <button
                type="button"
                className="history-command"
                disabled={history.future.length === 0}
                aria-label="Redo document change"
                title="Redo (Ctrl/Cmd+Shift+Z)"
                onClick={() => dispatchHistoryWithFocus('redo')}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M11.5 3.5L15 7l-3.5 3.5" />
                  <path d="M14.5 7H7.25a4.25 4.25 0 0 0 0 8.5H10" />
                </svg>
              </button>
            </div>
            {noViz && <>
              <span className="workspace-mode" role="status">NoViz calculator</span>
              <button
                ref={showCanvasButtonRef}
                type="button"
                className="panel-toggle show-canvas"
                aria-label="Show canvas"
                title="Show canvas"
                onClick={leaveNoViz}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" />
                  <line x1="10" y1="2.75" x2="10" y2="13.25" />
                  <path d="M7 6l-2 2 2 2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>}
            {visualizerActive && <button
              ref={collapsePanelButtonRef}
              type="button"
              className="panel-toggle panel-collapse"
              aria-label="Collapse expression panel"
              title="Collapse expression panel"
              aria-expanded={!panelHidden}
              aria-controls="expression-panel"
              onClick={togglePanelCollapsed}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" />
                <line x1="6" y1="2.75" x2="6" y2="13.25" />
                <path d="M11 6l-2 2 2 2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>}
          </div>

          <div className="expression-list">
            <ExpressionTree document={expressionDoc} folders={folders} folderActions={renderFolderActions} onEnterFolder={enterFolder} onFolderToRow={folderToRow} renderItem={(itemId) => {
              const index = evaluatedItems.findIndex((candidate) => candidate.item.id === itemId)
              const entry = evaluatedItems[index]
              if (!entry) return null
              const target = folders.dropTarget
              return <ExpressionRow
                key={entry.item.id}
                entry={entry}
                index={index}
                evaluatedItems={evaluatedItems}
                scalarControlEvaluation={scalarControlEvaluations.get(entry.item.id)}
                appearance={rowAppearance(expressionDoc, entry.item)}
                appearanceSetBy={(() => {
                  const setBy = overwritingFolder(expressionDoc, entry.item)
                  return setBy ? folderName(setBy.path) : undefined
                })()}
                appearanceSources={appearanceSources.get(entry.item.id) ?? DEFAULT_APPEARANCE_SOURCES}
                engine={engine}
                interpretation={interpretation}
                display={expressionDoc.view.display}
                noViz={noViz}
                draggableAvailable={!noViz && entry.evaluation?.status === 'valid' &&
                  entry.evaluation.valueType === 'single' && entry.evaluation.primitive !== null &&
                  targets.draggableByConstruction(entry.item, entry.evaluation.entity)}
                reducedMotion={reducedMotion}
                dropBefore={target?.kind === 'before' && target.itemId === itemId}
                dropAfter={(target?.kind === 'after' && target.itemId === itemId) ||
                  (target?.kind === 'end' && index === evaluatedItems.length - 1)}
                listExpanded={expandedListIds.has(entry.item.id)}
                appearanceOpen={appearanceItemId === entry.item.id}
                normalizationChoiceActive={normalizationChoiceId === entry.item.id}
                isPlaying={playback.isPlaying(entry.item.id)}
                playback={playback}
                refs={expressionRowElementRefs}
                actions={expressionRowActions}
              />
            }} />
          </div>
          <div className="expression-list-footer">
            <ClearExpressionsButton
              count={expressionDoc.items.length + documentFolders(expressionDoc).length}
              onClear={clearAllExpressions}
            />
          </div>
          {referenceOpen && <div
            className="reference-resize"
            role="separator"
            aria-label="Resize the expression reference"
            aria-orientation="horizontal"
            aria-controls="expression-reference"
            aria-valuemin={Math.round(MIN_REFERENCE_HEIGHT * 100)}
            aria-valuemax={Math.round(MAX_REFERENCE_HEIGHT * 100)}
            aria-valuenow={Math.round(referenceHeight * 100)}
            aria-valuetext={`Reference ${Math.round(referenceHeight * 100)} % of the panel`}
            tabIndex={0}
            onPointerDown={beginReferenceResize}
            onKeyDown={resizeReferenceWithKeyboard}
          />}
          <div className="expression-panel-footer">
            <button
              ref={expressionReferenceButtonRef}
              type="button"
              className="expression-reference-button"
              aria-expanded={referenceOpen}
              aria-controls="expression-reference"
              onClick={() => setReferenceOpen((open) => !open)}
            >
              <span className="expression-reference-chevron" aria-hidden="true">▾</span>
              <span aria-hidden="true">?</span>
              <span>Expression reference</span>
              <span className="expression-reference-badge">{algebraDefinition.badge}</span>
            </button>
          </div>
          <section
            id="expression-reference"
            className="expression-reference"
            aria-label="Expression reference"
            hidden={!referenceOpen}
            style={{ flexBasis: `${Math.round(referenceHeight * 100)}%` }}
          >
            {referenceOpen && <ExpressionReference
              algebraBadge={algebraDefinition.badge}
              generalSections={algebraDefinition.generalReference}
              algebraSections={algebraDefinition.expressionReference}
              algebraTopics={algebraDefinition.algebraReference}
              canAdd={expressionDoc.items.length < MAX_EXPRESSION_ITEMS}
              onAdd={addReferenceExample}
              onClose={closeReference}
            />}
          </section>
        </aside>}

        {!embed && !panelHidden && !noViz && <div
          className="panel-resize"
          role="separator"
          aria-label="Resize expression panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_PANEL_WIDTH}
          aria-valuemax={maximumPanelWidth}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onPointerDown={beginPanelResize}
          onKeyDown={resizePanelWithKeyboard}
        />}

        {visualizerActive && <section ref={setViewportHost} className="visualizer" aria-label={visualizer?.regionName}>
          <div ref={canvasFrameRef} className="canvas-frame">
            <CanvasSliders
              evaluatedItems={evaluatedItems}
              appearanceOf={(itemId) => expressionDoc.appearance[itemId]}
              scalarControlEvaluations={scalarControlEvaluations}
              engine={engine}
              decimalPlaces={expressionDoc.view.display.decimalPlaces}
              playback={playback}
              executeCommand={executeCommand}
              dispatchHistory={dispatchHistory}
            />
            {performanceMonitor && !embed && <PerformanceMonitor
              probe={performanceProbe}
              canvasRef={viewportSvgRef}
              expressionCount={expressionDoc.items.length}
            />}
            {!embed && <>
            {panelHidden && <button
              ref={expandPanelButtonRef}
              type="button"
              className="panel-toggle panel-expand"
              aria-label="Expand expression panel"
              title="Expand expression panel"
              aria-expanded={false}
              aria-controls="expression-panel"
              onClick={togglePanelCollapsed}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" />
                <line x1="6" y1="2.75" x2="6" y2="13.25" />
                <path d="M9 6l2 2-2 2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>}
            <button
              ref={hideCanvasButtonRef}
              type="button"
              className="panel-toggle hide-canvas"
              aria-label="Hide canvas (NoViz calculator)"
              title="Hide canvas (NoViz calculator)"
              onClick={enterNoViz}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" />
                <line x1="10" y1="2.75" x2="10" y2="13.25" />
                <path d="M5 6l2 2-2 2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            </>}
            {/* Embed mode keeps zoom and recenter, for touch screens without pinch zoom, unless locked. */}
            {!embed?.viewportLocked && <div
              className="viewport-toolbar"
              role="toolbar"
              aria-label="Viewport controls"
            >
              {!embed && <button
                type="button"
                className="viewport-command viewport-lock"
                onClick={toggleViewportLock}
                aria-label={viewportLocked ? 'Unlock viewport' : 'Lock viewport'}
                aria-pressed={viewportLocked}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3.25" y="7" width="9.5" height="7" rx="1.25" fill="none" />
                  <path
                    d={viewportLocked
                      ? 'M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2'
                      : 'M10.75 7V5a2.75 2.75 0 0 0-5.5 0'}
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </button>}
              <div className="viewport-navigation">
              <button
                type="button"
                className="viewport-command"
                onClick={() => navigation.zoom(1.25)}
                aria-label="Zoom in"
                disabled={viewportLocked}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <line x1="8" y1="3" x2="8" y2="13" strokeLinecap="round" />
                  <line x1="3" y1="8" x2="13" y2="8" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className="viewport-command"
                onClick={() => navigation.zoom(0.8)}
                aria-label="Zoom out"
                disabled={viewportLocked}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <line x1="3" y1="8" x2="13" y2="8" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                className="viewport-command"
                onClick={navigation.recenter}
                aria-label="Recenter view"
                disabled={viewportLocked}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <line x1="8" y1="1.5" x2="8" y2="14.5" strokeLinecap="round" />
                  <line x1="1.5" y1="8" x2="14.5" y2="8" strokeLinecap="round" />
                  <circle cx="8" cy="8" r="3.2" fill="none" />
                </svg>
              </button>
              {!embed && <>
              <button
                type="button"
                className="viewport-command"
                onClick={squareCanvas}
                aria-label="Make canvas square"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="11" height="11" fill="none" />
                </svg>
              </button>
              <ZoomLevelField
                pixelsPerUnit={viewport.pixelsPerUnit}
                locked={viewportLocked}
                onZoom={(pixelsPerUnit) => updateViewport(zoomAt(
                  viewport, { x: viewport.width / 2, y: viewport.height / 2 }, pixelsPerUnit,
                ))}
              />
              </>}
              </div>
            </div>}
            <svg
              ref={navigation.attachSvg}
              className={`canvas${viewportLocked ? ' is-viewport-locked' : ''}`}
              viewBox={`0 0 ${viewport.width} ${viewport.height}`}
              role="img"
              aria-label={visualizer?.canvasName}
              aria-describedby="canvas-description"
              tabIndex={0}
              onPointerDown={beginViewportPan}
              onPointerMove={moveViewportPan}
              onPointerUp={endViewportPan}
              onPointerCancel={cancelViewportPan}
              onLostPointerCapture={loseViewportCapture}
              onKeyDown={navigation.navigateWithKeyboard}
              onDoubleClick={embed ? undefined : createVectorFromViewport}
              onFocus={objectSelection.canvasFocus}
              onBlur={objectSelection.canvasBlur}
            >
              <desc id="canvas-description">{canvasDescription}</desc>
              <CanvasBackground
                viewport={viewport}
                grid={grid}
                display={expressionDoc.view.display}
                scale={objectRenderScale}
                formatNumber={displayedNumber}
              />
              <SceneGlyphs
                scene={scene}
                viewport={viewport}
                scale={objectRenderScale}
                placedLabel={placedLabel}
                movability={glyphMovability}
                controller={handleController}
                selectedObjectId={selectedObjectId}
                selectedLine={selectedLine}
              />
              {anchorPreview && <g className="anchor-preview" aria-hidden="true">
                <circle cx={anchorPreview.point.x} cy={anchorPreview.point.y} r="12" />
                <circle cx={anchorPreview.point.x} cy={anchorPreview.point.y} r="3" />
              </g>}
            </svg>
            <output className="visually-hidden" aria-live="polite">
              {viewportAnnouncement}
            </output>
          </div>
        </section>}
      </main>
      {embed && <EmbedControls sceneLinked={!!sharedDocument} />}
      {libraryOpen && !embed && (
        <LibraryPanel
          // A save request asks for a name in a fresh panel.
          key={libraryNaming ? 'naming' : 'browsing'}
          returnFocusRef={libraryReturnFocusRef}
          overlayHost={viewportHost}
          entries={library?.entries ?? []}
          folders={library?.folders ?? []}
          folderActions={libraryFolderActions}
          algebras={algebraRegistry.definitions()}
          openId={ephemeral ? '' : boundId ?? ''}
          naming={libraryNaming}
          diagnostic={library?.diagnostic ?? null}
          unsavedChanges={discardableChanges}
          temporarySession={ephemeral}
          onSaveAs={(name) => { commitLibrarySave(name) }}
          onSaveAsNew={(name) => { commitLibrarySave(name, true) }}
          currentName={expressionDoc.title.trim() || 'Untitled graph'}
          onNew={newLibraryGraph}
          onOpen={openLibraryEntry}
          onRename={(entry, name) => { renameLibraryEntry(entry.id, name) }}
          onDuplicate={duplicateLibraryEntry}
          onDelete={deleteLibraryEntry}
          onOpenExample={openExample}
          onAddExample={addExampleToLibrary}
          onAddScene={() => { commitLibrarySave(expressionDoc.title.trim() || 'Untitled graph') }}
          graphThumbnail={(entry) => {
            const document = librarySession.libraryThumbnailDocument(entry)
            return document && <SceneThumbnail document={document} registry={algebraRegistry} />
          }}
          exampleThumbnail={(example) => <SceneThumbnail document={example.document} registry={algebraRegistry} />}
          archiveReport={archiveReport}
          onDismissArchiveReport={librarySession.dismissArchiveReport}
          onExportLibrary={() => { void exportLibrary() }}
          onImportLibrary={(file) => { void importLibrary(file) }}
          onClose={closeLibrary}
        />
      )}
      </div>
      {folderMenu}
      {infoDialog === 'algebra' && (
        <AlgebraInfoDialog
          info={algebraDefinition.info(algebraResolution.parameters)}
          returnFocusRef={algebraInfoButtonRef}
          onClose={closeInfoDialog}
        />
      )}
      <output className="visually-hidden" aria-live="polite">
        {playback.announcement}
      </output>
      <output className="visually-hidden" aria-live="polite">
        {reorderAnnouncement}
      </output>
      <div className="file-drop-status" role="status">
        {fileDragActive && (
          <div className="file-drop-overlay">
            <p>Drop a JSON document to open it, or a library .zip to import it</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
