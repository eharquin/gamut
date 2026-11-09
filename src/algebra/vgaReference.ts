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

/** The expression reference of VGA(2) documents: shared sections plus VGA syntax. */
export const VGA_2_REFERENCE: readonly ReferenceSection[] = [
  {
    title: 'Values and names',
    entries: [
      SCALAR_LITERALS,
      entry(
        'e1, e2, e12',
        'canonical VGA(2) basis-blade notation; valid index permutations are also accepted with the sign induced by reordering',
        { source: 'e1', inspection: 'e1' }, { source: 'e2', inspection: 'e2' }, { source: 'e12', inspection: 'e12' },
        { source: 'e21', inspection: '-e12' },
      ),
      PSEUDOSCALAR,
      entry('V = (2, 1)', 'named vector declaration using concise tuple syntax', { source: 'V = (2, 1)', inspection: '2e1 + e2' }),
      entry('vector(2, 1)', 'explicit vector constructor', { source: 'vector(2, 1)', inspection: '2e1 + e2' }),
      NAME_REFERENCE,
    ],
  },
  LISTS_AND_RANGES,
  OPERATORS,
  {
    title: 'Properties',
    entries: [
      entry('A.g0, A.g1, A.g2', 'project onto one grade', 'A = 1 + e1 + e12',
        { source: 'A.g0', inspection: '1' }, { source: 'A.g1', inspection: 'e1' }, { source: 'A.g2', inspection: 'e12' }),
      INVERSE,
      entry('A.norm', 'primary VGA norm', { source: '(3e1 + 4e2).norm', inspection: '5' }),
      entry('A.e, A.e1, A.e2, A.e12', 'extract one coefficient as a scalar', 'A = 1 + 2e1 + 3e2 + 4e12',
        { source: 'A.e', inspection: '1' }, { source: 'A.e1', inspection: '2' },
        { source: 'A.e2', inspection: '3' }, { source: 'A.e12', inspection: '4' }),
      entry('V.position', 'position of a named vector',
        { source: 'V = vector(1, 0)', positionSource: '(1, 2)' }, { source: 'V.position', inspection: 'e1 + 2e2' }),
      entry('B.position', 'position of a named bivector',
        { source: 'B = e12', positionSource: '(1, 1)' }, { source: 'B.position', inspection: 'e1 + e2' }),
      entry('V.head', 'vector-only derived value V.position + V',
        { source: 'V = vector(1, 0)', positionSource: '(1, 2)' }, { source: 'V.head', inspection: '2e1 + 2e2' }),
    ],
  },
  { title: 'Functions', entries: FUNCTIONS },
  PRECEDENCE,
  {
    title: 'Positioning',
    entries: [
      entry(
        'position (0, 0)',
        'optional field under a vector or bivector row; an empty field uses the origin',
        { source: 'V = vector(1, 0)', positionSource: '(0, 0)' }, { source: 'B = e12' },
      ),
      entry(
        'position P.head',
        'the position may reference a named expression or its position or head; anchoring a base by dragging writes such a reference',
        'P = vector(1, 1)', { source: 'V = vector(1, 0)', positionSource: 'P.head' }, { source: 'V.position', inspection: 'e1 + e2' },
      ),
      entry('L.position, L.head', 'a list has no position field; each element keeps the position of the value it comes from',
        { source: 'V = vector(2, 1)' }, { source: 'W = vector(1, 0)', positionSource: 'V.head' }, 'L = [V, W]',
        { source: 'L.position', inspection: '[0, 2e1 + e2]' }, { source: 'L.head', inspection: '[2e1 + e2, 3e1 + e2]' }),
      entry('invalid position', 'keeps the object value valid and reports a position diagnostic',
        { source: 'V = vector(1, 0)', positionSource: 'missing', positionInvalid: true }),
    ],
  },
]
