import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import type { PointStyle, StrokeStyle } from '../document/expressionDocument'
import type { PlacedLabel } from './labels'
import { PointShape } from './PointShape'
import { DEFAULT_STROKE_WIDTHS, POINT_OUTER_SCALE, strokePattern } from './stroke'
import type { Point2d } from '../geometry/interpretation'
import type { AreaLayout, DirectionLayout, InfinityLayout, LineLayout, SegmentLayout } from './layout'
import type {
  OrientedAreaPrimitive,
  OrientedSegmentPrimitive,
  PointMarkerPrimitive,
  UnboundedLinePrimitive,
} from './primitives'

/**
 * Inline stroke of a glyph. A solid stroke of default width gives nothing, so
 * an object whose stroke settings are untouched draws exactly as before.
 */
function strokeOverride(
  style: StrokeStyle,
  customWidth: number | null,
  defaultWidth: number,
): CSSProperties | undefined {
  if (style === 'solid' && customWidth === null) return undefined
  const width = customWidth ?? defaultWidth
  return { ...(customWidth === null ? {} : { strokeWidth: width }), ...strokePattern(style, width) }
}

/** The glyph's color, and its opacity when one is set. */
function glyphStyle(color: string, opacity: number | null | undefined): CSSProperties {
  return opacity === null || opacity === undefined ? { color } : { color, opacity }
}

/**
 * The drawn marks of an interactive glyph. Opacity fades them alone: handles,
 * hit targets, hover feedback, and the keyboard focus ring stay fully visible,
 * so a faded or invisible object can still be found and focused.
 */
function Marks({ opacity, children }: Readonly<{ opacity: number | null | undefined; children: ReactNode }>) {
  return opacity === null || opacity === undefined ? <>{children}</> : <g opacity={opacity}>{children}</g>
}

/**
 * An object's label, placed by `placeLabels`. A default top-right label has
 * only its position, as before format version 7.
 */
export function ObjectLabel({ label }: Readonly<{ label: PlacedLabel | null }>) {
  if (!label) return null
  return <text
    className="object-label"
    x={label.x}
    y={label.y}
    textAnchor={label.textAnchor}
    dominantBaseline={label.baseline}
    style={label.fontSize === undefined ? undefined : { fontSize: label.fontSize }}
    transform={label.angle ? `rotate(${-label.angle} ${label.x} ${label.y})` : undefined}
  >{label.text}</text>
}

/** `line` translates a line, `normal` rotates it about the selected anchor. */
export type ManipulationKind = 'head' | 'base' | 'line' | 'normal'

/**
 * What a glyph needs from the application shell to expose its handles: the
 * hover and keyboard-focus state keyed by `itemId:kind`, and the gesture
 * entry points. The shell owns pointer capture, history, and rewriting.
 */
export type HandleController = Readonly<{
  hoveredKey: string | null
  focusRingKey: string | null
  hover(key: string): void
  unhover(key: string): void
  focus(key: string): void
  blur(key: string): void
  pointerDown(event: ReactPointerEvent<SVGElement>, itemId: string, kind: ManipulationKind): void
  keyDown(
    event: KeyboardEvent<SVGElement>,
    itemId: string,
    kind: ManipulationKind,
    current: Point2d,
  ): void
}>

type BaseHandleProps = Readonly<{
  itemId: string
  point: Point2d
  mathematical: Point2d
  accessibleName: string
  movable: boolean
  scale: number
  controller: HandleController
  /** Lets a coincident head handle win the press (zero-length vectors). */
  yieldToHead?: boolean
  /** Verb of the accessible name; `Move base of` for objects with a separate position. */
  handleLabel?: string
  pointStyle?: PointStyle
  /** Core radius in reference pixels; `null` keeps the default 4.5. */
  pointSize?: number | null
}>

/**
 * The base contour, base point, and keyboard focus ring shared by every
 * located glyph. A movable base shows an outer shape at 20 % opacity: the
 * contour disk for a dot, otherwise the core's own form drawn behind a
 * transparent contour that stays the hit target. The core grows into it on
 * hover and while dragged.
 */
