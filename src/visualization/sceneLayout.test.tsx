import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createPga2Engine } from '../algebra/pgaEngine'
import { evaluateDocument } from '../application/evaluateDocument'
import { expressionDocument } from '../document/expressionDocument'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import type { HandleController } from './glyphs'
import { collectRenderedPrimitives } from './layout'
import { SceneGlyphs, type GlyphMovability } from './SceneGlyphs'
import { labelPlacementInputs, layoutScene, ownerOf } from './sceneLayout'
import type { Viewport2d } from './viewport'

const engine = createPga2Engine()
const viewport: Viewport2d = { width: 400, height: 300, centerX: 0, centerY: 0, pixelsPerUnit: 50 }

function primitives(items: readonly (readonly [string, string])[]) {
  const document = {
    ...expressionDocument(
      items.map(([id, source]) => ({ id, source })),
      Object.fromEntries(items.map(([id]) => [id, { labelVisible: true }])),
    ),
    algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } },
  }
  const evaluated = evaluateDocument(document, { engine, interpretation: PGA_2D_INTERPRETATION })
  return collectRenderedPrimitives(
    evaluated, document.appearance, PGA_2D_INTERPRETATION,
    (source) => /^\s*([A-Za-z_]\w*)\s*=/.exec(source)?.[1] ?? null,
  )
}

const scene = [
  ['p', 'P = point(1, 1)'],
  ['l', 'L = line(1, 1, 0)'],
  ['i', 'I = point(1, 0, 0)'],
  ['s', 'S = [point(0, 0), point(1, 0)]'],
] as const

describe('scene layout (#173)', () => {
  it('sorts the rendered primitives into one layer per kind', () => {
    const { rendered, connections } = primitives(scene)
    const layout = layoutScene(rendered, connections, viewport, 1.5)
    expect(layout.points.map(({ id }) => ownerOf(id))).toEqual(['p', 's', 's'])
    expect(layout.lines.map(({ id }) => id)).toEqual(['l'])
    expect(layout.idealPoints.map(({ id }) => id)).toEqual(['i'])
    expect(layout.vectors).toEqual([])
    expect(layout.points[0].point).toEqual({ x: 250, y: 100 })
  })

  it('anchors a label for every labelled element and avoids the points of others', () => {
    const { rendered, connections } = primitives(scene)
    const layout = layoutScene(rendered, connections, viewport, 1.5)
    const { requests, obstacles } = labelPlacementInputs(layout, rendered, viewport, 1.5)
    expect(requests.map(({ key }) => key)).toEqual(rendered.filter(({ label }) => label).map(({ id }) => id))
    expect(requests.map(({ key }) => ownerOf(key))).toEqual(expect.arrayContaining(['p', 'l', 'i']))
    // Points, then the handles of the ideal point drawn as an arrow.
    expect(obstacles.map(({ ownerId }) => ownerId)).toEqual(['p', 's', 's', 'i', 'i'])
    expect(ownerOf('s:0')).toBe('s')
  })

  it('draws the selected object last, so that its handles are on top', () => {
    const { rendered, connections } = primitives([['a', 'A = point(0, 0)'], ['b', 'B = point(1, 0)']])
    const layout = layoutScene(rendered, connections, viewport, 1.5)
    const controller: HandleController = {
      hoveredKey: null, focusRingKey: null, hover: () => {}, unhover: () => {}, focus: () => {}, blur: () => {},
      pointerDown: () => {}, keyDown: () => {},
    } as unknown as HandleController
    const movability: GlyphMovability = { present: () => true, head: () => true, base: () => true, line: () => true }
    const markup = (selectedObjectId: string | null) => renderToStaticMarkup(<svg><SceneGlyphs
      scene={layout} viewport={viewport} scale={1.5} placedLabel={() => null} movability={movability}
      controller={controller} selectedObjectId={selectedObjectId} selectedLine={null}
    /></svg>)
    const order = (html: string) => [...html.matchAll(/data-handle-key="([ab]):/g)].map((match) => match[1])
    expect(order(markup(null))[0]).toBe('a')
    expect(order(markup('a')).at(-1)).toBe('a')
  })

  it('offers no handle to a list element, which is no item', () => {
    const { rendered, connections } = primitives([['a', 'A = point(0, 0)'], ['s', 'S = [point(1, 0), point(2, 0)]']])
    const layout = layoutScene(rendered, connections, viewport, 1.5)
    const movability: GlyphMovability = {
      present: (id) => id === ownerOf(id), head: () => true, base: () => true, line: () => true,
    }
    const html = renderToStaticMarkup(<svg><SceneGlyphs
      scene={layout} viewport={viewport} scale={1.5} placedLabel={() => null} movability={movability}
      controller={{ hoveredKey: null, focusRingKey: null } as unknown as HandleController}
      selectedObjectId={null} selectedLine={null}
    /></svg>)
    expect([...html.matchAll(/data-handle-key="([^":]+):/g)].map((match) => match[1])).toEqual(['a'])
  })
})
