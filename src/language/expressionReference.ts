/**
 * One row of the example document that backs a reference entry. Every row
 * must evaluate to a valid value in the algebra whose reference shows the
 * entry; `inspection` pins the canonical text of that value. A row with a
 * `positionSource` must also have a valid position, unless `positionInvalid`
 * documents a rejected one. A declaration without `inspection` is a setup row
 * that the reference shows as “with …”, unless `resultHidden` marks a valid
 * row whose floating-point result is too long to show.
 */
export type ReferenceExample = Readonly<{
  source: string
  positionSource?: string
  inspection?: string
  positionInvalid?: true
  resultHidden?: true
}>

/**
 * One documented syntax, its meaning, and the examples that keep it honest.
 * The reference stays concise (#259): one short line of meaning and at most
 * two example rows, setup rows included.
 */
export type ReferenceEntry = Readonly<{
  syntax: string
  meaning: string
  examples: readonly ReferenceExample[]
}>

export type ReferenceSection = Readonly<{
  title: string
  entries: readonly ReferenceEntry[]
}>

/**
 * A named topic of the reference: a primitive of the algebra, its
 * normalization, or a style setting. `syntax` is how it is written or the
 * values it takes; `meaning` is optional and one short line. A primitive may
 * carry at most two addable examples, checked like those of an entry.
 */
export type ReferenceTopic = Readonly<{
  name: string
  syntax: string
  meaning?: string
  examples?: readonly ReferenceExample[]
}>

/** Largest number of example rows an entry shows. */
export const MAX_REFERENCE_EXAMPLES = 2

export function referenceEntry(syntax: string, meaning: string, ...examples: (string | ReferenceExample)[]): ReferenceEntry {
  return {
    syntax,
    meaning,
    examples: examples.map((example) => typeof example === 'string' ? { source: example } : example),
  }
}

export function referenceTopic(
  name: string, syntax: string, meaning?: string, ...examples: (string | ReferenceExample)[]
): ReferenceTopic {
  return {
    name,
    syntax,
    ...(meaning === undefined ? {} : { meaning }),
    ...(examples.length === 0 ? {} : {
      examples: examples.map((example) => typeof example === 'string' ? { source: example } : example),
    }),
  }
}

/** Whether a row only declares a name for the next row, shown as “with …”. */
export function isSetupExample(example: ReferenceExample): boolean {
  return example.inspection === undefined && example.positionSource === undefined && !example.resultHidden
    && /^\s*[A-Za-z_]\w*\s*=(?!=)/.test(example.source)
}

const entry = referenceEntry
const topic = referenceTopic

/*
 * Entries shared by every algebra. Their examples use only `e1`, `e2`, and
 * `e12`, which every registered two-dimensional algebra provides; each
 * algebra's reference test evaluates them again in that algebra.
 */

export const SCALAR_LITERALS = entry('12, 3.5, 1e-3', 'finite scalar literals',
  { source: '3.5', inspection: '3.5' }, { source: '1e-3', inspection: '0.001' })

/** The pseudoscalar entry, with the blade it is in the algebra. */
export function pseudoscalarEntry(blade: string): ReferenceEntry {
  return entry('ps', 'canonical pseudoscalar', { source: 'ps', inspection: blade })
}

export const NAME_REFERENCE = entry('V', 'case-sensitive reference to a named expression',
  'V = 2', { source: 'V', inspection: '2' })

export const LISTS_AND_RANGES: ReferenceSection = {
  title: 'Lists and ranges',
  entries: [
    entry('[A, B, C]', 'ordered list literal', { source: '[1, e1, e12,]', inspection: '[1, e1, e12]' }),
    entry('[1...5]', 'inclusive unit-step integer range', { source: '[1...5]', inspection: '[1, 2, 3, 4, 5]' }),
    entry('[1, 3...7]', 'integer range with an explicit next term', { source: '[1, 3...7]', inspection: '[1, 3, 5, 7]' }),
    entry('L[0]', 'zero-based list indexing', 'L = [4, 5, 6]', { source: 'L[0]', inspection: '4' }),
    entry('L[[2, 0, 2]]', 'gather indexing', 'L = [4, 5, 6]', { source: 'L[[2, 0, 2]]', inspection: '[6, 4, 6]' }),
    entry('L + A', 'broadcast one value over a list', { source: '[1, 2] + e1', inspection: '[1 + e1, 2 + e1]' }),
    entry('L + M', 'elementwise or singleton-list broadcasting',
      { source: '[1, 2] + [10, 20]', inspection: '[11, 22]' }, { source: '[1, 2] + [10]', inspection: '[11, 12]' }),
  ],
}

