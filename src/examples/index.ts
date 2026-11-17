import { parseCanonicalDocument, type CanonicalDocument } from '../document/canonicalDocument'
import pga2Desargues from './pga2-desargues.gamut.json?raw'
import pga2DistancesAndAngles from './pga2-distances-and-angles.gamut.json?raw'
import pga2EulerLine from './pga2-euler-line.gamut.json?raw'
import pga2PointsAndLines from './pga2-points-and-lines.gamut.json?raw'
import pga2ProjectAndReject from './pga2-project-and-reject.gamut.json?raw'
import pga2RotorsAndTranslators from './pga2-rotors-and-translators.gamut.json?raw'
import pga2Triangle from './pga2-triangle.gamut.json?raw'
import vga2Reflections from './vga2-reflections.gamut.json?raw'
import vga2Rotation from './vga2-rotation.gamut.json?raw'
import vga2VectorsAndProducts from './vga2-vectors-and-products.gamut.json?raw'
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
 * The first two are the algebra showcases: each algebra definition names
 * its own by identifier (`showcaseExampleId`), which a first run and an
 * algebra switch open (#217).
 */
export type ShippedExample = Readonly<{ id: string; source: string; folder?: FolderPath }>

export const SHIPPED_EXAMPLES: readonly ShippedExample[] = [
  { id: 'vga2-rotation', source: vga2Rotation, folder: ['VGA(2)'] },
  { id: 'pga2-triangle', source: pga2Triangle, folder: ['PGA(2)'] },
  // A first set after the PGA(2) samples of ganja.js (#270), by algebra, then by topic.
  { id: 'vga2-vectors-and-products', source: vga2VectorsAndProducts, folder: ['VGA(2)', 'Basics'] },
  { id: 'vga2-reflections', source: vga2Reflections, folder: ['VGA(2)', 'Transformations'] },
  { id: 'pga2-points-and-lines', source: pga2PointsAndLines, folder: ['PGA(2)', 'Basics'] },
  { id: 'pga2-distances-and-angles', source: pga2DistancesAndAngles, folder: ['PGA(2)', 'Basics'] },
  { id: 'pga2-project-and-reject', source: pga2ProjectAndReject, folder: ['PGA(2)', 'Basics'] },
  { id: 'pga2-rotors-and-translators', source: pga2RotorsAndTranslators, folder: ['PGA(2)', 'Transformations'] },
  { id: 'pga2-euler-line', source: pga2EulerLine, folder: ['PGA(2)', 'Constructions'] },
  { id: 'pga2-desargues', source: pga2Desargues, folder: ['PGA(2)', 'Constructions'] },
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

/** The example an algebra definition names as its showcase (#217), or null when it is not shipped. */
export function showcaseExample(definition: Readonly<{ showcaseExampleId: string }>): LibraryExample | null {
  return readExamples().examples.find((example) => example.id === definition.showcaseExampleId) ?? null
}
