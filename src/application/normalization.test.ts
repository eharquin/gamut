import { describe, expect, it } from 'vitest'
import { createPga2Engine } from '../algebra/pgaEngine'
import { createVga2Engine } from '../algebra/vgaEngine'
import { expressionDocument, type ItemNormalization } from '../document/expressionDocument'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { evaluateDocument } from './evaluateDocument'
import { appliedNorm, isUnitNorm } from './normalization'

const pga = createPga2Engine()
const vga = createVga2Engine()
const PGA = { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } }

function pgaValue(source: string, normalization?: ItemNormalization) {
  const document = { ...expressionDocument([{ id: 'x', source, normalization }]), algebra: PGA }
  const [evaluated] = evaluateDocument(document, { engine: pga, interpretation: PGA_2D_INTERPRETATION })
  if (evaluated.evaluation?.status !== 'valid' || evaluated.evaluation.value.kind !== 'multivector') throw new Error('invalid')
  return evaluated.evaluation.value.coefficients.map((c) => Number(c.toFixed(9)) || 0)
}

// Coefficient order: 1, e0, e1, e2, e01, e02, e12, e012.
describe('normalization modes (#185)', () => {
  it('normalizes a Euclidean point by norm in auto and norm modes, and by inorm in inorm mode', () => {
    expect(pgaValue('point(3, 4, 2)', 'natural')).toEqual([0, 0, 0, 0, 2, -1.5, 1, 0])
    expect(pgaValue('point(3, 4, 2)', 'euclidean')).toEqual([0, 0, 0, 0, 2, -1.5, 1, 0])
    // inorm of a point is the norm of its e01, e02 part: (4, -3) has length 5.
    expect(pgaValue('point(3, 4, 2)', 'ideal')).toEqual([0, 0, 0, 0, 0.8, -0.6, 0.4, 0])
  })

  it('normalizes an ideal point by inorm in auto, and leaves it unchanged when norm is forced', () => {
    expect(pgaValue('ipoint(3, 4)', 'natural')).toEqual([0, 0, 0, 0, 0.8, -0.6, 0, 0])
    expect(pgaValue('ipoint(3, 4)', 'ideal')).toEqual([0, 0, 0, 0, 0.8, -0.6, 0, 0])
    expect(pgaValue('ipoint(3, 4)', 'euclidean')).toEqual([0, 0, 0, 0, 4, -3, 0, 0])
  })

  it('normalizes a line by norm, or by inorm when forced', () => {
    expect(pgaValue('line(3, 4, 10)', 'natural')).toEqual([0, 2, 0.6, 0.8, 0, 0, 0, 0])
    expect(pgaValue('line(3, 4, 10)', 'ideal')).toEqual([0, 1, 0.3, 0.4, 0, 0, 0, 0])
  })

  it('leaves a value unchanged when the forced norm is zero', () => {
    expect(pgaValue('point(0, 0)', 'ideal')).toEqual([0, 0, 0, 0, 0, 0, 1, 0])
    expect(pga.normalize(pga.call('point', [pga.scalar(0), pga.scalar(0)]), 'ideal').status).toBe('unavailable')
  })

  it('follows the classification in auto: a point of negligible weight is ideal (PGA-INT-006)', () => {
    const value = pga.add(pga.call('ipoint', [pga.scalar(3), pga.scalar(4)]), pga.scalar(0))
    const almostIdeal = { ...value, coefficients: value.coefficients.map((c, index) => index === 6 ? 1e-14 : c) }
    expect(PGA_2D_INTERPRETATION.interpret(almostIdeal).kind).toBe('ideal-point')
    expect(appliedNorm('natural', almostIdeal, pga, PGA_2D_INTERPRETATION)).toBe('ideal')
    // The engine's former choice divided by the tiny Euclidean norm.
    expect(Math.abs(pga.normalize(almostIdeal).value.coefficients[4])).toBeGreaterThan(1e10)
    expect(pgaValue('point(3, 4, 1e-14)', 'natural').slice(4, 6)).toEqual([0.8, -0.6])
  })

  it('keeps the engine choice for a value the classification does not decide', () => {
    const motor = pga.add(pga.scalar(2), pga.basisBlade('e01'))
    expect(appliedNorm('natural', motor, pga, PGA_2D_INTERPRETATION)).toBeNull()
    expect(pgaValue('2 + e01', 'natural')).toEqual([1, 0, 0, 0, 0.5, 0, 0, 0])
  })

  it('has one norm in VGA: auto and norm divide by it, inorm is unavailable', () => {
    const v = vga.call('vector', [vga.scalar(3), vga.scalar(4)])
    expect(appliedNorm('natural', v, vga, VGA_2D_INTERPRETATION)).toBe('euclidean')
    expect(vga.normalize(v, 'euclidean').value.coefficients.map((c) => Number(c.toFixed(9)))).toEqual([0, 0.6, 0.8, 0])
    expect(vga.normalize(v, 'ideal').status).toBe('unavailable')
  })

  it('measures the unit badge by the norm the mode applies', () => {
    const ideal = pga.call('ipoint', [pga.scalar(0.6), pga.scalar(0.8)])
    expect(isUnitNorm(undefined, ideal, pga, PGA_2D_INTERPRETATION)).toBe(true)
    expect(isUnitNorm('natural', ideal, pga, PGA_2D_INTERPRETATION)).toBe(true)
    expect(isUnitNorm('euclidean', ideal, pga, PGA_2D_INTERPRETATION)).toBe(false)
    const point = pga.call('point', [pga.scalar(0.6), pga.scalar(0.8)])
    expect(isUnitNorm('natural', point, pga, PGA_2D_INTERPRETATION)).toBe(true)
    expect(isUnitNorm('ideal', point, pga, PGA_2D_INTERPRETATION)).toBe(true)
    expect(isUnitNorm('ideal', pga.call('point', [pga.scalar(2), pga.scalar(0)]), pga, PGA_2D_INTERPRETATION)).toBe(false)
  })
})
