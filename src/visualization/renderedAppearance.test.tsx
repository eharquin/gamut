import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createPga2Engine } from '../algebra/pgaEngine'
import { evaluateAppearanceSources } from '../application/evaluateAppearanceSources'
import { evaluateDocument } from '../application/evaluateDocument'
import { expressionDocument, type ExpressionAppearance } from '../document/expressionDocument'
import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { collectRenderedPrimitives } from './layout'
import { OrientedAreaGlyph, OrientedSegmentGlyph, PointMarkerGlyph, type HandleController } from './glyphs'
import { DEFAULT_STROKE_WIDTHS, strokePattern } from './stroke'

const engine = createPga2Engine()

function rendered(items: readonly (readonly [string, string])[], appearance: Readonly<Record<string, ExpressionAppearance>>) {
  const document = {
    ...expressionDocument(items.map(([id, source]) => ({ id, source })), appearance),
    algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } },
  }
  const evaluated = evaluateDocument(document, { engine, interpretation: PGA_2D_INTERPRETATION })
  return collectRenderedPrimitives(
    evaluated, document.appearance, PGA_2D_INTERPRETATION,
    (source) => /^\s*([A-Za-z_]\w*)\s*=/.exec(source)?.[1] ?? null,
    evaluateAppearanceSources(document, evaluated, engine),
  )
}

describe('rendered stroke and opacity', () => {
  it('carries the stroke style, the evaluated width and the opacity of an item', () => {
    const { rendered: [line] } = rendered(
      [['w', 'w = 3'], ['l', 'L = line(1, 1, 0)']],
      { l: { strokeStyle: 'dotted', strokeWidthSource: 'w', opacitySource: '40' } },
    )
    expect(line).toMatchObject({ strokeStyle: 'dotted', strokeWidth: 3, opacity: 0.4 })
  })

  it('keeps the kind default for an untouched or refused setting', () => {
    const { rendered: [untouched, refused] } = rendered(
      [['l', 'L = line(1, 1, 0)'], ['m', 'M = line(1, -1, 0)']],
      { m: { strokeWidthSource: '50', opacitySource: 'nope' } },
    )
    expect(untouched).toMatchObject({ strokeStyle: 'solid', strokeWidth: null, opacity: null })
    expect(refused).toMatchObject({ strokeWidth: null, opacity: null })
  })

  it('styles the lines of a list with their own block, not with the item stroke', () => {
    const { rendered: elements, connections } = rendered(
      [['p', 'P = [point(0, 0), point(1, 1), line(1, 0, 0)]']],
      { p: {
        strokeStyle: 'dashed', strokeWidthSource: '9', opacitySource: '50',
        orientationVisible: true,
        primitiveStyles: {
          lines: { strokeStyle: 'dotted', strokeWidthSource: '1.5', orientationVisible: false },
          points: { connection: 'open-polyline' },
        },
      } },
    )
    const line = elements.find((element) => element.primitive.kind === 'unbounded-line')
    const point = elements.find((element) => element.primitive.kind === 'point-marker')
    expect(line).toMatchObject({ strokeStyle: 'dotted', strokeWidth: 1.5, orientationVisible: false, opacity: 0.5 })
    expect(point).toMatchObject({ strokeStyle: 'solid', strokeWidth: null, opacity: 0.5 })
    expect(connections).toEqual([])
  })

  it('orients a list line like the item when the list stores no line orientation', () => {
    const { rendered: [line] } = rendered([['p', 'P = [line(1, 0, 0)]']], { p: { orientationVisible: true } })
    expect(line.orientationVisible).toBe(true)
  })

  it('starts a new line without its orientation, and a bivector-like kind with it', () => {
    const { rendered: [line] } = rendered([['l', 'L = line(1, 1, 0)']], {})
    expect(line.orientationVisible).toBe(false)
    const { rendered: [stored] } = rendered([['l', 'L = line(1, 1, 0)']], { l: { orientationVisible: true } })
    expect(stored.orientationVisible).toBe(true)
  })
})

describe('stroke patterns', () => {
  it('scales dashes and round dots with the drawn width', () => {
    expect(strokePattern('solid', 2)).toEqual({})
    expect(strokePattern('dashed', 2)).toEqual({ strokeDasharray: '8 6' })
    expect(strokePattern('dashed', 4)).toEqual({ strokeDasharray: '16 12' })
    expect(strokePattern('dotted', 3)).toEqual({ strokeDasharray: '0 6', strokeLinecap: 'round' })
  })

  it('names the kind defaults drawn before version 7', () => {
    expect(DEFAULT_STROKE_WIDTHS.line * 1.5).toBe(3.75)
    expect(DEFAULT_STROKE_WIDTHS.segment * 1.5).toBeCloseTo(4)
    expect(DEFAULT_STROKE_WIDTHS.outline * 1.5).toBe(3)
  })
})

