import type { AlgebraEngine } from '../algebra/algebraEngine'
import type { ExpressionControl } from '../document/expressionDocument'
import type { Diagnostic, SourceSpan } from '../domain/diagnostic'
import type { LanguageValue } from '../domain/languageValue'
import { evaluateExpression, ExpressionEvaluationError, type FunctionScope } from '../evaluation/evaluateExpression'
import type { SurfaceExpressionNode } from '../language/ast'
import { declaredName } from '../language/declaredName'
import { lowerExpression } from '../language/lowerExpression'
import { parseDocumentExpression, parseExpression } from '../language/parseExpression'
import { languageFunction } from '../language/functions'
import type { EvaluatedDocumentItem } from './evaluateDocument'

export type ScalarControlField = 'minimum' | 'maximum' | 'step'
export type ScalarControlFieldState =
  /** `derived` marks an empty field whose value is derived from the scalar. */
  | Readonly<{ status: 'valid'; value: number; derived?: true }>
  | Readonly<{ status: 'invalid'; diagnostic: Diagnostic }>

export type ScalarControlEvaluation = Readonly<{
  fields: Readonly<Record<ScalarControlField, ScalarControlFieldState>>
  status: 'valid' | 'invalid'
  minimum: number | null
  maximum: number | null
  step: number | null
  diagnostic: string | null
}>

function references(expression: SurfaceExpressionNode): readonly Readonly<{
  name: string
  property: 'position' | 'head' | null
  span: SourceSpan
}>[] {
  switch (expression.kind) {
    case 'reference': return [expression]
    case 'unary-expression': return references(expression.operand)
    case 'binary-expression': return [...references(expression.left), ...references(expression.right)]
    case 'property-expression': return references(expression.object)
    case 'vector-constructor':
    case 'tuple': return expression.components.flatMap(references)
    // The function `iterate` or `map` names is not a value (#341, #360).
    case 'call-expression': return (iteratedName(expression)
      ? expression.arguments.slice(1) : expression.arguments).flatMap(references)
    case 'list-expression': return expression.elements.flatMap(references)
    case 'range-expression': return [expression.start, ...(expression.next ? [expression.next] : []), expression.end].flatMap(references)
    case 'index-expression': return [...references(expression.object), ...references(expression.index)]
    default: return []
  }
}

/** The function `iterate(f, …)` or `map(f, …)` names, which is called, not used as a value (#341, #360). */
function iteratedName(expression: SurfaceExpressionNode): Readonly<{ name: string; span: SourceSpan }> | null {
  if (expression.kind !== 'call-expression' || (expression.callee !== 'iterate' && expression.callee !== 'map')) return null
  const [first] = expression.arguments
  return first?.kind === 'reference' && first.property === null ? { name: first.name, span: first.span } : null
}

/** The calls of a source to names that are not common-language functions (#340), and the function `iterate` or `map` names. */
function calls(expression: SurfaceExpressionNode): readonly Readonly<{ name: string; span: SourceSpan }>[] {
  const iterated = iteratedName(expression)
  const own = expression.kind === 'call-expression' && !languageFunction(expression.callee)
    ? [{ name: expression.callee, span: expression.span }]
    : iterated ? [iterated] : []
  const children = (): readonly SurfaceExpressionNode[] => {
    switch (expression.kind) {
      case 'unary-expression': return [expression.operand]
      case 'binary-expression': return [expression.left, expression.right]
      case 'property-expression': return [expression.object]
      case 'vector-constructor':
      case 'tuple': return expression.components
      case 'call-expression': return expression.arguments
      case 'list-expression': return expression.elements
      case 'range-expression': return [expression.start, ...(expression.next ? [expression.next] : []), expression.end]
      case 'index-expression': return [expression.object, expression.index]
      default: return []
    }
  }
  return [...own, ...children().flatMap(calls)]
}

function invalid(code: string, message: string, span: SourceSpan): Readonly<{ status: 'invalid'; diagnostic: Diagnostic }> {
  return { status: 'invalid', diagnostic: { code, severity: 'error', message, span } }
}

