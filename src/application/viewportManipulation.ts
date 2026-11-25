import type { DocumentCommand } from '../document/documentCommands'
import type { ExpressionDocument, ExpressionItem } from '../document/expressionDocument'
import type { AnyInterpretation, InterpretedEntity, Point2d } from '../geometry/interpretation'
import type { TupleConstructor } from '../language/ast'
import {
  directConstructorComponents,
  directItemLiteralEdit,
  literalComponentValue,
  rewriteConstructorLiterals,
  type ConstructorComponentEdit,
} from '../language/constructorLiteralEdit'
import { declaredName } from '../language/declaredName'
import { directScalarEdit } from '../language/directScalarEdit'
import { directPositionAnchorReference } from '../language/directVectorEdit'
import { primitiveBase } from '../visualization/anchoring'
import type { RenderedPrimitive } from '../visualization/layout'
import type { VisualizationPrimitive } from '../visualization/primitives'
import {
  formatViewportCoordinate,
  weightedDragSupported,
  weightedViewportCoordinates,
} from '../visualization/viewportCreation'
import { declarationDependsOn, type EvaluatedDocumentItem } from './evaluateDocument'

/**
 * Direct manipulation on the canvas (#173): which objects a drag can move,
 * and the source edits a drag writes. Nothing here touches React or the DOM;
 * the editor executes the commands it returns.
 */
export type ManipulationKind = 'base' | 'head' | 'line' | 'normal'

export type ManipulationContext = Readonly<{
  document: Pick<ExpressionDocument, 'items' | 'appearance'>
  evaluatedItems: readonly EvaluatedDocumentItem[]
  interpretation: AnyInterpretation
  tuple: TupleConstructor | null
  pixelsPerUnit: number
}>

type LinePrimitive = Extract<VisualizationPrimitive, { kind: 'unbounded-line' }>

/** The press of a line drag: the pressed point, its anchor on the line, and the line's coefficients. */
export type LineDragOrigin = Readonly<{
  point: Point2d
  anchor: Point2d
  coefficients: readonly [number, number, number]
}>

export const gestureLabel = (kind: ManipulationKind): string =>
  kind === 'head' ? 'Vector head' : kind === 'base' ? 'Object base' : kind === 'line' ? 'Line' : 'Line normal'

/** The line as drawn, or `null` for a primitive that is no line. */
export const linePrimitive = (rendered: RenderedPrimitive | undefined): LinePrimitive | null =>
  rendered?.primitive.kind === 'unbounded-line' ? rendered.primitive : null

export const lineCoefficients = (primitive: LinePrimitive): readonly [number, number, number] => {
  const a = primitive.normal.x * primitive.scale
  const b = primitive.normal.y * primitive.scale
  return [a, b, -(a * primitive.point.x + b * primitive.point.y)]
}

/** A point projected onto a line. */
export const projectOnLine = (primitive: LinePrimitive, point: Point2d): Point2d => {
  const { point: on, direction } = primitive
  const along = (point.x - on.x) * direction.x + (point.y - on.y) * direction.y
  return { x: on.x + direction.x * along, y: on.y + direction.y * along }
}

