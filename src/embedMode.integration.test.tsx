/// <reference types="node" />
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import { toCanonicalDocument } from './document/canonicalDocument'
import { expressionDocument } from './document/expressionDocument'
import { encodeSceneFragment } from './document/sceneLink'

const shared = toCanonicalDocument(expressionDocument([
  { id: 'shared-vector', source: 'V = vector(2, 1)' },
], {}, { id: 'shared-document', title: 'An embedded scene' }), 'light')

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

function blockStorage() {
  return vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Storage blocked') })
}

function viewportCanvas(): SVGSVGElement {
  return screen.getByRole('img', { name: /Two-dimensional [VP]GA viewport/ }) as unknown as SVGSVGElement
}

async function openEmbeddedScene(options = '&embed=1') {
  const fragment = await encodeSceneFragment(shared)
  window.history.replaceState(null, '', '/' + fragment + options)
  render(<App />)
  await waitFor(() => expect(viewportCanvas()).toBeInTheDocument())
  return fragment
}

describe('embed mode (#215)', () => {
  it('renders only the viewport and its embed controls, without touching storage', async () => {
    const storage = blockStorage()
    const fragment = await openEmbeddedScene('&embed=1&unknown=option')

    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Library' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Expressions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Library' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /expression panel/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hide canvas/ })).not.toBeInTheDocument()
    // Zoom and recenter stay, for touch screens without pinch zoom; the lock and the rest go.
    const toolbar = screen.getByRole('toolbar', { name: 'Viewport controls' })
    expect(Array.from(toolbar.querySelectorAll('button'), (button) => button.getAttribute('aria-label')))
      .toEqual(['Zoom in', 'Zoom out', 'Recenter view'])
    expect(screen.queryByRole('button', { name: /Lock viewport/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save local copy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    const open = screen.getByRole('link', { name: /Open in GAMUT/ })
    expect(open).toHaveAttribute('href', new URL('/' + fragment, window.location.href).href)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // jsdom grants no fullscreen, as a host without `allowfullscreen`.
    expect(screen.queryByRole('button', { name: /fullscreen/ })).not.toBeInTheDocument()
    expect(storage).not.toHaveBeenCalled()
  })

  it('keeps dragging a free object, without writing storage or the address', async () => {
    const storage = blockStorage()
    const fragment = await openEmbeddedScene()
    const canvas = viewportCanvas()
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 640, height: 480, top: 0, right: 640, bottom: 480, left: 0, toJSON: () => ({}),
    })
    const head = () => screen.getByRole('button', { name: 'Move head of V' })
    const before = head().outerHTML
    fireEvent.pointerDown(head(), { button: 0, pointerId: 3 })
    fireEvent.pointerMove(canvas, { pointerId: 3, clientX: 536, clientY: 96 })
    fireEvent.pointerUp(canvas, { pointerId: 3 })

    expect(head().outerHTML).not.toBe(before)
    // Double-click creates nothing in embed mode, so the description offers no hint.
    expect(document.querySelector('desc')?.textContent).toBe('1 vector and 0 bivectors are visible. V runs from the origin to 3, 2.')
    expect(window.location.hash).toBe(fragment + '&embed=1')
    expect(storage).not.toHaveBeenCalled()
  })

  it('offers fullscreen when the host allows it', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    const request = vi.fn(() => Promise.resolve())
    document.documentElement.requestFullscreen = request
    try {
      await openEmbeddedScene()
      fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
      expect(request).toHaveBeenCalledOnce()
    } finally {
      delete (document as { fullscreenEnabled?: boolean }).fullscreenEnabled
      delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen
    }
  })

  it('applies the theme and viewport lock display options', async () => {
    await openEmbeddedScene('&embed=1&theme=dark&lock=1')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(viewportCanvas()).toHaveClass('is-viewport-locked')
    expect(screen.queryByRole('toolbar', { name: 'Viewport controls' })).not.toBeInTheDocument()
  })

  it('shows the default example without storage when the fragment has no scene', () => {
    const storage = blockStorage()
    window.history.replaceState(null, '', '/#embed=1')
    render(<App />)
    expect(viewportCanvas()).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(document.documentElement).toHaveClass('is-embedded')
    // The application would open the viewer's own document, not the one shown.
    expect(screen.queryByRole('link', { name: /Open in GAMUT/ })).not.toBeInTheDocument()
    expect(storage).not.toHaveBeenCalled()
  })

  it('states that an invalid scene cannot be opened, without falling back on storage', async () => {
    const storage = blockStorage()
    window.history.replaceState(null, '', '/#scene=1.json.bad&embed=1')
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('This scene could not be opened: its link may be incomplete or damaged. (SHARE_ENVELOPE)')
    expect(screen.getByRole('link', { name: /Open in GAMUT/ })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(storage).not.toHaveBeenCalled()
  })

  it('turns on automatically inside a frame, and embed=0 turns it off', async () => {
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
    await openEmbeddedScene('')
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    cleanup()

    await openEmbeddedScene('&embed=0')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open in GAMUT/ })).not.toBeInTheDocument()
  })

  it('leaves the standard application unchanged outside a frame', async () => {
    await openEmbeddedScene('')
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Expression 1' })).toHaveValue('V = vector(2, 1)')
    expect(screen.queryByRole('link', { name: /Open in GAMUT/ })).not.toBeInTheDocument()
  })
})