function BaseHandle({
  itemId, point, mathematical, accessibleName, movable, scale, controller, yieldToHead,
  handleLabel = 'Move base of', pointStyle = 'dot', pointSize = null,
}: BaseHandleProps) {
  const key = `${itemId}:base`
  // Written apart for the default so that the untouched drawing is unchanged.
  const coreRadius = pointSize === null ? 4.5 * scale : pointSize * scale
  const outerRadius = pointSize === null ? 10 * scale : pointSize * scale * POINT_OUTER_SCALE
  // A set size or a non-round style draws its outer shape apart, so that the
  // hit target can keep a usable size: never below the default 10 px disk, and
  // covering the tips of the diamond and plus, which reach past their radius.
  const shaped = pointStyle !== 'dot' || pointSize !== null
  const extent = outerRadius * (pointStyle === 'diamond' || pointStyle === 'plus' ? 1.3 : 1)
  const hitRadius = shaped ? Math.max(extent, 10 * scale) : outerRadius
  return <>
    {movable && shaped && <PointShape
      className="point-outer"
      pointStyle={pointStyle}
      x={point.x} y={point.y} radius={outerRadius}
      aria-hidden="true"
    />}
    <circle
      className={`manipulation-base-contour${movable ? ' is-movable' : ''}${shaped ? ' is-shaped' : ''}`}
      cx={point.x} cy={point.y} r={hitRadius}
      style={{
        strokeWidth: Math.max(0, 24 - 20 * scale),
        ...(yieldToHead ? { pointerEvents: 'none' as const } : {}),
      }}
      tabIndex={movable ? 0 : undefined}
      data-handle-key={movable ? key : undefined}
      role={movable ? 'button' : undefined}
      aria-keyshortcuts={movable ? 'Enter Delete' : undefined}
      aria-label={movable ? `${handleLabel} ${accessibleName}` : undefined}
      onPointerEnter={movable ? () => controller.hover(key) : undefined}
      onPointerLeave={movable ? () => controller.unhover(key) : undefined}
      onFocus={movable ? () => controller.focus(key) : undefined}
      onBlur={movable ? () => controller.blur(key) : undefined}
      onPointerDown={movable ? (event) => controller.pointerDown(event, itemId, 'base') : undefined}
      onKeyDown={movable ? (event) => controller.keyDown(event, itemId, 'base', mathematical) : undefined}
    />
    <PointShape
      className={`manipulation-base-point${controller.hoveredKey === key ? ' is-hovered' : ''}`}
      pointStyle={pointStyle}
      x={point.x} y={point.y} radius={coreRadius}
      aria-hidden="true"
    />
    {controller.focusRingKey === key && <circle
      className="manipulation-focus-ring"
      cx={point.x} cy={point.y} r={Math.max(14 * scale, extent + 4 * scale)}
      aria-hidden="true"
    />}
  </>
}

export type OrientedSegmentGlyphProps = Readonly<{
  id: string
  primitive: OrientedSegmentPrimitive
  layout: SegmentLayout
  color: string
  label: PlacedLabel | null
  scale: number
  /** The primitive belongs to a document item (list elements do not). */
  itemPresent: boolean
  headMovable: boolean
  baseMovable: boolean
  controller: HandleController
  strokeStyle?: StrokeStyle
  /** Shaft width in reference pixels; `null` keeps the default 4 screen pixels. */
  strokeWidth?: number | null
  opacity?: number | null
}>

