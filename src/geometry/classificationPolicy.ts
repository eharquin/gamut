/**
 * An interpretation's classification tolerance (VGA-INT-005, PGA-INT-005):
 * a coefficient whose magnitude is at most `epsilon` is numerical residue
 * when an entity is classified. It governs classification decisions, and
 * which terms the display omits when asked to, only: it never alters owned
 * coefficients or dependent evaluation (#68).
 */
export type ClassificationPolicy = Readonly<{
  absoluteFloor: number
  relativeTerm: number
}>

/** The magnitude-relative scale input for a classification decision. */
export function classificationScale(coefficients: readonly number[]): number {
  return Math.max(...coefficients.map(Math.abs))
}

/** epsilon = absoluteFloor + relativeTerm * scale. */
export function classificationEpsilon(
  policy: ClassificationPolicy,
  scale: number,
): number {
  return policy.absoluteFloor + policy.relativeTerm * scale
}
