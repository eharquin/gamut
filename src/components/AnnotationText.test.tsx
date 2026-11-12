import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { isSafeAnnotationHref } from '../presentation/annotationText'
import { AnnotationText } from './AnnotationText'

afterEach(cleanup)

const ALLOWED_ELEMENTS = ['P', 'STRONG', 'EM', 'CODE', 'A', 'SPAN']
const ALLOWED_ATTRIBUTES = ['id', 'class', 'href', 'target', 'rel', 'title', 'aria-describedby', 'hidden']

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
})
