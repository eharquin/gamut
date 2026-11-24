import type { AlgebraEngine } from '../algebra/algebraEngine'
import type {
  ExpressionDocument,
  ExpressionItem,
} from '../document/expressionDocument'
import type { SourceSpan } from '../domain/diagnostic'
import {
  inspectMultivector,
  type OwnedMultivector,
} from '../domain/multivector'
import {
  elementIdentity,
  inspectLanguageValue,
  outerConstruction,
  ownedList,
  retainElementIdentity,
  type LanguageValue,
} from '../domain/languageValue'
import {
  evaluateExpression,
  ExpressionEvaluationError,
  type EvaluationBudget,
  type FunctionScope,
} from '../evaluation/evaluateExpression'
import { languageFunction } from '../language/functions'
import { type AnyInterpretation, type InterpretedEntity, type PrimitiveConstruction } from '../geometry/interpretation'
import type { SurfaceExpressionNode } from '../language/ast'
import { lowerExpression } from '../language/lowerExpression'
import {
  parseDocumentExpression,
  parseExpression,
  type ParsedDocumentExpression,
} from '../language/parseExpression'
import { normalizeItemValue } from './normalization'
import {
  presentEvaluation,
  type EvaluationContext,
  type EvaluationState,
} from './evaluateSource'

export type EvaluatedDocumentItem = Readonly<{
  item: ExpressionItem
  position: number
  evaluation: EvaluationState | null
  positionEvaluation: EvaluationState | null
  headInspection: string | null
}>

type NodeProperty = 'value' | 'position'
type ReferenceProperty = 'position' | 'head' | null
type Reference = Readonly<{
  name: string
  property: ReferenceProperty
  span: SourceSpan
}>
type ParsedNode = Readonly<{
  key: string
  item: ExpressionItem
  position: number
  property: NodeProperty
  expression: SurfaceExpressionNode
  declaration: ParsedDocumentExpression['declaration']
  /** The names the source uses as values; a function's parameters are not among them. */
  references: readonly Reference[]
  /** The names the source calls that may be declared functions (#340). */
  calls: readonly Reference[]
}>

/** The function `iterate(f, …)` names, which is called, not used as a value (#341). */
function iteratedFunction(expression: SurfaceExpressionNode): Reference | null {
  if (expression.kind !== 'call-expression' || expression.callee !== 'iterate') return null
  const [first] = expression.arguments
  return first?.kind === 'reference' && first.property === null
    ? { name: first.name, property: null, span: first.span }
    : null
}

/** The arguments of a call that are values: all but the function `iterate` names. */
function functionArguments(expression: Extract<SurfaceExpressionNode, { kind: 'call-expression' }>) {
  return iteratedFunction(expression) ? expression.arguments.slice(1) : expression.arguments
}

/** Every name called as `name(…)` that is not a common-language function, and the function `iterate` names. */
function collectCalls(expression: SurfaceExpressionNode): Reference[] {
  const own: Reference[] = expression.kind === 'call-expression' && !languageFunction(expression.callee)
    ? [{ name: expression.callee, property: null, span: expression.span }]
    : []
  const iterated = iteratedFunction(expression)
  return [...own, ...(iterated ? [iterated] : []), ...surfaceChildren(expression).flatMap(collectCalls)]
}

/** The direct sub-expressions of a node. */
function surfaceChildren(expression: SurfaceExpressionNode): readonly SurfaceExpressionNode[] {
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
    case 'reference':
    case 'scalar-literal':
    case 'basis-blade':
    case 'pseudoscalar': return []
  }
}

function nodeKey(itemId: string, property: NodeProperty): string {
  return `${itemId}:${property}`
}

function diagnostic(
  code: string,
  message: string,
  span: SourceSpan,
): EvaluationState {
  return {
    status: 'invalid',
    diagnostic: { code, severity: 'error', message, span },
  }
}

