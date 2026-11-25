import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import { serializeCanonicalDocument, toCanonicalDocument } from './document/canonicalDocument'
import { saveToLibrary, LIBRARY_OPEN_KEY } from './document/documentLibrary'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument } from './document/expressionDocument'

const graph = toCanonicalDocument(expressionDocument([
  { id: 'a', source: 'A = vector(1, 2)' },
], {}, { id: 'stored-graph', title: 'Stored graph' }), 'light')

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

/** The working copy of a library graph, as a reload finds it. */
function storeOpenGraph(openKey: string) {
  saveToLibrary(window.localStorage, graph, 'Stored graph', { boundId: null, createId: () => graph.id })
  window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(graph))
  window.localStorage.setItem(LIBRARY_OPEN_KEY, openKey)
}

describe('reloading the open library graph (#212, #173)', () => {
  it('binds the restored working copy to its library graph, saved and named', async () => {
    storeOpenGraph(graph.id)
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('A = vector(1, 2)'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(document.title).toBe('Stored graph · GAMUT')
  })

  it('leaves it unbound when another graph was open', async () => {
    storeOpenGraph('')
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('A = vector(1, 2)'))
    expect(screen.getByRole('button', { name: 'Save (unsaved changes)' })).toBeInTheDocument()
    expect(document.title).toBe('Untitled · GAMUT')
  })
})
