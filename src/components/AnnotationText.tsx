import { Fragment, useMemo, type ReactNode } from 'react'
import { parseAnnotationBlocks, type AnnotationBlock, type AnnotationList } from '../presentation/annotationBlocks'
import type { AnnotationSegment } from '../presentation/annotationText'

/**
 * Builds React elements from parsed segments. Text only ever becomes text
 * nodes: nothing here parses or injects HTML (SEC-002, #187).
 */
function renderSegments(segments: readonly AnnotationSegment[], idPrefix: string): ReactNode[] {
  return segments.map((segment, index) => {
    const key = `${idPrefix}-${index}`
    switch (segment.kind) {
      case 'text':
        return <Fragment key={key}>{segment.text}</Fragment>
      case 'strong':
        return <strong key={key}>{renderSegments(segment.children, key)}</strong>
      case 'emphasis':
        return <em key={key}>{renderSegments(segment.children, key)}</em>
      case 'code':
        return <code key={key}>{segment.text}</code>
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
            >{renderSegments(segment.children, key)}</a>
            <span id={descriptionId} hidden>{newTab ? `${segment.href} (opens in a new tab)` : segment.href}</span>
          </Fragment>
        )
      }
    }
  })
}

function renderList(list: AnnotationList, key: string): ReactNode {
  const items = list.items.map((item, index) => (
    <li key={`${key}-${index}`}>
      {renderSegments(item.children, `${key}-${index}`)}
      {item.sublist && renderList(item.sublist, `${key}-${index}-sub`)}
    </li>
  ))
  return list.ordered
    ? <ol key={key} start={list.start}>{items}</ol>
    : <ul key={key}>{items}</ul>
}

/** The elements of blocks. A note sits below the headings of the panel, so its headings start at level 4. */
function renderBlocks(blocks: readonly AnnotationBlock[], idPrefix: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${idPrefix}-b${index}`
    switch (block.kind) {
      case 'paragraph':
        return <p key={key}>{renderSegments(block.children, key)}</p>
      case 'heading': {
        const Heading = (['h4', 'h5', 'h6'] as const)[block.level - 1]
        return <Heading key={key} className={`note-heading-${block.level}`}>{renderSegments(block.children, key)}</Heading>
      }
      case 'list':
        return renderList(block, key)
      case 'quote':
        return <blockquote key={key}>{renderBlocks(block.children, key)}</blockquote>
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
      {renderBlocks(blocks, id)}
    </div>
  )
}