/** Diagnostic codes and messages for a source that is not a finite real scalar. */
export type ScalarSourceMessages = Readonly<{
  nonScalar: Readonly<{ code: string; message: string }>
  nonFinite: Readonly<{ code: string; message: string }>
}>

const CONTROL_MESSAGES: ScalarSourceMessages = {
  nonScalar: { code: 'CTRL_NON_SCALAR', message: 'A control bound must evaluate to a pure scalar.' },
  nonFinite: { code: 'CTRL_NON_FINITE', message: 'A control bound must be finite.' },
}

/**
 * Evaluates scalar sources that depend on the document's value nodes but that
 * no source can reference: slider bounds and appearance sources. Names
 * resolve to the evaluated value of the uniquely declared item.
 */
export function scalarSourceEvaluator(
  items: readonly EvaluatedDocumentItem[],
  engine: AlgebraEngine,
): (source: string, messages?: ScalarSourceMessages) => ScalarControlFieldState {
  const evaluateValue = valueSourceEvaluator(items, engine)
  return (source, messages = CONTROL_MESSAGES) => {
    const result = evaluateValue(source)
    if (result.status === 'invalid') return result
    const { value, span } = result
    if (value.kind !== 'multivector' || value.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
      return invalid(messages.nonScalar.code, messages.nonScalar.message, span)
    }
    const scalar = value.coefficients[0]
    if (!Number.isFinite(scalar)) return invalid(messages.nonFinite.code, messages.nonFinite.message, span)
    return { status: 'valid', value: scalar }
  }
}

export type SourceValueState =
  | Readonly<{ status: 'valid'; value: LanguageValue; span: SourceSpan }>
  | Readonly<{ status: 'invalid'; diagnostic: Diagnostic }>

/**
 * Evaluates a source like `scalarSourceEvaluator` does, but returns any value:
 * the inserted values of a label take multivectors and lists as well.
 */
export function valueSourceEvaluator(
  items: readonly EvaluatedDocumentItem[],
  engine: AlgebraEngine,
): (source: string) => SourceValueState {
  const declarations = new Map<string, EvaluatedDocumentItem[]>()
  items.forEach((item) => {
    const name = declaredName(item.item.source)
    if (!name) return
    declarations.set(name, [...(declarations.get(name) ?? []), item])
  })

  // Labels and bounds may call the functions the document declares (#340).
  const functions: FunctionScope = {
    depth: 0,
    resolve: (name) => {
      const targets = declarations.get(name)
      const evaluation = targets?.length === 1 ? targets[0].evaluation : null
      return evaluation?.status === 'function' ? evaluation.definition : undefined
    },
  }

  return (source) => {
    const parsed = parseExpression(source)
    if (!parsed.ok) return { status: 'invalid', diagnostic: parsed.diagnostic }
    const resolved = new Map<string, LanguageValue>()
    for (const reference of references(parsed.expression)) {
      if (reference.property !== null) return invalid(
        'CTRL_UNSUPPORTED_REFERENCE',
        'Control bounds may reference scalar values only.',
        reference.span,
      )
      const targets = declarations.get(reference.name)
      if (!targets) return invalid('LANG_UNDEFINED_NAME', `The name “${reference.name}” is not defined.`, reference.span)
      if (targets.length !== 1) return invalid('LANG_DUPLICATE_NAME', `The name “${reference.name}” is declared more than once.`, reference.span)
      const evaluation = targets[0].evaluation
      if (evaluation?.status === 'function') return invalid('LANG_FUNCTION_VALUE', `“${reference.name}” is a function: call it, as in ${evaluation.signature}.`, reference.span)
      if (evaluation?.status !== 'valid') return invalid('LANG_INVALID_DEPENDENCY', `The dependency “${reference.name}” is invalid.`, reference.span)
      resolved.set(reference.name, evaluation.value)
    }
    // A call to a declared name needs a valid function, as in a row.
    for (const call of calls(parsed.expression)) {
      const targets = declarations.get(call.name)
      if (!targets || engine.functions.has(call.name)) continue
      if (targets.length !== 1) return invalid('LANG_DUPLICATE_NAME', `The name “${call.name}” is declared more than once.`, call.span)
      const evaluation = targets[0].evaluation
      if (evaluation?.status === 'function') continue
      const declared = parseDocumentExpression(targets[0].item.source)
      return declared.ok && declared.source.declaration?.parameters
        ? invalid('LANG_INVALID_DEPENDENCY', `The function “${call.name}” is invalid.`, call.span)
        : invalid('LANG_NOT_A_FUNCTION', `“${call.name}” is not a function.`, call.span)
    }
    let value: LanguageValue
    try {
      value = evaluateExpression(
        lowerExpression(parsed.expression),
        engine,
        (name) => resolved.get(name)!,
        'scalar-control',
        { work: 0, generatedValues: 0 },
        functions,
      )
    } catch (error) {
      if (!(error instanceof ExpressionEvaluationError)) throw error
      return invalid(error.code, error.message, error.origin)
    }
    return { status: 'valid', value, span: parsed.expression.span }
  }
}

