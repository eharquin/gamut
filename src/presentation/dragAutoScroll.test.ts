import { describe, expect, it } from 'vitest'
import { AUTO_SCROLL_MAX_SPEED, autoScrollStep, scrollContainer } from './dragAutoScroll'

describe('drag auto-scroll', () => {
  it('scrolls nothing away from the edges of the panel', () => {
    expect(autoScrollStep(300, 100, 700)).toBe(0)
    expect(autoScrollStep(149, 100, 700)).toBe(0)
    expect(autoScrollStep(147, 100, 700)).not.toBe(0)
  })

  it('scrolls up near the top and down near the bottom, faster closer to the edge', () => {
    expect(autoScrollStep(140, 100, 700)).toBeLessThan(0)
    expect(autoScrollStep(110, 100, 700)).toBeLessThan(autoScrollStep(140, 100, 700))
    expect(autoScrollStep(660, 100, 700)).toBeGreaterThan(0)
    expect(autoScrollStep(690, 100, 700)).toBeGreaterThan(autoScrollStep(660, 100, 700))
  })

  it('scrolls at full speed at the edge and past it, where the pointer leaves the panel', () => {
    expect(autoScrollStep(100, 100, 700)).toBe(-AUTO_SCROLL_MAX_SPEED)
    expect(autoScrollStep(20, 100, 700)).toBe(-AUTO_SCROLL_MAX_SPEED)
    expect(autoScrollStep(900, 100, 700)).toBe(AUTO_SCROLL_MAX_SPEED)
  })

  it('keeps the edge zones apart in a short panel', () => {
    // A 100 px panel has 25 px zones, so its middle never scrolls.
    expect(autoScrollStep(50, 0, 100)).toBe(0)
    expect(autoScrollStep(0, 0, 100)).toBe(-AUTO_SCROLL_MAX_SPEED)
  })

  it('finds the nearest ancestor that scrolls, or the page', () => {
    const panel = document.createElement('div')
    panel.style.overflowY = 'auto'
    Object.defineProperty(panel, 'scrollHeight', { value: 2000 })
    Object.defineProperty(panel, 'clientHeight', { value: 500 })
    const row = document.createElement('div')
    const handle = document.createElement('button')
    row.append(handle)
    panel.append(row)
    document.body.append(panel)
    expect(scrollContainer(handle)).toBe(panel)
    const loose = document.createElement('button')
    document.body.append(loose)
    expect(scrollContainer(loose)).toBe(document.scrollingElement ?? document.documentElement)
    panel.remove()
    loose.remove()
  })
})
