import { act, cleanup, renderHook } from '@testing-library/react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPga2Engine } from '../algebra/pgaEngine'
import { evaluateDocument } from '../application/evaluateDocument'
import { dragTargets } from '../application/viewportManipulation'
import { expressionDocument } from '../document/expressionDocument'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import type { AnyInterpretation } from '../geometry/interpretation'
import { declaredName } from '../language/declaredName'
import { collectRenderedPrimitives } from '../visualization/layout'
import type { Viewport2d } from '../visualization/viewport'
import { useManipulation } from './useManipulation'

afterEach(cleanup)

const viewport: Viewport2d = { width: 400, height: 300, centerX: 0, centerY: 0, pixelsPerUnit: 50 }

function setup() {
  const engine = createPga2Engine()
  const interpretation = PGA_2D_INTERPRETATION as AnyInterpretation
  const document = {
    ...expressionDocument([{ id: 'p', source: 'P = point(1, 1)' }]),
    algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } },
  }
  const evaluationContext = { engine, interpretation }
  const evaluatedItems = evaluateDocument(document, evaluationContext)
  const { rendered } = collectRenderedPrimitives(evaluatedItems, document.appearance, interpretation, declaredName)
  const context = { document, evaluatedItems, interpretation, tuple: engine.tuple ?? null, pixelsPerUnit: viewport.pixelsPerUnit }
  const spies = {
    executeCommand: vi.fn(),
    dispatchHistory: vi.fn(),
    announce: vi.fn(),
    beginDrag: vi.fn(),
    endDrag: vi.fn(),
  }
  const hook = renderHook(() => useManipulation({
    document, evaluationContext, rendered, context, targets: dragTargets(context), viewport,
    objectRenderScale: 1.5, svgRef: { current: null },
    screenPoint: (x, y) => ({ x, y }), guardGestureSelection: () => {},
    ...spies,
  }))
  return { manipulation: () => hook.result.current, ...spies }
}

const pointer = (pointerId: number, clientX: number, clientY: number) => ({
  button: 0, pointerId, clientX, clientY,
  stopPropagation: vi.fn(), preventDefault: vi.fn(),
  currentTarget: { setPointerCapture: vi.fn() },
}) as unknown as ReactPointerEvent<SVGSVGElement>

describe('direct manipulation (#173)', () => {
  it('handles no pointer event while nothing is dragged, so the canvas pans', () => {
    const { manipulation } = setup()
    expect(manipulation().movePointer(pointer(1, 10, 10))).toBe(false)
    expect(manipulation().endPointer(pointer(1, 10, 10))).toBe(false)
    expect(manipulation().cancelPointer(pointer(1, 10, 10))).toBe(false)
    expect(manipulation().loseCapture()).toBe(false)
  })

  it('handles the events of the dragging pointer only, as one history transaction', () => {
    const { manipulation, dispatchHistory, executeCommand, beginDrag, endDrag } = setup()
    act(() => manipulation().beginManipulation(pointer(1, 250, 100), 'p', 'base'))
    expect(beginDrag).toHaveBeenCalledWith('p')
    expect(dispatchHistory).toHaveBeenLastCalledWith({ type: 'begin-transaction' })
    // Another pointer is not the drag's.
    expect(manipulation().movePointer(pointer(2, 300, 100))).toBe(false)
    // Within the dead zone a press writes nothing.
    expect(manipulation().movePointer(pointer(1, 251, 100))).toBe(true)
    expect(executeCommand).not.toHaveBeenCalled()
    act(() => { expect(manipulation().movePointer(pointer(1, 300, 100))).toBe(true) })
    expect(executeCommand).toHaveBeenCalledWith(expect.objectContaining({ kind: 'update-source', itemId: 'p' }))
    act(() => { expect(manipulation().endPointer(pointer(1, 300, 100))).toBe(true) })
    expect(endDrag).toHaveBeenCalled()
    expect(dispatchHistory).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'commit-transaction' }))
    expect(manipulation().endPointer(pointer(1, 300, 100))).toBe(false)
  })

  it('cancels a drag whose pointer is cancelled or whose capture is lost', () => {
    for (const end of ['cancel', 'lose'] as const) {
      const { manipulation, dispatchHistory, announce } = setup()
      act(() => manipulation().beginManipulation(pointer(1, 250, 100), 'p', 'base'))
      act(() => {
        expect(end === 'cancel' ? manipulation().cancelPointer(pointer(1, 0, 0)) : manipulation().loseCapture()).toBe(true)
      })
      expect(dispatchHistory).toHaveBeenLastCalledWith({ type: 'cancel-transaction' })
      expect(announce).toHaveBeenLastCalledWith('Object manipulation cancelled.')
    }
  })

  it('releases the drawing order of a drag that Escape cancels', () => {
    const { manipulation, dispatchHistory, endDrag } = setup()
    act(() => manipulation().beginManipulation(pointer(1, 250, 100), 'p', 'base'))
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(dispatchHistory).toHaveBeenLastCalledWith({ type: 'cancel-transaction' })
    expect(endDrag).toHaveBeenCalled()
    // The release that follows pans: the drag is over.
    expect(manipulation().endPointer(pointer(1, 250, 100))).toBe(false)
  })
})
