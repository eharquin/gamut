/** A row made from one line of a pasted block (#336). */
export type PastedRow = Readonly<{ kind: 'expression' | 'annotation'; source: string }>

const LINE_BREAK = /\r\n|\r|\n/

/**
 * The rows a paste into an expression row makes, or null when the pasted text
 * has no line break and pastes as usual. The text before the selection stays
 * before the first line and the text after it after the last line; then each
 * non-blank line is a row, in order. A line that starts with `"` is a note,
 * as when it is typed; any other line, one that starts with `/` included, is
 * an expression, so a paste never makes a folder.
 */
export function pastedRows(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  pasted: string,
): readonly PastedRow[] | null {
  if (!LINE_BREAK.test(pasted)) return null
  const combined = source.slice(0, selectionStart) + pasted + source.slice(selectionEnd)
  const lines = combined.split(LINE_BREAK).filter((line) => line.trim() !== '')
  if (lines.length === 0) return [{ kind: 'expression', source: '' }]
  return lines.map((line) => line.startsWith('"')
    ? { kind: 'annotation', source: line.slice(1) }
    : { kind: 'expression', source: line })
}
