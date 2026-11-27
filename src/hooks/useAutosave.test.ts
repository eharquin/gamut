import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_DOCUMENT_KEY } from '../document/documentStorage'
import { expressionDocument, type ExpressionDocument } from '../document/expressionDocument'
import { useAutosave, type AutosaveOptions } from './useAutosave'

beforeEach(() => {
  // The document is saved outside the test mode only.
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

const doc = (source: string): ExpressionDocument => expressionDocument([{ id: 'a', source }], {}, { id: 'autosave', title: 'Autosave' })

function setup(documentDiagnostic: string | null) {
  const setDocumentDiagnostic = vi.fn()
  const initial = doc('a = 1')
  const options = (document: ExpressionDocument, diagnostic: string | null): AutosaveOptions => ({
    document, initialDocument: initial, holdStored: null, ephemeral: false, theme: 'light',
    resolvedStyles: undefined, resolvedOrientation: undefined, documentDiagnostic: diagnostic, setDocumentDiagnostic,
  })
  const hook = renderHook(({ document, diagnostic }) => useAutosave(options(document, diagnostic)),
    { initialProps: { document: initial, diagnostic: documentDiagnostic } })
  return { ...hook, setDocumentDiagnostic, initial }
}

describe('autosave (#173)', () => {
  it('saves each change without a state update when no diagnostic is shown (#368)', () => {
    const { rerender, setDocumentDiagnostic } = setup(null)
    for (let move = 2; move <= 5; move += 1) rerender({ document: doc(`a = ${move}`), diagnostic: null })
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('a = 5')
    expect(setDocumentDiagnostic).not.toHaveBeenCalled()
  })

  it('clears a shown diagnostic once a write succeeds, but keeps an unsupported view', () => {
    const cleared = setup('STORE_WRITE_FAILED: Changes remain open, but the last saved revision was retained.')
    cleared.rerender({ document: doc('a = 2'), diagnostic: 'STORE_WRITE_FAILED: Changes remain open, but the last saved revision was retained.' })
    expect(cleared.setDocumentDiagnostic).toHaveBeenLastCalledWith(null)
    cleanup()
    const kept = setup('DOCUMENT_VIEW_UNSUPPORTED: kept')
    kept.rerender({ document: doc('a = 2'), diagnostic: 'DOCUMENT_VIEW_UNSUPPORTED: kept' })
    expect(kept.setDocumentDiagnostic).not.toHaveBeenCalled()
  })

  it('does not write again, nor clear it, when only the diagnostic changes', () => {
    const { rerender, setDocumentDiagnostic, initial } = setup(null)
    window.localStorage.removeItem(ACTIVE_DOCUMENT_KEY)
    rerender({ document: initial, diagnostic: 'COMMAND_INVALID: refused' })
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBeNull()
    expect(setDocumentDiagnostic).not.toHaveBeenCalled()
  })
})
