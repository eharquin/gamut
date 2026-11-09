import type { RefObject } from 'react'
import type { ReferenceSection } from '../language/expressionReference'
import { DefinitionTable } from './DefinitionTable'
import { InfoDialog } from './InfoDialog'

type ExpressionReferenceDialogProps = Readonly<{
  /** Name of the active algebra, such as `Projective Geometric Algebra`. */
  algebraName: string
  /** Short label of the active algebra, such as `PGA · 2D`. */
  algebraBadge: string
  sections: readonly ReferenceSection[]
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}>

export function ExpressionReferenceDialog({
  algebraName,
  algebraBadge,
  sections,
  returnFocusRef,
  onClose,
}: ExpressionReferenceDialogProps) {
  return (
    <InfoDialog
      title="Expression Reference"
      labelledBy="expression-reference-title"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      <p className="info-description">
        Syntax for {algebraName} ({algebraBadge}) documents.
      </p>
      {sections.map((section) => (
        <section className="info-section" key={section.title}>
          <h3>{section.title}</h3>
          <DefinitionTable rows={section.entries.map(({ syntax, meaning }) => [syntax, meaning] as const)} />
        </section>
      ))}
    </InfoDialog>
  )
}
