import { useEffect, useRef, useState } from 'react'

/** Longest TeX source rendered, in UTF-16 code units; a longer one is shown as its source. */
export const MAX_MATH_SOURCE_LENGTH = 2_000
/** Most mathematics segments rendered in one note; further ones are shown as their source. */
export const MAX_MATH_SEGMENTS = 200
/** Macro expansions KaTeX may perform for one segment. */
const MAX_MATH_EXPANSIONS = 1_000
/** Largest size, in ems, a TeX command may ask for. */
const MAX_MATH_SIZE = 10

type Katex = typeof import('katex').default

let loading: Promise<Katex> | null = null

/**
 * KaTeX and its style sheet, fetched once, when the first note with
 * mathematics is shown, so that documents without mathematics do not pay for
 * it. The fonts are served with the application, not from a third party.
 */
function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => module.default)
  // A failed load may be retried by the next segment.
  loading.catch(() => { loading = null })
  return loading
}

type MathTextProps = Readonly<{ tex: string; display: boolean }>

/**
 * Mathematics of a note, typeset by KaTeX (language §3, SEC-012). Note text
 * is untrusted: KaTeX builds DOM nodes into the target element, no HTML
 * string is parsed, `trust` is off, so that commands such as `\href`,
 * `\includegraphics`, and `\htmlData` are refused, and macro expansion and
 * sizes are bounded. Until KaTeX has loaded, and if it cannot load or
 * typeset, the TeX source shows as code.
 */
export function MathText({ tex, display }: MathTextProps) {
  const target = useRef<HTMLSpanElement>(null)
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadKatex().then((katex) => {
      const element = target.current
      if (cancelled || !element) return
      try {
        katex.render(tex, element, {
          displayMode: display,
          output: 'htmlAndMathml',
          throwOnError: false,
          trust: false,
          strict: 'ignore',
          maxExpand: MAX_MATH_EXPANSIONS,
          maxSize: MAX_MATH_SIZE,
        })
        setRendered(true)
      } catch {
        element.textContent = ''
        setRendered(false)
      }
    }, () => undefined)
    return () => { cancelled = true }
  }, [tex, display])

  return (
    <span className={`note-math${display ? ' is-display' : ''}`}>
      <code className="note-math-source" hidden={rendered}>{tex}</code>
      {/* KaTeX owns the children of this element; React gives it none. */}
      <span ref={target} className="note-math-rendered" hidden={!rendered} />
    </span>
  )
}
