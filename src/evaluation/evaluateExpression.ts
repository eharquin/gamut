import { AlgebraOperationError, type AlgebraEngine } from '../algebra/algebraEngine'
import { permutedBlade } from '../domain/algebraBasis'
import { ownedMultivector, type OwnedMultivector } from '../domain/multivector'
import {
  MAX_GENERATED_VALUES,
  outerConstruction,
  ownedList,
  retainElementIdentity,
  retainOperationSources,
  retainOuterConstruction,
  valueLineage,
  type LanguageValue,
  type ListElement,
} from '../domain/languageValue'
import type { ComparisonOperator, CoreExpressionNode } from '../language/ast'
import { languageFunction, type ListReduction } from '../language/functions'

export class ExpressionEvaluationError extends Error {
  readonly code: string
  readonly origin: CoreExpressionNode['origin']

  constructor(
    code: string,
    message: string,
    origin: CoreExpressionNode['origin'],
  ) {
    super(message)
    this.code = code
    this.origin = origin
  }
}

export type EvaluationBudget = { work: number; generatedValues: number }
const MAX_DOCUMENT_VALUES = 100_000
const MAX_EVALUATION_WORK = 10_000_000
/** Calls to declared functions nested inside one another (#340). */
export const MAX_CALL_DEPTH = 32

type ReferenceResolver = (name: string, property: 'position' | 'head' | null) => LanguageValue

/**
 * A function declared in the document, `name(p1, …) = body` (#340): its
 * parameters, its lowered body, and how the body resolves its other names.
 */
export type UserFunction = Readonly<{
  name: string
  parameters: readonly string[]
  body: CoreExpressionNode
  resolveReference: ReferenceResolver
}>

/** The declared functions a call may reach, and how deep the current call is. */
export type FunctionScope = Readonly<{
  resolve(name: string): UserFunction | undefined
  depth: number
}>

/**
 * Evaluates an owned syntax node exclusively through the supplied algebra
 * capability boundary.
 */
export function evaluateExpression(
  expression: CoreExpressionNode,
  engine: AlgebraEngine,
  resolveReference?: (
    name: string,
    property: 'position' | 'head' | null,
  ) => LanguageValue,
  identityScope?: string,
  budget: EvaluationBudget = { work: 0, generatedValues: 0 },
  functions?: FunctionScope,
): LanguageValue {
  chargeWork(budget, 1, expression)
  try {
    return evaluateExpressionUnchecked(
      expression, engine, resolveReference, identityScope ?? 'source', budget, functions,
    )
  } catch (error) {
    if (error instanceof AlgebraOperationError) {
      throw new ExpressionEvaluationError(error.code, error.message, expression.origin)
    }
    throw error
  }
}

