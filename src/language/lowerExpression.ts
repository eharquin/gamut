import { LANGUAGE_PROPERTIES, REMOVED_PROPERTIES, languageFunction } from './functions'
import type {
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
        functionForm: REMOVED_PROPERTIES.has(expression.property) ? expression.property : null,
        origin: expression.span,
      }
    }
  }
}
