import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { parseCanonicalDocument, serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument, type ExpressionDocument } from './document/expressionDocument'

/**
 * End-to-end scenarios of the expression panel: typing notes and folders with
 * `"` and `/`, moving rows and folders by pointer and keyboard, refusing to
 * nest folders, removing folders, and keeping all of it through undo and a
 * reload. Each scenario chains several operations, as a user would.
 */

beforeEach(() => {
  // Browser storage is read outside the test mode only.
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

function open(document: ExpressionDocument) {
  window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(toCanonicalDocument(document, 'light')))
  render(<App />)
}

/** Reopens the application from what it stored, as after a reload. */
async function reload() {
  await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).not.toBeNull())
  const stored = window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!
  cleanup()
  window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, stored)
  render(<App />)
}

const doc = (sources: readonly string[], folders: ExpressionDocument['folders'] = [], inFolder: Record<number, string[]> = {}) => ({
  ...expressionDocument(
    sources.map((source, index) => ({ id: `item-${index + 1}`, source, ...(inFolder[index] ? { folder: inFolder[index] } : {}) })),
    {},
    { id: 'scenarios', title: 'Scenarios' },
  ),
  folders,
})

const ROW_NAME = /^(Expression|Annotation) \d+$/
const editors = () => screen.getAllByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: ROW_NAME })
const editor = (source: string) => editors().find((element) => element.value === source)!
const undo = () => fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
const redo = () => fireEvent.click(screen.getByRole('button', { name: 'Redo document change' }))
const announced = (text: string) => expect(screen.getByText(text)).toBeInTheDocument()

/**
 * The panel as text, one line per visible row in display order: `[Name]` for
 * a folder header, `  source` for a row inside a folder, `"source` for a note.
 */
function panel(): string[] {
  const list = document.querySelector('.expression-list')!
  return [...list.querySelectorAll<HTMLElement>('.folder-member')]
    .filter((member) => !member.hidden)
    .map((member) => {
      const depth = Number(member.style.getPropertyValue('--folder-depth') || 0)
      const indent = '  '.repeat(depth)
      const toggle = member.querySelector('.folder-toggle')
      if (toggle) {
        const name = member.querySelector('.folder-name-button, .folder-name-input, .folder-name') as HTMLElement
        const text = name instanceof HTMLInputElement ? name.value : name.textContent
        return `${indent}[${text}]${toggle.getAttribute('aria-expanded') === 'false' ? '+' : ''}`
      }
      const field = member.querySelector<HTMLInputElement | HTMLTextAreaElement>('.expression-source')!
      return `${indent}${field instanceof HTMLTextAreaElement ? '"' : ''}${field.value}`
    })
}

/** The stored document, as the panel would show it after a reload. */
const storedFolders = () => parseCanonicalDocument(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!)

/** Gives every visible row of the panel a 40-pixel box, top to bottom, for pointer drags. */
function layOut() {
  const members = [...document.querySelectorAll<HTMLElement>('.expression-list .folder-member')].filter((member) => !member.hidden)
  members.forEach((member, index) => {
    const box = (member.querySelector('.folder-row') ?? member.querySelector('.expression-item')) as HTMLElement
    box.getBoundingClientRect = () => ({ top: index * 40, bottom: index * 40 + 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: index * 40, toJSON: () => ({}) }) as DOMRect
  })
}

/** The vertical position of a row in the layout, at its upper or lower half. */
function at(rowLabel: string, half: 'upper' | 'lower'): number {
  const index = panel().findIndex((line) => line.trim() === rowLabel)
  if (index < 0) throw new Error(`no row ${rowLabel} in ${JSON.stringify(panel())}`)
  return index * 40 + (half === 'upper' ? 10 : 30)
}

/** Drags a handle to a vertical position and drops it there. */
function drag(handle: HTMLElement, clientY: number) {
  layOut()
  fireEvent.pointerDown(handle, { pointerId: 7, button: 0 })
  fireEvent.pointerMove(window, { pointerId: 7, clientY })
  fireEvent.pointerUp(window, { pointerId: 7 })
}

const rowHandle = (source: string) => within(editor(source).closest('.expression-item') as HTMLElement)
  .getByRole('button', { name: /^Reorder / })