function evaluateExpressionUnchecked(
  expression: CoreExpressionNode,
  engine: AlgebraEngine,
  resolveReference?: (
    name: string,
    property: 'position' | 'head' | null,
  ) => LanguageValue,
  identityScope?: string,
  budget: EvaluationBudget = { work: 0, generatedValues: 0 },
  functions?: FunctionScope,
): LanguageValue {
  const scope = identityScope ?? 'source'
  const evaluate = (node: CoreExpressionNode) =>
    evaluateExpression(node, engine, resolveReference, scope, budget, functions)
  switch (expression.kind) {
    case 'scalar':
      return engine.scalar(expression.value)
    case 'basis-blade': {
      const resolved = resolveBlade(engine, expression.name, expression)
      const value = engine.basisBlade(engine.basis.blades[resolved.index].name)
      return resolved.sign < 0 ? engine.negate(value) : value
    }
    case 'call': {
      const arities = engine.functions.get(expression.name)
      const declared = arities === undefined ? functions?.resolve(expression.name) : undefined
      if (declared) {
        return callUserFunction(expression, declared, expression.arguments.map(evaluate), engine, scope, budget, functions!)
      }
      if (arities === undefined) {
        throw new ExpressionEvaluationError(
          'LANG_UNSUPPORTED_FUNCTION',
          `The function “${expression.name}” is not supported by the active algebra.`,
          expression.origin,
        )
      }
      if (!arities.includes(expression.arguments.length)) {
        const expected = arities.join(' or ')
        throw new ExpressionEvaluationError(
          'LANG_ARITY',
          `“${expression.name}” takes ${expected} ${arities.length === 1 && arities[0] === 1 ? 'argument' : 'arguments'}, received ${expression.arguments.length}.`,
          expression.origin,
        )
      }
      return nary(expression, expression.arguments.map(evaluate),
        (args) => engine.call(expression.name, args), budget)
    }
    case 'tuple': {
      const tuple = engine.tuple
      if (tuple === undefined) {
        throw new ExpressionEvaluationError(
          'LANG_UNSUPPORTED_TUPLE',
          'Coordinate tuples are not supported by the active algebra.',
          expression.origin,
        )
      }
      const count = expression.components.length
      if (!tuple.arities.includes(count)) {
        throw new ExpressionEvaluationError(
          'LANG_ARITY',
          `A coordinate tuple takes ${tuple.arities.join(' or ')} components in this algebra, received ${count}.`,
          expression.origin,
        )
      }
      return nary(expression, expression.components.map(evaluate),
        (args) => engine.call(tuple.constructor, args), budget)
    }
    case 'pseudoscalar':
      return engine.pseudoscalar()
    case 'reference':
      if (!resolveReference) {
        throw new Error(`No value is available for “${expression.name}”.`)
      }
      return resolveReference(expression.name, expression.property)
    case 'list': {
      const elements: ListElement[] = []
      expression.elements.forEach((element, index) => {
        const value = evaluate(element)
        if (value.kind === 'list') {
          throw new ExpressionEvaluationError(
            'LANG_NESTED_LIST',
            `List element ${index} evaluates to a list; nested lists are not supported.`,
            expression.elementOrigins[index],
          )
        }
        const id = `${scope}:literal:${expression.elementOrigins[index].start}:${expression.elementOrigins[index].end}`
        // A referenced value keeps its identity; a computed one keeps the
        // identities of its operands, so it inherits their positions (#88).
        const lineage = valueLineage(value)
        elements.push({
          id,
          value,
          sources: lineage.length > 0 ? lineage : [id],
        })
      })
      chargeElements(budget, elements.length, expression)
      return ownedList(elements)
    }
    case 'range':
      return evaluateRange(expression, evaluate, engine, scope, budget)
    case 'index': {
      const object = evaluate(expression.object)
      if (object.kind !== 'list') {
        throw new ExpressionEvaluationError(
          'LANG_INDEX_TYPE', 'Only a list can be indexed.', expression.object.origin,
        )
      }
      const indexValue = evaluate(expression.index)
      if (indexValue.kind === 'multivector') {
        const index = validatedListIndex(
          indexValue, object.elements.length, expression.index,
        )
        return retainElementIdentity(
          object.elements[index].value,
          object.elements[index].id,
        )
      }
      chargeElements(budget, indexValue.elements.length, expression)
      return ownedList(indexValue.elements.map((indexElement, position) => {
        const index = validatedListIndex(
          indexElement.value, object.elements.length, expression.index, position,
        )
        const selected = object.elements[index]
        const value = ownedMultivector(selected.value.coefficients, selected.value.basis)
        const construction = outerConstruction(selected.value)
        if (construction) retainOuterConstruction(value, construction)
        return {
          id: `${scope}:gather:${expression.origin.start}:${expression.origin.end}:${position}:${indexElement.id}:${selected.id}`,
          value,
          sources: [selected.id],
        }
      }))
    }
    case 'add':
      return binary(expression, evaluate(expression.left), evaluate(expression.right), engine.add, budget)
    case 'multiply':
      return binary(expression, evaluate(expression.left), evaluate(expression.right), engine.multiply, budget)
    case 'divide':
      return binary(expression, evaluate(expression.left), evaluate(expression.right), engine.divide, budget)
    case 'modulo':
      return binary(
        expression,
        evaluate(expression.left),
        evaluate(expression.right),
        (left, right) => scalarModulo(left, right, engine),
        budget,
      )
    case 'sandwich':
      return binary(expression, evaluate(expression.left), evaluate(expression.right),
        (versor, value) => transformedConstruction(engine, versor, value), budget)
    case 'power': {
      return binary(expression, evaluate(expression.base), evaluate(expression.exponent),
        (base, exponent) => engine.power(base, scalarMultivectorBoundary(exponent, expression.exponent, 'A geometric power exponent')), budget)
    }
    case 'outer':
      return binary(expression, evaluate(expression.left), evaluate(expression.right),
        (left, right) => {
          const result = engine.outer(left, right)
          return result === left || result === right
            ? result
            : retainOuterConstruction(result, [left, right])
        }, budget)
    case 'inner':
      return binary(expression, evaluate(expression.left), evaluate(expression.right), engine.inner, budget)
    case 'compare': {
      const operator = expression.operator
      return binary(expression, evaluate(expression.left), evaluate(expression.right),
        (left, right) => engine.scalar(compared(
          operator,
          comparisonOperand(left, 'left'),
          comparisonOperand(right, 'right'),
        ) ? 1 : 0), budget)
    }
    case 'conditional':
      return evaluateConditional(expression, evaluate, budget)
    case 'iterate':
      return evaluateIterate(expression, evaluate, engine, scope, budget, functions)
    case 'regressive':
      return binary(expression, evaluate(expression.left), evaluate(expression.right), engine.regressive, budget)
    case 'negate':
      return unary(expression, evaluate(expression.operand), engine.negate, budget)
    case 'reverse':
      return unary(expression, evaluate(expression.operand), engine.reverse, budget)
    case 'dual':
      return unary(expression, evaluate(expression.operand), engine.dual, budget)
    case 'function': {
      const entry = languageFunction(expression.name)
      if (!entry || !entry.available(engine)) {
        throw new ExpressionEvaluationError(
          'LANG_UNSUPPORTED_FUNCTION',
          `The function “${expression.name}” is not supported by the active algebra.`,
          expression.origin,
        )
      }
      const args = expression.arguments.map(evaluate)
      if (entry.reduction && args.length === 1) {
        return reduceList(expression, expression.name, args[0], entry.reduction, engine, budget)
      }
      const apply = entry.apply
      if (!apply) {
        throw new ExpressionEvaluationError(
          'LANG_ARITY', `“${expression.name}” has no form for ${args.length} arguments.`, expression.origin,
        )
      }
      return entry.distribution === 'operation' && args.length === 1
        ? unary(expression, args[0], (value) => apply(engine, [value]), budget)
        : nary(expression, args, (values) => apply(engine, values), budget)
    }
    case 'grade':
      return unary(expression, evaluate(expression.operand),
        (value) => engine.grade(value, expression.grade), budget)
    case 'coefficient': {
      const resolved = resolveBlade(engine, expression.blade, expression)
      const canonical = engine.basis.blades[resolved.index].name
      return unary(expression, evaluate(expression.operand), (value) => {
        const coefficient = engine.coefficient(value, canonical)
        return resolved.sign < 0 ? engine.negate(coefficient) : coefficient
      }, budget)
    }
    case 'unsupported-property':
      throw new ExpressionEvaluationError(
        'LANG_UNSUPPORTED_PROPERTY',
        expression.functionForm
          ? `The property “${expression.property}” is written as a function: ${expression.functionForm}(…).`
          : `The property “${expression.property}” is not supported.`,
        expression.propertyOrigin,
      )
  }
}

