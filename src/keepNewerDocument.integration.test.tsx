import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import { serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY, KEPT_DOCUMENT_KEY } from './document/documentStorage'
import { LIBRARY_INDEX_KEY } from './document/documentLibrary'
import { expressionDocument } from './document/expressionDocument'

const current = toCanonicalDocument(expressionDocument([
  { id: 'a', source: 'A = 3e1 + 4e2' },
], {}, { id: 'later-graph', title: 'Later graph' }), 'light')
// A document as a later version writes it: a format this version refuses.
const newer = JSON.stringify({ ...current, formatVersion: 99 })

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

const expression = (n: number) => screen.getByRole('textbox', { name: `Expression ${n}` })

const pause = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

describe('a stored document this version cannot read (#275)', () => {
  it('is neither saved over on load nor lost after an edit', async () => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, newer)
    render(<App />)
    await waitFor(() => expect(screen.getByText(/DOCUMENT_FORMAT_VERSION: .*Nothing is saved over it until you edit/)).toBeInTheDocument())
    // Opening and leaving the page writes nothing.
    await pause()
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(newer)
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull()

    // An edit keeps the stored graph, then saves the open one.
    fireEvent.change(expression(1), { target: { value: 'b = 2' } })
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).not.toBe(newer))
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBe(newer)
  })

  it('is never saved over when it cannot be kept, and says so', async () => {
    const earlier = JSON.stringify({ ...current, id: 'earlier', formatVersion: 98 })
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, newer)
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, earlier)
    render(<App />)
    await waitFor(() => expect(expression(1)).toBeInTheDocument())
    fireEvent.change(expression(1), { target: { value: 'b = 2' } })
    await waitFor(() => expect(screen.getByText(/STORE_NOT_KEPT: /)).toBeInTheDocument())
    fireEvent.change(expression(1), { target: { value: 'b = 3' } })
    await pause()
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(newer)
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBe(earlier)
  })

  it('is saved over when it is no document at all', async () => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, '{"formatVers')
    render(<App />)
    await waitFor(() => expect(expression(1)).toBeInTheDocument())
    fireEvent.change(expression(1), { target: { value: 'b = 2' } })
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('b = 2'))
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull()
  })

  it('goes to My library when a version that reads it opens', async () => {
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, serializeCanonicalDocument(current))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/“Later graph”, which an earlier version of GAMUT could not open, was added to My library\./)).toBeInTheDocument())
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull()
    expect(window.localStorage.getItem(LIBRARY_INDEX_KEY)).toContain('Later graph')
  })

  it('frees the kept slot before the next unreadable document needs it', async () => {
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, serializeCanonicalDocument(current))
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, newer)
    render(<App />)
    await waitFor(() => expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull())
    fireEvent.change(expression(1), { target: { value: 'b = 2' } })
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('b = 2'))
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBe(newer)
  })

  it('tells both when the restored working copy was migrated too', async () => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, JSON.stringify({ ...current, id: 'old', languageVersion: 1 }))
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, serializeCanonicalDocument(current))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/written by an earlier version of GAMUT.*“Later graph[^”]*”, which an earlier version/)).toBeInTheDocument())
  })

  it('is not added again when My library already holds it as it is', async () => {
    const source = serializeCanonicalDocument(current)
    window.localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify({ version: 1, entries: [] }))
    render(<App />)
    await waitFor(() => expect(expression(1)).toBeInTheDocument())
    cleanup()
    // Store it in the library as the version that wrote it would.
    const { addCopyToLibrary, readLibrary } = await import('./document/documentLibrary')
    const added = addCopyToLibrary(window.localStorage, current, { createId: () => current.id })
    expect(added.id).toBe(current.id)
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, source)
    render(<App />)
    await waitFor(() => expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull())
    expect(readLibrary(window.localStorage).entries.map((entry) => entry.name)).toEqual(['Later graph'])
    expect(screen.queryByText(/could not open, was added/)).not.toBeInTheDocument()
  })

  it('is forgotten when it is the stored document, restored here', async () => {
    const source = serializeCanonicalDocument(current)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, source)
    render(<App />)
    await waitFor(() => expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull())
    expect(screen.queryByText(/could not open, was added/)).not.toBeInTheDocument()
  })

  it('stays kept when this version cannot read it either', async () => {
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, newer)
    render(<App />)
    await waitFor(() => expect(expression(1)).toBeInTheDocument())
    await pause()
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBe(newer)
  })
})
