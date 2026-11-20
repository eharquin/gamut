import type { AlgebraEngine } from '../algebra/algebraEngine'
import type { EvaluatedDocumentItem } from '../application/evaluateDocument'
import { evaluateScalarControl, type ScalarControlEvaluation } from '../application/evaluateScalarControl'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type { ExpressionAppearance } from '../document/expressionDocument'
import { DEFAULT_SCALAR_CONTROL, type ScalarPlayback } from '../hooks/useScalarPlayback'
import { declaredName } from '../language/declaredName'
import { directScalarEdit } from '../language/directScalarEdit'
import { formatDisplayNumber } from '../presentation/formatNumber'
import { resolveItemAppearance } from './appearancePalette'
import { ScalarSliderControl } from './ScalarSliderControl'

type CanvasSlidersProps = Readonly<{
  evaluatedItems: readonly EvaluatedDocumentItem[]
  /** The appearance each row stores; a folder does not overwrite this setting. */
  appearanceOf(itemId: string): ExpressionAppearance | undefined
  scalarControlEvaluations: ReadonlyMap<string, ScalarControlEvaluation>
  engine: AlgebraEngine
  decimalPlaces: number
  playback: Pick<ScalarPlayback, 'start' | 'stop' | 'forgetPaused' | 'isPlaying'>
  executeCommand(command: DocumentCommand, coalesceKey?: string): void
  dispatchHistory(action: HistoryAction): void
}>

/**
 * The sliders of the scalars whose appearance asks for them on the canvas,
 * stacked in the bottom-left corner in document order. Each one drives its
 * scalar like the slider of its row, play included; its interval is edited
 * in the row.
 */
export function CanvasSliders({
  evaluatedItems,
  appearanceOf,
  scalarControlEvaluations,
  engine,
  decimalPlaces,
  playback,
  executeCommand,
  dispatchHistory,
}: CanvasSlidersProps) {
  const sliders = evaluatedItems.flatMap((entry, index) => {
    const appearance = appearanceOf(entry.item.id)
    if (!appearance?.sliderInCanvas) return []
    const { evaluation } = entry
    // Like the row's slider, it acts only on a declared numeric literal.
    if (evaluation?.status !== 'valid' || evaluation.valueType !== 'single' ||
        evaluation.entity.kind !== 'scalar') return []
    const scalarEdit = directScalarEdit(entry.item.source)
    if (!scalarEdit) return []
    return [{ entry, index, appearance, scalarEdit }]
  })
  if (sliders.length === 0) return null
  return (
    <div
      className="canvas-sliders"
      role="group"
      aria-label="Canvas sliders"
      // A press on a slider is not a press on the canvas, which would pan it.
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {sliders.map(({ entry, index, appearance, scalarEdit }) => {
        const { item } = entry
        const name = declaredName(item.source) ?? `Scalar ${index + 1}`
        const { color } = resolveItemAppearance(appearance, 'Scalar', name)
        const control = item.control ?? DEFAULT_SCALAR_CONTROL
        const controlEvaluation = scalarControlEvaluations.get(item.id) ??
          evaluateScalarControl(control, evaluatedItems, engine, scalarEdit.value)
        return (
          <div key={item.id} className="canvas-slider">
            <ScalarSliderControl
              item={item}
              position={index + 1}
              objectName={name}
              color={color}
              scalarEdit={scalarEdit}
              control={control}
              controlEvaluation={controlEvaluation}
              isPlaying={playback.isPlaying(item.id)}
              playback={playback}
              decimalPlaces={decimalPlaces}
              executeCommand={executeCommand}
              dispatchHistory={dispatchHistory}
              placement="canvas"
            >
              <span className="canvas-slider-name">
                <span>{name}</span> = {formatDisplayNumber(scalarEdit.value, decimalPlaces)}
              </span>
            </ScalarSliderControl>
          </div>
        )
      })}
    </div>
  )
}
