import type { KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { AlgebraEngine } from '../algebra/algebraEngine'
import type { ItemAppearanceSources } from '../application/evaluateAppearanceSources'
import type { EvaluatedDocumentItem } from '../application/evaluateDocument'
import { evaluateScalarControl, type ScalarControlEvaluation } from '../application/evaluateScalarControl'
import { hasIdealNorm, isUnitNorm, measuredNorm, normalizeItemValue } from '../application/normalization'
import { DEFAULT_SCALAR_ANIMATION, type ScalarPlayback } from '../application/useScalarPlayback'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type {
  ExpressionAppearance,
  ExpressionControl,
  ExpressionDocument,
  ExpressionItem,
} from '../document/expressionDocument'
import type { AnyInterpretation } from '../geometry/interpretation'
import { declaredName } from '../language/declaredName'
import { directScalarEdit } from '../language/directScalarEdit'
import {
  formatDisplayMultivector,
  formatDisplayNumber,
  formatDisplayValue,
} from '../presentation/formatNumber'
import { listPrimitiveTypes, pointListVertices } from '../visualization/layout'
import { AppearancePopover } from './AppearancePopover'
import { resolveItemAppearance } from './appearancePalette'
import { NormalizationPopover } from './NormalizationPopover'
import { ScalarSliderControl } from './ScalarSliderControl'

/** The row's normalization modes, by stored value; off is no mode (#185). */
const NORMALIZATION_TEXT = { off: 'off', natural: 'auto', euclidean: 'norm', ideal: 'inorm' } as const
const NORM_NAME = { euclidean: 'the Euclidean norm', ideal: 'the ideal norm' } as const
const DEFAULT_SCALAR_CONTROL: ExpressionControl = {
  mode: 'slider',
  minimumSource: '-10',
  maximumSource: '10',
  stepSource: '0.1',
  animation: DEFAULT_SCALAR_ANIMATION,
}

/** The element registries and popover anchors that rows share with the panel. */
export type ExpressionRowRefs = Readonly<{
  /** Each row's article, for reordering and focus restoration. */
  expressionRowRefs: RefObject<Map<string, HTMLElement>>
  /** Each row's source editor, focused after creation, deletion, undo and redo. */
  inputRefs: RefObject<Map<string, HTMLInputElement>>
  /** Each row's norm button; a choice whose button is gone is closed. */
  normalizationToggleRefs: RefObject<Map<string, HTMLButtonElement>>
  /** The swatch that opened the appearance menu. */
  appearanceAnchorRef: RefObject<HTMLButtonElement | null>
  /** The norm button that opened the normalization choice. */
  normalizationAnchorRef: RefObject<HTMLButtonElement | null>
}>

/** What a row asks of the document session and of the panel around it. */
export type ExpressionRowActions = Readonly<{
  executeCommand(command: DocumentCommand, coalesceKey?: string): void
  dispatchHistory(action: HistoryAction): void
  /** Records the editor and selection that undo and redo return to. */
  rememberEditorFocus(element: HTMLInputElement): void
  /** Keyboard handling of the source editor: insertion, deletion, navigation. */
  handleItemKeyDown(event: KeyboardEvent<HTMLInputElement>, item: ExpressionItem, index: number): void
  insertExpression(anchorId: string, placement: 'before' | 'after'): void
  removeExpression(itemId: string): void
  beginRowReorder(event: ReactPointerEvent<HTMLButtonElement>, itemId: string): void
  reorderRowWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, itemId: string): void
  /** Focus entering or leaving the row. */
  focusRow(itemId: string): void
  blurRow(itemId: string): void
  /** The pointer entering or leaving the row. */
  hoverRow(itemId: string): void
  leaveRow(itemId: string): void
  toggleAppearance(itemId: string): void
  closeAppearance(): void
  toggleNormalizationChoice(itemId: string): void
  closeNormalizationChoice(): void
  toggleListExpanded(itemId: string): void
}>