const controller: HandleController = {
  hoveredKey: null, focusRingKey: null,
  hover() {}, unhover() {}, focus() {}, blur() {}, pointerDown() {}, keyDown() {},
}
const segment = {
  start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, shaftEnd: { x: 88, y: 0 }, arrowPoints: '100,0 88,7 88,-7',
}
const vector = (props: Partial<Parameters<typeof OrientedSegmentGlyph>[0]> = {}) => renderToStaticMarkup(<svg>
  <OrientedSegmentGlyph id="v" primitive={{ kind: 'oriented-segment', start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, accessibleName: 'V' }}
    layout={segment} color="#E8A000" label={null} scale={1.5} itemPresent={false} headMovable={false}
    baseMovable={false} controller={controller} {...props} />
</svg>)

describe('stroked glyphs', () => {
  it('draw an untouched vector with the stylesheet stroke only', () => {
    expect(vector()).not.toMatch(/stroke-dasharray|opacity/)
    expect(vector()).toContain('<g style="color:#E8A000">')
  })

  it('draw a set width scaled by the object scale, with dashes scaled by the drawn width', () => {
    const markup = vector({ strokeStyle: 'dashed', strokeWidth: 2, opacity: 0.25 })
    expect(markup).toContain('style="stroke-width:3;stroke-dasharray:12 9"')
    expect(markup).toContain('<g style="color:#E8A000"><g opacity="0.25">')
  })

  it('fade the drawn marks only, never the handles or the keyboard focus ring', () => {
    const focused = { ...controller, focusRingKey: 'v:head' }
    const markup = vector({ opacity: 0, headMovable: true, itemPresent: true, baseMovable: true, label: 'V', controller: focused })
    const faded = markup.split('<g opacity="0">').slice(1).map((part) => part.slice(0, part.indexOf('</g>'))).join('')
    expect(faded).toContain('class="vector"')
    expect(faded).toContain('class="object-label"')
    for (const handle of ['manipulation-focus-ring', 'vector-head-target', 'manipulation-base-contour'])
      expect(faded).not.toContain(handle)
    expect(markup).toContain('manipulation-focus-ring')
  })

  it('dot the default shaft without changing its width', () => {
    expect(vector({ strokeStyle: 'dotted' })).toContain('style="stroke-dasharray:0 8;stroke-linecap:round"')
  })

  it('stroke a bivector outline only while the outline is shown', () => {
    const area = (borderVisible: boolean) => renderToStaticMarkup(<svg><OrientedAreaGlyph
      id="b" primitive={{ kind: 'oriented-area', shape: { kind: 'loop', center: { x: 0, y: 0 } }, area: 1, orientation: 'counterclockwise', accessibleName: 'B', accessibleDescription: 'B' } as never}
      layout={{ path: 'M 0 0 L 1 1 Z', labelPoint: { x: 0, y: 0 }, orientationCenter: { x: 0, y: 0 }, base: { x: 0, y: 0 } }}
      color="#C30A3A" label={null} scale={1.5} borderVisible={borderVisible} orientationVisible={false}
      itemPresent={false} baseMovable={false} controller={controller} strokeStyle="dashed" strokeWidth={1} /></svg>)
    expect(area(false)).not.toContain('stroke-dasharray')
    expect(area(true)).toContain('stroke-width:1.5;stroke-dasharray:6 4.5')
  })
})

describe('point styles and sizes (#222)', () => {
  it('carries the point style and size of an item, and those of the points block to a list', () => {
    const { rendered: elements, connections } = rendered(
      [['s', 's = 6'], ['a', 'A = point(1, 1)'], ['p', 'P = [point(0, 0), point(2, 1), point(1, 3)]']],
      {
        a: { pointStyle: 'ring', pointSizeSource: 's' },
        p: { pointStyle: 'cross', pointSizeSource: '9', primitiveStyles: { points: {
          pointStyle: 'diamond', pointSizeSource: '3', connection: 'closed-loop', strokeStyle: 'dashed', strokeWidthSource: 's / 2',
        } } },
      },
    )
    expect(elements[0]).toMatchObject({ pointStyle: 'ring', pointSize: 6 })
    expect(elements.slice(1).map(({ pointStyle, pointSize }) => [pointStyle, pointSize]))
      .toEqual([['diamond', 3], ['diamond', 3], ['diamond', 3]])
    expect(connections[0]).toMatchObject({ strokeStyle: 'dashed', strokeWidth: 3 })
  })

  it('keeps the default dot and size when nothing is set', () => {
    const { rendered: [point], connections } = rendered(
      [['p', 'P = [point(0, 0), point(2, 1)]']], { p: { primitiveStyles: { points: { connection: 'open-polyline' } } } })
    expect(point).toMatchObject({ pointStyle: 'dot', pointSize: null })
    expect(connections[0]).toMatchObject({ strokeStyle: 'solid', strokeWidth: null })
  })
})

