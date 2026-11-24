import { describe, expect, it } from 'vitest'
import { declaredName } from './declaredName'
import { parseDocumentExpression, parseExpression } from './parseExpression'
import { tokenize } from './tokenize'

/** The source of a parsed expression with every binary operation parenthesized. */
function grouped(source: string): string {
  const parsed = parseExpression(source)
  if (!parsed.ok) throw new Error(parsed.diagnostic.message)
  const text = (node: typeof parsed.expression): string => {
    switch (node.kind) {
      case 'binary-expression': return `(${text(node.left)} ${node.operator} ${text(node.right)})`
      case 'reference': return node.name
      case 'scalar-literal': return String(node.value)
      case 'basis-blade': return node.name
      case 'call-expression': return `${node.callee}(${node.arguments.map(text).join(', ')})`
      default: return source.slice(node.span.start, node.span.end)
    }
  }
  return text(parsed.expression)
}

describe('comparisons and the conditional (#339)', () => {
  it('reads each comparison as one token, after the sandwich', () => {
    const kinds = (source: string) => {
      const result = tokenize(source)
      if (!result.ok) throw new Error(result.diagnostic.message)
      return result.tokens.map((token) => `${token.kind}:${token.text}`)
    }
    expect(kinds('a<=b')).toEqual(['identifier:a', 'comparison:<=', 'identifier:b', 'end:'])
    expect(kinds('a != b')).toEqual(['identifier:a', 'comparison:!=', 'identifier:b', 'end:'])
    expect(kinds('R >>> X')).toEqual(['identifier:R', 'sandwich:>>>', 'identifier:X', 'end:'])
    expect(kinds('!e1')).toEqual(['bang:!', 'blade:e1', 'end:'])
  })

  it.each([
    ['a + b < c * d', '((a + b) < (c * d))'],
    ['a - 1 >= b', '((a - 1) >= b)'],
    ['R >>> X == Y', '((R >>> X) == Y)'],
    ['a != -b', '(a != -b)'],
    ['if(x > 0, x, 0)', 'if((x > 0), x, 0)'],
    ['(a < b) * (b < c)', '((a < b) * (b < c))'],
  ])('binds %s as %s', (source, expected) => {
    expect(grouped(source)).toBe(expected)
  })

  it('refuses a chain of comparisons', () => {
    const parsed = parseExpression('a < b < c')
    expect(parsed).toMatchObject({ ok: false, diagnostic: { code: 'LANG_SYNTAX', span: { start: 6, end: 7 } } })
  })

  it('does not read a == b as a declaration', () => {
    expect(parseDocumentExpression('a == b')).toMatchObject({ ok: true, source: { declaration: null } })
    expect(parseDocumentExpression('k = a == b')).toMatchObject({ ok: true, source: { declaration: { name: 'k' } } })
    expect(declaredName('a == b')).toBeNull()
    expect(declaredName(' a==b')).toBeNull()
    expect(declaredName('k = a == b')).toBe('k')
    expect(declaredName('k=1')).toBe('k')
  })

  it('reserves if and sign, and checks the arity of if', () => {
    expect(parseDocumentExpression('if = 1')).toMatchObject({ ok: false, diagnostic: { code: 'LANG_SYNTAX' } })
    expect(parseDocumentExpression('sign = 1')).toMatchObject({ ok: false, diagnostic: { code: 'LANG_SYNTAX' } })
    expect(parseExpression('if(a, b)')).toMatchObject({
      ok: false, diagnostic: { message: '“if” takes exactly 3 arguments.' },
    })
  })
})