/**
 * A call to a declared function (#340): the arguments are evaluated once,
 * then the body with each parameter bound to its argument and every other
 * name resolved in the document. List results take identities scoped by the
 * call, and a failure in the body fails the call and names the function.
 */
function callUserFunction(
  expression: Readonly<{ origin: CoreExpressionNode['origin'] }>,
  declared: UserFunction,
  args: readonly LanguageValue[],
  engine: AlgebraEngine,
  scope: string,
  budget: EvaluationBudget,
  functions: FunctionScope,
): LanguageValue {
  const count = declared.parameters.length
  if (args.length !== count) {
    throw new ExpressionEvaluationError(
      'LANG_ARITY',
      `“${declared.name}” takes ${count} ${count === 1 ? 'argument' : 'arguments'}, received ${args.length}.`,
      expression.origin,
    )
  }
  if (functions.depth >= MAX_CALL_DEPTH) {
    throw new ExpressionEvaluationError(
      'LIMIT_CALL_DEPTH',
      `Calls to declared functions are nested more than ${MAX_CALL_DEPTH} deep.`,
      expression.origin,
    )
  }
  const bound = new Map(declared.parameters.map((parameter, index) => [parameter, args[index]]))
  try {
    return evaluateExpression(
      declared.body,
      engine,
      (name, property) => {
        const argument = bound.get(name)
        if (argument === undefined) return declared.resolveReference(name, property)
        if (property !== null) {
          throw new ExpressionEvaluationError(
            'LANG_UNSUPPORTED_PROPERTY',
            `The parameter “${name}” has no ${property}.`,
            declared.body.origin,
          )
        }
        return argument
      },
      `${scope}:call:${expression.origin.start}:${expression.origin.end}`,
      budget,
      { resolve: functions.resolve, depth: functions.depth + 1 },
    )
  } catch (error) {
    if (!(error instanceof ExpressionEvaluationError)) throw error
    // The body belongs to another row, so the call carries the diagnostic;
    // a limit keeps its message, any other failure names the chain of
    // functions, as in `In “f”: In “g”: …`.
    const message = error.code.startsWith('LIMIT_')
      ? error.message
      : `In “${declared.name}”: ${error.message}`
    throw new ExpressionEvaluationError(error.code, message, expression.origin)
  }
}