function collectReferences(expression: SurfaceExpressionNode): Reference[] {
  switch (expression.kind) {
    case 'reference':
      return [{
        name: expression.name,
        property: expression.property,
        span: expression.span,
      }]
    case 'unary-expression':
      return collectReferences(expression.operand)
    case 'binary-expression':
      return [
        ...collectReferences(expression.left),
        ...collectReferences(expression.right),
      ]
    case 'property-expression':
      return collectReferences(expression.object)
    case 'vector-constructor':
    case 'tuple':
      return expression.components.flatMap(collectReferences)
    case 'call-expression':
      return functionArguments(expression).flatMap(collectReferences)
    case 'list-expression':
      return expression.elements.flatMap(collectReferences)
    case 'range-expression':
      return [expression.start, ...(expression.next ? [expression.next] : []), expression.end]
        .flatMap(collectReferences)
    case 'index-expression':
      return [...collectReferences(expression.object), ...collectReferences(expression.index)]
    case 'scalar-literal':
    case 'basis-blade':
    case 'pseudoscalar':
      return []
  }
}

function isPositionValue(interpretation: AnyInterpretation, value: LanguageValue): boolean {
  return value.kind === 'multivector'
    ? interpretation.isPositionValue(value)
    : value.elements.every((element) => interpretation.isPositionValue(element.value))
}

function supportsEvaluationPosition(
  interpretation: AnyInterpretation,
  evaluation: Extract<EvaluationState, { status: 'valid' }>,
): boolean {
  return evaluation.valueType === 'list'
    ? evaluation.elements.every((element) => interpretation.supportsPosition(element.entity))
    : interpretation.supportsPosition(evaluation.entity)
}

function supportsDirectPosition(
  interpretation: AnyInterpretation,
  evaluation: Extract<EvaluationState, { status: 'valid' }>,
): boolean {
  return evaluation.valueType === 'single' && interpretation.supportsPosition(evaluation.entity)
}

function addPositionValues(
  value: LanguageValue,
  position: LanguageValue,
  engine: AlgebraEngine,
): LanguageValue {
  if (value.kind === 'multivector' && position.kind === 'multivector') {
    return engine.add(position, value)
  }
  if (value.kind !== 'list') return value
  const positions = position.kind === 'list' ? position.elements : null
  if (positions && positions.length !== 1 && positions.length !== value.elements.length) {
    throw new ExpressionEvaluationError(
      'GEOM_POSITION_LENGTH',
      `Position list length ${positions.length} does not match value list length ${value.elements.length}.`,
      { start: 0, end: 0 },
    )
  }
  return ownedList(value.elements.map((element, index) => ({
    id: element.id,
    sources: element.sources,
    value: engine.add(
      positions
        ? positions[positions.length === 1 ? 0 : index].value
        : position as OwnedMultivector,
      element.value,
    ),
  })))
}

/**
 * Whether the declaration `name` is one of `targets` or depends on one of
 * them, directly or through other declarations, their positions included.
 * A drag that rewrites `targets` uses it to refuse a kept value, such as a
 * weight, that the rewrite would change (#181).
 */
export function declarationDependsOn(
  items: readonly ExpressionItem[],
  name: string,
  targets: ReadonlySet<string>,
): boolean {
  const declarations = new Map<string, ExpressionItem>()
  for (const item of items) {
    if (item.kind === 'annotation') continue
    const parsed = parseDocumentExpression(item.source)
    if (parsed.ok && parsed.source.declaration) declarations.set(parsed.source.declaration.name, item)
  }
  const visited = new Set<string>()
  const pending = [name]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (targets.has(current)) return true
    if (visited.has(current)) continue
    visited.add(current)
    const item = declarations.get(current)
    if (!item) continue
    for (const source of [item.source, item.positionSource ?? '']) {
      const parsed = parseDocumentExpression(source)
      // A called function is a dependency too, through its body (#340).
      if (parsed.ok) pending.push(...[...collectReferences(parsed.source.expression), ...collectCalls(parsed.source.expression)]
        .map((reference) => reference.name))
    }
  }
  return false
}

/**
 * Evaluates value and position sources as separate document graph nodes.
 *
 * Position metadata never enters the owned value. Missing and invalid
 * positions render at the origin while preserving a valid item value.
 */
