/** Distance from the edge of the scrolled panel, in pixels, at which a drag starts scrolling it. */
export const AUTO_SCROLL_EDGE = 48
/** The fastest scroll, in pixels per frame, reached at the edge and beyond it. */
export const AUTO_SCROLL_MAX_SPEED = 18

/**
 * How far a drag scrolls its panel in one frame: negative upwards, positive
 * downwards, 0 away from the edges. The speed grows as the pointer nears an
 * edge and is greatest at it or past it, so that a row can be carried from
 * the bottom of a long list to its top.
 */
export function autoScrollStep(pointerY: number, top: number, bottom: number): number {
  const edge = Math.min(AUTO_SCROLL_EDGE, (bottom - top) / 4)
  if (edge <= 0) return 0
  const depth = (distance: number) => Math.min(1, Math.max(0, (edge - distance) / edge))
  if (pointerY < top + edge) return -Math.ceil(AUTO_SCROLL_MAX_SPEED * depth(pointerY - top))
  if (pointerY > bottom - edge) return Math.ceil(AUTO_SCROLL_MAX_SPEED * depth(bottom - pointerY))
  return 0
}

/** The nearest ancestor that scrolls vertically, or the page. */
export function scrollContainer(element: Element): Element {
  for (let current = element.parentElement; current; current = current.parentElement) {
    const { overflowY } = getComputedStyle(current)
    if ((overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight) return current
  }
  return document.scrollingElement ?? document.documentElement
}
