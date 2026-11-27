import { cleanup, renderHook } from '@testing-library/react'
import { useCallback, useState, type SetStateAction } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_DOCUMENT_KEY } from '../document/documentStorage'
import { expressionDocument, type ExpressionDocument } from '../document/expressionDocument'
import { useAutosave } from './useAutosave'

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

/** The hook with a real diagnostic state, and a count of the updates it schedules. */
function setup(initialDiagnostic: string | null) {
  const initial = doc('a = 1')
  const updates = { count: 0 }
  const hook = renderHook(({ document, shown }) => {
    const [documentDiagnostic, setState] = useState<string | null>(initialDiagnostic)
    const [lastShown, setLastShown] = useState(shown)
    // Another part of the editor sets a diagnostic, as the history does for a refused command.
    if (shown !== lastShown) { setLastShown(shown); setState(shown) }
    // Stable, as the state setter of the editor is.
    const setDocumentDiagnostic = useCallback((next: SetStateAction<string | null>) => { updates.count += 1; setState(next) }, [])
    useAutosave({
      document, initialDocument: initial, holdStored: null, ephemeral: false, theme: 'light',
      resolvedStyles: undefined, resolvedOrientation: undefined, documentDiagnostic,
      setDocumentDiagnostic,
    })
    return documentDiagnostic
  }, { initialProps: { document: initial, shown: initialDiagnostic } })
  return { ...hook, updates, initial }
}

describe('autosave (#173)', () => {
  it('saves each change without a state update when no diagnostic is shown (#368)', () => {
    const { rerender, updates } = setup(null)
    updates.count = 0
    for (let move = 2; move <= 5; move += 1) rerender({ document: doc(`a = ${move}`), shown: null })
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toContain('a = 5')
    expect(updates.count).toBe(0)
  })

  it('clears a shown diagnostic once a write succeeds, but keeps an unsupported view', () => {
    const failed = 'STORE_WRITE_FAILED: Changes remain open, but the last saved revision was retained.'
    const cleared = setup(failed)
    cleared.rerender({ document: doc('a = 2'), shown: failed })
    expect(cleared.result.current).toBeNull()
    cleanup()
    const kept = setup('DOCUMENT_VIEW_UNSUPPORTED: kept')
    kept.rerender({ document: doc('a = 2'), shown: 'DOCUMENT_VIEW_UNSUPPORTED: kept' })
    expect(kept.result.current).toBe('DOCUMENT_VIEW_UNSUPPORTED: kept')
  })

  it('does not write again, nor clear it, when only the diagnostic changes', () => {
    const { rerender, result, updates, initial } = setup(null)
    window.localStorage.removeItem(ACTIVE_DOCUMENT_KEY)
    updates.count = 0
    rerender({ document: initial, shown: 'COMMAND_INVALID: refused' })
    expect(result.current).toBe('COMMAND_INVALID: refused')
    expect(window.localStorage.getItem(ACTIVE_DOCUMENT_KEY)).toBeNull()
    expect(updates.count).toBe(0)
  })
})
