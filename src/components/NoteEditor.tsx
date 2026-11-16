import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AnnotationText } from './AnnotationText'

type NoteEditorProps = Readonly<{
  /** The identity of the textarea, which focus restoration looks up. */
  id: string
  /** The identity of the rendered text, which describes the textarea. */
  textId: string
  /** The row number, for the accessible name `Annotation N`. */
  position: number
  source: string
  editorRef(element: HTMLTextAreaElement | null): void
  onChange(source: string): void
  /** Backspace before the first character: the note becomes an expression again. */
  onConvertToExpression(): void
  /** Ctrl or Cmd with Enter: a new row after the note. */
  onInsertAfter(): void
  /** Keys the row handles for every kind of editor: moving, removing, and leaving the row. */
  onRowKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void
  onFocus(element: HTMLTextAreaElement): void
  onSelect(element: HTMLTextAreaElement): void
  onBlur(): void
}>

/**
 * The editor of a note (language §3). While it is edited, the note shows its
 * source in a textarea that grows with it; otherwise only the rendered text
 * shows. The textarea stays mounted and focusable in both states, so the row
 * keeps its accessible name and its place in the Tab order (A11Y-014). Enter
 * adds a line, Ctrl or Cmd with Enter adds a row, and Escape shows the
 * rendered text again without moving focus.
 */
export function NoteEditor({
  id, textId, position, source, editorRef, onChange, onConvertToExpression, onInsertAfter,
  onRowKeyDown, onFocus, onSelect, onBlur,
}: NoteEditorProps) {
  const [focused, setFocused] = useState(false)
  /** Escape was pressed: the rendered text shows while focus stays in the textarea. */
  const [dismissed, setDismissed] = useState(false)
  const element = useRef<HTMLTextAreaElement | null>(null)
  const text = source.trim()
  // A note without text has nothing to render, so its field always shows.
  const editing = text === '' || (focused && !dismissed)

  // The textarea is as tall as its source.
  useLayoutEffect(() => {
    const area = element.current
    if (!area || !editing) return
    area.style.height = 'auto'
    area.style.height = `${area.scrollHeight}px`
  }, [source, editing])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const area = event.currentTarget
    const collapsed = area.selectionStart === area.selectionEnd
    if (event.key === 'Escape') {
      if (!editing || text === '') return
      // Answered here, so that it does not also close a panel.
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
      return
    }
    if (event.key === 'Enter') {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        onInsertAfter()
      } else if (!editing) {
        event.preventDefault()
        setDismissed(false)
      }
      return
    }
    if (event.key === 'Backspace' && collapsed && area.selectionStart === 0 && editing) {
      event.preventDefault()
      onConvertToExpression()
      return
    }
    // Inside the text, the arrows move the caret; they leave the row from its first and last position only.
    if (editing && !event.altKey && (
      (event.key === 'ArrowUp' && !(collapsed && area.selectionStart === 0)) ||
      (event.key === 'ArrowDown' && !(collapsed && area.selectionEnd === area.value.length))
    )) return
    onRowKeyDown(event)
  }

  return (
    <div className={`note${editing ? ' is-editing' : ''}${focused && !editing ? ' is-focused' : ''}`}>
      <textarea
        ref={(area) => {
          element.current = area
          editorRef(area)
        }}
        id={id}
        className={`expression-source note-source${editing ? '' : ' is-collapsed'}`}
        aria-label={`Annotation ${position}`}
        aria-describedby={text ? textId : undefined}
        placeholder="Note"
        rows={1}
        value={source}
        onChange={(event) => {
          setDismissed(false)
          onChange(event.target.value)
        }}
        onFocus={(event) => {
          setFocused(true)
          onFocus(event.currentTarget)
        }}
        onSelect={(event) => onSelect(event.currentTarget)}
        onBlur={() => {
          setFocused(false)
          setDismissed(false)
          onBlur()
        }}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
      />
      {text && (
        <div
          className="note-rendered"
          hidden={editing}
          // A click on the rendered text edits the note; a click on a link follows the link.
          onMouseDown={(event) => {
            if ((event.target as HTMLElement).closest('a')) return
            event.preventDefault()
            setDismissed(false)
            element.current?.focus()
          }}
        >
          <AnnotationText id={textId} text={text} />
        </div>
      )}
    </div>
  )
}
