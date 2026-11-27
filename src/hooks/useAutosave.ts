import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { UNKEPT_STORED_DOCUMENT } from '../application/restoreActiveDocument'
import { toCanonicalDocument, type ThemeMode } from '../document/canonicalDocument'
import { browserDocumentStorage, keepUnreadableDocument } from '../document/documentStorage'
import type { ExpressionDocument } from '../document/expressionDocument'

export type AutosaveOptions = Readonly<{
  document: ExpressionDocument
  /** The document the editor opened with, which an unread stored one is not saved over for. */
  initialDocument: ExpressionDocument
  /** After a failed restore, how the stored document is protected (#275). */
  holdStored: 'until-edit' | null
  /** A temporary session writes nothing. */
  ephemeral: boolean
  theme: ThemeMode
  resolvedStyles: Parameters<typeof toCanonicalDocument>[2]
  resolvedOrientation: Parameters<typeof toCanonicalDocument>[3]
  /** The diagnostic shown now, which a successful write clears. */
  documentDiagnostic: string | null
  setDocumentDiagnostic: Dispatch<SetStateAction<string | null>>
}>

/**
 * Saves the open document as the active document after every change (#173),
 * except in a temporary session or test mode. A write that fails keeps the
 * last saved revision and says so.
 */
export function useAutosave({
  document: expressionDoc,
  initialDocument,
  holdStored: initialHold,
  ephemeral,
  theme,
  resolvedStyles,
  resolvedOrientation,
  documentDiagnostic,
  setDocumentDiagnostic,
}: AutosaveOptions) {
  // Read by the write without making it a dependency: a new diagnostic is not
  // a reason to write, nor to clear it at once.
  const diagnostic = useRef(documentDiagnostic)
  diagnostic.current = documentDiagnostic
  /**
   * After a failed restore the stored document is not saved over until the
   * graph is edited, then kept first; when it cannot be kept, it is never
   * saved over, and the status says so whenever it is free (#275).
   */
  const holdStored = useRef<'until-edit' | 'always' | null>(initialHold)
  useEffect(() => {
    if (ephemeral || import.meta.env.MODE === 'test') return
    if (holdStored.current === 'until-edit') {
      if (expressionDoc === initialDocument) return
      if (!keepUnreadableDocument(window.localStorage)) {
        holdStored.current = 'always'
        setDocumentDiagnostic(UNKEPT_STORED_DOCUMENT)
        return
      }
      holdStored.current = null
    }
    if (holdStored.current === 'always') {
      if (diagnostic.current === null) setDocumentDiagnostic((current) => current ?? UNKEPT_STORED_DOCUMENT)
      return
    }
    try {
      browserDocumentStorage(window.localStorage).save(toCanonicalDocument(expressionDoc, theme, resolvedStyles, resolvedOrientation))
      // A drag writes on every move: only a change schedules a render (#368).
      const shown = diagnostic.current
      if (shown !== null && !shown.startsWith('DOCUMENT_VIEW_UNSUPPORTED'))
        setDocumentDiagnostic((current) => current?.startsWith('DOCUMENT_VIEW_UNSUPPORTED') ? current : null)
    } catch {
      setDocumentDiagnostic('STORE_WRITE_FAILED: Changes remain open, but the last saved revision was retained.')
    }
  }, [expressionDoc, resolvedStyles, resolvedOrientation, theme, ephemeral, initialDocument, setDocumentDiagnostic])
}
