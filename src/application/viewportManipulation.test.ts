import { describe, expect, it } from 'vitest'
import { createPga2Engine } from '../algebra/pgaEngine'
import { createVga2Engine } from '../algebra/vgaEngine'
import { expressionDocument, type ExpressionAppearance } from '../document/expressionDocument'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import type { AnyInterpretation } from '../geometry/interpretation'
import { declaredName } from '../language/declaredName'
import { collectRenderedPrimitives } from '../visualization/layout'
import { evaluateDocument } from './evaluateDocument'
import {
  anchorTargets,
  dragTargets,
  lineCoefficients,
  linePrimitive,
  manipulationEdit,
  projectOnLine,
  type ManipulationKind,
} from './viewportManipulation'

const PGA = { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } }

function scene(
  algebra: 'vga' | 'pga',
  items: readonly (readonly [string, string] | readonly [string, string, string])[],
  appearance: Readonly<Record<string, ExpressionAppearance>> = {},
) {
  const engine = algebra === 'pga' ? createPga2Engine() : createVga2Engine()
  const interpretation = (algebra === 'pga' ? PGA_2D_INTERPRETATION : VGA_2D_INTERPRETATION) as AnyInterpretation
  const base = expressionDocument(items.map(([id, source, positionSource]) => ({ id, source, ...(positionSource ? { positionSource } : {}) })), appearance)
  const document = algebra === 'pga' ? { ...base, algebra: PGA } : base
  const evaluatedItems = evaluateDocument(document, { engine, interpretation })
  const { rendered } = collectRenderedPrimitives(evaluatedItems, document.appearance, interpretation, declaredName)
  const context = { document, evaluatedItems, interpretation, tuple: engine.tuple ?? null, pixelsPerUnit: 72 }
  const targets = dragTargets(context)
  type Request = Parameters<typeof manipulationEdit>[2]
  const move = (
    id: string, kind: ManipulationKind, point: { x: number; y: number },
    lineDrag: Request['lineDrag'] = null, selectedLine: Request['selectedLine'] = null,
  ) =>
    manipulationEdit(context, targets, {
      item: document.items.find((item) => item.id === id)!,
      rendered: rendered.find((entry) => entry.id === id)!,
      kind, point, lineDrag, selectedLine,
    })
  const entity = (id: string) => rendered.find((entry) => entry.id === id)!.entity
  const item = (id: string) => document.items.find((candidate) => candidate.id === id)!
  return { document, rendered, targets, move, entity, item }
}

