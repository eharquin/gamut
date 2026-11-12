import type { CSSProperties } from 'react'
import type { ScalarControlEvaluation } from '../application/evaluateScalarControl'
import { snapToControlBounds } from '../application/scalarPlayback'
import { DEFAULT_SCALAR_ANIMATION, type ScalarPlayback } from '../hooks/useScalarPlayback'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type { ExpressionControl, ExpressionItem } from '../document/expressionDocument'
import { declaredName } from '../language/declaredName'
import type { directScalarEdit } from '../language/directScalarEdit'
import { formatDisplayNumber } from '../presentation/formatNumber'

type ScalarSliderControlProps = Readonly<{
  item: ExpressionItem
  position: number
  objectName: string
  color: string
  /** The declared numeric literal the slider writes, null when there is none. */
  scalarEdit: ReturnType<typeof directScalarEdit>
  /** The row's slider control, stored or default. */
  control: ExpressionControl
  controlEvaluation: ScalarControlEvaluation
  isPlaying: boolean
  playback: Pick<ScalarPlayback, 'start' | 'stop' | 'forgetPaused'>
  decimalPlaces: number
  objectRenderScale: number
  executeCommand(command: DocumentCommand, coalesceKey?: string): void
  dispatchHistory(action: HistoryAction): void
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
  objectRenderScale,
  executeCommand,
  dispatchHistory,
}: ScalarSliderControlProps) {
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
      <div className="scalar-slider-row">
        {/* Play and pause sit at the start of the slider they drive. */}
      <button
        type="button"
        className={`scalar-play-button${isPlaying ? ' is-playing' : ''}`}
        style={{ '--slider-color': color } as CSSProperties}
        aria-label={isPlaying ? 'Pause scalar animation' : 'Play scalar animation'}
        disabled={!scalarEdit || !playbackParameters}
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
        <span>{controlEvaluation.minimum == null
          ? '—'
          : displayedNumber(controlEvaluation.minimum)}</span>
        <input
          type="range"
          aria-label={`Value for ${declaredName(item.source) ?? `Scalar ${position}`}`}
          min={controlEvaluation.minimum ?? 0}
          max={controlEvaluation.maximum ?? 1}
          step={controlEvaluation.step ?? 1}
          value={scalarEdit?.value ?? 0}
          disabled={controlEvaluation.status === 'invalid' || !scalarEdit ||
            scalarEdit.value < controlEvaluation.minimum! ||
            scalarEdit.value > controlEvaluation.maximum!}
          style={{
            '--slider-color': color,
            '--slider-scale': objectRenderScale,
          } as CSSProperties}
          onPointerDown={() => dispatchHistory({ type: 'begin-transaction' })}
          onPointerUp={() => dispatchHistory({ type: 'commit-transaction' })}
          onPointerCancel={() => dispatchHistory({ type: 'cancel-transaction' })}
          onBlur={() => dispatchHistory({ type: 'boundary' })}
          onChange={(event) => {
            playback.forgetPaused(item.id)
            executeCommand({
              kind: 'set-scalar-value', itemId: item.id,
              value: snapToControlBounds(
                Number(event.target.value),
                controlEvaluation.minimum ?? 0,
                controlEvaluation.maximum ?? 1,
                controlEvaluation.step ?? 1,
              ),
            }, `scalar-control:${item.id}`)
          }}
        />
        <span>{controlEvaluation.maximum == null
          ? '—'
          : displayedNumber(controlEvaluation.maximum)}</span>
        {scalarEdit && controlEvaluation.status === 'valid' &&
          (scalarEdit.value < controlEvaluation.minimum! ||
            scalarEdit.value > controlEvaluation.maximum!) &&
          <small role="status">Value is outside the configured interval.</small>}
      </div>

      <div
        className="scalar-interval-row"
        role="group"
        aria-label={`Interval of ${declaredName(item.source) ?? objectName}`}
      >
        {(() => {
          const intervalField = (
            property: 'minimumSource' | 'maximumSource' | 'stepSource',
            label: string,
          ) => (
            <input
              value={effectiveControl[property]}
              aria-label={label}
              aria-invalid={controlEvaluation.fields[
                property === 'minimumSource' ? 'minimum' :
                  property === 'maximumSource' ? 'maximum' : 'step'
              ].status === 'invalid'}
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
    </>
  )
}
