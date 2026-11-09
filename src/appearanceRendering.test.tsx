import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ACTIVE_DOCUMENT_KEY } from './document/documentStorage'

// The application reads local storage outside the test mode only.
beforeEach(() => {
  vi.stubEnv('MODE', 'development')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

type Version6Item = readonly [id: string, source: string, appearance?: Readonly<Record<string, unknown>>]

/** A saved format version 6 document, as written before the version 7 settings existed. */
function version6Document(
  id: string,
  algebra: Readonly<{ algebraId: string; parameters: Readonly<Record<string, unknown>> }>,
  interpretationId: string,
  objectScale: number,
  items: readonly Version6Item[],
) {
  return {
    id,
    formatVersion: 6,
    languageVersion: 1,
    algebra: { algebraId: algebra.algebraId, definitionVersion: 1, conventionVersion: 1, parameters: algebra.parameters },
    interpretation: { interpretationId, interpretationVersion: 1 },
    metadata: { title: id, description: '' },
    items: items.map(([itemId, source]) => ({
      id: itemId, kind: 'expression', source, positionSource: null, normalization: null, control: null,
    })),
    appearance: Object.fromEntries(items.map(([itemId, , appearance]) => [itemId, {
      visible: true,
      labelVisible: false,
      label: '',
      style: 'blue-4',
      borderVisible: false,
      orientationVisible: true,
      bivectorShape: 'from-vectors',
      idealPointDisplay: 'vector',
      pointListDisplay: 'none',
      pointMarkersVisible: true,
      ...appearance,
    }])),
    view: {
      visualizerId: interpretationId,
      positionEnabled: true,
      viewport: { kind: 'two-dimensional', centerX: 0, centerY: 0, zoom: 72 },
      display: {
        decimalPlaces: 4,
        axisLabelsVisible: true,
        graduationsVisible: true,
        gridVisible: true,
        objectScale,
        showApproximatedResidue: false,
        theme: 'light',
      },
    },
  }
}

async function canvasMarkup(document: ReturnType<typeof version6Document>): Promise<string> {
  window.localStorage.setItem(ACTIVE_DOCUMENT_KEY, JSON.stringify(document))
  render(<App />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Expression 1' }))
    .toHaveValue(document.items[0].source))
  return [...screen.getByRole('img', { name: /Two-dimensional [VP]GA viewport/ }).children].map(normalized).join('\n')
}

/** One element per line with sorted attributes, so that only what is drawn is compared. */
function normalized(element: Element): string {
  const attributes = [...element.attributes].map(({ name, value }) => `${name}="${value}"`).sort().join(' ')
  const children = [...element.children]
  const content = children.length > 0
    ? '\n' + children.map(normalized).join('\n') + '\n'
    : element.textContent ?? ''
  return `<${element.tagName.toLowerCase()} ${attributes}>${content}</${element.tagName.toLowerCase()}>`
}

// The snapshots were recorded on the renderer of format version 6. A saved
// document whose version 7 settings are untouched must draw the same SVG.
describe('documents saved before the version 7 appearance settings', () => {
  it('draw VGA vectors, bivectors and lists exactly as before', async () => {
    const markup = await canvasMarkup(version6Document('vga-v6', { algebraId: 'org.multivector.vga', parameters: {} },
      'org.multivector.vga-2d', 1, [
        ['v', 'V = vector(2, 1)', { labelVisible: true, style: 'yellow-4' }],
        ['w', 'W = vector(-1, 2)'],
        ['b', 'B = V ^ W', { borderVisible: true, style: 'red-4' }],
        ['d', 'D = 0.5 * e12', { bivectorShape: 'disk', orientationVisible: false }],
        ['l', 'U = [vector(1, -1), vector(-2, -1)]', { labelVisible: true, style: 'green-3' }],
      ]))
    await expect(markup).toMatchFileSnapshot('./test/snapshots/version6-vga-canvas.svg')
  })

  it('draw PGA points, lines, ideal points and lists exactly as before', async () => {
    const markup = await canvasMarkup(version6Document('pga-v6', { algebraId: 'org.multivector.pga', parameters: { dimension: 2 } },
      'org.multivector.pga-2d', 1.25, [
        ['a', 'A = point(-2, 1)', { labelVisible: true }],
        ['c', 'C = point(1, -2)'],
        ['l', 'L = line(1, 1, 0)', { style: 'red-4' }],
        ['m', 'M = A & C', { orientationVisible: false, labelVisible: true }],
        ['i', 'I = ipoint(1, 1)', { idealPointDisplay: 'both', style: 'yellow-4' }],
        ['p', 'P = [A, C, point(2, 2)]', { pointListDisplay: 'closed-loop', pointMarkersVisible: false }],
        ['q', 'Q = [L, M]', { orientationVisible: true }],
      ]))
    await expect(markup).toMatchFileSnapshot('./test/snapshots/version6-pga-canvas.svg')
  })
})
