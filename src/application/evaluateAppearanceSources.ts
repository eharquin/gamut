import type { AlgebraEngine } from '../algebra/algebraEngine'
import type { ExpressionAppearance, ExpressionDocument } from '../document/expressionDocument'
import type { EvaluatedDocumentItem } from './evaluateDocument'
import { scalarSourceEvaluator, type ScalarSourceMessages } from './evaluateScalarControl'

/** The numeric appearance settings stored as source text (document format §2.2). */
export type AppearanceSetting =
  | 'strokeWidth'
  | 'pointSize'
  | 'opacity'
  | 'labelAngle'
  | 'labelSize'
  | 'labelDistance'

/** Inclusive ranges, from limits and interaction constants §5.1. */
export const APPEARANCE_SETTING_RANGES: Readonly<Record<AppearanceSetting, Readonly<{
  minimum: number
  maximum: number
  unit: string
}>>> = {
  strokeWidth: { minimum: 0.25, maximum: 10, unit: 'px' },
  pointSize: { minimum: 1, maximum: 20, unit: 'px' },
  opacity: { minimum: 0, maximum: 100, unit: '%' },
  labelAngle: { minimum: -180, maximum: 180, unit: '°' },
  labelSize: { minimum: 6, maximum: 36, unit: 'px' },
  labelDistance: { minimum: 0, maximum: 40, unit: 'px' },
}

/**
 * The value an appearance source selects. `value` is `null` when the drawing
 * uses the kind default: for an empty source, without error, and for a
 * refused source, with the reason shown under the setting.
 */
export type AppearanceSourceResult = Readonly<{ value: number | null; error: string | null }>

/** Every appearance-source node of one item. */
export type ItemAppearanceSources = Readonly<{
  strokeWidth: AppearanceSourceResult
  pointSize: AppearanceSourceResult
  opacity: AppearanceSourceResult
  labelAngle: AppearanceSourceResult
  labelSize: AppearanceSourceResult
  labelDistance: AppearanceSourceResult
  points: Readonly<{ pointSize: AppearanceSourceResult; strokeWidth: AppearanceSourceResult }>
  lines: Readonly<{ strokeWidth: AppearanceSourceResult }>
}>

const DEFAULT: AppearanceSourceResult = Object.freeze({ value: null, error: null })

export const DEFAULT_APPEARANCE_SOURCES: ItemAppearanceSources = Object.freeze({
  strokeWidth: DEFAULT,
  pointSize: DEFAULT,
  opacity: DEFAULT,
  labelAngle: DEFAULT,
  labelSize: DEFAULT,
  labelDistance: DEFAULT,
  points: Object.freeze({ pointSize: DEFAULT, strokeWidth: DEFAULT }),
  lines: Object.freeze({ strokeWidth: DEFAULT }),
})

const APPEARANCE_MESSAGES: ScalarSourceMessages = {
  nonScalar: { code: 'APPEARANCE_NON_SCALAR', message: 'The value is not a real scalar.' },
  nonFinite: { code: 'APPEARANCE_NON_FINITE', message: 'The value is not finite.' },
}

function formatted(value: number): string {
  return String(Number(value.toPrecision(6)))
}

/**
 * Resolves one appearance source. A refused source (invalid text, unknown
 * name, non-scalar or out-of-range value) falls back to the kind default and
 * says why; the document and the item's value are unaffected.
 */
export function resolveAppearanceSource(
  setting: AppearanceSetting,
  source: string | undefined,
  evaluate: ReturnType<typeof scalarSourceEvaluator>,
): AppearanceSourceResult {
  if (source === undefined || source.trim() === '') return DEFAULT
  const result = evaluate(source, APPEARANCE_MESSAGES)
  if (result.status === 'invalid') {
    const { code, message } = result.diagnostic
    const reason = code === 'LANG_SYNTAX' || code === 'CTRL_UNSUPPORTED_REFERENCE'
      ? 'Enter a number or a scalar expression.'
      : message
    return { value: null, error: `${reason} Default used.` }
  }
  const { minimum, maximum } = APPEARANCE_SETTING_RANGES[setting]
  if (result.value < minimum || result.value > maximum) return {
    value: null,
    error: `${formatted(result.value)} is outside ${minimum} to ${maximum}. Default used.`,
  }
  return { value: result.value, error: null }
}

function hasSource(appearance: ExpressionAppearance | undefined): boolean {
  if (!appearance) return false
  const { points, lines } = appearance.primitiveStyles ?? {}
  return [
    appearance.strokeWidthSource, appearance.pointSizeSource, appearance.opacitySource,
    appearance.labelAngleSource, appearance.labelSizeSource, appearance.labelDistanceSource,
    points?.pointSizeSource, points?.strokeWidthSource, lines?.strokeWidthSource,
  ].some((source) => source !== undefined && source.trim() !== '')
}

/**
 * Evaluates the appearance-source nodes of every item (document format §5).
 * They read value nodes like slider bounds do and nothing reads them, so they
 * are evaluated after the value graph and follow a slider while it animates.
 * Items without any source share the defaults.
 */
export function evaluateAppearanceSources(
  document: ExpressionDocument,
  items: readonly EvaluatedDocumentItem[],
  engine: AlgebraEngine,
): ReadonlyMap<string, ItemAppearanceSources> {
  const results = new Map<string, ItemAppearanceSources>()
  if (!document.items.some((item) => hasSource(document.appearance[item.id]))) return results
  const evaluate = scalarSourceEvaluator(items, engine)
  for (const item of document.items) {
    const appearance = document.appearance[item.id]
    if (!hasSource(appearance)) continue
    const { points, lines } = appearance!.primitiveStyles ?? {}
    results.set(item.id, {
      strokeWidth: resolveAppearanceSource('strokeWidth', appearance!.strokeWidthSource, evaluate),
      pointSize: resolveAppearanceSource('pointSize', appearance!.pointSizeSource, evaluate),
      opacity: resolveAppearanceSource('opacity', appearance!.opacitySource, evaluate),
      labelAngle: resolveAppearanceSource('labelAngle', appearance!.labelAngleSource, evaluate),
      labelSize: resolveAppearanceSource('labelSize', appearance!.labelSizeSource, evaluate),
      labelDistance: resolveAppearanceSource('labelDistance', appearance!.labelDistanceSource, evaluate),
      points: {
        pointSize: resolveAppearanceSource('pointSize', points?.pointSizeSource, evaluate),
        strokeWidth: resolveAppearanceSource('strokeWidth', points?.strokeWidthSource, evaluate),
      },
      lines: {
        strokeWidth: resolveAppearanceSource('strokeWidth', lines?.strokeWidthSource, evaluate),
      },
    })
  }
  return results
}
