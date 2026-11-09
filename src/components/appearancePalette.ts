import type { ExpressionAppearance, PointListDisplay, PointStyle, StrokeStyle } from '../document/expressionDocument'

// Hue order of the palette: the registry, the swatches, and the reference
// tables all follow it.
const ramps = {
  red: ['#FADADF', '#F5A9B8', '#E8637F', '#C30A3A', '#92072B', '#60041C'],
  orange: ['#FDE3CF', '#F9C08E', '#F2914A', '#E06A12', '#A84E0D', '#6E3308'],
  yellow: ['#FDF0CB', '#FAD880', '#F0B833', '#E8A000', '#AA7500', '#6E4C00'],
  green: ['#C8F0DC', '#8DDCB4', '#41BF82', '#0F9D57', '#0A7540', '#064D2A'],
  teal: ['#CDF1F0', '#93DEDB', '#45C0BB', '#0E9E99', '#0A7470', '#064A48'],
  blue: ['#D4EBFA', '#A0D0F4', '#55ABDF', '#1482C8', '#0D5F94', '#073D60'],
  purple: ['#E9DDFA', '#CDB3F3', '#A47FE6', '#7B4BD0', '#5A339C', '#3A2066'],
  pink: ['#FBDCEF', '#F5ABD7', '#E86AB5', '#CC2E8E', '#9A1F6A', '#651345'],
  neutral: ['#F7F8FA', '#E1E4EA', '#C0C6D2', '#8B93A4', '#4E5668', '#1E2433'],
} as const

export type PaletteEntry = Readonly<{
  id: string
  hex: string
  name: string
  ramp: string
}>

export const STUDIO_COLORS: readonly PaletteEntry[] = Object.freeze(
  Object.entries(ramps).flatMap(([ramp, colors]) =>
    colors.map((hex, index) => ({
      id: `${ramp}-${index + 1}`,
      hex,
      name: `${ramp} ${index + 1}`,
      ramp,
    })),
  ),
)

export const RAMP_ORDER: readonly string[] = Object.freeze(Object.keys(ramps))

const DEFAULT_STYLE = 'blue-4'
const DEFAULT_COLOR = '#1482C8'

/**
 * Deterministic style identifier per semantic object kind, so an item without
 * stored appearance still reads consistently across a document. Keys are the
 * strings produced by `describeVga2Entity`, plus the `List` container kind.
 * Ordered for presentation: this table is the source the algebra reference
 * documents, so the mapping and its documentation cannot drift apart.
 */
export const DEFAULT_OBJECT_STYLES: readonly (readonly [string, string])[] =
  Object.freeze([
    ['Scalar', 'green-4'],
    ['Vector', 'yellow-4'],
    ['Bivector', 'red-4'],
    ['Rotor', 'blue-3'],
    ['Mixed multivector', 'blue-4'],
    ['List', 'green-3'],
    ['Point', 'blue-4'],
    ['Ideal point', 'yellow-4'],
    ['Line', 'red-4'],
    ['Line at infinity', 'neutral-4'],
    ['Translator', 'blue-3'],
    ['Motor', 'yellow-5'],
    ['Reflection', 'red-5'],
  ] as const)

export function paletteEntry(style: string): PaletteEntry | undefined {
  return STUDIO_COLORS.find((candidate) => candidate.id === style)
}

export function studioColor(style: string): string {
  return paletteEntry(style)?.hex ?? DEFAULT_COLOR
}

export function defaultStyleForKind(kind: string): string {
  const canonical = kind.startsWith('List') ? 'List' : kind
  return (
    DEFAULT_OBJECT_STYLES.find(([name]) => name === canonical)?.[1] ??
    DEFAULT_STYLE
  )
}

export type ResolvedAppearance = Readonly<{
  visible: boolean
  styleId: string
  color: string
  labelVisible: boolean
  /** Stored label text, authoritative for editing; empty selects the default. */
  label: string
  /** Label actually drawn, or `null` when neither text nor a declared name exists. */
  displayLabel: string | null
  borderVisible: boolean
  orientationVisible: boolean
  bivectorShape: 'from-vectors' | 'disk' | 'square'
  idealPointDisplay: 'vector' | 'ideal' | 'both'
  pointListDisplay: PointListDisplay
  pointMarkersVisible: boolean
  /** Whether a list draws the lines it holds. */
  linesVisible: boolean
  strokeStyle: StrokeStyle
  /** Stroke and orientation of the lines a list holds, independent of the item's own. */
  lineStrokeStyle: StrokeStyle
  linesOrientationVisible: boolean
  pointStyle: PointStyle
  /** Marker style of the points a list holds, and the stroke of their connection. */
  listPointStyle: PointStyle
  connectionStrokeStyle: StrokeStyle
}>

/**
 * Whether an object of this kind shows its orientation when nothing is
 * stored: a new line starts without it (#221), a bivector with it. Stored
 * documents keep the value they hold.
 */
export function defaultOrientationVisible(kind: string): boolean {
  return kind !== 'Line'
}

/**
 * Applies the renderer-side defaults required by APP-003 to one stored
 * appearance record. Both the expression row and the visualizer resolve through
 * this function so an item cannot be described one way and drawn another.
 */
export function resolveItemAppearance(
  appearance: ExpressionAppearance | undefined,
  kind: string,
  declaredName: string | null,
): ResolvedAppearance {
  const styleId = appearance?.style ?? defaultStyleForKind(kind)
  const label = appearance?.label ?? ''
  return {
    visible: appearance?.visible ?? true,
    styleId,
    color: studioColor(styleId),
    labelVisible: appearance?.labelVisible ?? false,
    label,
    displayLabel: label || declaredName,
    borderVisible: appearance?.borderVisible ?? false,
    orientationVisible: appearance?.orientationVisible ?? defaultOrientationVisible(kind),
    bivectorShape: appearance?.bivectorShape ?? 'from-vectors',
    idealPointDisplay: appearance?.idealPointDisplay ?? 'vector',
    pointListDisplay: appearance?.primitiveStyles?.points?.connection ?? 'none',
    pointMarkersVisible: appearance?.primitiveStyles?.points?.visible ?? true,
    linesVisible: appearance?.primitiveStyles?.lines?.visible ?? true,
    strokeStyle: appearance?.strokeStyle ?? 'solid',
    lineStrokeStyle: appearance?.primitiveStyles?.lines?.strokeStyle ?? 'solid',
    // A list's lines default to the item's orientation (document format §2.2.2).
    linesOrientationVisible: appearance?.primitiveStyles?.lines?.orientationVisible ??
      appearance?.orientationVisible ?? defaultOrientationVisible(kind),
    pointStyle: appearance?.pointStyle ?? 'dot',
    listPointStyle: appearance?.primitiveStyles?.points?.pointStyle ?? 'dot',
    connectionStrokeStyle: appearance?.primitiveStyles?.points?.strokeStyle ?? 'solid',
  }
}
