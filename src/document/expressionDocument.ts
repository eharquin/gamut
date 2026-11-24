import { CURRENT_LANGUAGE_VERSION } from '../language/migrateLanguage'
import type { FolderPath } from './folderModel'

export const MAX_EXPRESSION_ITEMS = 1_000

export type ExpressionAppearance = Readonly<{
  visible?: boolean
  style?: string
  labelVisible?: boolean
  label?: string
  borderVisible?: boolean
  orientationVisible?: boolean
  bivectorShape?: 'from-vectors' | 'disk' | 'square'
  /** How an ideal point is drawn: as a positioned arrow, as an edge marker, or both. */
  idealPointDisplay?: 'vector' | 'ideal' | 'both'
  /** Stroke of lines, vectors, bivector outlines and ideal-point arrows. */
  strokeStyle?: StrokeStyle
  /**
   * Numeric appearance settings are stored as source text, like slider
   * bounds: a number or a scalar expression. An empty source selects the
   * default of the object kind.
   */
  strokeWidthSource?: string
  pointStyle?: PointStyle
  pointSizeSource?: string
  opacitySource?: string
  labelAngleSource?: string
  labelSizeSource?: string
  labelDistanceSource?: string
  labelAnchor?: LabelAnchor
  /** The label is drawn and the object is not, though it can still be moved. */
  labelOnly?: boolean
  /** Whether the object's handles move it on the canvas; false holds it in place. */
  draggable?: boolean
  /** Whether a scalar's slider is also drawn on the canvas; off by default. */
  sliderInCanvas?: boolean
  /** Styles of the primitives a list holds, one block per primitive type. */
  primitiveStyles?: ExpressionPrimitiveStyles
}>

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type PointStyle = 'dot' | 'ring' | 'cross' | 'plus' | 'square' | 'diamond'
export type LabelAnchor =
  | 'auto'
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'
  | 'center'
/** How the points of a list are joined by its border, in evaluated list order. */
export type PointListDisplay = 'none' | 'open-polyline' | 'closed-loop'
export type ItemNormalization = 'natural' | 'euclidean' | 'ideal'

/**
 * Points of a list: whether their markers are drawn, the marker style and
 * size, how they are connected in evaluated list order (the border), and
 * whether the polygon they bound is filled, at an opacity of the list's color.
 * The three parts are drawn or hidden independently.
 */
export type PointPrimitiveStyle = Readonly<{
  visible: boolean
  pointStyle: PointStyle
  pointSizeSource: string
  connection: PointListDisplay
  strokeStyle: StrokeStyle
  strokeWidthSource: string
  fill: boolean
  /** Percent of the list's color; empty for the default 20. */
  fillOpacitySource: string
}>

/** Lines of a list. */
export type LinePrimitiveStyle = Readonly<{
  visible: boolean
  strokeStyle: StrokeStyle
  strokeWidthSource: string
  orientationVisible: boolean
}>

/** Sparse in memory, like the rest of an appearance record. */
export type ExpressionPrimitiveStyles = Readonly<{
  points?: Readonly<Partial<PointPrimitiveStyle>>
  lines?: Readonly<Partial<LinePrimitiveStyle>>
}>

export type ExpressionControl = Readonly<{
  mode: 'number' | 'slider'
  minimumSource: string
  maximumSource: string
  stepSource: string
  animation: Readonly<{
    mode: 'once' | 'loop' | 'ping-pong'
    direction: 'forward' | 'reverse'
    durationSeconds: number
  }> | null
}>

export type ExpressionItem = Readonly<{
  id: string
  kind?: 'expression' | 'annotation'
  source: string
  positionSource?: string
  normalization?: ItemNormalization
  control?: ExpressionControl
  /**
   * The folder that contains the item, as folder names from the root
   * (DOC-013); absent or empty at the top level.
   */
  folder?: FolderPath
}>