type ExpressionRowProps = Readonly<{
  entry: EvaluatedDocumentItem
  index: number
  /** Every evaluated item, which the bounds of a scalar control may reference. */
  evaluatedItems: readonly EvaluatedDocumentItem[]
  /** The evaluation of the item's stored control, absent when it has none. */
  scalarControlEvaluation: ScalarControlEvaluation | undefined
  appearance: ExpressionAppearance | undefined
  appearanceSources: ItemAppearanceSources
  engine: AlgebraEngine
  interpretation: AnyInterpretation
  display: ExpressionDocument['view']['display']
  objectRenderScale: number
  /** The document has no visualizer: appearance is kept but dormant. */
  noViz: boolean
  reducedMotion: boolean
  dropBefore: boolean
  dropAfter: boolean
  listExpanded: boolean
  appearanceOpen: boolean
  /** This row's normalization choice is the open one. */
  normalizationChoiceActive: boolean
  playback: ScalarPlayback
  refs: ExpressionRowRefs
  actions: ExpressionRowActions
}>

/**
 * One row of the expression panel: the source editor with its visibility,
 * appearance and normalization controls, the value or diagnostics, the scalar
 * slider with playback and interval, the list inspection, and the position.
 */
export function ExpressionRow({
  entry: { item, position, evaluation, positionEvaluation },
  index,
  evaluatedItems,
  scalarControlEvaluation,
  appearance,
  appearanceSources,
  engine,
  interpretation,
  display,
  objectRenderScale,
  noViz,
  reducedMotion,
  dropBefore,
  dropAfter,
  listExpanded,
  appearanceOpen,
  normalizationChoiceActive,
  playback,
  refs: {
    expressionRowRefs,
    inputRefs,
    normalizationToggleRefs,
    appearanceAnchorRef,
    normalizationAnchorRef,
  },
  actions: {
    executeCommand,
    dispatchHistory,
    rememberEditorFocus,
    handleItemKeyDown,
    insertExpression,
    removeExpression,
    beginRowReorder,
    reorderRowWithKeyboard,
    focusRow,
    blurRow,
    hoverRow,
    leaveRow,
    toggleAppearance,
    closeAppearance,
    toggleNormalizationChoice,
    closeNormalizationChoice,
    toggleListExpanded,
  },
}: ExpressionRowProps) {
  const annotation = item.kind === 'annotation'
  const feedbackId = `expression-feedback-${item.id}`
  const inputId = `expression-source-${item.id}`
  const invalid = evaluation?.status === 'invalid'
  const invalidPosition =
    positionEvaluation?.status === 'invalid'
  const supportsPosition =
    evaluation?.status === 'valid' &&
    evaluation.valueType === 'single' &&
    interpretation.supportsPosition(evaluation.entity)
  const supportsNormalization =
    evaluation?.status === 'valid' &&
    evaluation.valueType === 'single' &&
    evaluation.entity.kind !== 'scalar'
  const normalizationUnavailable =
    supportsNormalization &&
    item.normalization !== undefined &&
    normalizeItemValue(item.normalization, evaluation.value, engine, interpretation).status === 'unavailable'
  // The badge follows the norm the mode applies (#185).
  const unitNorm = supportsNormalization
    ? measuredNorm(item.normalization, evaluation.value, engine, interpretation)
    : null
  const hasUnitNorm =
    supportsNormalization &&
    isUnitNorm(item.normalization, evaluation.value, engine, interpretation)
  // VGA has one norm: a forced mode from an imported document reads as auto.
  const normalizationMode = item.normalization && !hasIdealNorm(engine) ? 'natural' : item.normalization
  const normalizationText = NORMALIZATION_TEXT[normalizationMode ?? 'off']
  const normalizationChoiceOpen = supportsNormalization && normalizationChoiceActive
  const normalizationOptions = (hasIdealNorm(engine)
    ? ['off', 'natural', 'euclidean', 'ideal'] as const
    : ['off', 'natural'] as const)
  const kind = evaluation?.status === 'valid'
    ? evaluation.valueType === 'list'
      ? `List (${evaluation.value.elements.length})`
      : interpretation.describe(evaluation.entity)
    : 'Object'
  const drawable = evaluation?.status === 'valid' &&
    (evaluation.valueType === 'list'
      ? evaluation.elements.some((element) => element.primitive)
      : evaluation.primitive !== null)
  const {
    visible,
    styleId,
    color,
    labelVisible,
    label,
    displayLabel,
  } = resolveItemAppearance(
    appearance,
    kind,
    declaredName(item.source),
  )
  const objectName = displayLabel ?? kind
  const labelFieldShown = drawable && labelVisible && evaluation?.status === 'valid' &&
    evaluation.valueType !== 'list'
  const valid = evaluation?.status === 'valid'
  const approximated = valid && evaluation.valueType === 'single' &&
    evaluation.entity.kind !== 'mixed-multivector' &&
    evaluation.entity.approximated
  const scalar = valid && evaluation.valueType === 'single' &&
    evaluation.entity.kind === 'scalar'
  const scalarEdit = scalar ? directScalarEdit(item.source) : null
  // A control only acts on a declared numeric literal. On a computed
  // scalar the stored control stays dormant in the document and
  // returns with the literal.
  const effectiveControl = scalarEdit
    ? item.control ?? DEFAULT_SCALAR_CONTROL
    : undefined
  const controlEvaluation = effectiveControl
    ? scalarControlEvaluation ?? evaluateScalarControl(
        effectiveControl, evaluatedItems, engine,
      )
    : null
  const scalarControlAvailable = effectiveControl !== undefined
  const isPlaying = playback.isPlaying(item.id)
  const empty = item.source.trim() === ''
  const listDetailsId = `list-details-${item.id}`

  return (
    <article
      ref={(element) => {
        if (element) expressionRowRefs.current.set(item.id, element)
        else expressionRowRefs.current.delete(item.id)
      }}
      onFocus={() => focusRow(item.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          blurRow(item.id)
      }}
      onPointerEnter={() => hoverRow(item.id)}
      onPointerLeave={() => leaveRow(item.id)}
      className={`expression-item${visible || noViz ? '' : ' is-hidden'}${
        empty ? ' is-empty-expression' : ''
      }${dropBefore ? ' drop-before' : ''}${dropAfter ? ' drop-after' : ''} ${
        invalid || invalidPosition ? 'has-error' : ''
      }`}
    >
      <button
        type="button"
        className="reorder-handle"
        aria-label={`Reorder ${objectName}. Alt plus arrow keys to move.`}
        onPointerDown={(event) => beginRowReorder(event, item.id)}
        onKeyDown={(event) => reorderRowWithKeyboard(event, item.id)}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <div className="expression-input-row">
        <div className="expression-actions">
          {drawable && valid && !noViz && (
              <button
                type="button"
                className="visibility-toggle"
                aria-label={`${visible ? 'Hide' : 'Show'} ${objectName}`}
                aria-pressed={visible}
                onClick={() => executeCommand({
                  kind: 'update-appearance', itemId: item.id,
                  appearance: { visible: !visible },
                })}
              >
                <svg className="visibility-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
                  <circle cx="8" cy="8" r="2" />
                  {!visible && <path className="visibility-icon-slash" d="M2.5 13.5 13.5 2.5" />}
                </svg>
              </button>
          )}
          {valid && (!drawable || noViz) && (
            <span className="expression-action-spacer" aria-hidden="true" />
          )}
          {valid && noViz ? (
              // Appearance is kept in the document but dormant
              // without a canvas: the swatch only shows the color.
              <span className="appearance-swatch is-dormant" aria-hidden="true">
                <span className="appearance-swatch-fill" style={{ backgroundColor: color }} />
              </span>
          ) : valid ? (
              <button
                type="button"
                className="appearance-swatch"
                aria-label={`Open ${kind} menu for ${objectName}`}
                aria-haspopup="dialog"
                aria-expanded={appearanceOpen}
                onClick={(event) => {
                  event.stopPropagation()
                  appearanceAnchorRef.current = event.currentTarget
                  toggleAppearance(item.id)
                }}
              >
                <span
                  className="appearance-swatch-fill"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
              </button>
          ) : (
            <span
              className={`expression-status-pastille${empty ? ' is-empty' : ' is-error'}`}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="expression-body">
          <div className="expression-editor-row">
            <input
              ref={(element) => {
                if (element) inputRefs.current.set(item.id, element)
                else inputRefs.current.delete(item.id)
              }}
              id={inputId}
              className="expression-source"
              aria-label={`${annotation ? 'Annotation' : 'Expression'} ${position}`}
              value={item.source}
              onChange={(event) => {
                if (isPlaying) playback.stop(item.id)
                playback.forgetPaused(item.id)
                executeCommand({
                  kind: 'update-source', itemId: item.id,
                  source: event.target.value,
                }, `source:${item.id}`)
              }}
              onBlur={() => dispatchHistory({ type: 'boundary' })}
              onFocus={(event) => rememberEditorFocus(event.currentTarget)}
              onSelect={(event) => rememberEditorFocus(event.currentTarget)}
              onKeyDown={(event) =>
                handleItemKeyDown(event, item, index)
              }
              aria-describedby={evaluation ? feedbackId : undefined}
              aria-invalid={invalid}
              spellCheck={false}
              autoComplete="off"
            />
            {supportsNormalization && (
              <span className="normalize-control">
                <button
                  ref={(element) => {
                    if (element) normalizationToggleRefs.current.set(item.id, element)
                    else normalizationToggleRefs.current.delete(item.id)
                  }}
                  type="button"
                  className={`normalize-toggle${item.normalization ? ' active' : ''}`}
                  aria-label={`Normalization: ${normalizationText}`}
                  // With one norm (VGA) the button switches off and auto
                  // directly; with norm and inorm (PGA) it opens the choice.
                  aria-pressed={hasIdealNorm(engine) ? undefined : Boolean(normalizationMode)}
                  aria-expanded={hasIdealNorm(engine) ? normalizationChoiceOpen : undefined}
                  aria-haspopup={hasIdealNorm(engine) ? 'dialog' : undefined}
                  title={!normalizationMode
                    ? 'Not normalized'
                    : normalizationUnavailable
                      ? 'Normalization unavailable: the value is unchanged'
                      : `Normalized by ${NORM_NAME[unitNorm!]}${normalizationMode === 'natural' ? ' (automatic)' : ''}`}
                  onClick={(event) => {
                    if (!hasIdealNorm(engine)) {
                      executeCommand({
                        kind: 'update-normalization', itemId: item.id,
                        normalization: normalizationMode ? undefined : 'natural',
                      })
                      return
                    }
                    normalizationAnchorRef.current = event.currentTarget
                    toggleNormalizationChoice(item.id)
                  }}
                >{item.normalization ? normalizationText : 'norm'}</button>
                <span
                  className={`unit-norm-indicator${hasUnitNorm ? ' is-unit' : ''}`}
                  title={hasUnitNorm ? (unitNorm === 'ideal' ? 'Unit ideal norm' : 'Unit norm') : undefined}
                >
                  {hasUnitNorm && (
                    <span className="visually-hidden">{unitNorm === 'ideal' ? 'Unit ideal norm' : 'Unit norm'}</span>
                  )}
                </span>
              </span>
            )}
          </div>
          {/* The mode is chosen in a popover anchored to the norm button, like the appearance menu. */}
          {normalizationChoiceOpen && (
            <NormalizationPopover
              anchorRef={normalizationAnchorRef}
              mode={normalizationMode ?? 'off'}
              options={normalizationOptions}
              onChoose={(option) => {
                executeCommand({
                  kind: 'update-normalization', itemId: item.id,
                  normalization: option === 'off' ? undefined : option,
                })
                closeNormalizationChoice()
              }}
              onClose={closeNormalizationChoice}
            />
          )}
          {/* The label text is edited under the expression while the label is shown (#226). */}
          {labelFieldShown && !noViz && (
            <label className="expression-label-row">
              <span aria-hidden="true">Label</span>
              <input
                className="expression-label-input"
                aria-label={`Label of ${annotation ? 'annotation' : 'expression'} ${position}`}
                value={label}
                placeholder={declaredName(item.source) ?? ''}
                onChange={(event) => executeCommand({
                  kind: 'update-appearance', itemId: item.id, appearance: { label: event.target.value },
                }, `appearance-label:${item.id}`)}
                onBlur={() => dispatchHistory({ type: 'boundary' })}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
          )}

          {evaluation || positionEvaluation ? (
            <div
              id={feedbackId}
              className="expression-feedback"
              role={invalid || invalidPosition ? 'alert' : 'status'}
            >
              {evaluation?.status === 'valid' ? (
                <>
                  {evaluation.valueType === 'list' ? (
                    <button
                      type="button"
                      className="list-inspection-toggle object-kind"
                      style={{ color }}
                      aria-expanded={listExpanded}
                      aria-controls={listDetailsId}
                      onClick={() => toggleListExpanded(item.id)}
                    >
                      <span aria-hidden="true">{listExpanded ? '▾' : '▸'}</span>
                      {kind}
                    </button>
                  ) : (
                    <span className="object-kind" style={{ color }}>
                      {kind}
                      {evaluation?.status === 'valid' && evaluation.valueType === 'single' &&
                        interpretation.detail(evaluation.entity) && (
                        <span className="object-detail"> {interpretation.detail(evaluation.entity)}</span>
                      )}
                      {approximated && (
                        <span
                          className="approximated-indicator"
                          title="A negligible coefficient was ignored when classifying this object"
                        >
                          <span aria-hidden="true">≈</span>
                          <span className="visually-hidden">
                            {' '}(approximated; a negligible coefficient was ignored)
                          </span>
                        </span>
                      )}
                    </span>
                  )}
                  <output>{formatDisplayValue(
                    evaluation.value,
                    display.decimalPlaces,
                    display.showApproximatedResidue,
                  )}</output>
                  {normalizationUnavailable && <>
                    <span className="feedback-label">Normalization unavailable</span>
                    <span>This multivector has zero {
                      item.normalization === 'natural' ? 'natural norm'
                        : item.normalization === 'ideal' ? 'ideal norm' : 'Euclidean norm'
                    } and was left unchanged.</span>
                  </>}
                </>
              ) : evaluation?.status === 'invalid' ? (
                <>
                  <span className="feedback-label">
                    {evaluation.diagnostic.code}
                  </span>
                  <span>{evaluation.diagnostic.message}</span>
                  <span className="source-location">
                    Source characters{' '}
                    {evaluation.diagnostic.span.start + 1}–
                    {Math.max(
                      evaluation.diagnostic.span.start + 1,
                      evaluation.diagnostic.span.end,
                    )}
                  </span>
                </>
              ) : null}
              {positionEvaluation?.status === 'invalid' && (
                <>
                  <span className="feedback-label">
                    {positionEvaluation.diagnostic.code}
                  </span>
                  <span>{positionEvaluation.diagnostic.message}</span>
                  <span className="source-location">
                    Position characters{' '}
                    {positionEvaluation.diagnostic.span.start + 1}–
                    {Math.max(
                      positionEvaluation.diagnostic.span.start + 1,
                      positionEvaluation.diagnostic.span.end,
                    )}
                  </span>
                </>
              )}
            </div>
          ) : null}

          {scalar && effectiveControl?.mode === 'slider' && controlEvaluation && (
            <ScalarSliderControl
              item={item}
              position={position}
              objectName={objectName}
              color={color}
              scalarEdit={scalarEdit}
              control={effectiveControl}
              controlEvaluation={controlEvaluation}
              isPlaying={isPlaying}
              playback={playback}
              decimalPlaces={display.decimalPlaces}
              objectRenderScale={objectRenderScale}
              executeCommand={executeCommand}
              dispatchHistory={dispatchHistory}
            />
          )}

          {evaluation?.status === 'valid' &&
            evaluation.valueType === 'list' &&
            listExpanded && (
              <ol
                id={listDetailsId}
                className="list-inspection"
                aria-label={`Elements of ${objectName}`}
              >
                {evaluation.elements.map((element, elementIndex) => (
                  <li key={element.id} className="list-inspection-item">
                    <span
                      className="list-element-index"
                      aria-label={`Element ${elementIndex}`}
                    >
                      {elementIndex}
                    </span>
                    <span className="list-element-kind">
                      {interpretation.describe(element.entity)}
                    </span>
                    {element.entity.kind !== 'mixed-multivector' &&
                      element.entity.approximated && (
                        <span
                          className="approximated-indicator"
                          title="A negligible coefficient was ignored when classifying this object"
                        >
                          <span aria-hidden="true">≈</span>
                          <span className="visually-hidden">
                            {' '}(approximated; a negligible coefficient was ignored)
                          </span>
                        </span>
                      )}
                    <code>{formatDisplayMultivector(
                      element.value,
                      display.decimalPlaces,
                      display.showApproximatedResidue,
                    )}</code>
                    {element.positionConflict ? (
                      <span className="list-element-position is-error">
                        position conflict
                      </span>
                    ) : element.position ? (
                      <span className="list-element-position">
                        position ({formatDisplayNumber(
                          element.position.x,
                          display.decimalPlaces,
                        )}, {formatDisplayNumber(
                          element.position.y,
                          display.decimalPlaces,
                        )})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
          )}

          {supportsPosition && !noViz && (
            <div className="position-input-row">
              <span className="position-prefix" aria-hidden="true">position</span>
              <input
                id={`position-source-${item.id}`}
                className="position-source"
                aria-label={`Position ${position}`}
                placeholder="(0, 0)"
                value={item.positionSource ?? ''}
                size={Math.max(1, (item.positionSource || '(0, 0)').length)}
                onChange={(event) => executeCommand({
                  kind: 'update-position', itemId: item.id,
                  positionSource: event.target.value,
                }, `position:${item.id}`)}
                onBlur={() => dispatchHistory({ type: 'boundary' })}
                onFocus={(event) => rememberEditorFocus(event.currentTarget)}
                onSelect={(event) => rememberEditorFocus(event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  insertExpression(
                    item.id,
                    event.shiftKey ? 'before' : 'after',
                  )
                }}
                aria-invalid={invalidPosition}
                aria-describedby={
                  positionEvaluation ? feedbackId : undefined
                }
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="delete-expression"
          onClick={() => removeExpression(item.id)}
          aria-label={`Delete expression ${position}`}
        >
          ×
        </button>
      </div>
      {appearanceOpen && valid && (
        <AppearancePopover
          kind={kind}
          styleId={styleId}
          visible={visible}
          labelVisible={labelVisible}
          borderVisible={appearance?.borderVisible ?? false}
          orientationVisible={resolveItemAppearance(appearance, kind, null).orientationVisible}
          bivectorShape={appearance?.bivectorShape ?? 'from-vectors'}
          idealPointDisplay={appearance?.idealPointDisplay ?? 'vector'}
          pointListDisplay={appearance?.primitiveStyles?.points?.connection ?? 'none'}
          pointMarkersVisible={appearance?.primitiveStyles?.points?.visible ?? true}
          pointListDisplayAvailable={evaluation?.status === 'valid' &&
            evaluation.valueType === 'list' &&
            pointListVertices(evaluation.elements) !== null}
          listPrimitives={evaluation?.status === 'valid' && evaluation.valueType === 'list'
            ? listPrimitiveTypes(evaluation.elements)
            : undefined}
          linesVisible={appearance?.primitiveStyles?.lines?.visible ?? true}
          appearance={appearance}
          linesOrientationVisible={resolveItemAppearance(appearance, kind, null).linesOrientationVisible}
          sources={appearanceSources}
          parallelogramAvailable={evaluation?.status === 'valid' &&
            evaluation.valueType === 'single' &&
            evaluation.primitive?.kind === 'oriented-area' &&
            evaluation.primitive.shape.kind === 'parallelogram'}
          colorOnly={!drawable}
          control={scalarControlAvailable ? effectiveControl : undefined}
          reducedMotion={reducedMotion}
          anchorRef={appearanceAnchorRef}
          onStyleChange={(style) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { style },
          })}
          onVisibleChange={(nextVisible) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { visible: nextVisible },
          })}
          onLabelVisibleChange={(nextVisible) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { labelVisible: nextVisible },
          })}
          onBorderVisibleChange={(borderVisible) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { borderVisible },
          })}
          onOrientationVisibleChange={(orientationVisible) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { orientationVisible },
          })}
          onBivectorShapeChange={(bivectorShape) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { bivectorShape },
          })}
          onIdealPointDisplayChange={(idealPointDisplay) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { idealPointDisplay },
          })}
          onPointListDisplayChange={(pointListDisplay) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { primitiveStyles: { points: { connection: pointListDisplay } } },
          })}
          onPointMarkersVisibleChange={(pointMarkersVisible) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { primitiveStyles: { points: { visible: pointMarkersVisible } } },
          })}
          onLinesVisibleChange={(linesVisible) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { primitiveStyles: { lines: { visible: linesVisible } } },
          })}
          onAppearanceChange={(appearance, coalesceKey) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance,
          }, coalesceKey === undefined ? undefined : `appearance-${coalesceKey}:${item.id}`)}
          onControlChange={(control) => {
            if (isPlaying) playback.stop(item.id)
            playback.forgetPaused(item.id)
            executeCommand({ kind: 'update-control', itemId: item.id, control })
          }}
          onClose={closeAppearance}
        />
      )}
    </article>
  )
}
