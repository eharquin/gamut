import { useMemo } from 'react'
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
  /** The general expressions, true in every algebra. */
  generalSections: readonly ReferenceSection[]
  /** The expressions specific to the active algebra. */
  algebraSections: readonly ReferenceSection[]
  /** The primitives and normalization of the active algebra. */
  algebraTopics: readonly ReferenceTopic[]
  /** Whether a new expression can still be added to the document. */
  canAdd: boolean
  onAdd: (example: ReferenceExample) => void
  onClose: () => void
}>

/** One displayed entry: a language entry or a topic (primitive, style). */
type DisplayEntry = Readonly<{
  key: string
  head: string
  code?: string
  meaning?: string
  examples: readonly ReferenceExample[]
}>

type DisplaySection = Readonly<{ id: string; title: string; entries: readonly DisplayEntry[] }>
type DisplayCategory = Readonly<{ id: string; title: string; sections: readonly DisplaySection[] }>

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function topicSection(category: string, title: string, topics: readonly ReferenceTopic[]): DisplaySection {
  return {
    id: `reference-${category}-${slug(title)}`,
    title,
    entries: topics.map(({ name, syntax, meaning }) => ({
      key: name, head: name, code: syntax, ...(meaning === undefined ? {} : { meaning }), examples: [],
    })),
  }
}

function languageSections(category: string, sections: readonly ReferenceSection[]): DisplaySection[] {
  return sections.map((section) => ({
    id: `reference-${category}-${slug(section.title)}`,
    title: section.title,
    entries: section.entries.map((entry) => ({
      key: entry.syntax, head: entry.syntax, meaning: entry.meaning, examples: entry.examples,
    })),
  }))
}

/**
 * The expression reference docked under its band in the expression panel
 * (#259), in two categories: the general expressions, true in every algebra,
 * then the expressions of the active algebra. It is not a modal; Escape
 * inside it asks the panel to close it.
 */
export function ExpressionReference({
  algebraBadge,
  generalSections,
  algebraSections,
  algebraTopics,
  canAdd,
  onAdd,
  onClose,
}: ExpressionReferenceProps) {
  const algebraName = algebraBadge.split(' ')[0]
  const categories = useMemo<readonly DisplayCategory[]>(() => [
    {
      id: 'reference-general',
      title: 'General expressions',
      sections: [...languageSections('general', generalSections), topicSection('general', 'Style', STYLE_REFERENCE)],
    },
    {
      id: 'reference-algebra',
      title: `${algebraName} expressions`,
      sections: [topicSection('algebra', 'Primitives', algebraTopics), ...languageSections('algebra', algebraSections)],
    },
  ], [algebraName, algebraSections, algebraTopics, generalSections])

  return (
    <div
      className="expression-reference-content"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="reference-body" tabIndex={-1}>
        {categories.map((category) => (
          <section key={category.id} className="reference-category" aria-labelledby={category.id}>
            <h2 className="reference-category-title" id={category.id}>{category.title}</h2>
            {category.sections.map((section) => (
              <section key={section.id} aria-labelledby={section.id}>
                <h3 className="reference-section-title" id={section.id}>{section.title}</h3>
                {section.entries.map((entry) => (
                  <article className="reference-entry" key={entry.key}>
                    <div className="reference-entry-head">
                      <span className="reference-syntax">
                        {entry.head}
                        {entry.code && <> <code className="reference-code">{entry.code}</code></>}
                      </span>
                    </div>
                    {entry.meaning && <p className="reference-meaning">{entry.meaning}</p>}
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
