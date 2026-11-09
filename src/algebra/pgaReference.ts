import {
  FUNCTIONS,
  INVERSE,
  LISTS_AND_RANGES,
  NAME_REFERENCE,
  OPERATORS,
  PRECEDENCE,
  PSEUDOSCALAR,
  SCALAR_LITERALS,
  referenceEntry as entry,
  type ReferenceSection,
} from '../language/expressionReference'

/**
 * The expression reference of PGA(2) documents: shared sections plus the
 * constructors, blades, norms, motor functions, and ideal-point positions of
 * PGA convention version 1.
 */
export const PGA_2_REFERENCE: readonly ReferenceSection[] = [
  {
    title: 'Values and names',
    entries: [
      SCALAR_LITERALS,
      entry(
        'e0, e1, e2, e01, e02, e12, e012',
        'canonical PGA(2) basis blades; valid index permutations are also accepted with the sign induced by reordering, so e20 is -e02',
        { source: 'e0', inspection: 'e0' }, { source: 'e1', inspection: 'e1' }, { source: 'e2', inspection: 'e2' },
        { source: 'e01', inspection: 'e01' }, { source: 'e02', inspection: 'e02' }, { source: 'e12', inspection: 'e12' },
        { source: 'e012', inspection: 'e012' }, { source: 'e20', inspection: '-e02' },
      ),
      entry('e0 * e0', 'e0 is the degenerate direction: it squares to zero', { source: 'e0 * e0', inspection: '0' }),
      PSEUDOSCALAR,
      entry('point(x, y)', 'Euclidean point at (x, y), with weight 1', { source: 'point(1, 2)', inspection: '2e01 - e02 + e12' }),
      entry('point(x, y, w)', 'weighted point with homogeneous coordinates; it lies at (x / w, y / w)',
        { source: 'point(2, 4, 2)', inspection: '4e01 - 2e02 + 2e12' }),
      entry('ipoint(x, y)', 'ideal point in direction (x, y), the point at infinity point(x, y, 0)',
        { source: 'ipoint(1, 1)', inspection: 'e01 - e02' }),
      entry('line(a, b, c)', 'the line a x + b y + c = 0, stored as a e1 + b e2 + c e0',
        { source: 'line(1, 0, -1)', inspection: '-e0 + e1' }),
      NAME_REFERENCE,
    ],
  },
  LISTS_AND_RANGES,
  OPERATORS,
  {
    title: 'Properties',
    entries: [
      entry('A.g0, A.g1, A.g2, A.g3', 'project onto one grade', 'A = 1 + e1 + e12 + e012',
        { source: 'A.g0', inspection: '1' }, { source: 'A.g1', inspection: 'e1' },
        { source: 'A.g2', inspection: 'e12' }, { source: 'A.g3', inspection: 'e012' }),
      INVERSE,
      entry('A.norm', 'Euclidean norm; it ignores every coefficient on a blade containing e0, so it is the weight of a point',
        { source: 'point(2, 4, 2).norm', inspection: '2' }, { source: 'line(3, 4, 1).norm', inspection: '5' }),
      entry('A.inorm', 'ideal norm, the Euclidean norm of the dual: the length of an ideal point',
        { source: 'ipoint(3, 4).inorm', inspection: '5' }, { source: 'line(0, 0, 2).inorm', inspection: '2' }),
      entry('A.e, A.e0, A.e1, A.e2, A.e01, A.e02, A.e12, A.e012', 'extract one coefficient as a scalar',
        'A = 1 + 2e0 + 3e01 + 4e012',
        { source: 'A.e', inspection: '1' }, { source: 'A.e0', inspection: '2' }, { source: 'A.e1', inspection: '0' },
        { source: 'A.e2', inspection: '0' }, { source: 'A.e01', inspection: '3' }, { source: 'A.e02', inspection: '0' },
        { source: 'A.e12', inspection: '0' }, { source: 'A.e012', inspection: '4' }),
      entry('I.position', 'position of a named ideal point, a Euclidean point',
        { source: 'I = ipoint(1, 0)', positionSource: 'point(1, 2)' }, { source: 'I.position', inspection: '2e01 - e02 + e12' }),
      entry('I.head', 'ideal-point derived value I.position + I',
        { source: 'I = ipoint(1, 0)', positionSource: 'point(1, 2)' }, { source: 'I.head', inspection: '2e01 - 2e02 + e12' }),
    ],
  },
  {
    title: 'Functions',
    entries: [
      ...FUNCTIONS,
      entry('log(M), sqrt(M)',
        'principal logarithm and square root of a unit motor, an even value with M * ~M = 1; divide by M.norm first otherwise',
        'M = exp(-0.5 * e12)', { source: 'log(M)', inspection: '-0.5e12' },
        'sqrt(M)',
        { source: 'log(1 - 0.5e01)', inspection: '-0.5e01' }),
    ],
  },
  PRECEDENCE,
  {
    title: 'Positioning',
    entries: [
      entry(
        'position point(x, y)',
        'optional field under an ideal-point row, where the arrow starts; an empty field uses the origin',
        { source: 'I = ipoint(1, 0)', positionSource: 'point(1, 2)' },
        { source: 'J = ipoint(0, 1)' },
      ),
      entry(
        'position P, position I.head',
        'the position may reference a named point or the position or head of an ideal point; anchoring a base by dragging writes such a reference',
        'P = point(1, 2)', { source: 'I = ipoint(1, 0)', positionSource: 'P' },
        { source: 'J = ipoint(0, 1)', positionSource: 'I.head' }, { source: 'J.position', inspection: '2e01 - 2e02 + e12' },
      ),
      entry('invalid position', 'keeps the object value valid and reports a position diagnostic',
        { source: 'I = ipoint(1, 0)', positionSource: 'missing', positionInvalid: true }),
    ],
  },
]
