import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  LIBRARY_DEFAULT_WIDTH,
  LIBRARY_MIN_WIDTH,
  LIBRARY_WIDTH_STORAGE_KEY,
} from './components/LibraryPanel'

/**
 * The library as a gallery docked on the right (STORE-014): its width, which
 * its left edge widens, a search over names and descriptions, and the ⋯
 * groups that hold the library's and each card's further actions.
 */

beforeEach(() => {
  // Browser storage is used outside the test mode only.
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

const panel = () => screen.getByRole('region', { name: 'Library' })
const openLibrary = () => {
  if (!screen.queryByRole('region', { name: 'Library' })) fireEvent.click(screen.getByRole('button', { name: 'Library' }))
  return panel()
}
const saveAs = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: /^Save( \(unsaved changes\))?$/ }))
  fireEvent.change(within(panel()).getByRole('textbox', { name: 'Graph name' }), { target: { value: name } })
  fireEvent.click(within(panel()).getByRole('button', { name: 'Save' }))
}
const width = () => panel().style.getPropertyValue('--library-width')
const edge = () => within(panel()).getByRole('separator', { name: 'Resize library panel' })

describe('library gallery (STORE-014)', () => {
  it('opens 420 px wide, widens to the left from its edge, and remembers its width', () => {
    render(<App />)
    openLibrary()
    expect(width()).toBe(`${LIBRARY_DEFAULT_WIDTH}px`)
    expect(edge()).toHaveAttribute('aria-valuenow', String(LIBRARY_DEFAULT_WIDTH))

    // The left arrow moves the edge to the left, so the panel grows.
    fireEvent.keyDown(edge(), { key: 'ArrowLeft' })
    expect(width()).toBe('440px')
    fireEvent.keyDown(edge(), { key: 'ArrowLeft', shiftKey: true })
    expect(width()).toBe('520px')
    fireEvent.keyDown(edge(), { key: 'ArrowRight' })
    expect(width()).toBe('500px')
    expect(window.localStorage.getItem(LIBRARY_WIDTH_STORAGE_KEY)).toBe('500')

    // A drag of the edge 100 px to the left widens it as much.
    fireEvent.pointerDown(edge(), { pointerId: 1, button: 0, clientX: 800 })
    fireEvent.pointerMove(edge(), { pointerId: 1, clientX: 700 })
    fireEvent.pointerUp(edge(), { pointerId: 1, clientX: 700 })
    expect(width()).toBe('600px')

    // Kept by this browser across a reload.
    cleanup()
    render(<App />)
    openLibrary()
    expect(width()).toBe('600px')

    // Never narrower than the minimum; a double-click restores the default.
    fireEvent.keyDown(edge(), { key: 'Home' })
    expect(width()).toBe(`${LIBRARY_MIN_WIDTH}px`)
    fireEvent.doubleClick(edge())
    expect(width()).toBe(`${LIBRARY_DEFAULT_WIDTH}px`)
    expect(window.localStorage.getItem(LIBRARY_WIDTH_STORAGE_KEY)).toBeNull()
  })

  it('searches the graphs by name and the examples by name or description', () => {
    render(<App />)
    saveAs('Rotation talk')
    const library = openLibrary()
    fireEvent.click(within(library).getByRole('button', { name: 'More library actions' }))
    fireEvent.click(within(library).getByRole('button', { name: 'Save as new graph…' }))
    fireEvent.change(within(library).getByRole('textbox', { name: 'Graph name' }), { target: { value: 'Reflections draft' } })
    fireEvent.click(within(library).getByRole('button', { name: 'Save' }))
    // Saving closes the panel; it opens again on the two graphs.
    const gallery = () => openLibrary()
    const search = within(gallery()).getByRole('searchbox', { name: 'Search my library' })
    fireEvent.change(search, { target: { value: 'ROTATION' } })
    expect(within(gallery()).getByRole('button', { name: 'Open Rotation talk' })).toBeInTheDocument()
    expect(within(gallery()).queryByRole('button', { name: 'Open Reflections draft' })).toBeNull()
    fireEvent.change(search, { target: { value: 'nothing like it' } })
    expect(within(gallery()).getByText('No saved graph matches “nothing like it”.')).toBeInTheDocument()

    fireEvent.click(within(gallery()).getByRole('tab', { name: 'Examples' }))
    const examples = within(gallery()).getByRole('searchbox', { name: 'Search the examples' })
    // The search is shared by both sections; a description matches too.
    fireEvent.change(examples, { target: { value: 'perspective' } })
    expect(within(gallery()).getByRole('button', { name: "Open example Desargues' theorem" })).toBeInTheDocument()
    expect(within(gallery()).queryByRole('button', { name: 'Open example Points and lines' })).toBeNull()
  })

  it('holds the library commands and the card actions behind ⋯ buttons, closed by Escape alone', () => {
    render(<App />)
    saveAs('Rotation talk')
    const library = openLibrary()
    expect(within(library).queryByRole('button', { name: 'Export library' })).toBeNull()

    const more = within(library).getByRole('button', { name: 'More library actions' })
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(library).getByRole('button', { name: 'Export library' })).toBeInTheDocument()
    // Escape closes the group, not the panel, and gives the focus back to its button.
    fireEvent.keyDown(within(library).getByRole('button', { name: 'Export library' }), { key: 'Escape' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveFocus()
    expect(screen.getByRole('region', { name: 'Library' })).toBeInTheDocument()

    const actions = within(library).getByRole('button', { name: 'Actions for Rotation talk' })
    fireEvent.click(actions)
    const group = within(library).getByRole('group', { name: 'Actions for Rotation talk' })
    expect(within(group).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['Rename', 'Duplicate', 'Delete'])
    // Using an action closes the group.
    fireEvent.click(within(group).getByRole('button', { name: 'Rename Rotation talk' }))
    expect(actions).toHaveAttribute('aria-expanded', 'false')
    expect(within(library).getByRole('textbox', { name: 'New name for Rotation talk' })).toBeInTheDocument()

    // A press elsewhere closes an open group.
    fireEvent.click(actions)
    fireEvent.pointerDown(document.body)
    expect(actions).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks the open graph on its card and offers to add an example from its card', () => {
    render(<App />)
    saveAs('Rotation talk')
    const library = openLibrary()
    const open = within(library).getByRole('button', { name: 'Open Rotation talk' })
    expect(open).toHaveAttribute('aria-current', 'true')
    expect(open.querySelector('.library-open-badge')).toHaveTextContent('Open')

    fireEvent.click(within(library).getByRole('tab', { name: 'Examples' }))
    fireEvent.click(within(library).getByRole('button', { name: 'Add Points and lines to my library' }))
    fireEvent.click(within(library).getByRole('tab', { name: 'My library' }))
    expect(within(library).getByRole('button', { name: 'Open Points and lines' })).toBeInTheDocument()
  })
})