/** Resolves a blade name in any generator order against the engine's basis. */
function resolveBlade(
  engine: AlgebraEngine,
  name: string,
  expression: CoreExpressionNode,
): Readonly<{ index: number; sign: 1 | -1 }> {
  const resolved = permutedBlade(engine.basis, name)
  if (!resolved) {
    throw new ExpressionEvaluationError(
      'ALG_UNKNOWN_BLADE',
      `The blade “${name}” does not exist in the active algebra.`,
      expression.origin,
    )
  }
  return resolved
}

function scalarMultivectorBoundary(
  value: OwnedMultivector,
  expression: CoreExpressionNode,
  label: string,
): number {
  if (value.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
    throw new ExpressionEvaluationError(
      'ALG_DOMAIN', `${label} must be scalar.`, expression.origin,
    )
  }
  return value.coefficients[0]
}

function scalarBoundary(
  value: LanguageValue,
  expression: CoreExpressionNode,
  label: string,
): number {
  if (value.kind === 'list') {
    throw new ExpressionEvaluationError(
      'LANG_SCALAR_REQUIRED', `${label} must be one scalar value.`, expression.origin,
    )
  }
  return scalarMultivectorBoundary(value, expression, label)
}

function validatedListIndex(
  value: OwnedMultivector,
  length: number,
  expression: CoreExpressionNode,
  position?: number,
): number {
  const positionPrefix = position === undefined ? '' : `Index-list element ${position}: `
  if (value.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
    throw new ExpressionEvaluationError(
      'ALG_DOMAIN', `${positionPrefix}A list index must be scalar.`, expression.origin,
    )
  }
  const index = value.coefficients[0]
  if (!Number.isInteger(index) || index < 0) {
    throw new ExpressionEvaluationError(
      'LANG_INDEX_DOMAIN',
      `${positionPrefix}A list index must be a non-negative integer.`,
      expression.origin,
    )
  }
  if (index >= length) {
    throw new ExpressionEvaluationError(
      'LANG_INDEX_RANGE',
      `${positionPrefix}List index ${index} is out of range for ${length} elements.`,
      expression.origin,
    )
  }
  return index
}

function scalarModulo(
  left: OwnedMultivector,
  right: OwnedMultivector,
  engine: AlgebraEngine,
): OwnedMultivector {
  if (left.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
    throw new AlgebraOperationError(
      'ALG_DOMAIN', 'The left operand of modulo must be scalar.',
    )
  }
  if (right.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
    throw new AlgebraOperationError(
      'ALG_DOMAIN', 'The right operand of modulo must be scalar.',
    )
  }
  const dividend = left.coefficients[0]
  const modulus = right.coefficients[0]
  if (modulus <= 0) {
    throw new AlgebraOperationError(
      'ALG_DOMAIN', 'The right operand of modulo must be greater than zero.',
    )
  }
  const remainder = dividend % modulus
  return engine.scalar(remainder < 0 ? (remainder + modulus) % modulus : remainder)
}

/**
 * Applies a versor sandwich and carries an outer-product construction through
 * it: each spanning side goes through the same sandwich (#87). A side that
 * cannot be transformed drops the construction; the interpretation still
 * checks that the transformed sides span the transformed value.
 */
function transformedConstruction(
  engine: AlgebraEngine,
  versor: OwnedMultivector,
  value: OwnedMultivector,
): OwnedMultivector {
  const result = engine.sandwich(versor, value)
  const construction = outerConstruction(value)
  if (!construction || result === value || result === versor) return result
  try {
    return retainOuterConstruction(result, [
      engine.sandwich(versor, construction[0]),
      engine.sandwich(versor, construction[1]),
    ])
  } catch (error) {
    if (error instanceof AlgebraOperationError) return result
    throw error
  }
}

/** A pure grade-zero comparison operand, or a domain error naming its side. */
function comparisonOperand(value: OwnedMultivector, side: 'left' | 'right'): number {
  if (value.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
    throw new AlgebraOperationError('ALG_DOMAIN', `The ${side} operand of a comparison must be scalar.`)
  }
  return value.coefficients[0]
}

