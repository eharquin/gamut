/**
 * One row of the example document that backs a reference entry. Every row
 * must evaluate to a valid value in the algebra whose reference shows the
 * entry; `inspection` pins the canonical text of that value. A row with a
 * `positionSource` must also have a valid position, unless `positionInvalid`
 * documents a rejected one.
 */
export type ReferenceExample = Readonly<{
  source: string
  positionSource?: string
  inspection?: string
  positionInvalid?: true
}>

/** One documented syntax, its meaning, and the examples that keep it honest. */
export type ReferenceEntry = Readonly<{
  syntax: string
  meaning: string
  examples: readonly ReferenceExample[]
}>

export type ReferenceSection = Readonly<{
  title: string
  entries: readonly ReferenceEntry[]
}>

export function referenceEntry(syntax: string, meaning: string, ...examples: (string | ReferenceExample)[]): ReferenceEntry {
  return {
    syntax,
    meaning,
    examples: examples.map((example) => typeof example === 'string' ? { source: example } : example),
  }
}

const entry = referenceEntry

/*
 * Entries shared by every algebra. Their examples use only `e1`, `e2`, and
 * `e12`, which every registered two-dimensional algebra provides; each
 * algebra's reference test evaluates them again in that algebra.
 */

export const SCALAR_LITERALS = entry('12, 3.5, 1e-3', 'finite scalar literals',
  { source: '12', inspection: '12' }, { source: '3.5', inspection: '3.5' }, { source: '1e-3', inspection: '0.001' })

export const PSEUDOSCALAR = entry('ps', 'canonical pseudoscalar of the active algebra', 'ps')

export const NAME_REFERENCE = entry('V', 'case-sensitive reference to a named expression',
  'V = 2', { source: 'V', inspection: '2' })

export const LISTS_AND_RANGES: ReferenceSection = {
  title: 'Lists and ranges',
  entries: [
    entry('[A, B, C]', 'ordered list literal; a trailing comma is allowed',
      { source: '[1, e1, e12,]', inspection: '[1, e1, e12]' }),
    entry('[1...5]', 'inclusive unit-step integer range', { source: '[1...5]', inspection: '[1, 2, 3, 4, 5]' }),
    entry('[1, 3...7]', 'integer range with an explicit next term', { source: '[1, 3...7]', inspection: '[1, 3, 5, 7]' }),
    entry('L[0]', 'zero-based list indexing', 'L = [4, 5, 6]', { source: 'L[0]', inspection: '4' }),
    entry('L[[2, 0, 2]]', 'gather indexing; order and duplicates are preserved',
      'L = [4, 5, 6]', { source: 'L[[2, 0, 2]]', inspection: '[6, 4, 6]' }),
    entry('L + A', 'broadcast one value over a list', { source: '[1, 2] + e1', inspection: '[1 + e1, 2 + e1]' }),
    entry('L + M', 'elementwise or singleton-list broadcasting',
      { source: '[1, 2] + [10, 20]', inspection: '[11, 22]' }, { source: '[1, 2] + [10]', inspection: '[11, 12]' }),
  ],
}

export const OPERATORS: ReferenceSection = {
  title: 'Operators',
  entries: [
    entry('A + B, A - B', 'addition and subtraction', { source: 'e1 + e2', inspection: 'e1 + e2' }, { source: 'e1 - e2', inspection: 'e1 - e2' }),
    entry('A * B', 'geometric product', { source: 'e1 * e2', inspection: 'e12' }),
    entry('A / B', 'division when B is invertible', { source: 'e12 / e2', inspection: 'e1' }),
    entry('a % m', 'Euclidean scalar modulo for a positive modulus m', { source: '-7 % 3', inspection: '2' }),
    entry('A**n', 'integer geometric power', { source: 'e12**2', inspection: '-1' }),
    entry('A ^ B', 'outer product', { source: 'e1 ^ e2', inspection: 'e12' }),
    entry('A | B', 'inner product', { source: 'e1 | e1', inspection: '1' }),
    entry('A & B', 'regressive product', 'e1 & e2'),
    entry('+A, -A', 'unary sign', { source: '+e1', inspection: 'e1' }, { source: '-e1', inspection: '-e1' }),
    entry('~A, A.reverse', 'reverse', { source: '~e12', inspection: '-e12' }, { source: 'e12.reverse', inspection: '-e12' }),
    entry('!A, A.dual', 'dual', '!e1', 'e1.dual'),
    entry('A.involution', 'grade involution', { source: '(1 + e1).involution', inspection: '1 - e1' }),
    entry('R >>> A', 'sandwich action R * A * ~R', { source: 'e12 >>> e1', inspection: '-e1' }),
  ],
}

export const INVERSE = entry('A.inverse', 'inverse when it exists', { source: '(2e1).inverse', inspection: '0.5e1' })

export const FUNCTIONS: readonly ReferenceEntry[] = [
  entry('exp(A)', 'scalar or supported closed-form multivector exponential',
    { source: 'exp(0)', inspection: '1' }, 'exp(pi/4 * e12)'),
  entry('sin(a), cos(a), tan(a)', 'scalar trigonometric functions', 'sin(1)', 'cos(1)', 'tan(1)'),
  entry('asin(a), acos(a), atan(a), atan2(y, x)', 'scalar inverse trigonometric functions',
    'asin(0.5)', 'acos(0.5)', 'atan(1)', { source: 'atan2(0, 1)', inspection: '0' }),
  entry('sinh(a), cosh(a), tanh(a)', 'scalar hyperbolic functions', 'sinh(1)', 'cosh(1)', 'tanh(1)'),
  entry('abs(a), sqrt(a), log(a), min(a, b), max(a, b)', 'scalar functions',
    { source: 'abs(-2)', inspection: '2' }, { source: 'sqrt(4)', inspection: '2' }, { source: 'log(1)', inspection: '0' },
    { source: 'min(1, 2)', inspection: '1' }, { source: 'max(1, 2)', inspection: '2' }),
  entry('pi, tau', 'predefined scalar constants', 'pi', 'tau'),
]

export const PRECEDENCE: ReferenceSection = {
  title: 'Precedence',
  entries: [
    entry('(...) calls, L[i], and properties', 'strongest', { source: '-e1.e1', inspection: '-1' }),
    entry('A**n', 'right-associative geometric power', { source: '2**3**2', inspection: '512' }),
    entry('!A, ~A, +A, -A', 'unary operations', { source: '-2**2', inspection: '-4' }),
    entry('A ^ B, A & B, A | B', 'geometric derived products', { source: 'e1 * e2 ^ e1', inspection: '-e2' }),
    entry('A * B, A / B, a % m', 'geometric product, division, and scalar modulo', { source: '2 * e12 >>> e1', inspection: '-4e1' }),
    entry('R >>> A', 'sandwich action', { source: 'e1 + e12 >>> e1', inspection: '0' }),
    entry('A + B, A - B', 'weakest', { source: '1 + 2 * 3', inspection: '7' }),
  ],
}
