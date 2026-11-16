import { annotationPlainText, parseAnnotationMarkdown, type AnnotationSegment } from './annotationText'

/**
 * The block layer of annotation text (language §3): a note is a sequence of
 * blocks whose text is the inline subset of `annotationText.ts`.
 *
 * - headings `#`, `##`, `###` followed by a space;
 * - paragraphs, whose line breaks are kept;
 * - bullet lists (`-`, `*`, `+`) and numbered lists (`1.`, `1)`), with one
 *   nested level for items indented by two spaces or more;
 * - quotes, lines starting with `>`, which hold blocks;
 * - code blocks between fences of three or more backticks or tildes, shown
 *   as written;
 * - rules, a line of three or more `-`, `*`, or `_`;
 * - display mathematics: from a line that starts with `$$` to the line that
 *   holds the closing `$$`, the lines are one paragraph and are never read as
 *   other blocks, so that a line of TeX may start with `-` or `>`.
 *
 * Like the inline layer, this parser only produces plain data, never HTML,
 * and takes time linear in the text length: no pattern here can backtrack
 * over a long line, and quotes nest to a fixed depth.
 */
export type AnnotationListItem = Readonly<{ children: readonly AnnotationSegment[]; sublist: AnnotationList | null }>
export type AnnotationList = Readonly<{ kind: 'list'; ordered: boolean; start: number; items: readonly AnnotationListItem[] }>
export type AnnotationBlock =
  | Readonly<{ kind: 'paragraph'; children: readonly AnnotationSegment[] }>
  | Readonly<{ kind: 'heading'; level: 1 | 2 | 3; children: readonly AnnotationSegment[] }>
  | AnnotationList
  | Readonly<{ kind: 'quote'; children: readonly AnnotationBlock[] }>
  | Readonly<{ kind: 'code'; text: string }>
  | Readonly<{ kind: 'rule' }>

/** Deepest quote nesting; a deeper `>` is text of the innermost quote. */
export const MAX_QUOTE_DEPTH = 8

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const LIST_ITEM = /^( *)([-+*]|\d{1,9}[.)])[ \t]+(.*)$/
const INDENTED = /^ {2,}\S/

const isBlank = (line: string) => line.trim() === ''

/** The fence a line opens: its character and length, or null. */
function openingFence(line: string): Readonly<{ character: string; length: number }> | null {
  const match = FENCE.exec(line)
  // The text after a backtick fence cannot hold a backtick, or the line is inline code.
  if (!match || (match[1][0] === '`' && match[2].includes('`'))) return null
  return { character: match[1][0], length: match[1].length }
}

function closesFence(line: string, fence: Readonly<{ character: string; length: number }>): boolean {
  const text = line.trim()
  if (text.length < fence.length || line.length - line.trimStart().length > 3) return false
  for (const character of text) if (character !== fence.character) return false
  return true
}

/** Three or more of one of `-`, `*`, `_`, alone on the line, spaces allowed between them. */
function isRule(line: string): boolean {
  if (line.length - line.trimStart().length > 3) return false
  let marker = ''
  let count = 0
  for (const character of line) {
    if (character === ' ' || character === '\t') continue
    if (marker === '') {
      if (character !== '-' && character !== '*' && character !== '_') return false
      marker = character
    } else if (character !== marker) return false
    count += 1
  }
  return count >= 3
}