/** An exact IEEE 754 comparison; no tolerance applies (#339). */
function compared(operator: ComparisonOperator, left: number, right: number): boolean {
  switch (operator) {
    case '<': return left < right
    case '<=': return left <= right
    case '>': return left > right
    case '>=': return left >= right
    case '==': return left === right
    case '!=': return left !== right
  }
}

/** The condition of `if` as a truth value: a scalar is true when it is not zero. */
function conditionTruth(value: OwnedMultivector, expression: CoreExpressionNode, position?: number): boolean {
  const prefix = position === undefined ? '' : `Condition element ${position}: `
  if (value.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
    throw new ExpressionEvaluationError(
      'ALG_DOMAIN', `${prefix}The condition of “if” must be scalar.`, expression.origin,
    )
  }
  return value.coefficients[0] !== 0
}

/**
 * `if(condition, whenTrue, whenFalse)` (#339). A single condition evaluates
 * only the branch it selects, so the other may fail without failing the
 * expression. A list condition selects element by element: the condition and
 * the list branches follow the broadcasting rules of `binary`, and each
 * branch is evaluated only when at least one element selects it. An empty
 * condition selects nothing and gives an empty list.
 */
function evaluateConditional(
  expression: Extract<CoreExpressionNode, { kind: 'conditional' }>,
  evaluate: (expression: CoreExpressionNode) => LanguageValue,
  budget: EvaluationBudget,
): LanguageValue {
  const condition = evaluate(expression.condition)
  if (condition.kind === 'multivector') {
    return evaluate(conditionTruth(condition, expression.condition) ? expression.whenTrue : expression.whenFalse)
  }
  const truths = condition.elements.map((element, index) =>
    conditionTruth(element.value, expression.condition, index))
  if (truths.length === 0) return ownedList([])
  const whenTrue = truths.includes(true) ? evaluate(expression.whenTrue) : null
  const whenFalse = truths.includes(false) ? evaluate(expression.whenFalse) : null
  const lengths = [condition, whenTrue, whenFalse]
    .flatMap((value) => (value?.kind === 'list' ? [value.elements.length] : []))
  if (lengths.some((length) => length === 0)) {
    throw new ExpressionEvaluationError(
      'LANG_LIST_LENGTH', 'An empty list is incompatible with a non-empty list.', expression.origin,
    )
  }
  const length = Math.max(...lengths)
  if (lengths.some((candidate) => candidate !== 1 && candidate !== length)) {
    throw new ExpressionEvaluationError(
      'LANG_LIST_LENGTH',
      `List lengths ${[...new Set(lengths)].join(' and ')} are incompatible.`,
      expression.origin,
    )
  }
  chargeElements(budget, length, expression)
  const pick = <T,>(elements: readonly T[], index: number) => elements[elements.length === 1 ? 0 : index]
  return ownedList(Array.from({ length }, (_, index) => {
    const conditionElement = pick(condition.elements, index)
    const truth = pick(truths, index)
    // A singleton condition selects one branch for every element, which
    // was evaluated only if it is selected.
    const selected = (truth ? whenTrue : whenFalse)!
    const element = selected.kind === 'list' ? pick(selected.elements, index) : null
    const value = element?.value ?? selected as OwnedMultivector
    // A copy, so that the list never takes over the identity of the value it
    // selects, which may be another item's (as in a gather).
    const copy = ownedMultivector(value.coefficients, value.basis)
    const construction = outerConstruction(value)
    if (construction) retainOuterConstruction(copy, construction)
    const sources = element ? [element.id] : valueLineage(value)
    return {
      id: `${expression.origin.start}:${expression.origin.end}:${index}:${conditionElement.id}:${element?.id ?? (truth ? 'true' : 'false')}`,
      value: copy,
      sources: [...new Set([conditionElement.id, ...sources])],
    }
  }))
}

/**
 * `iterate(f, x0, n)` (#341): the list `[x0, f(x0), …, f^n(x0)]` of `n + 1`
 * states. `f` is a declared function of one parameter, every state a single
 * value, and `n` a non-negative integer; the length is checked against the
 * generated-value limit before the first step. Element `k` has an identity
 * derived from the node and `k`, so labels stay attached when `n` changes.
 */
