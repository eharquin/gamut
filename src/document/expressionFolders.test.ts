import { describe, expect, it } from 'vitest'
import { executeDocumentCommand, type DocumentCommand } from './documentCommands'
import { createDocumentHistory, documentHistoryReducer } from './documentHistory'
import { expressionDocument, type ExpressionDocument, type ExpressionItem } from './expressionDocument'
import {
  expressionRows,
  itemPosition,
  planItemMove,
  stepPlacement,
  type ItemPlacement,
  type MoveStep,
} from './expressionFolders'
import {
  parseCanonicalDocument,
  serializeCanonicalDocument,
  toCanonicalDocument,
  fromCanonicalDocument,
} from './canonicalDocument'
import { decodeSceneFragment, encodeSceneFragment } from './sceneLink'
import { evaluateDocument } from '../application/evaluateDocument'
import { createVga2Engine } from '../algebra/vgaEngine'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'

const context = { engine: createVga2Engine(), interpretation: VGA_2D_INTERPRETATION }
const evaluations = (document: ExpressionDocument) => Object.fromEntries(
  evaluateDocument(document, context).map((entry) => [entry.item.id, entry.evaluation?.status === 'valid'
    ? `valid ${entry.evaluation.inspection}` : entry.evaluation?.status ?? 'none']))

function apply(document: ExpressionDocument, ...commands: DocumentCommand[]): ExpressionDocument {
  return commands.reduce((current, command) => {
    const result = executeDocumentCommand(current, command)
    if (result.status !== 'applied') throw new Error(result.reason)
    return result.document
  }, document)
}

/** A, then folder F holding b and folder F/G holding c, then d at the top level. */
function sample(): ExpressionDocument {
  const items: ExpressionItem[] = [
    { id: 'a', source: 'a = 1' },
    { id: 'b', source: 'b = 2', folder: ['F'] },
    { id: 'c', source: 'c = 3', folder: ['F', 'G'] },
    { id: 'd', source: 'd = a + b + c' },
  ]
  return {
    ...expressionDocument(items),
    folders: [{ path: ['F'], collapsed: false }, { path: ['F', 'G'], collapsed: false }],
  }
}

function layout(document: ExpressionDocument): string[] {
  return expressionRows(document).map((row) =>
    row.kind === 'folder'
      ? `${'  '.repeat(row.depth)}[${row.name}]${row.expanded ? '' : '+'}`
      : `${'  '.repeat(row.depth)}${row.entry.id}`)
}

function move(document: ExpressionDocument, itemId: string, placement: ItemPlacement): ExpressionDocument {
  const planned = planItemMove(document, itemId, placement)
  if (!planned) return document
  return apply(document, { kind: 'move-item', ...planned })
}

function step(document: ExpressionDocument, itemId: string, direction: MoveStep): ExpressionDocument {
  const placement = stepPlacement(document, itemId, direction)
  return placement ? move(document, itemId, placement) : document
}

/** Every folder's items are contiguous in the item order, so the panel shows rows in item order. */
function expectItemOrderMatchesRows(document: ExpressionDocument) {
  const shown = expressionRows(document).flatMap((row) => row.kind === 'entry' ? [row.entry.id] : [])
  expect(shown).toEqual(document.items.map(({ id }) => id))
}

describe('expression folder tree', () => {
  it('shows folders at their first item and empty folders last in their parent', () => {
    const document = apply(sample(), { kind: 'create-folder', path: ['Empty'] })
    expect(layout(document)).toEqual(['a', '[F]', '  b', '  [G]', '    c', 'd', '[Empty]'])
  })

  it('hides the rows of a collapsed folder only', () => {
    const document = { ...sample(), folders: [{ path: ['F'], collapsed: true }, { path: ['F', 'G'], collapsed: false }] }
    expect(layout(document)).toEqual(['a', '[F]+', 'd'])
  })

  it('opens an earlier flat document with every item at the top level, in order', () => {
    const flat = expressionDocument([{ id: 'x', source: 'x = 1' }, { id: 'y', source: 'y = x' }])
    expect(layout(flat)).toEqual(['x', 'y'])
  })
})

