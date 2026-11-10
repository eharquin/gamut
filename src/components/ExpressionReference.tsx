import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  STYLE_REFERENCE,
  isSetupExample,
  type ReferenceExample,
  type ReferenceSection,
  type ReferenceTopic,
} from '../language/expressionReference'

type ExpressionReferenceProps = Readonly<{
  /** Short label of the active algebra, such as `PGA · 2D`. */
  algebraBadge: string
  /** The language sections of the active algebra. */
  sections: readonly ReferenceSection[]
  /** The primitives and normalization of the active algebra. */
  algebraTopics: readonly ReferenceTopic[]
  /** Syntax that no other registered algebra documents, tagged “… only”. */
  ownSyntax: ReadonlySet<string>
  /** Whether a new expression can still be added to the document. */
  canAdd: boolean
  onAdd: (example: ReferenceExample) => void
  onClose: () => void
}>

/** One displayed entry: a language entry or a topic of the Algebra or Style section. */
type DisplayEntry = Readonly<{
  key: string
  head: string
  code?: string
  meaning?: string
  tag?: string
  examples: readonly ReferenceExample[]
}>

type DisplaySection = Readonly<{ id: string; title: string; chip: string; entries: readonly DisplayEntry[] }>

function sectionId(title: string): string {
  return `reference-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

function topicSection(title: string, topics: readonly ReferenceTopic[]): DisplaySection {
  return {
    id: sectionId(title),
    title,
    chip: title.split(' ')[0],
    entries: topics.map(({ name, syntax, meaning }) => ({
      key: name, head: name, code: syntax, ...(meaning === undefined ? {} : { meaning }), examples: [],
    })),
  }
}

/** Every occurrence of the query, case-insensitively, wrapped in `<mark>`. */
function highlighted(text: string, query: string): ReactNode {
  if (!query) return text
  const lower = text.toLowerCase()
  const parts: ReactNode[] = []
  let start = 0
  let index = lower.indexOf(query, start)
  while (index >= 0) {
    if (index > start) parts.push(text.slice(start, index))
    parts.push(<mark key={index}>{text.slice(index, index + query.length)}</mark>)
    start = index + query.length
    index = lower.indexOf(query, start)
  }
  if (start === 0) return text
  if (start < text.length) parts.push(text.slice(start))
  return parts
}

function matches(entry: DisplayEntry, query: string): boolean {
  return [entry.head, entry.code ?? '', entry.meaning ?? '']
    .some((text) => text.toLowerCase().includes(query))
}

function isEditable(element: Element | null): boolean {
  return element instanceof HTMLElement
    && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

/**
 * The expression reference docked under its band in the expression panel
 * (#259): a search over syntax and meaning, section chips, and concise
 * entries whose examples can be added as new expressions. It is not a modal;
 * Escape inside it asks the panel to close it.
 */
export function ExpressionReference({
  algebraBadge,
  sections,
  algebraTopics,
  ownSyntax,
  canAdd,
  onAdd,
  onClose,
}: ExpressionReferenceProps) {
  const [query, setQuery] = useState('')
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tag = `${algebraBadge.split(' ')[0]} only`

  const allSections = useMemo<readonly DisplaySection[]>(() => [
    topicSection(`Algebra ${algebraBadge}`, algebraTopics),
    ...sections.map((section) => ({
      id: sectionId(section.title),
      title: section.title,
      chip: section.title.split(' ')[0],
      entries: section.entries.map((entry) => ({
        key: entry.syntax,
        head: entry.syntax,
        meaning: entry.meaning,
        ...(ownSyntax.has(entry.syntax) ? { tag } : {}),
        examples: entry.examples,
      })),
    })),
    topicSection('Style', STYLE_REFERENCE),
  ], [algebraBadge, algebraTopics, sections, ownSyntax, tag])

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? allSections
      .map((section) => ({ ...section, entries: section.entries.filter((entry) => matches(entry, needle)) }))
      .filter((section) => section.entries.length > 0)
    : allSections

  // `/` focuses the search while the reference is open, unless the user is typing.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditable(document.activeElement)) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  const jumpTo = (section: DisplaySection) => {
    setActiveSection(section.id)
    setQuery('')
    // The heading exists once the unfiltered list renders; only the reference scrolls.
    requestAnimationFrame(() => {
      const body = bodyRef.current
      const heading = body?.querySelector<HTMLElement>(`#${section.id}`)
      if (body && heading) body.scrollTop = heading.offsetTop
    })
  }

  return (
    <div
      className="expression-reference-content"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="reference-tools">
        <label className="reference-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search syntax or meaning: norm, join, list…"
            aria-label="Search the expression reference"
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <div className="reference-chips" role="group" aria-label="Reference sections">
          {allSections.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-pressed={activeSection === section.id}
              onClick={() => jumpTo(section)}
            >
              {section.chip}
            </button>
          ))}
        </div>
      </div>
      <div ref={bodyRef} className="reference-body">
        {visible.length === 0 ? (
          <p className="reference-empty" role="status">
            Nothing matches “{query.trim()}”. Try a name such as <code>norm</code>, an
            operator such as <code>&amp;</code>, or a word from the meaning, such as <code>dual</code>.
          </p>
        ) : visible.map((section) => (
          <section key={section.id} aria-labelledby={section.id}>
            <h3 className="reference-section-title" id={section.id}>{section.title}</h3>
            {section.entries.map((entry) => (
              <article className="reference-entry" key={entry.key}>
                <div className="reference-entry-head">
                  <span className="reference-syntax">
                    {highlighted(entry.head, needle)}
                    {entry.code && <> <code className="reference-code">{highlighted(entry.code, needle)}</code></>}
                  </span>
                  {entry.tag && <span className="reference-tag">{entry.tag}</span>}
                </div>
                {entry.meaning && <p className="reference-meaning">{highlighted(entry.meaning, needle)}</p>}
                {entry.examples.length > 0 && (
                  <ul className="reference-examples">
                    {entry.examples.map((example, index) => (
                      <ReferenceExampleRow
                        key={index}
                        example={example}
                        canAdd={canAdd}
                        onAdd={onAdd}
                      />
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function ReferenceExampleRow({ example, canAdd, onAdd }: Readonly<{
  example: ReferenceExample
  canAdd: boolean
  onAdd: (example: ReferenceExample) => void
}>) {
  const setup = isSetupExample(example)
  const result = example.positionInvalid ? 'position diagnostic' : example.inspection
  return (
    <li className={`reference-example${setup ? ' is-setup' : ''}`}>
      <span>
        {setup && <span className="reference-with">with </span>}
        <code className="reference-source">{example.source}</code>
        {example.positionSource !== undefined && (
          <span className="reference-position">, position <code>{example.positionSource}</code></span>
        )}
        {result !== undefined && <>
          {' '}<span className="reference-arrow" aria-hidden="true">→</span>
          <span className="visually-hidden">gives</span>{' '}
          <code className="reference-result">{result}</code>
        </>}
      </span>
      <button
        type="button"
        className="reference-add"
        disabled={!canAdd}
        aria-label={`Add ${example.source} as a new expression`}
        title="Add as a new expression"
        onClick={() => onAdd(example)}
      >
        +
      </button>
    </li>
  )
}