const point = (props: Partial<Parameters<typeof PointMarkerGlyph>[0]> = {}) => {
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<svg><PointMarkerGlyph id="a"
    primitive={{ kind: 'point-marker', point: { x: 0, y: 0 }, accessibleName: 'A' } as never}
    point={{ x: 50, y: 40 }} color="#1482C8" label={null} scale={1.5} itemPresent movable
    controller={controller} {...props} /></svg>)
  return host
}

describe('point glyphs', () => {
  it('draw a dot with the contour disk as its outer shape, as before', () => {
    const host = point()
    expect(host.querySelector('.point-outer')).toBeNull()
    expect(host.querySelector('.manipulation-base-contour')).not.toHaveClass('is-shaped')
    expect(host.querySelector('.manipulation-base-contour')).toHaveAttribute('r', '15')
    expect(host.querySelector('circle.manipulation-base-point')).toHaveAttribute('r', '6.75')
  })

  it('give every other style an outer shape of its own form, 10 / 4.5 times the core', () => {
    const host = point({ pointStyle: 'square', pointSize: 6 })
    const outer = host.querySelector('rect.point-outer')!
    const core = host.querySelector('rect.manipulation-base-point')!
    expect(Number(core.getAttribute('width'))).toBe(18)
    expect(Number(outer.getAttribute('width'))).toBeCloseTo(40)
    expect(host.querySelector('rect.point-marker')).toHaveAttribute('width', '18')
    // The contour stays the hit target, transparent.
    expect(host.querySelector('circle.manipulation-base-contour')).toHaveClass('is-shaped')
    expect(Number(host.querySelector('circle.manipulation-base-contour')!.getAttribute('r'))).toBeCloseTo(20)
  })

  it('stroke ring, cross and plus in proportion to their size, so that the stroke grows with them', () => {
    const ring = point({ pointStyle: 'ring' }).querySelector('circle.manipulation-base-point') as SVGCircleElement
    expect(ring.style.fill).toBe('none')
    expect(Number(ring.style.strokeWidth)).toBeCloseTo(6.75 * 0.45)
    const cross = point({ pointStyle: 'cross', pointSize: 2 }).querySelector('path.manipulation-base-point') as SVGPathElement
    expect(Number(cross.style.strokeWidth)).toBeCloseTo(3 * 0.62)
    expect(point({ pointStyle: 'plus' }).querySelector('path.point-outer')).not.toBeNull()
  })

  it('keep a usable hit target and a focus ring outside the outer shape at any size', () => {
    const radius = (host: HTMLElement, selector: string) => Number(host.querySelector(selector)!.getAttribute('r'))
    const focused = { ...controller, focusRingKey: 'a:base' }
    // A tiny point keeps the default 10 px hit disk (15 at scale 1.5), with its outer shape drawn apart.
    const tiny = point({ pointSize: 1, controller: focused })
    expect(radius(tiny, '.manipulation-base-contour')).toBe(15)
    expect(tiny.querySelector('circle.point-outer')).not.toBeNull()
    expect(radius(tiny, '.manipulation-focus-ring')).toBe(21)
    // Diamond tips reach 1.3 times the outer radius; the hit target and the ring cover them.
    const large = point({ pointStyle: 'diamond', pointSize: 10, controller: focused })
    const outer = 10 * 1.5 * (10 / 4.5)
    expect(radius(large, '.manipulation-base-contour')).toBeCloseTo(outer * 1.3)
    expect(radius(large, '.manipulation-focus-ring')).toBeCloseTo(outer * 1.3 + 6)
  })

  it('grow the core of any style on hover, through the hovered class', () => {
    const host = point({ pointStyle: 'diamond', controller: { ...controller, hoveredKey: 'a:base' } })
    expect(host.querySelector('path.manipulation-base-point')).toHaveClass('is-hovered')
  })
})