/** The interval an empty bound falls back to while the scalar lies inside it. */
export const DERIVED_SLIDER_BOUND = 10
/** An empty step divides the slider's interval into this many steps. */
export const DERIVED_SLIDER_STEPS = 100

const derivedField = (value: number): ScalarControlFieldState => ({ status: 'valid', value, derived: true })

/**
 * Evaluates the bounds and the step of a scalar's slider. An empty field is
 * derived from the scalar's value: the maximum is the value when it exceeds
 * 10 and 10 otherwise, the minimum is the value when it is below −10 and −10
 * otherwise, and the step is a hundredth of the interval.
 */
export function evaluateScalarControl(
  control: ExpressionControl,
  items: readonly EvaluatedDocumentItem[],
  engine: AlgebraEngine,
  value: number | null = null,
): ScalarControlEvaluation {
  const evaluateField = scalarSourceEvaluator(items, engine)
  const empty = (source: string) => source.trim() === ''
  const current = value !== null && Number.isFinite(value) ? value : 0
  const given = (source: string) => empty(source) ? null : evaluateField(source)
  const givenMinimum = given(control.minimumSource)
  const givenMaximum = given(control.maximumSource)
  const knownMinimum = givenMinimum?.status === 'valid' ? givenMinimum.value : null
  const knownMaximum = givenMaximum?.status === 'valid' ? givenMaximum.value : null
  // A derived bound never meets the bound that is given.
  let derivedMinimum = Math.min(-DERIVED_SLIDER_BOUND, current)
  if (knownMaximum !== null && derivedMinimum >= knownMaximum) derivedMinimum = knownMaximum - 2 * DERIVED_SLIDER_BOUND
  let derivedMaximum = Math.max(DERIVED_SLIDER_BOUND, current)
  if (knownMinimum !== null && derivedMaximum <= knownMinimum) derivedMaximum = knownMinimum + 2 * DERIVED_SLIDER_BOUND
  const minimumField = givenMinimum ?? derivedField(derivedMinimum)
  const maximumField = givenMaximum ?? derivedField(derivedMaximum)
  const fields = {
    minimum: minimumField,
    maximum: maximumField,
    step: given(control.stepSource) ?? derivedField(
      minimumField.status === 'valid' && maximumField.status === 'valid' &&
        maximumField.value > minimumField.value
        ? (maximumField.value - minimumField.value) / DERIVED_SLIDER_STEPS
        : 2 * DERIVED_SLIDER_BOUND / DERIVED_SLIDER_STEPS,
    ),
  }
  const minimum = fields.minimum.status === 'valid' ? fields.minimum.value : null
  const maximum = fields.maximum.status === 'valid' ? fields.maximum.value : null
  const step = fields.step.status === 'valid' ? fields.step.value : null
  let diagnostic: string | null = null
  if (Object.values(fields).some((field) => field.status === 'invalid'))
    diagnostic = 'Resolve the invalid control-bound source.'
  else if (minimum! >= maximum!) diagnostic = 'Minimum must be less than maximum.'
  else if (step! <= 0) diagnostic = 'Step must be greater than zero.'
  return {
    fields,
    status: diagnostic ? 'invalid' : 'valid',
    minimum,
    maximum,
    step,
    diagnostic,
  }
}
