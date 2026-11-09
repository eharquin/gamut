/** A file name the import accepts: `.json`, which covers `.gamut.json` and `.multivector.json`. */
const DOCUMENT_FILE_NAME = /\.json$/i

export type DroppedDocument =
  | Readonly<{ status: 'ignored' }>
  | Readonly<{ status: 'file'; file: File }>
  | Readonly<{ status: 'rejected'; diagnostic: string }>

/**
 * Chooses the document file of a drop onto the window. A drop carrying no
 * file is ignored; several files, or a file that is not JSON, are rejected
 * with a diagnostic before anything is read. The accepted file then takes the
 * ordinary import path.
 */
export function selectDroppedDocument(files: ArrayLike<File>): DroppedDocument {
  if (files.length === 0) return { status: 'ignored' }
  if (files.length > 1) {
    return {
      status: 'rejected',
      diagnostic: `DOCUMENT_DROP_MULTIPLE: ${files.length} files were dropped. Drop one document file at a time; the current document is unchanged.`,
    }
  }
  const file = files[0]
  if (!DOCUMENT_FILE_NAME.test(file.name) && file.type !== 'application/json') {
    return {
      status: 'rejected',
      diagnostic: `DOCUMENT_DROP_TYPE: “${file.name}” is not a JSON document. Drop a .gamut.json, .multivector.json, or .json file; the current document is unchanged.`,
    }
  }
  return { status: 'file', file }
}
