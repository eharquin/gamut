import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import { isSourceEditor, type SourceEditor } from '../components/sourceEditor'
import type { DocumentHistory, HistoryAction } from '../document/documentHistory'
import type { ExpressionDocument } from '../document/expressionDocument'

/** Where an editor's caret was: the editor, its selection and its direction. */
export type EditorFocus = Readonly<{
  id: string
  start: number
  end: number
  direction: 'forward' | 'backward' | 'none'
}>

export type HistoryFocusOptions = Readonly<{
  history: DocumentHistory
  document: ExpressionDocument
  dispatchHistory: (action: HistoryAction) => void
  inputRefs: MutableRefObject<Map<string, SourceEditor>>
  viewportSvgRef: RefObject<SVGSVGElement | null>
  /** Rows created on the canvas, whose undo gives focus back to the canvas. */
  viewportCreatedItemIds: MutableRefObject<Set<string>>
}>

/**
 * Where focus goes after a change, an undo or a redo (#115, #173): the row a
 * change asked for, the editor and caret the step was made in, a fallback
 * for a row the step removed, or the canvas and handle of a viewport
 * gesture. Undo and redo are offered on Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y.
 */
export function useHistoryFocus({
  history,
  document: expressionDoc,
  dispatchHistory,
  inputRefs,
  viewportSvgRef,
  viewportCreatedItemIds,
}: HistoryFocusOptions) {
  const pendingFocus = useRef<string | null>(null)
  const lastEditorFocus = useRef<EditorFocus | null>(null)
  const pendingHistoryFocus = useRef(lastEditorFocus.current)
  /** Set by an undo or redo that traverses a step, read once the document renders. */
  const pendingTraversal = useRef(false)
  const removedEditorFallbacks = useRef(new Map<string, EditorFocus>())
  const rememberEditorFocus = (element: SourceEditor) => {
    lastEditorFocus.current = {
      id: element.id,
      start: element.selectionStart ?? 0,
      end: element.selectionEnd ?? element.selectionStart ?? 0,
      direction: element.selectionDirection ?? 'none',
    }
  }
  const dispatchHistoryWithFocus = useCallback((type: 'undo' | 'redo') => {
    pendingHistoryFocus.current = lastEditorFocus.current
    pendingTraversal.current = !history.transaction &&
      (type === 'undo' ? history.past.length > 0 : history.future.length > 0)
    dispatchHistory({ type })
  }, [history.past.length, history.future.length, history.transaction, dispatchHistory])

  useEffect(() => {
    const handleHistoryShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      const action = key === 'z'
        ? event.shiftKey ? 'redo' : 'undo'
        : key === 'y' && !event.shiftKey ? 'redo' : null
      if (!action) return
      event.preventDefault()
      dispatchHistoryWithFocus(action)
    }
    window.addEventListener('keydown', handleHistoryShortcut)
    return () => window.removeEventListener('keydown', handleHistoryShortcut)
  }, [dispatchHistoryWithFocus])

  useEffect(() => {
    const id = pendingFocus.current
    if (id) {
      inputRefs.current.get(id)?.focus()
      pendingFocus.current = null
      return
    }
    // Undoing or redoing a viewport gesture keeps focus in the viewport: on
    // the handle a keyboard gesture moved, when it still exists, otherwise on
    // the canvas, as after the gesture itself (#115).
    const traversal = pendingTraversal.current ? history.lastTraversal : null
    pendingTraversal.current = false
    if (traversal?.kind === 'viewport') {
      pendingHistoryFocus.current = null
      const handle = traversal.handleKey === null
        ? undefined
        : [...viewportSvgRef.current?.querySelectorAll('[data-handle-key]') ?? []]
          .find((element) => element.getAttribute('data-handle-key') === traversal.handleKey)
      if (handle instanceof SVGElement) handle.focus({ preventScroll: true })
      else viewportSvgRef.current?.focus({ preventScroll: true })
      return
    }
    const selection = pendingHistoryFocus.current
    if (!selection) return
    pendingHistoryFocus.current = null
    let restoredSelection = selection
    let input = document.getElementById(restoredSelection.id)
    if (!(isSourceEditor(input))) {
      const fallback = removedEditorFallbacks.current.get(selection.id)
      if (fallback) {
        restoredSelection = fallback
        input = document.getElementById(fallback.id)
      }
    }
    if (!(isSourceEditor(input)) &&
        viewportCreatedItemIds.current.has(selection.id.replace('expression-source-', ''))) {
      viewportSvgRef.current?.focus({ preventScroll: true })
      return
    }
    if (!(isSourceEditor(input))) return
    input.focus()
    const maximum = input.value.length
    input.setSelectionRange(
      Math.min(restoredSelection.start, maximum),
      Math.min(restoredSelection.end, maximum),
      restoredSelection.direction,
    )
    rememberEditorFocus(input)
  // The refs are read when the effect runs; only a change of document or
  // traversal moves focus.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expressionDoc, history.lastTraversal])

  return {
    /** The row whose editor takes focus once the document renders. */
    pendingFocus,
    lastEditorFocus,
    /** The editor and caret to restore once a change renders. */
    pendingHistoryFocus,
    /** For a row a step removes, the editor focus falls back to. */
    removedEditorFallbacks,
    rememberEditorFocus,
    dispatchHistoryWithFocus,
  }
}