/** A declared expression folder and its stored collapsed state (DOC-013). */
export type ExpressionFolder = Readonly<{
  path: FolderPath
  collapsed: boolean
  /**
   * The appearance of the folder. Its `visible` hides every row of the folder
   * when false; the rest applies to the rows only while `overwriteAppearance`
   * is on. Absent until the folder's menu is first used.
   */
  appearance?: ExpressionAppearance
  /** The folder's appearance replaces that of every row it holds, without changing theirs. */
  overwriteAppearance?: boolean
  /**
   * Where a folder without items shows: just before the row, or the folder,
   * that holds this item at its level. A folder with items shows at its first
   * item; absent, or naming an item that is not there, an empty folder shows
   * after the other rows of its parent. Empty folders before one item keep
   * the order of the folder list.
   */
  before?: string
}>

export type ExpressionDocument = Readonly<{
  id: string
  title: string
  description: string
  languageVersion: number
  algebra: Readonly<{
    algebraId: string
    definitionVersion: number
    conventionVersion: number
    parameters: Readonly<Record<string, unknown>>
  }>
  interpretation: Readonly<{
    interpretationId: string
    interpretationVersion: number
  }> | null
  view: Readonly<{
    visualizerId: string | null
    positionEnabled: boolean
    viewport: Readonly<{ kind: 'none' }> | Readonly<{
      kind: 'two-dimensional'
      centerX: number
      centerY: number
      zoom: number
    }>
    display: Readonly<{
      decimalPlaces: number
      axisLabelsVisible: boolean
      graduationsVisible: boolean
      gridVisible: boolean
      objectScale: number
      showApproximatedResidue: boolean
      /** Whether the multivector values are shown under the expressions (#191). */
      valuesVisible: boolean
      /** Whether the canvas draws the labels of the objects; each keeps its own setting. */
      labelsVisible: boolean
    }>
  }>
  items: readonly ExpressionItem[]
  appearance: Readonly<Record<string, ExpressionAppearance>>
  /**
   * Every expression folder, empty ones included, with its collapsed state;
   * absent when the document has none (DOC-013).
   */
  folders?: readonly ExpressionFolder[]
}>

/** Creates a document whose item identities are independent of their source. */
export function expressionDocument(
  items: readonly ExpressionItem[],
  appearance: Readonly<Record<string, ExpressionAppearance>> = {},
  metadata: Readonly<{ id?: string; title?: string; description?: string }> = {},
): ExpressionDocument {
  const retainedItems = items.slice(0, MAX_EXPRESSION_ITEMS)
  const retainedIds = new Set(retainedItems.map((item) => item.id))
  return {
    id: metadata.id ?? 'local-document',
    title: metadata.title ?? 'Untitled document',
    description: metadata.description ?? '',
    languageVersion: CURRENT_LANGUAGE_VERSION,
    algebra: {
      algebraId: 'org.multivector.vga',
      definitionVersion: 1,
      conventionVersion: 1,
      parameters: {},
    },
    interpretation: {
      interpretationId: 'org.multivector.vga-2d',
      interpretationVersion: 1,
    },
    view: {
      visualizerId: 'org.multivector.vga-2d',
      positionEnabled: true,
      viewport: { kind: 'two-dimensional', centerX: 0, centerY: 0, zoom: 72 },
      display: {
        decimalPlaces: 4,
        axisLabelsVisible: true,
        graduationsVisible: true,
        gridVisible: true,
        objectScale: 1,
        showApproximatedResidue: false,
        valuesVisible: true,
        labelsVisible: true,
      },
    },
    items: retainedItems.map((item) => ({ ...item })),
    appearance: Object.fromEntries(
      Object.entries(appearance)
        .filter(([id]) => retainedIds.has(id))
        .map(([id, value]) => [id, { ...value }]),
    ),
  }
}

