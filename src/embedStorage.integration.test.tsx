/// <reference types="node" />
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import App from './App'
import { toCanonicalDocument } from './document/canonicalDocument'
import { expressionDocument } from './document/expressionDocument'
import { encodeSceneFragment } from './document/sceneLink'

const shared = toCanonicalDocument(expressionDocument([
  { id: 'shared-vector', source: 'V = vector(2, 1)' },
], {}, { id: 'shared-document', title: 'Spy scene' }), 'light')

type Spies = { get: ReturnType<typeof vi.spyOn>; set: ReturnType<typeof vi.spyOn>; remove: ReturnType<typeof vi.spyOn>; key: ReturnType<typeof vi.spyOn> }
let spies: Spies

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  window.localStorage.clear()
  window.sessionStorage.clear()
  spies = {
    get: vi.spyOn(Storage.prototype, 'getItem'),
    set: vi.spyOn(Storage.prototype, 'setItem'),
    remove: vi.spyOn(Storage.prototype, 'removeItem'),
    key: vi.spyOn(Storage.prototype, 'key'),
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

function canvas(): SVGSVGElement {
  return screen.getByRole('img', { name: /viewport/ }) as unknown as SVGSVGElement
}

function calls() {
  return {
    get: spies.get.mock.calls.length,
    set: spies.set.mock.calls.length,
    remove: spies.remove.mock.calls.length,
    key: spies.key.mock.calls.length,
  }
}

function interact() {
  const svg = canvas()
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 640, height: 480, top: 0, right: 640, bottom: 480, left: 0, toJSON: () => ({}),
  })
  const head = screen.queryByRole('button', { name: /Move head of/ })
  if (head) {
    fireEvent.pointerDown(head, { button: 0, pointerId: 3 })
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 536, clientY: 96 })
    fireEvent.pointerUp(svg, { pointerId: 3 })
  }
  fireEvent.wheel(svg, { deltaY: -200, clientX: 320, clientY: 240 })
  fireEvent.keyDown(svg, { key: '+' })
  fireEvent.keyDown(svg, { key: 'ArrowLeft' })
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
}

const zero = { get: 0, set: 0, remove: 0, key: 0 }

for (const mode of ['test', 'production'] as const) {
  describe(`storage spies in embed mode (#215) (MODE=${mode})`, () => {
    beforeEach(() => { if (mode !== 'test') vi.stubEnv('MODE', mode) })

    it('with a scene: mount, drag, zoom, undo touch no storage', async () => {
      const fragment = await encodeSceneFragment(shared)
      window.history.replaceState(null, '', '/' + fragment + '&embed=1&lock=0&theme=dark')
      render(<App />)
      await waitFor(() => expect(canvas()).toBeInTheDocument())
      expect(calls()).toEqual(zero)
      interact()
      expect(calls()).toEqual(zero)
    })

    it('without a scene: mount, interactions touch no storage', async () => {
      window.history.replaceState(null, '', '/#embed=1')
      render(<App />)
      await waitFor(() => expect(canvas()).toBeInTheDocument())
      expect(calls()).toEqual(zero)
      interact()
      expect(calls()).toEqual(zero)
    })

    it('auto-activated in a frame (top throws) touches no storage', async () => {
      vi.spyOn(window, 'top', 'get').mockImplementation(() => { throw new DOMException('x', 'SecurityError') })
      const fragment = await encodeSceneFragment(shared)
      window.history.replaceState(null, '', '/' + fragment)
      render(<App />)
      await waitFor(() => expect(canvas()).toBeInTheDocument())
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
      interact()
      expect(calls()).toEqual(zero)
    })

    it('invalid scene touches no storage', async () => {
      window.history.replaceState(null, '', '/#scene=1.json.bad&embed=1')
      render(<App />)
      await screen.findByRole('alert')
      expect(calls()).toEqual(zero)
    })

    it('a storage event from another tab reads nothing', async () => {
      window.history.replaceState(null, '', '/#embed=1')
      render(<App />)
      await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: null })) })
      expect(calls()).toEqual(zero)
    })

    it('control: the standard editor does use storage (spies are effective)', async () => {
      window.history.replaceState(null, '', '/')
      render(<App />)
      await waitFor(() => expect(canvas()).toBeInTheDocument())
      interact()
      const c = calls()
      // In MODE=test the app skips autosave; preferences are still read.
      expect(c.get + c.set).toBeGreaterThan(0)
      if (mode === 'production') expect(c.set).toBeGreaterThan(0)
    })
  })
}