export function OrientedSegmentGlyph({
  id, primitive, layout, color, label, scale, itemPresent, headMovable, baseMovable, controller,
  strokeStyle = 'solid', strokeWidth = null, opacity,
}: OrientedSegmentGlyphProps) {
  const { start, end, shaftEnd, arrowPoints } = layout
  const headKey = `${id}:head`
  const headAndBaseCoincide = Math.hypot(end.x - start.x, end.y - start.y) < 1
  const headHovered = controller.hoveredKey === headKey
  // The stylesheet draws the default shaft 4 px wide, 5 px while the head is
  // hovered; a set width grows in the same proportion.
  const shaft = strokeOverride(
    strokeStyle,
    strokeWidth === null ? null : strokeWidth * scale * (headHovered ? 1.25 : 1),
    headHovered ? 5 : 4,
  )
  return <g style={{ color }}>
    <Marks opacity={opacity}>
    <line
      className={`vector${headHovered ? ' is-head-hovered' : ''}`}
      x1={start.x}
      y1={start.y}
      x2={shaftEnd.x}
      y2={shaftEnd.y}
      strokeWidth={4 * scale}
      style={shaft}
      aria-label={primitive.accessibleName}
    />
    {arrowPoints && <polygon
      className="vector-arrowhead"
      points={arrowPoints}
      aria-hidden="true"
    />}
    {headMovable && <circle
      className="vector-head-point"
      cx={end.x} cy={end.y}
      r={1.25 * scale}
      aria-hidden="true"
    />}
    </Marks>
    {headMovable && <>
      {controller.focusRingKey === headKey && <circle
        className="manipulation-focus-ring"
        cx={end.x} cy={end.y} r={14 * scale}
        aria-hidden="true"
      />}
      {arrowPoints && controller.hoveredKey === headKey && <circle
        className="vector-head-indicator"
        cx={end.x} cy={end.y} r={5 * scale}
        aria-hidden="true"
      />}
      <circle
        className="manipulation-hit-target vector-head-target"
        cx={end.x} cy={end.y} r="12"
        tabIndex={0}
        data-handle-key={headKey}
        role="button"
        aria-label={`Move head of ${primitive.accessibleName}`}
        onPointerEnter={() => controller.hover(headKey)}
        onPointerLeave={() => controller.unhover(headKey)}
        onFocus={() => controller.focus(headKey)}
        onBlur={() => controller.blur(headKey)}
        onPointerDown={(event) => controller.pointerDown(event, id, 'head')}
        onKeyDown={(event) => controller.keyDown(event, id, 'head', primitive.end)}
      />
    </>}
    {itemPresent && <BaseHandle
      itemId={id}
      point={start}
      mathematical={primitive.start}
      accessibleName={primitive.accessibleName}
      movable={baseMovable}
      scale={scale}
      controller={controller}
      yieldToHead={headMovable && headAndBaseCoincide}
    />}
    {label && <Marks opacity={opacity}><ObjectLabel label={label} /></Marks>}
  </g>
}

function BivectorOrientationArrow({
  center, direction, scale,
}: Readonly<{
  center: Point2d
  direction: 1 | -1
  scale: number
}>) {
  const radius = 13 * scale
  const span = 1.5 * Math.PI
  const headLength = 0.4 * radius
  const startAngle = direction > 0 ? -Math.PI / 2 : Math.PI / 2
  const endAngle = startAngle + direction * span
  const strokeAngle = endAngle - direction * Math.min(headLength / radius, 0.5)
  const point = (angle: number) => ({
    x: center.x + radius * Math.cos(angle),
    y: center.y - radius * Math.sin(angle),
  })
  const start = point(startAngle)
  const strokeEnd = point(strokeAngle)
  const end = point(endAngle)
  const sweep = direction > 0 ? 0 : 1
  const heading = Math.atan2(end.y - strokeEnd.y, end.x - strokeEnd.x)
  const spread = 0.5
  const base = (angle: number) => ({
    x: end.x - headLength * Math.cos(angle),
    y: end.y - headLength * Math.sin(angle),
  })
  const first = base(heading - spread)
  const second = base(heading + spread)
  return <g className="bivector-orientation" aria-hidden="true" pointerEvents="none">
    <path
      d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 1 ${sweep} ${strokeEnd.x} ${strokeEnd.y}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={Math.min(2.2 * scale, 0.16 * radius)}
      strokeLinecap="round"
    />
    <polygon
      points={`${end.x},${end.y} ${first.x},${first.y} ${second.x},${second.y}`}
      fill="currentColor"
    />
  </g>
}

