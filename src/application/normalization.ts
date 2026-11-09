import type { AlgebraEngine, NormalizationResult, NormKind } from '../algebra/algebraEngine'
import type { ItemNormalization } from '../document/expressionDocument'
import type { OwnedMultivector } from '../domain/multivector'
import type { AnyInterpretation } from '../geometry/interpretation'

/** Values within this distance of 1 count as unit norm. */
export const UNIT_NORM_TOLERANCE = 1e-10

/** Whether the algebra offers a choice of norm: `inorm` besides `norm`. */
export function hasIdealNorm(engine: AlgebraEngine): boolean {
  return engine.idealNorm !== undefined
}

/**
 * The norm a normalization mode applies to a value. `euclidean` and `ideal`
 * force `norm` and `inorm`. `natural` (shown as auto), like no mode, follows
 * the interpretation's classification; `null` when it does not decide, and
 * the engine then keeps its own choice.
 */
export function appliedNorm(
  mode: ItemNormalization | undefined,
  value: OwnedMultivector,
  engine: AlgebraEngine,
  interpretation: AnyInterpretation,
): NormKind | null {
  if (mode === 'euclidean') return 'euclidean'
  if (mode === 'ideal') return 'ideal'
  if (!hasIdealNorm(engine)) return 'euclidean'
  return interpretation.naturalNorm?.(interpretation.interpret(value)) ?? null
}

/** Normalizes an item's value under its mode (document format §2.2). */
export function normalizeItemValue(
  mode: ItemNormalization,
  value: OwnedMultivector,
  engine: AlgebraEngine,
  interpretation: AnyInterpretation,
): NormalizationResult {
  return engine.normalize(value, appliedNorm(mode, value, engine, interpretation) ?? undefined)
}

function normValue(engine: AlgebraEngine, value: OwnedMultivector, norm: NormKind): number {
  return (norm === 'ideal' ? engine.idealNorm?.(value) : engine.norm(value))?.coefficients[0] ?? Number.NaN
}

/**
 * The norm a value is measured by for the unit badge: the one the mode
 * applies, and for an undecided classification the engine's own choice,
 * `norm` unless it is zero.
 */
export function measuredNorm(
  mode: ItemNormalization | undefined,
  value: OwnedMultivector,
  engine: AlgebraEngine,
  interpretation: AnyInterpretation,
): NormKind {
  const applied = appliedNorm(mode, value, engine, interpretation)
  if (applied) return applied
  return normValue(engine, value, 'euclidean') > 0 ? 'euclidean' : 'ideal'
}

/** Whether the norm the mode applies equals 1. */
export function isUnitNorm(
  mode: ItemNormalization | undefined,
  value: OwnedMultivector,
  engine: AlgebraEngine,
  interpretation: AnyInterpretation,
): boolean {
  try {
    const norm = normValue(engine, value, measuredNorm(mode, value, engine, interpretation))
    return Math.abs(norm - 1) <= UNIT_NORM_TOLERANCE
  } catch {
    return false
  }
}
