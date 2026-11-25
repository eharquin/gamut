import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { evaluateDocument } from '../application/evaluateDocument'
import type { EvaluationContext } from '../application/evaluateSource'
import {
  anchorTargets,
  gestureLabel,
  lineCoefficients,
  linePrimitive,
  manipulationEdit,
  projectOnLine,
  type DragTargets,
  type ManipulationContext,
  type ManipulationKind,
} from '../application/viewportManipulation'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type { ExpressionDocument } from '../document/expressionDocument'
import type { Point2d } from '../geometry/interpretation'
import { declaredName } from '../language/declaredName'
import { directPositionAnchorReference } from '../language/directVectorEdit'
import {
  anchorKey,
  findAnchorCandidates,
  nearbyAnchors,
  rearmAnchors,
  selectAnchor,
  type AnchorCandidate,
  type AnchorProximity,
} from '../visualization/anchoring'
import { lineNormalLength, type RenderedPrimitive } from '../visualization/layout'
import { keyboardManipulationStep, toMathematical, type Viewport2d } from '../visualization/viewport'
import { formatViewportCoordinate } from '../visualization/viewportCreation'

/** How far, in CSS pixels, a pressed handle must move before its drag starts. */
const DRAG_DEAD_ZONE = 3

export type ManipulationOptions = Readonly<{
  document: ExpressionDocument
  evaluationContext: EvaluationContext
  rendered: readonly RenderedPrimitive[]
  context: ManipulationContext
  targets: DragTargets
  viewport: Viewport2d
  /** The scale objects are drawn at, which sizes a line's normal handle. */
  objectRenderScale: number
  svgRef: RefObject<SVGSVGElement | null>
  screenPoint: (clientX: number, clientY: number) => Point2d
  guardGestureSelection: (kind: 'manipulate' | 'pan') => void
  beginDrag: (itemId: string) => void
  endDrag: () => void
  executeCommand: (command: DocumentCommand) => void
  dispatchHistory: (action: HistoryAction) => void
  announce: (message: string) => void
}>

/**
 * Direct manipulation of objects on the canvas (#173): pointer drags of
 * handles with anchoring of a base, the keyboard on a focused handle, the
 * selected line and its normal, and Escape. The edits come from
 * `application/viewportManipulation`; one gesture is one history step.
 */