export type OrientedAreaGlyphProps = Readonly<{
  id: string
  primitive: OrientedAreaPrimitive
  layout: AreaLayout
  color: string
  label: PlacedLabel | null
  scale: number
  borderVisible: boolean
  orientationVisible: boolean
  itemPresent: boolean
  baseMovable: boolean
  controller: HandleController
  /** Stroke of the outline, drawn only when `borderVisible`. */
  strokeStyle?: StrokeStyle
  /** Outline width in reference pixels; `null` keeps the default 3 screen pixels. */
  strokeWidth?: number | null
  opacity?: number | null
}>

export function OrientedAreaGlyph({
  id, primitive, layout, color, label, scale, borderVisible, orientationVisible, itemPresent, baseMovable, controller,
  strokeStyle = 'solid', strokeWidth = null, opacity,
}: OrientedAreaGlyphProps) {
  const { path, orientationCenter, base } = layout
  return <g style={{ color }}>
    <Marks opacity={opacity}>
    <path
      className={`bivector${borderVisible ? ' has-border' : ''}`}
      d={path}
      strokeWidth={3 * scale}
      style={borderVisible
        ? strokeOverride(strokeStyle, strokeWidth === null ? null : strokeWidth * scale, 3)
        : undefined}
      pointerEvents="none"
      aria-label={primitive.accessibleDescription}
    />
    {orientationVisible && <BivectorOrientationArrow
      center={orientationCenter}
      direction={primitive.orientation === 'counterclockwise' ? 1 : -1}
      scale={scale}
    />}
    </Marks>
    {itemPresent && <BaseHandle
      itemId={id}
      point={base}
      mathematical={primitive.shape.kind === 'loop' ? primitive.shape.center : primitive.shape.vertices[0]}
      accessibleName={primitive.accessibleName}
      movable={baseMovable}
      scale={scale}
      controller={controller}
    />}
    {label && <Marks opacity={opacity}><ObjectLabel label={label} /></Marks>}
  </g>
}

export type PointMarkerGlyphProps = Readonly<{
  id: string
  primitive: PointMarkerPrimitive
  point: Point2d
  color: string
  label: PlacedLabel | null
  scale: number
  itemPresent: boolean
  movable: boolean
  /** False when a connected point list shows its segments alone; the label stays. */
  markerVisible?: boolean
  controller: HandleController
  opacity?: number | null
  pointStyle?: PointStyle
  /** Core radius in reference pixels; `null` keeps the default 4.5. */
  pointSize?: number | null
}>

/** A located point: a marker of the chosen style whose handle moves the point itself. */
export function PointMarkerGlyph({
  id, primitive, point, color, label, scale, itemPresent, movable, markerVisible = true, controller, opacity,
  pointStyle = 'dot', pointSize = null,
}: PointMarkerGlyphProps) {
  return <g style={{ color }}>
    <Marks opacity={opacity}>
    {markerVisible && <PointShape
      className="point-marker"
      pointStyle={pointStyle}
      x={point.x} y={point.y} radius={pointSize === null ? 4.5 * scale : pointSize * scale}
      aria-label={primitive.accessibleName}
    />}
    </Marks>
    {itemPresent && <BaseHandle
      itemId={id}
      point={point}
      mathematical={primitive.point}
      accessibleName={primitive.accessibleName}
      handleLabel="Move"
      movable={movable}
      scale={scale}
      controller={controller}
      pointStyle={pointStyle}
      pointSize={pointSize}
    />}
    {label && <Marks opacity={opacity}><ObjectLabel label={label} /></Marks>}
  </g>
}

export type PointListConnectionGlyphProps = Readonly<{
  path: string
  color: string
  scale: number
  opacity?: number | null
  strokeStyle?: StrokeStyle
  /** Width in reference pixels; `null` keeps the default 2. */
  strokeWidth?: number | null
}>

/**
 * The segments joining a connected point list, drawn beneath its markers.
 * They carry no handle: the markers keep the list's labels and manipulation.
 */
export function PointListConnectionGlyph({
  path, color, scale, opacity, strokeStyle = 'solid', strokeWidth = null,
}: PointListConnectionGlyphProps) {
  const width = (strokeWidth ?? DEFAULT_STROKE_WIDTHS.connection) * scale
  return <path
    className="point-list-connection"
    d={path}
    style={{ ...glyphStyle(color, opacity), ...strokePattern(strokeStyle, width) }}
    strokeWidth={width}
    aria-hidden="true"
  />
}

