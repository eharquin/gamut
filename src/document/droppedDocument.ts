/** A file name the import accepts: `.json`, which covers `.gamut.json` and `.multivector.json`. */
const DOCUMENT_FILE_NAME = /\.json$/i
/** A library archive (STORE-018). */
const ARCHIVE_FILE_NAME = /\.zip$/i
const ARCHIVE_TYPES = ['application/zip', 'application/x-zip-compressed']

export type DroppedDocument =
  | Readonly<{ status: 'ignored' }>
  | Readonly<{ status: 'file'; file: File }>
  | Readonly<{ status: 'archive'; file: File }>
  | Readonly<{ status: 'rejected'; diagnostic: string }>

/**
 * Chooses the document file of a drop onto the window. A drop carrying no
 * file is ignored; several files, or a file that is not JSON, are rejected
 * with a diagnostic before anything is read. The accepted file then takes the
 * ordinary import path; a `.zip` file takes that of **Import library**.
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
  if (ARCHIVE_FILE_NAME.test(file.name) || ARCHIVE_TYPES.includes(file.type)) return { status: 'archive', file }
  if (!DOCUMENT_FILE_NAME.test(file.name) && file.type !== 'application/json') {
    return {
      status: 'rejected',
      diagnostic: `DOCUMENT_DROP_TYPE: “${file.name}” is not a JSON document. Drop a .gamut.json, .multivector.json, or .json file, or a .zip library archive; the current document is unchanged.`,
    }
  }
  return { status: 'file', file }
}
