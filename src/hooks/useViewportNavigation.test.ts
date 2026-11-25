import { act, cleanup, renderHook } from '@testing-library/react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PIXELS_PER_UNIT, type Viewport2d } from '../visualization/viewport'
import { useViewportNavigation } from './useViewportNavigation'

const start: Viewport2d = { width: 400, height: 300, centerX: 1, centerY: 2, pixelsPerUnit: 50 }

function setup(locked = false) {
  const updateViewport = vi.fn<(next: Viewport2d) => void>()
  const announce = vi.fn<(message: string) => void>()
  const svgRef = { current: null as SVGSVGElement | null }
  const hook = renderHook(() => useViewportNavigation({ viewport: start, locked, updateViewport, announce, svgRef }))
  return { navigation: () => hook.result.current, updateViewport, announce, svgRef, unmount: hook.unmount }
}

const key = (value: string, shiftKey = false) => {
  const event = { key: value, shiftKey, preventDefault: vi.fn() }
  return event as unknown as KeyboardEvent<SVGSVGElement> & { preventDefault: ReturnType<typeof vi.fn> }
}

function pointer(type: 'down' | 'move', clientX: number, clientY: number) {
  const svg = {
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
  }
  return {
    type, button: 0, pointerId: 7, clientX, clientY,
    target: svg, currentTarget: svg, preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent<SVGSVGElement>
}

afterEach(cleanup)

describe('viewport navigation (#173)', () => {
  it('pans with the arrow keys and zooms about the centre with + and -', () => {
    const { navigation, updateViewport } = setup()
    navigation().navigateWithKeyboard(key('ArrowRight'))
    expect(updateViewport).toHaveBeenLastCalledWith(expect.objectContaining({ centerX: 1 + 40 / 50, centerY: 2 }))
    navigation().navigateWithKeyboard(key('+'))
    expect(updateViewport).toHaveBeenLastCalledWith(expect.objectContaining({ pixelsPerUnit: 62.5 }))
    navigation().navigateWithKeyboard(key('Enter'))
    expect(updateViewport).toHaveBeenCalledTimes(2)
  })

  it('recentres on 0 and resets the scale on Home, and says so', () => {
    const { navigation, updateViewport, announce } = setup()
    navigation().navigateWithKeyboard(key('0'))
    expect(updateViewport).toHaveBeenLastCalledWith({ ...start, centerX: 0, centerY: 0 })
    expect(announce).toHaveBeenLastCalledWith('View recentered on the origin.')
    navigation().navigateWithKeyboard(key('Home'))
    expect(updateViewport).toHaveBeenLastCalledWith({ ...start, centerX: 0, centerY: 0, pixelsPerUnit: DEFAULT_PIXELS_PER_UNIT })
  })

  it('swallows the navigation keys of a locked viewport, and starts no pan', () => {
    const { navigation, updateViewport } = setup(true)
    const event = key('ArrowLeft')
    navigation().navigateWithKeyboard(event)
    expect(event.preventDefault).toHaveBeenCalled()
    navigation().beginPan(pointer('down', 10, 10))
    navigation().movePan(pointer('move', 50, 10))
    expect(updateViewport).not.toHaveBeenCalled()
  })

  it('pans with the pointer, and a cancelled pan returns to where it started', () => {
    const { navigation, updateViewport } = setup()
    act(() => navigation().beginPan(pointer('down', 10, 10)))
    expect(document.body.classList.contains('canvas-gesture-pan')).toBe(true)
    navigation().movePan(pointer('move', 60, 10))
    expect(updateViewport).toHaveBeenLastCalledWith(expect.objectContaining({ centerX: 0 }))
    navigation().cancelPan(7)
    expect(updateViewport).toHaveBeenLastCalledWith(start)
    // Nothing is left to cancel or move.
    navigation().movePan(pointer('move', 90, 10))
    expect(updateViewport).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('pointerup'))
    expect(document.body.classList.contains('canvas-gesture')).toBe(false)
  })

  it('zooms with a non-passive wheel listener, which a locked viewport still keeps from zooming the page', () => {
    for (const locked of [false, true]) {
      const { navigation, updateViewport, svgRef } = setup(locked)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const detach = navigation().attachSvg(svg)
      expect(svgRef.current).toBe(svg)
      const wheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true })
      svg.dispatchEvent(wheel)
      expect(wheel.defaultPrevented).toBe(true)
      expect(updateViewport).toHaveBeenCalledTimes(locked ? 0 : 1)
      detach?.()
      svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))
      expect(updateViewport).toHaveBeenCalledTimes(locked ? 0 : 1)
    }
  })

  it('restores the start when the capture is lost, but not after the pan ended', () => {
    const lost = setup()
    act(() => lost.navigation().beginPan(pointer('down', 10, 10)))
    lost.navigation().movePan(pointer('move', 60, 10))
    lost.navigation().cancelPan(null)
    expect(lost.updateViewport).toHaveBeenLastCalledWith(start)

    const ended = setup()
    act(() => ended.navigation().beginPan(pointer('down', 10, 10)))
    ended.navigation().movePan(pointer('move', 60, 10))
    ended.navigation().endPan(pointer('move', 60, 10))
    ended.navigation().cancelPan(null)
    expect(ended.updateViewport).toHaveBeenCalledTimes(1)
  })

  it('releases the selection guard when it unmounts mid-gesture', () => {
    const { navigation, unmount } = setup()
    act(() => navigation().beginPan(pointer('down', 10, 10)))
    expect(document.body.classList.contains('canvas-gesture')).toBe(true)
    unmount()
    expect(document.body.classList.contains('canvas-gesture')).toBe(false)
  })
})
