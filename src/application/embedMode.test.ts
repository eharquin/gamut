import { describe, expect, it } from 'vitest'
import { fullApplicationUrl, isFramed, resolveEmbedMode } from './embedMode'

const scene = 'scene=1.json.' + 'a'.repeat(64) + '.e30'

describe('embed mode detection (#215)', () => {
  it('detects a frame from the window and its top', () => {
    const view = {}
    expect(isFramed({ self: view, top: view })).toBe(false)
    expect(isFramed({ self: view, top: {} })).toBe(true)
  })

  it('treats a top window that cannot be read as a frame', () => {
    const view = {
      self: {},
      get top(): unknown { throw new DOMException('Blocked a frame', 'SecurityError') },
    }
    expect(isFramed(view)).toBe(true)
  })

  it('turns on in a frame and stays off outside one', () => {
    expect(resolveEmbedMode('#' + scene, true)).toEqual({ theme: null, viewportLocked: false, background: null })
    expect(resolveEmbedMode('#' + scene, false)).toBeNull()
    expect(resolveEmbedMode('', true)).not.toBeNull()
    expect(resolveEmbedMode('', false)).toBeNull()
  })

  it('is forced by embed=1 outside a frame and turned off by embed=0 inside one', () => {
    expect(resolveEmbedMode(`#${scene}&embed=1`, false)).not.toBeNull()
    expect(resolveEmbedMode('#embed=1', false)).not.toBeNull()
    expect(resolveEmbedMode(`#${scene}&embed=0`, true)).toBeNull()
    expect(resolveEmbedMode(`#embed=0&${scene}`, true)).toBeNull()
  })

  it('ignores unknown options and values without error', () => {
    expect(resolveEmbedMode(`#${scene}&embed=yes&foo=bar&&=x&baz`, false)).toBeNull()
    expect(resolveEmbedMode(`#${scene}&embed=yes&foo=bar&%E0`, true))
      .toEqual({ theme: null, viewportLocked: false, background: null })
    expect(resolveEmbedMode('#embed=1&theme=sepia&lock=yes&bg=red', false))
      .toEqual({ theme: null, viewportLocked: false, background: null })
  })

  it('reads the theme and viewport lock display options', () => {
    expect(resolveEmbedMode('#embed=1&theme=dark&lock=1', false))
      .toEqual({ theme: 'dark', viewportLocked: true, background: null })
    expect(resolveEmbedMode('#theme=light', true)).toEqual({ theme: 'light', viewportLocked: false, background: null })
  })

  it('does not take an option from inside the scene payload', () => {
    expect(resolveEmbedMode('#scene=embed=1', false)).toBeNull()
  })
})

describe('Open in GAMUT address', () => {
  it('keeps the scene and drops every display option', () => {
    expect(fullApplicationUrl(`https://example.org/gamut/?x=1#embed=1&${scene}&theme=dark&lock=1`))
      .toBe(`https://example.org/gamut/?x=1#${scene}`)
  })

  it('opens the application without a fragment when there is no scene', () => {
    expect(fullApplicationUrl('https://example.org/gamut/#embed=1')).toBe('https://example.org/gamut/')
    expect(fullApplicationUrl('https://example.org/gamut/')).toBe('https://example.org/gamut/')
  })

  it('reads a transparent or hexadecimal background, and ignores anything else', () => {
    const background = (value: string) => resolveEmbedMode(`#embed=1&bg=${value}`, false)?.background
    expect(background('transparent')).toBe('transparent')
    expect(background('TRANSPARENT')).toBe('transparent')
    expect(background('F5F0E6')).toBe('#f5f0e6')
    expect(background('fff')).toBe('#fff')
    for (const ignored of ['', 'red', '%23ffffff', 'fffff', 'ffffffff', 'url(x)', 'fff;color:red', 'var(--x)'])
      expect(background(ignored)).toBeNull()
    expect(resolveEmbedMode('#embed=1', false)?.background).toBeNull()
    // Outside embed mode the option does nothing.
    expect(resolveEmbedMode('#bg=transparent', false)).toBeNull()
    // The full application drops it with the other display options.
    expect(fullApplicationUrl('https://example.org/gamut/#scene=1.x&bg=transparent')).toBe('https://example.org/gamut/#scene=1.x')
  })
})
