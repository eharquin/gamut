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
    await waitFor(() => expect(stored().folders).toEqual([{ path: ['Sums'], collapsed: true }]))

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