const folderHandle = (name: string) => screen.getByRole('button', { name: `Reorder folder ${name}. Alt plus arrow keys to move.` })
const folderToggle = (name: string) => screen.getByRole('button', { name: new RegExp(`^Folder ${name}, level`) })
const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const key = (field: HTMLElement, name: string, options: Record<string, unknown> = {}) => fireEvent.keyDown(field, { key: name, ...options })

/** Opens the add menu of the toolbar and chooses one of its items. */
function openAddMenuItem(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More to add' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

describe('interface scenarios', () => {
  it('writes a whole document from the keyboard with " for notes and / for folders', async () => {
    open(doc(['']))
    // A note, then a second line in it.
    type(editors()[0], '"Triangle')
    const note = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Annotation 1' })
    expect(note).toHaveFocus()
    key(note, 'Enter')
    type(note, 'Triangle\nwith three points')
    expect(panel()).toEqual(['"Triangle\nwith three points'])
    // Ctrl+Enter adds the next row, an expression.
    key(note, 'Enter', { ctrlKey: true })
    const second = screen.getByRole('textbox', { name: 'Expression 2' })
    // A slash makes a folder of that row, named by what follows.
    type(second, '/Points')
    const name = screen.getByRole('textbox', { name: 'Name of folder Points' })
    expect(name).toHaveFocus()
    key(name, 'Enter')
    // Enter after the name goes to the first row of the folder.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus())
    const firstRow = screen.getByRole('textbox', { name: 'Expression 2' })
    type(firstRow, 'A = 1')
    key(firstRow, 'Enter')
    // Enter inserts the next row in the same folder.
    type(screen.getByRole('textbox', { name: 'Expression 3' }), 'B = A + 1')
    expect(panel()).toEqual(['"Triangle\nwith three points', '[Points]', '  A = 1', '  B = A + 1'])

    // A note made inside a folder stays in it.
    key(editor('B = A + 1'), 'Enter')
    type(screen.getByRole('textbox', { name: 'Expression 4' }), '"A comment in the folder')
    expect(panel()).toEqual(['"Triangle\nwith three points', '[Points]', '  A = 1', '  B = A + 1', '  "A comment in the folder'])

    // In a note, " and / are text: they make neither a note nor a folder.
    const inner = screen.getByRole('textbox', { name: 'Annotation 4' })
    type(inner, '/not a folder "and not a note"')
    expect(panel().at(-1)).toBe('  "/not a folder "and not a note"')
    expect(screen.queryByRole('button', { name: /^Folder not a folder/ })).not.toBeInTheDocument()

    // Backspace at the start of the note makes it an expression again, still in the folder.
    act(() => inner.focus())
    ;(inner as HTMLTextAreaElement).setSelectionRange(0, 0)
    key(inner, 'Backspace')
    expect(panel().at(-1)).toBe('  /not a folder "and not a note"')
    // That expression starts with a slash only as text: no folder appears until a slash is typed first again.
    expect(screen.getAllByRole('button', { name: /^Folder .*, level/ })).toHaveLength(1)

    // Everything is stored, and comes back after a reload.
    await reload()
    expect(panel()).toEqual([
      '"Triangle\nwith three points', '[Points]', '  A = 1', '  B = A + 1', '  /not a folder "and not a note"',
    ])
    expect(storedFolders().items.map((item) => [item.kind, item.folder ?? []])).toEqual([
      ['annotation', []], ['expression', ['Points']], ['expression', ['Points']], ['expression', ['Points']],
    ])
  })

  it('never nests a folder: a slash inside a folder, the keyboard, and a drag all keep folders at the margin', () => {
    open(doc(['A = 1', 'B = 2', 'C = 3', 'D = 4'], [{ path: ['Left'], collapsed: false }, { path: ['Right'], collapsed: false }], {
      0: ['Left'], 1: ['Left'], 2: ['Right'],
    }))
    expect(panel()).toEqual(['[Left]', '  A = 1', '  B = 2', '[Right]', '  C = 3', 'D = 4'])

    // A slash in a row inside Left creates a folder at the margin, just after Left.
    type(editor('B = 2'), '/Inner')
    key(screen.getByRole('textbox', { name: 'Name of folder Inner' }), 'Escape')
    expect(panel()).toEqual(['[Left]', '  A = 1', '[Inner]', '  ', '[Right]', '  C = 3', 'D = 4'])
    expect(folderToggle('Inner')).toHaveAccessibleName('Folder Inner, level 1, 1 row')
    undo()
    expect(panel()).toEqual(['[Left]', '  A = 1', '  B = 2', '[Right]', '  C = 3', 'D = 4'])

    // By keyboard, Left passes Right instead of entering it.
    key(folderHandle('Left'), 'ArrowDown', { altKey: true })
    expect(panel()).toEqual(['[Right]', '  C = 3', '[Left]', '  A = 1', '  B = 2', 'D = 4'])
    expect(folderToggle('Left')).toHaveAccessibleName('Folder Left, level 1, 2 rows')

    // Dragged onto a row of Right, Left has no target, and the drop changes nothing.
    drag(folderHandle('Left'), at('C = 3', 'lower'))
    expect(document.querySelector('.drop-into')).toBeNull()
    expect(panel()).toEqual(['[Right]', '  C = 3', '[Left]', '  A = 1', '  B = 2', 'D = 4'])
    // Dragged onto the lower half of the Right header, it is not dropped into Right either.
    drag(folderHandle('Left'), at('[Right]', 'lower'))
    expect(folderToggle('Left')).toHaveAccessibleName('Folder Left, level 1, 2 rows')
    expect(folderToggle('Right')).toHaveAccessibleName('Folder Right, level 1, 1 row')
    // Onto the upper half of the Right header, it goes before Right.
    drag(folderHandle('Left'), at('[Right]', 'upper'))
    expect(panel()).toEqual(['[Left]', '  A = 1', '  B = 2', '[Right]', '  C = 3', 'D = 4'])
    // Next to a row at the margin, it goes after it.
    drag(folderHandle('Left'), at('D = 4', 'lower'))
    expect(panel()).toEqual(['[Right]', '  C = 3', 'D = 4', '[Left]', '  A = 1', '  B = 2'])
    expect(storedFolders().folders.map(({ path }) => path)).toEqual([['Left'], ['Right']])
  })

  it('moves rows into, within, and out of folders by dragging their handle, one undo step per drag', () => {
    open(doc(['A = 1', 'B = A + 1', 'C = B + 1', 'D = C + 1'], [{ path: ['Sums'], collapsed: false }], { 1: ['Sums'], 2: ['Sums'] }))
    expect(panel()).toEqual(['A = 1', '[Sums]', '  B = A + 1', '  C = B + 1', 'D = C + 1'])
    const value = (source: string) => (editor(source).closest('.expression-item') as HTMLElement).querySelector('.expression-feedback')!.textContent
    const before = value('D = C + 1')

    // Into the folder, onto its header: the row goes first in it.
    drag(rowHandle('A = 1'), at('[Sums]', 'lower'))
    expect(panel()).toEqual(['[Sums]', '  A = 1', '  B = A + 1', '  C = B + 1', 'D = C + 1'])
    announced('Moved A to position 1 of 3 in folder Sums.')
    // Within the folder, after another row.
    drag(rowHandle('A = 1'), at('C = B + 1', 'lower'))
    expect(panel()).toEqual(['[Sums]', '  B = A + 1', '  C = B + 1', '  A = 1', 'D = C + 1'])
    // Out of it, before a row at the margin.
    drag(rowHandle('B = A + 1'), at('D = C + 1', 'upper'))
    expect(panel()).toEqual(['[Sums]', '  C = B + 1', '  A = 1', 'B = A + 1', 'D = C + 1'])
    // Values never depend on the folders or the order.
    expect(value('D = C + 1')).toBe(before)

    // Each drag is one step back.
    undo()
    expect(panel()).toEqual(['[Sums]', '  B = A + 1', '  C = B + 1', '  A = 1', 'D = C + 1'])
    undo()
    expect(panel()).toEqual(['[Sums]', '  A = 1', '  B = A + 1', '  C = B + 1', 'D = C + 1'])
    undo()
    expect(panel()).toEqual(['A = 1', '[Sums]', '  B = A + 1', '  C = B + 1', 'D = C + 1'])
    redo()
    expect(panel()).toEqual(['[Sums]', '  A = 1', '  B = A + 1', '  C = B + 1', 'D = C + 1'])

    // A row dropped on its own place changes nothing and adds no step.
    drag(rowHandle('A = 1'), at('A = 1', 'upper'))
    expect(panel()).toEqual(['[Sums]', '  A = 1', '  B = A + 1', '  C = B + 1', 'D = C + 1'])
    undo()
    expect(panel()).toEqual(['A = 1', '[Sums]', '  B = A + 1', '  C = B + 1', 'D = C + 1'])
  })

  it('opens a collapsed folder when a row is dropped on it, and keeps hidden rows out of the way', () => {
    open(doc(['A = 1', 'B = 2', 'C = 3'], [{ path: ['Box'], collapsed: true }], { 1: ['Box'] }))
    expect(panel()).toEqual(['A = 1', '[Box]+', 'C = 3'])
    drag(rowHandle('C = 3'), at('[Box]+', 'lower'))
    expect(panel()).toEqual(['A = 1', '[Box]', '  B = 2', '  C = 3'])
    // Collapsing is not a step: undo takes back the move only.
    fireEvent.click(folderToggle('Box'))
    expect(panel()).toEqual(['A = 1', '[Box]+'])
    undo()
    expect(panel()).toEqual(['A = 1', '[Box]+', 'C = 3'])
  })

  it('moves rows and folders through each other by keyboard, from the handle and from the editor', () => {
    open(doc(['A = 1', 'B = 2', 'C = 3', 'D = 4'], [{ path: ['F'], collapsed: false }], { 1: ['F'], 2: ['F'] }))
    expect(panel()).toEqual(['A = 1', '[F]', '  B = 2', '  C = 3', 'D = 4'])
    // A row walks down through the folder and out of it, keeping the focus on its handle.
    act(() => rowHandle('A = 1').focus())
    const walk = () => {
      key(document.activeElement as HTMLElement, 'ArrowDown', { altKey: true })
      expect(rowHandle('A = 1'), JSON.stringify(panel())).toHaveFocus()
    }
    walk()
    expect(panel()).toEqual(['[F]', '  A = 1', '  B = 2', '  C = 3', 'D = 4'])
    walk()
    walk()
    expect(panel()).toEqual(['[F]', '  B = 2', '  C = 3', '  A = 1', 'D = 4'])
    walk()
    expect(panel()).toEqual(['[F]', '  B = 2', '  C = 3', 'A = 1', 'D = 4'])
    // Alt with the arrows in the editor moves the row too, and keeps the caret there.
    const field = editor('D = 4')
    act(() => field.focus())
    key(field, 'ArrowUp', { altKey: true })
    expect(panel()).toEqual(['[F]', '  B = 2', '  C = 3', 'D = 4', 'A = 1'])
    // Home and End go to the first and last place of the row's folder.
    key(rowHandle('C = 3'), 'Home', { altKey: true })
    expect(panel()).toEqual(['[F]', '  C = 3', '  B = 2', 'D = 4', 'A = 1'])
    // The folder moves with its rows, by its handle.
    key(folderHandle('F'), 'End', { altKey: true })
    expect(panel()).toEqual(['D = 4', 'A = 1', '[F]', '  C = 3', '  B = 2'])
    key(folderHandle('F'), 'ArrowDown', { altKey: true })
    announced('Folder F cannot move down.')
    key(folderHandle('F'), 'ArrowUp', { altKey: true })
    expect(panel()).toEqual(['D = 4', '[F]', '  C = 3', '  B = 2', 'A = 1'])
  })

  it('removes a folder and keeps its rows at the margin, renames it in place, and undoes both', () => {
    open(doc(['A = 1', 'B = 2', 'C = 3'], [{ path: ['Old'], collapsed: false }, { path: ['Taken'], collapsed: false }], { 1: ['Old'] }))
    // A name already taken is refused in the field, which stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Rename folder Old' }))
    const field = screen.getByRole('textbox', { name: 'Name of folder Old' })
    type(field, 'Taken')
    key(field, 'Enter')
    expect(screen.getByRole('alert')).toHaveTextContent('A folder named “Taken” already exists here.')
    // Escape gives up the new name.
    key(field, 'Escape')
    expect(panel()).toContain('[Old]')
    // A free name is accepted; Enter then opens a new first row in the folder.
    fireEvent.click(screen.getByRole('button', { name: 'Rename folder Old' }))
    type(screen.getByRole('textbox', { name: 'Name of folder Old' }), 'New')
    key(screen.getByRole('textbox', { name: 'Name of folder Old' }), 'Enter')
    expect(panel()).toEqual(['A = 1', '[New]', '  ', '  B = 2', 'C = 3', '[Taken]'])
    undo()
    expect(panel()).toEqual(['A = 1', '[New]', '  B = 2', 'C = 3', '[Taken]'])

    // The remove button removes the folder only.
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder New' }))
    expect(panel()).toEqual(['A = 1', 'B = 2', 'C = 3', '[Taken]'])
    undo()
    expect(panel()).toEqual(['A = 1', '[New]', '  B = 2', 'C = 3', '[Taken]'])
    undo()
    expect(panel()).toEqual(['A = 1', '[Old]', '  B = 2', 'C = 3', '[Taken]'])
  })

  it('opens a row in a folder with Enter after its name, whether the folder is empty, collapsed, or holds rows', async () => {
    open(doc(['A = 1', 'B = 2'], [{ path: ['Full'], collapsed: true }], { 1: ['Full'] }))
    // A folder with rows, collapsed: it opens, and a new first row takes the focus.
    fireEvent.click(screen.getByRole('button', { name: 'Rename folder Full' }))
    key(screen.getByRole('textbox', { name: 'Name of folder Full' }), 'Enter')
    expect(panel()).toEqual(['A = 1', '[Full]', '  ', '  B = 2'])
    await waitFor(() => expect(editor('')).toHaveFocus())
    type(editor(''), 'C = A + B')
    expect(panel()).toEqual(['A = 1', '[Full]', '  C = A + B', '  B = 2'])

    // A new empty folder: the row is created where the folder shows.
    openAddMenuItem('New folder')
    const name = screen.getByRole('textbox', { name: 'Name of folder New folder' })
    type(name, 'Empty')
    key(name, 'Enter')
    expect(panel()).toEqual(['A = 1', '[Full]', '  C = A + B', '  B = 2', '[Empty]', '  '])
    await waitFor(() => expect(editor('')).toHaveFocus())

    // After a slash, the folder's first row is already empty: it takes the focus, no second row is made.
    type(editor('A = 1'), '/Third')
    key(screen.getByRole('textbox', { name: 'Name of folder Third' }), 'Enter')
    expect(panel().filter((line) => line === '  ')).toHaveLength(2)
    expect(panel().slice(0, 2)).toEqual(['[Third]', '  '])
  })

  it('adds an expression, a comment, or a folder from the add menu, by pointer and keyboard', async () => {
    open(doc(['A = 1']))
    const toggle = screen.getByRole('button', { name: 'More to add' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // + adds an expression directly.
    fireEvent.click(screen.getByRole('button', { name: 'Add expression' }))
    expect(panel()).toEqual(['A = 1', ''])
    // The menu adds a comment, which is a note to write in.
    openAddMenuItem('Add comment')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel()).toEqual(['A = 1', '', '"'])
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Annotation 3' })).toHaveFocus())
    // Each item shows the key that does the same in a row.
    fireEvent.click(toggle)
    const menu = screen.getByRole('menu', { name: 'Add' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['ExpressionEnter', 'Comment"', 'Folder/'])
    // The first item takes focus; the arrows move through the items, Escape closes and returns to the arrow.
    expect(within(menu).getByRole('menuitem', { name: 'Add expression' })).toHaveFocus()
    key(menu, 'ArrowUp')
    expect(within(menu).getByRole('menuitem', { name: 'New folder' })).toHaveFocus()
    key(menu, 'Escape')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
    // ArrowDown on the arrow opens the menu too.
    key(toggle, 'ArrowDown')
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'New folder' }))
    expect(screen.getByRole('textbox', { name: 'Name of folder New folder' })).toHaveFocus()
    // A press outside closes an open menu.
    key(screen.getByRole('textbox', { name: 'Name of folder New folder' }), 'Escape')
    fireEvent.click(toggle)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps a long session of folder and note edits through a reload', async () => {
    open(doc(['A = vector(1, 0)', 'B = vector(0, 1)', 'S = A + B']))
    type(editor('B = vector(0, 1)'), '/Basis')
    key(screen.getByRole('textbox', { name: 'Name of folder Basis' }), 'Enter')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveFocus())
    type(screen.getByRole('textbox', { name: 'Expression 2' }), 'B = vector(0, 1)')
    drag(rowHandle('A = vector(1, 0)'), at('[Basis]', 'lower'))
    type(editor('S = A + B'), '"S is the sum')
    fireEvent.click(folderToggle('Basis'))
    const expected = ['[Basis]+', '"S is the sum']
    expect(panel()).toEqual(expected)
    await reload()
    expect(panel()).toEqual(expected)
    fireEvent.click(folderToggle('Basis'))
    expect(panel()).toEqual(['[Basis]', '  A = vector(1, 0)', '  B = vector(0, 1)', '"S is the sum'])
  })

  it('walks a row through empty folders by keyboard, in and out of each, without cycling', () => {
    open(doc(['A = 1', 'B = 2'], [{ path: ['E1'], collapsed: false }, { path: ['E2'], collapsed: false }]))
    expect(panel()).toEqual(['A = 1', 'B = 2', '[E1]', '[E2]'])
    act(() => rowHandle('B = 2').focus())
    const down = () => key(document.activeElement as HTMLElement, 'ArrowDown', { altKey: true })
    const up = () => key(document.activeElement as HTMLElement, 'ArrowUp', { altKey: true })
    const visited: string[][] = []
    for (let move = 0; move < 4; move += 1) { down(); visited.push(panel()) }
    expect(visited).toEqual([
      ['A = 1', '[E1]', '  B = 2', '[E2]'],
      ['A = 1', '[E1]', 'B = 2', '[E2]'],
      ['A = 1', '[E1]', '[E2]', '  B = 2'],
      ['A = 1', '[E1]', '[E2]', 'B = 2'],
    ])
    down()
    announced('B cannot move down.')
    // Up goes back the same way, and the focus stays on the handle.
    for (let move = 0; move < 4; move += 1) up()
    expect(panel()).toEqual(['A = 1', 'B = 2', '[E1]', '[E2]'])
    expect(rowHandle('B = 2')).toHaveFocus()
  })

  it('moves an empty folder by its handle, with the keyboard and by dragging', () => {
    open(doc(['A = 1', 'B = 2', 'C = 3'], [{ path: ['Box'], collapsed: false }], { 1: ['Box'] }))
    openAddMenuItem('New folder')
    key(screen.getByRole('textbox', { name: 'Name of folder New folder' }), 'Escape')
    expect(panel()).toEqual(['A = 1', '[Box]', '  B = 2', 'C = 3', '[New folder]'])
    // By keyboard, up past a row and past a folder.
    act(() => folderHandle('New folder').focus())
    key(folderHandle('New folder'), 'ArrowUp', { altKey: true })
    expect(panel()).toEqual(['A = 1', '[Box]', '  B = 2', '[New folder]', 'C = 3'])
    key(folderHandle('New folder'), 'ArrowUp', { altKey: true })
    expect(panel()).toEqual(['A = 1', '[New folder]', '[Box]', '  B = 2', 'C = 3'])
    expect(folderHandle('New folder')).toHaveFocus()
    // By dragging, after the last row.
    drag(folderHandle('New folder'), at('C = 3', 'lower'))
    expect(panel()).toEqual(['A = 1', '[Box]', '  B = 2', 'C = 3', '[New folder]'])
    // Before the first row.
    drag(folderHandle('New folder'), at('A = 1', 'upper'))
    expect(panel()).toEqual(['[New folder]', 'A = 1', '[Box]', '  B = 2', 'C = 3'])
    // One undo per move, and the place is kept through a reload.
    undo()
    expect(panel()).toEqual(['A = 1', '[Box]', '  B = 2', 'C = 3', '[New folder]'])
    redo()
    return reload().then(() => expect(panel()).toEqual(['[New folder]', 'A = 1', '[Box]', '  B = 2', 'C = 3']))
  })

})
