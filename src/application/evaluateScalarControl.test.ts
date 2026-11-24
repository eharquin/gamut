import { describe, expect, it } from 'vitest'
import { createVga2Engine } from '../algebra/vgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { expressionDocument, type ExpressionControl } from '../document/expressionDocument'
import { evaluateDocument } from './evaluateDocument'
import { evaluateScalarControl } from './evaluateScalarControl'

const engine = createVga2Engine()
const context = { engine, interpretation: VGA_2D_INTERPRETATION }
const control = (change: Partial<ExpressionControl> = {}): ExpressionControl => ({
  mode: 'slider', minimumSource: '-10', maximumSource: '10', stepSource: '0.1',
  animation: null, ...change,
})

describe('scalar control evaluation', () => {
  it('evaluates expression-valued scalar bounds against declarations', () => {
    const items = evaluateDocument(expressionDocument([
      { id: 'a', source: 'a = 2' },
      { id: 'b', source: 'b = 5' },
    ]), context)
    expect(evaluateScalarControl(control({
      minimumSource: '-a', maximumSource: 'b + 1', stepSource: 'a / 4',
    }), items, engine)).toMatchObject({
      status: 'valid', minimum: -2, maximum: 6, step: 0.5,
    })
  })

  it('does not read an anonymous comparison a == b as a declaration of a (#339)', () => {
    const items = evaluateDocument(expressionDocument([
      { id: 'a', source: 'a = 2' },
      { id: 'c', source: 'a == 3' },
    ]), context)
    expect(evaluateScalarControl(control({ minimumSource: '-a' }), items, engine)).toMatchObject({
      status: 'valid', minimum: -2,
    })
  })

  it('rejects non-scalar, invalid, and unordered bounds', () => {
    const items = evaluateDocument(expressionDocument([
      { id: 'v', source: 'v = e1' },
    ]), context)
    expect(evaluateScalarControl(control({ minimumSource: 'v' }), items, engine)
      .fields.minimum).toMatchObject({ status: 'invalid' })
    expect(evaluateScalarControl(control({ minimumSource: '2', maximumSource: '1' }), items, engine))
      .toMatchObject({ status: 'invalid', diagnostic: 'Minimum must be less than maximum.' })
  })

  it('derives empty bounds and step from the scalar value', () => {
    const items = evaluateDocument(expressionDocument([{ id: 't', source: 't = 12' }]), context)
    const empty = control({ minimumSource: '', maximumSource: '', stepSource: '' })
    const derived = (value: number) => evaluateScalarControl(empty, items, engine, value)
    // Inside [−10, 10] the interval is [−10, 10]; a value beyond widens its side.
    expect(derived(3)).toMatchObject({ status: 'valid', minimum: -10, maximum: 10, step: 0.2 })
    expect(derived(12)).toMatchObject({ status: 'valid', minimum: -10, maximum: 12, step: 0.22 })
    expect(derived(-30)).toMatchObject({ status: 'valid', minimum: -30, maximum: 10, step: 0.4 })
    expect(derived(12).fields.maximum).toEqual({ status: 'valid', value: 12, derived: true })
    // A given field is kept; the step follows the interval it gives.
    expect(evaluateScalarControl(control({ minimumSource: '0', maximumSource: '', stepSource: '' }), items, engine, 4))
      .toMatchObject({ status: 'valid', minimum: 0, maximum: 10, step: 0.1 })
    // A derived bound never meets a given one.
    expect(evaluateScalarControl(control({ minimumSource: '15', maximumSource: '', stepSource: '' }), items, engine, 0))
      .toMatchObject({ status: 'valid', minimum: 15, maximum: 35 })
  })
})
