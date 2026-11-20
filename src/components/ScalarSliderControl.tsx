import { useRef, type CSSProperties, type ReactNode } from 'react'
import type { ScalarControlEvaluation } from '../application/evaluateScalarControl'
import { snapToControlBounds } from '../application/scalarPlayback'
import { DEFAULT_SCALAR_ANIMATION, type ScalarPlayback } from '../hooks/useScalarPlayback'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type { ExpressionControl, ExpressionItem } from '../document/expressionDocument'
import { declaredName } from '../language/declaredName'
import type { DirectScalarEdit } from '../language/directScalarEdit'
import { formatDisplayNumber } from '../presentation/formatNumber'

type ScalarSliderControlProps = Readonly<{
  item: ExpressionItem
  position: number
  objectName: string
  color: string
  /** The declared numeric literal the slider writes, null when there is none. */
  scalarEdit: DirectScalarEdit | null
  /** The row's slider control, stored or default. */
  control: ExpressionControl
  controlEvaluation: ScalarControlEvaluation
  isPlaying: boolean
  playback: Pick<ScalarPlayback, 'start' | 'stop' | 'forgetPaused'>
  decimalPlaces: number
  executeCommand(command: DocumentCommand, coalesceKey?: string): void
  dispatchHistory(action: HistoryAction): void
  /** The row's kind and value, shown above the slider line. */
  children?: ReactNode
  /**
   * Where the slider is drawn. On the canvas it has no interval, which is
   * edited in the row, and its controls are named after the scalar.
   */
  placement?: 'row' | 'canvas'
}>

/**
 * The slider of a scalar row: play and pause, the bounds and the range input,
 * then the editable interval and its diagnostic.
 */
