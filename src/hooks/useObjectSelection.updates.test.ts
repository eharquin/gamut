import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExpressionItem } from '../document/expressionDocument'

/**
 * Counts the state updates the hook schedules. In the browser, a state update
 * that keeps the same value still renders the editor again when the editor
 * has just been updated, as on every move of a drag (#368); jsdom and `act`
 * hide that render, so the updates themselves are counted.
 */
const updates = vi.hoisted(() => ({ count: 0 }))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: ((initial: unknown) => {
      const [value, set] = react.useState(initial)
      const counted = react.useCallback((next: unknown) => { updates.count += 1; set(next) }, [])
      return [value, counted]
    }) as typeof react.useState,
  }
})

const { useObjectSelection } = await import('./useObjectSelection')

afterEach(cleanup)

const items = (...ids: string[]) => ids.map((id) => ({ id, kind: 'expression', source: `${id} = 1` }) as ExpressionItem)

describe('object selection updates (#368)', () => {
  it('schedules no state update when the items change and no selected object is deleted', () => {
    const { result, rerender } = renderHook(({ list }) => useObjectSelection(list), { initialProps: { list: items('a', 'b') } })
    act(() => result.current.row.hover('a'))
    act(() => result.current.row.focus('b'))
    updates.count = 0
    for (let move = 0; move < 5; move += 1) rerender({ list: items('a', 'b') })
    expect(updates.count).toBe(0)
  })

  it('still forgets a deleted focused, hovered, or last manipulated object, with one update each', () => {
    const { result, rerender } = renderHook(({ list }) => useObjectSelection(list), { initialProps: { list: items('a', 'b', 'c', 'd') } })
    act(() => result.current.beginDrag('c'))
    act(() => result.current.endDrag())
    act(() => result.current.row.hover('b'))
    act(() => result.current.row.focus('a'))
    updates.count = 0
    rerender({ list: items('b', 'c', 'd') })
    expect(updates.count).toBe(1)
    expect(result.current.selectedObjectId).toBe('b')
    rerender({ list: items('c', 'd') })
    expect(result.current.selectedObjectId).toBe('c')
    updates.count = 0
    rerender({ list: items('d') })
    expect(updates.count).toBe(1)
    expect(result.current.selectedObjectId).toBeNull()
  })
})
