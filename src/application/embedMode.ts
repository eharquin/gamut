/**
 * Embed mode (#215): the canvas alone, for a scene shown in a presentation
 * iframe. Display options are read from the scene-link fragment next to
 * `scene`, without decoding the scene itself; unknown options and values are
 * ignored.
 */
export type EmbedOptions = Readonly<{
  /** `theme=light|dark` overrides the document theme for this view only. */
  theme: 'light' | 'dark' | null
  /** `lock=1` opens with the viewport locked: objects stay draggable. */
  viewportLocked: boolean
}>

/**
 * Whether the page runs inside a frame. Reading `top` across origins may
 * throw in some browsers; a page that cannot see its top window is framed.
 */
export function isFramed(view: Readonly<{ self: unknown; top: unknown }>): boolean {
  try {
    return view.self !== view.top
  } catch {
    return true
  }
}

function fragmentOptions(fragment: string): Map<string, string> {
  const options = new Map<string, string>()
  for (const part of fragment.replace(/^#/, '').split('&')) {
    const separator = part.indexOf('=')
    const key = separator < 0 ? part : part.slice(0, separator)
    // The scene payload is neither decoded nor kept here; its checks belong to the scene link.
    if (key === 'scene' || options.has(key)) continue
    options.set(key, separator < 0 ? '' : part.slice(separator + 1))
  }
  return options
}

/**
 * The embed options, or `null` outside embed mode. Embed mode turns on in a
 * frame; `embed=1` forces it outside one and `embed=0` turns it off inside one.
 */
export function resolveEmbedMode(fragment: string, framed: boolean): EmbedOptions | null {
  const options = fragmentOptions(fragment)
  const embed = options.get('embed')
  const active = embed === '1' ? true : embed === '0' ? false : framed
  if (!active) return null
  const theme = options.get('theme')
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : null,
    viewportLocked: options.get('lock') === '1',
  }
}

/**
 * The address of the full application with the same scene: the `scene`
 * entry of the fragment is kept as written, and every display option, such
 * as `embed`, is dropped.
 */
export function fullApplicationUrl(href: string): string {
  const url = new URL(href)
  const scene = url.hash.replace(/^#/, '').split('&')
    .filter((part) => part === 'scene' || part.startsWith('scene='))
  url.hash = scene.length ? '#' + scene.join('&') : ''
  return url.href
}