describe('direct manipulation edits (#173)', () => {
  it('rewrites the literal of a dragged PGA point', () => {
    const { move } = scene('pga', [['p', 'P = point(1, 2)']])
    expect(move('p', 'base', { x: 3, y: -1 }).commands).toEqual([
      { kind: 'update-source', itemId: 'p', source: 'P = point(3, -1)' },
    ])
  })

  it('sets the scalar row a referenced component names instead of the source', () => {
    const { move } = scene('pga', [['a', 'a = 1'], ['p', 'P = point(a, 2)']])
    expect(move('p', 'base', { x: 4, y: 5 }).commands).toEqual([
      { kind: 'update-source', itemId: 'p', source: 'P = point(a, 5)' },
      { kind: 'set-scalar-value', itemId: 'a', value: 4 },
    ])
  })

  it('keeps the weight of a weighted point and says where it is drawn', () => {
    const { move } = scene('pga', [['p', 'P = point(2, 4, 2)']])
    const edit = move('p', 'base', { x: 3, y: 1 })
    expect(edit.commands).toEqual([{ kind: 'update-source', itemId: 'p', source: 'P = point(6, 2, 2)' }])
    expect(edit.drawn).toEqual({ x: 3, y: 1 })
  })

  it('moves the head of a VGA vector relative to its base', () => {
    const { move } = scene('vga', [['v', 'v = vector(1, 1)']])
    expect(move('v', 'head', { x: 2, y: 3 }).commands).toEqual([
      { kind: 'update-source', itemId: 'v', source: 'v = vector(2, 3)' },
    ])
  })

  it('writes a literal position for a VGA base without one', () => {
    const { move } = scene('vga', [['v', 'v = vector(1, 1)']])
    expect(move('v', 'base', { x: 1, y: -2 }).commands).toEqual([
      { kind: 'update-position', itemId: 'v', positionSource: VGA_2D_INTERPRETATION.formatPosition('1', '-2') },
    ])
  })

  it('translates a line from the press, keeping its direction', () => {
    const { move, rendered } = scene('pga', [['l', 'L = line(0, 1, -1)']])
    const line = linePrimitive(rendered[0])!
    const point = projectOnLine(line, { x: 0, y: 0 })
    const edit = move('l', 'line', { x: point.x, y: point.y + 2 }, { point, anchor: point, coefficients: lineCoefficients(line) })
    expect(edit.commands).toEqual([{ kind: 'update-source', itemId: 'l', source: 'L = line(0, 1, -3)' }])
    // Without a press, nothing moves.
    expect(move('l', 'line', { x: 0, y: 3 }).commands).toEqual([])
  })

  it('carries the selected line\'s anchor along a translation', () => {
    const { move, rendered } = scene('pga', [['l', 'L = line(0, 1, -1)']])
    const line = linePrimitive(rendered[0])!
    const point = projectOnLine(line, { x: 0, y: 0 })
    const press = { point, anchor: point, coefficients: lineCoefficients(line) }
    const to = { x: point.x + 3, y: point.y + 2 }
    expect(move('l', 'line', to, press, { itemId: 'l', anchor: point }).selectedLineAnchor)
      .toEqual({ x: point.x + 3, y: point.y + 2 })
    // Another line's selection does not travel.
    expect(move('l', 'line', to, press, { itemId: 'other', anchor: point }).selectedLineAnchor).toBeUndefined()
  })

  it('rotates a line about the selected anchor, which stays on it', () => {
    const { move } = scene('pga', [['l', 'L = line(0, 1, -1)']])
    // The horizontal line y = 1, anchored at (2, 1), turned towards (3, 2).
    const edit = move('l', 'normal', { x: 3, y: 2 }, null, { itemId: 'l', anchor: { x: 2, y: 1 } })
    expect(edit.commands).toHaveLength(1)
    const [a, b, c] = /line\(([^,]+), ([^,]+), ([^)]+)\)/.exec((edit.commands[0] as { source: string }).source)!.slice(1).map(Number)
    expect(a * 2 + b * 1 + c).toBeCloseTo(0, 3)
    expect(a).toBeCloseTo(b, 3)
    // Pressing the anchor itself has no direction: nothing changes.
    expect(move('l', 'normal', { x: 2, y: 1 }, null, { itemId: 'l', anchor: { x: 2, y: 1 } }).commands).toEqual([])
  })

  it('rewrites a literal position and its referenced scalar, and replaces any other position', () => {
    const literal = scene('vga', [['a', 'a = 1'], ['v', 'v = vector(1, 1)', 'vector(a, 2)']])
    expect(literal.move('v', 'base', { x: 3, y: 4 }).commands).toEqual([
      { kind: 'update-position', itemId: 'v', positionSource: 'vector(a, 4)' },
      { kind: 'set-scalar-value', itemId: 'a', value: 3 },
    ])
    const computed = scene('vga', [['u', 'u = vector(1, 0)'], ['v', 'v = vector(1, 1)', '2 * u']])
    expect(computed.move('v', 'base', { x: 3, y: 4 }).commands).toEqual([
      { kind: 'update-position', itemId: 'v', positionSource: VGA_2D_INTERPRETATION.formatPosition('3', '4') },
    ])
  })

  it('writes nothing when the rounded literal is unchanged', () => {
    const { move } = scene('pga', [['p', 'P = point(1, 2)']])
    expect(move('p', 'base', { x: 1.0001, y: 2 }).commands).toEqual([])
  })

  it('lets nothing move an object held in place, though a drag could', () => {
    const { targets, entity, item } = scene('pga', [['p', 'P = point(1, 2)']], { p: { draggable: false } as ExpressionAppearance })
    expect(targets.baseMovable(item('p'), entity('p'))).toBe(false)
    expect(targets.draggableByConstruction(item('p'), entity('p'))).toBe(true)
    const held = scene('vga', [['v', 'v = vector(1, 1)']], { v: { draggable: false } as ExpressionAppearance })
    expect(held.targets.headMovable(held.item('v'), held.entity('v'))).toBe(false)
    const free = scene('vga', [['v', 'v = vector(1, 1)']])
    expect(free.targets.headMovable(free.item('v'), free.entity('v'))).toBe(true)
  })

  it('offers the position of every other named object, and the head of a vector, as anchors', () => {
    const { rendered, document } = scene('vga', [['u', 'u = vector(1, 0)'], ['v', 'v = vector(0, 1)'], ['w', 'vector(1, 1)']])
    expect(anchorTargets(rendered, document.items, 'v')).toEqual([
      { name: 'u', property: 'position' },
      { name: 'u', property: 'head' },
    ])
  })
})
