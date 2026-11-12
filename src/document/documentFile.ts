import {
  DocumentFormatError,
  parseCanonicalDocumentBytes,
  serializeCanonicalDocument,
  type CanonicalDocument,
} from './canonicalDocument'

/** The file name stem used when a document title gives none. */
const DEFAULT_DOCUMENT_BASENAME = 'gamut-document'

/**
 * The file name a document is exported under: its title with every run of
 * characters other than letters, digits, `_` and `-` replaced by `-`, trimmed
 * of a leading and a trailing `-`, and suffixed with `.gamut.json`.
 */
export function documentFileName(title: string): string {
  const basename = (title || DEFAULT_DOCUMENT_BASENAME)
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || DEFAULT_DOCUMENT_BASENAME
  return basename + '.gamut.json'
}

/** Reads and parses a chosen or dropped document file; parsing failures throw a `DocumentFormatError`. */
export async function readDocumentFile(file: Blob): Promise<CanonicalDocument> {
  return parseCanonicalDocumentBytes(new Uint8Array(await file.arrayBuffer()))
}

/**
 * Serializes a canonical document and hands it to the browser as a download
 * named after `title`. A serialization failure throws before anything is
 * downloaded.
 */
export function downloadDocumentFile(canonical: CanonicalDocument, title: string): void {
  const source = serializeCanonicalDocument(canonical)
  const blob = new Blob([source], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = documentFileName(title)
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * The diagnostic shown for a failed document operation: the format error's
 * code and message, or `fallback` for any other failure.
 */
export function documentFileDiagnostic(error: unknown, fallback: string): string {
  return error instanceof DocumentFormatError ? error.code + ': ' + error.message : fallback
}
