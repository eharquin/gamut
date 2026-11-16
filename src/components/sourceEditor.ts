/** Typed first in an expression row, it turns the row into a note (language §3). */
export const NOTE_TRIGGER = '"'

/** Typed first in an expression row, it makes a folder of the row (DOC-013). */
export const FOLDER_TRIGGER = '/'

/** The element that edits the source of a row: an input for an expression, a textarea for a note. */
export type SourceEditor = HTMLInputElement | HTMLTextAreaElement

export function isSourceEditor(element: unknown): element is SourceEditor {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
}
