import { describe, expect, it } from 'vitest'
import { executeDocumentCommand, type DocumentCommand } from './documentCommands'
import { createDocumentHistory, documentHistoryReducer } from './documentHistory'
import { expressionDocument, type ExpressionDocument, type ExpressionItem } from './expressionDocument'
import {
  drawnAppearances,
  expressionRows,
  folderPosition,
  folderStepPlacement,
  itemPosition,
  planFolderMove,
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
    // The emptied folder keeps its place: up, the row shows above it; down, below it.
    expect(layout(step(document, 'a', 'up'))).toEqual(['b', 'a', '[E]', 'c'])
    expect(layout(step(document, 'a', 'down'))).toEqual(['b', '[E]', 'a', 'c'])
    for (const direction of ['up', 'down'] as const) expectItemOrderMatchesRows(step(document, 'a', direction))
    // A row dropped before an empty folder shows just above it.
    const emptied = step(document, 'a', 'up')
    expect(layout(move(emptied, 'b', { kind: 'before-folder', path: ['E'] }))).toEqual(['a', 'b', '[E]', 'c'])
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

function moveFolder(document: ExpressionDocument, path: string[], placement: ItemPlacement): ExpressionDocument {
  const planned = planFolderMove(document, path, placement)
  if (!planned) return document
  return apply(document, { kind: 'move-folder', ...planned })
}

function stepFolder(document: ExpressionDocument, path: string[], direction: MoveStep): ExpressionDocument {
  const placement = folderStepPlacement(document, path, direction)
  return placement ? moveFolder(document, path, placement) : document
}

/** a, folder F with b, folder H with c, then d. */
function siblings(): ExpressionDocument {
  const items: ExpressionItem[] = [
    { id: 'a', source: 'a = 1' },
    { id: 'b', source: 'b = 2', folder: ['F'] },
    { id: 'c', source: 'c = 3', folder: ['H'] },
    { id: 'd', source: 'd = a + b + c' },
  ]
  return { ...expressionDocument(items), folders: [{ path: ['F'], collapsed: false }, { path: ['H'], collapsed: true }] }
}

describe('moving folders', () => {
  it('moves a folder with every row and subfolder it holds, and keeps values', () => {
    const before = evaluations(sample())
    const moved = moveFolder(sample(), ['F'], { kind: 'after', itemId: 'd' })
    expect(layout(moved)).toEqual(['a', 'd', '[F]', '  b', '  [G]', '    c'])
    expectItemOrderMatchesRows(moved)
    expect(evaluations(moved)).toEqual(before)
    expect(layout(moveFolder(moved, ['F'], { kind: 'start', folder: [] }))).toEqual(['[F]', '  b', '  [G]', '    c', 'a', 'd'])
  })

  it('nests a folder in another and takes it out again, with its collapsed state', () => {
    const nested = moveFolder(siblings(), ['H'], { kind: 'end', folder: ['F'] })
    expect(layout(nested)).toEqual(['a', '[F]', '  b', '  [H]+', 'd'])
    expect(nested.items.find(({ id }) => id === 'c')?.folder).toEqual(['F', 'H'])
    expectItemOrderMatchesRows({ ...nested, folders: nested.folders?.map((folder) => ({ ...folder, collapsed: false })) })
    const out = moveFolder(nested, ['F', 'H'], { kind: 'before-folder', path: ['F'] })
    expect(layout(out)).toEqual(['a', '[H]+', '[F]', '  b', 'd'])
    expect(folderPosition(out, ['H'])).toEqual({ parent: [], position: 2, count: 4 })
  })

  it('refuses a move into itself, onto a name already there, and past the depth limit', () => {
    const refusal = (document: ExpressionDocument, command: DocumentCommand) => {
      const result = executeDocumentCommand(document, command)
      return result.status === 'applied' ? 'applied' : result.reason
    }
    expect(refusal(sample(), { kind: 'move-folder', path: ['F'], parent: ['F', 'G'] })).toBe('A folder cannot move into itself.')
    const clash = apply(sample(), { kind: 'create-folder', path: ['G'] })
    expect(refusal(clash, { kind: 'move-folder', path: ['F', 'G'], parent: [] })).toBe('A folder named “G” already exists in the top level.')
    let deep = sample()
    const chain = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']
    chain.forEach((_, index) => { deep = apply(deep, { kind: 'create-folder', path: chain.slice(0, index + 1) }) })
    // F holds G: under seven folders its subfolder would be at level nine.
    expect(refusal(deep, { kind: 'move-folder', path: ['F'], parent: chain })).toBe('Folders may be nested at most 8 levels deep.')
    expect(refusal(deep, { kind: 'move-folder', path: ['F'], parent: chain.slice(0, 6) })).toBe('applied')
    expect(planFolderMove(sample(), ['F'], { kind: 'before', itemId: 'd' })).toBeNull()
    expect(planFolderMove(sample(), ['F'], { kind: 'before', itemId: 'b' })).toBeNull()
  })

  it('moves a folder step by step by keyboard', () => {
    let document = siblings()
    expect(layout(document)).toEqual(['a', '[F]', '  b', '[H]+', 'd'])
    // Down skips the collapsed folder, then passes the row, then cannot go further.
    document = stepFolder(document, ['F'], 'down')
    expect(layout(document)).toEqual(['a', '[H]+', '[F]', '  b', 'd'])
    document = stepFolder(document, ['F'], 'down')
    expect(layout(document)).toEqual(['a', '[H]+', 'd', '[F]', '  b'])
    expect(folderStepPlacement(document, ['F'], 'down')).toBeNull()
    document = stepFolder(document, ['F'], 'first')
    expect(layout(document)).toEqual(['[F]', '  b', 'a', '[H]+', 'd'])
    expect(folderStepPlacement(document, ['F'], 'up')).toBeNull()
    // An expanded folder next to it is passed too, never entered: folders stay at the same level.
    document = { ...document, folders: document.folders?.map((folder) => ({ ...folder, collapsed: false })) }
    expect(layout(document)).toEqual(['[F]', '  b', 'a', '[H]', '  c', 'd'])
    document = stepFolder(document, ['F'], 'down')
    expect(layout(document)).toEqual(['a', '[F]', '  b', '[H]', '  c', 'd'])
    document = stepFolder(document, ['F'], 'down')
    expect(layout(document)).toEqual(['a', '[H]', '  c', '[F]', '  b', 'd'])
    document = stepFolder(document, ['F'], 'up')
    expect(layout(document)).toEqual(['a', '[F]', '  b', '[H]', '  c', 'd'])
    expectItemOrderMatchesRows(document)
    // A folder without rows is passed like any other.
    const withEmpty = apply(document, { kind: 'create-folder', path: ['E'] })
    expect(layout(withEmpty)).toEqual(['a', '[F]', '  b', '[H]', '  c', 'd', '[E]'])
    expect(layout(stepFolder(stepFolder(withEmpty, ['F'], 'down'), ['F'], 'down'))).toEqual(['a', '[H]', '  c', 'd', '[F]', '  b', '[E]'])
    expect(layout(stepFolder(stepFolder(stepFolder(withEmpty, ['F'], 'down'), ['F'], 'down'), ['F'], 'down'))).toEqual(['a', '[H]', '  c', 'd', '[E]', '[F]', '  b'])
  })

  it('moves an empty folder between rows and folders, and keeps its place', () => {
    let document = apply(siblings(), { kind: 'create-folder', path: ['E'] })
    document = { ...document, folders: document.folders?.map((folder) => ({ ...folder, collapsed: false })) }
    expect(layout(document)).toEqual(['a', '[F]', '  b', '[H]', '  c', 'd', '[E]'])
    // Up through every row and folder, then no further.
    const seen: string[][] = []
    for (let move = 0; move < 6; move += 1) {
      const placement = folderStepPlacement(document, ['E'], 'up')
      if (!placement) break
      document = stepFolder(document, ['E'], 'up')
      seen.push(layout(document))
    }
    expect(seen).toEqual([
      ['a', '[F]', '  b', '[H]', '  c', '[E]', 'd'],
      ['a', '[F]', '  b', '[E]', '[H]', '  c', 'd'],
      ['a', '[E]', '[F]', '  b', '[H]', '  c', 'd'],
      ['[E]', 'a', '[F]', '  b', '[H]', '  c', 'd'],
    ])
    expect(folderStepPlacement(document, ['E'], 'up')).toBeNull()
    // Its place survives an edit elsewhere and the canonical format.
    document = apply(document, { kind: 'update-source', itemId: 'd', source: 'd = 4' })
    const bytes = serializeCanonicalDocument(toCanonicalDocument(document, 'light'))
    expect(layout(fromCanonicalDocument(parseCanonicalDocument(bytes)).document)).toEqual(['[E]', 'a', '[F]', '  b', '[H]', '  c', 'd'])
    // Deleting the item it shows before keeps it before the item that followed.
    expect(layout(apply(document, { kind: 'delete-item', itemId: 'a' }))).toEqual(['[E]', '[F]', '  b', '[H]', '  c', 'd'])
    expect(apply(document, { kind: 'delete-item', itemId: 'a' }).folders?.find(({ path }) => path[0] === 'E')?.before).toBe('b')
  })

  it('keeps the place of a folder emptied by a deletion', () => {
    const document = apply(siblings(), { kind: 'delete-item', itemId: 'b' })
    expect(layout(document)).toEqual(['a', '[F]', '[H]+', 'd'])
  })

})

describe('folder appearance', () => {
  const styled = (): ExpressionDocument => ({
    ...sample(),
    appearance: { a: { style: 'green-4' }, b: { style: 'red-4', strokeWidthSource: '3', label: 'B', labelVisible: true }, c: { style: 'orange-4' } },
  })

  it('overwrites the appearance of every row of the folder only while asked, keeping labels and the stored rows', () => {
    const document = apply(styled(), { kind: 'update-folder-appearance', path: ['F'], appearance: { style: 'purple-3', strokeStyle: 'dashed' } })
    // Not overwriting: the rows are drawn as they are stored.
    expect(drawnAppearances(document)).toBe(document.appearance)
    const overwriting = apply(document, { kind: 'update-folder-appearance', path: ['F'], overwriteAppearance: true })
    const drawn = drawnAppearances(overwriting)
    // b and c, in F and F › G, take the folder's settings; a, outside, keeps its own.
    expect(drawn.a).toEqual({ style: 'green-4' })
    expect(drawn.b).toMatchObject({ style: 'purple-3', strokeStyle: 'dashed', label: 'B', labelVisible: true })
    // A setting the folder leaves unset is the default for its rows.
    expect(drawn.b.strokeWidthSource).toBeUndefined()
    expect(drawn.c).toMatchObject({ style: 'purple-3', strokeStyle: 'dashed' })
    // The stored rows are unchanged, so turning it off gives them back.
    expect(overwriting.appearance).toEqual(styled().appearance)
    const off = apply(overwriting, { kind: 'update-folder-appearance', path: ['F'], overwriteAppearance: false })
    expect(drawnAppearances(off)).toBe(off.appearance)
  })

  it('lets the nearest overwriting folder win', () => {
    let document = apply(styled(), { kind: 'update-folder-appearance', path: ['F'], appearance: { style: 'purple-3' }, overwriteAppearance: true })
    document = apply(document, { kind: 'update-folder-appearance', path: ['F', 'G'], appearance: { style: 'teal-3' }, overwriteAppearance: true })
    expect(drawnAppearances(document).b.style).toBe('purple-3')
    expect(drawnAppearances(document).c.style).toBe('teal-3')
  })

  it('hides every row of a hidden folder, whether it overwrites or not, without changing their own visibility', () => {
    const document = apply(styled(), { kind: 'update-folder-appearance', path: ['F'], appearance: { visible: false } })
    const drawn = drawnAppearances(document)
    expect([drawn.a.visible, drawn.b.visible, drawn.c.visible]).toEqual([undefined, false, false])
    expect(document.appearance.b.visible).toBeUndefined()
  })

  it('keeps the appearance of a folder through rename, undo, and the canonical format', () => {
    let document = apply(styled(), { kind: 'update-folder-appearance', path: ['F'], appearance: { style: 'purple-3', visible: false }, overwriteAppearance: true })
    document = apply(document, { kind: 'rename-folder', path: ['F'], name: 'Shapes' })
    expect(document.folders?.[0]).toMatchObject({ path: ['Shapes'], overwriteAppearance: true, appearance: { style: 'purple-3', visible: false } })
    const bytes = serializeCanonicalDocument(toCanonicalDocument(document, 'light'))
    expect(serializeCanonicalDocument(parseCanonicalDocument(bytes))).toBe(bytes)
    const restored = fromCanonicalDocument(parseCanonicalDocument(bytes)).document
    expect(restored.folders?.[0]).toMatchObject({ path: ['Shapes'], overwriteAppearance: true, appearance: { style: 'purple-3', visible: false, strokeStyle: 'solid' } })
    // A folder without its own appearance stays without one.
    expect(restored.folders?.[1]).toEqual({ path: ['Shapes', 'G'], collapsed: false })
    let history = createDocumentHistory(styled())
    history = documentHistoryReducer(history, { type: 'execute', command: { kind: 'update-folder-appearance', path: ['F'], overwriteAppearance: true } })
    history = documentHistoryReducer(history, { type: 'undo' })
    expect(history.present.folders?.[0].overwriteAppearance).toBeUndefined()
  })

  it('migrates version 9 folders as having no appearance of their own', () => {
    const current = JSON.parse(serializeCanonicalDocument(toCanonicalDocument(sample(), 'light'))) as Record<string, unknown>
    const folders = (current.folders as Record<string, unknown>[]).map(({ overwriteAppearance: _o, appearance: _a, ...folder }) => folder)
    const migrated = parseCanonicalDocument(JSON.stringify({ ...current, formatVersion: 9, folders }))
    expect(migrated.folders).toEqual([
      { path: ['F'], collapsed: false, overwriteAppearance: false, appearance: null, before: null },
      { path: ['F', 'G'], collapsed: false, overwriteAppearance: false, appearance: null, before: null },
    ])
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
    expect(bytes).toContain('"folders":[{"appearance":null,"before":null,"collapsed":true,"overwriteAppearance":false,"path":["F"]}')
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
    reject((document) => { document.folders = [{ path: ['F'], collapsed: false, overwriteAppearance: false, appearance: null, before: null }, { path: ['F'], collapsed: true, overwriteAppearance: false, appearance: null, before: null }, { path: ['F', 'G'], collapsed: false, overwriteAppearance: false, appearance: null, before: null }] }, 'DOCUMENT_DUPLICATE_FOLDER')
    reject((document) => { document.folders = [{ path: ['F', 'G'], collapsed: false, overwriteAppearance: false, appearance: null, before: null }] }, 'DOCUMENT_ORPHAN_FOLDER')
    reject((document) => { document.folders = [{ path: [''], collapsed: false, overwriteAppearance: false, appearance: null, before: null }] }, 'DOCUMENT_FOLDER_NAME')
    reject((document) => { document.folders = [{ path: [], collapsed: false, overwriteAppearance: false, appearance: null, before: null }] }, 'DOCUMENT_FOLDER_NAME')
    reject((document) => { document.folders = [{ path: ['F'], collapsed: false, overwriteAppearance: false, appearance: null, color: 'red' }] }, 'DOCUMENT_UNKNOWN_FIELD')
    reject((document) => { document.folders = [{ path: ['x'.repeat(129)], collapsed: false, overwriteAppearance: false, appearance: null, before: null }] }, 'LIMIT_FOLDER_NAME_LENGTH')
    reject((document) => { document.folders = Array.from({ length: 9 }, (_, depth) => ({ path: Array.from({ length: depth + 1 }, () => 'L'), collapsed: false, overwriteAppearance: false, appearance: null, before: null })) }, 'LIMIT_FOLDER_DEPTH')
    reject((document) => { document.folders = Array.from({ length: 257 }, (_, index) => ({ path: [`F${index}`], collapsed: false, overwriteAppearance: false, appearance: null, before: null })) }, 'LIMIT_FOLDER_COUNT')
    // A folder appearance is a complete appearance record.
    reject((document) => { document.folders = [{ path: ['F'], collapsed: false, overwriteAppearance: true, appearance: { style: 'red-4' } }, { path: ['F', 'G'], collapsed: false, overwriteAppearance: false, appearance: null, before: null }] }, 'DOCUMENT_UNKNOWN_FIELD')
  })

  it('counts a name in code points', () => {
    const name = '𝑥'.repeat(128)
    expect(apply(expressionDocument([]), { kind: 'create-folder', path: [name] }).folders).toHaveLength(1)
  })

  it('migrates a version 7 document without folders, in its order', () => {
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
    expect(parseCanonicalDocument(JSON.stringify({ ...earlier, formatVersion: 8, items })).folders).toEqual([])
  })
})