/** What a drag can move in a document, from the literals its sources spell. */
export function dragTargets(context: ManipulationContext) {
  const { document, evaluatedItems, interpretation, tuple, pixelsPerUnit } = context
  const componentsMovable = (components: readonly ConstructorComponentEdit[] | null): boolean => {
    if (!components) return false
    const references = components.filter((component) => component.kind === 'reference')
    if (new Set(references.map((component) => component.name)).size !== references.length)
      return false
    return references.every((component) => document.items.filter((candidate) =>
      candidate.kind !== 'annotation' &&
      declaredName(candidate.source) === component.name &&
      directScalarEdit(candidate.source) !== null).length === 1)
  }
  const literalEditTarget = (item: ExpressionItem, entity: InterpretedEntity) => {
    const edit = interpretation.literalEdit(entity)
    const target = edit ? directItemLiteralEdit(item.source, edit, tuple) : null
    // A weight that depends on a rewritten coordinate would change with it.
    const rewritten = new Set(target?.components.flatMap((component) =>
      component.kind === 'reference' ? [component.name] : []))
    return target?.weight?.kind === 'reference' &&
      declarationDependsOn(document.items, target.weight.name, rewritten)
      ? null
      : target
  }
  const literalEditComponents = (item: ExpressionItem, entity: InterpretedEntity) =>
    literalEditTarget(item, entity)?.components ?? null
  /** The current value of a kept weight: its literal, or the scalar its name declares. */
  const weightValue = (source: string, weight: ConstructorComponentEdit): number | null => {
    if (weight.kind === 'literal') return literalComponentValue(source, weight)
    const evaluation = evaluatedItems.find(({ item }) => declaredName(item.source) === weight.name)?.evaluation
    if (evaluation?.status !== 'valid' || evaluation.valueType !== 'single' ||
        evaluation.value.coefficients.some((coefficient, index) => index > 0 && coefficient !== 0)) return null
    return evaluation.value.coefficients[0] * weight.sign
  }
  /**
   * A position source is a two-argument literal of the interpretation's
   * creation constructor, or a tuple the active algebra reads as one.
   */
  const positionComponents = (positionSource: string) =>
    directConstructorComponents(positionSource, interpretation.creation.constructor, 2, tuple)
  const lineMovableByConstruction = (item: ExpressionItem, entity: InterpretedEntity): boolean =>
    interpretation.literalEdit(entity)?.constructor === 'line' &&
    componentsMovable(literalEditComponents(item, entity))
  const headMovableByConstruction = (item: ExpressionItem, entity: InterpretedEntity): boolean =>
    interpretation.supportsHead(entity) && componentsMovable(literalEditComponents(item, entity))
  /** A located entity's literal, with a weight this zoom can keep (#181). */
  const locatedMovable = (item: ExpressionItem, entity: InterpretedEntity): boolean => {
    const target = literalEditTarget(item, entity)
    if (!target || !componentsMovable(target.components)) return false
    const weight = target.weight ? weightValue(item.source, target.weight) : 1
    return weight !== null && weightedDragSupported(weight, pixelsPerUnit)
  }
  const baseMovableByConstruction = (item: ExpressionItem, entity: InterpretedEntity): boolean =>
    interpretation.supportsPosition(entity)
      ? !item.positionSource ||
        directPositionAnchorReference(item.positionSource) !== null ||
        componentsMovable(positionComponents(item.positionSource))
      : locatedMovable(item, entity)
  /**
   * An object whose source a drag can rewrite can be held in place from its
   * row or its menu: its handles then neither show as movable nor move it.
   */
  const heldInPlace = (item: ExpressionItem) => document.appearance[item.id]?.draggable === false
  return {
    literalEditTarget,
    literalEditComponents,
    weightValue,
    positionComponents,
    lineMovable: (item: ExpressionItem, entity: InterpretedEntity) =>
      !heldInPlace(item) && lineMovableByConstruction(item, entity),
    headMovable: (item: ExpressionItem, entity: InterpretedEntity) =>
      !heldInPlace(item) && headMovableByConstruction(item, entity),
    baseMovable: (item: ExpressionItem, entity: InterpretedEntity) =>
      !heldInPlace(item) && baseMovableByConstruction(item, entity),
    /** Whether a drag could move the object at all, held in place or not. */
    draggableByConstruction: (item: ExpressionItem, entity: InterpretedEntity) =>
      lineMovableByConstruction(item, entity) || headMovableByConstruction(item, entity) ||
      baseMovableByConstruction(item, entity),
  }
}

export type DragTargets = ReturnType<typeof dragTargets>

