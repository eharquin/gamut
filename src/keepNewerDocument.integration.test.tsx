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

describe('a stored document this version cannot read (#275)', () => {
  it('is neither saved over on load nor lost after an edit', async () => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, newer)
    render(<App />)
    await waitFor(() => expect(screen.getByText(/DOCUMENT_FORMAT_VERSION: .*It was kept/)).toBeInTheDocument())
    // Opening and leaving the page writes nothing over the stored document.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(newer)
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBe(newer)

    // An edit saves the open graph; the stored one stays kept.
    fireEvent.change(expression(1), { target: { value: 'b = 2' } })
    await waitFor(() => expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).not.toBe(newer))
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBe(newer)
  })

  it('is never saved over when it cannot be kept', async () => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, newer)
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, 'another graph, not yet recovered')
    render(<App />)
    await waitFor(() => expect(screen.getByText(/It was left as it is/)).toBeInTheDocument())
    fireEvent.change(expression(1), { target: { value: 'b = 2' } })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBe(newer)
  })

  it('goes to My library when a version that reads it opens', async () => {
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, serializeCanonicalDocument(current))
    render(<App />)
    await waitFor(() => expect(screen.getByText(/“Later graph”, which an earlier version of GAMUT could not open, was added to My library\./)).toBeInTheDocument())
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull()
    expect(window.localStorage.getItem(LIBRARY_INDEX_KEY)).toContain('Later graph')
  })

  it('is forgotten when it is the stored document, restored here', async () => {
    const source = serializeCanonicalDocument(current)
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, source)
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, source)
    render(<App />)
    await waitFor(() => expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBeNull())
    expect(window.localStorage.getItem(LIBRARY_INDEX_KEY) ?? '').not.toContain('(2)')
  })

  it('stays kept when this version cannot read it either', async () => {
    window.localStorage.setItem(KEPT_DOCUMENT_KEY, newer)
    render(<App />)
    await waitFor(() => expect(expression(1)).toBeInTheDocument())
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(window.localStorage.getItem(KEPT_DOCUMENT_KEY)).toBe(newer)
  })
})
