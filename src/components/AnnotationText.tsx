import { Fragment, useMemo, type ReactNode } from 'react'
import { parseAnnotationMarkdown, type AnnotationSegment } from '../presentation/annotationText'

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

type AnnotationTextProps = Readonly<{
  id: string
  /** The annotation text, after its `#` marker. */
  text: string
}>

/** The rendered text of an annotation row, in the restricted Markdown subset. */
export function AnnotationText({ id, text }: AnnotationTextProps) {
  const segments = useMemo(() => parseAnnotationMarkdown(text), [text])
  return (
    <p id={id} className="annotation-text">
      {renderSegments(segments, id)}
    </p>
  )
}