function evaluateIterate(
  expression: Extract<CoreExpressionNode, { kind: 'iterate' }>,
  evaluate: (expression: CoreExpressionNode) => LanguageValue,
  engine: AlgebraEngine,
  scope: string,
  budget: EvaluationBudget,
  functions: FunctionScope | undefined,
): LanguageValue {
  const declared = expression.functionName === null ? undefined : functions?.resolve(expression.functionName)
  if (!declared) {
    throw new ExpressionEvaluationError(
      'LANG_ITERATE_FUNCTION',
      expression.functionName === null
        ? 'The first argument of “iterate” shall be the name of a declared function.'
        : `“${expression.functionName}” is not a declared function.`,
      expression.functionOrigin,
    )
  }
  if (declared.parameters.length !== 1) {
    throw new ExpressionEvaluationError(
      'LANG_ARITY',
      `“iterate” needs a function of one parameter; “${declared.name}” takes ${declared.parameters.length}.`,
      expression.functionOrigin,
    )
  }
  const countValue = evaluate(expression.count)
  if (countValue.kind === 'list') {
    throw new ExpressionEvaluationError(
      'LANG_SCALAR_REQUIRED', 'The step count of “iterate” must be one scalar value.', expression.count.origin,
    )
  }
  const steps = scalarMultivectorBoundary(countValue, expression.count, 'The step count of “iterate”')
  if (!Number.isInteger(steps) || steps < 0) {
    throw new ExpressionEvaluationError(
      'LANG_INDEX_DOMAIN', 'The step count of “iterate” must be a non-negative integer.', expression.count.origin,
    )
  }
  if (steps + 1 > MAX_GENERATED_VALUES) {
    throw new ExpressionEvaluationError(
      'LIMIT_GENERATED_VALUES',
      Number.isSafeInteger(steps + 1)
        ? `This iteration would generate ${steps + 1} elements; the limit is ${MAX_GENERATED_VALUES}.`
        : `This iteration would generate more than ${MAX_GENERATED_VALUES} elements, the limit.`,
      expression.origin,
    )
  }
  const initial = evaluate(expression.initial)
  if (initial.kind === 'list') {
    throw new ExpressionEvaluationError(
      'LANG_NESTED_LIST', 'The initial state of “iterate” must be one value, not a list.', expression.initial.origin,
    )
  }
  chargeElements(budget, steps + 1, expression)
  const states: OwnedMultivector[] = [initial]
  for (let step = 1; step <= steps; step += 1) {
    let next: LanguageValue
    try {
      next = callUserFunction(expression, declared, [states[step - 1]], engine,
        `${scope}:iterate:${expression.origin.start}:${expression.origin.end}:${step}`, budget, functions!)
    } catch (error) {
      if (!(error instanceof ExpressionEvaluationError) || error.code.startsWith('LIMIT_')) throw error
      throw new ExpressionEvaluationError(error.code, `Step ${step}: ${error.message}`, expression.origin)
    }
    if (next.kind === 'list') {
      throw new ExpressionEvaluationError(
        'LANG_NESTED_LIST', `Step ${step}: “${declared.name}” returns a list; each state must be one value.`, expression.origin,
      )
    }
    states.push(next)
  }
  return ownedList(states.map((state, ordinal) => {
    const id = `${scope}:iterate:${expression.origin.start}:${expression.origin.end}:${ordinal}`
    // A copy, so that a state never takes over the identity of the value it
    // came from, such as the initial item; it keeps that value's lineage, so
    // a positioned vector stays at its position.
    const value = ownedMultivector(state.coefficients, state.basis)
    const construction = outerConstruction(state)
    if (construction) retainOuterConstruction(value, construction)
    const lineage = valueLineage(state)
    return { id, value, sources: lineage.length > 0 ? lineage : [id] }
  }))
}

/**
 * A one-argument reduction such as `min(L)` or `sum(L)` (#338): the argument
 * shall be a list, and its elements are combined in list order into one
 * value. A rejected element fails the call with its index.
 */
function reduceList(
  expression: CoreExpressionNode,
  name: string,
  value: LanguageValue,
  reduction: ListReduction,
  engine: AlgebraEngine,
  budget: EvaluationBudget,
): LanguageValue {
  if (value.kind !== 'list') {
    throw new ExpressionEvaluationError(
      'LANG_LIST_REQUIRED',
      name === 'sum'
        ? '“sum” takes a list.'
        : `“${name}” of one argument takes a list; write ${name}(a, b) for two values.`,
      expression.origin,
    )
  }
  chargeWork(budget, value.elements.length, expression)
  const values = value.elements.map((element, index) => {
    try {
      reduction.element?.(element.value)
    } catch (error) {
      if (error instanceof AlgebraOperationError) {
        throw new ExpressionEvaluationError(
          error.code, `List element ${index}: ${error.message}`, expression.origin,
        )
      }
      throw error
    }
    return element.value
  })
  if (values.length === 0) {
    const empty = reduction.empty(engine)
    if (empty === null) {
      throw new ExpressionEvaluationError(
        'ALG_DOMAIN', `“${name}” of an empty list is undefined.`, expression.origin,
      )
    }
    return empty
  }
  // The first element is copied, so that a one-element list never returns
  // the element itself with its identity: `sum([V])` is not an alias of `V`.
  const first = ownedMultivector(values[0].coefficients, values[0].basis)
  return withLineage(
    values.slice(1).reduce((accumulated, next) => reduction.combine(engine, accumulated, next), first),
    values,
  )
}

