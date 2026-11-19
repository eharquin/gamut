import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { AlgebraEngine } from '../algebra/algebraEngine'
import type { ItemAppearanceSources } from '../application/evaluateAppearanceSources'
import type { EvaluatedDocumentItem } from '../application/evaluateDocument'
import { evaluateScalarControl, type ScalarControlEvaluation } from '../application/evaluateScalarControl'
import { hasIdealNorm, measuredNorm, normalizeItemValue } from '../application/normalization'
import { DEFAULT_SCALAR_CONTROL, type ScalarPlayback } from '../hooks/useScalarPlayback'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type {
  ExpressionAppearance,
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
import { NoteEditor } from './NoteEditor'
import { ScalarSliderControl } from './ScalarSliderControl'
import { FOLDER_TRIGGER, NOTE_TRIGGER, type SourceEditor } from './sourceEditor'

/** The row's normalization modes, by stored value; off is no mode (#185). */
const NORMALIZATION_TEXT = { off: 'off', natural: 'auto', euclidean: 'norm', ideal: 'inorm' } as const
const NORM_NAME = { euclidean: 'the Euclidean norm', ideal: 'the ideal norm' } as const

/** The element registries and popover anchors that rows share with the panel. */
export type ExpressionRowRefs = Readonly<{
  /** Each row's article, for reordering and focus restoration. */
  expressionRowRefs: RefObject<Map<string, HTMLElement>>
  /** Each row's source editor, focused after creation, deletion, undo and redo. */
  inputRefs: RefObject<Map<string, SourceEditor>>
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
  rememberEditorFocus(element: SourceEditor): void
  /** Keyboard handling of the source editor: insertion, deletion, navigation. */
  handleItemKeyDown(event: KeyboardEvent<SourceEditor>, item: ExpressionItem, index: number): void
  insertExpression(anchorId: string, placement: 'before' | 'after'): void
  removeExpression(itemId: string): void
  beginRowReorder(event: ReactPointerEvent<HTMLButtonElement>, itemId: string): void
  reorderRowWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, itemId: string): void
  /** Makes a folder of the row, named by `name`. */
  convertRowToFolder(itemId: string, name: string): void
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
  /** The appearance the row is drawn with: its own, or the one a folder overwrites. */
  appearance: ExpressionAppearance | undefined
  /** The folder whose appearance overwrites that of the row, which then has no menu of its own. */
  appearanceSetBy?: string
  appearanceSources: ItemAppearanceSources
  engine: AlgebraEngine
  interpretation: AnyInterpretation
  display: ExpressionDocument['view']['display']
  /** The document has no visualizer: appearance is kept but dormant. */
  noViz: boolean
  /** A drag on the canvas can move the object: its row offers to hold it in place. */
  draggableAvailable: boolean
  reducedMotion: boolean
  dropBefore: boolean
  dropAfter: boolean
  listExpanded: boolean
  appearanceOpen: boolean
  /** This row's normalization choice is the open one. */
  normalizationChoiceActive: boolean
  /** Whether this row's scalar is playing, read by the panel at render. */
  isPlaying: boolean
  /** The playback actions a row starts, stops or resets. */
  playback: Pick<ScalarPlayback, 'start' | 'stop' | 'forgetPaused'>
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
  appearanceSetBy,
  appearanceSources,
  engine,
  interpretation,
  display,
  noViz,
  draggableAvailable,
  reducedMotion,
  dropBefore,
  dropAfter,
  listExpanded,
  appearanceOpen,
  normalizationChoiceActive,
  isPlaying,
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
    convertRowToFolder,
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
  // A row that changes kind gets another editor element: the new one takes
  // the focus and the caret that the conversion asked for.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const caret = pendingCaret.current
    pendingCaret.current = null
    const editor = inputRefs.current.get(item.id)
    if (caret === null || !editor) return
    editor.focus()
    editor.setSelectionRange(caret, caret)
    rememberEditorFocus(editor)
    // Runs when the kind changes only.
  }, [annotation]) // eslint-disable-line react-hooks/exhaustive-deps
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
  // The norm the mode applies, named in the norm button's tooltip (#185).
  const unitNorm = supportsNormalization
    ? measuredNorm(item.normalization, evaluation.value, engine, interpretation)
    : null
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
    draggable,
    sliderInCanvas,
  } = resolveItemAppearance(
    appearance,
    kind,
    declaredName(item.source),
  )
  // A label with `${…}` insertions is named by the text it shows.
  const labelText = appearanceSources.label
  const objectName = annotation ? `Annotation ${position}` : labelText?.text ?? displayLabel ?? kind
  const labelErrorId = `label-error-${item.id}`
  const noteTextId = `annotation-text-${item.id}`
  // Every object that can have a label shows its switch under the
  // expression; the text field follows while the label is shown (#226).
  const labelRowShown = drawable && evaluation?.status === 'valid' &&
    evaluation.valueType !== 'list'
  const labelFieldShown = labelRowShown && labelVisible
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
        effectiveControl, evaluatedItems, engine, scalarEdit?.value ?? null,
      )
    : null
  const scalarControlAvailable = effectiveControl !== undefined
  const empty = item.source.trim() === ''
  const listDetailsId = `list-details-${item.id}`

  // A slider row shows its kind and value first, then the slider under them.
  const sliderShown = Boolean(scalar && effectiveControl?.mode === 'slider' && controlEvaluation)
  const kindLabel = (
    <span className="object-kind" style={{ color }}>
      {kind}
      {/* The description ("at (1, 2)", "direction (0, 1)") is read out, not shown. */}
      {evaluation?.status === 'valid' && evaluation.valueType === 'single' &&
        interpretation.detail(evaluation.entity) && (
        <span className="visually-hidden"> {interpretation.detail(evaluation.entity)}</span>
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
  )
  const displayedValue = evaluation?.status === 'valid'
    ? formatDisplayValue(evaluation.value, display.decimalPlaces, display.showApproximatedResidue)
    : ''
  // A value cut short at the end of its line shows in full on hover.
  const valueOutput = evaluation?.status === 'valid' && (display.valuesVisible ? (
    <output title={displayedValue}>{displayedValue}</output>
  ) : (
    // A hidden value is announced as hidden, never read out (#191).
    <span className="visually-hidden">Value hidden</span>
  ))
  // The norm button ends the value's line; its choice opens in a popover anchored to it.
  const normControl = supportsNormalization && (
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
    </span>
  )
  const feedback = evaluation || positionEvaluation ? (
    <div
      id={feedbackId}
      className="expression-feedback"
      role={invalid || invalidPosition ? 'alert' : 'status'}
    >
      {evaluation?.status === 'valid' ? (
        <>
          {/* The kind, followed by the value in a read-only field and the norm button. */}
          <div className="expression-kind-line">
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
            kindLabel
          )}
          {valueOutput}
          {normControl}
          </div>
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
  ) : null

  return (
    <article
      ref={(element) => {
        if (element) expressionRowRefs.current.set(item.id, element)
        else expressionRowRefs.current.delete(item.id)
      }}
      onFocus={(event) => {
        // A control pressed with the pointer (the slider) does not focus the row.
        if (event.target instanceof HTMLElement && event.target.dataset.pointerFocus !== undefined) return
        focusRow(item.id)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          blurRow(item.id)
      }}
      onPointerEnter={() => hoverRow(item.id)}
      onPointerLeave={() => leaveRow(item.id)}
      className={`expression-item${visible || noViz || annotation ? '' : ' is-hidden'}${
        empty ? ' is-empty-expression' : ''
      }${annotation ? ' is-annotation' : ''}${dropBefore ? ' drop-before' : ''}${dropAfter ? ' drop-after' : ''} ${
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
          {/* Above the swatch: whether a drag on the canvas moves the object. */}
          {draggableAvailable && valid && (
              <button
                type="button"
                className={`drag-toggle${draggable ? '' : ' is-held'}`}
                aria-label={`Drag ${objectName} on the canvas`}
                aria-pressed={draggable}
                title={draggable ? 'Draggable: click to hold in place' : 'Held in place: click to make draggable'}
                onClick={() => executeCommand({
                  kind: 'update-appearance', itemId: item.id, appearance: { draggable: !draggable },
                })}
              >
                <svg className="drag-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 2v12M2 8h12M6.2 3.8 8 2l1.8 1.8M6.2 12.2 8 14l1.8-1.8M3.8 6.2 2 8l1.8 1.8M12.2 6.2 14 8l-1.8 1.8" />
                  {!draggable && <path className="drag-icon-slash" d="M2.5 13.5 13.5 2.5" />}
                </svg>
              </button>
          )}
          {valid && !draggableAvailable && (
            <span className="expression-action-spacer" aria-hidden="true" />
          )}
          {valid && noViz ? (
              // Appearance is kept in the document but dormant
              // without a canvas: the swatch only shows the color.
              <span className="appearance-swatch is-dormant" aria-hidden="true">
                <span className="appearance-swatch-fill" style={{ backgroundColor: color }} />
              </span>
          ) : valid && appearanceSetBy !== undefined ? (
              // The folder overwrites the appearance: it is changed in the folder's menu.
              <span className="appearance-swatch is-dormant" title={`Appearance set by the folder ${appearanceSetBy}`}>
                <span className="appearance-swatch-fill" style={{ backgroundColor: color }} />
                <span className="visually-hidden">Appearance set by the folder {appearanceSetBy}</span>
              </span>
          ) : valid ? (
              <button
                type="button"
                className="appearance-swatch"
                aria-label={`Open ${kind} menu for ${objectName}`}
                aria-haspopup="dialog"
                aria-expanded={appearanceOpen}
                // A click opens the menu without focusing the row; the menu
                // then returns the focus to the swatch only if it had it.
                onMouseDown={(event) => event.preventDefault()}
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
          ) : !annotation && (
            // A note has no status: its column stays, so that its text lines up with the sources.
            <span
              className={`expression-status-pastille${empty ? ' is-empty' : ' is-error'}`}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="expression-body">
          <div className="expression-editor-row">
            {annotation ? (
              <NoteEditor
                id={inputId}
                textId={noteTextId}
                position={position}
                source={item.source}
                editorRef={(element) => {
                  if (element) inputRefs.current.set(item.id, element)
                  else if (inputRefs.current.get(item.id) instanceof HTMLTextAreaElement) inputRefs.current.delete(item.id)
                }}
                onChange={(source) => executeCommand({ kind: 'update-source', itemId: item.id, source }, `source:${item.id}`)}
                onConvertToExpression={() => {
                  pendingCaret.current = 0
                  // An expression is one line.
                  executeCommand({ kind: 'set-item-kind', itemId: item.id, itemKind: 'expression', source: item.source.replace(/\s*\n\s*/g, ' ') })
                }}
                onInsertAfter={() => insertExpression(item.id, 'after')}
                onRowKeyDown={(event) => handleItemKeyDown(event, item, index)}
                onFocus={rememberEditorFocus}
                onSelect={rememberEditorFocus}
                onBlur={() => dispatchHistory({ type: 'boundary' })}
              />
            ) : (
            <input
              ref={(element) => {
                if (element) inputRefs.current.set(item.id, element)
                else if (inputRefs.current.get(item.id) instanceof HTMLInputElement) inputRefs.current.delete(item.id)
              }}
              id={inputId}
              className="expression-source"
              aria-label={`Expression ${position}`}
              value={item.source}
              onChange={(event) => {
                if (isPlaying) playback.stop(item.id)
                playback.forgetPaused(item.id)
                const { value } = event.target
                // A quotation mark typed or pasted at the start of an expression
                // makes the row a note and is not stored (language §3).
                if (value.startsWith(NOTE_TRIGGER)) {
                  pendingCaret.current = Math.max(0, (event.target.selectionStart ?? 1) - 1)
                  executeCommand({ kind: 'set-item-kind', itemId: item.id, itemKind: 'annotation', source: value.slice(1) })
                  return
                }
                // A slash typed or pasted at the start makes a folder of the row,
                // named by what follows it; no expression starts with a division.
                if (value.startsWith(FOLDER_TRIGGER)) {
                  convertRowToFolder(item.id, value.slice(1))
                  return
                }
                executeCommand({
                  kind: 'update-source', itemId: item.id,
                  source: value,
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
          {sliderShown && effectiveControl && controlEvaluation ? (
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
              executeCommand={executeCommand}
              dispatchHistory={dispatchHistory}
            >
              {feedback}
            </ScalarSliderControl>
          ) : feedback}

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
                    {display.valuesVisible ? (
                      <code>{formatDisplayMultivector(
                        element.value,
                        display.decimalPlaces,
                        display.showApproximatedResidue,
                      )}</code>
                    ) : (
                      <span className="visually-hidden">Value hidden</span>
                    )}
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
          {/* The switch does what the Label switch of the menu does; the text
              is edited beside it while the label is shown (#226). It comes last
              in the row, after the value and the position. */}
          {/* Hidden while the graph's Labels setting is off, which draws no label. */}
          {labelRowShown && !noViz && display.labelsVisible && (
            <div className={`expression-label-row${labelVisible ? '' : ' is-off'}`}>
              <label className="expression-label-toggle">
                <input
                  type="checkbox"
                  aria-label={`Show label of ${objectName}`}
                  checked={labelVisible}
                  onChange={(event) => executeCommand({
                    kind: 'update-appearance', itemId: item.id,
                    appearance: { labelVisible: event.target.checked },
                  })}
                />
                <span aria-hidden="true">Label</span>
              </label>
              {labelFieldShown && <input
                className="expression-label-input"
                aria-label={`Label of ${annotation ? 'annotation' : 'expression'} ${position}`}
                value={label}
                placeholder={declaredName(item.source) ?? ''}
                title="Insert a value with ${expression}, as in A = ${t}"
                aria-invalid={labelText?.error ? true : undefined}
                aria-describedby={labelText?.error ? labelErrorId : undefined}
                onChange={(event) => executeCommand({
                  kind: 'update-appearance', itemId: item.id, appearance: { label: event.target.value },
                }, `appearance-label:${item.id}`)}
                onBlur={() => dispatchHistory({ type: 'boundary' })}
                spellCheck={false}
                autoComplete="off"
              />}
            </div>
          )}
          {labelRowShown && !noViz && display.labelsVisible && labelVisible && labelText?.error && (
            <p id={labelErrorId} className="expression-label-error" role="status">{labelText.error}</p>
          )}
        </div>
        <div className="expression-end-actions">
          {/* In the top right corner of the row: whether the object is drawn. */}
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
          <button
            type="button"
            className="delete-expression"
            onClick={() => removeExpression(item.id)}
            aria-label={`Delete ${annotation ? 'annotation' : 'expression'} ${position}`}
          >
            ×
          </button>
        </div>
      </div>
      {appearanceOpen && valid && (
        <AppearancePopover
          kind={kind}
          styleId={styleId}
          visible={visible}
          labelVisible={labelVisible}
          labelsDisabled={!display.labelsVisible}
          sliderInCanvas={sliderInCanvas}
          // The canvas slider needs a canvas: none in NoViz.
          onSliderInCanvasChange={scalarControlAvailable && !noViz ? (next) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { sliderInCanvas: next },
          }) : undefined}
          draggable={draggableAvailable ? draggable : undefined}
          onDraggableChange={draggableAvailable ? (nextDraggable) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: { draggable: nextDraggable },
          }) : undefined}
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
          onAppearanceChange={(nextAppearance, coalesceKey) => executeCommand({
            kind: 'update-appearance', itemId: item.id, appearance: nextAppearance,
          }, coalesceKey === undefined ? undefined : `appearance-${coalesceKey}:${item.id}`)}
          onControlChange={(control) => {
            // A new speed changes a playing animation without stopping it;
            // typing a speed is one undo step.
            const speedOnly = effectiveControl !== undefined && control.animation !== null &&
              JSON.stringify({ ...control, animation: { ...control.animation, durationSeconds: 0 } }) ===
              JSON.stringify({ ...effectiveControl, animation: effectiveControl.animation && { ...effectiveControl.animation, durationSeconds: 0 } })
            if (isPlaying && !speedOnly) playback.stop(item.id)
            playback.forgetPaused(item.id)
            executeCommand({ kind: 'update-control', itemId: item.id, control },
              speedOnly ? `control-speed:${item.id}` : undefined)
          }}
          onClose={closeAppearance}
        />
      )}
    </article>
  )
}
