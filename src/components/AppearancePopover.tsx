import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { paletteEntry, RAMP_ORDER, STUDIO_COLORS } from './appearancePalette'
import { popoverPosition } from './popoverPosition'
import type { ExpressionAppearance, ExpressionControl, LabelAnchor, PointListDisplay, PointStyle, StrokeStyle } from '../document/expressionDocument'
import {
  APPEARANCE_SETTING_RANGES,
  DEFAULT_APPEARANCE_SOURCES,
  type AppearanceSetting,
  type ItemAppearanceSources,
} from '../application/evaluateAppearanceSources'
import { DEFAULT_POINT_SIZE, DEFAULT_STROKE_WIDTHS, POINT_OUTER_SCALE } from '../visualization/stroke'
import { PointShape } from '../visualization/PointShape'
import { DEFAULT_LABEL_DISTANCE, DEFAULT_LABEL_SIZE } from '../visualization/labels'

const POPOVER_WIDTH = 272
/** Height assumed before the menu is measured, and where layout is unavailable. */
const ESTIMATED_POPOVER_HEIGHT = 300

type AppearancePopoverProps = Readonly<{
  kind: string
  styleId: string
  visible: boolean
  labelVisible: boolean
  /** The graph's Labels setting is off: the label switch is greyed out and the settings hidden. */
  labelsDisabled?: boolean
  /** Whether a drag on the canvas moves the object; undefined when no drag can. */
  draggable?: boolean
  onDraggableChange?(draggable: boolean): void
  /** Whether a scalar's slider is also drawn on the canvas; offered with a control only. */
  sliderInCanvas?: boolean
  onSliderInCanvasChange?(sliderInCanvas: boolean): void
  borderVisible?: boolean
  orientationVisible?: boolean
  bivectorShape?: 'from-vectors' | 'disk' | 'square'
  parallelogramAvailable?: boolean
  idealPointDisplay?: 'vector' | 'ideal' | 'both'
  pointListDisplay?: PointListDisplay
  /** The evaluated item is a list of finite and ideal points holding at least one finite point. */
  pointListDisplayAvailable?: boolean
  pointMarkersVisible?: boolean
  /** Primitive types the evaluated list holds; each gets its own section. */
  listPrimitives?: Readonly<{ points: boolean; lines: boolean }>
  linesVisible?: boolean
  /** Stored appearance, for the version 7 settings edited as source text. */
  appearance?: ExpressionAppearance
  /** Resolved orientation of the lines a list holds. */
  linesOrientationVisible?: boolean
  /** The evaluated appearance sources, whose errors show under their fields. */
  sources?: ItemAppearanceSources
  colorOnly?: boolean
  /**
   * The menu of a folder (DOC-013): one section for each kind of object the
   * folder holds, and no label or animation, which belong to each row.
   */
  folder?: Readonly<{
    kinds: readonly string[]
    /** Whether the folder overwrites the appearance of its rows. */
    overwrite: boolean
    onOverwriteChange(overwrite: boolean): void
  }>
  control?: ExpressionControl
  reducedMotion?: boolean
  anchorRef: RefObject<HTMLButtonElement | null>
  onStyleChange(style: string): void
  onVisibleChange(visible: boolean): void
  onLabelVisibleChange(visible: boolean): void
  onBorderVisibleChange?(visible: boolean): void
  onOrientationVisibleChange?(visible: boolean): void
  onBivectorShapeChange?(shape: 'from-vectors' | 'disk' | 'square'): void
  onIdealPointDisplayChange?(display: 'vector' | 'ideal' | 'both'): void
  onPointListDisplayChange?(display: PointListDisplay): void
  onPointMarkersVisibleChange?(visible: boolean): void
  onLinesVisibleChange?(visible: boolean): void
  /** Writes version 7 settings; typing in one field coalesces under `coalesceKey`. */
  onAppearanceChange?(appearance: ExpressionAppearance, coalesceKey?: string): void
  onControlChange?(control: ExpressionControl): void
  onClose(): void
}>

/** The section of a folder menu for each kind of object it holds. */
const FOLDER_SECTION_TITLES: Readonly<Record<string, string>> = {
  Vector: 'Vectors', Line: 'Lines', Bivector: 'Bivectors', Point: 'Points', 'Ideal point': 'Ideal points',
}

/** The kinds whose style a folder menu shows, in this order. */
export const FOLDER_STYLE_KINDS = ['Point', 'Ideal point', 'Vector', 'Line', 'Bivector'] as const