/** The level and text of a heading line, or null. */
function heading(line: string): Readonly<{ level: 1 | 2 | 3; text: string }> | null {
  const start = line.length - line.trimStart().length
  if (start > 3 || line[start] !== '#') return null
  let level = 0
  while (line[start + level] === '#') level += 1
  const after = line[start + level]
  if (level > 3 || (after !== ' ' && after !== '\t')) return null
  let text = line.slice(start + level).trim()
  // A closing run of # after a space is not part of the text.
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end -= 1
  if (end < text.length && (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t')) text = text.slice(0, end).trimEnd()
  return text === '' ? null : { level: level as 1 | 2 | 3, text }
}

function isQuote(line: string): boolean {
  const start = line.length - line.trimStart().length
  return start <= 3 && line[start] === '>'
}

type Marker = Readonly<{ indent: number; ordered: boolean; start: number; text: string }>

function listMarker(line: string): Marker | null {
  const match = LIST_ITEM.exec(line)
  if (!match) return null
  const ordered = match[2].length > 1
  return { indent: match[1].length, ordered, start: ordered ? Number.parseInt(match[2], 10) : 1, text: match[3] }
}

/** Whether a line ends the paragraph before it by starting another block. */
function interruptsParagraph(line: string, quotes: boolean): boolean {
  if (openingFence(line) || isRule(line) || heading(line) || (quotes && isQuote(line)) || line.trimStart().startsWith('$$')) return true
  const marker = listMarker(line)
  // As in CommonMark, only a list that starts at 1 interrupts a paragraph: "2026. was…" stays text.
  return marker !== null && marker.indent < 2 && (!marker.ordered || marker.start === 1)
}

type DraftItem = { lines: string[]; sublist: { ordered: boolean; start: number; items: DraftItem[] } | null }

function finishItem(item: DraftItem): AnnotationListItem {
  return {
    children: parseAnnotationMarkdown(item.lines.join('\n')),
    sublist: item.sublist && {
      kind: 'list', ordered: item.sublist.ordered, start: item.sublist.start, items: item.sublist.items.map(finishItem),
    },
  }
}

function parseLines(lines: readonly string[], depth: number): AnnotationBlock[] {
  const blocks: AnnotationBlock[] = []
  const quotes = depth < MAX_QUOTE_DEPTH
  /** No later line closes display mathematics: a line that holds `$$` closes any opener before it. */
  let displayExhausted = false
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (isBlank(line)) {
      index += 1
      continue
    }
    if (!displayExhausted && line.trimStart().startsWith('$$')) {
      let end = line.indexOf('$$', line.indexOf('$$') + 2) >= 0 ? index : index + 1
      while (end > index && end < lines.length && !lines[end].includes('$$')) end += 1
      if (end < lines.length) {
        blocks.push({ kind: 'paragraph', children: parseAnnotationMarkdown(lines.slice(index, end + 1).map((each) => each.trim()).join('\n')) })
        index = end + 1
        continue
      }
      displayExhausted = true
    }
    const fence = openingFence(line)
    if (fence) {
      const start = index + 1
      index = start
      while (index < lines.length && !closesFence(lines[index], fence)) index += 1
      blocks.push({ kind: 'code', text: lines.slice(start, index).join('\n') })
      // An unclosed fence runs to the end of the note.
      index += 1
      continue
    }
    if (isRule(line)) {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    const title = heading(line)
    if (title) {
      blocks.push({ kind: 'heading', level: title.level, children: parseAnnotationMarkdown(title.text) })
      index += 1
      continue
    }
    if (quotes && isQuote(line)) {
      const inner: string[] = []
      while (index < lines.length && isQuote(lines[index])) {
        const text = lines[index].trimStart().slice(1)
        inner.push(text.startsWith(' ') ? text.slice(1) : text)
        index += 1
      }
      blocks.push({ kind: 'quote', children: parseLines(inner, depth + 1) })
      continue
    }
    const first = listMarker(line)
    if (first && first.indent < 2) {
      const items: DraftItem[] = []
      while (index < lines.length) {
        const current = lines[index]
        const marker = isRule(current) ? null : listMarker(current)
        const last = items.at(-1)
        if (marker && marker.indent < 2) {
          if (marker.ordered !== first.ordered) break
          items.push({ lines: [marker.text], sublist: null })
        } else if (marker && last) {
          if (!last.sublist) last.sublist = { ordered: marker.ordered, start: marker.start, items: [] }
          last.sublist.items.push({ lines: [marker.text], sublist: null })
        } else if (last && INDENTED.test(current)) {
          // An indented line continues the item above it.
          (last.sublist?.items.at(-1) ?? last).lines.push(current.trim())
        } else break
        index += 1
      }
      blocks.push({ kind: 'list', ordered: first.ordered, start: first.start, items: items.map(finishItem) })
      continue
    }
    const paragraph: string[] = [line.trim()]
    index += 1
    while (index < lines.length && !isBlank(lines[index]) && !interruptsParagraph(lines[index], quotes)) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', children: parseAnnotationMarkdown(paragraph.join('\n')) })
  }
  return blocks
}

/** The blocks of an annotation text. */
export function parseAnnotationBlocks(text: string): AnnotationBlock[] {
  return parseLines(text.split(/\r\n?|\n/), 0)
}

/** The plain text of blocks, as a screen reader reads a note: without delimiters, mathematics as its TeX source. */
export function annotationBlocksPlainText(blocks: readonly AnnotationBlock[]): string {
  const listText = (list: AnnotationList): string => list.items.map((item) =>
    annotationPlainText(item.children) + (item.sublist ? `\n${listText(item.sublist)}` : '')).join('\n')
  return blocks.map((block) => {
    switch (block.kind) {
      case 'paragraph':
      case 'heading': return annotationPlainText(block.children)
      case 'list': return listText(block)
      case 'quote': return annotationBlocksPlainText(block.children)
      case 'code': return block.text
      case 'rule': return ''
    }
  }).filter((text) => text !== '').join('\n')
}
