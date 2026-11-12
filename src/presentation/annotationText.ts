/**
 * The restricted Markdown subset of annotation text (language §3, #187).
 *
 * Annotation text comes from shared documents and scene links, so it is
 * untrusted: this parser only produces plain data, which the interface turns
 * into elements. It never produces HTML. The subset is:
 *
 * - `**bold**` and `*italic*`, with flanking delimiters so that `a*b*c`,
 *   `2*3`, and `x_1` stay literal; `_` is never a delimiter;
 * - inline code between backtick runs of the same length;
 * - links `[text](url)` whose scheme is `http`, `https`, or `mailto`; any other
 *   destination leaves the whole link source as plain text;
 * - backslash escapes before `*`, `` ` ``, `[`, `]`, and `\`.
 *
 * Everything else, including raw HTML, images, headings, and lists, is text.
 */
export type AnnotationSegment =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'strong'; children: readonly AnnotationSegment[] }>
  | Readonly<{ kind: 'emphasis'; children: readonly AnnotationSegment[] }>
  | Readonly<{ kind: 'code'; text: string }>
  | Readonly<{ kind: 'link'; href: string; children: readonly AnnotationSegment[] }>

/** The characters a backslash makes literal. */
const ESCAPABLE = new Set(['*', '`', '[', ']', '\\'])

/** Link destinations that become active links; anything else stays text. */
const SAFE_DESTINATION = /^(?:https?:\/\/[^\s/?#]+[^\s]*|mailto:[^\s]+)$/i

/** Whether `href` is a destination an annotation may link to. */
export function isSafeAnnotationHref(href: string): boolean {
  // Control characters are refused before the allow-list, so that no
  // destination can smuggle one past the scheme check.
  const control = [...href].some((character) => character.charCodeAt(0) < 0x20 || character === '\u007f')
  return !control && SAFE_DESTINATION.test(href)
}

/**
 * The text of an annotation source: everything after its first `#`, without
 * the whitespace that follows it. A stored annotation whose source has no `#`
 * (allowed by the document format) keeps its whole source.
 */
export function annotationText(source: string): string {
  const marker = source.indexOf('#')
  const leading = source.slice(0, marker)
  return (marker >= 0 && leading.trim() === '' ? source.slice(marker + 1) : source).trim()
}

type Delimiter = { kind: 'delimiter'; count: number; canOpen: boolean; canClose: boolean }
type Node = AnnotationSegment | Delimiter

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character)
}

function isPunctuation(character: string | undefined): boolean {
  return character !== undefined && /[\p{P}\p{S}]/u.test(character)
}

/** Appends literal text, merging it with a preceding text segment. */
function pushText(nodes: Node[], text: string): void {
  if (text === '') return
  const last = nodes.at(-1)
  if (last?.kind === 'text') nodes[nodes.length - 1] = { kind: 'text', text: last.text + text }
  else nodes.push({ kind: 'text', text })
}

/** The length of the run of `character` starting at `start`. */
function runLength(text: string, start: number, character: string): number {
  let end = start
  while (text[end] === character) end += 1
  return end - start
}

/**
 * The index of the `]` closing the link text that starts after `open`, or -1.
 * Escaped brackets and code spans are skipped; a nested unescaped `[` means
 * the outer bracket is not a link.
 */
function closingBracket(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\' && ESCAPABLE.has(text[index + 1] ?? '')) index += 1
    else if (character === '`') {
      const length = runLength(text, index, '`')
      const close = closingBackticks(text, index + length, length)
      index = close < 0 ? index + length - 1 : close + length - 1
    } else if (character === '[') return -1
    else if (character === ']') return index
  }
  return -1
}

/** The start of the backtick run of exactly `length` closing a code span, or -1. */
function closingBackticks(text: string, from: number, length: number): number {
  for (let index = from; index < text.length;) {
    if (text[index] !== '`') {
      index += 1
      continue
    }
    const run = runLength(text, index, '`')
    if (run === length) return index
    index += run
  }
  return -1
}

