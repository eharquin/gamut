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
 * - links `[text](url)` whose destination is an absolute `http` or `https`
 *   URL or a `mailto` URL; any other destination leaves the whole link source
 *   as plain text;
 * - backslash escapes before `*`, `` ` ``, `[`, `]`, and `\`.
 *
 * Everything else, including raw HTML, images, headings, and lists, is text.
 * Parsing takes time linear in the text length, so a source at the document
 * source limit cannot stall the interface.
 */
export type AnnotationSegment =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'strong'; children: readonly AnnotationSegment[] }>
  | Readonly<{ kind: 'emphasis'; children: readonly AnnotationSegment[] }>
  | Readonly<{ kind: 'code'; text: string }>
  | Readonly<{ kind: 'link'; href: string; children: readonly AnnotationSegment[] }>

/** The characters a backslash makes literal. */
const ESCAPABLE = new Set(['*', '`', '[', ']', '\\'])

/** Deepest emphasis nesting; further openers stay literal stars. */
export const MAX_EMPHASIS_DEPTH = 32
/** Longest link destination, in UTF-16 code units; longer ones stay text. */
export const MAX_LINK_DESTINATION_LENGTH = 2048
/** Deepest parenthesis nesting inside a link destination, as in CommonMark. */
const MAX_DESTINATION_PARENTHESES = 32

/**
 * Characters refused anywhere in a destination: controls, format characters
 * such as bidirectional overrides and zero-width spaces, separators, and
 * whitespace, which could make the shown destination differ from the one
 * followed; and the backslash, which URL parsing reads as a slash.
 */
const SPOOFING_CHARACTER = /[\p{Cc}\p{Cf}\p{Z}\s\\]/u

/**
 * The destination an annotation link follows, or `null` when the raw
 * destination is not allowed. Only absolute `http:` and `https:` URLs with a
 * host and no user information, and non-empty `mailto:` URLs, are allowed.
 * The result is the parsed URL, so the destination shown in the tooltip and
 * the accessible description is exactly the one followed.
 */
export function safeAnnotationHref(raw: string): string | null {
  if (SPOOFING_CHARACTER.test(raw) || !/^(?:https?:\/\/|mailto:)/i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol === 'mailto:') return url.pathname === '' ? null : url.href
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '' || url.username !== '' || url.password !== '') return null
  return url.href
}

/** Whether `raw` is a destination an annotation may link to. */
export function isSafeAnnotationHref(raw: string): boolean {
  return safeAnnotationHref(raw) !== null
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
 * The backtick runs of a text by length, each list in increasing position,
 * so that finding the run closing a code span is a binary search.
 */
function backtickRuns(text: string): Map<number, number[]> {
  const runs = new Map<number, number[]>()
  for (let index = 0; index < text.length;) {
    if (text[index] !== '`') {
      index += 1
      continue
    }
    const length = runLength(text, index, '`')
    const starts = runs.get(length)
    if (starts) starts.push(index)
    else runs.set(length, [index])
    index += length
  }
  return runs
}

/** The start of the first backtick run of exactly `length` at or after `from`, or -1. */
function closingBackticks(runs: Map<number, number[]>, from: number, length: number): number {
  const starts = runs.get(length)
  if (!starts) return -1
  let low = 0
  let high = starts.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (starts[middle] < from) low = middle + 1
    else high = middle
  }
  return low < starts.length ? starts[low] : -1
}

/**
 * The index of the `]` closing the link text that starts after `open`, or -1.
 * Escaped brackets and code spans are skipped; a nested unescaped `[` means
 * the outer bracket is not a link.
 */
function closingBracket(text: string, open: number, runs: Map<number, number[]>): number {
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\' && ESCAPABLE.has(text[index + 1] ?? '')) index += 1
    else if (character === '`') {
      const length = runLength(text, index, '`')
      const close = closingBackticks(runs, index + length, length)
      index = close < 0 ? index + length - 1 : close + length - 1
    } else if (character === '[') return -1
    else if (character === ']') return index
  }
  return -1
}

/**
 * The index of the `)` ending a link destination that starts at `start`, or
 * -1. Balanced parentheses belong to the destination, as in CommonMark;
 * whitespace ends the search, and so do the length and nesting limits.
 */
function destinationEnd(text: string, start: number): number {
  let depth = 0
  const limit = Math.min(text.length, start + MAX_LINK_DESTINATION_LENGTH + 1)
  for (let index = start; index < limit; index += 1) {
    const character = text[index]
    if (isWhitespace(character)) return -1
    if (character === '(') {
      depth += 1
      if (depth > MAX_DESTINATION_PARENTHESES) return -1
    } else if (character === ')') {
      if (depth === 0) return index === start ? -1 : index
      depth -= 1
    }
  }
  return -1
}

/** Splits text into literal text, code, links, and unresolved `*` runs. */
function scan(text: string, allowLinks: boolean): Node[] {
  const runs = backtickRuns(text)
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
      const close = closingBackticks(runs, index + length, length)
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
      const close = closingBracket(text, index, runs)
      const end = close >= 0 && text[close + 1] === '(' ? destinationEnd(text, close + 2) : -1
      if (end >= 0) {
        const href = safeAnnotationHref(text.slice(close + 2, end))
        if (href !== null) {
          const children = parseAnnotationMarkdown(text.slice(index + 1, close), false)
          nodes.push({ kind: 'link', href, children: children.length > 0 ? children : [{ kind: 'text', text: href }] })
        } else {
          // A refused destination is shown, unrendered, exactly as written.
          pushText(nodes, text.slice(index, end + 1))
        }
        index = end + 1
        continue
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
 * Pairs `*` runs into emphasis in one pass: each closer pairs with the nearest
 * open opener before it, kept on a stack; two-star runs on both sides make
 * bold. Every node is moved into a wrapper at most once, so the pass is
 * linear. Openers beyond the depth limit stay literal.
 */
function resolveEmphasis(input: readonly Node[]): AnnotationSegment[] {
  const output: Node[] = []
  const openers: { index: number; delimiter: Delimiter }[] = []
  for (const node of input) {
    if (node.kind !== 'delimiter') {
      output.push(node)
      continue
    }
    const delimiter: Delimiter = { ...node }
    if (delimiter.canClose) {
      while (delimiter.count > 0 && openers.length > 0) {
        const opener = openers[openers.length - 1]
        const used = opener.delimiter.count >= 2 && delimiter.count >= 2 ? 2 : 1
        const children = settle(output.splice(opener.index + 1))
        opener.delimiter.count -= used
        delimiter.count -= used
        if (opener.delimiter.count === 0) {
          output.pop()
          openers.pop()
        }
        output.push({ kind: used === 2 ? 'strong' : 'emphasis', children })
      }
    }
    if (delimiter.count === 0) continue
    output.push(delimiter)
    if (delimiter.canOpen && openers.length < MAX_EMPHASIS_DEPTH)
      openers.push({ index: output.length - 1, delimiter })
  }
  return settle(output)
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
