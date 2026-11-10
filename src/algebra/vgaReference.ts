import {
  generalReference,
  pseudoscalarEntry,
  referenceEntry as entry,
  referenceTopic as topic,
  type ReferenceSection,
  type ReferenceTopic,
} from '../language/expressionReference'

/**
 * The Algebra section of the VGA(2) reference: each primitive, how it is
 * written, and one short line, then the normalization choices of a row.
 */
export const VGA_2_ALGEBRA_REFERENCE: readonly ReferenceTopic[] = [
  topic('Scalar', 'a = 2', 'number', { source: 'a = 2', inspection: '2' }),
  topic('Vector', 'vector(x, y), (x, y)', 'direction (x, y)',
    { source: 'U = vector(1, 2)', inspection: 'e1 + 2e2' }, { source: 'W = (3, -1)', inspection: '3e1 - e2' }),
  topic('Bivector', 'V ^ W, s*e12', 'oriented area',
    { source: 'vector(1, 0) ^ vector(1, 2)', inspection: '2e12' }, { source: 'B = 0.5*e12', inspection: '0.5e12' }),
  topic('Rotor', 'exp(a/2*e12)', 'rotation by a, with R >>> V',
    { source: 'R = exp(pi/4*e12)' }, { source: 'R >>> e1', resultHidden: true }),
  topic('Mixed multivector', '1 + e1', 'several grades', { source: 'M = 1 + e1 + e12', inspection: '1 + e1 + e12' }),
  topic('List', '[A, B, C]', 'list of values', { source: '[e1, e2, e1 + e2]', inspection: '[e1, e2, e1 + e2]' }),
  topic('Normalization', 'norm button', 'off · auto'),
]

/** The general expressions in a VGA(2) document. */
export const VGA_2_GENERAL_REFERENCE: readonly ReferenceSection[] = generalReference({
  regressive: { source: 'e1 & e2', inspection: '-1' },
  dual: { source: '!e1', inspection: 'e2' },
})

/** The VGA(2) expressions: blades, vector syntax, VGA properties and positioning. */
export const VGA_2_REFERENCE: readonly ReferenceSection[] = [
  {
    title: 'Values',
    entries: [
      entry('e1, e2, e12', 'canonical VGA(2) basis blades',
        { source: 'e12', inspection: 'e12' }, { source: 'e21', inspection: '-e12' }),
      pseudoscalarEntry('e12'),
      entry('V = (2, 1)', 'named vector declaration using tuple syntax', { source: 'V = (2, 1)', inspection: '2e1 + e2' }),
      entry('vector(2, 1)', 'explicit vector constructor', { source: 'vector(2, 1)', inspection: '2e1 + e2' }),
    ],
  },
  {
    title: 'Properties',
    entries: [
      entry('A.g0, A.g1, A.g2', 'project onto one grade', 'A = 1 + e1 + e12', { source: 'A.g1', inspection: 'e1' }),
      entry('A.norm', 'primary VGA norm', { source: '(3e1 + 4e2).norm', inspection: '5' }),
      entry('A.e, A.e1, A.e2, A.e12', 'extract one coefficient as a scalar',
        'A = 1 + 2e1 + 3e2 + 4e12', { source: 'A.e2', inspection: '3' }),
      entry('V.position', 'position of a named vector',
        { source: 'V = vector(1, 0)', positionSource: '(1, 2)', inspection: 'e1' }, { source: 'V.position', inspection: 'e1 + 2e2' }),
      entry('B.position', 'position of a named bivector',
        { source: 'B = e12', positionSource: '(1, 1)', inspection: 'e12' }, { source: 'B.position', inspection: 'e1 + e2' }),
      entry('V.head', 'vector-only derived value V.position + V',
        { source: 'V = vector(1, 0)', positionSource: '(1, 2)', inspection: 'e1' }, { source: 'V.head', inspection: '2e1 + 2e2' }),
    ],
  },
  {
    title: 'Positioning',
    entries: [
      entry('position (0, 0)', 'optional field under a vector or bivector row',
        { source: 'V = vector(1, 0)', positionSource: '(0, 0)', inspection: 'e1' }, { source: 'B = e12', inspection: 'e12' }),
      entry('position P.head', 'the position may reference a named expression or its position or head',
        'P = vector(1, 1)', { source: 'V = vector(1, 0)', positionSource: 'P.head', inspection: 'e1' }),
      entry('L.position, L.head', 'a list has no position field',
        'L = [vector(2, 1)]', { source: 'L.head', inspection: '[2e1 + e2]' }),
      entry('invalid position', 'keeps the object value valid',
        { source: 'V = vector(1, 0)', positionSource: 'missing', positionInvalid: true }),
    ],
  },
]
