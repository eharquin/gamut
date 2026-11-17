import { Fragment, useMemo, type ReactNode } from 'react'
import { parseAnnotationBlocks, type AnnotationBlock, type AnnotationList } from '../presentation/annotationBlocks'
import { parseAnnotationMarkdown, type AnnotationSegment } from '../presentation/annotationText'
import { MathText, MAX_MATH_SEGMENTS, MAX_MATH_SOURCE_LENGTH } from './MathText'

/** How many more mathematics segments of the note are typeset. */
type MathBudget = { remaining: number }

/**
 * Builds React elements from parsed segments. Text only ever becomes text
 * nodes: nothing here parses or injects HTML (SEC-002, #187).
 */
function renderSegments(segments: readonly AnnotationSegment[], idPrefix: string, budget: MathBudget): ReactNode[] {
  return segments.map((segment, index) => {
    const key = `${idPrefix}-${index}`
    switch (segment.kind) {
      case 'text':
        return <Fragment key={key}>{segment.text}</Fragment>
      case 'strong':
        return <strong key={key}>{renderSegments(segment.children, key, budget)}</strong>
      case 'emphasis':
        return <em key={key}>{renderSegments(segment.children, key, budget)}</em>
      case 'code':
        return <code key={key}>{segment.text}</code>
      case 'math': {
        // Past the limits of a note, mathematics shows as its source.
        if (segment.tex.length > MAX_MATH_SOURCE_LENGTH || budget.remaining <= 0)
          return <code key={key} className="note-math-source">{segment.tex}</code>
        budget.remaining -= 1
        return <MathText key={key} tex={segment.tex} display={segment.display} />
      }
      case 'link': {
        // The destination is shown in a tooltip and the accessible
        // description, so the link text cannot hide where it leads.
        // A mail link opens the mail client, not a new tab.
        const descriptionId = `${key}-destination`
        const newTab = !segment.href.startsWith('mailto:')
        return (
          <Fragment key={key}>
            <a
              href={segment.href}
              target={newTab ? '_blank' : undefined}
              rel="noopener noreferrer"
              title={segment.href}
              aria-describedby={descriptionId}
            >{renderSegments(segment.children, key, budget)}</a>
            <span id={descriptionId} hidden>{newTab ? `${segment.href} (opens in a new tab)` : segment.href}</span>
          </Fragment>
        )
      }
    }
  })
}

function renderList(list: AnnotationList, key: string, budget: MathBudget): ReactNode {
  const items = list.items.map((item, index) => (
    <li key={`${key}-${index}`}>
      {renderSegments(item.children, `${key}-${index}`, budget)}
      {item.sublist && renderList(item.sublist, `${key}-${index}-sub`, budget)}
    </li>
  ))
  return list.ordered
    ? <ol key={key} start={list.start}>{items}</ol>
    : <ul key={key}>{items}</ul>
}

/** The elements of blocks. A note sits below the headings of the panel, so its headings start at level 4. */
function renderBlocks(blocks: readonly AnnotationBlock[], idPrefix: string, budget: MathBudget): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${idPrefix}-b${index}`
    switch (block.kind) {
      case 'paragraph':
        return <p key={key}>{renderSegments(block.children, key, budget)}</p>
      case 'heading': {
        const Heading = (['h4', 'h5', 'h6'] as const)[block.level - 1]
        return <Heading key={key} className={`note-heading-${block.level}`}>{renderSegments(block.children, key, budget)}</Heading>
      }
      case 'list':
        return renderList(block, key, budget)
      case 'quote':
        return <blockquote key={key}>{renderBlocks(block.children, key, budget)}</blockquote>
      case 'code':
        return <pre key={key}><code>{block.text}</code></pre>
      case 'rule':
        return <hr key={key} />
    }
  })
}

type AnnotationTextProps = Readonly<{
  id: string
  /** The text of the note. */
  text: string
}>

/** The rendered text of a note, in the restricted Markdown subset (language §3). */
export function AnnotationText({ id, text }: AnnotationTextProps) {
  const blocks = useMemo(() => parseAnnotationBlocks(text), [text])
  return (
    <div id={id} className="annotation-text">
      {renderBlocks(blocks, id, { remaining: MAX_MATH_SEGMENTS })}
    </div>
  )
}

/** The most mathematics segments typeset in one inline text, such as a folder name. */
const MAX_INLINE_MATH_SEGMENTS = 8

/**
 * One line of the inline subset without links, such as an expression folder
 * name (DOC-013): bold, italic, code, and mathematics. A click on it must
 * stay with the control that holds it, so it has no link.
 */
export function InlineMarkdown({ id, text }: Readonly<{ id: string; text: string }>) {
  const segments = useMemo(() => parseAnnotationMarkdown(text, false), [text])
  return <>{renderSegments(segments, id, { remaining: MAX_INLINE_MATH_SEGMENTS })}</>
}