/** Records operand lineage on a freshly computed single value. */
function withLineage(
  result: OwnedMultivector,
  operands: readonly OwnedMultivector[],
): OwnedMultivector {
  if (operands.includes(result)) return result
  return retainOperationSources(result, operands.flatMap(valueLineage))
}

function unary(
  expression: CoreExpressionNode,
  value: LanguageValue,
  operation: (value: OwnedMultivector) => OwnedMultivector,
  budget: EvaluationBudget,
): LanguageValue {
  if (value.kind === 'multivector') return withLineage(operation(value), [value])
  chargeElements(budget, value.elements.length, expression)
  return ownedList(value.elements.map((element, index) => {
    try {
      return { id: element.id, value: operation(element.value), sources: element.sources }
    } catch (error) {
      if (error instanceof AlgebraOperationError) {
        throw new ExpressionEvaluationError(
          error.code, `List element ${index}: ${error.message}`, expression.origin,
        )
      }
      throw error
    }
  }))
}

/**
 * Applies an n-ary operation with the list broadcasting rules of `binary`:
 * every list argument has the common length or length one.
 */
function nary(
  expression: CoreExpressionNode,
  values: readonly LanguageValue[],
  operation: (args: readonly OwnedMultivector[]) => OwnedMultivector,
  budget: EvaluationBudget,
): LanguageValue {
  const lists = values.map((value) => (value.kind === 'list' ? value.elements : null))
  if (lists.every((elements) => elements === null)) {
    return withLineage(operation(values as OwnedMultivector[]), values as OwnedMultivector[])
  }
  const lengths = lists.flatMap((elements) => (elements ? [elements.length] : []))
  if (lengths.some((length) => length === 0)) {
    if (lengths.every((length) => length === 0)) return ownedList([])
    throw new ExpressionEvaluationError(
      'LANG_LIST_LENGTH', 'An empty list is incompatible with a non-empty list.', expression.origin,
    )
  }
  const length = Math.max(...lengths)
  if (lengths.some((candidate) => candidate !== 1 && candidate !== length)) {
    throw new ExpressionEvaluationError(
      'LANG_LIST_LENGTH',
      `List lengths ${[...new Set(lengths)].join(' and ')} are incompatible.`,
      expression.origin,
    )
  }
  chargeElements(budget, length, expression)
  const elements: ListElement[] = []
  for (let index = 0; index < length; index += 1) {
    const picked = lists.map((candidates) =>
      candidates ? candidates[candidates.length === 1 ? 0 : index] : null)
    try {
      const result = operation(picked.map((element, position) =>
        element?.value ?? values[position] as OwnedMultivector))
      const participating = picked.map((element) => element?.id).filter(Boolean).join(':')
      elements.push({
        id: `${expression.origin.start}:${expression.origin.end}:${participating}`,
        value: result,
        sources: [...new Set(picked.flatMap((element) => (element ? [element.id] : [])))],
      })
    } catch (error) {
      if (error instanceof AlgebraOperationError) {
        throw new ExpressionEvaluationError(
          error.code, `List element ${index}: ${error.message}`, expression.origin,
        )
      }
      throw error
    }
  }
  return ownedList(elements)
}

