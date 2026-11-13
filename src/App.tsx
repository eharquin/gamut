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
  type ReactElement,
} from 'react'
import { showcaseMetadata } from './algebra/algebraDefinition'
import { createBuiltinAlgebraRegistry } from './algebra/builtinAlgebras'
import { declarationDependsOn, evaluateDocument } from './application/evaluateDocument'
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
import { ClearExpressionsButton } from './components/ClearExpressionsButton'
import { ExpressionRow, type ExpressionRowActions, type ExpressionRowRefs } from './components/ExpressionRow'
import { ExpressionTree } from './components/ExpressionTree'
import { useExpressionFolders } from './hooks/useExpressionFolders'
import { documentFolders, expressionRows } from './document/expressionFolders'
import { ZoomLevelField } from './components/ZoomLevelField'
import type { DisplaySettings } from './components/SettingsMenu'
import { resolveItemAppearance } from './components/appearancePalette'
import { OPAQUE_INTERPRETATION, type InterpretedEntity, type Point2d } from './geometry/interpretation'
import type { VisualizationPrimitive } from './visualization/primitives'
import {
  expressionDocument,
  MAX_EXPRESSION_ITEMS,
  showcaseItems,
  vga2FoundationExampleDocument,
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
  keyboardManipulationStep,
  panByScreen,
  toMathematical,
  toScreen,
  zoomAt,
  type Viewport2d,
} from './visualization/viewport'
import {
  creationSource,
  formatViewportCoordinate,
  weightedDragSupported,
  weightedViewportCoordinates,
  nextObjectName,
} from './visualization/viewportCreation'
import { describeViewport } from './visualization/viewportDescription'
import { DirectionMarkerGlyph, LineAtInfinityGlyph, OrientedAreaGlyph, OrientedSegmentGlyph, PointListConnectionGlyph, PointMarkerGlyph, UnboundedLineGlyph, type HandleController } from './visualization/glyphs'
import {
  findAnchorCandidates,
  nearbyAnchors,
  rearmAnchors,
  anchorKey,
  selectAnchor,
  type AnchorCandidate,
  type AnchorProximity,
} from './visualization/anchoring'
import { collectRenderedPrimitives, layoutIdealArrow, layoutIdealMarker, layoutLineAtInfinity, layoutLineSelection, layoutOrientedArea, layoutOrientedSegment, layoutPointListConnection, layoutUnboundedLine, lineNormalLength, lineOrientationTicks } from './visualization/layout'
import { requireAvailableAlgebra } from './application/algebraAvailability'
import {
  DocumentFormatError,
  fromCanonicalDocument,
  parseCanonicalDocument,
  resolveCanonicalImport,
  toCanonicalDocument,
  type CanonicalDocument,
  type ThemeMode,
} from './document/canonicalDocument'
import { documentFileDiagnostic, downloadDocumentFile, readDocumentFile } from './document/documentFile'
import { ACTIVE_DOCUMENT_KEY, browserDocumentStorage } from './document/documentStorage'
import {
  addCopyToLibrary,
  browserLibraryStorage,
  comparableSource,
  duplicateInLibrary,
  LIBRARY_DOCUMENT_PREFIX,
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
} from './document/documentLibrary'
import { LibraryPanel } from './components/LibraryPanel'
import type { LibraryExample } from './examples'
import { selectDroppedDocument } from './document/droppedDocument'
import { createSceneLink, decodeSceneFragment, hasSceneFragment, SHARE_URL_WARNING_LENGTH } from './document/sceneLink'
import { formatDisplayNumber } from './presentation/formatNumber'
import { evaluateScalarControl } from './application/evaluateScalarControl'
import { DEFAULT_APPEARANCE_SOURCES, evaluateAppearanceSources } from './application/evaluateAppearanceSources'
import { placeLabels, type LabelObstacle } from './visualization/labels'
import { DEFAULT_POINT_SIZE, POINT_OUTER_SCALE } from './visualization/stroke'
import { directScalarEdit } from './language/directScalarEdit'
import {
  directConstructorComponents,
  directItemLiteralEdit,
  literalComponentValue,
  rewriteConstructorLiterals,
  type ConstructorComponentEdit,
} from './language/constructorLiteralEdit'
import { primitiveBase } from './visualization/anchoring'
import { directPositionAnchorReference } from './language/directVectorEdit'
import { useScalarPlayback } from './hooks/useScalarPlayback'
import { declaredName } from './language/declaredName'
import './App.css'

// Composition root: the runtime's registered definitions. A document's
// algebra record is resolved against it whenever a document is restored,
// imported, or evaluated (ALG-004, ALG-005).
const algebraRegistry = createBuiltinAlgebraRegistry()
const restoreOptions = {
  visualizerAvailable: (visualizerId: string) => algebraRegistry.resolveVisualizer(visualizerId) !== null,
}
/** How far, in CSS pixels, a pressed handle must move before its drag starts. */
const DRAG_DEAD_ZONE = 3

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
type ManipulationKind = 'base' | 'head' | 'line' | 'normal'

/** Whether a node is a manipulation handle of the canvas. */
function isHandleElement(target: EventTarget | null): boolean {
  return target instanceof Element && target.hasAttribute('data-handle-key')
}

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

function persistReferenceHeight(height: number): void {
  try {
    window.localStorage.setItem(REFERENCE_HEIGHT_STORAGE_KEY, String(height))
  } catch {
    // The height still applies for this session when browser storage is unavailable.
  }
}

type SharedDocument = ReturnType<typeof fromCanonicalDocument>

