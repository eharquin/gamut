import { parseCanonicalDocument, type CanonicalDocument } from '../document/canonicalDocument'
import pga2Triangle from './pga2-triangle.gamut.json?raw'
import vga2Rotation from './vga2-rotation.gamut.json?raw'
import type { FolderPath } from '../document/folderModel'

/**
 * The example scenes shipped with the application (#266, STORE-015): each is
 * one canonical document in this folder, in the current format version, so
 * that examples are versioned, migrated and tested like other fixtures. The
 * order of this index is the order of the Examples section within a folder.
 * Each example has a fixed folder, as folder names from the root (STORE-015,
 * STORE-016): the Examples tree is read-only, and **Add to my library** keeps
 * the folder path.
 *
 * The first two are the algebra showcases. Until the showcase becomes an
 * example (#217), `examples.test.ts` keeps them equal to the first-run
 * document and to the definitions' showcase rows.
 */
export type ShippedExample = Readonly<{ id: string; source: string; folder?: FolderPath }>

export const SHIPPED_EXAMPLES: readonly ShippedExample[] = [
  { id: 'vga2-rotation', source: vga2Rotation, folder: ['VGA(2)'] },
  { id: 'pga2-triangle', source: pga2Triangle, folder: ['PGA(2)'] },
]

/** An example as the library lists it; its document is read-only. */
export type LibraryExample = Readonly<{
  id: string
  name: string
  description: string
  algebraId: string
  /** The folder of the example in the Examples tree; empty at the root. */
  folder: FolderPath
  document: CanonicalDocument
}>

export type ExampleRead = Readonly<{
  examples: readonly LibraryExample[]
  /** The examples that could not be read, reported in text; the others stay listed. */
  diagnostic: string | null
}>

let shipped: ExampleRead | null = null

/**
 * Reads the examples, the shipped ones once; an unreadable example is
 * isolated with a diagnostic and the others stay listed.
 */
export function readExamples(sources: readonly ShippedExample[] = SHIPPED_EXAMPLES): ExampleRead {
  if (sources === SHIPPED_EXAMPLES && shipped) return shipped
  const examples: LibraryExample[] = []
  const failed: string[] = []
  for (const { id, source, folder = [] } of sources) {
    try {
      const document = parseCanonicalDocument(source)
      examples.push({
        id,
        name: document.metadata.title.trim() || id,
        description: document.metadata.description,
        algebraId: document.algebra.algebraId,
        folder,
        document,
      })
    } catch {
      failed.push(id)
    }
  }
  const read = {
    examples,
    diagnostic: failed.length === 0 ? null : `EXAMPLE_INVALID: ${failed.join(', ')} could not be read.`,
  }
  if (sources === SHIPPED_EXAMPLES) shipped = read
  return read
}