function binary(
  expression: CoreExpressionNode,
  left: LanguageValue,
  right: LanguageValue,
  operation: (left: OwnedMultivector, right: OwnedMultivector) => OwnedMultivector,
  budget: EvaluationBudget,
): LanguageValue {
  if (left.kind === 'multivector' && right.kind === 'multivector') {
    return withLineage(operation(left, right), [left, right])
  }
  if (left.kind === 'list' && right.kind === 'list') {
    if (left.elements.length === 0 && right.elements.length === 0) return ownedList([])
    if (left.elements.length === 0 || right.elements.length === 0) {
      throw new ExpressionEvaluationError(
        'LANG_LIST_LENGTH', 'An empty list is incompatible with a non-empty list.', expression.origin,
      )
    }
    if (
      left.elements.length !== right.elements.length &&
      left.elements.length !== 1 && right.elements.length !== 1
    ) {
      throw new ExpressionEvaluationError(
        'LANG_LIST_LENGTH',
        `List lengths ${left.elements.length} and ${right.elements.length} are incompatible.`,
        expression.origin,
      )
    }
  }

  const leftElements = left.kind === 'list' ? left.elements : null
  const rightElements = right.kind === 'list' ? right.elements : null
  const length = Math.max(leftElements?.length ?? 0, rightElements?.length ?? 0)
  if (length === 0) return ownedList([])
  chargeElements(budget, length, expression)
  const elements: ListElement[] = []
  for (let index = 0; index < length; index += 1) {
    const leftElement = leftElements
      ? leftElements[leftElements.length === 1 ? 0 : index]
      : null
    const rightElement = rightElements
      ? rightElements[rightElements.length === 1 ? 0 : index]
      : null
    try {
      const result = operation(
        leftElement?.value ?? left as OwnedMultivector,
        rightElement?.value ?? right as OwnedMultivector,
      )
      const participating = [leftElement?.id, rightElement?.id].filter(Boolean).join(':')
      elements.push({
        id: `${expression.origin.start}:${expression.origin.end}:${participating}`,
        value: result,
        sources: [...new Set([
          ...(leftElement ? [leftElement.id] : []),
          ...(rightElement ? [rightElement.id] : []),
        ])],
      })
    } catch (error) {
      if (error instanceof AlgebraOperationError) {
        throw new ExpressionEvaluationError(
          error.code, `List element ${index}: ${error.message}`, expression.origin,
        )
      }
      throw error
    }
  }
  return ownedList(elements)
}

function evaluateRange(
  expression: Extract<CoreExpressionNode, { kind: 'range' }>,
  evaluate: (expression: CoreExpressionNode) => LanguageValue,
  engine: AlgebraEngine,
  identityScope: string,
  budget: EvaluationBudget,
): LanguageValue {
  const start = scalarBoundary(evaluate(expression.start), expression.start, 'A range start')
  const end = scalarBoundary(evaluate(expression.end), expression.end, 'A range end')
  const next = expression.next
    ? scalarBoundary(evaluate(expression.next), expression.next, 'A range next term')
    : null
  if (![start, end, next ?? 0].every(Number.isInteger)) {
    throw new ExpressionEvaluationError(
      'LANG_RANGE_INTEGER', 'Range terms must be finite integers.', expression.origin,
    )
  }
  const step = next === null ? (start <= end ? 1 : -1) : next - start
  if (step === 0 ||
      (start !== end && Math.sign(step) !== Math.sign(end - start))) {
    throw new ExpressionEvaluationError(
      'LANG_RANGE_DIRECTION', 'A range step must be non-zero and directed toward the end.', expression.origin,
    )
  }
  const count = start === end ? 1 : Math.floor(Math.abs((end - start) / step)) + 1
  if (count > MAX_GENERATED_VALUES) {
    throw new ExpressionEvaluationError(
      'LIMIT_GENERATED_VALUES',
      `This range would generate ${count} elements; the limit is ${MAX_GENERATED_VALUES}.`,
      expression.origin,
    )
  }
  chargeElements(budget, count, expression)
  return ownedList(Array.from({ length: count }, (_, ordinal) => {
    const id = `${identityScope}:range:${expression.origin.start}:${expression.origin.end}:${ordinal}`
    return { id, value: engine.scalar(start + ordinal * step), sources: [id] }
  }))
}

function chargeWork(
  budget: EvaluationBudget,
  amount: number,
  expression: CoreExpressionNode,
): void {
  budget.work += amount
  if (budget.work > MAX_EVALUATION_WORK) {
    throw new ExpressionEvaluationError(
      'LIMIT_EVALUATION_WORK',
      `Document evaluation exceeded ${MAX_EVALUATION_WORK} deterministic work units.`,
      expression.origin,
    )
  }
}

function chargeElements(
  budget: EvaluationBudget,
  amount: number,
  expression: CoreExpressionNode,
): void {
  budget.generatedValues += amount
  chargeWork(budget, amount, expression)
  if (budget.generatedValues > MAX_DOCUMENT_VALUES) {
    throw new ExpressionEvaluationError(
      'LIMIT_DOCUMENT_VALUES',
      `Document evaluation exceeded ${MAX_DOCUMENT_VALUES} generated element records.`,
      expression.origin,
    )
  }
}