/** The operators, with a regressive-product and a dual example suited to the algebra. */
export function operatorsSection(examples: Readonly<{ regressive: ReferenceExample; dual: ReferenceExample }>): ReferenceSection {
  return {
    title: 'Operators',
    entries: [
      entry('A + B, A - B', 'addition and subtraction', { source: 'e1 + e2', inspection: 'e1 + e2' }, { source: 'e1 - e2', inspection: 'e1 - e2' }),
      entry('A * B', 'geometric product', { source: 'e1 * e2', inspection: 'e12' }),
      entry('A / B', 'division when B is invertible', { source: 'e12 / e2', inspection: 'e1' }),
      entry('a % m', 'Euclidean scalar modulo', { source: '-7 % 3', inspection: '2' }),
      entry('A**n', 'integer geometric power', { source: 'e12**2', inspection: '-1' }),
      entry('A ^ B', 'outer product', { source: 'e1 ^ e2', inspection: 'e12' }),
      entry('A | B', 'inner product', { source: 'e1 | e1', inspection: '1' }),
      entry('A & B', 'regressive product', examples.regressive),
      entry('+A, -A', 'unary sign', { source: '-e1', inspection: '-e1' }),
      entry('~A, A.reverse', 'reverse', { source: '~e12', inspection: '-e12' }, { source: 'e12.reverse', inspection: '-e12' }),
      entry('!A, A.dual', 'dual', examples.dual),
      entry('A.involution', 'grade involution', { source: '(1 + e1).involution', inspection: '1 - e1' }),
      entry('R >>> A', 'sandwich action R * A * ~R', { source: 'e12 >>> e1', inspection: '-e1' }),
    ],
  }
}

export const INVERSE = entry('A.inverse', 'inverse when it exists', { source: '(2e1).inverse', inspection: '0.5e1' })

export const FUNCTIONS: readonly ReferenceEntry[] = [
  entry('exp(A)', 'scalar or closed-form multivector exponential',
    { source: 'exp(0)', inspection: '1' }, { source: 'exp(0 * e12)', inspection: '1' }),
  entry('sin(a), cos(a), tan(a)', 'scalar trigonometric functions',
    { source: 'sin(0)', inspection: '0' }, { source: 'cos(0)', inspection: '1' }),
  entry('asin(a), acos(a), atan(a), atan2(y, x)', 'scalar inverse trigonometric functions',
    { source: 'asin(0)', inspection: '0' }, { source: 'atan2(0, 1)', inspection: '0' }),
  entry('sinh(a), cosh(a), tanh(a)', 'scalar hyperbolic functions',
    { source: 'sinh(0)', inspection: '0' }, { source: 'cosh(0)', inspection: '1' }),
  entry('abs(a), sqrt(a), log(a), min(a, b), max(a, b)', 'scalar functions',
    { source: 'sqrt(4)', inspection: '2' }, { source: 'max(1, 2)', inspection: '2' }),
  entry('pi, tau', 'predefined scalar constants', { source: 'cos(pi)', inspection: '-1' }, { source: 'cos(tau)', inspection: '1' }),
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

/**
 * The general expressions, true in every algebra (#259). Only the examples of
 * the regressive product and the dual depend on the algebra.
 */
export function generalReference(examples: Readonly<{ regressive: ReferenceExample; dual: ReferenceExample }>): readonly ReferenceSection[] {
  return [
    { title: 'Values and names', entries: [SCALAR_LITERALS, NAME_REFERENCE] },
    LISTS_AND_RANGES,
    operatorsSection(examples),
    { title: 'Properties', entries: [INVERSE] },
    { title: 'Functions', entries: FUNCTIONS },
    PRECEDENCE,
  ]
}

/**
 * What the appearance menu sets: values only, never a default color (#259).
 */
export const STYLE_REFERENCE: readonly ReferenceTopic[] = [
  topic('Color', '9 hues × 6 shades'),
  topic('Opacity', '0–100 %'),
  topic('Stroke', 'solid · dashed · dotted, 0.25–10 px'),
  topic('Point', 'dot · ring · cross · plus · square · diamond, 1–20 px'),
  topic('Label', 'angle · size · distance · position (Auto)'),
  topic('Visibility', 'eye'),
  topic('Values', 'a number or a scalar name'),
]
