import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { paletteEntry, RAMP_ORDER, STUDIO_COLORS } from './appearancePalette'
import { popoverPosition } from './popoverPosition'
import type { ExpressionControl, PointListDisplay } from '../document/expressionDocument'

const POPOVER_WIDTH = 272
/** Height assumed before the menu is measured, and where layout is unavailable. */
const ESTIMATED_POPOVER_HEIGHT = 300

type AppearancePopoverProps = Readonly<{
  kind: string
  styleId: string
  visible: boolean
  labelVisible: boolean
  label: string
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
  colorOnly?: boolean
  control?: ExpressionControl
  reducedMotion?: boolean
  anchorRef: RefObject<HTMLButtonElement | null>
  onStyleChange(style: string): void
  onVisibleChange(visible: boolean): void
  onLabelVisibleChange(visible: boolean): void
  onLabelChange(label: string): void
  onBorderVisibleChange?(visible: boolean): void
  onOrientationVisibleChange?(visible: boolean): void
  onBivectorShapeChange?(shape: 'from-vectors' | 'disk' | 'square'): void
  onIdealPointDisplayChange?(display: 'vector' | 'ideal' | 'both'): void
  onPointListDisplayChange?(display: PointListDisplay): void
  onPointMarkersVisibleChange?(visible: boolean): void
  onLinesVisibleChange?(visible: boolean): void
  onControlChange?(control: ExpressionControl): void
  onClose(): void
}>

export function AppearancePopover({
  kind,
  styleId,
  visible,
  labelVisible,
  label,
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
  colorOnly = false,
  control,
  reducedMotion = false,
  anchorRef,
  onStyleChange,
  onVisibleChange,
  onLabelVisibleChange,
  onLabelChange,
  onBorderVisibleChange,
  onOrientationVisibleChange,
  onBivectorShapeChange,
  onIdealPointDisplayChange,
  onPointListDisplayChange,
  onPointMarkersVisibleChange,
  onLinesVisibleChange,
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
    const returnFocusTarget = anchorRef.current
    ;(visibilityRef.current ?? closeRef.current)?.focus()
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return
      if (returnFocusTarget?.contains(event.target as Node)) return
      onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      returnFocusTarget?.focus()
    }
  }, [anchorRef, onClose])

  const title = kind.startsWith('List') ? 'List' : kind
  const list = kind.startsWith('List')
  const selected = paletteEntry(styleId) ?? paletteEntry('blue-4')!
  const shade = Number(selected.id.slice(selected.ramp.length + 1))
  const animated = control?.mode === 'slider' && control.animation !== null
  const connected = pointListDisplayAvailable && pointListDisplay !== 'none'
  const styleContent = kind === 'Bivector' ? (
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
      {onOrientationVisibleChange && <OrientationField checked={orientationVisible} onChange={onOrientationVisibleChange} />}
    </>
  ) : kind === 'Line' && onOrientationVisibleChange ? (
    <OrientationField checked={orientationVisible} onChange={onOrientationVisibleChange} />
  ) : kind === 'Ideal point' && onIdealPointDisplayChange ? (
    <Segmented label="Ideal point display" value={idealPointDisplay} onChange={onIdealPointDisplayChange} options={[
      ['vector', 'As a vector', IDEAL_ICONS.vector],
      ['ideal', 'At infinity', IDEAL_ICONS.ideal],
      ['both', 'Both', IDEAL_ICONS.both],
    ]} />
  ) : null

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
        {!colorOnly && (
          // The same setting as the eye of the expression row.
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
          </button>
        )}
        <button ref={closeRef} type="button" className="appearance-close" onClick={onClose}
          aria-label={`Close ${title} menu`} title="Close">×</button>
      </header>
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
      </>)}
      {styleContent && section('Style', styleContent)}
      {list && listPrimitives?.points && onPointMarkersVisibleChange && section('Points',
        pointListDisplayAvailable && onPointListDisplayChange
          ? <Segmented label="Point list display" value={pointListDisplay} onChange={onPointListDisplayChange} options={[
              ['none', 'No connection', CONNECTION_ICONS.none],
              ['open-polyline', 'Open polyline', CONNECTION_ICONS['open-polyline']],
              ['closed-loop', 'Closed loop', CONNECTION_ICONS['closed-loop']],
            ]} />
          : null,
        // Markers can be hidden only while the points are connected (#205).
        {
          label: 'Show point markers',
          checked: pointMarkersVisible || !connected,
          disabled: !connected,
          onChange: onPointMarkersVisibleChange,
        },
      )}
      {list && listPrimitives?.lines && onLinesVisibleChange && section('Lines', null,
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
      </> : null, {
        label: 'Animate',
        checked: animated,
        // On: an animated slider. Off: a number field; the animation settings
        // are kept for the next time the scalar is animated.
        onChange: (checked) => onControlChange(checked
          ? { ...control, mode: 'slider', animation: control.animation ?? DEFAULT_ANIMATION }
          : { ...control, mode: 'number' }),
      })}
      {!colorOnly && section('Label', labelVisible ? (
        <label className="appearance-field">
          <span>Text</span>
          <input value={label} onChange={(event) => onLabelChange(event.target.value)} />
        </label>
      ) : null, { label: 'Show label', checked: labelVisible, onChange: onLabelVisibleChange })}
    </div>,
    document.body,
  )
}

const DEFAULT_ANIMATION = { mode: 'ping-pong', direction: 'forward', durationSeconds: 2 } as const

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

/** A switch laid out like a field: small caption above, switch below. */
function OrientationField({ checked, onChange }: Readonly<{ checked: boolean; onChange(checked: boolean): void }>) {
  return (
    <label className="appearance-field appearance-field-toggle">
      <span>Orientation</span>
      <input type="checkbox" role="switch" aria-label="Orientation visible" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

// Icons drawn in a 28 × 20 box, copied from the validated mock-up (#216).
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
