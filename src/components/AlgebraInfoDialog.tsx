import type { RefObject } from 'react'
import { type AlgebraInfo } from '../algebra/algebraDefinition'
import { DefinitionTable } from './DefinitionTable'
import { InfoDialog } from './InfoDialog'

type AlgebraInfoDialogProps = Readonly<{
  info: AlgebraInfo
  returnFocusRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}>

/**
 * The algebra only (#259): signature, basis and metric, Cayley table, the
 * algebraic reading of each object, sub-algebras, and mathematical notes.
 * How objects are written, drawn, colored, and normalized lives in the
 * expression reference.
 */
export function AlgebraInfoDialog({
  info,
  returnFocusRef,
  onClose,
}: AlgebraInfoDialogProps) {
  return (
    <InfoDialog
      title={`${info.name} ${info.signature}`}
      labelledBy="algebra-info-title"
      returnFocusRef={returnFocusRef}
      onClose={onClose}
    >
      <p className="info-description">{info.description}</p>

      <section className="info-section">
        <h3>Basis &amp; metric</h3>
        <div className="info-table-scroll">
          <table className="algebra-grid">
            <thead><tr>{info.blades.map((blade) => <th key={blade}>{blade}</th>)}</tr></thead>
            <tbody><tr>{info.bladeSquares.map((square, index) => <td key={info.blades[index]}>{square}</td>)}</tr></tbody>
          </table>
        </div>
      </section>

      <section className="info-section">
        <h3>Cayley table</h3>
        <div className="info-table-scroll">
          <table className="algebra-grid cayley-grid">
            <thead><tr><th aria-label="left times right" />{info.blades.map((blade) => <th key={blade}>{blade}</th>)}</tr></thead>
            <tbody>
              {info.cayley.map((row, rowIndex) => (
                <tr key={info.blades[rowIndex]}>
                  <th scope="row">{info.blades[rowIndex]}</th>
                  {row.map((value, columnIndex) => <td key={info.blades[columnIndex]}>{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="info-section">
        <h3>Geometric interpretation</h3>
        <DefinitionTable rows={info.objects} codeTerms={false} />
      </section>

      <section className="info-section">
        <h3>Sub-algebras</h3>
        <DefinitionTable rows={info.subalgebras} codeTerms={false} />
      </section>

      <section className="info-section">
        <h3>Notes</h3>
        <ul>{info.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </section>
    </InfoDialog>
  )
}