export type LineSelection = Readonly<{
  /** The anchor on the line, where the normal handle is drawn from (screen space). */
  anchor: Point2d
  /** The mathematical anchor, passed to keyboard handlers. */
  mathematicalAnchor: Point2d
  /** The tip of the normal handle (screen space). */
  normalTip: Point2d
  arrowPoints: string
}>

export type UnboundedLineGlyphProps = Readonly<{
  id: string
  primitive: UnboundedLinePrimitive
  layout: NonNullable<LineLayout>
  color: string
  label: PlacedLabel | null
  scale: number
  itemPresent: boolean
  /** The line's coefficients are a literal, so it can be translated and rotated. */
  movable: boolean
  orientationVisible: boolean
  /** Short ticks on the positive side, as `M x y L x y` segments. */
  orientationTicks: string
  selection: LineSelection | null
  controller: HandleController
  strokeStyle?: StrokeStyle
  /** Width in reference pixels; `null` keeps the kind default. */
  strokeWidth?: number | null
  opacity?: number | null
}>

/**
 * A line clipped to the viewport. A movable line shows a translucent double
 * border on hover, translates when dragged, and once selected shows its unit
 * normal, whose head rotates it about the anchor (PGA-VIZ-004).
 */
export function UnboundedLineGlyph({
  id, primitive, layout, color, label, scale, itemPresent, movable, orientationVisible, orientationTicks, selection, controller,
  strokeStyle = 'solid', strokeWidth = null, opacity,
}: UnboundedLineGlyphProps) {
  const lineKey = `${id}:line`
  const normalKey = `${id}:normal`
  const hovered = controller.hoveredKey === lineKey
  const width = (strokeWidth ?? DEFAULT_STROKE_WIDTHS.line) * scale
  return <g style={{ color }}>
    {movable && (hovered || selection) && <line
      className="unbounded-line-halo"
      x1={layout.start.x} y1={layout.start.y}
      x2={layout.end.x} y2={layout.end.y}
      strokeWidth={12 * scale}
      aria-hidden="true"
    />}
    <Marks opacity={opacity}>
    {orientationVisible && orientationTicks && <path
      className="line-orientation"
      d={orientationTicks}
      strokeWidth={1.2 * scale}
      aria-hidden="true"
    />}
    <line
      className="unbounded-line"
      x1={layout.start.x} y1={layout.start.y}
      x2={layout.end.x} y2={layout.end.y}
      strokeWidth={width}
      style={strokeStyle === 'solid' ? undefined : strokePattern(strokeStyle, width)}
      aria-label={primitive.accessibleName}
    />
    </Marks>
    {itemPresent && movable && <line
      className="manipulation-hit-target unbounded-line-hit"
      x1={layout.start.x} y1={layout.start.y}
      x2={layout.end.x} y2={layout.end.y}
      strokeWidth={16}
      tabIndex={0}
      data-handle-key={lineKey}
      role="button"
      aria-keyshortcuts="Enter"
      aria-label={`Move ${primitive.accessibleName}`}
      onPointerEnter={() => controller.hover(lineKey)}
      onPointerLeave={() => controller.unhover(lineKey)}
      onFocus={() => controller.focus(lineKey)}
      onBlur={() => controller.blur(lineKey)}
      onPointerDown={(event) => controller.pointerDown(event, id, 'line')}
      onKeyDown={(event) => controller.keyDown(event, id, 'line', selection?.mathematicalAnchor ?? primitive.point)}
    />}
    {controller.focusRingKey === lineKey && <line
      className="manipulation-focus-ring"
      x1={layout.start.x} y1={layout.start.y}
      x2={layout.end.x} y2={layout.end.y}
      strokeWidth={8 * scale}
      aria-hidden="true"
    />}
    {selection && <g className="line-normal">
      <circle
        className="line-anchor"
        cx={selection.anchor.x} cy={selection.anchor.y} r={3.5 * scale}
        strokeWidth={1.5 * scale}
        aria-hidden="true"
      />
      <line
        className="line-normal-shaft"
        x1={selection.anchor.x} y1={selection.anchor.y}
        x2={selection.normalTip.x} y2={selection.normalTip.y}
        strokeWidth={2 * scale}
        strokeDasharray={`${4 * scale} ${4 * scale}`}
        aria-hidden="true"
      />
      <polygon className="line-normal-head" points={selection.arrowPoints} aria-hidden="true" />
      {controller.focusRingKey === normalKey && <circle
        className="manipulation-focus-ring"
        cx={selection.normalTip.x} cy={selection.normalTip.y} r={14 * scale}
        aria-hidden="true"
      />}
      {controller.hoveredKey === normalKey && <circle
        className="vector-head-indicator"
        cx={selection.normalTip.x} cy={selection.normalTip.y} r={5 * scale}
        aria-hidden="true"
      />}
      <circle
        className="manipulation-hit-target vector-head-target"
        cx={selection.normalTip.x} cy={selection.normalTip.y} r="12"
        tabIndex={0}
        data-handle-key={normalKey}
        role="button"
        aria-label={`Rotate ${primitive.accessibleName}`}
        onPointerEnter={() => controller.hover(normalKey)}
        onPointerLeave={() => controller.unhover(normalKey)}
        onFocus={() => controller.focus(normalKey)}
        onBlur={() => controller.blur(normalKey)}
        onPointerDown={(event) => controller.pointerDown(event, id, 'normal')}
        onKeyDown={(event) => controller.keyDown(event, id, 'normal', selection.mathematicalAnchor)}
      />
    </g>}
    {label && <Marks opacity={opacity}><ObjectLabel label={label} /></Marks>}
  </g>
}