describe('folder commands', () => {
  it('refuses empty, duplicate sibling, and too deep names', () => {
    const document = sample()
    expect(executeDocumentCommand(document, { kind: 'create-folder', path: [''] }).status).toBe('invalid')
    expect(executeDocumentCommand(document, { kind: 'create-folder', path: ['F'] }).status).toBe('invalid')
    expect(executeDocumentCommand(document, { kind: 'create-folder', path: ['F', 'G'] }).status).toBe('invalid')
    expect(executeDocumentCommand(document, { kind: 'create-folder', path: ['Missing', 'X'] }).status).toBe('invalid')
    expect(executeDocumentCommand(document, { kind: 'create-folder', path: ['G'] }).status).toBe('applied')
    expect(executeDocumentCommand(document, { kind: 'create-folder', path: ['a/b'] }).status).toBe('applied')
    expect(executeDocumentCommand(document, { kind: 'rename-folder', path: ['F', 'G'], name: '' }).status).toBe('invalid')
    const deep = Array.from({ length: 9 }, (_, index) => `L${index}`)
    let nested = expressionDocument([])
    for (let depth = 1; depth <= 8; depth += 1) nested = apply(nested, { kind: 'create-folder', path: deep.slice(0, depth) })
    expect(executeDocumentCommand(nested, { kind: 'create-folder', path: deep }).status).toBe('invalid')
    expect(executeDocumentCommand(nested, { kind: 'create-folder', path: ['x'.repeat(129)] }).status).toBe('invalid')
  })

  it('refuses a folder over the per-document limit', () => {
    let document = expressionDocument([])
    for (let index = 0; index < 256; index += 1) document = apply(document, { kind: 'create-folder', path: [`F${index}`] })
    expect(executeDocumentCommand(document, { kind: 'create-folder', path: ['one more'] }).status).toBe('invalid')
  })

  it('renames a folder with its items, subfolders, and collapsed state', () => {
    const document = apply(
      { ...sample(), folders: [{ path: ['F'], collapsed: false }, { path: ['F', 'G'], collapsed: true }] },
      { kind: 'rename-folder', path: ['F'], name: 'Triangle' },
    )
    expect(document.items.map((item) => item.folder)).toEqual([undefined, ['Triangle'], ['Triangle', 'G'], undefined])
    expect(document.folders).toEqual([{ path: ['Triangle'], collapsed: false }, { path: ['Triangle', 'G'], collapsed: true }])
    expect(document.items.map(({ source }) => source)).toEqual(sample().items.map(({ source }) => source))
  })

  it('removes a folder and keeps its items at its position in the parent', () => {
    const document = apply(sample(), { kind: 'delete-folder', path: ['F'] })
    expect(layout(document)).toEqual(['a', 'b', '[G]', '  c', 'd'])
    expect(document.items.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('refuses to remove a folder whose subfolder name exists in the parent', () => {
    const document = apply(sample(), { kind: 'create-folder', path: ['G'] })
    const result = executeDocumentCommand(document, { kind: 'delete-folder', path: ['F'] })
    expect(result.status).toBe('invalid')
    expect(result.document).toBe(document)
  })

  it('inserts a new row into the folder of the row it is inserted next to', () => {
    const document = apply(sample(), { kind: 'insert-item', item: { id: 'e', source: '' }, anchorId: 'c', placement: 'after' })
    expect(document.items.find(({ id }) => id === 'e')?.folder).toEqual(['F', 'G'])
  })

  it('clears folders with the items', () => {
    expect(apply(sample(), { kind: 'clear-items' }).folders).toEqual([])
  })
})

describe('moving rows', () => {
  it('moves a row into, within, and out of folders and keeps item order contiguous', () => {
    let document = move(sample(), 'a', { kind: 'end', folder: ['F', 'G'] })
    expect(layout(document)).toEqual(['[F]', '  b', '  [G]', '    c', '    a', 'd'])
    document = move(document, 'a', { kind: 'before', itemId: 'c' })
    expect(layout(document)).toEqual(['[F]', '  b', '  [G]', '    a', '    c', 'd'])
    document = move(document, 'a', { kind: 'after-folder', path: ['F'] })
    expect(layout(document)).toEqual(['[F]', '  b', '  [G]', '    c', 'a', 'd'])
    document = move(document, 'd', { kind: 'start', folder: ['F'] })
    expect(layout(document)).toEqual(['[F]', '  d', '  b', '  [G]', '    c', 'a'])
    expectItemOrderMatchesRows(document)
  })

  it('moves a row into an empty folder', () => {
    const document = move(apply(sample(), { kind: 'create-folder', path: ['Empty'] }), 'a', { kind: 'end', folder: ['Empty'] })
    expect(layout(document)).toEqual(['[F]', '  b', '  [G]', '    c', 'd', '[Empty]', '  a'])
    expectItemOrderMatchesRows(document)
  })

  it('preserves identities, sources, and evaluation', () => {
    const before = sample()
    const after = move(before, 'd', { kind: 'start', folder: ['F', 'G'] })
    expect([...after.items].sort((l, r) => l.id.localeCompare(r.id)).map(({ id, source }) => [id, source]))
      .toEqual(before.items.map(({ id, source }) => [id, source]))
    expect(evaluations(after)).toEqual(evaluations(before))
  })

  it('keeps a reference to a later row valid after a move, without rewriting source', () => {
    // Moving d (which uses a, b, c) to the top makes its references point
    // forward; forward references resolve (language §3), so nothing changes.
    const before = sample()
    const after = move(before, 'd', { kind: 'start', folder: [] })
    expect(after.items[0]).toEqual(before.items[3])
    expect(evaluations(after).d).toMatch(/^valid/)
    expect(evaluations(after)).toEqual(evaluations(before))
  })

  it('returns no move when the row would not change', () => {
    expect(planItemMove(sample(), 'a', { kind: 'start', folder: [] })).toBeNull()
    expect(planItemMove(sample(), 'c', { kind: 'end', folder: ['F', 'G'] })).toBeNull()
  })

  it('moves a row step by step through folders by keyboard', () => {
    let document = sample()
    const seen = [layout(document)]
    for (let index = 0; index < 6; index += 1) {
      document = step(document, 'd', 'up')
      seen.push(layout(document))
      expectItemOrderMatchesRows(document)
    }
    expect(seen).toEqual([
      ['a', '[F]', '  b', '  [G]', '    c', 'd'],
      ['a', '[F]', '  b', '  [G]', '    c', '    d'],
      ['a', '[F]', '  b', '  [G]', '    d', '    c'],
      ['a', '[F]', '  b', '  d', '  [G]', '    c'],
      ['a', '[F]', '  d', '  b', '  [G]', '    c'],
      ['a', 'd', '[F]', '  b', '  [G]', '    c'],
      ['d', 'a', '[F]', '  b', '  [G]', '    c'],
    ])
    expect(stepPlacement(document, 'd', 'up')).toBeNull()
    // Down enters each expanded folder at its start, so it takes one more
    // step than up, which enters the deepest last row directly.
    for (let index = 0; index < 7; index += 1) document = step(document, 'd', 'down')
    expect(layout(document)).toEqual(['a', '[F]', '  b', '  [G]', '    c', 'd'])
    expect(stepPlacement(document, 'd', 'down')).toBeNull()
  })

  it('keeps the only row of a folder in place when it leaves the folder by keyboard', () => {
    const items: ExpressionItem[] = [
      { id: 'b', source: 'b = 1' },
      { id: 'a', source: 'a = 2', folder: ['E'] },
      { id: 'c', source: 'c = 3' },
    ]
    const document = { ...expressionDocument(items), folders: [{ path: ['E'], collapsed: false }] }
    expect(layout(document)).toEqual(['b', '[E]', '  a', 'c'])
    // The emptied folder goes last; the row stays between its neighbours.
    for (const direction of ['up', 'down'] as const) {
      const moved = step(document, 'a', direction)
      expect(layout(moved)).toEqual(['b', 'a', 'c', '[E]'])
      expectItemOrderMatchesRows(moved)
    }
    // A row dropped before a folder that was already empty joins the end of its parent.
    const emptied = step(document, 'a', 'up')
    expect(layout(move(emptied, 'b', { kind: 'before-folder', path: ['E'] }))).toEqual(['a', 'c', 'b', '[E]'])
  })

  it('skips over a collapsed folder by keyboard', () => {
    const collapsed = { ...sample(), folders: [{ path: ['F'], collapsed: true }, { path: ['F', 'G'], collapsed: false }] }
    expect(layout(step(collapsed, 'd', 'up'))).toEqual(['a', 'd', '[F]+'])
    expect(layout(step(collapsed, 'a', 'down'))).toEqual(['[F]+', 'a', 'd'])
  })

  it('moves to the first and last row of the folder', () => {
    const document = step(sample(), 'd', 'first')
    expect(layout(document)).toEqual(['d', 'a', '[F]', '  b', '  [G]', '    c'])
    expect(layout(step(document, 'd', 'last'))).toEqual(['a', '[F]', '  b', '  [G]', '    c', 'd'])
  })

  it('reports the position of a row in its folder', () => {
    expect(itemPosition(sample(), 'b')).toEqual({ folder: ['F'], position: 1, count: 2 })
    expect(itemPosition(sample(), 'd')).toEqual({ folder: [], position: 3, count: 3 })
  })
})

describe('folder history', () => {
  it('undoes and redoes folder commands', () => {
    let history = createDocumentHistory(sample())
    history = documentHistoryReducer(history, { type: 'execute', command: { kind: 'create-folder', path: ['H'] } })
    history = documentHistoryReducer(history, { type: 'execute', command: { kind: 'move-item', itemId: 'a', folder: ['H'] } })
    expect(layout(history.present)).toEqual(['[F]', '  b', '  [G]', '    c', 'd', '[H]', '  a'])
    history = documentHistoryReducer(history, { type: 'undo' })
    expect(layout(history.present)).toEqual(['a', '[F]', '  b', '  [G]', '    c', 'd', '[H]'])
    history = documentHistoryReducer(history, { type: 'undo' })
    expect(history.present).toEqual(sample())
    history = documentHistoryReducer(history, { type: 'redo' })
    history = documentHistoryReducer(history, { type: 'redo' })
    expect(layout(history.present)).toEqual(['[F]', '  b', '  [G]', '    c', 'd', '[H]', '  a'])
  })

  it('collapses a folder without a history entry, in every snapshot that has it', () => {
    let history = createDocumentHistory(sample())
    history = documentHistoryReducer(history, { type: 'execute', command: { kind: 'update-source', itemId: 'a', source: 'a = 5' } })
    history = documentHistoryReducer(history, { type: 'set-folder-collapsed', path: ['F'], collapsed: true })
    expect(history.past).toHaveLength(1)
    expect(layout(history.present)).toEqual(['a', '[F]+', 'd'])
    history = documentHistoryReducer(history, { type: 'undo' })
    expect(history.present.items[0].source).toBe('a = 1')
    expect(layout(history.present)).toEqual(['a', '[F]+', 'd'])
  })

  it('counts a collapsed folder as an unsaved change', () => {
    const saved = serializeCanonicalDocument(toCanonicalDocument(sample(), 'system'))
    const collapsed = documentHistoryReducer(createDocumentHistory(sample()), { type: 'set-folder-collapsed', path: ['F'], collapsed: true }).present
    expect(serializeCanonicalDocument(toCanonicalDocument(collapsed, 'system'))).not.toBe(saved)
  })
})

describe('canonical folders', () => {
  it('round-trips folders, item folders, and collapsed state byte for byte', () => {
    const document = { ...sample(), folders: [{ path: ['F'], collapsed: true }, { path: ['F', 'G'], collapsed: false }] }
    const bytes = serializeCanonicalDocument(toCanonicalDocument(document, 'system'))
    const parsed = parseCanonicalDocument(bytes)
    expect(serializeCanonicalDocument(parsed)).toBe(bytes)
    const restored = fromCanonicalDocument(parsed).document
    expect(restored.folders).toEqual(document.folders)
    expect(restored.items.map(({ id, folder }) => [id, folder])).toEqual([['a', undefined], ['b', ['F']], ['c', ['F', 'G']], ['d', undefined]])
    expect(bytes).toContain('"folders":[{"collapsed":true,"path":["F"]}')
    expect(bytes).not.toContain('"folder":[]')
  })

  it('carries folders and their collapsed state in a scene link', async () => {
    const document = { ...sample(), folders: [{ path: ['F'], collapsed: true }, { path: ['F', 'G'], collapsed: false }] }
    const canonical = toCanonicalDocument(document, 'system')
    const decoded = await decodeSceneFragment(await encodeSceneFragment(canonical))
    expect(serializeCanonicalDocument(decoded)).toBe(serializeCanonicalDocument(canonical))
  })

  it('reads an empty item folder list as the top level', () => {
    const canonical = JSON.parse(serializeCanonicalDocument(toCanonicalDocument(sample(), 'system'))) as Record<string, unknown>
    const items = canonical.items as Record<string, unknown>[]
    items[0] = { ...items[0], folder: [] }
    expect(parseCanonicalDocument(JSON.stringify(canonical)).items[0].folder).toBeUndefined()
  })

  it('rejects undeclared, duplicate, orphan, empty, and over-limit folders', () => {
    const base = JSON.parse(serializeCanonicalDocument(toCanonicalDocument(sample(), 'system'))) as Record<string, unknown>
    const reject = (change: (document: Record<string, unknown>) => void, code: string) => {
      const copy = structuredClone(base)
      change(copy)
      expect(() => parseCanonicalDocument(JSON.stringify(copy))).toThrow(expect.objectContaining({ code }))
    }
    reject((document) => { (document.items as Record<string, unknown>[])[0].folder = ['Nowhere'] }, 'DOCUMENT_ORPHAN_FOLDER')
    reject((document) => { document.folders = [{ path: ['F'], collapsed: false }, { path: ['F'], collapsed: true }, { path: ['F', 'G'], collapsed: false }] }, 'DOCUMENT_DUPLICATE_FOLDER')
    reject((document) => { document.folders = [{ path: ['F', 'G'], collapsed: false }] }, 'DOCUMENT_ORPHAN_FOLDER')
    reject((document) => { document.folders = [{ path: [''], collapsed: false }] }, 'DOCUMENT_FOLDER_NAME')
    reject((document) => { document.folders = [{ path: [], collapsed: false }] }, 'DOCUMENT_FOLDER_NAME')
    reject((document) => { document.folders = [{ path: ['F'], collapsed: false, color: 'red' }] }, 'DOCUMENT_UNKNOWN_FIELD')
    reject((document) => { document.folders = [{ path: ['x'.repeat(129)], collapsed: false }] }, 'LIMIT_FOLDER_NAME_LENGTH')
    reject((document) => { document.folders = Array.from({ length: 9 }, (_, depth) => ({ path: Array.from({ length: depth + 1 }, () => 'L'), collapsed: false })) }, 'LIMIT_FOLDER_DEPTH')
    reject((document) => { document.folders = Array.from({ length: 257 }, (_, index) => ({ path: [`F${index}`], collapsed: false })) }, 'LIMIT_FOLDER_COUNT')
  })

  it('counts a name in code points', () => {
    const name = '𝑥'.repeat(128)
    expect(apply(expressionDocument([]), { kind: 'create-folder', path: [name] }).folders).toHaveLength(1)
  })

  it('migrates a version 7 document to version 8 without folders, in its order', () => {
    const current = JSON.parse(serializeCanonicalDocument(toCanonicalDocument(
      expressionDocument([{ id: 'x', source: 'x = 1' }, { id: 'y', source: 'y = x' }]), 'system'))) as Record<string, unknown>
    const { folders: _folders, ...version8 } = current
    const view = version8.view as Record<string, Record<string, unknown>>
    const { valuesVisible: _values, ...display } = view.display
    const version7 = { ...version8, formatVersion: 7, view: { ...view, display } }
    const migrated = parseCanonicalDocument(JSON.stringify(version7))
    expect(migrated.folders).toEqual([])
    expect(migrated.items.map(({ id }) => id)).toEqual(['x', 'y'])
    expect(migrated.items.every((item) => item.folder === undefined)).toBe(true)
  })

  it('reads a version 8 document written before folders as having none', () => {
    const { folders: _folders, ...earlier } = JSON.parse(serializeCanonicalDocument(toCanonicalDocument(sample(), 'system'))) as Record<string, unknown>
    const items = (earlier.items as Record<string, unknown>[]).map(({ folder: _folder, ...item }) => item)
    expect(parseCanonicalDocument(JSON.stringify({ ...earlier, items })).folders).toEqual([])
  })
})
