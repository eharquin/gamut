import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { isSafeAnnotationHref } from '../presentation/annotationText'
import { AnnotationText } from './AnnotationText'

afterEach(cleanup)

const ALLOWED_ELEMENTS = ['DIV', 'P', 'STRONG', 'EM', 'CODE', 'A', 'SPAN', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR']
const ALLOWED_ATTRIBUTES = ['id', 'class', 'href', 'target', 'rel', 'title', 'aria-describedby', 'hidden', 'start']

describe('rendered annotation text (SEC-012)', () => {
  it.each([
    '[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](java\tscript:alert(1))',
    '[x](&#106;avascript:alert(1))', '[x](javascript%3Aalert(1))', '[x](//evil.example)',
    '[x](data:text/html,hi)', '[x]( https://a.example)', '[x](<https://a.example>)',
    '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>', '&lt;b&gt;',
    '![i](https://a.example/x.png)', '[**b**](https://a.example)', '[[x](https://a.example)](https://c.example)',
    '[`[x](javascript:1)`](https://a.example)', '`[x](javascript:1)`', '\\[x](https://a.example)',
    '[x](https://a.example "title")', '[x](https://a.example/"onmouseover="alert(1))',
    '[x](https://good.example@evil.example)', '[x](https://\u202eelpmaxe.org)',
    '# heading', '- list', '> quote', '***', '<script>alert(1)</script>',
    '[x](https://a.example)\u0000', '[x](mailto:a@b.example?subject=<script>)',
    '# [x](javascript:alert(1))', '- <img src=x onerror=alert(1)>\n  - [x](data:text/html,hi)', '> <script>alert(1)</script>',
    '```html\n<script>alert(1)</script>\n```', '```"onmouseover="alert(1)\nx', '7. <b>x</b>', '1) [x](//evil.example)',
  ])('builds only allowed elements and attributes for %j', (text) => {
    const { container } = render(<AnnotationText id="note" text={text} />)
    for (const element of container.querySelectorAll('*')) {
      expect(ALLOWED_ELEMENTS).toContain(element.tagName)
      for (const attribute of element.getAttributeNames()) expect(ALLOWED_ATTRIBUTES).toContain(attribute)
    }
    for (const link of container.querySelectorAll('a')) {
      const href = link.getAttribute('href')!
      expect(isSafeAnnotationHref(href)).toBe(true)
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.getAttribute('title')).toBe(href)
      expect(link.getAttribute('target')).toBe(href.startsWith('mailto:') ? null : '_blank')
    }
  })

  it('opens web links in a new tab and mail links in place, both exposing their destination', () => {
    const { getByRole } = render(
      <AnnotationText id="note" text="[site](https://example.org/a) or [mail](mailto:a@b.example)" />,
    )
    const site = getByRole('link', { name: 'site' })
    expect(site).toHaveAttribute('target', '_blank')
    expect(site).toHaveAccessibleDescription('https://example.org/a (opens in a new tab)')
    const mail = getByRole('link', { name: 'mail' })
    expect(mail).not.toHaveAttribute('target')
    expect(mail).toHaveAttribute('rel', 'noopener noreferrer')
    expect(mail).toHaveAccessibleDescription('mailto:a@b.example')
  })

  it('typesets mathematics with KaTeX once it has loaded, showing the source until then', async () => {
    const { container } = render(<AnnotationText id="note" text={'Rotor $R = e^{-\\theta B/2}$\n\n$$\\frac{a}{b}$$'} />)
    const sources = [...container.querySelectorAll('.note-math-source')]
    expect(sources.map((source) => source.textContent)).toEqual(['R = e^{-\\theta B/2}', '\\frac{a}{b}'])
    expect(sources[0]).not.toHaveAttribute('hidden')
    await waitFor(() => expect(container.querySelectorAll('.katex')).toHaveLength(2))
    expect(sources[0]).toHaveAttribute('hidden')
    // Display mathematics is typeset in display mode, with MathML for assistive technology.
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(container.querySelector('.katex math')).not.toBeNull()
    expect(container.querySelector('.katex annotation')).toHaveTextContent('R = e^{-\\theta B/2}')
  })

  it.each([
    '$\\href{javascript:alert(1)}{x}$', '$\\url{javascript:alert(1)}$', '$\\includegraphics{https://a.example/x.png}$',
    '$\\htmlData{onclick=alert(1)}{x}$', '$\\htmlId{note}{x}$', '$\\htmlStyle{background:url(https://a.example)}{x}$',
    '$\\htmlClass{library-panel}{x}$', '$<script>alert(1)</script>$', '$\\text{<img src=x onerror=alert(1)>}$',
    '$\\def\\a{\\a\\a}\\a$', '$\\rule{9999em}{9999em}$', '$\\unknowncommand$', '$$\\begin{matrix}$$',
  ])('typesets untrusted TeX %j without links, images, scripts, handlers, or identities', async (text) => {
    const { container } = render(<AnnotationText id="note" text={text} />)
    await waitFor(() => expect(container.querySelector('.note-math-rendered')?.childElementCount).toBeGreaterThan(0))
    expect(container.querySelector('a, img, script, iframe, object, embed, link, style, form, input')).toBeNull()
    for (const element of container.querySelectorAll('.note-math-rendered *')) {
      for (const attribute of element.getAttributeNames()) {
        expect(attribute).not.toMatch(/^on|^id$|^href$|^src$|^data-/)
        if (attribute === 'style') expect(element.getAttribute('style')).not.toMatch(/url\(|expression|javascript/i)
        if (attribute === 'class') expect(element.getAttribute('class')).not.toContain('library-panel')
      }
    }
    // A size beyond the limit is clamped.
    for (const element of container.querySelectorAll<HTMLElement>('.note-math-rendered [style]'))
      for (const size of element.getAttribute('style')!.matchAll(/([\d.]+)em/g)) expect(Number(size[1])).toBeLessThanOrEqual(20)
  })

  it('shows mathematics past the limits of a note as its source', async () => {
    const { container } = render(<AnnotationText id="note" text={`${'$x$ '.repeat(201)}$${'y'.repeat(2001)}$`} />)
    await waitFor(() => expect(container.querySelectorAll('.katex')).toHaveLength(200))
    expect(container.querySelectorAll('.note-math')).toHaveLength(200)
    expect(container.querySelectorAll('.annotation-text > p > code.note-math-source')).toHaveLength(2)
  })
})
