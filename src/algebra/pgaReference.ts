import {
  generalReference,
  pseudoscalarEntry,
  referenceEntry as entry,
  referenceTopic as topic,
  type ReferenceSection,
  type ReferenceTopic,
} from '../language/expressionReference'

/**
 * The Algebra section of the PGA(2) reference: each primitive, how it is
 * written, and one short line, then the normalization choices of a row.
 */
export const PGA_2_ALGEBRA_REFERENCE: readonly ReferenceTopic[] = [
  topic('Point', 'point(x, y), point(x, y, w)', 'point (x, y), weight w',
    { source: 'P = point(1, 2)', inspection: '2e01 - e02 + e12' }, { source: 'point(2, 4, 2)', inspection: '4e01 - 2e02 + 2e12' }),
  topic('Ideal point', 'ipoint(x, y)', 'direction (x, y)', { source: 'D = ipoint(1, 1)', inspection: 'e01 - e02' }),
  topic('Line', 'line(a, b, c), A & B', 'a·x + b·y + c = 0, or the line through A and B',
    { source: 'L = line(1, -1, 0)', inspection: 'e1 - e2' }, { source: 'point(0, 1) & point(2, 1)', inspection: '-2e0 + 2e2' }),
  topic('Line at infinity', 'e0', 'the line at infinity', { source: 'e0', inspection: 'e0' }),
  topic('Translator', 'exp(t*e01)', 'translation, with T >>> X',
    { source: 'T = exp(e01)', inspection: '1 + e01' }, { source: 'T >>> point(0, 0)', inspection: '2e02 + e12' }),
  topic('Motor', 'exp(a*e12)', 'rotation and translation, with M >>> X',
    { source: 'M = exp(pi/4*e12)' }, { source: 'M >>> point(1, 0)', resultHidden: true }),
  topic('Reflection', 'L >>> X', 'reflection in L',
    { source: 'L = line(1, 0, 0)' }, { source: 'L >>> point(1, 2)', inspection: '-2e01 - e02 - e12' }),
  topic('List', '[A, B, C]', 'list of values', { source: '[point(0, 0), point(1, 0), point(0, 1)]', inspection: '[e12, -e02 + e12, e01 + e12]' }),
  topic('Normalization', 'norm button', 'off · auto · norm · inorm'),
]

/** The general expressions in a PGA(2) document. */
export const PGA_2_GENERAL_REFERENCE: readonly ReferenceSection[] = generalReference({
  regressive: { source: 'point(0, 0) & point(1, 0)', inspection: 'e2' },
  dual: { source: '!e1', inspection: '-e02' },
})

/** The PGA(2) expressions: blades, constructors, PGA properties, motor functions and positioning. */
export const PGA_2_REFERENCE: readonly ReferenceSection[] = [
  {
    title: 'Values',
    entries: [
      entry('e0, e1, e2, e01, e02, e12, e012', 'canonical PGA(2) basis blades',
        { source: 'e012', inspection: 'e012' }, { source: 'e20', inspection: '-e02' }),
      entry('e0 * e0', 'e0 is the degenerate direction', { source: 'e0 * e0', inspection: '0' }),
      pseudoscalarEntry('e012'),
      entry('point(x, y)', 'Euclidean point at (x, y)', { source: 'point(1, 2)', inspection: '2e01 - e02 + e12' }),
      entry('point(x, y, w)', 'weighted point at (x / w, y / w)',
        { source: 'point(2, 4, 2)', inspection: '4e01 - 2e02 + 2e12' }),
      entry('ipoint(x, y)', 'ideal point in direction (x, y)', { source: 'ipoint(1, 1)', inspection: 'e01 - e02' }),
      entry('line(a, b, c)', 'the line a x + b y + c = 0', { source: 'line(1, 0, -1)', inspection: '-e0 + e1' }),
    ],
  },
  {
    title: 'Properties',
    entries: [
      entry('A.g0, A.g1, A.g2, A.g3', 'project onto one grade', 'A = 1 + e1 + e12 + e012', { source: 'A.g3', inspection: 'e012' }),
      entry('A.norm', 'Euclidean norm', { source: 'point(2, 4, 2).norm', inspection: '2' }, { source: 'line(3, 4, 1).norm', inspection: '5' }),
      entry('A.inorm', 'ideal norm', { source: 'ipoint(3, 4).inorm', inspection: '5' }, { source: 'line(0, 0, 2).inorm', inspection: '2' }),
      entry('A.e, A.e0, A.e1, A.e2, A.e01, A.e02, A.e12, A.e012', 'extract one coefficient as a scalar',
        'A = 1 + 2e0 + 3e01 + 4e012', { source: 'A.e01', inspection: '3' }),
      entry('I.position', 'position of a named ideal point, a Euclidean point',
        { source: 'I = ipoint(1, 0)', positionSource: 'point(1, 2)', inspection: '-e02' },
        { source: 'I.position', inspection: '2e01 - e02 + e12' }),
      entry('I.head', 'ideal-point derived value I.position + I',
        { source: 'I = ipoint(1, 0)', positionSource: 'point(1, 2)', inspection: '-e02' },
        { source: 'I.head', inspection: '2e01 - 2e02 + e12' }),
    ],
  },
  {
    title: 'Functions',
    entries: [
      entry('log(M), sqrt(M)', 'principal logarithm and square root of a unit motor',
        'M = exp(-0.5 * e12)', { source: 'log(M)', inspection: '-0.5e12' }),
    ],
  },
  {
    title: 'Positioning',
    entries: [
      entry('position point(x, y)', 'optional field under an ideal-point row',
        { source: 'I = ipoint(1, 0)', positionSource: 'point(1, 2)', inspection: '-e02' },
        { source: 'J = ipoint(0, 1)', inspection: 'e01' }),
      entry('position P, position I.head', 'the position may reference a named point or the position or head of an ideal point',
        'P = point(1, 2)', { source: 'I = ipoint(1, 0)', positionSource: 'P', inspection: '-e02' }),
      entry('invalid position', 'keeps the object value valid',
        { source: 'I = ipoint(1, 0)', positionSource: 'missing', positionInvalid: true }),
    ],
  },
]
