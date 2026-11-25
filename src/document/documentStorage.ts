import {
  parseCanonicalDocument,
  serializeCanonicalDocument,
  type CanonicalDocument,
} from './canonicalDocument'

export const ACTIVE_DOCUMENT_KEY = 'multivector.document.active.v1'
/**
 * The active document a version could not restore, such as one written by a
 * later version, kept before anything is saved over it (#275).
 */
export const KEPT_DOCUMENT_KEY = 'gamut.document.kept.v1'

export interface DocumentStorage {
  load(): CanonicalDocument | null
  save(document: CanonicalDocument): void
}

/**
 * A minimal browser adapter behind the persistence interface. setItem is
 * atomic for one key: if validation or the write fails, the previous revision
 * remains readable.
 */
export function browserDocumentStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): DocumentStorage {
  return {
    load() {
      const source = storage.getItem(ACTIVE_DOCUMENT_KEY)
      return source === null ? null : parseCanonicalDocument(source)
    },
    save(document) {
      storage.setItem(ACTIVE_DOCUMENT_KEY, serializeCanonicalDocument(document))
    },
  }
}

/**
 * Copies the stored active document, which this version could not restore,
 * to the kept key, so that saving over it later loses nothing (#275). Returns
 * whether the stored text is now kept. A different copy kept earlier, which
 * no version has recovered yet, is never replaced: the stored document then
 * stays unkept, and must not be saved over.
 */
export function keepUnreadableDocument(storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    const source = storage.getItem(ACTIVE_DOCUMENT_KEY)
    if (source === null) return true
    const kept = storage.getItem(KEPT_DOCUMENT_KEY)
    if (kept === source) return true
    if (kept !== null) return false
    storage.setItem(KEPT_DOCUMENT_KEY, source)
    return storage.getItem(KEPT_DOCUMENT_KEY) === source
  } catch {
    return false
  }
}

export type KeptDocument =
  | Readonly<{ status: 'none' }>
  /** The kept copy is still the stored active document: nothing was saved over it. */
  | Readonly<{ status: 'unchanged' }>
  | Readonly<{ status: 'readable'; document: CanonicalDocument }>
  /** This version cannot read it either; it stays for a version that can. */
  | Readonly<{ status: 'unreadable' }>

/** Reads the kept document, if any, as this version sees it (#275). */
export function readKeptDocument(storage: Pick<Storage, 'getItem'>): KeptDocument {
  let source: string | null
  try {
    source = storage.getItem(KEPT_DOCUMENT_KEY)
    if (source === null) return { status: 'none' }
    if (storage.getItem(ACTIVE_DOCUMENT_KEY) === source) return { status: 'unchanged' }
  } catch {
    return { status: 'none' }
  }
  try {
    return { status: 'readable', document: parseCanonicalDocument(source) }
  } catch {
    return { status: 'unreadable' }
  }
}

export function discardKeptDocument(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(KEPT_DOCUMENT_KEY)
  } catch {
    // The copy stays, and is offered again at the next start.
  }
}
