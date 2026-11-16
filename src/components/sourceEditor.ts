/** Typed first in an expression row, it turns the row into a note (language §3). */
export const NOTE_TRIGGER = '"'

/** The element that edits the source of a row: an input for an expression, a textarea for a note. */
export type SourceEditor = HTMLInputElement | HTMLTextAreaElement

export function isSourceEditor(element: unknown): element is SourceEditor {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
}
