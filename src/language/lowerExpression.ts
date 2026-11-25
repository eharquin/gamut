import { LANGUAGE_PROPERTIES, languageFunction } from './functions'
import type {
  ComparisonOperator,
  CoreExpressionNode,
  SurfaceExpressionNode,
} from './ast'

function scalar(value: number, origin: SurfaceExpressionNode['span']): CoreExpressionNode {
  return { kind: 'scalar', value, origin }
}

function lowerBlade(
  name: string,
  origin: SurfaceExpressionNode['span'],
): CoreExpressionNode {
  return { kind: 'basis-blade', name, origin }
}

function multiply(
  left: CoreExpressionNode,
  right: CoreExpressionNode,
  origin: SurfaceExpressionNode['span'],
): CoreExpressionNode {
  return { kind: 'multiply', left, right, origin }
}

function add(
  left: CoreExpressionNode,
  right: CoreExpressionNode,
  origin: SurfaceExpressionNode['span'],
): CoreExpressionNode {
  return { kind: 'add', left, right, origin }
}

const COMPARISONS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', '==', '!='])

function isComparison(operator: string): operator is ComparisonOperator {
  return COMPARISONS.has(operator)
}

/**
 * Desugars surface syntax into the algebra operations understood by the core
 * evaluator while retaining a source origin on every generated operation.
 */
export function lowerExpression(
  expression: SurfaceExpressionNode,
): CoreExpressionNode {
  switch (expression.kind) {
    case 'list-expression':
      return {
        kind: 'list',
        elements: expression.elements.map(lowerExpression),
        elementOrigins: expression.elements.map((element) => element.span),
        origin: expression.span,
      }
    case 'range-expression':
      return {
        kind: 'range',
        start: lowerExpression(expression.start),
        next: expression.next ? lowerExpression(expression.next) : null,
        end: lowerExpression(expression.end),
        origin: expression.span,
      }
    case 'index-expression':
      return {
        kind: 'index',
        object: lowerExpression(expression.object),
        index: lowerExpression(expression.index),
        origin: expression.span,
      }
    case 'scalar-literal':
      return scalar(expression.value, expression.span)
    case 'basis-blade':
      return lowerBlade(expression.name, expression.span)
    case 'pseudoscalar':
      return { kind: 'pseudoscalar', origin: expression.span }
    case 'reference':
      return {
        kind: 'reference',
        name: expression.name,
        property: expression.property,
        origin: expression.span,
      }
    case 'unary-expression': {
      const operand = lowerExpression(expression.operand)
      if (expression.operator === '+') return operand
      if (expression.operator === '-') {
        return { kind: 'negate', operand, origin: expression.span }
      }
      return {
        kind: expression.operator === '~' ? 'reverse' : 'dual',
        operand,
        origin: expression.span,
      }
    }
    case 'binary-expression': {
      const left = lowerExpression(expression.left)
      const right = lowerExpression(expression.right)
      if (isComparison(expression.operator)) {
        return { kind: 'compare', operator: expression.operator, left, right, origin: expression.span }
      }
      if (expression.operator === '*') {
        return multiply(left, right, expression.span)
      }
      if (expression.operator === '%') {
        return { kind: 'modulo', left, right, origin: expression.span }
      }
      if (expression.operator === '/' || expression.operator === '>>>') {
        return {
          kind: expression.operator === '/' ? 'divide' : 'sandwich',
          left,
          right,
          origin: expression.span,
        }
      }
      if (expression.operator === '**') {
        return { kind: 'power', base: left, exponent: right, origin: expression.span }
      }
      if (
        expression.operator === '^' ||
        expression.operator === '|' ||
        expression.operator === '&'
      ) {
        return {
          kind:
            expression.operator === '^'
              ? 'outer'
              : expression.operator === '|'
                ? 'inner'
                : 'regressive',
          left,
          right,
          origin: expression.span,
        }
      }
      return expression.operator === '+'
        ? add(left, right, expression.span)
        : add(
            left,
            { kind: 'negate', operand: right, origin: expression.right.span },
            expression.span,
          )
    }
    case 'tuple':
      // The tuple stays algebra-neutral: the active algebra resolves it.
      return {
        kind: 'tuple',
        components: expression.components.map(lowerExpression),
        origin: expression.span,
      }
    case 'vector-constructor':
      return {
        kind: 'call',
        name: 'vector',
        arguments: expression.components.map(lowerExpression),
        origin: expression.span,
      }
    case 'call-expression': {
      const args = expression.arguments.map(lowerExpression)
      if (expression.callee === 'iterate' && args.length === 3) {
        const [reference] = expression.arguments
        return {
          kind: 'iterate',
          functionName: reference.kind === 'reference' && reference.property === null ? reference.name : null,
          functionOrigin: reference.span,
          initial: args[1],
          count: args[2],
          origin: expression.span,
        }
      }
      if (expression.callee === 'map' && args.length >= 2) {
        const [reference] = expression.arguments
        return {
          kind: 'map',
          functionName: reference.kind === 'reference' && reference.property === null ? reference.name : null,
          functionOrigin: reference.span,
          lists: args.slice(1),
          origin: expression.span,
        }
      }
      if (expression.callee === 'if' && args.length === 3) {
        return { kind: 'conditional', condition: args[0], whenTrue: args[1], whenFalse: args[2], origin: expression.span }
      }
      if (languageFunction(expression.callee)) {
        return { kind: 'function', name: expression.callee, arguments: args, origin: expression.span }
      }
      // Every other call resolves against the active algebra's registered
      // functions at evaluation (ALG-029).
      return { kind: 'call', name: expression.callee, arguments: args, origin: expression.span }
    }
    case 'property-expression': {
      const operand = lowerExpression(expression.object)
      const property = LANGUAGE_PROPERTIES.find((candidate) => candidate.matches(expression.property))
      if (property) return property.lower(operand, expression.property, expression.span)
      return {
        kind: 'unsupported-property',
        operand,
        property: expression.property,
        propertyOrigin: expression.propertySpan,
        // A function of one argument is never a property: `A.norm` and `A.exp` name the call.
        functionForm: languageFunction(expression.property)?.arities.includes(1) ? expression.property : null,
        origin: expression.span,
      }
    }
  }
}