export function AppearancePopover({
  kind,
  styleId,
  visible,
  labelVisible,
  labelsDisabled = false,
  draggable,
  onDraggableChange,
  sliderInCanvas,
  onSliderInCanvasChange,
  borderVisible = false,
  orientationVisible = true,
  bivectorShape = 'from-vectors',
  parallelogramAvailable = false,
  idealPointDisplay = 'vector',
  pointListDisplay = 'none',
  pointListDisplayAvailable = false,
  pointMarkersVisible = true,
  listPrimitives,
  linesVisible = true,
  appearance = {},
  linesOrientationVisible = false,
  sources = DEFAULT_APPEARANCE_SOURCES,
  colorOnly = false,
  folder,
  control,
  reducedMotion = false,
  anchorRef,
  onStyleChange,
  onVisibleChange,
  onLabelVisibleChange,
  onBorderVisibleChange,
  onOrientationVisibleChange,
  onBivectorShapeChange,
  onIdealPointDisplayChange,
  onPointListDisplayChange,
  onPointMarkersVisibleChange,
  onLinesVisibleChange,
  onAppearanceChange,
  onControlChange,
  onClose,
}: AppearancePopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const visibilityRef = useRef<HTMLButtonElement>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const fold = (title: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (!next.delete(title)) next.add(title)
    return next
  })
  const section = (title: string, children: ReactNode, toggle?: SectionToggle) => (
    <AppearanceSection
      title={title}
      open={!collapsed.has(title)}
      onFold={() => fold(title)}
      toggle={toggle}
    >{children}</AppearanceSection>
  )
  const closeRef = useRef<HTMLButtonElement>(null)
  const [placement, setPlacement] = useState(() => popoverPosition(
    anchorRef.current,
    POPOVER_WIDTH,
    ESTIMATED_POPOVER_HEIGHT,
  ))
  // The menu's height depends on the object kind and its current settings, so
  // it is measured rather than estimated; scrollHeight is the full content
  // height even when the menu is capped to the window and scrolls.
  const place = useCallback(() => {
    const measured = ref.current?.scrollHeight ?? 0
    const next = popoverPosition(
      anchorRef.current,
      POPOVER_WIDTH,
      measured > 0 ? measured : ESTIMATED_POPOVER_HEIGHT,
    )
    setPlacement((current) =>
      current.top === next.top && current.left === next.left ? current : next)
  }, [anchorRef])

  // Re-measure after every render: sections appear or disappear with the settings.
  useLayoutEffect(place)

  // Follow the anchor when the window is resized or any container scrolls.
  useEffect(() => {
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [place])

  useEffect(() => {
    const anchor = anchorRef.current
    // Opened from the keyboard, the menu gives the focus back to its swatch;
    // opened with the pointer, it leaves the row unfocused.
    const returnFocusTarget = anchor !== null && anchor === document.activeElement ? anchor : null
    ;(visibilityRef.current ?? closeRef.current)?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return
      if (anchor?.contains(event.target as Node)) return
      onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // Pointer events, in the capture phase: the canvas prevents the default of
    // its pointerdown, which suppresses the mousedown that would follow.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      returnFocusTarget?.focus()
    }
  }, [anchorRef, onClose])

  const title = folder ? kind : kind.startsWith('List') ? 'List' : kind
  const list = kind.startsWith('List')
  const selected = paletteEntry(styleId) ?? paletteEntry('blue-4')!
  const shade = Number(selected.id.slice(selected.ramp.length + 1))
  const animated = control?.mode === 'slider' && control.animation !== null
  const connected = pointListDisplayAvailable && pointListDisplay !== 'none'
  const change = (update: ExpressionAppearance, coalesceKey?: string) => onAppearanceChange?.(update, coalesceKey)
  // The item's own stroke: lines, vectors, bivector outlines, ideal-point arrows.
  const strokeStyleField = (
    <Segmented label="Stroke style" value={appearance.strokeStyle ?? 'solid'} options={STROKE_OPTIONS}
      onChange={(strokeStyle) => change({ strokeStyle })} />
  )
  const strokeRow = (defaultWidth: number) => onAppearanceChange && (
    <SourceFields leading={strokeStyleField} fields={[{
      setting: 'strokeWidth',
      label: 'Width',
      source: appearance.strokeWidthSource ?? '',
      placeholder: defaultWidth,
      error: sources.strokeWidth.error,
      onChange: (strokeWidthSource) => change({ strokeWidthSource }, 'strokeWidth'),
    }]} />
  )
  // A vector has a size, as a point has: its anchor is the point of that
  // size, and its shaft and arrowhead grow with it. Setting it clears the
  // width a document may keep from before sizes existed.
  const vectorRow = () => onAppearanceChange && (
    <SourceFields leading={strokeStyleField} fields={[{
      setting: 'pointSize',
      label: 'Size',
      source: appearance.pointSizeSource ?? '',
      placeholder: DEFAULT_POINT_SIZE,
      error: sources.pointSize.error,
      onChange: (pointSizeSource) => change(
        appearance.strokeWidthSource ? { pointSizeSource, strokeWidthSource: '' } : { pointSizeSource }, 'pointSize'),
    }]} />
  )
  const styleFor = (kind: string) => kind === 'Bivector' ? (
    <>
      {onBivectorShapeChange && <>
        <Segmented label="Bivector shape" value={bivectorShape === 'from-vectors' && !parallelogramAvailable ? 'disk' : bivectorShape} onChange={onBivectorShapeChange} options={[
          ['from-vectors', 'From vectors', SHAPE_ICONS['from-vectors'], !parallelogramAvailable],
          ['disk', 'Disk', SHAPE_ICONS.disk],
          ['square', 'Square', SHAPE_ICONS.square],
        ]} />
        {!parallelogramAvailable && <p className="appearance-note">From vectors unavailable for this expression.</p>}
      </>}
      {onBorderVisibleChange && (
        <label className="appearance-switch">
          <span>Outline</span>
          <input type="checkbox" role="switch" checked={borderVisible}
            onChange={(event) => onBorderVisibleChange(event.target.checked)} />
        </label>
      )}
      {/* The stroke row sets the outline, so it shows only with one. */}
      {borderVisible && strokeRow(DEFAULT_STROKE_WIDTHS.outline)}
      {onOrientationVisibleChange && <div className="appearance-pair">
        <OrientationField checked={orientationVisible} onChange={onOrientationVisibleChange} />
      </div>}
    </>
  ) : kind === 'Line' ? (
    <>
      {strokeRow(DEFAULT_STROKE_WIDTHS.line)}
      {onOrientationVisibleChange && <div className="appearance-pair">
        <OrientationField checked={orientationVisible} onChange={onOrientationVisibleChange} />
      </div>}
    </>
  ) : kind === 'Vector' ? (
    vectorRow() ?? null
  ) : kind === 'Ideal point' && onIdealPointDisplayChange ? (
    <>
      <Segmented label="Ideal point display" value={idealPointDisplay} onChange={onIdealPointDisplayChange} options={[
        ['vector', 'As a vector', IDEAL_ICONS.vector],
        ['ideal', 'At infinity', IDEAL_ICONS.ideal],
        ['both', 'Both', IDEAL_ICONS.both],
      ]} />
      {/* The stroke row sets the arrow, drawn while the direction shows. */}
      {idealPointDisplay !== 'ideal' && vectorRow()}
    </>
  ) : kind === 'Point' && onAppearanceChange ? (
    <>
      <Segmented label="Point style" value={appearance.pointStyle ?? 'dot'} options={POINT_OPTIONS}
        onChange={(pointStyle) => change({ pointStyle })} />
      <SourceFields fields={[{
        setting: 'pointSize',
        label: 'Size',
        source: appearance.pointSizeSource ?? '',
        placeholder: DEFAULT_POINT_SIZE,
        error: sources.pointSize.error,
        onChange: (pointSizeSource) => change({ pointSizeSource }, 'pointSize'),
      }]} />
    </>
  ) : null
  const styleContent = folder ? null : styleFor(kind)
  const pointsBlock = appearance.primitiveStyles?.points
  const markersShown = pointMarkersVisible || !connected

  return createPortal(
    <div
      ref={ref}
      className="appearance-popover"
      role="dialog"
      aria-label={title}
      style={{ top: placement.top, left: placement.left, width: POPOVER_WIDTH }}
    >
      <header className="appearance-header">
        <strong>{title}</strong>
        {(!colorOnly || (onDraggableChange && draggable !== undefined)) && (
          // Under the kind: the same settings as the eye and the drag button of the expression row.
          <div className="appearance-header-toggles">
            {!colorOnly && (
              <button
                ref={visibilityRef}
                type="button"
                className="appearance-visible"
                role="switch"
                aria-checked={visible}
                aria-label="Visible"
                title={visible ? 'Hide' : 'Show'}
                onClick={() => onVisibleChange(!visible)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
                  <circle cx="8" cy="8" r="2" />
                  {!visible && <path d="M2.5 13.5 13.5 2.5" />}
                </svg>
                <span aria-hidden="true">Visible</span>
              </button>
            )}
            {onDraggableChange && draggable !== undefined && (
              <button
                type="button"
                className="appearance-visible"
                role="switch"
                aria-checked={draggable}
                aria-label="Draggable"
                title={draggable ? 'Hold in place' : 'Make draggable'}
                onClick={() => onDraggableChange(!draggable)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 2v12M2 8h12M6.2 3.8 8 2l1.8 1.8M6.2 12.2 8 14l1.8-1.8M3.8 6.2 2 8l1.8 1.8M12.2 6.2 14 8l-1.8 1.8" />
                  {!draggable && <path d="M2.5 13.5 13.5 2.5" />}
                </svg>
                <span aria-hidden="true">Draggable</span>
              </button>
            )}
          </div>
        )}
        {/* Last in the tab order, drawn at the top right. */}
        <button ref={closeRef} type="button" className="appearance-close" onClick={onClose}
          aria-label={`Close ${title} menu`} title="Close">×</button>
      </header>
      {folder && (
        <div className="appearance-overwrite">
          <label className="appearance-switch">
            <span>Overwrite appearance</span>
            <input type="checkbox" role="switch" checked={folder.overwrite}
              aria-describedby={folder.overwrite ? 'appearance-overwrite-note' : undefined}
              onChange={(event) => folder.onOverwriteChange(event.target.checked)} />
          </label>
          {folder.overwrite && (
            <p id="appearance-overwrite-note" className="appearance-note">
              Every row of the folder is drawn with these settings; its own come back when this is off.
            </p>
          )}
        </div>
      )}
      {section('Color', <>
        <div className="appearance-hues" role="group" aria-label="Hue">
          {RAMP_ORDER.map((ramp) => (
            <button
              key={ramp}
              type="button"
              className="appearance-hue"
              style={{ backgroundColor: hueSwatch(ramp, shade) }}
              aria-label={capitalized(ramp)}
              title={capitalized(ramp)}
              aria-pressed={ramp === selected.ramp}
              onClick={() => onStyleChange(`${ramp}-${shade}`)}
            />
          ))}
        </div>
        <div className="appearance-shades" role="group" aria-label={`${capitalized(selected.ramp)} shade`}>
          {STUDIO_COLORS.filter((candidate) => candidate.ramp === selected.ramp).map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className="appearance-shade"
              style={{ backgroundColor: candidate.hex }}
              title={candidate.hex}
              aria-label={`Use color ${candidate.name}`}
              aria-pressed={candidate.id === styleId}
              onClick={() => onStyleChange(candidate.id)}
            />
          ))}
        </div>
        {!colorOnly && onAppearanceChange && <SourceFields className="appearance-opacity" fields={[{
          setting: 'opacity',
          label: 'Opacity',
          source: appearance.opacitySource ?? '',
          placeholder: 100,
          error: sources.opacity.error,
          onChange: (opacitySource) => change({ opacitySource }, 'opacity'),
        }]} />}
      </>)}
      {styleContent && section('Style', styleContent)}
      {folder?.kinds.map((each) => {
        const content = styleFor(each)
        return content && <Fragment key={each}>{section(FOLDER_SECTION_TITLES[each] ?? each, content)}</Fragment>
      })}
      {list && listPrimitives?.points && onPointMarkersVisibleChange && section('Points', (pointListDisplayAvailable && onPointListDisplayChange) || onAppearanceChange ? <>
        {pointListDisplayAvailable && onPointListDisplayChange &&
          <Segmented label="Point list display" value={pointListDisplay} onChange={onPointListDisplayChange} options={[
            ['none', 'No connection', CONNECTION_ICONS.none],
            ['open-polyline', 'Open polyline', CONNECTION_ICONS['open-polyline']],
            ['closed-loop', 'Closed loop', CONNECTION_ICONS['closed-loop']],
          ]} />}
        {/* The points' own style: markers while drawn, then the links while connected. */}
        {onAppearanceChange && (markersShown || connected) && <div className="appearance-sub">
          <h4>Style</h4>
          {markersShown && <>
            <Segmented label="Point style" value={pointsBlock?.pointStyle ?? 'dot'} options={POINT_OPTIONS}
              onChange={(pointStyle) => change({ primitiveStyles: { points: { pointStyle } } })} />
            <SourceFields fields={[{
              setting: 'pointSize',
              label: 'Size',
              source: pointsBlock?.pointSizeSource ?? '',
              placeholder: DEFAULT_POINT_SIZE,
              error: sources.points.pointSize.error,
              onChange: (pointSizeSource) => change(
                { primitiveStyles: { points: { pointSizeSource } } }, 'points.pointSize'),
            }]} />
          </>}
          {connected && <SourceFields leading={
            <Segmented label="Connection style" value={pointsBlock?.strokeStyle ?? 'solid'} options={STROKE_OPTIONS}
              onChange={(strokeStyle) => change({ primitiveStyles: { points: { strokeStyle } } })} />
          } fields={[{
            setting: 'strokeWidth',
            label: 'Width',
            source: pointsBlock?.strokeWidthSource ?? '',
            placeholder: DEFAULT_STROKE_WIDTHS.connection,
            error: sources.points.strokeWidth.error,
            onChange: (strokeWidthSource) => change(
              { primitiveStyles: { points: { strokeWidthSource } } }, 'points.strokeWidth'),
          }]} />}
        </div>}
      </> : null,
        // Markers can be hidden only while the points are connected (#205).
        {
          label: 'Show point markers',
          checked: pointMarkersVisible || !connected,
          disabled: !connected,
          onChange: onPointMarkersVisibleChange,
        },
      )}
      {list && listPrimitives?.lines && onLinesVisibleChange && section('Lines',
        linesVisible && onAppearanceChange ? (
          <div className="appearance-sub">
            <h4>Style</h4>
            <SourceFields leading={
              <Segmented label="Line style" value={appearance.primitiveStyles?.lines?.strokeStyle ?? 'solid'}
                options={STROKE_OPTIONS}
                onChange={(strokeStyle) => change({ primitiveStyles: { lines: { strokeStyle } } })} />
            } fields={[{
              setting: 'strokeWidth',
              label: 'Width',
              source: appearance.primitiveStyles?.lines?.strokeWidthSource ?? '',
              placeholder: DEFAULT_STROKE_WIDTHS.line,
              error: sources.lines.strokeWidth.error,
              onChange: (strokeWidthSource) => change(
                { primitiveStyles: { lines: { strokeWidthSource } } }, 'lines.strokeWidth'),
            }]} />
            <div className="appearance-pair">
              <OrientationField checked={linesOrientationVisible}
                onChange={(orientationVisible) => change({ primitiveStyles: { lines: { orientationVisible } } })} />
            </div>
          </div>
        ) : null,
        { label: 'Show lines', checked: linesVisible, onChange: onLinesVisibleChange },
      )}
      {control && onControlChange && section('Animate', animated ? <>
        {reducedMotion && <p className="appearance-note">Motion starts only with Play.</p>}
        <Segmented label="Animation mode" value={control.animation?.mode ?? 'ping-pong'} options={[
          ['once', 'Once', PLAYBACK_ICONS.once],
          ['loop', 'Loop', PLAYBACK_ICONS.loop],
          ['ping-pong', 'Ping-pong', PLAYBACK_ICONS['ping-pong']],
        ]} onChange={(mode) => onControlChange({
          ...control,
          animation: { ...(control.animation ?? DEFAULT_ANIMATION), mode },
        })} />
        <SpeedField
          durationSeconds={(control.animation ?? DEFAULT_ANIMATION).durationSeconds}
          onChange={(durationSeconds) => onControlChange({
            ...control,
            animation: { ...(control.animation ?? DEFAULT_ANIMATION), durationSeconds },
          })}
        />
      </> : null, {
        label: 'Animate',
        checked: animated,
        // On: an animated slider. Off: a number field; the animation settings
        // are kept for the next time the scalar is animated.
        onChange: (checked) => onControlChange(checked
          ? { ...control, mode: 'slider', animation: control.animation ?? DEFAULT_ANIMATION }
          : { ...control, mode: 'number' }),
      })}
      {control && onSliderInCanvasChange && section('Canvas', null, {
        label: 'Slider on the canvas',
        checked: sliderInCanvas ?? false,
        onChange: onSliderInCanvasChange,
      })}
      {/* A list has no label. The text is edited under the expression (#226). */}
      {!colorOnly && !list && !folder && section('Label', labelsDisabled ? (
        <p className="appearance-note">Expression labels are off for the whole graph in Settings.</p>
      ) : labelVisible && onAppearanceChange ? <>
        <SourceFields fields={[{
          setting: 'labelAngle',
          label: 'Angle',
          source: appearance.labelAngleSource ?? '',
          placeholder: 0,
          error: sources.labelAngle.error,
          onChange: (labelAngleSource) => change({ labelAngleSource }, 'labelAngle'),
        }, {
          setting: 'labelSize',
          label: 'Size',
          source: appearance.labelSizeSource ?? '',
          placeholder: DEFAULT_LABEL_SIZE,
          error: sources.labelSize.error,
          onChange: (labelSizeSource) => change({ labelSizeSource }, 'labelSize'),
        }]} />
        <SourceFields className="appearance-pair-anchor" fields={[{
          setting: 'labelDistance',
          label: 'Distance',
          source: appearance.labelDistanceSource ?? '',
          placeholder: DEFAULT_LABEL_DISTANCE,
          error: sources.labelDistance.error,
          onChange: (labelDistanceSource) => change({ labelDistanceSource }, 'labelDistance'),
        }]} trailing={
          <AnchorGrid value={appearance.labelAnchor ?? 'auto'} onChange={(labelAnchor) => change({ labelAnchor })} />
        } />
        <label className="appearance-switch">
          <span>Only label</span>
          <input type="checkbox" role="switch" aria-label="Only label"
            title="Draw the label without its object, which can still be moved"
            checked={appearance.labelOnly ?? false}
            onChange={(event) => change({ labelOnly: event.target.checked })} />
        </label>
      </> : null, { label: 'Show label', checked: labelVisible, disabled: labelsDisabled, onChange: onLabelVisibleChange })}
    </div>,
    document.body,
  )
}

