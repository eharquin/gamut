import { describe, expect, it } from 'vitest'
import { createVga2Engine } from '../algebra/vgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { expressionDocument } from '../document/expressionDocument'
import { formatDisplayValue } from '../presentation/formatNumber'
import { evaluateDocument } from './evaluateDocument'
import { valueSourceEvaluator } from './evaluateScalarControl'
import {
  EMPTY_INSERTION, parseLabelTemplate, RESERVED_DOLLAR, resolveLabelTemplate, UNCLOSED_INSERTION,
} from './labelTemplate'

const engine = createVga2Engine()
const items = evaluateDocument(expressionDocument([
  { id: 't', source: 't = 12' },
  { id: 'v', source: 'v = 2e1 + e2' },
]), { engine, interpretation: VGA_2D_INTERPRETATION })
const resolve = (text: string) => resolveLabelTemplate(
  text, valueSourceEvaluator(items, engine), (value) => formatDisplayValue(value, 4, false),
)

describe('label templates', () => {
  it('splits literal text and inserted expressions', () => {
    expect(parseLabelTemplate('A = ${t} and ${2 * t}')).toEqual({
      parts: [
        { kind: 'text', text: 'A = ' },
        { kind: 'expression', source: 't' },
        { kind: 'text', text: ' and ' },
        { kind: 'expression', source: '2 * t' },
      ],
      problems: [],
    })
  })

  it('writes a dollar sign with \\$ and reserves a lone $ for inline math', () => {
    expect(parseLabelTemplate('\\$5')).toEqual({ parts: [{ kind: 'text', text: '$5' }], problems: [] })
    expect(parseLabelTemplate('$x$')).toEqual({ parts: [{ kind: 'text', text: '$x$' }], problems: [RESERVED_DOLLAR] })
    expect(parseLabelTemplate('a ${t').problems).toEqual([UNCLOSED_INSERTION])
    expect(parseLabelTemplate('a ${ }').problems).toEqual([EMPTY_INSERTION])
  })

  it('shows the values of scalars and multivectors', () => {
    expect(resolve('A = ${t}')).toEqual({ text: 'A = 12', error: null })
    expect(resolve('${t / 2}, v = ${v}')).toEqual({ text: '6, v = 2e1 + e2', error: null })
  })

  it('shows ? for an expression that fails, and says why', () => {
    expect(resolve('B = ${u}')).toEqual({ text: 'B = ?', error: '${u}: The name “u” is not defined.' })
    expect(resolve('cost $5').error).toBe(RESERVED_DOLLAR)
  })
})
