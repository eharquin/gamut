import {
  directConstructorComponents,
  directItemConstructorComponents,
  rewriteConstructorLiterals,
  type ConstructorComponentEdit,
  type TupleSpelling,
} from './constructorLiteralEdit'
import { parseExpression } from './parseExpression'

/*
 * VGA vector conveniences over the constructor-literal edit: two components,
 * written as `vector(x, y)` or `(x, y)`, declared or anonymous.
 */

export type DirectVectorComponentEdit = ConstructorComponentEdit

/** The VGA(2) tuple: exactly two components, read as `vector(x, y)`. */
const VGA_TUPLE: TupleSpelling = { constructor: 'vector', arities: [2] }

const pair = (
  components: readonly ConstructorComponentEdit[] | null,
): readonly [ConstructorComponentEdit, ConstructorComponentEdit] | null =>
  components ? [components[0], components[1]] : null

export function directDeclaredVectorComponents(
  source: string,
): readonly [DirectVectorComponentEdit, DirectVectorComponentEdit] | null {
  return pair(directItemConstructorComponents(source, 'vector', 2, VGA_TUPLE))
}

export function directPositionComponents(
  source: string,
): readonly [DirectVectorComponentEdit, DirectVectorComponentEdit] | null {
  return pair(directConstructorComponents(source, 'vector', 2, VGA_TUPLE))
}

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

export function rewriteLiteralComponents(
  source: string,
  components: readonly [DirectVectorComponentEdit, DirectVectorComponentEdit],
  x: number,
  y: number,
): string {
  return rewriteConstructorLiterals(source, components, [x, y])
}