const DEFAULT_ANIMATION = { mode: 'ping-pong', direction: 'forward', durationSeconds: 2 } as const

/**
 * The speed of an animation, as a multiple of the default one, which crosses
 * the interval in 2 s. It is stored as the duration of one crossing.
 */
const speedOfDuration = (durationSeconds: number) => DEFAULT_ANIMATION.durationSeconds / durationSeconds
const durationOfSpeed = (speed: number) => DEFAULT_ANIMATION.durationSeconds / speed

function SpeedField({ durationSeconds, onChange }: Readonly<{
  durationSeconds: number
  onChange(durationSeconds: number): void
}>) {
  const id = useId()
  const shown = String(Number(speedOfDuration(durationSeconds).toPrecision(4)))
  // The text being typed; a value is stored only once it is a positive number.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? shown
  const speed = Number(text)
  const error = text.trim() === '' || !Number.isFinite(speed) || speed <= 0
    ? 'Enter a number greater than 0.'
    : null
  // The arrows halve and double the speed shown, and end any typing.
  const scaled = (factor: number) => {
    const base = error ? speedOfDuration(durationSeconds) : speed
    setDraft(null)
    onChange(durationOfSpeed(base * factor))
  }
  return <>
    <div className="appearance-pair">
      <div className="appearance-field appearance-speed">
        <span aria-hidden="true">Speed</span>
        <span className="appearance-speed-row">
          <button type="button" className="appearance-speed-step" aria-label="Halve speed" title="Half as fast"
            onClick={() => scaled(0.5)}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1.5 3 5l3.5 3.5" /></svg>
          </button>
          <span className={`appearance-source${error ? ' is-invalid' : ''}`}>
            <input
              type="text"
              inputMode="decimal"
              spellCheck={false}
              autoComplete="off"
              value={text}
              aria-label="Speed"
              title="1 crosses the interval in 2 s; 2 is twice as fast"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                const value = event.target.value
                setDraft(value)
                const next = Number(value)
                if (value.trim() !== '' && Number.isFinite(next) && next > 0) onChange(durationOfSpeed(next))
              }}
              onBlur={() => setDraft(null)}
            />
            <span className="appearance-unit appearance-speed-unit" aria-hidden="true">×</span>
          </span>
          <button type="button" className="appearance-speed-step" aria-label="Double speed" title="Twice as fast"
            onClick={() => scaled(2)}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 7 5 3.5 8.5" /></svg>
          </button>
        </span>
      </div>
    </div>
    {error && <p id={`${id}-error`} className="appearance-error">Speed: {error}</p>}
  </>
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A hue's swatch shows the selected shade, so the row previews the color a
 * click picks; the two lightest shades and neutral show shade 4 to stay legible.
 */
