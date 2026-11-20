import type { AlgebraEngine } from '../algebra/algebraEngine'
import type { ExpressionAppearance, ExpressionDocument } from '../document/expressionDocument'
import type { EvaluatedDocumentItem } from './evaluateDocument'
import { formatDisplayValue } from '../presentation/formatNumber'
import { scalarSourceEvaluator, valueSourceEvaluator, type ScalarSourceMessages } from './evaluateScalarControl'
import { isLabelTemplate, resolveLabelTemplate, type LabelTextResult } from './labelTemplate'

/** The numeric appearance settings stored as source text (document format §2.2). */
export type AppearanceSetting =
  | 'strokeWidth'
  | 'pointSize'
  | 'opacity'
  | 'labelAngle'
  | 'labelSize'
  | 'labelDistance'

/**
 * Ranges, from limits and interaction constants §5.1. A bounded setting
 * refuses a value outside its inclusive range. An open setting (width, size,
 * label size, distance) has no maximum and takes any finite scalar, a negative one
 * drawing as 0. A periodic setting (the label angle, in radians) takes any
 * finite scalar, brought into (−π, π].
 */
export const APPEARANCE_SETTING_RANGES: Readonly<Record<AppearanceSetting, Readonly<{
  minimum: number
  maximum: number
  unit: string
  open?: boolean
  periodic?: boolean
}>>> = {
  strokeWidth: { minimum: 0, maximum: Infinity, unit: 'px', open: true },
  pointSize: { minimum: 0, maximum: Infinity, unit: 'px', open: true },
  opacity: { minimum: 0, maximum: 100, unit: '%' },
  labelAngle: { minimum: -Math.PI, maximum: Math.PI, unit: 'rad', periodic: true },
  labelSize: { minimum: 0, maximum: Infinity, unit: 'px', open: true },
  labelDistance: { minimum: 0, maximum: Infinity, unit: 'px', open: true },
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
  points: Readonly<{ pointSize: AppearanceSourceResult; strokeWidth: AppearanceSourceResult; fillOpacity: AppearanceSourceResult }>
  lines: Readonly<{ strokeWidth: AppearanceSourceResult }>
  /** The label with its `${…}` insertions replaced; `null` for a plain label. */
  label: LabelTextResult | null
}>

const DEFAULT: AppearanceSourceResult = Object.freeze({ value: null, error: null })

export const DEFAULT_APPEARANCE_SOURCES: ItemAppearanceSources = Object.freeze({
  strokeWidth: DEFAULT,
  pointSize: DEFAULT,
  opacity: DEFAULT,
  labelAngle: DEFAULT,
  labelSize: DEFAULT,
  labelDistance: DEFAULT,
  points: Object.freeze({ pointSize: DEFAULT, strokeWidth: DEFAULT, fillOpacity: DEFAULT }),
  lines: Object.freeze({ strokeWidth: DEFAULT }),
  label: null,
})

const APPEARANCE_MESSAGES: ScalarSourceMessages = {
  nonScalar: { code: 'APPEARANCE_NON_SCALAR', message: 'The value is not a real scalar.' },
  nonFinite: { code: 'APPEARANCE_NON_FINITE', message: 'The value is not finite.' },
}

/** An angle in radians brought into (−π, π]; 2π apart, two angles draw alike. */
export function wrappedAngle(radians: number): number {
  const turn = 2 * Math.PI
  const wrapped = radians - turn * Math.floor((radians + Math.PI) / turn)
  // −π and π are the same angle: the half-open interval keeps π.
  return wrapped === -Math.PI ? Math.PI : wrapped
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
  const { minimum, maximum, open, periodic } = APPEARANCE_SETTING_RANGES[setting]
  if (open) return { value: Math.max(minimum, result.value), error: null }
  if (periodic) return { value: wrappedAngle(result.value), error: null }
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
    points?.pointSizeSource, points?.strokeWidthSource, points?.fillOpacitySource, lines?.strokeWidthSource,
  ].some((source) => source !== undefined && source.trim() !== '') ||
    isLabelTemplate(appearance.label ?? '')
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
  const evaluateValue = valueSourceEvaluator(items, engine)
  const { decimalPlaces, showApproximatedResidue } = document.view.display
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
        // A share of the list's color, from 0 to 100 like the opacity.
        fillOpacity: resolveAppearanceSource('opacity', points?.fillOpacitySource, evaluate),
      },
      lines: {
        strokeWidth: resolveAppearanceSource('strokeWidth', lines?.strokeWidthSource, evaluate),
      },
      label: isLabelTemplate(appearance!.label ?? '')
        ? resolveLabelTemplate(appearance!.label!, evaluateValue,
          (value) => formatDisplayValue(value, decimalPlaces, showApproximatedResidue))
        : null,
    })
  }
  return results
}