export function useManipulation(options: ManipulationOptions) {
  const {
    document: expressionDoc,
    evaluationContext,
    rendered: renderedPrimitives,
    context: manipulationContext,
    targets,
    viewport,
    objectRenderScale,
    svgRef: viewportSvgRef,
    screenPoint,
    guardGestureSelection,
    executeCommand,
    dispatchHistory,
    announce: setViewportAnnouncement,
  } = options
  const objectSelection = { beginDrag: options.beginDrag, endDrag: options.endDrag }
  const manipulationDrag = useRef<Readonly<{
    itemId: string
    kind: ManipulationKind
    pointerId: number
    /** Where the press was, in client pixels, until the pointer has moved past the dead zone. */
    press: Readonly<{ x: number; y: number }> | null
    /** Anchors a base drag started on, not taken until the pointer leaves them (#100). */
    disarmedAnchors: ReadonlySet<string>
  }> | null>(null)
  /** Where a line translation started, so each move is measured from the press. */
  const lineDragOrigin = useRef<Readonly<{
    point: Point2d
    anchor: Point2d
    coefficients: readonly [number, number, number]
  }> | null>(null)
  /** The selected line and the anchor its normal handle is drawn from. */
  const [selectedLine, setSelectedLine] = useState<Readonly<{ itemId: string; anchor: Point2d }> | null>(null)
  const anchorValidityCache = useRef(new Map<string, boolean>())
  const [anchorPreview, setAnchorPreview] = useState<AnchorCandidate | null>(null)
  /** Moves an item's handle to `point`; returns where a weighted point is now drawn. */
  const updateManipulatedItem = (
    itemId: string,
    kind: ManipulationKind,
    point: Readonly<{ x: number; y: number }>,
  ): Point2d | undefined => {
    const item = expressionDoc.items.find((candidate) => candidate.id === itemId)
    const rendered = renderedPrimitives.find((candidate) => candidate.id === itemId)
    if (!item || !rendered) return
    const edit = manipulationEdit(manipulationContext, targets, {
      item, rendered, kind, point, lineDrag: lineDragOrigin.current, selectedLine,
    })
    if (edit.selectedLineAnchor) setSelectedLine({ itemId, anchor: edit.selectedLineAnchor })
    edit.commands.forEach((command) => executeCommand(command))
    return edit.drawn
  }
  /** Where the anchors of a base drag are measured from, in CSS pixels. */
  const anchorProximity = (draggedId: string, pointer: Point2d): AnchorProximity => {
    const rectangle = viewportSvgRef.current?.getBoundingClientRect()
    const cssScaleX = rectangle && rectangle.width > 0 ? rectangle.width / viewport.width : 1
    const cssScaleY = rectangle && rectangle.height > 0 ? rectangle.height / viewport.height : 1
    return {
      draggedId,
      rendered: renderedPrimitives,
      viewport,
      pointer,
      cssScale: { x: cssScaleX, y: cssScaleY },
      nameOf: (itemId) => {
        const targetItem = expressionDoc.items.find((item) => item.id === itemId)
        return targetItem ? declaredName(targetItem.source) : null
      },
    }
  }
  const beginManipulation = (
    event: ReactPointerEvent<SVGElement>,
    itemId: string,
    kind: ManipulationKind,
  ) => {
    if (event.button !== 0) return
    event.stopPropagation()
    // The default pointerdown action is kept: it is what lets the browser
    // treat the resulting focus as pointer-driven and withhold the focus
    // ring. Selection is prevented by user-select on the canvas instead.
    event.currentTarget.setPointerCapture?.(event.pointerId)
    guardGestureSelection('manipulate')
    const disarmedAnchors = kind === 'base'
      ? new Set(nearbyAnchors(anchorProximity(itemId, screenPoint(event.clientX, event.clientY)))
          .map(anchorKey))
      : new Set<string>()
    manipulationDrag.current = {
      itemId, kind, pointerId: event.pointerId,
      press: { x: event.clientX, y: event.clientY },
      disarmedAnchors,
    }
    objectSelection.beginDrag(itemId)
    anchorValidityCache.current.clear()
    if (kind === 'line') {
      const line = linePrimitive(renderedPrimitives.find((candidate) => candidate.id === itemId))
      const point = toMathematical(viewport, screenPoint(event.clientX, event.clientY))
      if (line) {
        // A press selects the line and anchors its normal at the pressed
        // point projected onto the line.
        const anchor = projectOnLine(line, point)
        lineDragOrigin.current = { point, anchor, coefficients: lineCoefficients(line) }
        setSelectedLine({ itemId, anchor })
      }
    }
    dispatchHistory({ type: 'boundary' })
    dispatchHistory({ type: 'begin-transaction' })
    setViewportAnnouncement(`${gestureLabel(kind)} drag started.`)
  }
  const manipulateWithKeyboard = (
    event: KeyboardEvent<SVGElement>,
    itemId: string,
    kind: ManipulationKind,
    current: Readonly<{ x: number; y: number }>,
  ) => {
    const keyboardOrigin = { kind: 'viewport', handleKey: `${itemId}:${kind}` } as const
    if (kind === 'line' && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      setSelectedLine((selected) => (selected?.itemId === itemId ? null : { itemId, anchor: current }))
      setViewportAnnouncement(selectedLine?.itemId === itemId ? 'Line normal hidden.' : 'Line normal shown; move its head to rotate the line.')
      return
    }
    if (kind === 'base' && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      const item = expressionDoc.items.find((candidate) => candidate.id === itemId)
      if (!item) return
      const currentReference = item.positionSource
        ? directPositionAnchorReference(item.positionSource)
        : null
      const candidates = anchorTargets(renderedPrimitives, expressionDoc.items, itemId)
      const currentIndex = candidates.findIndex((candidate) =>
        candidate.name === currentReference?.name &&
        candidate.property === currentReference.property)
      const ordered = candidates.length === 0 ? [] : candidates.map((_, offset) =>
        candidates[(currentIndex + 1 + offset) % candidates.length])
      const next = ordered.find((candidate) => {
        const positionSource = `${candidate.name}.${candidate.property}`
        const proposed = {
          ...expressionDoc,
          items: expressionDoc.items.map((entry) => entry.id === itemId
            ? { ...entry, positionSource }
            : entry),
        }
        return evaluateDocument(proposed, evaluationContext).find(
          (result) => result.item.id === itemId,
        )?.positionEvaluation?.status === 'valid'
      })
      if (!next) {
        setViewportAnnouncement('No valid anchor target is available.')
        return
      }
      dispatchHistory({ type: 'boundary' })
      dispatchHistory({ type: 'begin-transaction' })
      executeCommand({
        kind: 'update-position', itemId,
        positionSource: `${next.name}.${next.property}`,
      })
      dispatchHistory({ type: 'commit-transaction', origin: keyboardOrigin })
      setViewportAnnouncement(`Object base linked to ${next.name} ${next.property}.`)
      return
    }
    if (kind === 'base' && (event.key === 'Delete' || event.key === 'Backspace')) {
      const item = expressionDoc.items.find((candidate) => candidate.id === itemId)
      if (!item?.positionSource || !directPositionAnchorReference(item.positionSource)) return
      event.preventDefault()
      event.stopPropagation()
      dispatchHistory({ type: 'boundary' })
      dispatchHistory({ type: 'begin-transaction' })
      updateManipulatedItem(itemId, kind, current)
      dispatchHistory({ type: 'commit-transaction', origin: keyboardOrigin })
      setViewportAnnouncement('Object base unlinked and kept at its resolved position.')
      return
    }
    const step = keyboardManipulationStep(viewport.pixelsPerUnit, event.shiftKey)
    const delta = event.key === 'ArrowLeft' ? { x: -step, y: 0 }
      : event.key === 'ArrowRight' ? { x: step, y: 0 }
        : event.key === 'ArrowUp' ? { x: 0, y: step }
          : event.key === 'ArrowDown' ? { x: 0, y: -step }
            : null
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    dispatchHistory({ type: 'boundary' })
    dispatchHistory({ type: 'begin-transaction' })
    if (kind === 'line') {
      const line = linePrimitive(renderedPrimitives.find((candidate) => candidate.id === itemId))
      if (line) lineDragOrigin.current = { point: current, anchor: current, coefficients: lineCoefficients(line) }
    }
    const target = kind === 'normal'
      // Nudge the normal handle's head, then the update renormalizes it.
      ? (() => {
          const normal = linePrimitive(renderedPrimitives.find((candidate) => candidate.id === itemId))?.normal ?? { x: 1, y: 0 }
          const length = lineNormalLength(viewport, objectRenderScale)
          return { x: current.x + normal.x * length + delta.x, y: current.y + normal.y * length + delta.y }
        })()
      : { x: current.x + delta.x, y: current.y + delta.y }
    // A weighted point is drawn where its rounded coordinates put it.
    const moved = updateManipulatedItem(itemId, kind, target) ?? target
    dispatchHistory({ type: 'commit-transaction', origin: keyboardOrigin })
    setViewportAnnouncement(kind === 'normal'
      ? `${gestureLabel(kind)} rotated.`
      : `${gestureLabel(kind)} moved to ${
          formatViewportCoordinate(moved.x, viewport.pixelsPerUnit)}, ${
          formatViewportCoordinate(moved.y, viewport.pixelsPerUnit)}.`)
  }
  /** Moves a manipulated object; false when the pointer drives no manipulation. */
  const movePointer = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    const pressed = manipulationDrag.current
    if (pressed?.pointerId === event.pointerId) {
      // A press that has not yet moved past the dead zone is a click: it
      // writes nothing, so it cannot unlink a base or nudge an object.
      if (pressed.press && Math.hypot(
        event.clientX - pressed.press.x,
        event.clientY - pressed.press.y,
      ) < DRAG_DEAD_ZONE) return true
      const manipulation = pressed.press ? { ...pressed, press: null } : pressed
      manipulationDrag.current = manipulation
      const pointer = screenPoint(event.clientX, event.clientY)
      if (manipulation.kind === 'base') {
        const proximity = anchorProximity(manipulation.itemId, pointer)
        const disarmedAnchors = rearmAnchors(manipulation.disarmedAnchors, nearbyAnchors(proximity))
        if (disarmedAnchors !== manipulation.disarmedAnchors)
          manipulationDrag.current = { ...manipulation, disarmedAnchors }
        const candidates = findAnchorCandidates({
          ...proximity,
          disarmed: disarmedAnchors,
          isValid: (candidate) => {
            const key = `${manipulation.itemId}:${candidate.targetId}:${candidate.property}`
            const cached = anchorValidityCache.current.get(key)
            if (cached !== undefined) return cached
            const positionSource = `${candidate.targetName}.${candidate.property}`
            const proposed = {
              ...expressionDoc,
              items: expressionDoc.items.map((item) => item.id === manipulation.itemId
                ? { ...item, positionSource }
                : item),
            }
            const valid = evaluateDocument(proposed, evaluationContext).find(
              (result) => result.item.id === manipulation.itemId,
            )?.positionEvaluation?.status === 'valid'
            anchorValidityCache.current.set(key, valid)
            return valid
          },
        })
        const candidate = selectAnchor(
          candidates,
          anchorPreview?.draggedId === manipulation.itemId ? anchorPreview : null,
        )
        setAnchorPreview(candidate)
        updateManipulatedItem(
          manipulation.itemId,
          manipulation.kind,
          candidate?.mathematical ?? toMathematical(viewport, pointer),
        )
        return true
      }
      setAnchorPreview(null)
      updateManipulatedItem(
        manipulation.itemId,
        manipulation.kind,
        toMathematical(viewport, pointer),
      )
      return true
    }
    return false
  }
  // A pointer gesture leaves nothing selected: the handle gives focus back
  // to the canvas so arrow keys pan and hover indicators stay pointer-only.
  // Keyboard users reach handles with Tab as before.
  const finishManipulation = (outcome: 'commit' | 'cancel') => {
    manipulationDrag.current = null
    objectSelection.endDrag()
    anchorValidityCache.current.clear()
    setAnchorPreview(null)
    dispatchHistory(outcome === 'commit'
      ? { type: 'commit-transaction', origin: { kind: 'viewport', handleKey: null } }
      : { type: 'cancel-transaction' })
    viewportSvgRef.current?.focus({ preventScroll: true })
  }
  const endPointer = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    const manipulation = manipulationDrag.current
    if (manipulation?.pointerId === event.pointerId) {
      const preview = anchorPreview?.draggedId === manipulation.itemId
        ? anchorPreview
        : null
      if (preview) {
        const positionSource = `${preview.targetName}.${preview.property}`
        const candidateDocument = {
          ...expressionDoc,
          items: expressionDoc.items.map((item) => item.id === manipulation.itemId
            ? { ...item, positionSource }
            : item),
        }
        const candidate = evaluateDocument(candidateDocument, evaluationContext).find(
          (result) => result.item.id === manipulation.itemId,
        )
        if (candidate?.positionEvaluation?.status === 'valid') {
          executeCommand({
            kind: 'update-position', itemId: manipulation.itemId, positionSource,
          })
          setViewportAnnouncement(
            `Object base linked to ${preview.targetName} ${preview.property}.`,
          )
        } else {
          setViewportAnnouncement('Anchor link refused because it would be invalid.')
          finishManipulation('cancel')
          return true
        }
      } else {
        setViewportAnnouncement('Object manipulation committed.')
      }
      finishManipulation('commit')
      return true
    }
    return false
  }
  const cancelPointer = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (manipulationDrag.current?.pointerId === event.pointerId) {
      finishManipulation('cancel')
      setViewportAnnouncement('Object manipulation cancelled.')
      return true
    }
    return false
  }
  const loseCapture = (): boolean => {
    if (manipulationDrag.current) {
      finishManipulation('cancel')
      setViewportAnnouncement('Object manipulation cancelled.')
      return true
    }
    return false
  }

  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (!manipulationDrag.current) {
        // Outside a gesture, Escape drops the line selection and its normal.
        setSelectedLine((selected) => (selected ? null : selected))
        return
      }
      event.preventDefault()
      manipulationDrag.current = null
      anchorValidityCache.current.clear()
      setAnchorPreview(null)
      dispatchHistory({ type: 'cancel-transaction' })
      viewportSvgRef.current?.focus({ preventScroll: true })
      setViewportAnnouncement('Object manipulation cancelled.')
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [dispatchHistory, setViewportAnnouncement, viewportSvgRef])

  return {
    selectedLine,
    anchorPreview,
    beginManipulation,
    manipulateWithKeyboard,
    movePointer,
    endPointer,
    cancelPointer,
    loseCapture,
    /** Drops the line selection, as a press on the canvas does. */
    deselectLine: () => setSelectedLine(null),
    /** Forgets the line selection and the anchor preview, as when the canvas goes. */
    forget: () => {
      setSelectedLine(null)
      setAnchorPreview(null)
    },
  }
}
