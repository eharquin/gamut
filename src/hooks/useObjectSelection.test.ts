import { act, cleanup, renderHook } from '@testing-library/react'
import type { FocusEvent } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExpressionItem } from '../document/expressionDocument'
import { isHandleElement, useObjectSelection } from './useObjectSelection'

afterEach(cleanup)

const items = (...ids: string[]) => ids.map((id) => ({ id, kind: 'expression', source: `${id} = 1` }) as ExpressionItem)

function setup(initial: readonly ExpressionItem[]) {
  return renderHook(({ list }) => useObjectSelection(list), { initialProps: { list: initial } })
}

const handle = () => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  element.setAttribute('data-handle-key', 'a:base')
  return element
}

describe('object selection (#173)', () => {
  it('selects the focused row, then the hovered row, then the last manipulated object', () => {
    const { result } = setup(items('a', 'b', 'c'))
    expect(result.current.selectedObjectId).toBeNull()
    act(() => result.current.beginDrag('c'))
    act(() => result.current.endDrag())
    expect(result.current.selectedObjectId).toBe('c')
    act(() => result.current.row.hover('b'))
    expect(result.current.selectedObjectId).toBe('b')
    act(() => result.current.row.focus('a'))
    expect(result.current.selectedObjectId).toBe('a')
    act(() => result.current.row.blur('a'))
    act(() => result.current.row.leave('b'))
    expect(result.current.selectedObjectId).toBe('c')
  })

  it('keeps the drawing order of the start of a drag until it ends', () => {
    const { result } = setup(items('a', 'b'))
    act(() => result.current.row.hover('a'))
    act(() => result.current.beginDrag('b'))
    act(() => result.current.row.hover('b'))
    expect(result.current.selectedObjectId).toBe('a')
    act(() => result.current.endDrag())
    expect(result.current.selectedObjectId).toBe('b')
  })

  it('keeps the drawing order while a handle has focus', () => {
    const { result } = setup(items('a', 'b'))
    act(() => result.current.row.hover('a'))
    const target = handle()
    act(() => result.current.canvasFocus({ target } as unknown as FocusEvent<SVGSVGElement>))
    act(() => result.current.row.hover('b'))
    expect(result.current.selectedObjectId).toBe('a')
    // Focus moving to another handle keeps it; leaving the handles releases it.
    act(() => result.current.canvasBlur({ target, relatedTarget: handle() } as unknown as FocusEvent<SVGSVGElement>))
    expect(result.current.selectedObjectId).toBe('a')
    act(() => result.current.canvasBlur({ target, relatedTarget: null } as unknown as FocusEvent<SVGSVGElement>))
    expect(result.current.selectedObjectId).toBe('b')
  })

  it('forgets a deleted object', () => {
    const { result, rerender } = setup(items('a', 'b'))
    act(() => result.current.row.focus('b'))
    rerender({ list: items('a') })
    expect(result.current.selectedObjectId).toBeNull()
    rerender({ list: items('a', 'b') })
    expect(result.current.selectedObjectId).toBeNull()
  })

  it('draws the focus ring only for keyboard focus', () => {
    const { result } = setup(items('a'))
    const controller = () => result.current.handleController(() => {}, () => {})
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })) })
    act(() => controller().focus('a:base'))
    expect(controller().focusRingKey).toBe('a:base')
    expect(controller().hoveredKey).toBe('a:base')
    act(() => controller().blur('a:base'))
    act(() => { window.dispatchEvent(new Event('pointerdown')) })
    act(() => controller().focus('a:base'))
    expect(controller().focusRingKey).toBeNull()
    expect(isHandleElement(handle())).toBe(true)
  })
})