function hueSwatch(ramp: string, shade: number): string {
  const shown = ramp === 'neutral' || shade < 3 ? 4 : shade
  return paletteEntry(`${ramp}-${shown}`)?.hex ?? '#1482C8'
}

type SectionToggle = Readonly<{ label: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void }>

/** A titled section, folded by a chevron on its title, with an optional switch beside the title. */
function AppearanceSection({ title, open, onFold, toggle, children }: Readonly<{
  title: string
  open: boolean
  onFold(): void
  toggle?: SectionToggle
  children: ReactNode
}>) {
  const bodyId = useId()
  const hasBody = children !== null && children !== undefined && children !== false
  return (
    <section className="appearance-group">
      <h3>
        {hasBody ? (
          <button type="button" className="appearance-fold" aria-expanded={open} aria-controls={bodyId} onClick={onFold}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.75 5 6.25 7.5 3.75" /></svg>
            <span>{title}</span>
          </button>
        ) : <span className="appearance-group-title">{title}</span>}
        {toggle && (
          <input type="checkbox" role="switch" aria-label={toggle.label} checked={toggle.checked}
            disabled={toggle.disabled} onChange={(event) => toggle.onChange(event.target.checked)} />
        )}
      </h3>
      {hasBody && <div id={bodyId} className="appearance-group-body" hidden={!open}>{children}</div>}
    </section>
  )
}

