import type { AlgebraRegistry } from '../algebra/registry'
import {
  documentMigration,
  DocumentFormatError,
  fromCanonicalDocument,
  type CanonicalDocument,
  type RestoredCanonicalDocument,
  type RestoreOptions,
} from '../document/canonicalDocument'
import { migrationNotice } from '../document/migrationNotice'
import { requireAvailableAlgebra } from './algebraAvailability'

/** The status after a failed restore (#275). */
export const HELD_STORED_DOCUMENT = 'Nothing is saved over it until you edit this graph, and it is then kept for a version of GAMUT that can read it.'
export const UNKEPT_STORED_DOCUMENT = 'STORE_NOT_KEPT: The stored graph that could not be restored cannot be kept, so this graph is not saved automatically; save it in My library.'

export type ActiveDocumentRestore =
  /** Nothing was stored: the editor opens its first-run document. */
  | Readonly<{ status: 'none' }>
  | Readonly<{
      status: 'restored'
      restored: RestoredCanonicalDocument
      /** What the reader is told when an earlier version wrote it (#343). */
      migrationNotice: string | null
    }>
  /**
   * The stored document could not be restored, perhaps because a later
   * version wrote it: it is not saved over before an edit, and is kept first
   * (#275).
   */
  | Readonly<{ status: 'held'; diagnostic: string }>

/**
 * Restores the active document the last visit autosaved (#173). `load`
 * reads and validates it, and throws when it cannot.
 */
export function restoreActiveDocument(
  load: () => CanonicalDocument | null,
  registry: AlgebraRegistry,
  options: RestoreOptions,
): ActiveDocumentRestore {
  try {
    const stored = load()
    if (stored === null) return { status: 'none' }
    const restored = fromCanonicalDocument(stored, options)
    requireAvailableAlgebra(registry, restored.document.algebra)
    return { status: 'restored', restored, migrationNotice: migrationNotice(documentMigration(stored)) }
  } catch (error) {
    const failure = error instanceof DocumentFormatError
      ? error.code + ': ' + error.message
      : 'STORE_READ_FAILED: The saved document could not be restored.'
    return { status: 'held', diagnostic: failure + ' ' + HELD_STORED_DOCUMENT }
  }
}
