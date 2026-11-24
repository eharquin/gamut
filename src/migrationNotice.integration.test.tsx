/// <reference types="node" />
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import App from './App'
import { serializeCanonicalDocument, toCanonicalDocument, type CanonicalDocument } from './document/canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'
import { expressionDocument } from './document/expressionDocument'

const current = toCanonicalDocument(expressionDocument([
  { id: 'a', source: 'A = 3e1 + 4e2' },
  { id: 'd', source: 'd = A.norm' },
], {}, { id: 'old-graph', title: 'Old graph' }), 'light')
const version1 = { ...current, languageVersion: 1 } as unknown as CanonicalDocument
const NOTICE = /written by an earlier version of GAMUT \(format 13, language 1\).*: d\./

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
  window.history.replaceState(null, '', '/')
})

function importFile(content: string) {
  const file = new File([content], 'graph.gamut.json', { type: 'application/json' })
  fireEvent.change(screen.getByLabelText('Import document file'), { target: { files: [file] } })
}

describe('telling the reader that a graph was migrated (#343)', () => {
  it('says so when an imported file was written by an earlier version, and not otherwise', async () => {
    render(<App />)
    importFile(JSON.stringify(version1))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('d = norm(A)'))
    expect(screen.getByText(NOTICE)).toBeInTheDocument()

    // A current graph opened next withdraws the notice, which described the old one.
    importFile(serializeCanonicalDocument({ ...current, id: 'current-graph', items: [current.items[0], { ...current.items[1], source: 'e = 1' }] }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('e = 1'))
    expect(screen.queryByText(/written by an earlier version/)).not.toBeInTheDocument()
  })

  it('says so when the working copy an earlier version autosaved is restored', async () => {
    window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, JSON.stringify(version1))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('d = norm(A)'))
    await waitFor(() => expect(screen.getByText(NOTICE)).toBeInTheDocument())
  })

  it('says so when a scene link was written by an earlier version', async () => {
    // A link as an earlier version wrote it: the JSON encoding, unvalidated here.
    const json = Buffer.from(JSON.stringify(version1))
    const fragment = `#scene=1.json.${createHash('sha256').update(json).digest('hex')}.${json.toString('base64url')}`
    window.history.replaceState(null, '', '/' + fragment)
    render(<App />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 2' })).toHaveValue('d = norm(A)'))
    await waitFor(() => expect(screen.getByText(NOTICE)).toBeInTheDocument())
  })
})
