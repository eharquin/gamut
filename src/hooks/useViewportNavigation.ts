import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { DEFAULT_PIXELS_PER_UNIT, panByScreen, zoomAt, type Viewport2d } from '../visualization/viewport'

export type ViewportNavigationOptions = Readonly<{
  viewport: Viewport2d
  /** A locked viewport neither pans nor zooms (VIEW2D-004). */
  locked: boolean
  updateViewport: (next: Viewport2d) => void
  announce: (message: string) => void
  /** The canvas, which the hook attaches its wheel listener to. */
  svgRef: RefObject<SVGSVGElement | null>
}>

/**
 * Navigation of the two-dimensional viewport (#173): pan by pointer and
 * keyboard, zoom by wheel, buttons and keys, recentering and reset, and the
 * guard that keeps a canvas gesture from selecting text.
 */
export function useViewportNavigation({ viewport, locked, updateViewport, announce, svgRef }: ViewportNavigationOptions) {
  const pan = useRef<Readonly<{
    pointerId: number
    lastX: number
    lastY: number
    start: Viewport2d
  }> | null>(null)
  const wheelHandler = useRef<((event: WheelEvent) => void) | null>(null)

  /** A client point in viewport pixels; the centre when the canvas has no box. */
  const screenPoint = (clientX: number, clientY: number) => {
    const rectangle = svgRef.current?.getBoundingClientRect()
    if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0)
      return { x: viewport.width / 2, y: viewport.height / 2 }
    return {
      x: (clientX - rectangle.left) * viewport.width / rectangle.width,
      y: (clientY - rectangle.top) * viewport.height / rectangle.height,
    }
  }
  const zoom = (factor: number, anchor = { x: viewport.width / 2, y: viewport.height / 2 }) =>
    updateViewport(zoomAt(viewport, anchor, viewport.pixelsPerUnit * factor))
  // Recentering keeps the scale; Home, or recentering then typing 100 %,
  // restores the documented view (VIEW2D-003).
  const recenter = () => {
    updateViewport({ ...viewport, centerX: 0, centerY: 0 })
    announce('View recentered on the origin.')
  }
  const reset = () => {
    updateViewport({
      ...viewport, centerX: 0, centerY: 0, pixelsPerUnit: DEFAULT_PIXELS_PER_UNIT,
    })
    announce('View reset to the origin at 100%.')
  }
  wheelHandler.current = (event: WheelEvent) => {
    event.preventDefault()
    if (locked) return
    zoom(Math.exp(-event.deltaY * 0.0015), screenPoint(event.clientX, event.clientY))
  }
  // React registers wheel listeners as passive, which silently discards
  // preventDefault and lets the browser page-zoom on Ctrl+wheel or pinch; the
  // listener is attached natively so it can be non-passive.
  const attachSvg = useCallback((svg: SVGSVGElement | null) => {
    svgRef.current = svg
    if (!svg) return
    const onWheel = (event: WheelEvent) => wheelHandler.current?.(event)
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [svgRef])

  // Safari extends a selection started on the canvas into any selectable
  // text the pointer crosses, and form controls ignore an inherited
  // user-select, so while a button is held the class also removes the
  // panels from hit-testing and any selection start is cancelled. Released
  // on pointerup or pointercancel anywhere.
  // The gesture kind also fixes the cursor: browsers that hit-test under the
  // pointer during capture would otherwise show the arrow over the panels.
  const guardGestureSelection = (kind: 'manipulate' | 'pan') =>
    document.body.classList.add('canvas-gesture', `canvas-gesture-${kind}`)
  useEffect(() => {
    const release = () => document.body.classList.remove(
      'canvas-gesture', 'canvas-gesture-manipulate', 'canvas-gesture-pan',
    )
    const cancelSelection = (event: Event) => {
      if (document.body.classList.contains('canvas-gesture')) event.preventDefault()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    document.addEventListener('selectstart', cancelSelection, true)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      document.removeEventListener('selectstart', cancelSelection, true)
      release()
    }
  }, [])

  /** Starts a pan when the canvas itself is pressed with the main button. */
  const beginPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (locked || event.button !== 0 || event.target !== event.currentTarget) return
    event.currentTarget.focus({ preventScroll: true })
    guardGestureSelection('pan')
    pan.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      start: viewport,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const movePan = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = pan.current
    if (!current || current.pointerId !== event.pointerId) return
    const rectangle = event.currentTarget.getBoundingClientRect()
    const scaleX = rectangle.width > 0 ? viewport.width / rectangle.width : 1
    const scaleY = rectangle.height > 0 ? viewport.height / rectangle.height : 1
    updateViewport(panByScreen(viewport, {
      x: (event.clientX - current.lastX) * scaleX,
      y: (event.clientY - current.lastY) * scaleY,
    }))
    pan.current = { ...current, lastX: event.clientX, lastY: event.clientY }
  }
  const endPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pan.current?.pointerId === event.pointerId) pan.current = null
  }
  /** A cancelled pan, or one whose capture was lost, returns to where it started. */
  const cancelPan = (pointerId: number | null) => {
    const current = pan.current
    if (!current || (pointerId !== null && current.pointerId !== pointerId)) return
    pan.current = null
    updateViewport(current.start)
  }
  /** Forgets a pan in progress, as when the canvas goes or is locked. */
  const forgetPan = () => {
    pan.current = null
  }
  const navigateWithKeyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    const amount = event.shiftKey ? 120 : 40
    let next: Viewport2d | null = null
    const navigationKey = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0', 'Home']
      .includes(event.key)
    if (locked && navigationKey) {
      event.preventDefault()
      return
    }
    const centre = { x: viewport.width / 2, y: viewport.height / 2 }
    if (event.key === 'ArrowLeft') next = panByScreen(viewport, { x: amount, y: 0 })
    else if (event.key === 'ArrowRight') next = panByScreen(viewport, { x: -amount, y: 0 })
    else if (event.key === 'ArrowUp') next = panByScreen(viewport, { x: 0, y: amount })
    else if (event.key === 'ArrowDown') next = panByScreen(viewport, { x: 0, y: -amount })
    else if (event.key === '+' || event.key === '=') next = zoomAt(viewport, centre, viewport.pixelsPerUnit * 1.25)
    else if (event.key === '-') next = zoomAt(viewport, centre, viewport.pixelsPerUnit / 1.25)
    else if (event.key === '0' || event.key === 'Home') {
      event.preventDefault()
      if (event.key === '0') recenter()
      else reset()
      return
    } else return
    event.preventDefault()
    updateViewport(next)
  }

  return {
    screenPoint,
    zoom,
    recenter,
    attachSvg,
    guardGestureSelection,
    beginPan,
    movePan,
    endPan,
    cancelPan,
    forgetPan,
    navigateWithKeyboard,
  }
}