/** An exclusive choice drawn as icon-only buttons, each named and with a tooltip. */
function Segmented<T extends string>({ label, value, options, onChange }: Readonly<{
  label: string
  value: T
  options: readonly (readonly [T, string, ReactNode, boolean?])[]
  onChange(value: T): void
}>) {
  return (
    <div className="appearance-segmented" role="group" aria-label={label}>
      {options.map(([option, name, icon, disabled]) => (
        <button key={option} type="button" aria-label={name} title={name}
          aria-pressed={value === option} disabled={disabled} onClick={() => onChange(option)}>
          <svg viewBox="0 0 28 20" aria-hidden="true">{icon}</svg>
        </button>
      ))}
    </div>
  )
}

type SourceFieldSpec = Readonly<{
  setting: AppearanceSetting
  label: string
  source: string
  /** The kind default, shown while the field is empty. */
  placeholder: number
  error: string | null
  onChange(source: string): void
}>

/**
 * Numeric settings typed as a number or a scalar expression: small boxes with
 * their caption above and their unit inside, after an optional choice on the
 * same row (`leading`), or in two equal columns. A refused value shows one
 * red line under the row; a valid one shows nothing.
 */
function SourceFields({ fields, leading, trailing, className }: Readonly<{
  fields: readonly SourceFieldSpec[]
  leading?: ReactNode
  /** A control in the column after the fields. */
  trailing?: ReactNode
  className?: string
}>) {
  const id = useId()
  const errors = fields.flatMap((field, index) => field.error
    ? [{ id: `${id}-error-${index}`, text: `${field.label}: ${field.error}` }]
    : [])
  return <>
    <div className={[leading ? 'appearance-row' : 'appearance-pair', className].filter(Boolean).join(' ')}>
      {leading}
      {fields.map((field, index) => {
        const { minimum, maximum, unit, open, periodic } = APPEARANCE_SETTING_RANGES[field.setting]
        return (
          <label key={field.setting} className={`appearance-field${leading ? ' is-narrow' : ''}`}>
            <span>{field.label}</span>
            <span className={`appearance-source${field.error ? ' is-invalid' : ''}`}>
              <input
                type="text"
                inputMode="decimal"
                spellCheck={false}
                autoComplete="off"
                value={field.source}
                placeholder={String(Number(field.placeholder.toFixed(2)))}
                title={periodic
                  ? `Any angle in ${unit}, or a scalar expression such as pi / 4; 2π apart, angles are the same`
                  : open
                    ? `Any number of ${unit} or scalar expression; below ${minimum} draws as ${minimum}`
                    : `${minimum} to ${maximum} ${unit}, or a scalar expression`}
                aria-invalid={field.error ? true : undefined}
                aria-describedby={field.error ? `${id}-error-${index}` : undefined}
                onChange={(event) => field.onChange(event.target.value)}
              />
              <span className="appearance-unit" aria-hidden="true">{unit}</span>
            </span>
          </label>
        )
      })}
      {trailing}
    </div>
    {errors.map((error) => <p key={error.id} id={error.id} className="appearance-error">{error.text}</p>)}
  </>
}