export function evaluateDocument(
  document: ExpressionDocument,
  context: EvaluationContext,
): readonly EvaluatedDocumentItem[] {
  const { engine, interpretation } = context
  const nodes = new Map<string, ParsedNode>()
  const results = new Map<string, EvaluationState | null>()
  const evaluationBudget: EvaluationBudget = { work: 0, generatedValues: 0 }

  document.items.forEach((item, index) => {
    const valueKey = nodeKey(item.id, 'value')
    if (item.kind === 'annotation') {
      results.set(valueKey, null)
      return
    }
    if (item.source.trim() === '') {
      results.set(valueKey, null)
    } else {
      const parsed = parseDocumentExpression(item.source)
      if (!parsed.ok) {
        results.set(valueKey, {
          status: 'invalid',
          diagnostic: parsed.diagnostic,
        })
      } else {
        const parameters = new Set(parsed.source.declaration?.parameters?.map(({ name }) => name))
        nodes.set(valueKey, {
          key: valueKey,
          item,
          position: index + 1,
          property: 'value',
          expression: parsed.source.expression,
          declaration: parsed.source.declaration,
          references: collectReferences(parsed.source.expression)
            .filter((reference) => !parameters.has(reference.name)),
          // A function of the active algebra, such as `line`, is never a dependency.
          calls: collectCalls(parsed.source.expression).filter((call) => !engine.functions.has(call.name)),
        })
      }
    }
    // A function has no position of its own.
    if (nodes.get(valueKey)?.declaration?.parameters) return

    const positionSource = document.view.positionEnabled
      ? item.positionSource?.trim() ?? ''
      : ''
    if (!positionSource) return
    const positionKey = nodeKey(item.id, 'position')
    const parsedPosition = parseExpression(item.positionSource!)
    if (!parsedPosition.ok) {
      results.set(positionKey, {
        status: 'invalid',
        diagnostic: parsedPosition.diagnostic,
      })
    } else {
      nodes.set(positionKey, {
        key: positionKey,
        item,
        position: index + 1,
        property: 'position',
        expression: parsedPosition.expression,
        declaration: null,
        references: collectReferences(parsedPosition.expression),
        calls: collectCalls(parsedPosition.expression).filter((call) => !engine.functions.has(call.name)),
      })
    }
  })

  const declarations = new Map<string, ParsedNode[]>()
  for (const node of nodes.values()) {
    if (node.property !== 'value' || !node.declaration) continue
    const entries = declarations.get(node.declaration.name) ?? []
    entries.push(node)
    declarations.set(node.declaration.name, entries)
  }

  for (const [name, entries] of declarations) {
    if (entries.length < 2) continue
    for (const entry of entries) {
      results.set(
        entry.key,
        diagnostic(
          'LANG_DUPLICATE_NAME',
          `The name “${name}” is declared more than once.`,
          entry.declaration!.span,
        ),
      )
    }
  }

  const dependencyKeys = (reference: Reference): string[] => {
    const targets = declarations.get(reference.name)
    if (targets?.length !== 1) return []
    const target = targets[0]
    if (reference.property === null) return [target.key]
    const positionKey = nodeKey(target.item.id, 'position')
    if (reference.property === 'position') {
      return nodes.has(positionKey) ? [positionKey] : []
    }
    return [
      target.key,
      ...(nodes.has(positionKey) ? [positionKey] : []),
    ]
  }

  const cycleKeys = new Set<string>()
  const visited = new Set<string>()
  const visiting: string[] = []
  const findCycles = (node: ParsedNode) => {
    if (visited.has(node.key)) return
    const cycleStart = visiting.indexOf(node.key)
    if (cycleStart >= 0) {
      visiting.slice(cycleStart).forEach((key) => cycleKeys.add(key))
      return
    }
    visiting.push(node.key)
    for (const reference of [...node.references, ...node.calls]) {
      dependencyKeys(reference).forEach((key) => {
        const dependency = nodes.get(key)
        if (dependency) findCycles(dependency)
      })
    }
    visiting.pop()
    visited.add(node.key)
  }
  nodes.forEach(findCycles)

  for (const key of cycleKeys) {
    const node = nodes.get(key)!
    results.set(
      key,
      diagnostic(
        'LANG_DEPENDENCY_CYCLE',
        `This ${node.property} source is part of a dependency cycle.`,
        node.declaration?.span ?? node.expression.span,
      ),
    )
  }

  /** The declared function a call names, once its row has been evaluated (#340). */
  const functionScope: FunctionScope = {
    depth: 0,
    resolve: (name) => {
      const targets = declarations.get(name)
      if (targets?.length !== 1 || !targets[0].declaration?.parameters) return undefined
      const state = results.get(targets[0].key)
      return state?.status === 'function' ? state.definition : undefined
    },
  }

  const evaluateNode = (node: ParsedNode): EvaluationState => {
    const existing = results.get(node.key)
    if (existing !== undefined && existing !== null) return existing

    const parameters = node.declaration?.parameters ?? null
    if (parameters) {
      const name = node.declaration!.name
      if (engine.functions.has(name)) {
        const invalid = diagnostic(
          'LANG_RESERVED_NAME',
          `“${name}” is a function of the active algebra.`,
          node.declaration!.span,
        )
        results.set(node.key, invalid)
        return invalid
      }
      // A parameter never hides a name of the document or of the algebra.
      const shadowing = parameters.find((parameter) =>
        declarations.has(parameter.name) || engine.functions.has(parameter.name))
      if (shadowing) {
        const invalid = diagnostic(
          'LANG_PARAMETER_NAME',
          declarations.has(shadowing.name)
            ? `The parameter “${shadowing.name}” has the name of an item of the document.`
            : `The parameter “${shadowing.name}” has the name of a function of the active algebra.`,
          shadowing.span,
        )
        results.set(node.key, invalid)
        return invalid
      }
    }

    // A call to a declared function needs that function, valid.
    for (const call of node.calls) {
      const targets = declarations.get(call.name)
      if (!targets || engine.functions.has(call.name)) continue
      const failure = targets.length > 1
        ? diagnostic('LANG_DUPLICATE_NAME', `The name “${call.name}” is declared more than once.`, call.span)
        : !targets[0].declaration?.parameters
          ? diagnostic('LANG_NOT_A_FUNCTION', `“${call.name}” is not a function.`, call.span)
          : evaluateNode(targets[0]).status === 'invalid'
            ? diagnostic('LANG_INVALID_DEPENDENCY', `The function “${call.name}” is invalid.`, call.span)
            : null
      if (failure) {
        results.set(node.key, failure)
        return failure
      }
    }

    const resolved = new Map<string, LanguageValue>()
    for (const reference of node.references) {
      const targets = declarations.get(reference.name)
      if (!targets) {
        const invalid = diagnostic(
          'LANG_UNDEFINED_NAME',
          `The name “${reference.name}” is not defined.`,
          reference.span,
        )
        results.set(node.key, invalid)
        return invalid
      }
      if (targets.length > 1) {
        const invalid = diagnostic(
          'LANG_DUPLICATE_NAME',
          `The name “${reference.name}” is declared more than once.`,
          reference.span,
        )
        results.set(node.key, invalid)
        return invalid
      }

      const target = targets[0]
      const valueResult = evaluateNode(target)
      if (valueResult.status === 'invalid') {
        const invalid = diagnostic(
          'LANG_INVALID_DEPENDENCY',
          `The dependency “${reference.name}” is invalid.`,
          reference.span,
        )
        results.set(node.key, invalid)
        return invalid
      }
      if (valueResult.status === 'function') {
        const invalid = diagnostic(
          'LANG_FUNCTION_VALUE',
          `“${reference.name}” is a function: call it, as in ${valueResult.signature}.`,
          reference.span,
        )
        results.set(node.key, invalid)
        return invalid
      }

      if (
        reference.property === 'position' &&
        !supportsEvaluationPosition(interpretation, valueResult)
      ) {
        const invalid = diagnostic(
          'LANG_UNSUPPORTED_PROPERTY',
          `The value “${reference.name}” does not support position.`,
          reference.span,
        )
        results.set(node.key, invalid)
        return invalid
      }

      if (
        reference.property === 'head' &&
        (valueResult.valueType === 'list'
          ? valueResult.elements.some((element) => !interpretation.supportsHead(element.entity))
          : !interpretation.supportsHead(valueResult.entity))
      ) {
        const invalid = diagnostic(
          'LANG_UNSUPPORTED_PROPERTY',
          `The value “${reference.name}” does not support head.`,
          reference.span,
        )
        results.set(node.key, invalid)
        return invalid
      }

      const positionNode = supportsDirectPosition(interpretation, valueResult)
        ? nodes.get(nodeKey(target.item.id, 'position'))
        : undefined
      // An empty position is the origin of the active algebra, where the
      // object is drawn: zero in VGA(2), the origin point e12 in PGA(2) (#235).
      const emptyPosition = () => reference.property === null
        ? engine.scalar(0)
        : interpretation.positionValue({ x: 0, y: 0 }, engine.basis)
      let positionValue: LanguageValue = valueResult.valueType === 'list'
        ? ownedList(valueResult.elements.map((element) => ({
            id: element.id,
            value: emptyPosition(),
          })))
        : emptyPosition()
      if (
        reference.property !== null &&
        valueResult.valueType === 'list' &&
        !positionNode
      ) {
        for (const candidate of nodes.values()) {
          if (candidate.property !== 'position') continue
          const candidateValue = results.get(nodeKey(candidate.item.id, 'value'))
          if (candidateValue?.status === 'valid' &&
              supportsDirectPosition(interpretation, candidateValue)) {
            evaluateNode(candidate)
          }
        }
        const localLineage = new Map<string, readonly string[]>()
        const localPositions = new Map<string, Readonly<{ x: number; y: number }>>()
        for (const candidate of nodes.values()) {
          if (candidate.property !== 'value') continue
          const candidateValue = results.get(candidate.key)
          if (candidateValue?.status !== 'valid') continue
          if (candidateValue.valueType === 'list') {
            candidateValue.value.elements.forEach((element) =>
              localLineage.set(element.id, element.sources ?? []))
          }
          const candidatePosition = results.get(nodeKey(candidate.item.id, 'position'))
          if (candidatePosition?.status !== 'valid') continue
          if (candidateValue.valueType === 'single') {
            if (candidateValue.elementId && candidatePosition.value.kind === 'multivector') {
              localPositions.set(candidateValue.elementId,
                interpretation.positionOf(candidatePosition.value))
            }
            continue
          }
          candidateValue.value.elements.forEach((element, elementIndex) => {
            const position = candidatePosition.value.kind === 'list'
              ? candidatePosition.value.elements[
                  candidatePosition.value.elements.length === 1 ? 0 : elementIndex
                ]?.value
              : candidatePosition.value
            if (position) localPositions.set(element.id, interpretation.positionOf(position))
          })
        }
        const resolvePosition = (
          elementId: string,
          visiting = new Set<string>(),
        ): Readonly<{ position: Readonly<{ x: number; y: number }> | null; conflict: boolean }> => {
          const direct = localPositions.get(elementId)
          if (direct) return { position: direct, conflict: false }
          if (visiting.has(elementId)) return { position: null, conflict: false }
          visiting.add(elementId)
          const inherited = (localLineage.get(elementId) ?? [])
            .map((source) => resolvePosition(source, visiting))
            .filter((result) => result.position !== null)
          visiting.delete(elementId)
          const first = inherited[0]?.position ?? null
          const conflict = inherited.some((result) => result.conflict) ||
            inherited.some((result) =>
              result.position!.x !== first!.x || result.position!.y !== first!.y)
          return { position: conflict ? null : first, conflict }
        }
        const inherited = valueResult.value.elements.map((element) =>
          resolvePosition(element.id))
        if (inherited.some((result) => result.conflict)) {
          const invalid = diagnostic(
            'GEOM_POSITION_CONFLICT',
            `The dependency “${reference.name}.position” has conflicting inherited positions.`,
            reference.span,
          )
          results.set(node.key, invalid)
          return invalid
        }
        positionValue = ownedList(valueResult.value.elements.map((element, elementIndex) => {
          const position = inherited[elementIndex].position ?? { x: 0, y: 0 }
          return {
            id: element.id,
            sources: element.sources,
            value: interpretation.positionValue(position, engine.basis),
          }
        }))
      }
      if (reference.property !== null && positionNode) {
        const positionResult = evaluateNode(positionNode)
        if (positionResult.status !== 'valid') {
          const invalid = diagnostic(
            'LANG_INVALID_DEPENDENCY',
            `The dependency “${reference.name}.position” is invalid.`,
            reference.span,
          )
          results.set(node.key, invalid)
          return invalid
        }
        if (
          valueResult.value.kind === 'list' &&
          positionResult.value.kind === 'list' &&
          positionResult.value.elements.length !== 1 &&
          positionResult.value.elements.length !== valueResult.value.elements.length
        ) {
          const invalid = diagnostic(
            'GEOM_POSITION_LENGTH',
            `Position list length ${positionResult.value.elements.length} does not match value list length ${valueResult.value.elements.length}.`,
            reference.span,
          )
          results.set(node.key, invalid)
          return invalid
        }
        positionValue = positionResult.value
      }

      let value: LanguageValue = positionValue
      if (reference.property !== 'position') {
        if (reference.property === 'head') {
          value = addPositionValues(valueResult.value, positionValue, engine)
        } else {
          value = valueResult.value
        }
      }
      resolved.set(
        `${reference.name}:${reference.property ?? 'value'}`,
        value,
      )
    }

    const resolveReference = (name: string, property: 'position' | 'head' | null) =>
      resolved.get(`${name}:${property ?? 'value'}`)!
    if (parameters) {
      const state: EvaluationState = {
        status: 'function',
        signature: `${node.declaration!.name}(${parameters.map(({ name }) => name).join(', ')})`,
        definition: {
          name: node.declaration!.name,
          parameters: parameters.map(({ name }) => name),
          body: lowerExpression(node.expression),
          resolveReference,
        },
      }
      results.set(node.key, state)
      return state
    }

    let value: LanguageValue
    try {
      value = evaluateExpression(
        lowerExpression(node.expression),
        engine,
        resolveReference,
        node.item.id,
        evaluationBudget,
        functionScope,
      )
    } catch (error) {
      if (!(error instanceof ExpressionEvaluationError)) throw error
      const invalid = diagnostic(error.code, error.message, error.origin)
      results.set(node.key, invalid)
      return invalid
    }
    if (
      node.property === 'value' &&
      node.item.normalization &&
      value.kind === 'multivector'
    ) {
      value = normalizeItemValue(node.item.normalization, value, engine, interpretation).value
    }
    if (node.property === 'position' && !isPositionValue(interpretation, value)) {
      const invalid = diagnostic(
        'GEOM_INVALID_POSITION',
        `A position must evaluate to ${interpretation.positionDescription}.`,
        node.expression.span,
      )
      results.set(node.key, invalid)
      return invalid
    }

    if (node.property === 'value' && value.kind === 'multivector' && !elementIdentity(value)) {
      retainElementIdentity(value, node.key)
    }
    const presented = presentEvaluation(
      value,
      interpretation,
      node.declaration?.name ?? `Vector ${node.position}`,
    )
    results.set(node.key, presented)
    return presented
  }

  for (const node of nodes.values()) {
    if (node.property === 'value') evaluateNode(node)
  }
  for (const node of nodes.values()) {
    if (node.property !== 'position') continue
    const valueResult = results.get(nodeKey(node.item.id, 'value'))
    if (
      valueResult?.status === 'valid' &&
      supportsDirectPosition(interpretation, valueResult)
    ) {
      evaluateNode(node)
    }
  }

  type Point = Readonly<{ x: number; y: number }>
  const lineage = new Map<string, readonly string[]>()
  const explicitPositions = new Map<string, Point>()
  for (const node of nodes.values()) {
    if (node.property !== 'value') continue
    const valueResult = results.get(node.key)
    if (valueResult?.status !== 'valid') continue
    if (valueResult.valueType === 'list') {
      valueResult.value.elements.forEach((element) => {
        lineage.set(element.id, element.sources ?? [])
      })
    }
    const positionResult = results.get(nodeKey(node.item.id, 'position'))
    if (positionResult?.status !== 'valid') continue
    if (valueResult.valueType === 'single') {
      if (valueResult.elementId && positionResult.value.kind === 'multivector') {
        explicitPositions.set(valueResult.elementId, interpretation.positionOf(positionResult.value))
      }
      continue
    }
    valueResult.value.elements.forEach((element, elementIndex) => {
      const positionValue = positionResult.value
      const position = positionValue.kind === 'list'
        ? positionValue.elements[positionValue.elements.length === 1 ? 0 : elementIndex]?.value
        : positionValue
      if (!position) return
      explicitPositions.set(element.id, interpretation.positionOf(position))
    })
  }

  const resolveInheritedPosition = (
    elementId: string,
    visiting = new Set<string>(),
  ): Readonly<{ position: Point | null; conflict: boolean }> => {
    const explicit = explicitPositions.get(elementId)
    if (explicit) return { position: explicit, conflict: false }
    if (visiting.has(elementId)) return { position: null, conflict: false }
    visiting.add(elementId)
    const inherited = (lineage.get(elementId) ?? [])
      .map((source) => resolveInheritedPosition(source, visiting))
      .filter((result) => result.position !== null)
    visiting.delete(elementId)
    if (inherited.some((result) => result.conflict)) {
      return { position: null, conflict: true }
    }
    const first = inherited[0]?.position ?? null
    const conflict = inherited.some((result) =>
      result.position!.x !== first!.x || result.position!.y !== first!.y)
    return { position: conflict ? null : first, conflict }
  }

  // Outer-product provenance travels with the evaluated value, whatever the
  // operand syntax (#85, #87); the interpretation decides whether it applies.
  const constructionOf = (
    value: OwnedMultivector,
  ): PrimitiveConstruction<InterpretedEntity> | undefined => {
    const sides = outerConstruction(value)
    return sides
      ? { operator: '^', operands: sides.map((side) => interpretation.interpret(side)) }
      : undefined
  }

  return document.items.map((item, index) => {
    const valueEvaluation =
      results.get(nodeKey(item.id, 'value')) ?? null

    if (valueEvaluation?.status === 'valid' && valueEvaluation.valueType === 'list') {
      const rawPositionEvaluation =
        results.get(nodeKey(item.id, 'position')) ?? null
      const positionList = rawPositionEvaluation?.status === 'valid' &&
        rawPositionEvaluation.valueType === 'list'
          ? rawPositionEvaluation.value
          : null
      const positionLengthInvalid =
        rawPositionEvaluation?.status === 'valid' &&
        positionList !== null && positionList.elements.length !== 1 &&
        positionList.elements.length !== valueEvaluation.value.elements.length
      const inheritedConflict = rawPositionEvaluation?.status !== 'valid' &&
        valueEvaluation.value.elements.some((element) =>
          resolveInheritedPosition(element.id).conflict)
      const positionEvaluation = positionLengthInvalid
        ? diagnostic(
            'GEOM_POSITION_LENGTH',
            `Position list length ${positionList!.elements.length} does not match value list length ${valueEvaluation.value.elements.length}.`,
            nodes.get(nodeKey(item.id, 'position'))?.expression.span ?? { start: 0, end: 0 },
          )
        : inheritedConflict
          ? diagnostic(
              'GEOM_POSITION_CONFLICT',
              'Corresponding list elements have conflicting inherited positions.',
              nodes.get(nodeKey(item.id, 'value'))?.expression.span ?? { start: 0, end: 0 },
            )
        : rawPositionEvaluation
      const positionAt = (
        elementIndex: number,
        elementId: string,
      ): Readonly<{
        position: Readonly<{ x: number; y: number }> | null
        conflict: boolean
      }> => {
        if (positionEvaluation?.status !== 'valid') {
          return resolveInheritedPosition(elementId)
        }
        const positionValue = positionEvaluation.value
        const multivector = positionValue.kind === 'list'
          ? positionValue.elements[positionValue.elements.length === 1 ? 0 : elementIndex]?.value
          : positionValue
        return {
          position: multivector ? interpretation.positionOf(multivector) : null,
          conflict: false,
        }
      }
      const listName = nodes.get(nodeKey(item.id, 'value'))?.declaration?.name ??
        `List ${index + 1}`
      const elements = valueEvaluation.elements.map((element, elementIndex) => {
        const positionState = positionAt(elementIndex, element.id)
        const position = positionState.position ?? { x: 0, y: 0 }
        const name = `${listName}[${elementIndex}]`
        return {
          ...element,
          position: positionState.position,
          positionConflict: positionState.conflict,
          primitive: interpretation.toPrimitive(element.entity, {
            accessibleName: name,
            position,
            construction: constructionOf(element.value),
          }),
        }
      })
      const allVectors = elements.every((element) => interpretation.supportsHead(element.entity))
      let headInspection: string | null = null
      if (allVectors) {
        const positions = positionEvaluation?.status === 'valid'
          ? positionEvaluation.value
          : ownedList(elements.map((element, elementIndex) => {
              const position = positionAt(elementIndex, element.id).position ??
                { x: 0, y: 0 }
              return {
                id: element.id,
                value: interpretation.positionValue(position, engine.basis),
              }
            }))
        headInspection = inspectLanguageValue(
          addPositionValues(valueEvaluation.value, positions, engine),
        )
      }
      return {
        item,
        position: index + 1,
        evaluation: { ...valueEvaluation, elements },
        positionEvaluation,
        headInspection,
      }
    }

    if (
      valueEvaluation?.status === 'valid' &&
      valueEvaluation.valueType === 'single' &&
      interpretation.supportsPosition(valueEvaluation.entity)
    ) {
      const positionEvaluation =
        results.get(nodeKey(item.id, 'position')) ?? null
      const inheritedPosition = valueEvaluation.elementId
        ? resolveInheritedPosition(valueEvaluation.elementId)
        : { position: null, conflict: false }
      const effectivePositionEvaluation =
        positionEvaluation ?? (inheritedPosition.conflict
          ? diagnostic(
              'GEOM_POSITION_CONFLICT',
              'The selected element has conflicting inherited positions.',
              nodes.get(nodeKey(item.id, 'value'))?.expression.span ?? { start: 0, end: 0 },
            )
          : null)
      const positionPoint =
        positionEvaluation?.status === 'valid' &&
        positionEvaluation.valueType === 'single' &&
        interpretation.isPositionValue(positionEvaluation.value)
          ? interpretation.positionOf(positionEvaluation.value)
          : inheritedPosition.position ?? { x: 0, y: 0 }
      const accessibleName =
        nodes.get(nodeKey(item.id, 'value'))?.declaration?.name ??
        interpretation.defaultName(valueEvaluation.entity, index)
      const headInspection = interpretation.supportsHead(valueEvaluation.entity)
        ? inspectMultivector(
            engine.add(
              valueEvaluation.value,
              positionEvaluation?.status === 'valid' && positionEvaluation.valueType === 'single'
                ? positionEvaluation.value
                : interpretation.positionValue(inheritedPosition.position ?? { x: 0, y: 0 }, engine.basis),
            ),
          )
        : null
      return {
        item,
        position: index + 1,
        positionEvaluation: effectivePositionEvaluation,
        headInspection,
        evaluation: {
          ...valueEvaluation,
          primitive: interpretation.toPrimitive(valueEvaluation.entity, {
            accessibleName,
            position: positionPoint,
            construction: constructionOf(valueEvaluation.value),
          }),
        },
      }
    }

    return {
      item,
      position: index + 1,
      evaluation: valueEvaluation,
      positionEvaluation: null,
      headInspection: null,
    }
  })
}