function SharedScene({ embed }: { embed: EmbedOptions | null }) {
  const [result, setResult] = useState<{ document?: SharedDocument; diagnostic?: string; code?: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const canonical = await decodeSceneFragment(window.location.hash)
        const restored = fromCanonicalDocument(canonical, restoreOptions)
        requireAvailableAlgebra(algebraRegistry, restored.document.algebra)
        if (!cancelled) setResult({ document: restored })
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
  return <Editor sharedDocument={result.document} sceneDiagnostic={result.diagnostic} sharedSession embed={embed} />
}

function App() {
  const [embed] = useState(() => resolveEmbedMode(window.location.hash, isFramed(window)))
  // The page-level minimum width would overflow a small frame.
  useEffect(() => {
    if (!embed) return
    document.documentElement.classList.add('is-embedded')
    return () => document.documentElement.classList.remove('is-embedded')
  }, [embed])
  if (hasSceneFragment(window.location.hash)) return <SharedScene embed={embed} />
  // Without a scene, embed mode shows the default example and stores nothing.
  return embed ? <Editor embed={embed} /> : <Editor />
}

function Editor({ sharedDocument, sceneDiagnostic, sharedSession = false, embed = null }: {
  sharedDocument?: SharedDocument
  sceneDiagnostic?: string
  sharedSession?: boolean
  /** Embed mode (#215): the canvas alone, in a session that never touches storage. */
  embed?: EmbedOptions | null
}) {
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
        : vga2FoundationExampleDocument(),
      theme: 'system' as ThemeMode,
      diagnostic: (sceneDiagnostic ?? null) as string | null,
    }
    if (import.meta.env.MODE === 'test' || embed !== null) return fallback
    try {
      const stored = persistence.load()
      if (stored === null) return fallback
      const restored = fromCanonicalDocument(stored, restoreOptions)
      requireAvailableAlgebra(algebraRegistry, restored.document.algebra)
      return { ...restored, diagnostic: sceneDiagnostic ?? restored.recoveryDiagnostic, restored: true }
    } catch (error) {
      return {
        ...fallback,
        diagnostic: sceneDiagnostic ?? (error instanceof DocumentFormatError
          ? error.code + ': ' + error.message
          : 'STORE_READ_FAILED: The saved document could not be restored.'),
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
  const labelPlacementCache = useRef<{ key: string; placed: ReturnType<typeof placeLabels> } | null>(null)
  const inputRefs = useRef(new Map<string, HTMLInputElement>())
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
  const viewportWheelHandler = useRef<((event: WheelEvent) => void) | null>(null)
  const canvasFrameRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const viewportPan = useRef<Readonly<{
    pointerId: number
    lastX: number
    lastY: number
    start: Viewport2d
  }> | null>(null)
  const manipulationDrag = useRef<Readonly<{
    itemId: string
    kind: ManipulationKind
    pointerId: number
    /** Where the press was, in client pixels, until the pointer has moved past the dead zone. */
    press: Readonly<{ x: number; y: number }> | null
    /** Anchors a base drag started on, not taken until the pointer leaves them (#100). */
    disarmedAnchors: ReadonlySet<string>
  }> | null>(null)
  /** Where a line translation started, so each move is measured from the press. */
  const lineDragOrigin = useRef<Readonly<{
    point: Point2d
    anchor: Point2d
    coefficients: readonly [number, number, number]
  }> | null>(null)
  /** The selected line and the anchor its normal handle is drawn from. */
  const [selectedLine, setSelectedLine] = useState<Readonly<{ itemId: string; anchor: Point2d }> | null>(null)
  const anchorValidityCache = useRef(new Map<string, boolean>())
  const [hoveredManipulation, setHoveredManipulation] = useState<string | null>(null)
  // Where handles coincide, those of the selected object are drawn on top and
  // take the press (#100): the object whose expression row has focus or the
  // pointer, otherwise the last object a pointer manipulated in the viewport.
  // The drawing order is kept for the length of a drag and while a handle has
  // keyboard focus, so that a handle is never moved in the document while it
  // holds pointer capture or focus, which moving it would release.
  const [rowFocusId, setRowFocusId] = useState<string | null>(null)
  const [rowHoverId, setRowHoverId] = useState<string | null>(null)
  const [lastManipulatedId, setLastManipulatedId] = useState<string | null>(null)
  const [dragSelection, setDragSelection] = useState<Readonly<{ itemId: string | null }> | null>(null)
  const [handleFocusSelection, setHandleFocusSelection] =
    useState<Readonly<{ itemId: string | null }> | null>(null)
  const frozenSelection = dragSelection ?? handleFocusSelection
  // A deleted object's row fires neither blur nor pointer leave, so its id is
  // ignored here and cleared once the document has changed.
  const isPresentItem = (itemId: string | null): itemId is string =>
    itemId !== null && expressionDoc.items.some((item) => item.id === itemId)
  const selectedObjectId = frozenSelection
    ? frozenSelection.itemId
    : [rowFocusId, rowHoverId, lastManipulatedId].find(isPresentItem) ?? null
  useEffect(() => {
    const present = new Set(expressionDoc.items.map((item) => item.id))
    const clearDeleted = (itemId: string | null) =>
      itemId !== null && !present.has(itemId) ? null : itemId
    setRowFocusId(clearDeleted)
    setRowHoverId(clearDeleted)
    setLastManipulatedId(clearDeleted)
    // A focused handle removed with its object fires no blur either.
    if (!isHandleElement(document.activeElement)) setHandleFocusSelection(null)
  }, [expressionDoc.items])
  // Keyboard focus on a handle is drawn as an SVG ring rather than a CSS
  // outline, which WebKit fails to repaint when focus moves between SVG
  // elements. The ring follows the input modality at the moment of focus,
  // so a later key press does not turn pointer focus into a ring either.
  const [focusRingKey, setFocusRingKey] = useState<string | null>(null)
  const inputModality = useRef<'pointer' | 'keyboard'>('pointer')
  useEffect(() => {
    const pointer = () => { inputModality.current = 'pointer' }
    const keyboard = () => { inputModality.current = 'keyboard' }
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', keyboard, true)
    return () => {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', keyboard, true)
    }
  }, [])
  const focusHandle = (key: string) => {
    setHoveredManipulation(key)
    setFocusRingKey(inputModality.current === 'keyboard' ? key : null)
  }
  const blurHandle = (key: string) => {
    setHoveredManipulation((current) => current === key ? null : current)
    setFocusRingKey((current) => current === key ? null : current)
  }
  const handleController: HandleController = {
    hoveredKey: hoveredManipulation,
    focusRingKey,
    hover: (key) => setHoveredManipulation(key),
    unhover: (key) => setHoveredManipulation((current) => current === key ? null : current),
    focus: focusHandle,
    blur: blurHandle,
    pointerDown: (event, itemId, kind) => beginManipulation(event, itemId, kind),
    keyDown: (event, itemId, kind, current) => manipulateWithKeyboard(event, itemId, kind, current),
  }
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
  const [anchorPreview, setAnchorPreview] = useState<AnchorCandidate | null>(null)
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
  const [copyNotice, setCopyNotice] = useState<Readonly<{ message: string; durationMs: number }> | null>(null)
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
  const closeInfoDialog = useCallback(() => setInfoDialog(null), [])
  const closeAppearance = useCallback(() => {
    setAppearanceItemId(null)
    dispatchHistory({ type: 'boundary' })
  }, [dispatchHistory])
  const rememberEditorFocus = (element: HTMLInputElement) => {
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
  const screenPoint = (clientX: number, clientY: number) => {
    const rectangle = viewportSvgRef.current?.getBoundingClientRect()
    if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0)
      return { x: viewport.width / 2, y: viewport.height / 2 }
    return {
      x: (clientX - rectangle.left) * viewport.width / rectangle.width,
      y: (clientY - rectangle.top) * viewport.height / rectangle.height,
    }
  }
  const zoomViewport = (factor: number, anchor = { x: viewport.width / 2, y: viewport.height / 2 }) =>
    updateViewport(zoomAt(viewport, anchor, viewport.pixelsPerUnit * factor))
  // Recentering keeps the scale; Home, or recentering then typing 100 %,
  // restores the documented view (VIEW2D-003).
  const recenterViewport = () => {
    updateViewport({ ...viewport, centerX: 0, centerY: 0 })
    setViewportAnnouncement('View recentered on the origin.')
  }
  const resetViewport = () => {
    updateViewport({
      ...viewport, centerX: 0, centerY: 0, pixelsPerUnit: DEFAULT_PIXELS_PER_UNIT,
    })
    setViewportAnnouncement('View reset to the origin at 100%.')
  }
  const handleViewportWheel = (event: WheelEvent) => {
    event.preventDefault()
    if (viewportLocked) return
    zoomViewport(Math.exp(-event.deltaY * 0.0015), screenPoint(event.clientX, event.clientY))
  }
  viewportWheelHandler.current = handleViewportWheel
  // React registers wheel listeners as passive, which silently discards
  // preventDefault and lets the browser page-zoom on Ctrl+wheel or pinch; the
  // listener is attached natively so it can be non-passive.
  const attachViewportSvg = useCallback((svg: SVGSVGElement | null) => {
    viewportSvgRef.current = svg
    if (!svg) return
    const onWheel = (event: WheelEvent) =>
      viewportWheelHandler.current?.(event)
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])
  // Safari extends a selection started on the canvas into any selectable
  // text the pointer crosses, and form controls ignore an inherited
  // user-select, so while a button is held the class also removes the
  // panels from hit-testing and any selection start is cancelled. Released
  // on pointerup or pointercancel anywhere.
  // The gesture kind also fixes the cursor: browsers that hit-test under the
  // pointer during capture would otherwise show the arrow over the panels.
  const guardGestureSelection = (kind: 'manipulate' | 'pan') =>
    document.body.classList.add('canvas-gesture', `canvas-gesture-${kind}`)
  useEffect(() => {
    const release = () => document.body.classList.remove(
      'canvas-gesture', 'canvas-gesture-manipulate', 'canvas-gesture-pan',
    )
    const cancelSelection = (event: Event) => {
      if (document.body.classList.contains('canvas-gesture')) event.preventDefault()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    document.addEventListener('selectstart', cancelSelection, true)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      document.removeEventListener('selectstart', cancelSelection, true)
      release()
    }
  }, [])
  const beginViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    setAppearanceItemId(null)
    setSelectedLine(null)
    if (viewportLocked || event.button !== 0 || event.target !== event.currentTarget) return
    event.currentTarget.focus({ preventScroll: true })
    guardGestureSelection('pan')
    viewportPan.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      start: viewport,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const updateManipulatedItem = (
    itemId: string,
    kind: ManipulationKind,
    point: Readonly<{ x: number; y: number }>,
  ): Point2d | undefined => {
    const item = expressionDoc.items.find((candidate) => candidate.id === itemId)
    const rendered = renderedPrimitives.find((candidate) => candidate.id === itemId)
    if (!item || !rendered) return
    // Every coordinate written here follows the creation rule (about one
    // screen pixel); line coefficients use a ten times finer scale so that
    // rotating a line about an anchor stays smooth.
    const pixelsPerUnit = viewport.pixelsPerUnit
    const coordinate = (value: number) => formatViewportCoordinate(value, pixelsPerUnit)
    const target = {
      x: Number(coordinate(point.x)),
      y: Number(coordinate(point.y)),
    }
    if (kind === 'line' || kind === 'normal') {
      if (rendered.primitive.kind !== 'unbounded-line') return
      const components = literalEditComponents(item, rendered.entity)
      if (!components) return
      const [a0, b0] = lineCoefficients(rendered.primitive)
      // Far from the origin, a coarse (a, b) would move the line by the
      // anchor's distance times its rounding error: (a, b) are rounded with a
      // step refined by that distance and c is derived from them, so the
      // anchor stays on the line.
      const coefficientScale = (anchor: Point2d) => pixelsPerUnit * 10 * Math.max(1, Math.hypot(anchor.x, anchor.y))
      const offsetScale = pixelsPerUnit * 10
      let rounded: readonly [number, number, number]
      if (kind === 'line') {
        // Translating changes only c; motion along the line has no effect.
        // The selection anchor travels with the line so that a later rotation
        // pivots about the translated line, not the pressed one.
        const origin = lineDragOrigin.current
        if (!origin) return
        const scale = coefficientScale(origin.anchor)
        const a = Number(formatViewportCoordinate(origin.coefficients[0], scale))
        const b = Number(formatViewportCoordinate(origin.coefficients[1], scale))
        const shift = { x: target.x - origin.point.x, y: target.y - origin.point.y }
        const c = origin.coefficients[2] - a * shift.x - b * shift.y
        rounded = [a, b, Number(formatViewportCoordinate(c, offsetScale))]
        if (selectedLine?.itemId === itemId) {
          setSelectedLine({ itemId, anchor: { x: origin.anchor.x + shift.x, y: origin.anchor.y + shift.y } })
        }
      } else {
        // Rotating keeps the norm of (a, b) and the anchor on the line; the
        // anchor is projected in case the line moved since it was selected.
        const { point: on, direction } = rendered.primitive
        const selected = selectedLine?.itemId === itemId ? selectedLine.anchor : on
        const along = (selected.x - on.x) * direction.x + (selected.y - on.y) * direction.y
        const anchor = { x: on.x + direction.x * along, y: on.y + direction.y * along }
        const dx = point.x - anchor.x
        const dy = point.y - anchor.y
        const length = Math.hypot(dx, dy)
        if (length === 0) return
        const scale = Math.hypot(a0, b0)
        const coefficients = coefficientScale(anchor)
        const a = Number(formatViewportCoordinate(dx / length * scale, coefficients))
        const b = Number(formatViewportCoordinate(dy / length * scale, coefficients))
        rounded = [a, b, Number(formatViewportCoordinate(-(a * anchor.x + b * anchor.y), offsetScale))]
      }
      const rewritten = rewriteConstructorLiterals(item.source, components, rounded)
      if (rewritten !== item.source) executeCommand({ kind: 'update-source', itemId, source: rewritten })
      components.forEach((component, index) => {
        if (component.kind !== 'reference') return
        const scalarItem = expressionDoc.items.find((candidate) =>
          candidate.kind !== 'annotation' &&
          declaredName(candidate.source) === component.name &&
          directScalarEdit(candidate.source) !== null)
        if (scalarItem) executeCommand({
          kind: 'set-scalar-value', itemId: scalarItem.id, value: rounded[index] * component.sign,
        })
      })
      return
    }
    if (kind === 'head' && interpretation.supportsHead(rendered.entity)) {
      const components = literalEditComponents(item, rendered.entity)
      const base = primitiveBase(rendered.primitive)
      if (!components || !base) return
      const values = [
        Number(coordinate(target.x - base.x)),
        Number(coordinate(target.y - base.y)),
      ] as const
      const rewritten = rewriteConstructorLiterals(item.source, components, values)
      if (rewritten !== item.source) executeCommand({
        kind: 'update-source', itemId, source: rewritten,
      })
      components.forEach((component, index) => {
        if (component.kind !== 'reference') return
        const target = expressionDoc.items.find((candidate) =>
          candidate.kind !== 'annotation' &&
          declaredName(candidate.source) === component.name &&
          directScalarEdit(candidate.source) !== null)
        if (target) executeCommand({
          kind: 'set-scalar-value', itemId: target.id,
          value: values[index] * component.sign,
        })
      })
      return
    }
    if (!interpretation.supportsPosition(rendered.entity)) {
      // The entity carries its own location: rewrite its constructor literal
      // (PGA-VIZ-003) with the pointer's grid-rounded coordinates, scaled by
      // the kept weight of a weighted point (#181).
      const edit = literalEditTarget(item, rendered.entity)
      if (!edit) return
      const { components } = edit
      const weight = edit.weight ? weightValue(item.source, edit.weight) : 1
      const values = weight === null ? null : weightedViewportCoordinates(point, weight, pixelsPerUnit)
      if (weight === null || !values) return
      const rewritten = rewriteConstructorLiterals(item.source, components, values)
      if (rewritten !== item.source) executeCommand({
        kind: 'update-source', itemId, source: rewritten,
      })
      components.forEach((component, index) => {
        if (component.kind !== 'reference') return
        const scalarItem = expressionDoc.items.find((candidate) =>
          candidate.kind !== 'annotation' &&
          declaredName(candidate.source) === component.name &&
          directScalarEdit(candidate.source) !== null)
        if (scalarItem) executeCommand({
          kind: 'set-scalar-value', itemId: scalarItem.id,
          value: values[index] * component.sign,
        })
      })
      // Where the point is now drawn, for the keyboard announcement.
      return { x: values[0] / weight, y: values[1] / weight }
    }
    const literalPosition = interpretation.formatPosition(
      coordinate(target.x), coordinate(target.y),
    )
    if (!item.positionSource) {
      executeCommand({ kind: 'update-position', itemId, positionSource: literalPosition })
      return
    }
    const components = positionComponents(item.positionSource)
    if (!components) {
      executeCommand({ kind: 'update-position', itemId, positionSource: literalPosition })
      return
    }
    const rewritten = rewriteConstructorLiterals(item.positionSource, components, [target.x, target.y])
    if (rewritten !== item.positionSource) executeCommand({
      kind: 'update-position', itemId, positionSource: rewritten,
    })
    components.forEach((component, index) => {
      if (component.kind !== 'reference') return
      const targetItem = expressionDoc.items.find((candidate) =>
        candidate.kind !== 'annotation' &&
        declaredName(candidate.source) === component.name &&
        directScalarEdit(candidate.source) !== null)
      if (targetItem) executeCommand({
        kind: 'set-scalar-value', itemId: targetItem.id,
        value: (index === 0 ? target.x : target.y) * component.sign,
      })
    })
  }
  const gestureLabel = (kind: ManipulationKind) =>
    kind === 'head' ? 'Vector head' : kind === 'base' ? 'Object base' : kind === 'line' ? 'Line' : 'Line normal'
  const lineCoefficients = (primitive: Extract<VisualizationPrimitive, { kind: 'unbounded-line' }>): readonly [number, number, number] => {
    const a = primitive.normal.x * primitive.scale
    const b = primitive.normal.y * primitive.scale
    return [a, b, -(a * primitive.point.x + b * primitive.point.y)]
  }
  /** Where the anchors of a base drag are measured from, in CSS pixels. */
  const anchorProximity = (draggedId: string, pointer: Point2d): AnchorProximity => {
    const rectangle = viewportSvgRef.current?.getBoundingClientRect()
    const cssScaleX = rectangle && rectangle.width > 0 ? rectangle.width / viewport.width : 1
    const cssScaleY = rectangle && rectangle.height > 0 ? rectangle.height / viewport.height : 1
    return {
      draggedId,
      rendered: renderedPrimitives,
      viewport,
      pointer,
      cssScale: { x: cssScaleX, y: cssScaleY },
      nameOf: (itemId) => {
        const targetItem = expressionDoc.items.find((item) => item.id === itemId)
        return targetItem ? declaredName(targetItem.source) : null
      },
    }
  }
  const beginManipulation = (
    event: ReactPointerEvent<SVGElement>,
    itemId: string,
    kind: ManipulationKind,
  ) => {
    if (event.button !== 0) return
    event.stopPropagation()
    // The default pointerdown action is kept: it is what lets the browser
    // treat the resulting focus as pointer-driven and withhold the focus
    // ring. Selection is prevented by user-select on the canvas instead.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    guardGestureSelection('manipulate')
    const disarmedAnchors = kind === 'base'
      ? new Set(nearbyAnchors(anchorProximity(itemId, screenPoint(event.clientX, event.clientY)))
          .map(anchorKey))
      : new Set<string>()
    manipulationDrag.current = {
      itemId, kind, pointerId: event.pointerId,
      press: { x: event.clientX, y: event.clientY },
      disarmedAnchors,
    }
    setDragSelection({ itemId: selectedObjectId })
    setLastManipulatedId(itemId)
    anchorValidityCache.current.clear()
    if (kind === 'line') {
      const rendered = renderedPrimitives.find((candidate) => candidate.id === itemId)
      const point = toMathematical(viewport, screenPoint(event.clientX, event.clientY))
      if (rendered?.primitive.kind === 'unbounded-line') {
        const { point: on, direction } = rendered.primitive
        // A press selects the line and anchors its normal at the pressed
        // point projected onto the line.
        const along = (point.x - on.x) * direction.x + (point.y - on.y) * direction.y
        const anchor = { x: on.x + direction.x * along, y: on.y + direction.y * along }
        lineDragOrigin.current = { point, anchor, coefficients: lineCoefficients(rendered.primitive) }
        setSelectedLine({ itemId, anchor })
      }
    }
    dispatchHistory({ type: 'boundary' })
    dispatchHistory({ type: 'begin-transaction' })
    setViewportAnnouncement(`${gestureLabel(kind)} drag started.`)
  }
  const lineMovable = (item: ExpressionItem, entity: InterpretedEntity): boolean =>
    interpretation.literalEdit(entity)?.constructor === 'line' &&
    componentsMovable(literalEditComponents(item, entity))
  const componentsMovable = (
    components: readonly ConstructorComponentEdit[] | null,
  ): boolean => {
    if (!components) return false
    const references = components.filter((component) => component.kind === 'reference')
    if (new Set(references.map((component) => component.name)).size !== references.length)
      return false
    return references.every((component) => expressionDoc.items.filter((candidate) =>
      candidate.kind !== 'annotation' &&
      declaredName(candidate.source) === component.name &&
      directScalarEdit(candidate.source) !== null).length === 1)
  }
  const literalEditTarget = (item: ExpressionItem, entity: InterpretedEntity) => {
    const edit = interpretation.literalEdit(entity)
    const target = edit ? directItemLiteralEdit(item.source, edit, engine.tuple ?? null) : null
    // A weight that depends on a rewritten coordinate would change with it.
    const rewritten = new Set(target?.components.flatMap((component) =>
      component.kind === 'reference' ? [component.name] : []))
    return target?.weight?.kind === 'reference' &&
      declarationDependsOn(expressionDoc.items, target.weight.name, rewritten)
      ? null
      : target
  }
  const literalEditComponents = (item: ExpressionItem, entity: InterpretedEntity) =>
    literalEditTarget(item, entity)?.components ?? null
  /** The current value of a kept weight: its literal, or the scalar its name declares. */
  const weightValue = (source: string, weight: ConstructorComponentEdit): number | null => {
    if (weight.kind === 'literal') return literalComponentValue(source, weight)
    const evaluation = evaluatedItems.find(({ item }) => declaredName(item.source) === weight.name)?.evaluation
    if (evaluation?.status !== 'valid' || evaluation.valueType !== 'single' ||
        evaluation.value.coefficients.some((coefficient, index) => index > 0 && coefficient !== 0)) return null
    return evaluation.value.coefficients[0] * weight.sign
  }
  /**
   * A position source is a two-argument literal of the interpretation's
   * creation constructor, or a tuple the active algebra reads as one.
   */
  const positionComponents = (positionSource: string) =>
    directConstructorComponents(positionSource, interpretation.creation.constructor, 2, engine.tuple ?? null)
  const headMovable = (item: ExpressionItem, entity: InterpretedEntity): boolean =>
    interpretation.supportsHead(entity) && componentsMovable(literalEditComponents(item, entity))
  const objectBaseMovable = (item: ExpressionItem, entity: InterpretedEntity): boolean =>
    interpretation.supportsPosition(entity)
      ? !item.positionSource ||
        directPositionAnchorReference(item.positionSource) !== null ||
        componentsMovable(positionComponents(item.positionSource))
      : locatedMovable(item, entity)
  /** A located entity's literal, with a weight this zoom can keep (#181). */
  const locatedMovable = (item: ExpressionItem, entity: InterpretedEntity): boolean => {
    const target = literalEditTarget(item, entity)
    if (!target || !componentsMovable(target.components)) return false
    const weight = target.weight ? weightValue(item.source, target.weight) : 1
    return weight !== null && weightedDragSupported(weight, viewport.pixelsPerUnit)
  }
  const manipulateWithKeyboard = (
    event: KeyboardEvent<SVGElement>,
    itemId: string,
    kind: ManipulationKind,
    current: Readonly<{ x: number; y: number }>,
  ) => {
    const keyboardOrigin = { kind: 'viewport', handleKey: `${itemId}:${kind}` } as const
    if (kind === 'line' && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      setSelectedLine((selected) => (selected?.itemId === itemId ? null : { itemId, anchor: current }))
      setViewportAnnouncement(selectedLine?.itemId === itemId ? 'Line normal hidden.' : 'Line normal shown; move its head to rotate the line.')
      return
    }
    if (kind === 'base' && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const item = expressionDoc.items.find((candidate) => candidate.id === itemId)
      if (!item) return
      const currentReference = item.positionSource
        ? directPositionAnchorReference(item.positionSource)
        : null
      const candidates = renderedPrimitives.flatMap((rendered) => {
        if (rendered.id.includes(':') || rendered.id === itemId) return []
        const target = expressionDoc.items.find((candidate) => candidate.id === rendered.id)
        const name = target ? declaredName(target.source) : null
        if (!name) return []
        const properties = rendered.primitive.kind === 'oriented-segment'
          ? ['position', 'head'] as const
          : ['position'] as const
        return properties.map((property) => ({ name, property }))
      })
      const currentIndex = candidates.findIndex((candidate) =>
        candidate.name === currentReference?.name &&
        candidate.property === currentReference.property)
      const ordered = candidates.length === 0 ? [] : candidates.map((_, offset) =>
        candidates[(currentIndex + 1 + offset) % candidates.length])
      const next = ordered.find((candidate) => {
        const positionSource = `${candidate.name}.${candidate.property}`
        const proposed = {
          ...expressionDoc,
          items: expressionDoc.items.map((entry) => entry.id === itemId
            ? { ...entry, positionSource }
            : entry),
        }
        return evaluateDocument(proposed, evaluationContext).find(
          (result) => result.item.id === itemId,
        )?.positionEvaluation?.status === 'valid'
      })
      if (!next) {
        setViewportAnnouncement('No valid anchor target is available.')
        return
      }
      dispatchHistory({ type: 'boundary' })
      dispatchHistory({ type: 'begin-transaction' })
      executeCommand({
        kind: 'update-position', itemId,
        positionSource: `${next.name}.${next.property}`,
      })
      dispatchHistory({ type: 'commit-transaction', origin: keyboardOrigin })
      setViewportAnnouncement(`Object base linked to ${next.name} ${next.property}.`)
      return
    }
    if (kind === 'base' && (event.key === 'Delete' || event.key === 'Backspace')) {
      const item = expressionDoc.items.find((candidate) => candidate.id === itemId)
      if (!item?.positionSource || !directPositionAnchorReference(item.positionSource)) return
      event.preventDefault()
      event.stopPropagation()
      dispatchHistory({ type: 'boundary' })
      dispatchHistory({ type: 'begin-transaction' })
      updateManipulatedItem(itemId, kind, current)
      dispatchHistory({ type: 'commit-transaction', origin: keyboardOrigin })
      setViewportAnnouncement('Object base unlinked and kept at its resolved position.')
      return
    }
    const step = keyboardManipulationStep(viewport.pixelsPerUnit, event.shiftKey)
    const delta = event.key === 'ArrowLeft' ? { x: -step, y: 0 }
      : event.key === 'ArrowRight' ? { x: step, y: 0 }
        : event.key === 'ArrowUp' ? { x: 0, y: step }
          : event.key === 'ArrowDown' ? { x: 0, y: -step }
            : null
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    dispatchHistory({ type: 'boundary' })
    dispatchHistory({ type: 'begin-transaction' })
    if (kind === 'line') {
      const rendered = renderedPrimitives.find((candidate) => candidate.id === itemId)
      if (rendered?.primitive.kind === 'unbounded-line') {
        lineDragOrigin.current = { point: current, anchor: current, coefficients: lineCoefficients(rendered.primitive) }
      }
    }
    const target = kind === 'normal'
      // Nudge the normal handle's head, then the update renormalizes it.
      ? (() => {
          const rendered = renderedPrimitives.find((candidate) => candidate.id === itemId)
          const normal = rendered?.primitive.kind === 'unbounded-line' ? rendered.primitive.normal : { x: 1, y: 0 }
          const length = lineNormalLength(viewport, objectRenderScale)
          return { x: current.x + normal.x * length + delta.x, y: current.y + normal.y * length + delta.y }
        })()
      : { x: current.x + delta.x, y: current.y + delta.y }
    // A weighted point is drawn where its rounded coordinates put it.
    const moved = updateManipulatedItem(itemId, kind, target) ?? target
    dispatchHistory({ type: 'commit-transaction', origin: keyboardOrigin })
    setViewportAnnouncement(kind === 'normal'
      ? `${gestureLabel(kind)} rotated.`
      : `${gestureLabel(kind)} moved to ${
          formatViewportCoordinate(moved.x, viewport.pixelsPerUnit)}, ${
          formatViewportCoordinate(moved.y, viewport.pixelsPerUnit)}.`)
  }
  const moveViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const pressed = manipulationDrag.current
    if (pressed?.pointerId === event.pointerId) {
      // A press that has not yet moved past the dead zone is a click: it
      // writes nothing, so it cannot unlink a base or nudge an object.
      if (pressed.press && Math.hypot(
        event.clientX - pressed.press.x,
        event.clientY - pressed.press.y,
      ) < DRAG_DEAD_ZONE) return
      const manipulation = pressed.press ? { ...pressed, press: null } : pressed
      manipulationDrag.current = manipulation
      const pointer = screenPoint(event.clientX, event.clientY)
      if (manipulation.kind === 'base') {
        const proximity = anchorProximity(manipulation.itemId, pointer)
        const disarmedAnchors = rearmAnchors(manipulation.disarmedAnchors, nearbyAnchors(proximity))
        if (disarmedAnchors !== manipulation.disarmedAnchors)
          manipulationDrag.current = { ...manipulation, disarmedAnchors }
        const candidates = findAnchorCandidates({
          ...proximity,
          disarmed: disarmedAnchors,
          isValid: (candidate) => {
            const key = `${manipulation.itemId}:${candidate.targetId}:${candidate.property}`
            const cached = anchorValidityCache.current.get(key)
            if (cached !== undefined) return cached
            const positionSource = `${candidate.targetName}.${candidate.property}`
            const proposed = {
              ...expressionDoc,
              items: expressionDoc.items.map((item) => item.id === manipulation.itemId
                ? { ...item, positionSource }
                : item),
            }
            const valid = evaluateDocument(proposed, evaluationContext).find(
              (result) => result.item.id === manipulation.itemId,
            )?.positionEvaluation?.status === 'valid'
            anchorValidityCache.current.set(key, valid)
            return valid
          },
        })
        const candidate = selectAnchor(
          candidates,
          anchorPreview?.draggedId === manipulation.itemId ? anchorPreview : null,
        )
        setAnchorPreview(candidate)
        updateManipulatedItem(
          manipulation.itemId,
          manipulation.kind,
          candidate?.mathematical ?? toMathematical(viewport, pointer),
        )
        return
      }
      setAnchorPreview(null)
      updateManipulatedItem(
        manipulation.itemId,
        manipulation.kind,
        toMathematical(viewport, pointer),
      )
      return
    }
    const pan = viewportPan.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const rectangle = event.currentTarget.getBoundingClientRect()
    const scaleX = rectangle.width > 0 ? viewport.width / rectangle.width : 1
    const scaleY = rectangle.height > 0 ? viewport.height / rectangle.height : 1
    updateViewport(panByScreen(viewport, {
      x: (event.clientX - pan.lastX) * scaleX,
      y: (event.clientY - pan.lastY) * scaleY,
    }))
    viewportPan.current = { ...pan, lastX: event.clientX, lastY: event.clientY }
  }
  // A pointer gesture leaves nothing selected: the handle gives focus back
  // to the canvas so arrow keys pan and hover indicators stay pointer-only.
  // Keyboard users reach handles with Tab as before.
  const finishManipulation = (outcome: 'commit' | 'cancel') => {
    manipulationDrag.current = null
    setDragSelection(null)
    anchorValidityCache.current.clear()
    setAnchorPreview(null)
    dispatchHistory(outcome === 'commit'
      ? { type: 'commit-transaction', origin: { kind: 'viewport', handleKey: null } }
      : { type: 'cancel-transaction' })
    viewportSvgRef.current?.focus({ preventScroll: true })
  }
  const endViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const manipulation = manipulationDrag.current
    if (manipulation?.pointerId === event.pointerId) {
      const preview = anchorPreview?.draggedId === manipulation.itemId
        ? anchorPreview
        : null
      if (preview) {
        const positionSource = `${preview.targetName}.${preview.property}`
        const candidateDocument = {
          ...expressionDoc,
          items: expressionDoc.items.map((item) => item.id === manipulation.itemId
            ? { ...item, positionSource }
            : item),
        }
        const candidate = evaluateDocument(candidateDocument, evaluationContext).find(
          (result) => result.item.id === manipulation.itemId,
        )
        if (candidate?.positionEvaluation?.status === 'valid') {
          executeCommand({
            kind: 'update-position', itemId: manipulation.itemId, positionSource,
          })
          setViewportAnnouncement(
            `Object base linked to ${preview.targetName} ${preview.property}.`,
          )
        } else {
          setViewportAnnouncement('Anchor link refused because it would be invalid.')
          finishManipulation('cancel')
          return
        }
      } else {
        setViewportAnnouncement('Object manipulation committed.')
      }
      finishManipulation('commit')
      return
    }
    if (viewportPan.current?.pointerId === event.pointerId) viewportPan.current = null
  }
  const cancelViewportPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (manipulationDrag.current?.pointerId === event.pointerId) {
      finishManipulation('cancel')
      setViewportAnnouncement('Object manipulation cancelled.')
      return
    }
    const pan = viewportPan.current
    if (!pan || pan.pointerId !== event.pointerId) return
    viewportPan.current = null
    updateViewport(pan.start)
  }
  const loseViewportCapture = () => {
    if (manipulationDrag.current) {
      finishManipulation('cancel')
      setViewportAnnouncement('Object manipulation cancelled.')
      return
    }
    const pan = viewportPan.current
    if (!pan) return
    viewportPan.current = null
    updateViewport(pan.start)
  }
  const navigateViewportWithKeyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    const amount = event.shiftKey ? 120 : 40
    let next: Viewport2d | null = null
    const navigationKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0', 'Home']
      .includes(event.key)
    if (viewportLocked && navigationKey) {
      event.preventDefault()
      return
    }
    if (event.key === 'ArrowLeft') next = panByScreen(viewport, { x: amount, y: 0 })
    else if (event.key === 'ArrowRight') next = panByScreen(viewport, { x: -amount, y: 0 })
    else if (event.key === 'ArrowUp') next = panByScreen(viewport, { x: 0, y: amount })
    else if (event.key === 'ArrowDown') next = panByScreen(viewport, { x: 0, y: -amount })
    else if (event.key === '+' || event.key === '=') next = zoomAt(viewport, { x: viewport.width / 2, y: viewport.height / 2 }, viewport.pixelsPerUnit * 1.25)
    else if (event.key === '-') next = zoomAt(viewport, { x: viewport.width / 2, y: viewport.height / 2 }, viewport.pixelsPerUnit / 1.25)
    else if (event.key === '0' || event.key === 'Home') {
      event.preventDefault()
      if (event.key === '0') recenterViewport()
      else resetViewport()
      return
    } else return
    event.preventDefault()
    updateViewport(next)
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
    viewportPan.current = null
    setSelectedLine(null)
    setAnchorPreview(null)
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
    viewportPan.current = null
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

  const evaluatedItems = useMemo(
    () => evaluateDocument(expressionDoc, evaluationContext),
    [expressionDoc],
  )
  const scalarControlEvaluations = useMemo(
    () => new Map(evaluatedItems.flatMap((evaluated) => evaluated.item.control
      ? [[evaluated.item.id, evaluateScalarControl(
          evaluated.item.control,
          evaluatedItems,
          engine,
        )] as const]
      : [])),
    [evaluatedItems],
  )
  const appearanceSources = useMemo(
    () => evaluateAppearanceSources(expressionDoc, evaluatedItems, engine),
    [evaluatedItems, expressionDoc, engine],
  )

  const playback = useScalarPlayback({
    items: expressionDoc.items,
    scalarControlEvaluations,
    executeCommand,
    dispatchHistory,
    reducedMotion,
  })

  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!manipulationDrag.current) {
        // Outside a gesture, Escape drops the line selection and its normal.
        setSelectedLine((selected) => (selected ? null : selected))
        return
      }
      event.preventDefault()
      manipulationDrag.current = null
      anchorValidityCache.current.clear()
      setAnchorPreview(null)
      dispatchHistory({ type: 'cancel-transaction' })
      viewportSvgRef.current?.focus({ preventScroll: true })
      setViewportAnnouncement('Object manipulation cancelled.')
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [dispatchHistory])
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

  useEffect(() => {
    if (ephemeral || import.meta.env.MODE === 'test') return
    try {
      persistence.save(toCanonicalDocument(expressionDoc, theme, resolvedStyles, resolvedOrientation))
      setDocumentDiagnostic((current) => current?.startsWith('DOCUMENT_VIEW_UNSUPPORTED') ? current : null)
    } catch {
      setDocumentDiagnostic('STORE_WRITE_FAILED: Changes remain open, but the last saved revision was retained.')
    }
  }, [expressionDoc, persistence, resolvedStyles, resolvedOrientation, theme, ephemeral])

  const origin = toScreen(viewport, { x: 0, y: 0 })
  // The Studio-sized glyphs are the 1× baseline exposed to users. The
  // historical renderer used 1.5 as that baseline, so keep the visual size
  // while restoring a meaningful multiplicative setting.
  const objectRenderScale = expressionDoc.view.display.objectScale * 1.5
  // NoViz builds no render primitives (#55).
  const { rendered: renderedPrimitives, connections: renderedConnections, omitted: omittedRenderElements } = noViz
    ? { rendered: [], connections: [], omitted: 0 }
    : collectRenderedPrimitives(
        evaluatedItems, expressionDoc.appearance, interpretation, declaredName, appearanceSources,
      )
  const renderedVectors = renderedPrimitives.flatMap((entry) =>
    entry.primitive.kind === 'oriented-segment'
      ? [{ ...entry, primitive: entry.primitive, layout: layoutOrientedSegment(entry.primitive, viewport, objectRenderScale) }]
      : [])
  const renderedAreas = renderedPrimitives.flatMap((entry) =>
    entry.primitive.kind === 'oriented-area'
      ? [{ ...entry, primitive: entry.primitive, layout: layoutOrientedArea(entry.primitive, viewport, entry.bivectorShape) }]
      : [])
  const renderedPoints = renderedPrimitives.flatMap((entry) =>
    entry.primitive.kind === 'point-marker'
      ? [{ ...entry, primitive: entry.primitive, point: toScreen(viewport, entry.primitive.point) }]
      : [])
  const renderedLines = renderedPrimitives.flatMap((entry) => {
    if (entry.primitive.kind !== 'unbounded-line') return []
    const layout = layoutUnboundedLine(entry.primitive, viewport)
    return layout ? [{ ...entry, primitive: entry.primitive, layout }] : []
  })
  // A connected list showing its links alone hides its ideal points as well.
  const renderedIdealPoints = renderedPrimitives.flatMap((entry) =>
    entry.primitive.kind === 'ideal-point' && entry.markerVisible
      ? [{
          ...entry,
          primitive: entry.primitive,
          arrow: entry.idealPointDisplay === 'ideal' ? null : layoutIdealArrow(entry.primitive, viewport, objectRenderScale),
          marker: entry.idealPointDisplay === 'vector' ? null : layoutIdealMarker(entry.primitive.direction, viewport, objectRenderScale),
        }]
      : [])
  const renderedInfinity = renderedPrimitives.flatMap((entry) =>
    entry.primitive.kind === 'line-at-infinity'
      ? [{ ...entry, primitive: entry.primitive, layout: layoutLineAtInfinity(viewport, objectRenderScale) }]
      : [])

  // Labels are placed together, so that an automatic label can avoid the
  // other labels and the points and handles of other objects (#226).
  const labelAnchors = new Map<string, Point2d>()
  const labelObstacles: LabelObstacle[] = []
  const ownerOf = (id: string) => id.split(':')[0]
  const handleRadius = 10 * objectRenderScale
  const addSegmentObstacles = (id: string, layout: Readonly<{ start: Point2d; end: Point2d }>) => {
    if (ownerOf(id) !== id) return
    labelObstacles.push({ ownerId: id, center: layout.start, radius: handleRadius })
    labelObstacles.push({ ownerId: id, center: layout.end, radius: 12 })
  }
  renderedVectors.forEach(({ id, layout }) => {
    labelAnchors.set(id, layout.end)
    addSegmentObstacles(id, layout)
  })
  renderedAreas.forEach(({ id, layout }) => {
    labelAnchors.set(id, layout.labelPoint)
    if (ownerOf(id) === id) labelObstacles.push({ ownerId: id, center: layout.base, radius: handleRadius })
  })
  renderedPoints.forEach(({ id, point, pointSize, markerVisible }) => {
    labelAnchors.set(id, point)
    // A hidden marker is not drawn, so it does not push labels away.
    if (markerVisible === false) return
    const core = (pointSize ?? DEFAULT_POINT_SIZE) * objectRenderScale
    labelObstacles.push({ ownerId: ownerOf(id), center: point, radius: ownerOf(id) === id ? core * POINT_OUTER_SCALE : core })
  })
  renderedLines.forEach(({ id, layout }) => labelAnchors.set(id, layout.labelPoint))
  renderedInfinity.forEach(({ id, layout }) => labelAnchors.set(id, {
    x: layout.center.x + layout.radiusX * Math.SQRT1_2,
    y: layout.center.y - layout.radiusY * Math.SQRT1_2,
  }))
  renderedIdealPoints.forEach(({ id, arrow, marker }) => {
    if (arrow) {
      labelAnchors.set(id, arrow.end)
      addSegmentObstacles(id, arrow)
    } else if (marker) labelAnchors.set(id, marker.tail)
  })
  const labelRequests = renderedPrimitives.flatMap(({ id, label, labelSettings }) => {
    const at = labelAnchors.get(id)
    return label && at ? [{ key: id, ownerId: ownerOf(id), text: label, at, settings: labelSettings }] : []
  })
  // Placement compares every label with every obstacle, so it is redone only
  // when its inputs change, not on every frame of an unrelated animation.
  const labelPlacementKey = labelRequests.length === 0
    ? ''
    : JSON.stringify([labelRequests, labelObstacles, expressionDoc.view.display.objectScale])
  if (labelPlacementCache.current?.key !== labelPlacementKey) {
    labelPlacementCache.current = {
      key: labelPlacementKey,
      placed: labelRequests.length === 0
        ? new Map()
        : placeLabels(labelRequests, labelObstacles, expressionDoc.view.display.objectScale),
    }
  }
  const placedLabels = labelPlacementCache.current.placed
  const placedLabel = (id: string) => placedLabels.get(id) ?? null

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
    if (!(input instanceof HTMLInputElement)) {
      const fallback = removedEditorFallbacks.current.get(selection.id)
      if (fallback) {
        restoredSelection = fallback
        input = document.getElementById(fallback.id)
      }
    }
    if (!(input instanceof HTMLInputElement) &&
        viewportCreatedItemIds.current.has(selection.id.replace('expression-source-', ''))) {
      viewportSvgRef.current?.focus({ preventScroll: true })
      return
    }
    if (!(input instanceof HTMLInputElement)) return
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
    content: Readonly<{ source: string; positionSource?: string }> = { source: '' },
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
      setBoundId(null)
      setSavedRevision(null)
      setExampleRevision(null)
      setTheme(imported.theme)
      setAppearanceItemId(null)
      setExpandedListIds(new Set())
      viewportCreatedItemIds.current.clear()
      nextId.current = imported.document.items.length + 1
      setDocumentDiagnostic(imported.recoveryDiagnostic)
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
  /** The viewport the library panel is laid over on a narrow window. */
  const [viewportHost, setViewportHost] = useState<HTMLElement | null>(null)
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
      if (event.key !== null && event.key !== LIBRARY_INDEX_KEY && !event.key.startsWith(LIBRARY_DOCUMENT_PREFIX)) return
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
  const reportLibrary = (entries: readonly LibraryEntry[], diagnostic: string | null) =>
    setLibrary({ entries, diagnostic })
  const reportLibraryFailure = (error: unknown, fallback: string) => {
    setLibrary({
      entries: readLibrary(browserLibraryStorage(), libraryOptions()).entries,
      diagnostic: error instanceof LibraryError ? error.diagnostic : fallback,
    })
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
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      setEphemeral(false)
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
    if (playback.anyPlaying) playback.stopAll()
    dispatchHistory({ type: 'replace', document })
    setTheme(nextTheme)
    setAppearanceItemId(null)
    setExpandedListIds(new Set())
    viewportCreatedItemIds.current.clear()
    nextId.current = document.items.length + 1
    setDocumentDiagnostic(diagnostic)
    setBoundId(libraryId)
    setExampleRevision(null)
    setSavedRevision(null)
    markSavedOnRender.current = libraryId !== null
    if (ephemeral) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      setEphemeral(false)
    }
    closeLibrary()
  }
  const openLibraryEntry = (entry: LibraryEntry) => {
    // The open graph is already there: reopening it would discard its changes.
    if (entry.id === boundId && !ephemeral) {
      closeLibrary()
      return
    }
    try {
      const restored = fromCanonicalDocument(loadFromLibrary(browserLibraryStorage(), entry.id), restoreOptions)
      requireAvailableAlgebra(algebraRegistry, restored.document.algebra)
      if (!keepFormerDocument()) return
      openGraph(restored.document, restored.theme, restored.recoveryDiagnostic, entry.id)
    } catch (error) {
      reportLibraryFailure(error, error instanceof DocumentFormatError
        ? `LIBRARY_ENTRY_INVALID: “${entry.name}” could not be opened. ${error.code}: ${error.message}`
        : `LIBRARY_ENTRY_INVALID: “${entry.name}” could not be opened.`)
    }
  }
  /** A new empty graph in the current algebra and view. */
  const newLibraryGraph = () => {
    if (!keepFormerDocument()) return
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
    markExampleOnRender.current = true
  }
  const addExampleToLibrary = (example: LibraryExample) => {
    try {
      const added = addCopyToLibrary(browserLibraryStorage(), example.document, libraryOptions())
      reportLibrary(added.entries, null)
      setCopyNotice({ message: `Added “${added.name}” to my library.`, durationMs: 2500 })
    } catch (error) {
      reportLibraryFailure(error, `LIBRARY_WRITE_FAILED: “${example.name}” could not be added to the library.`)
    }
  }

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
      ...showcaseMetadata(definition),
    })
    // The algebra's showcase makes the switch land on a working example.
    showcaseItems(definition.showcase).forEach((item) => executeCommand({ kind: 'insert-item', item }))
    nextId.current = definition.showcase.length + 1
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
    editor: HTMLInputElement,
    itemId: string,
    step: 'up' | 'down',
  ) => {
    rememberEditorFocus(editor)
    pendingHistoryFocus.current = lastEditorFocus.current
    // A refused move changes no document, so nothing would consume the focus.
    if (!folders.moveStep(itemId, step)) pendingHistoryFocus.current = null
  }

  const handleItemKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
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

  // The glyphs of the selected object are drawn after all others, so that its
  // handles are on top where handles coincide (#100). Keys are item ids, list
  // element ids `id:index`, or `connection-id` for a list's links.
  const raiseSelectedGlyphs = (glyphs: readonly ReactElement[]): readonly ReactElement[] => {
    if (selectedObjectId === null) return glyphs
    const owned = (glyph: ReactElement) =>
      ownerOf(String(glyph.key).replace(/^connection-/, '')) === selectedObjectId
    return [...glyphs.filter((glyph) => !owned(glyph)), ...glyphs.filter(owned)]
  }
  const expressionRowElementRefs: ExpressionRowRefs = {
    expressionRowRefs,
    inputRefs,
    normalizationToggleRefs,
    appearanceAnchorRef,
    normalizationAnchorRef,
  }
  const expressionRowActions: ExpressionRowActions = {
    executeCommand,
    dispatchHistory,
    rememberEditorFocus,
    handleItemKeyDown,
    insertExpression,
    removeExpression,
    beginRowReorder: folders.beginRowReorder,
    reorderRowWithKeyboard: folders.reorderRowWithKeyboard,
    focusRow: (itemId) => setRowFocusId(itemId),
    blurRow: (itemId) => setRowFocusId((current) => current === itemId ? null : current),
    hoverRow: (itemId) => setRowHoverId(itemId),
    leaveRow: (itemId) => setRowHoverId((current) => current === itemId ? null : current),
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
          className={`expression-panel${panelHidden ? ' is-collapsed' : ''}${noViz ? ' is-full-width' : ''}${referenceOpen ? ' has-reference' : ''}`}
          aria-label="Expressions"
          style={noViz ? undefined : { width: panelWidth, '--panel-width': `${panelWidth}px` } as CSSProperties}
          inert={panelHidden}
        >
          <div className="expression-toolbar">
            <button
              ref={addButtonRef}
              type="button"
              className="add-expression"
              onClick={() => insertExpression()}
              disabled={
                expressionDoc.items.length >= MAX_EXPRESSION_ITEMS
              }
              aria-label="Add expression"
            >
              <span aria-hidden="true">+</span>
              <span>Add expression</span>
            </button>
            <button
              type="button"
              className="add-folder"
              onClick={folders.createFolder}
              aria-label="New folder"
              title="New folder"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M1.75 4.25v8.5h12.5v-7h-6.5l-1.5-1.5h-4.5z" fill="none" strokeLinejoin="round" />
                <path d="M8 7.25v4M6 9.25h4" strokeLinecap="round" />
              </svg>
            </button>
            <div className="expression-history-controls" role="group" aria-label="Expression history">
              <button
                type="button"
                className="history-command"
                disabled={history.past.length === 0}
                aria-label="Undo document change"
                title="Undo (Ctrl/Cmd+Z)"
                onClick={() => dispatchHistoryWithFocus('undo')}
              >
                <span aria-hidden="true">↶</span>
              </button>
              <button
                type="button"
                className="history-command"
                disabled={history.future.length === 0}
                aria-label="Redo document change"
                title="Redo (Ctrl/Cmd+Shift+Z)"
                onClick={() => dispatchHistoryWithFocus('redo')}
              >
                <span aria-hidden="true">↷</span>
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
            <ExpressionTree document={expressionDoc} folders={folders} renderItem={(itemId) => {
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
                appearance={expressionDoc.appearance[entry.item.id]}
                appearanceSources={appearanceSources.get(entry.item.id) ?? DEFAULT_APPEARANCE_SOURCES}
                engine={engine}
                interpretation={interpretation}
                display={expressionDoc.view.display}
                objectRenderScale={objectRenderScale}
                noViz={noViz}
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
                onClick={() => zoomViewport(1.25)}
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
                onClick={() => zoomViewport(0.8)}
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
                onClick={recenterViewport}
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
              ref={attachViewportSvg}
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
              onKeyDown={navigateViewportWithKeyboard}
              onDoubleClick={embed ? undefined : createVectorFromViewport}
              onFocus={(event) => {
                if (isHandleElement(event.target))
                  setHandleFocusSelection((current) => current ?? { itemId: selectedObjectId })
              }}
              onBlur={(event) => {
                if (isHandleElement(event.target) && !isHandleElement(event.relatedTarget))
                  setHandleFocusSelection(null)
              }}
            >
              <desc id="canvas-description">{canvasDescription}</desc>
              {expressionDoc.view.display.gridVisible && <g aria-hidden="true">
                {grid.vertical.map((line) => <line
                  key={`grid-x-${line.coordinate}`}
                  className={line.major ? 'grid-line is-major' : 'grid-line'}
                  x1={line.screen} y1="0" x2={line.screen} y2={viewport.height}
                />)}
                {grid.horizontal.map((line) => <line
                  key={`grid-y-${line.coordinate}`}
                  className={line.major ? 'grid-line is-major' : 'grid-line'}
                  x1="0" y1={line.screen} x2={viewport.width} y2={line.screen}
                />)}
              </g>}

              {expressionDoc.view.display.axisLabelsVisible && <g aria-hidden="true">
                <line className="axis" x1="0" y1={origin.y} x2={viewport.width} y2={origin.y} />
                <line className="axis" x1={origin.x} y1="0" x2={origin.x} y2={viewport.height} />
                <circle className="origin" cx={origin.x} cy={origin.y} r={3 * objectRenderScale} />
                <text className="axis-name" x={viewport.width - 14} y={Math.max(16, Math.min(viewport.height - 8, origin.y - 8))}>x</text>
                <text className="axis-name" x={Math.max(8, Math.min(viewport.width - 18, origin.x + 8))} y="16">y</text>
              </g>}

              {expressionDoc.view.display.graduationsVisible && <g aria-hidden="true">
                {grid.vertical.filter((line) => line.major && line.coordinate !== 0).map((line) => {
                  const axisY = Math.max(16, Math.min(viewport.height - 18, origin.y))
                  return <g key={`graduation-x-${line.coordinate}`}>
                    <line className="graduation" x1={line.screen} y1={axisY - 4} x2={line.screen} y2={axisY + 4} />
                    <text className="graduation-label" x={line.screen} y={axisY + 16}>{displayedNumber(line.coordinate)}</text>
                  </g>
                })}
                {grid.horizontal.filter((line) => line.major && line.coordinate !== 0).map((line) => {
                  const axisX = Math.max(28, Math.min(viewport.width - 28, origin.x))
                  return <g key={`graduation-y-${line.coordinate}`}>
                    <line className="graduation" x1={axisX - 4} y1={line.screen} x2={axisX + 4} y2={line.screen} />
                    <text className="graduation-label is-y" x={axisX - 8} y={line.screen + 4}>{displayedNumber(line.coordinate)}</text>
                  </g>
                })}
              </g>}

              {raiseSelectedGlyphs([
                ...renderedVectors.map(({ id, primitive, entity, layout, color, strokeStyle, strokeWidth, opacity }) => {
                  const item = expressionDoc.items.find((candidate) => candidate.id === id)
                  return <OrientedSegmentGlyph
                    key={id}
                    id={id}
                    primitive={primitive}
                    layout={layout}
                    color={color}
                    label={placedLabel(id)}
                    scale={objectRenderScale}
                    itemPresent={!!item}
                    headMovable={!!item && headMovable(item, entity)}
                    baseMovable={!!item && objectBaseMovable(item, entity)}
                    controller={handleController}
                    strokeStyle={strokeStyle}
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                  />
                }),
                ...renderedAreas.map(({ id, primitive, entity, layout, color, borderVisible, orientationVisible, strokeStyle, strokeWidth, opacity }) => {
                  const item = expressionDoc.items.find((candidate) => candidate.id === id)
                  return <OrientedAreaGlyph
                    key={id}
                    id={id}
                    primitive={primitive}
                    layout={layout}
                    color={color}
                    label={placedLabel(id)}
                    scale={objectRenderScale}
                    borderVisible={borderVisible}
                    orientationVisible={orientationVisible}
                    itemPresent={!!item}
                    baseMovable={!!item && objectBaseMovable(item, entity)}
                    controller={handleController}
                    strokeStyle={strokeStyle}
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                  />
                }),
                ...renderedLines.map(({ id, primitive, entity, layout, color, orientationVisible, strokeStyle, strokeWidth, opacity }) => {
                  const item = expressionDoc.items.find((candidate) => candidate.id === id)
                  const selection = selectedLine?.itemId === id
                    ? layoutLineSelection(primitive, selectedLine.anchor, viewport, objectRenderScale)
                    : null
                  return <UnboundedLineGlyph
                    key={id}
                    id={id}
                    primitive={primitive}
                    layout={layout}
                    color={color}
                    label={placedLabel(id)}
                    scale={objectRenderScale}
                    itemPresent={!!item}
                    movable={!!item && lineMovable(item, entity)}
                    orientationVisible={orientationVisible}
                    orientationTicks={lineOrientationTicks(primitive, layout, objectRenderScale)}
                    selection={selection}
                    controller={handleController}
                    strokeStyle={strokeStyle}
                    strokeWidth={strokeWidth}
                    opacity={opacity}
                  />
                }),
                ...renderedInfinity.map(({ id, primitive, layout, color, opacity }) => (
                  <LineAtInfinityGlyph key={id} accessibleName={primitive.accessibleName} layout={layout} color={color} label={placedLabel(id)} scale={objectRenderScale} opacity={opacity} />
                )),
                ...renderedIdealPoints.map(({ id, primitive, entity, arrow, marker, color, strokeStyle, strokeWidth, opacity }) => {
                  const item = expressionDoc.items.find((candidate) => candidate.id === id)
                  return <g key={id}>
                    {marker && <DirectionMarkerGlyph
                      accessibleName={primitive.accessibleName}
                      layout={marker}
                      color={color}
                      label={arrow ? null : placedLabel(id)}
                      scale={objectRenderScale}
                      opacity={opacity}
                    />}
                    {arrow && <OrientedSegmentGlyph
                      id={id}
                      primitive={{ kind: 'oriented-segment', start: primitive.position, end: {
                        x: primitive.position.x + primitive.direction.x * primitive.magnitude,
                        y: primitive.position.y + primitive.direction.y * primitive.magnitude,
                      }, accessibleName: primitive.accessibleName }}
                      layout={arrow}
                      color={color}
                      label={placedLabel(id)}
                      scale={objectRenderScale}
                      itemPresent={!!item}
                      headMovable={!!item && headMovable(item, entity)}
                      baseMovable={!!item && objectBaseMovable(item, entity)}
                      controller={handleController}
                      strokeStyle={strokeStyle}
                      strokeWidth={strokeWidth}
                      opacity={opacity}
                    />}
                  </g>
                }),
                ...renderedConnections.map(({ id, segments, color, opacity, strokeStyle, strokeWidth }) => (
                  <PointListConnectionGlyph
                    key={`connection-${id}`}
                    path={layoutPointListConnection(segments, viewport)}
                    color={color}
                    scale={objectRenderScale}
                    opacity={opacity}
                    strokeStyle={strokeStyle}
                    strokeWidth={strokeWidth}
                  />
                )),
                ...renderedPoints.map(({ id, primitive, entity, point, color, markerVisible, opacity, pointStyle, pointSize }) => {
                  const item = expressionDoc.items.find((candidate) => candidate.id === id)
                  return <PointMarkerGlyph
                    key={id}
                    id={id}
                    primitive={primitive}
                    point={point}
                    color={color}
                    label={placedLabel(id)}
                    scale={objectRenderScale}
                    itemPresent={!!item}
                    movable={!!item && objectBaseMovable(item, entity)}
                    markerVisible={markerVisible}
                    controller={handleController}
                    opacity={opacity}
                    pointStyle={pointStyle}
                    pointSize={pointSize}
                  />
                }),
              ])}
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
          onClose={closeLibrary}
        />
      )}
      </div>
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
            <p>Drop a JSON document to open it</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
