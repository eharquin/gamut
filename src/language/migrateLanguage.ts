import type { SourceSpan } from '../domain/diagnostic'
import type { SurfaceExpressionNode } from './ast'
import { REMOVED_PROPERTIES } from './functions'
import { parseDocumentExpression } from './parseExpression'

/**
 * The language version this build reads and writes (language section 15).
 * Version 2 writes the operations on a value as functions, `norm(A)`, where
 * version 1 wrote the postfix properties `A.norm`.
 */
export const CURRENT_LANGUAGE_VERSION = 2

/** The direct sub-expressions of a node, in source order. */
function children(node: SurfaceExpressionNode): readonly SurfaceExpressionNode[] {
  switch (node.kind) {
    case 'scalar-literal':
    case 'basis-blade':
    case 'pseudoscalar':
    case 'reference':
      return []
    case 'property-expression':
      return [node.object]
    case 'unary-expression':
      return [node.operand]
    case 'binary-expression':
      return [node.left, node.right]
    case 'vector-constructor':
    case 'tuple':
      return node.components
    case 'call-expression':
      return node.arguments
    case 'list-expression':
      return node.elements
    case 'range-expression':
      return node.next ? [node.start, node.next, node.end] : [node.start, node.end]
    case 'index-expression':
      return [node.object, node.index]
  }
}

/** Whether the text is one parenthesized group, `(…)`, and not `(a) + (b)`. */
function enclosedInParentheses(text: string): boolean {
  if (!text.startsWith('(') || !text.endsWith(')')) return false
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    else if (text[index] === ')') depth -= 1
    if (depth === 0 && index < text.length - 1) return false
  }
  return true
}

/** The source of a node with every removed property below it written as a call. */
function rewritten(source: string, node: SurfaceExpressionNode): string {
  if (node.kind === 'property-expression' && REMOVED_PROPERTIES.has(node.property)) {
    const operand = rewritten(source, node.object)
    // `(A + B).norm` is `norm(A + B)`; a tuple keeps its parentheses.
    const argument = node.object.kind !== 'tuple' && enclosedInParentheses(operand) ? operand.slice(1, -1) : operand
    return `${node.property}(${argument})`
  }
  if (node.kind === 'binary-expression' && node.implicit) {
    // `2e1.norm` cannot become `2norm(e1)`: implicit multiplication only
    // joins a number to a blade, a constant or the pseudoscalar, so it is
    // written out.
    const right = rewritten(source, node.right)
    if (/^[A-Za-z_]/.test(right) && right !== source.slice(node.right.span.start, node.right.span.end)) {
      return `(${rewritten(source, node.left)} * ${right})`
    }
  }
  return spliced(source, node.span, children(node))
}

/** The text of a span with each child replaced by its rewritten text. */
function spliced(source: string, span: SourceSpan, nodes: readonly SurfaceExpressionNode[]): string {
  let text = ''
  let offset = span.start
  for (const child of nodes) {
    text += source.slice(offset, child.span.start) + rewritten(source, child)
    offset = child.span.end
  }
  return text + source.slice(offset, span.end)
}

/**
 * Rewrites a language version 1 source in version 2: `A.norm` becomes
 * `norm(A)`, and likewise `inorm`, `dual`, `inverse`, `reverse` and
 * `involution`. Only those properties change; a source that does not parse
 * is returned unchanged and keeps its diagnostic.
 */
export function migrateSourceToVersion2(source: string): string {
  if (!/\.\s*(norm|inorm|dual|inverse|reverse|involution)\b/.test(source)) return source
  try {
    const parsed = parseDocumentExpression(source)
    if (!parsed.ok) return source
    const { expression } = parsed.source
    return source.slice(0, expression.span.start) + rewritten(source, expression) +
      source.slice(expression.span.end)
  } catch (error) {
    // A source nested too deeply to parse or rewrite is kept as written.
    if (error instanceof RangeError) return source
    throw error
  }
}

/**
 * Rewrites the `${…}` insertions of a label text with
 * `migrateSourceToVersion2`; the literal text, `\$` included, is unchanged.
 */
export function migrateLabelToVersion2(text: string): string {
  let result = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '\\' && text[index + 1] === '$') {
      result += '\\$'
      index += 2
      continue
    }
    if (text[index] === '$' && text[index + 1] === '{') {
      let depth = 1
      let end = index + 2
      for (; end < text.length && depth > 0; end += 1) {
        if (text[end] === '{') depth += 1
        else if (text[end] === '}') depth -= 1
      }
      if (depth > 0) return result + text.slice(index)
      result += '${' + migrateSourceToVersion2(text.slice(index + 2, end - 1)) + '}'
      index = end
      continue
    }
    result += text[index]
    index += 1
  }
  return result
}