/** Toggles the item's algebraic natural-normalization control. */
export function updateExpressionNormalization(
  document: ExpressionDocument,
  id: string,
  normalization: ItemNormalization | undefined,
): ExpressionDocument {
  return {
    ...document,
    items: document.items.map((item) =>
      item.id === id ? { ...item, normalization } : item,
    ),
  }
}

/**
 * Merges a partial appearance into a stored record. Primitive styles merge per
 * primitive type, so one list setting never resets the others.
 */
export function mergeAppearance(
  stored: ExpressionAppearance | undefined,
  update: ExpressionAppearance,
): ExpressionAppearance {
  const merged = { ...stored, ...update }
  if (update.primitiveStyles === undefined) return merged
  const previous = stored?.primitiveStyles
  const next = update.primitiveStyles
  return {
    ...merged,
    primitiveStyles: {
      ...previous,
      ...next,
      ...(next.points ? { points: { ...previous?.points, ...next.points } } : {}),
      ...(next.lines ? { lines: { ...previous?.lines, ...next.lines } } : {}),
    },
  }
}

/** Updates renderer-independent presentation metadata without changing source. */
export function updateExpressionAppearance(
  document: ExpressionDocument,
  id: string,
  appearance: ExpressionAppearance,
): ExpressionDocument {
  return {
    ...document,
    appearance: {
      ...document.appearance,
      [id]: mergeAppearance(document.appearance[id], appearance),
    },
  }
}

/**
 * Inserts an expression after the requested item, or at the end when no
 * matching item exists. A document at its normative item limit is unchanged.
 */
export function addExpression(
  document: ExpressionDocument,
  item: ExpressionItem,
  afterId?: string,
): ExpressionDocument {
  if (document.items.length >= MAX_EXPRESSION_ITEMS) return document

  const index =
    afterId === undefined
      ? document.items.length
      : document.items.findIndex((candidate) => candidate.id === afterId) + 1
  const insertionIndex = index <= 0 ? document.items.length : index

  return {
    ...document,
    items: [
      ...document.items.slice(0, insertionIndex),
      { ...item },
      ...document.items.slice(insertionIndex),
    ],
  }
}

/** Inserts an expression immediately before the requested item. */
export function addExpressionBefore(
  document: ExpressionDocument,
  item: ExpressionItem,
  beforeId: string,
): ExpressionDocument {
  if (document.items.length >= MAX_EXPRESSION_ITEMS) return document
  const index = document.items.findIndex((candidate) => candidate.id === beforeId)
  if (index < 0) return addExpression(document, item)
  return {
    ...document,
    items: [
      ...document.items.slice(0, index),
      { ...item },
      ...document.items.slice(index),
    ],
  }
}

/** Updates one item without changing its stable identity or list position. */
export function updateExpression(
  document: ExpressionDocument,
  id: string,
  source: string,
): ExpressionDocument {
  return {
    ...document,
    items: document.items.map((item) =>
      item.id === id ? { ...item, source } : item,
    ),
  }
}

/** Updates one item's optional position source without changing its value source. */
export function updateExpressionPosition(
  document: ExpressionDocument,
  id: string,
  positionSource: string,
): ExpressionDocument {
  return {
    ...document,
    items: document.items.map((item) =>
      item.id === id ? { ...item, positionSource } : item,
    ),
  }
}

/**
 * Removes every item and its appearance. The document identity survives, so
 * this is an emptying rather than a replacement.
 */
export function clearExpressions(
  document: ExpressionDocument,
): ExpressionDocument {
  return { ...document, items: [], appearance: {} }
}

/** Removes one item while preserving the identity and order of every sibling. */
export function deleteExpression(
  document: ExpressionDocument,
  id: string,
): ExpressionDocument {
  return {
    ...document,
    items: document.items.filter((item) => item.id !== id),
    appearance: Object.fromEntries(
      Object.entries(document.appearance).filter(([itemId]) => itemId !== id),
    ),
  }
}