export type DirectionMarkerGlyphProps = Readonly<{
  accessibleName: string
  layout: DirectionLayout
  color: string
  label: PlacedLabel | null
  scale: number
  opacity?: number | null
}>

/** An ideal point on the line at infinity: an outward arrow whose tip sits on the ellipse. */
export function DirectionMarkerGlyph({ accessibleName, layout, color, label, scale, opacity }: DirectionMarkerGlyphProps) {
  const headLength = 10 * scale
  const spread = Math.PI / 6
  const head = [
    `${layout.tip.x},${layout.tip.y}`,
    `${layout.tip.x - headLength * Math.cos(layout.angle - spread)},${layout.tip.y - headLength * Math.sin(layout.angle - spread)}`,
    `${layout.tip.x - headLength * Math.cos(layout.angle + spread)},${layout.tip.y - headLength * Math.sin(layout.angle + spread)}`,
  ].join(' ')
  return <g style={glyphStyle(color, opacity)}>
    <line
      className="direction-marker"
      x1={layout.tail.x} y1={layout.tail.y}
      x2={layout.tip.x} y2={layout.tip.y}
      strokeWidth={2.5 * scale}
      strokeDasharray={`${4 * scale} ${3 * scale}`}
      aria-label={`${accessibleName} at infinity`}
    />
    <polygon className="direction-marker-head" points={head} aria-hidden="true" />
    <ObjectLabel label={label} />
  </g>
}

export type LineAtInfinityGlyphProps = Readonly<{
  accessibleName: string
  layout: InfinityLayout
  color: string
  label: PlacedLabel | null
  scale: number
  opacity?: number | null
}>

/** The line at infinity: a dashed ellipse inscribed in the viewport. */
export function LineAtInfinityGlyph({ accessibleName, layout, color, label, scale, opacity }: LineAtInfinityGlyphProps) {
  return <g style={glyphStyle(color, opacity)}>
    <ellipse
      className="line-at-infinity"
      cx={layout.center.x} cy={layout.center.y}
      rx={layout.radiusX} ry={layout.radiusY}
      strokeWidth={2 * scale}
      strokeDasharray={`${6 * scale} ${5 * scale}`}
      aria-label={accessibleName}
    />
    <ObjectLabel label={label} />
  </g>
}
