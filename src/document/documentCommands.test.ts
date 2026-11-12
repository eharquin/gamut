import { describe, expect, it } from 'vitest'
import { executeDocumentCommand, sourceKind } from './documentCommands'
import { expressionDocument } from './expressionDocument'

describe('semantic document commands', () => {
  it('turns positions on when a position is written into a document that has them off', () => {
    const base = expressionDocument([{ id: 'v', source: 'V = vector(2, 1)' }])
    const off = { ...base, view: { ...base.view, positionEnabled: false } }
    const written = executeDocumentCommand(off, { kind: 'update-position', itemId: 'v', positionSource: '(1, 1)' })
    expect(written.document.view.positionEnabled).toBe(true)
    expect(written.document.items[0].positionSource).toBe('(1, 1)')
    // Clearing a position does not turn them on.
    const cleared = executeDocumentCommand(off, { kind: 'update-position', itemId: 'v', positionSource: '' })
    expect(cleared.document.view.positionEnabled).toBe(false)
  })

  it('targets stable identities independently of row position', () => {
    const document = expressionDocument([
      { id: 'first', source: 'A = 1' },
      { id: 'target', source: 'B = 2', positionSource: '(1, 2)' },
    ])
    const result = executeDocumentCommand(document, {
      kind: 'update-source', itemId: 'target', source: 'B = 3',
    })
    expect(result.status).toBe('applied')
    expect(result.document.items).toEqual([
      { id: 'first', source: 'A = 1' },
      { id: 'target', source: 'B = 3', positionSource: '(1, 2)' },
    ])
  })

  it('moves an item before or after an anchor, preserving other items', () => {
    const document = expressionDocument([
      { id: 'a', source: 'A = 1' },
      { id: 'b', source: 'B = 2' },
      { id: 'c', source: 'C = 3' },
    ])
    const beforeA = executeDocumentCommand(document, {
      kind: 'move-item', itemId: 'c', anchorId: 'a', placement: 'before',
    })
    expect(beforeA.document.items.map(({ id }) => id)).toEqual(['c', 'a', 'b'])

    const afterA = executeDocumentCommand(document, {
      kind: 'move-item', itemId: 'c', anchorId: 'a', placement: 'after',
    })
    expect(afterA.document.items.map(({ id }) => id)).toEqual(['a', 'c', 'b'])
  })

  it('moves an item to the end when no anchor is given', () => {
    const document = expressionDocument([
      { id: 'a', source: 'A = 1' },
      { id: 'b', source: 'B = 2' },
    ])
    const result = executeDocumentCommand(document, { kind: 'move-item', itemId: 'a' })
    expect(result.document.items.map(({ id }) => id)).toEqual(['b', 'a'])
  })

  it('moves an item to the start using the first item as a before-anchor', () => {
    const document = expressionDocument([
      { id: 'a', source: 'A = 1' },
      { id: 'b', source: 'B = 2' },
      { id: 'c', source: 'C = 3' },
    ])
    const result = executeDocumentCommand(document, {
      kind: 'move-item', itemId: 'c', anchorId: 'a', placement: 'before',
    })
    expect(result.document.items.map(({ id }) => id)).toEqual(['c', 'a', 'b'])
  })

  it('rejects moving an item relative to itself or a missing item', () => {
    const document = expressionDocument([
      { id: 'a', source: 'A = 1' },
      { id: 'b', source: 'B = 2' },
    ])
    expect(executeDocumentCommand(document, {
      kind: 'move-item', itemId: 'a', anchorId: 'a',
    })).toEqual({
      status: 'invalid', document,
      reason: 'An item cannot move relative to itself.',
    })
    expect(executeDocumentCommand(document, {
      kind: 'move-item', itemId: 'a', anchorId: 'missing',
    })).toEqual({
      status: 'invalid', document,
      reason: 'Item “missing” does not exist.',
    })
    expect(executeDocumentCommand(document, {
      kind: 'move-item', itemId: 'missing',
    })).toEqual({
      status: 'invalid', document,
      reason: 'Item “missing” does not exist.',
    })
  })

  it('preserves appearance, control, and other item fields across a move', () => {
    const document = expressionDocument([
      { id: 'a', source: 'A = 1', control: { mode: 'number', minimumSource: '0', maximumSource: '1', stepSource: '0.1', animation: null } },
      { id: 'b', source: 'B = 2' },
    ], { a: { visible: false } })
    const result = executeDocumentCommand(document, {
      kind: 'move-item', itemId: 'a', anchorId: 'b', placement: 'after',
    })
    expect(result.document.items.find(({ id }) => id === 'a')).toEqual(document.items[0])
    expect(result.document.appearance).toEqual(document.appearance)
  })

  it('returns explicit invalid and unsupported results without mutation', () => {
    const document = expressionDocument([
      { id: 'note', kind: 'annotation', source: 'prose' },
    ])
    expect(executeDocumentCommand(document, {
      kind: 'update-source', itemId: 'missing', source: 'A = 1',
    })).toEqual(expect.objectContaining({ status: 'invalid', document }))
    expect(executeDocumentCommand(document, {
      kind: 'update-position', itemId: 'note', positionSource: '(1, 2)',
    })).toEqual({
      status: 'unsupported', document,
      reason: 'Annotations do not own position source.',
    })
  })

  it('derives the item kind from the source on every source edit (#187)', () => {
    const control = { mode: 'slider', minimumSource: '0', maximumSource: '1', stepSource: '0.1', animation: null } as const
    const document = expressionDocument([
      { id: 'a', source: 'A = e1', positionSource: '(1, 2)', normalization: 'natural', control },
    ], { a: { visible: false } })
    const commented = executeDocumentCommand(document, { kind: 'update-source', itemId: 'a', source: '  # A = e1' })
    // The format forbids position, normalization, and control on an annotation.
    expect(commented.document.items).toEqual([{ id: 'a', kind: 'annotation', source: '  # A = e1' }])
    expect(commented.document.appearance).toEqual(document.appearance)

    const restored = executeDocumentCommand(commented.document, { kind: 'update-source', itemId: 'a', source: ' A = e1' })
    expect(restored.document.items).toEqual([{ id: 'a', source: ' A = e1' }])

    // A stored annotation without # (valid for the format) becomes an
    // expression on its next source edit, unless the edit adds a #.
    const legacy = expressionDocument([{ id: 'note', kind: 'annotation', source: 'prose' }])
    expect(executeDocumentCommand(legacy, { kind: 'update-source', itemId: 'note', source: 'prose!' })
      .document.items).toEqual([{ id: 'note', source: 'prose!' }])
    expect(executeDocumentCommand(legacy, { kind: 'update-source', itemId: 'note', source: '# prose' })
      .document.items).toEqual([{ id: 'note', kind: 'annotation', source: '# prose' }])
    expect(sourceKind('a # b')).toBe('expression')
    expect(sourceKind('\t#')).toBe('annotation')
  })

  it('rewrites the smallest eligible literal and refuses compound inverse edits', () => {
    const document = expressionDocument([
      { id: 'vector', source: 'V = vector(-2, s + 1)' },
    ])
    const applied = executeDocumentCommand(document, {
      kind: 'rewrite-source-literal', itemId: 'vector', property: 'source',
      span: { start: 11, end: 13 }, replacement: '-3.5',
    })
    expect(applied.document.items[0].source).toBe('V = vector(-3.5, s + 1)')

    const refused = executeDocumentCommand(document, {
      kind: 'rewrite-source-literal', itemId: 'vector', property: 'source',
      span: { start: 15, end: 20 }, replacement: '4',
    })
    expect(refused).toEqual(expect.objectContaining({
      status: 'unsupported', document,
      reason: 'Only a direct numeric or unary-signed numeric literal can be rewritten.',
    }))
  })

  it('sets a direct scalar through a language-owned semantic command', () => {
    const document = expressionDocument([
      { id: 'scalar', source: 'a = ((-2))' },
      { id: 'computed', source: 'b = a + 1' },
    ])
    expect(executeDocumentCommand(document, {
      kind: 'set-scalar-value', itemId: 'scalar', value: 3.5,
    }).document.items[0].source).toBe('a = ((3.5))')
    expect(executeDocumentCommand(document, {
      kind: 'set-scalar-value', itemId: 'computed', value: 4,
    })).toEqual(expect.objectContaining({ status: 'unsupported', document }))
  })

  it('clears item-keyed appearance atomically and keeps document identity', () => {
    const document = expressionDocument(
      [{ id: 'value', source: 'A = 1' }],
      { value: { style: 'green-4' } },
      { id: 'stable-document' },
    )
    const result = executeDocumentCommand(document, { kind: 'clear-items' })
    expect(result.document).toEqual(expect.objectContaining({
      id: 'stable-document', items: [], appearance: {},
    }))
  })

  it('selects an algebra with its interpretation and visualizer only on an empty document', () => {
    const selection = {
      kind: 'select-algebra' as const,
      algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } },
      interpretation: { interpretationId: 'org.multivector.pga-2d', interpretationVersion: 1 },
      visualizerId: 'org.multivector.pga-2d',
      title: 'PGA 2D Triangle Example',
      description: 'A triangle.',
    }
    const empty = expressionDocument(
      [{ id: 'item-1', source: '' }, { id: 'item-2', source: '   ' }],
      {},
      { id: 'kept-identity', title: 'VGA 2D Rotation Example', description: 'A rotation.' },
    )
    const applied = executeDocumentCommand(empty, selection)
    expect(applied.status).toBe('applied')
    expect(applied.document.id).toBe('kept-identity')
    expect(applied.document.title).toBe('PGA 2D Triangle Example')
    expect(applied.document.description).toBe('A triangle.')
    expect(applied.document.algebra).toEqual(selection.algebra)
    expect(applied.document.interpretation).toEqual(selection.interpretation)
    expect(applied.document.view.visualizerId).toBe('org.multivector.pga-2d')
    expect(applied.document.items).toHaveLength(2)

    const withContent = expressionDocument([{ id: 'item-1', source: 'V = vector(1, 2)' }])
    const refused = executeDocumentCommand(withContent, selection)
    expect(refused.status).toBe('invalid')
    expect(refused.document).toBe(withContent)

    const withPosition = expressionDocument([{ id: 'item-1', source: '', positionSource: '(1, 2)' }])
    expect(executeDocumentCommand(withPosition, selection).status).toBe('invalid')
  })

  it('merges list primitive styles per block, keeping the settings it does not name', () => {
    const document = expressionDocument([{ id: 'p', source: 'P = [e1, e2]' }], {
      p: { style: 'teal-4', primitiveStyles: { points: { connection: 'closed-loop', pointStyle: 'ring' }, lines: { strokeStyle: 'dashed' } } },
    })
    const result = executeDocumentCommand(document, {
      kind: 'update-appearance', itemId: 'p', appearance: { primitiveStyles: { points: { visible: false } } },
    })
    expect(result.status).toBe('applied')
    expect(result.document.appearance.p).toEqual({
      style: 'teal-4',
      primitiveStyles: {
        points: { connection: 'closed-loop', pointStyle: 'ring', visible: false },
        lines: { strokeStyle: 'dashed' },
      },
    })
  })
})