/** Splits text into literal text, code, links, and unresolved `*` runs. */
function scan(text: string, allowLinks: boolean): Node[] {
  const nodes: Node[] = []
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '\\' && ESCAPABLE.has(text[index + 1] ?? '')) {
      pushText(nodes, text[index + 1])
      index += 2
      continue
    }
    if (character === '`') {
      const length = runLength(text, index, '`')
      const close = closingBackticks(text, index + length, length)
      if (close < 0) {
        pushText(nodes, '`'.repeat(length))
      } else {
        nodes.push({ kind: 'code', text: text.slice(index + length, close) })
        index = close
      }
      index += length
      continue
    }
    if (character === '[' && allowLinks && text[index - 1] !== '!') {
      const close = closingBracket(text, index)
      if (close >= 0 && text[close + 1] === '(') {
        const end = text.indexOf(')', close + 2)
        const href = end < 0 ? '' : text.slice(close + 2, end)
        if (end >= 0 && href !== '' && !/\s/u.test(href)) {
          if (isSafeAnnotationHref(href)) {
            const children = parseAnnotationMarkdown(text.slice(index + 1, close), false)
            nodes.push({ kind: 'link', href, children: children.length > 0 ? children : [{ kind: 'text', text: href }] })
          } else {
            // An unsafe destination is shown, unrendered, exactly as written.
            pushText(nodes, text.slice(index, end + 1))
          }
          index = end + 1
          continue
        }
      }
    }
    if (character === '*') {
      const count = runLength(text, index, '*')
      const before = index === 0 ? undefined : text[index - 1]
      const after = text[index + count]
      nodes.push({
        kind: 'delimiter',
        count,
        // Opens after the start, a space, or punctuation, before a non-space;
        // closes after a non-space, before a space, punctuation, or the end.
        canOpen: (before === undefined || isWhitespace(before) || isPunctuation(before)) &&
          after !== undefined && !isWhitespace(after),
        canClose: before !== undefined && !isWhitespace(before) &&
          (after === undefined || isWhitespace(after) || isPunctuation(after)),
      })
      index += count
      continue
    }
    pushText(nodes, character)
    index += 1
  }
  return nodes
}

/** Turns leftover delimiters into literal text and merges adjacent text. */
function settle(nodes: readonly Node[]): AnnotationSegment[] {
  const segments: Node[] = []
  for (const node of nodes) {
    if (node.kind === 'delimiter') pushText(segments, '*'.repeat(node.count))
    else if (node.kind === 'text') pushText(segments, node.text)
    else segments.push(node)
  }
  return segments as AnnotationSegment[]
}

/**
 * Pairs `*` runs into emphasis, closer by closer from the left, each with the
 * nearest opener before it; two-star runs on both sides make bold.
 */
function resolveEmphasis(input: readonly Node[]): AnnotationSegment[] {
  let nodes: Node[] = [...input]
  let closerIndex = 0
  while (closerIndex < nodes.length) {
    const closer = nodes[closerIndex]
    if (closer.kind !== 'delimiter' || !closer.canClose || closer.count === 0) {
      closerIndex += 1
      continue
    }
    let openerIndex = closerIndex - 1
    while (openerIndex >= 0) {
      const candidate = nodes[openerIndex]
      if (candidate.kind === 'delimiter' && candidate.canOpen && candidate.count > 0) break
      openerIndex -= 1
    }
    if (openerIndex < 0) {
      closerIndex += 1
      continue
    }
    const opener = nodes[openerIndex] as Delimiter
    const used = opener.count >= 2 && closer.count >= 2 ? 2 : 1
    const wrapped: AnnotationSegment = {
      kind: used === 2 ? 'strong' : 'emphasis',
      children: settle(nodes.slice(openerIndex + 1, closerIndex)),
    }
    const remainingOpener: Node[] = opener.count > used ? [{ ...opener, count: opener.count - used }] : []
    const remainingCloser: Node[] = closer.count > used ? [{ ...closer, count: closer.count - used }] : []
    nodes = [
      ...nodes.slice(0, openerIndex),
      ...remainingOpener,
      wrapped,
      ...remainingCloser,
      ...nodes.slice(closerIndex + 1),
    ]
    closerIndex = openerIndex + remainingOpener.length + 1
  }
  return settle(nodes)
}

/**
 * Parses annotation text (without its `#` marker) into segments. Link text may
 * hold emphasis and code but not another link.
 */
export function parseAnnotationMarkdown(text: string, allowLinks = true): AnnotationSegment[] {
  return resolveEmphasis(scan(text, allowLinks))
}

/** The plain text of segments, as a screen reader reads it: without delimiters. */
export function annotationPlainText(segments: readonly AnnotationSegment[]): string {
  return segments.map((segment) =>
    segment.kind === 'text' || segment.kind === 'code' ? segment.text : annotationPlainText(segment.children)).join('')
}