const ANCHOR_GRID: readonly LabelAnchor[] = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
]

/** The label's position around its anchor: eight places and the center, and Auto beside them. */
function AnchorGrid({ value, onChange }: Readonly<{ value: LabelAnchor; onChange(anchor: LabelAnchor): void }>) {
  return (
    <div className="appearance-anchor" role="group" aria-label="Label position">
      <div className="appearance-anchor-grid">
        {ANCHOR_GRID.map((anchor) => {
          const name = capitalized(anchor.replace('-', ' '))
          return <button key={anchor} type="button" aria-label={name} title={name}
            aria-pressed={value === anchor} onClick={() => onChange(anchor)} />
        })}
      </div>
      <button type="button" className="appearance-anchor-auto" aria-label="Automatic position"
        title="Auto: first position without collision"
        aria-pressed={value === 'auto'} onClick={() => onChange('auto')}>Auto</button>
    </div>
  )
}

/** A switch laid out like a field: small caption above, switch below. */
function OrientationField({ checked, onChange }: Readonly<{ checked: boolean; onChange(checked: boolean): void }>) {
  return (
    <label className="appearance-field appearance-field-toggle">
      <span>Orientation</span>
      <input type="checkbox" role="switch" aria-label="Orientation visible" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

/**
 * A point style's icon, from the mock-up: the outer shape at 20 % opacity and
 * the core, which grows into it while the button is hovered.
 */
function pointIcon(pointStyle: PointStyle): ReactNode {
  const core = pointStyle === 'diamond' || pointStyle === 'plus' ? 3.1 : 3.6
  return <>
    <PointShape pointStyle={pointStyle} x={14} y={10} radius={core * POINT_OUTER_SCALE}
      fill="currentColor" stroke="none" opacity={0.2} />
    <g className="point-icon-core">
      <PointShape pointStyle={pointStyle} x={14} y={10} radius={core} fill="currentColor" stroke="none" />
    </g>
  </>
}

const POINT_OPTIONS: readonly (readonly [PointStyle, string, ReactNode])[] = (
  [['dot', 'Dot'], ['ring', 'Ring'], ['cross', 'Cross'], ['plus', 'Plus'], ['square', 'Square'], ['diamond', 'Diamond']] as const
).map(([pointStyle, name]) => [pointStyle, name, pointIcon(pointStyle)] as const)

// Icons drawn in a 28 × 20 box, copied from the validated mock-up (#216).
const STROKE_OPTIONS: readonly (readonly [StrokeStyle, string, ReactNode])[] = [
  ['solid', 'Solid', <path key="solid" d="M3 10 H25" fill="none" strokeWidth="2.2" />],
  ['dashed', 'Dashed', <path key="dashed" d="M3 10 H25" fill="none" strokeWidth="2.2" strokeDasharray="4 3" />],
  ['dotted', 'Dotted', <path key="dotted" d="M4 10 H25" fill="none" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="0 4.2" />],
]

const SHAPE_ICONS = {
  'from-vectors': <polygon points="3,17 9,3 25,3 19,17" />,
  disk: <circle cx="14" cy="10" r="7.5" />,
  square: <rect x="7" y="2.5" width="14" height="14" />,
}

// One origin (5, 16) and one direction (38° up) shared by the three icons.
const IDEAL_ICONS = {
  vector: <>
    <circle cx="5" cy="16" r="1.6" fill="currentColor" stroke="none" />
    <path d="M5 16 L12.5 10.2" fill="none" />
    <polygon points="16.03,7.38 14.09,12.2 10.89,8.1" fill="currentColor" />
  </>,
  ideal: <>
    <circle cx="5" cy="16" r="1.4" fill="currentColor" stroke="none" opacity=".45" />
    <path d="M9.14 0.55 A16 16 0 0 1 20.76 13.22" fill="none" strokeDasharray="2.2 2" />
    <circle cx="17.61" cy="6.15" r="2.5" fill="currentColor" stroke="none" />
  </>,
  both: <>
    <circle cx="5" cy="16" r="1.6" fill="currentColor" stroke="none" />
    <path d="M9.14 0.55 A16 16 0 0 1 20.76 13.22" fill="none" strokeDasharray="2.2 2" />
    <path d="M5 16 L10.5 11.7" fill="none" />
    <polygon points="13.6,9.3 11.9,13.1 9.4,9.9" fill="currentColor" />
    <circle cx="17.61" cy="6.15" r="2.5" fill="currentColor" stroke="none" />
  </>,
}

const CONNECTION_ICONS = {
  none: <><circle cx="6" cy="14" r="2.3" /><circle cx="14" cy="5" r="2.3" /><circle cx="22" cy="14" r="2.3" /></>,
  'open-polyline': <>
    <path d="M6 14 L14 5 L22 14" fill="none" />
    <circle cx="6" cy="14" r="2.3" /><circle cx="14" cy="5" r="2.3" /><circle cx="22" cy="14" r="2.3" />
  </>,
  'closed-loop': <>
    <path d="M6 14 L14 5 L22 14 Z" />
    <circle cx="6" cy="14" r="2.3" /><circle cx="14" cy="5" r="2.3" /><circle cx="22" cy="14" r="2.3" />
  </>,
}

const PLAYBACK_ICONS = {
  once: <><path d="M4 10 H20" fill="none" /><path d="M16 6 L20 10 L16 14" fill="none" /><path d="M24 4 V16" fill="none" /></>,
  loop: <><path d="M20 6 A7 6 0 1 0 21 13" fill="none" /><path d="M17 3 L21 6.5 L17 9" fill="none" /></>,
  'ping-pong': <>
    <path d="M5 7 H22" fill="none" /><path d="M18 3.5 L22 7 L18 10.5" fill="none" />
    <path d="M23 13 H6" fill="none" /><path d="M10 9.5 L6 13 L10 16.5" fill="none" />
  </>,
}
