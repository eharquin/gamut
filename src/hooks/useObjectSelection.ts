import { useEffect, useRef, useState, type FocusEvent } from 'react'
import type { ExpressionItem } from '../document/expressionDocument'
import type { HandleController } from '../visualization/glyphs'

/** A focusable handle of an object on the canvas. */
export function isHandleElement(target: EventTarget | null): boolean {
  return target instanceof Element && target.hasAttribute('data-handle-key')
}

/**
 * Which object is selected on the canvas, and the hover and focus state of
 * its handles (#173).
 *
 * Where handles coincide, those of the selected object are drawn on top and
 * take the press (#100): the object whose expression row has focus or the
 * pointer, otherwise the last object a pointer manipulated in the viewport.
 * The drawing order is kept for the length of a drag and while a handle has
 * keyboard focus, so that a handle is never moved in the document while it
 * holds pointer capture or focus, which moving it would release.
 */
export function useObjectSelection(items: readonly ExpressionItem[]) {
  const [rowFocusId, setRowFocusId] = useState<string | null>(null)
  const [rowHoverId, setRowHoverId] = useState<string | null>(null)
  const [lastManipulatedId, setLastManipulatedId] = useState<string | null>(null)
  const [dragSelection, setDragSelection] = useState<Readonly<{ itemId: string | null }> | null>(null)
  const [handleFocusSelection, setHandleFocusSelection] =
    useState<Readonly<{ itemId: string | null }> | null>(null)
  const frozenSelection = dragSelection ?? handleFocusSelection
  // A deleted object's row fires neither blur nor pointer leave, so its id is
  // ignored here and cleared once the document has changed.
  const isPresentItem = (itemId: string | null): itemId is string =>
    itemId !== null && items.some((item) => item.id === itemId)
  const selectedObjectId = frozenSelection
    ? frozenSelection.itemId
    : [rowFocusId, rowHoverId, lastManipulatedId].find(isPresentItem) ?? null
  useEffect(() => {
    const present = new Set(items.map((item) => item.id))
    const clearDeleted = (itemId: string | null) =>
      itemId !== null && !present.has(itemId) ? null : itemId
    setRowFocusId(clearDeleted)
    setRowHoverId(clearDeleted)
    setLastManipulatedId(clearDeleted)
    // A focused handle removed with its object fires no blur either.
    if (!isHandleElement(document.activeElement)) setHandleFocusSelection(null)
  }, [items])

  // Keyboard focus on a handle is drawn as an SVG ring rather than a CSS
  // outline, which WebKit fails to repaint when focus moves between SVG
  // elements. The ring follows the input modality at the moment of focus,
  // so a later key press does not turn pointer focus into a ring either.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [focusRingKey, setFocusRingKey] = useState<string | null>(null)
  const inputModality = useRef<'pointer' | 'keyboard'>('pointer')
  useEffect(() => {
    const pointer = () => { inputModality.current = 'pointer' }
    const keyboard = () => { inputModality.current = 'keyboard' }
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', keyboard, true)
    return () => {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', keyboard, true)
    }
  }, [])

  /** The controller the glyphs report hover, focus and presses to. */
  const handleController = (
    pointerDown: HandleController['pointerDown'],
    keyDown: HandleController['keyDown'],
  ): HandleController => ({
    hoveredKey,
    focusRingKey,
    hover: (key) => setHoveredKey(key),
    unhover: (key) => setHoveredKey((current) => current === key ? null : current),
    focus: (key) => {
      setHoveredKey(key)
      setFocusRingKey(inputModality.current === 'keyboard' ? key : null)
    },
    blur: (key) => {
      setHoveredKey((current) => current === key ? null : current)
      setFocusRingKey((current) => current === key ? null : current)
    },
    pointerDown,
    keyDown,
  })

  return {
    selectedObjectId,
    handleController,
    /** The rows report focus and the pointer. */
    row: {
      focus: (itemId: string) => setRowFocusId(itemId),
      blur: (itemId: string) => setRowFocusId((current) => current === itemId ? null : current),
      hover: (itemId: string) => setRowHoverId(itemId),
      leave: (itemId: string) => setRowHoverId((current) => current === itemId ? null : current),
    },
    /** A drag keeps the drawing order it started with, and selects its object afterwards. */
    beginDrag: (itemId: string) => {
      setDragSelection({ itemId: selectedObjectId })
      setLastManipulatedId(itemId)
    },
    endDrag: () => setDragSelection(null),
    /** Focus on a handle keeps the drawing order until it leaves the handles. */
    canvasFocus: (event: FocusEvent<SVGSVGElement>) => {
      if (isHandleElement(event.target))
        setHandleFocusSelection((current) => current ?? { itemId: selectedObjectId })
    },
    canvasBlur: (event: FocusEvent<SVGSVGElement>) => {
      if (isHandleElement(event.target) && !isHandleElement(event.relatedTarget))
        setHandleFocusSelection(null)
    },
  }
}
