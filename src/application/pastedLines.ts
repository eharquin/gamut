/** A row made from one line of a pasted block (#336). */
export type PastedRow = Readonly<{ kind: 'expression' | 'annotation'; source: string }>

const LINE_BREAK = /\r\n|\r|\n/

/** The rows of a paste, and where the caret goes in the last one: after the pasted text. */
export type PastedRows = Readonly<{ rows: readonly PastedRow[]; caret: number }>

/**
 * The rows a paste into an expression row makes, or null when the browser
 * pastes as usual: a single line that does not make the row start with `/`.
 * The text before the selection stays before the first line and the text
 * after it after the last line; then each non-blank line is a row, in order.
 * A line that starts with `"` is a note, as when it is typed; any other line,
 * one that starts with `/` included, is an expression: a paste never makes a
 * folder, even of a single line.
 */
export function pastedRows(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  pasted: string,
): PastedRows | null {
  const before = source.slice(0, selectionStart)
  const after = source.slice(selectionEnd)
  const combined = before + pasted + after
  if (!LINE_BREAK.test(pasted)) {
    return combined.startsWith('/')
      ? { rows: [{ kind: 'expression', source: combined }], caret: before.length + pasted.length }
      : null
  }
  const lines = combined.split(LINE_BREAK).filter((line) => line.trim() !== '')
  if (lines.length === 0) return { rows: [{ kind: 'expression', source: '' }], caret: 0 }
  const rows = lines.map((line): PastedRow => line.startsWith('"')
    ? { kind: 'annotation', source: line.slice(1) }
    : { kind: 'expression', source: line })
  return { rows, caret: Math.max(0, rows[rows.length - 1].source.length - after.length) }
}
