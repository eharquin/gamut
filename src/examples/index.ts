import { parseCanonicalDocument, type CanonicalDocument } from '../document/canonicalDocument'
import pga2Triangle from './pga2-triangle.gamut.json?raw'
import vga2Rotation from './vga2-rotation.gamut.json?raw'

/**
 * The example scenes shipped with the application (#266, STORE-015): each is
 * one canonical document in this folder, in the current format version, so
 * that examples are versioned, migrated and tested like other fixtures. The
 * order of this index is the order of the Examples section.
 *
 * The first two are the algebra showcases. Until the showcase becomes an
 * example (#217), `examples.test.ts` keeps them equal to the first-run
 * document and to the definitions' showcase rows.
 */
export const SHIPPED_EXAMPLES: readonly Readonly<{ id: string; source: string }>[] = [
  { id: 'vga2-rotation', source: vga2Rotation },
  { id: 'pga2-triangle', source: pga2Triangle },
]

/** An example as the library lists it; its document is read-only. */
export type LibraryExample = Readonly<{
  id: string
  name: string
  description: string
  algebraId: string
  document: CanonicalDocument
}>

export type ExampleRead = Readonly<{
  examples: readonly LibraryExample[]
  /** The examples that could not be read, reported in text; the others stay listed. */
  diagnostic: string | null
}>

let read: ExampleRead | null = null

/** Reads the shipped examples once; an unreadable example is isolated with a diagnostic. */
export function readExamples(): ExampleRead {
  if (read) return read
  const examples: LibraryExample[] = []
  const failed: string[] = []
  for (const { id, source } of SHIPPED_EXAMPLES) {
    try {
      const document = parseCanonicalDocument(source)
      examples.push({
        id,
        name: document.metadata.title.trim() || id,
        description: document.metadata.description,
        algebraId: document.algebra.algebraId,
        document,
      })
    } catch {
      failed.push(id)
    }
  }
  read = {
    examples,
    diagnostic: failed.length === 0 ? null : `EXAMPLE_INVALID: ${failed.join(', ')} could not be read.`,
  }
  return read
}
