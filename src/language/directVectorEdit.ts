import { parseExpression } from './parseExpression'

/**
 * The anchor a position source names, `V.position` or `V.head`; `null` for
 * any other source. Literal positions are edited through
 * `constructorLiteralEdit` with the active algebra's tuple constructor.
 */
export function directPositionAnchorReference(
  source: string,
): Readonly<{ name: string; property: 'position' | 'head' }> | null {
  const parsed = parseExpression(source)
  if (!parsed.ok || parsed.expression.kind !== 'reference' ||
      parsed.expression.property === null) return null
  return {
    name: parsed.expression.name,
    property: parsed.expression.property,
  }
}