export type ManipulationEdit = Readonly<{
  /** The commands to execute, in order. */
  commands: readonly DocumentCommand[]
  /** Where the selected line's anchor travels with a translated line. */
  selectedLineAnchor?: Point2d
  /** Where a weighted point is drawn after the edit, for the announcement. */
  drawn?: Point2d
}>

const NO_EDIT: ManipulationEdit = { commands: [] }

/**
 * The edits that move an item's handle of `kind` to `point`, in mathematical
 * coordinates. Every coordinate written follows the creation rule (about one
 * screen pixel); line coefficients use a ten times finer scale so that
 * rotating a line about an anchor stays smooth.
 */
export function manipulationEdit(
  context: ManipulationContext,
  targets: DragTargets,
  request: Readonly<{
    item: ExpressionItem
    rendered: RenderedPrimitive
    kind: ManipulationKind
    point: Point2d
    lineDrag: LineDragOrigin | null
    selectedLine: Readonly<{ itemId: string; anchor: Point2d }> | null
  }>,
): ManipulationEdit {
  const { document, interpretation, pixelsPerUnit } = context
  const { item, rendered, kind, point, lineDrag, selectedLine } = request
  const itemId = item.id
  const coordinate = (value: number) => formatViewportCoordinate(value, pixelsPerUnit)
  const target = {
    x: Number(coordinate(point.x)),
    y: Number(coordinate(point.y)),
  }
  /** The scalar rows that hold referenced components follow the new values. */
  const scalarCommands = (
    components: readonly ConstructorComponentEdit[],
    value: (index: number) => number,
  ): DocumentCommand[] => components.flatMap((component, index) => {
    if (component.kind !== 'reference') return []
    const scalarItem = document.items.find((candidate) =>
      candidate.kind !== 'annotation' &&
      declaredName(candidate.source) === component.name &&
      directScalarEdit(candidate.source) !== null)
    return scalarItem
      ? [{ kind: 'set-scalar-value' as const, itemId: scalarItem.id, value: value(index) * component.sign }]
      : []
  })
  const sourceCommand = (rewritten: string): DocumentCommand[] =>
    rewritten !== item.source ? [{ kind: 'update-source', itemId, source: rewritten }] : []

  if (kind === 'line' || kind === 'normal') {
    const line = linePrimitive(rendered)
    if (!line) return NO_EDIT
    const components = targets.literalEditComponents(item, rendered.entity)
    if (!components) return NO_EDIT
    const [a0, b0] = lineCoefficients(line)
    // Far from the origin, a coarse (a, b) would move the line by the
    // anchor's distance times its rounding error: (a, b) are rounded with a
    // step refined by that distance and c is derived from them, so the
    // anchor stays on the line.
    const coefficientScale = (anchor: Point2d) => pixelsPerUnit * 10 * Math.max(1, Math.hypot(anchor.x, anchor.y))
    const offsetScale = pixelsPerUnit * 10
    let rounded: readonly [number, number, number]
    let selectedLineAnchor: Point2d | undefined
    if (kind === 'line') {
      // Translating changes only c; motion along the line has no effect.
      // The selection anchor travels with the line so that a later rotation
      // pivots about the translated line, not the pressed one.
      if (!lineDrag) return NO_EDIT
      const scale = coefficientScale(lineDrag.anchor)
      const a = Number(formatViewportCoordinate(lineDrag.coefficients[0], scale))
      const b = Number(formatViewportCoordinate(lineDrag.coefficients[1], scale))
      const shift = { x: target.x - lineDrag.point.x, y: target.y - lineDrag.point.y }
      const c = lineDrag.coefficients[2] - a * shift.x - b * shift.y
      rounded = [a, b, Number(formatViewportCoordinate(c, offsetScale))]
      if (selectedLine?.itemId === itemId) {
        selectedLineAnchor = { x: lineDrag.anchor.x + shift.x, y: lineDrag.anchor.y + shift.y }
      }
    } else {
      // Rotating keeps the norm of (a, b) and the anchor on the line; the
      // anchor is projected in case the line moved since it was selected.
      const anchor = projectOnLine(line, selectedLine?.itemId === itemId ? selectedLine.anchor : line.point)
      const dx = point.x - anchor.x
      const dy = point.y - anchor.y
      const length = Math.hypot(dx, dy)
      if (length === 0) return NO_EDIT
      const scale = Math.hypot(a0, b0)
      const coefficients = coefficientScale(anchor)
      const a = Number(formatViewportCoordinate(dx / length * scale, coefficients))
      const b = Number(formatViewportCoordinate(dy / length * scale, coefficients))
      rounded = [a, b, Number(formatViewportCoordinate(-(a * anchor.x + b * anchor.y), offsetScale))]
    }
    return {
      commands: [
        ...sourceCommand(rewriteConstructorLiterals(item.source, components, rounded)),
        ...scalarCommands(components, (index) => rounded[index]),
      ],
      ...(selectedLineAnchor ? { selectedLineAnchor } : {}),
    }
  }
  if (kind === 'head' && interpretation.supportsHead(rendered.entity)) {
    const components = targets.literalEditComponents(item, rendered.entity)
    const base = primitiveBase(rendered.primitive)
    if (!components || !base) return NO_EDIT
    const values = [
      Number(coordinate(target.x - base.x)),
      Number(coordinate(target.y - base.y)),
    ] as const
    return {
      commands: [
        ...sourceCommand(rewriteConstructorLiterals(item.source, components, values)),
        ...scalarCommands(components, (index) => values[index]),
      ],
    }
  }
  if (!interpretation.supportsPosition(rendered.entity)) {
    // The entity carries its own location: rewrite its constructor literal
    // (PGA-VIZ-003) with the pointer's grid-rounded coordinates, scaled by
    // the kept weight of a weighted point (#181).
    const edit = targets.literalEditTarget(item, rendered.entity)
    if (!edit) return NO_EDIT
    const { components } = edit
    const weight = edit.weight ? targets.weightValue(item.source, edit.weight) : 1
    const values = weight === null ? null : weightedViewportCoordinates(point, weight, pixelsPerUnit)
    if (weight === null || !values) return NO_EDIT
    return {
      commands: [
        ...sourceCommand(rewriteConstructorLiterals(item.source, components, values)),
        ...scalarCommands(components, (index) => values[index]),
      ],
      // Where the point is now drawn, for the keyboard announcement.
      drawn: { x: values[0] / weight, y: values[1] / weight },
    }
  }
  const literalPosition = interpretation.formatPosition(coordinate(target.x), coordinate(target.y))
  const components = item.positionSource ? targets.positionComponents(item.positionSource) : null
  if (!item.positionSource || !components) {
    return { commands: [{ kind: 'update-position', itemId, positionSource: literalPosition }] }
  }
  const rewritten = rewriteConstructorLiterals(item.positionSource, components, [target.x, target.y])
  return {
    commands: [
      ...(rewritten !== item.positionSource
        ? [{ kind: 'update-position' as const, itemId, positionSource: rewritten }]
        : []),
      ...scalarCommands(components, (index) => index === 0 ? target.x : target.y),
    ],
  }
}

/**
 * The anchors a base can be linked to from the keyboard, in drawing order:
 * the position of every other named item, and the head of a vector.
 */
export function anchorTargets(
  rendered: readonly RenderedPrimitive[],
  items: readonly ExpressionItem[],
  itemId: string,
): readonly Readonly<{ name: string; property: 'position' | 'head' }>[] {
  return rendered.flatMap((entry) => {
    if (entry.id.includes(':') || entry.id === itemId) return []
    const target = items.find((candidate) => candidate.id === entry.id)
    const name = target ? declaredName(target.source) : null
    if (!name) return []
    const properties = entry.primitive.kind === 'oriented-segment'
      ? ['position', 'head'] as const
      : ['position'] as const
    return properties.map((property) => ({ name, property }))
  })
}
