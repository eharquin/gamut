import { describe, expect, it } from 'vitest'
import { MAX_SOURCE_LENGTH } from '../document/canonicalDocument'
import {
  annotationPlainText,
  annotationText,
  isSafeAnnotationHref,
  MAX_EMPHASIS_DEPTH,
  parseAnnotationMarkdown,
  safeAnnotationHref,
  type AnnotationSegment,
} from './annotationText'

const text = (value: string): AnnotationSegment => ({ kind: 'text', text: value })
const parse = (source: string) => parseAnnotationMarkdown(source)

describe('annotation text', () => {
  it('takes everything after the first # without the surrounding whitespace', () => {
    expect(annotationText('# Triangle and its angle at A')).toBe('Triangle and its angle at A')
    expect(annotationText('   #était sympa  ')).toBe('était sympa')
    expect(annotationText('## not a heading # still text')).toBe('# not a heading # still text')
    expect(annotationText('#')).toBe('')
    // A stored annotation without # (allowed by the format) keeps its source.
    expect(annotationText('This is prose, not an expression!')).toBe('This is prose, not an expression!')
  })
})

describe('annotation Markdown subset', () => {
  it('keeps plain text as one segment', () => {
    expect(parse('Triangle and its angle at A')).toEqual([text('Triangle and its angle at A')])
    expect(parse('')).toEqual([])
  })

  it('renders bold and italic with flanking delimiters', () => {
    expect(parse('**bold**')).toEqual([{ kind: 'strong', children: [text('bold')] }])
    expect(parse('*italic*')).toEqual([{ kind: 'emphasis', children: [text('italic')] }])
    expect(parse('Titre **gras** et *italique*.')).toEqual([
      text('Titre '),
      { kind: 'strong', children: [text('gras')] },
      text(' et '),
      { kind: 'emphasis', children: [text('italique')] },
      text('.'),
    ])
    expect(parse('(*a*)')).toEqual([text('('), { kind: 'emphasis', children: [text('a')] }, text(')')])
    expect(parse('**bold *and italic***')).toEqual([{
      kind: 'strong', children: [text('bold '), { kind: 'emphasis', children: [text('and italic')] }],
    }])
  })

  it.each([
    'a*b*c',
    '2*3',
    '2 * 3 * 4',
    'x_1 and y_1',
    '_not italic_',
    '__not bold__',
    'A**2 + B**2',
    'R = e12 * e1 * ~R',
    'a * b*',
    '* list item',
    '** half',
    '*not closed',
  ])('leaves mathematical or unmatched text literal: %s', (source) => {
    expect(parse(source)).toEqual([text(source)])
  })

  it('leaves surplus delimiters as literal stars', () => {
    expect(parse('**a*')).toEqual([text('*'), { kind: 'emphasis', children: [text('a')] }])
    expect(parse('*a**')).toEqual([{ kind: 'emphasis', children: [text('a')] }, text('*')])
  })

  it('renders inline code literally, with matching backtick runs', () => {
    expect(parse('use `V = vector(1, 2)` here')).toEqual([
      text('use '), { kind: 'code', text: 'V = vector(1, 2)' }, text(' here'),
    ])
    expect(parse('`*not italic* [x](https://a.b)`')).toEqual([
      { kind: 'code', text: '*not italic* [x](https://a.b)' },
    ])
    expect(parse('``a ` b``')).toEqual([{ kind: 'code', text: 'a ` b' }])
    expect(parse('`\\*`')).toEqual([{ kind: 'code', text: '\\*' }])
    expect(parse('an `unclosed span')).toEqual([text('an `unclosed span')])
  })

  it('applies backslash escapes before *, `, [, ] and \\ only', () => {
    expect(parse('\\*not italic\\*')).toEqual([text('*not italic*')])
    expect(parse('\\`not code\\`')).toEqual([text('`not code`')])
    expect(parse('\\[x\\](https://a.b)')).toEqual([text('[x](https://a.b)')])
    expect(parse('a \\\\ b')).toEqual([text('a \\ b')])
    expect(parse('\\_ \\n \\#')).toEqual([text('\\_ \\n \\#')])
  })

  it('renders links with an http, https or mailto destination', () => {
    expect(parse('see [the docs](https://example.org/a?b=1#c).')).toEqual([
      text('see '),
      { kind: 'link', href: 'https://example.org/a?b=1#c', children: [text('the docs')] },
      text('.'),
    ])
    // The destination is the parsed URL, which is also the one shown.
    expect(parse('[site](HTTP://Example.ORG)')).toEqual([
      { kind: 'link', href: 'http://example.org/', children: [text('site')] },
    ])
    // Balanced parentheses belong to the destination, as in CommonMark.
    expect(parse('[wiki](https://en.wikipedia.org/wiki/Clifford_algebra_(math)).')).toEqual([
      { kind: 'link', href: 'https://en.wikipedia.org/wiki/Clifford_algebra_(math)', children: [text('wiki')] },
      text('.'),
    ])
    expect(parse('[mail](mailto:someone@example.org)')).toEqual([
      { kind: 'link', href: 'mailto:someone@example.org', children: [text('mail')] },
    ])
    expect(parse('[**bold** `code`](https://example.org)')).toEqual([{
      kind: 'link',
      href: 'https://example.org/',
      children: [{ kind: 'strong', children: [text('bold')] }, text(' '), { kind: 'code', text: 'code' }],
    }])
    expect(parse('[](https://example.org)')).toEqual([
      { kind: 'link', href: 'https://example.org/', children: [text('https://example.org/')] },
    ])
  })

  it.each([
    '[click](javascript:alert(1))',
    '[click](JavaScript:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '[click](vbscript:msgbox)',
    '[click](file:///etc/passwd)',
    '[click](//evil.example)',
    '[click](/relative/path)',
    '[click](relative.html)',
    '[click](https://)',
    '[click](&#106;avascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](javascript%3Aalert(1))',
    '[click](http:evil.com)',
    '[click](http:/evil.com)',
    '[click](https:)',
    '[click](mailto:)',
    '[click](ftp://example.org)',
    '[click](blob:https://example.org/1)',
    '[click](https://good.example@evil.example)',
    '[click](https://user:pass@example.org)',
    '[click](https://\\evil.example)',
    '[click](https://\u202eelpmaxe.org)',
    '[click](https://exa\u200bmple.org)',
    '[click](https://\u3000example.org)',
  ])('shows a link with any other destination as plain text: %s', (source) => {
    const segments = parse(source)
    expect(segments.every((segment) => segment.kind === 'text')).toBe(true)
    expect(annotationPlainText(segments)).toBe(source)
  })

  it('does not treat malformed links, nested links, or images as links', () => {
    expect(parse('[text] (https://a.b)')).toEqual([text('[text] (https://a.b)')])
    expect(parse('[text](https://a.b c)')).toEqual([text('[text](https://a.b c)')])
    expect(parse('[a [b](https://a.b)](https://c.d)')).toEqual([
      text('[a '), { kind: 'link', href: 'https://a.b/', children: [text('b')] }, text('](https://c.d)'),
    ])
    expect(parse('![alt](https://example.org/a.png)')).toEqual([text('![alt](https://example.org/a.png)')])
  })

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '&lt;b&gt;',
    '# Heading',
    '- item',
    '1. item',
  ])('keeps raw HTML, entities, headings and lists as text: %s', (source) => {
    expect(parse(source)).toEqual([text(source)])
  })

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', ' javascript:x',
    '\u0000javascript:x', '\u200bjavascript:x', 'javascript%3Aalert(1)', '%6Aavascript:x', '//evil.example',
    '/relative', 'relative', '?q', '#frag', 'http:', 'https:', 'http://', 'https://', 'http:evil.com',
    'http:/evil.com', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', 'mailto:', 'mailto\t:x',
    'https\u0000://x', 'https://x\u0001y', 'https://x\u007fy', 'http://\u00a0', 'https://\u2028x',
    'https://\\evil.example', 'https://good.example@evil.example', 'https://user:pass@x.example',
    'https://\u202eexample.org', 'https://x\u200by', 'http://\u3000x',
  ])('refuses the destination %j', (href) => {
    expect(isSafeAnnotationHref(href)).toBe(false)
  })

  it.each([
    ['https://example.org', 'https://example.org/'],
    ['HTTPS://EXAMPLE.ORG/A?b=c#d', 'https://example.org/A?b=c#d'],
    ['mailto:a@b.example', 'mailto:a@b.example'],
    ['MailTo:a@b.example', 'mailto:a@b.example'],
    ['http://localhost:8080/x', 'http://localhost:8080/x'],
    ['https://a.example/c%20d', 'https://a.example/c%20d'],
    ['https://exämple.org', 'https://xn--exmple-cua.org/'],
  ])('accepts %j as the parsed URL it follows', (href, parsed) => {
    expect(safeAnnotationHref(href)).toBe(parsed)
  })

  it('reads without delimiters', () => {
    expect(annotationPlainText(parse('Titre **gras**, *x*, `code` et [lien](https://a.b)')))
      .toBe('Titre gras, x, code et lien')
  })

  it('limits emphasis nesting', () => {
    const deep = '*a '.repeat(MAX_EMPHASIS_DEPTH + 8) + 'b' + '*'.repeat(1)
    let depth = 0
    let segments: readonly AnnotationSegment[] = parse(deep)
    for (;;) {
      const nested = segments.find((segment) => segment.kind === 'emphasis' || segment.kind === 'strong')
      if (!nested || !('children' in nested)) break
      depth += 1
      segments = nested.children
    }
    expect(depth).toBeLessThanOrEqual(MAX_EMPHASIS_DEPTH)
    expect(annotationPlainText(parse(deep)).length).toBeGreaterThan(0)
  })
})

describe('annotation parsing time', () => {
  // Sources at the document limit must not stall the interface: the parser
  // is linear, so each of these takes milliseconds; the bound is generous.
  const n = MAX_SOURCE_LENGTH
  it.each([
    ['openers and brackets', '*['.repeat(n / 2)],
    ['nested openers then closers', '*a '.repeat(Math.floor(n / 6)) + 'b* '.repeat(Math.floor(n / 6))],
    ['closers', 'a* '.repeat(Math.floor(n / 3))],
    ['openers', ' *a'.repeat(Math.floor(n / 3))],
    ['unclosed links', '[a](x'.repeat(Math.floor(n / 5))],
    ['unclosed parentheses', '[a](https://x.example/' + '('.repeat(n - 30)],
    ['backtick runs', Array.from({ length: 300 }, (_, index) => '`'.repeat(index + 1) + 'a').join('').slice(0, n)],
    ['unclosed bracket', '[' + 'a'.repeat(n - 1)],
    ['backslashes', '\\'.repeat(n)],
  ])('parses %s quickly', (_, source) => {
    expect(source.length).toBeLessThanOrEqual(n)
    const start = performance.now()
    parse(source)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
