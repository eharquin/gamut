import type { SurfaceExpressionNode, TupleConstructor } from './ast'
import { formatScalarSource } from './directScalarEdit'
import { parseDocumentExpression, parseExpression } from './parseExpression'

export type SourceSpan = Readonly<{ start: number; end: number }>

/** One constructor argument as a direct-edit target: a numeric literal or a signed name. */
export type ConstructorComponentEdit =
  | Readonly<{ kind: 'literal'; span: SourceSpan }>
  | Readonly<{ kind: 'reference'; name: string; sign: 1 | -1 }>

function numericSpan(node: SurfaceExpressionNode): SourceSpan | null {
  let current = node
  while (current.kind === 'unary-expression' &&
      (current.operator === '+' || current.operator === '-')) current = current.operand
  return current.kind === 'scalar-literal' ? node.span : null
}

function componentEdit(node: SurfaceExpressionNode): ConstructorComponentEdit | null {
  const span = numericSpan(node)
  if (span) return { kind: 'literal', span }
  let current = node
  let sign: 1 | -1 = 1
  while (current.kind === 'unary-expression' &&
      (current.operator === '+' || current.operator === '-')) {
    if (current.operator === '-') sign = sign === 1 ? -1 : 1
    current = current.operand
  }
  return current.kind === 'reference' && current.property === null
    ? { kind: 'reference', name: current.name, sign }
    : null
}

/**
 * The argument nodes of a constructor call, whichever surface syntax wrote
 * it: the call, `vector(…)`, or a coordinate tuple when the active algebra's
 * tuple denotes that constructor at that arity.
 */
function constructorArguments(
  node: SurfaceExpressionNode,
  constructor: string,
  tuple: TupleConstructor | null,
): readonly SurfaceExpressionNode[] | null {
  if (constructor === 'vector' && node.kind === 'vector-constructor') return node.components
  if (node.kind === 'tuple' && tuple?.constructor === constructor &&
      tuple.arities.includes(node.components.length)) return node.components
  if (node.kind === 'call-expression' && node.callee === constructor) return node.arguments
  return null
}

function componentsOf(
  node: SurfaceExpressionNode,
  constructor: string,
  arity: number,
  tuple: TupleConstructor | null,
): readonly ConstructorComponentEdit[] | null {
  const args = constructorArguments(node, constructor, tuple)
  if (!args || args.length !== arity) return null
  const components = args.map(componentEdit)
  return components.every((component) => component !== null)
    ? components as ConstructorComponentEdit[]
    : null
}

/**
 * The direct-edit components of an item source — a named declaration or an
 * anonymous expression — that is a call to `constructor` with `arity`
 * arguments, or a tuple the active algebra reads as that call, each a literal
 * or a signed name; `null` when the source cannot be rewritten in place
 * (EDIT-003). Rewriting the literals keeps the spelling, tuple or call.
 */
export function directItemConstructorComponents(
  source: string,
  constructor: string,
  arity: number,
  tuple: TupleConstructor | null = null,
): readonly ConstructorComponentEdit[] | null {
  const parsed = parseDocumentExpression(source)
  if (!parsed.ok) return null
  return componentsOf(parsed.source.expression, constructor, arity, tuple)
}

/** The same for a bare expression, such as a position source. */
export function directConstructorComponents(
  source: string,
  constructor: string,
  arity: number,
  tuple: TupleConstructor | null = null,
): readonly ConstructorComponentEdit[] | null {
  const parsed = parseExpression(source)
  return parsed.ok ? componentsOf(parsed.expression, constructor, arity, tuple) : null
}

/**
 * The spellings a drag may rewrite for one entity: `constructor` with
 * `arity` arguments, and, with `weightedConstructor`, the same call with one
 * more trailing weight argument, such as `point(x, y, w)`.
 */
export type LiteralEditSpelling = Readonly<{
  constructor: string
  arity: number
  weightedConstructor?: string
}>

/**
 * What a drag rewrites in an item source: the leading `components`, and for
 * a weighted spelling its `weight`, which the drag never rewrites.
 */
export type LiteralEditTarget = Readonly<{
  components: readonly ConstructorComponentEdit[]
  weight: ConstructorComponentEdit | null
}>

/**
 * The direct-edit target of an item source under `edit`, trying the plain
 * spelling first, then the weighted one (PGA-VIZ-003). A weight written as a
 * name that is also an edited component is refused: rewriting that component
 * would change the weight.
 */
export function directItemLiteralEdit(
  source: string,
  edit: LiteralEditSpelling,
  tuple: TupleSpelling = null,
): LiteralEditTarget | null {
  const plain = directItemConstructorComponents(source, edit.constructor, edit.arity, tuple)
  if (plain) return { components: plain, weight: null }
  if (!edit.weightedConstructor) return null
  const weighted = directItemConstructorComponents(
    source, edit.weightedConstructor, edit.arity + 1, tuple)
  if (!weighted) return null
  const components = weighted.slice(0, edit.arity)
  const weight = weighted[edit.arity]
  if (weight.kind === 'reference' && components.some((component) =>
    component.kind === 'reference' && component.name === weight.name)) return null
  return { components, weight }
}

/**
 * The value of a literal component, such as a weight, read from its source
 * span; `null` for a name.
 */
export function literalComponentValue(
  source: string,
  component: ConstructorComponentEdit,
): number | null {
  if (component.kind !== 'literal') return null
  const parsed = parseExpression(source.slice(component.span.start, component.span.end))
  if (!parsed.ok) return null
  let node = parsed.expression
  let sign = 1
  while (node.kind === 'unary-expression' && (node.operator === '+' || node.operator === '-')) {
    if (node.operator === '-') sign = -sign
    node = node.operand
  }
  return node.kind === 'scalar-literal' ? sign * node.value : null
}

/**
 * Rewrites the literal components in place with the deterministic scalar
 * source format; referenced names are left for their own scalar edits.
 */
export function rewriteConstructorLiterals(
  source: string,
  components: readonly ConstructorComponentEdit[],
  values: readonly number[],
): string {
  return components.flatMap((component, index) => component.kind === 'literal'
    ? [{ span: component.span, value: formatScalarSource(values[index]) }]
    : [])
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((result, replacement) =>
      result.slice(0, replacement.span.start) + replacement.value +
        result.slice(replacement.span.end), source)
}
