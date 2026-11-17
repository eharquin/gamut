import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { parseCanonicalDocument, serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument, type ExpressionDocument } from './document/expressionDocument'

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

const flat = () => expressionDocument(
  ['A = 1', 'B = 2', 'C = A + B'].map((source, index) => ({ id: `item-${index + 1}`, source })),
  {},
  { id: 'folders', title: 'Folders' },
)

const editorOf = (value: string) => screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Expression \d+$/ })
  .find((element) => element.value === value)!
const handleFor = (value: string) => within(editorOf(value).closest('.expression-item') as HTMLElement)
  .getByRole('button', { name: /^Reorder / })
const visibleSources = () => screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Expression \d+$/ })
  .filter((element) => !element.closest('[hidden]'))
  .map((element) => element.value)
const folderButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^Folder ${name}, level`) })
const stored = () => parseCanonicalDocument(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)!)

describe('expression folders (DOC-013, A11Y-011)', () => {
  it('creates and names a folder, then moves a row into and out of it by keyboard', async () => {
    open(flat())
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const name = screen.getByRole('textbox', { name: 'Name of folder New folder' })
    expect(name).toHaveFocus()
    fireEvent.change(name, { target: { value: '  Sums  ' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 0 rows')
    expect(folderButton('Sums')).toHaveAttribute('aria-expanded', 'true')
    // The renamed folder is a new row: it takes focus back from the name field.
    await waitFor(() => expect(folderButton('Sums')).toHaveFocus())

    // C is the last row: Alt+Down enters the empty folder after it.
    handleFor('C = A + B').focus()
    fireEvent.keyDown(handleFor('C = A + B'), { key: 'ArrowDown', altKey: true })
    expect(screen.getByText('Moved C to position 1 of 1 in folder Sums.')).toBeInTheDocument()
    expect(handleFor('C = A + B')).toHaveFocus()
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 1 row')
    await waitFor(() => expect(stored().items[2].folder).toEqual(['Sums']))
    // The value is unchanged: folders never change evaluation.
    expect(within(editorOf('C = A + B').closest('.expression-item') as HTMLElement).getByText('3')).toBeInTheDocument()

    // Alt+Up from the first row of the folder leaves it, before the folder.
    fireEvent.keyDown(handleFor('C = A + B'), { key: 'ArrowUp', altKey: true })
    expect(screen.getByText('Moved C to position 3 of 4.')).toBeInTheDocument()
    expect(handleFor('C = A + B')).toHaveFocus()

    // Undo restores the row in the folder; undo again removes it from there.
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 1 row')
  })

  it('collapses a folder without a history entry and hides its rows', async () => {
    open({
      ...flat(),
      items: flat().items.map((item, index) => index > 0 ? { ...item, folder: ['Sums'] } : item),
      folders: [{ path: ['Sums'], collapsed: false }],
    })
    expect(visibleSources()).toEqual(['A = 1', 'B = 2', 'C = A + B'])
    const undo = screen.getByRole('button', { name: 'Undo document change' })
    expect(undo).toBeDisabled()
    fireEvent.click(folderButton('Sums'))
    expect(folderButton('Sums')).toHaveAttribute('aria-expanded', 'false')
    expect(visibleSources()).toEqual(['A = 1'])
    expect(undo).toBeDisabled()
    await waitFor(() => expect(stored().folders).toEqual([{ path: ['Sums'], collapsed: true, overwriteAppearance: false, appearance: null }]))

    // Plain arrows skip the hidden rows.
    fireEvent.click(folderButton('Sums'))
    expect(visibleSources()).toEqual(['A = 1', 'B = 2', 'C = A + B'])
  })

  it('refuses an empty or duplicate name, and removing a folder keeps its rows', () => {
    open({
      ...flat(),
      items: flat().items.map((item, index) => index === 1 ? { ...item, folder: ['Sums'] } : item),
      folders: [{ path: ['Sums'], collapsed: false }, { path: ['Other'], collapsed: false }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rename folder Sums' }))
    const name = screen.getByRole('textbox', { name: 'Name of folder Sums' })
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('A folder name cannot be empty.')
    fireEvent.change(name, { target: { value: 'Other' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('A folder named “Other” already exists here.')
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(folderButton('Sums')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove folder Sums' }))
    expect(screen.queryByRole('button', { name: /^Folder Sums/ })).not.toBeInTheDocument()
    expect(visibleSources()).toEqual(['A = 1', 'B = 2', 'C = A + B'])
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(folderButton('Sums')).toBeInTheDocument()
  })

  it('refuses a name over the limit and keeps the name field open', () => {
    open({ ...flat(), folders: [{ path: ['Sums'], collapsed: false }] })
    fireEvent.click(screen.getByRole('button', { name: 'Rename folder Sums' }))
    const name = screen.getByRole('textbox', { name: 'Name of folder Sums' })
    fireEvent.change(name, { target: { value: 'x'.repeat(200) } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/^Folder renamed to/)).not.toBeInTheDocument()
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(folderButton('Sums')).toBeInTheDocument()
  })

  it('does not move focus later when a row cannot move', () => {
    open(flat())
    editorOf('A = 1').focus()
    fireEvent.keyDown(editorOf('A = 1'), { key: 'ArrowUp', altKey: true })
    expect(screen.getByText('A cannot move up.')).toBeInTheDocument()
    editorOf('C = A + B').focus()
    fireEvent.change(editorOf('C = A + B'), { target: { value: 'C = A + B + 1' } })
    expect(editorOf('C = A + B + 1')).toHaveFocus()
  })

  it('lets a document that holds only folders be cleared', () => {
    open({ ...flat(), items: [], folders: [{ path: ['Sums'], collapsed: false }] })
    expect(screen.getByRole('button', { name: /clear/i })).toBeEnabled()
  })

  it('edits the name of a folder by clicking it, and toggles it by its chevron only', () => {
    open({ ...flat(), folders: [{ path: ['Sums'], collapsed: false }] })
    expect(screen.queryByText('✎')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Sums'))
    const name = screen.getByRole('textbox', { name: 'Name of folder Sums' })
    expect(name).toHaveFocus()
    expect(folderButton('Sums')).toHaveAttribute('aria-expanded', 'true')
    fireEvent.change(name, { target: { value: 'Totals' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    expect(folderButton('Totals')).toBeInTheDocument()
  })

  it('moves a folder with its rows by its handle, without entering another folder', () => {
    open({
      ...flat(),
      items: flat().items.map((item, index) => index === 0 ? { ...item, folder: ['Sums'] } : item),
      folders: [{ path: ['Sums'], collapsed: false }, { path: ['Other'], collapsed: false }],
    })
    const handle = (name: string) => screen.getByRole('button', { name: `Reorder folder ${name}. Alt plus arrow keys to move.` })
    fireEvent.keyDown(handle('Sums'), { key: 'ArrowDown', altKey: true })
    expect(screen.getByText('Moved folder Sums to position 2 of 4.')).toBeInTheDocument()
    expect(visibleSources()).toEqual(['B = 2', 'A = 1', 'C = A + B'])
    // The value of a row is unchanged by the move of its folder.
    expect(within(editorOf('C = A + B').closest('.expression-item') as HTMLElement).getByText('3')).toBeInTheDocument()
    fireEvent.keyDown(handle('Sums'), { key: 'End', altKey: true })
    expect(visibleSources()).toEqual(['B = 2', 'C = A + B', 'A = 1'])
    // The folder next to it is not entered: every folder stays at the top level.
    fireEvent.keyDown(handle('Sums'), { key: 'ArrowDown', altKey: true })
    expect(screen.getByText('Folder Sums cannot move down.')).toBeInTheDocument()
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 1 row')
    expect(folderButton('Other')).toHaveAccessibleName('Folder Other, level 1, 0 rows')
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(visibleSources()).toEqual(['B = 2', 'A = 1', 'C = A + B'])
  })

  it('drops a dragged folder before another folder, never into it', () => {
    open({
      ...flat(),
      items: flat().items.map((item, index) => index === 0 ? { ...item, folder: ['Sums'] } : item),
      folders: [{ path: ['Sums'], collapsed: false }, { path: ['Other'], collapsed: false }],
    })
    const header = (name: string) => folderButton(name).closest('.folder-row') as HTMLElement
    header('Sums').getBoundingClientRect = () => ({ top: 0, bottom: 30, height: 30 }) as DOMRect
    screen.getAllByRole('textbox', { name: /^Expression \d+$/ }).forEach((element, index) => {
      (element.closest('.expression-item') as HTMLElement).getBoundingClientRect = () => ({ top: 30 + index * 40, bottom: 70 + index * 40, height: 40 }) as DOMRect
    })
    header('Other').getBoundingClientRect = () => ({ top: 150, bottom: 180, height: 30 }) as DOMRect
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Reorder folder Sums/ }), { pointerId: 1 })
    // Over its own row, a folder has no target.
    fireEvent.pointerMove(window, { clientY: 40 })
    expect(document.querySelector('.drop-before, .drop-after, .drop-into')).toBeNull()
    fireEvent.pointerMove(window, { clientY: 175 })
    expect(header('Other')).toHaveClass('drop-before')
    expect(header('Other')).not.toHaveClass('drop-into')
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 1 row')
    expect(visibleSources()).toEqual(['B = 2', 'C = A + B', 'A = 1'])
  })

  it('makes a folder of a row when a slash is typed first, where the row is', async () => {
    open(flat())
    fireEvent.change(editorOf('B = 2'), { target: { value: '/Sums' } })
    // The folder is named by what follows the slash, and its name is open for editing.
    const name = screen.getByRole('textbox', { name: 'Name of folder Sums' })
    expect(name).toHaveFocus()
    expect(name).toHaveValue('Sums')
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 1 row')
    // The row, emptied, is the first row of the folder, between its neighbours.
    expect(visibleSources()).toEqual(['A = 1', '', 'C = A + B'])
    expect(editorOf('').closest('.folder-member')).toHaveStyle({ '--folder-depth': '1' })
    expect(screen.getByText('Folder Sums created with this row.')).toBeInTheDocument()
    // Enter validates the name and goes to the first row of the folder.
    fireEvent.change(name, { target: { value: 'Totals' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    await waitFor(() => expect(editorOf('')).toHaveFocus())
    expect(folderButton('Totals')).toHaveAccessibleName('Folder Totals, level 1, 1 row')
    // One undo takes the new name back, and one more gives the row back.
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(folderButton('Sums')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(visibleSources()).toEqual(['A = 1', 'B = 2', 'C = A + B'])
    expect(screen.queryByRole('button', { name: /^Folder / })).not.toBeInTheDocument()
    // A slash elsewhere is a division.
    fireEvent.change(editorOf('B = 2'), { target: { value: 'B = 2 / 1' } })
    expect(screen.queryByRole('button', { name: /^Folder / })).not.toBeInTheDocument()
  })

  it('creates the folder of a slash at the top level, after the folder the row was in', () => {
    open({
      ...flat(),
      items: flat().items.map((item, index) => index < 2 ? { ...item, folder: ['Sums'] } : item),
      folders: [{ path: ['Sums'], collapsed: false }],
    })
    fireEvent.change(editorOf('A = 1'), { target: { value: '/' } })
    expect(screen.getByRole('textbox', { name: 'Name of folder New folder' })).toHaveFocus()
    expect(folderButton('New folder')).toHaveAccessibleName('Folder New folder, level 1, 1 row')
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 1 row')
    expect(visibleSources()).toEqual(['B = 2', '', 'C = A + B'])
    // A name already taken gets a suffix.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name of folder New folder' }), { key: 'Escape' })
    fireEvent.change(editorOf('C = A + B'), { target: { value: '/Sums' } })
    expect(screen.getByRole('textbox', { name: 'Name of folder Sums 2' })).toBeInTheDocument()
  })

  it('fills the indent of the rows of a folder', () => {
    open({
      ...flat(),
      items: flat().items.map((item, index) => index === 1 ? { ...item, folder: ['Sums'] } : item),
      folders: [{ path: ['Sums'], collapsed: false }],
    })
    expect(editorOf('B = 2').closest('.folder-member')).toHaveStyle({ '--folder-depth': '1' })
    expect(editorOf('A = 1').closest('.folder-member')).not.toHaveStyle({ '--folder-depth': '1' })
  })

  it('hides the rows of a folder with its eye, and overwrites their appearance from its menu', () => {
    open({
      ...expressionDocument([
        { id: 'a', source: 'A = vector(1, 0)' },
        { id: 'b', source: 'B = vector(0, 1)', folder: ['Basis'] },
      ], { a: { style: 'green-4' }, b: { style: 'red-4' } }, { id: 'folders', title: 'Folders' }),
      folders: [{ path: ['Basis'], collapsed: false }],
    })
    const description = () => screen.getByRole('img', { name: /Two-dimensional VGA viewport/ }).textContent ?? ''
    expect(description()).toMatch(/B runs/)
    fireEvent.click(screen.getByRole('button', { name: 'Hide folder Basis' }))
    expect(description()).not.toMatch(/B runs/)
    expect(description()).toMatch(/A runs/)
    // The row keeps its own eye: showing the folder brings it back.
    expect(screen.getByRole('button', { name: 'Hide B' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show folder Basis' }))
    expect(description()).toMatch(/B runs/)

    const swatch = (name: string) => (screen.getByRole('textbox', { name }).closest('.expression-item') as HTMLElement)
      .querySelector<HTMLElement>('.appearance-swatch-fill')!.style.backgroundColor
    const before = swatch('Expression 2')
    fireEvent.click(screen.getByRole('button', { name: 'Open appearance menu for folder Basis' }))
    const menu = screen.getByRole('dialog', { name: 'Folder Basis' })
    // The menu shows the kinds the folder holds, and no label.
    expect(within(menu).getByRole('button', { name: 'Vectors' })).toBeInTheDocument()
    expect(within(menu).queryByText('Label')).not.toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('button', { name: 'Purple' }))
    // Off by default: the row keeps its own colour.
    expect(swatch('Expression 2')).toBe(before)
    fireEvent.click(within(menu).getByRole('switch', { name: 'Overwrite appearance' }))
    expect(swatch('Expression 2')).not.toBe(before)
    expect(screen.getByText('Appearance set by the folder Basis')).toBeInTheDocument()
    // The row outside the folder is unchanged.
    expect(screen.getByRole('button', { name: /^Open .* menu for A$/ })).toBeInTheDocument()
    // One undo turns the overwrite off and gives the row its colour back.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Undo document change' }))
    expect(swatch('Expression 2')).toBe(before)
  it('renders bold, code, and mathematics in a folder name, and edits the name as written', async () => {
    open({ ...flat(), folders: [{ path: ['Rotor **R** $R_\\theta$'], collapsed: false }] })
    expect(screen.getByRole('button', { name: /^Folder Rotor R R_\\theta, level 1/ })).toBeInTheDocument()
    const nameButton = screen.getByRole('button', { name: 'Rename folder Rotor R R_\\theta' })
    expect(within(nameButton).getByText('R', { selector: 'strong' })).toBeInTheDocument()
    await waitFor(() => expect(nameButton.querySelector('.katex')).not.toBeNull())
    // A folder name holds no link: a click on it edits the name.
    cleanup()
    window.localStorage.clear()
    open({ ...flat(), folders: [{ path: ['See [x](https://example.org)'], collapsed: false }] })
    expect(document.querySelector('.folder-name a')).toBeNull()
    cleanup()
    window.localStorage.clear()
    open({ ...flat(), folders: [{ path: ['Rotor **R** $R_\\theta$'], collapsed: false }] })
    fireEvent.click(screen.getByRole('button', { name: 'Rename folder Rotor R R_\\theta' }))
    expect(screen.getByRole('textbox', { name: 'Name of folder Rotor R R_\\theta' })).toHaveValue('Rotor **R** $R_\\theta$')
  })

  it('drops a dragged row into a folder', () => {
    open({ ...flat(), folders: [{ path: ['Sums'], collapsed: true }] })
    const rows = screen.getAllByRole('textbox', { name: /^Expression \d+$/ })
      .map((element) => element.closest('.expression-item') as HTMLElement)
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => ({ top: index * 40, bottom: index * 40 + 40, height: 40 }) as DOMRect
    })
    const header = folderButton('Sums').closest('.folder-row') as HTMLElement
    header.getBoundingClientRect = () => ({ top: 120, bottom: 150, height: 30 }) as DOMRect
    fireEvent.pointerDown(handleFor('A = 1'), { pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 145 })
    expect(header).toHaveClass('drop-into')
    fireEvent.pointerUp(window, { pointerId: 1 })
    // Moving into a collapsed folder expands it, so the moved row stays visible.
    expect(folderButton('Sums')).toHaveAttribute('aria-expanded', 'true')
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 1 row')
    expect(screen.getByText('Moved A to position 1 of 1 in folder Sums.')).toBeInTheDocument()
  })

  it('inserts a new row in the folder of the row where Enter was pressed', () => {
    open({
      ...flat(),
      items: flat().items.map((item, index) => index === 2 ? { ...item, folder: ['Sums'] } : item),
      folders: [{ path: ['Sums'], collapsed: false }],
    })
    fireEvent.keyDown(editorOf('C = A + B'), { key: 'Enter' })
    expect(folderButton('Sums')).toHaveAccessibleName('Folder Sums, level 1, 2 rows')
  })
})
