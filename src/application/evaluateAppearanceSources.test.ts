import { describe, expect, it } from 'vitest'
import { createVga2Engine } from '../algebra/vgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { expressionDocument, type ExpressionAppearance } from '../document/expressionDocument'
import { evaluateDocument } from './evaluateDocument'
import { evaluateAppearanceSources } from './evaluateAppearanceSources'

const engine = createVga2Engine()
const context = { engine, interpretation: VGA_2D_INTERPRETATION }

function sourcesOf(appearance: ExpressionAppearance, extra: readonly string[] = ['w = 2.4']) {
  const document = expressionDocument([
    ...extra.map((source, index) => ({ id: `s${index}`, source })),
    { id: 'v', source: 'V = vector(2, 1)' },
  ], { v: appearance })
  return evaluateAppearanceSources(document, evaluateDocument(document, context), engine).get('v')
}

describe('appearance sources', () => {
  it('reads a number, a scalar name, or a scalar expression', () => {
    expect(sourcesOf({ strokeWidthSource: '1.5' })?.strokeWidth).toEqual({ value: 1.5, error: null })
    expect(sourcesOf({ strokeWidthSource: 'w' })?.strokeWidth).toEqual({ value: 2.4, error: null })
    expect(sourcesOf({ opacitySource: '20 * w' })?.opacity).toEqual({ value: 48, error: null })
  })

  it('follows the value of the scalar it names', () => {
    expect(sourcesOf({ strokeWidthSource: 'w' }, ['w = 7'])?.strokeWidth.value).toBe(7)
  })

  it('uses the kind default for an empty source, without an error', () => {
    const sources = sourcesOf({ strokeWidthSource: '  ', opacitySource: '50' })!
    expect(sources.strokeWidth).toEqual({ value: null, error: null })
    expect(sources.pointSize).toEqual({ value: null, error: null })
    expect(sourcesOf({ strokeStyle: 'dashed' })).toBeUndefined()
  })

  it('refuses invalid text, unknown names, non-scalar and out-of-range values', () => {
    const refused = (appearance: ExpressionAppearance, extra?: readonly string[]) => {
      const sources = sourcesOf(appearance, extra)!
      return [sources.strokeWidth, sources.opacity].find((result) => result.error !== null)
    }
    expect(refused({ strokeWidthSource: '2 +' })).toEqual({ value: null, error: 'Enter a number or a scalar expression. Default used.' })
    expect(refused({ strokeWidthSource: 'k' })).toEqual({ value: null, error: 'The name “k” is not defined. Default used.' })
    expect(refused({ strokeWidthSource: 'e1' })).toEqual({ value: null, error: 'The value is not a real scalar. Default used.' })
    expect(refused({ strokeWidthSource: 'V' })).toEqual({ value: null, error: 'The value is not a real scalar. Default used.' })
    expect(refused({ strokeWidthSource: '0.1' })).toEqual({ value: null, error: '0.1 is outside 0.25 to 10. Default used.' })
    expect(refused({ opacitySource: '120' })).toEqual({ value: null, error: '120 is outside 0 to 100. Default used.' })
    expect(refused({ strokeWidthSource: 'w' }, ['w = 2', 'w = 3'])?.error).toMatch(/declared more than once/)
  })

  it('accepts the limits of each range', () => {
    expect(sourcesOf({ strokeWidthSource: '0.25' })?.strokeWidth.value).toBe(0.25)
    expect(sourcesOf({ strokeWidthSource: '10' })?.strokeWidth.value).toBe(10)
    expect(sourcesOf({ opacitySource: '0' })?.opacity.value).toBe(0)
  })

  it('evaluates the sources of a list primitive type on their own', () => {
    const sources = sourcesOf({ primitiveStyles: { lines: { strokeWidthSource: 'w / 2' } } })!
    expect(sources.lines.strokeWidth).toEqual({ value: 1.2, error: null })
    expect(sources.strokeWidth).toEqual({ value: null, error: null })
  })
})