export function ScalarSliderControl({
  item,
  position,
  objectName,
  color,
  scalarEdit,
  control: effectiveControl,
  controlEvaluation,
  isPlaying,
  playback,
  decimalPlaces,
  executeCommand,
  dispatchHistory,
  children,
  placement = 'row',
}: ScalarSliderControlProps) {
  const inCanvas = placement === 'canvas'
  const scalarName = declaredName(item.source) ?? `Scalar ${position}`
  // Bounds derived from the value would move under the pointer: a drag keeps
  // the interval it started with.
  const heldBounds = useRef<Pick<ScalarControlEvaluation, 'minimum' | 'maximum' | 'step'> | null>(null)
  const derived = Object.values(controlEvaluation.fields)
    .some((field) => field.status === 'valid' && field.derived)
  // A playback keeps the derived interval it started with, as the playback itself does.
  const playedBounds = useRef<Pick<ScalarControlEvaluation, 'minimum' | 'maximum' | 'step'> | null>(null)
  if (!isPlaying || !derived) playedBounds.current = null
  else playedBounds.current ??= {
    minimum: controlEvaluation.minimum, maximum: controlEvaluation.maximum, step: controlEvaluation.step,
  }
  const bounds = heldBounds.current ?? playedBounds.current ?? controlEvaluation
  const playbackParameters = effectiveControl.mode === 'slider' &&
    controlEvaluation.status === 'valid'
    ? {
        minimum: controlEvaluation.minimum!,
        maximum: controlEvaluation.maximum!,
        step: controlEvaluation.step!,
        animation: effectiveControl.animation ?? DEFAULT_SCALAR_ANIMATION,
      }
    : null
  const displayedNumber = (value: number) => formatDisplayNumber(value, decimalPlaces)

  return (
    <>
      {children}

      <div className="scalar-slider-row">
        {/* Play and pause sit at the start of the slider they drive. */}
      <button
        type="button"
        className={`scalar-play-button${isPlaying ? ' is-playing' : ''}`}
        style={{ '--slider-color': color } as CSSProperties}
        aria-label={inCanvas
          ? `${isPlaying ? 'Pause' : 'Play'} ${scalarName} on the canvas`
          : isPlaying ? 'Pause scalar animation' : 'Play scalar animation'}
        disabled={!scalarEdit || !playbackParameters}
        // A click plays without focusing the row, which would open its
        // interval; the keyboard still reaches the button with Tab.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => isPlaying
          ? playback.stop(item.id)
          : playback.start(item, playbackParameters!, scalarEdit!.value)}
      >{isPlaying
        ? <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1" width="2.5" height="8" />
            <rect x="6" y="1" width="2.5" height="8" />
          </svg>
        : <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 1.2 8.5 5 2.5 8.8z" />
          </svg>}</button>
        <span title={bounds.minimum == null ? undefined : displayedNumber(bounds.minimum)}>{bounds.minimum == null
          ? '—'
          : displayedNumber(bounds.minimum)}</span>
        <input
          type="range"
          aria-label={inCanvas ? `Canvas slider for ${scalarName}` : `Value for ${scalarName}`}
          min={bounds.minimum ?? 0}
          max={bounds.maximum ?? 1}
          step={bounds.step ?? 1}
          value={scalarEdit?.value ?? 0}
          disabled={controlEvaluation.status === 'invalid' || !scalarEdit ||
            scalarEdit.value < bounds.minimum! ||
            scalarEdit.value > bounds.maximum!}
          style={{
            '--slider-color': color,
          } as CSSProperties}
          onPointerDown={(event) => {
            // Played with the pointer, the slider does not focus its row: the
            // row keeps its look and its interval stays hidden (see App.css).
            event.currentTarget.dataset.pointerFocus = ''
            if (derived) heldBounds.current = {
              minimum: controlEvaluation.minimum,
              maximum: controlEvaluation.maximum,
              step: controlEvaluation.step,
            }
            dispatchHistory({ type: 'begin-transaction' })
          }}
          onPointerUp={() => {
            heldBounds.current = null
            dispatchHistory({ type: 'commit-transaction' })
          }}
          onPointerCancel={() => {
            heldBounds.current = null
            dispatchHistory({ type: 'cancel-transaction' })
          }}
          onBlur={(event) => {
            delete event.currentTarget.dataset.pointerFocus
            dispatchHistory({ type: 'boundary' })
          }}
          onChange={(event) => {
            playback.forgetPaused(item.id)
            executeCommand({
              kind: 'set-scalar-value', itemId: item.id,
              value: snapToControlBounds(
                Number(event.target.value),
                bounds.minimum ?? 0,
                bounds.maximum ?? 1,
                bounds.step ?? 1,
              ),
            }, `scalar-control:${item.id}`)
          }}
        />
        <span title={bounds.maximum == null ? undefined : displayedNumber(bounds.maximum)}>{bounds.maximum == null
          ? '—'
          : displayedNumber(bounds.maximum)}</span>
        {scalarEdit && controlEvaluation.status === 'valid' &&
          (scalarEdit.value < bounds.minimum! ||
            scalarEdit.value > bounds.maximum!) &&
          <small role="status">Value is outside the configured interval.</small>}
      </div>

      {!inCanvas && <>
      <div
        className="scalar-interval-row"
        role="group"
        aria-label={`Interval of ${declaredName(item.source) ?? objectName}`}
      >
        {(() => {
          const fieldOf = (property: 'minimumSource' | 'maximumSource' | 'stepSource') =>
            property === 'minimumSource' ? 'minimum' as const
              : property === 'maximumSource' ? 'maximum' as const : 'step' as const
          const intervalField = (
            property: 'minimumSource' | 'maximumSource' | 'stepSource',
            label: string,
          ) => (
            <input
              value={effectiveControl[property]}
              // An empty field shows the value derived from the scalar.
              placeholder={(() => {
                const field = controlEvaluation.fields[fieldOf(property)]
                return field.status === 'valid' && field.derived ? displayedNumber(field.value) : undefined
              })()}
              aria-label={label}
              aria-invalid={controlEvaluation.fields[fieldOf(property)].status === 'invalid'}
              onBlur={() => dispatchHistory({ type: 'boundary' })}
              onChange={(event) => {
                if (isPlaying) playback.stop(item.id)
                playback.forgetPaused(item.id)
                executeCommand({
                  kind: 'update-control', itemId: item.id,
                  control: { ...effectiveControl, [property]: event.target.value },
                }, `control-${property}:${item.id}`)
              }}
            />
          )
          return (
            <>
              {intervalField('minimumSource', 'Minimum source')}
              <span className="scalar-interval-relation" aria-hidden="true">
                ≤ <span className="scalar-interval-name">
                  {declaredName(item.source) ?? objectName}
                </span> ≤
              </span>
              {intervalField('maximumSource', 'Maximum source')}
              <span className="scalar-interval-step">
                <span className="scalar-interval-label" aria-hidden="true">step</span>
                {intervalField('stepSource', 'Step source')}
              </span>
            </>
          )
        })()}
      </div>
      {controlEvaluation.status === 'invalid' && (
        <div className="scalar-interval-diagnostic" role="alert">
          {Object.values(controlEvaluation.fields).find(
            (field) => field.status === 'invalid',
          )?.status === 'invalid'
            ? Object.values(controlEvaluation.fields).find(
                (field) => field.status === 'invalid',
              )!.diagnostic.message
            : controlEvaluation.diagnostic}
        </div>
      )}
      </>}
    </>
  )
}
