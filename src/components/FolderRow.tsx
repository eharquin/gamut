import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { folderKey, type FolderPath } from '../document/folderModel'
import { useHoldToConfirm } from '../hooks/useHoldToConfirm'

type FolderRowProps = Readonly<{
  path: FolderPath
  name: string
  /** Nesting level, a root-level folder being level 1 (A11Y-011). */
  level: number
  expanded: boolean
  /** Entries in the folder and its subfolders, for the accessible name. */
  entryCount: number
  /** The noun of the entries, singular and plural: `expression`, `graph`. */
  entryNoun: readonly [string, string]
  /** Opens the name field, for a folder just created. */
  renaming: boolean
  onRenamingChange(renaming: boolean): void
  onToggle(): void
  /** Absent for a read-only folder. Returns why a name is refused, or null. */
  onRename?(name: string): string | null
  /**
   * Called when Enter has validated the name, with the name the folder now
   * has: moves focus into the folder and returns true, or returns false to
   * leave focus on the folder itself.
   */
  onNameEntered?(name: string): boolean
  /**
   * Backspace before the first character of the name field: turns the folder
   * back into a row written `name`, as Backspace does for a note, and returns
   * true; returns false, or is absent, when the folder cannot become a row.
   */
  onNameBackspace?(name: string): boolean
  /** Absent for a read-only folder. */
  onDelete?(): void
  /**
   * Deletes the folder with everything it holds, after a one-second hold;
   * absent when the folder cannot lose its contents this way.
   */
  onDeleteWithContents?(): void
  /** The handle that moves the folder by pointer and keyboard; absent when folders cannot be moved. */
  handle?: Readonly<{
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void
  }>
  /**
   * The name as displayed, such as Markdown rendered from it, and the plain
   * text that names the folder to assistive technology; the name as written
   * by default. The name field always shows the name as written.
   */
  display?: Readonly<{ name: ReactNode; plainName: string }>
  /** Classes the panel adds, such as a drop indicator. */
  className?: string
  rowRef?(element: HTMLElement | null): void
  /** Further actions before Remove. */
  children?: ReactNode
}>

/**
 * The folder whose toggle takes focus when its row mounts. A panel keys a row
 * by its path, so a rename replaces the row and the old one cannot keep focus.
 */
let focusOnMount: string | null = null

/**
 * The header row of a folder, shared by the expression panel (DOC-013) and the
 * library panel (STORE-016): a disclosure button that names the folder, its
 * nesting level and its size and exposes its expanded state (A11Y-011), the
 * name, which is edited in place by clicking it or with F2, and the remove
 * action, shown while the row is hovered or holds focus. The name is plain text.
 */
export function FolderRow({
  path, name, level, expanded, entryCount, entryNoun, renaming, onRenamingChange,
  onToggle, onRename, onNameEntered, onNameBackspace, onDelete, onDeleteWithContents, handle, display, className, rowRef, children,
}: FolderRowProps) {
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /** Set once Enter or Escape ends the rename, so the blur that follows does not commit again. */
  const ended = useRef(false)
  const idSuffix = path.map(encodeURIComponent).join('/')
  const errorId = `folder-error-${idSuffix}`

  useEffect(() => {
    if (!renaming) return
    ended.current = false
    setDraft(name)
    setError(null)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [renaming, name])

  // The key of a mounted row never changes, so this runs once: the row that a
  // rename just created takes focus.
  const key = folderKey(path)
  useEffect(() => {
    if (focusOnMount !== key) return
    focusOnMount = null
    toggleRef.current?.focus()
  }, [key])

  const finish = (commit: boolean, entered = false) => {
    if (ended.current) return
    if (commit && onRename) {
      const problem = onRename(draft)
      if (problem) {
        setError(problem)
        inputRef.current?.focus()
        return
      }
      const renamed = draft.trim()
      // Enter goes on to the content of the folder when there is some.
      const inside = entered && (onNameEntered?.(renamed === '' ? name : renamed) ?? false)
      focusOnMount = inside || renamed === name ? null : folderKey([...path.slice(0, -1), renamed])
      if (inside) {
        ended.current = true
        setError(null)
        onRenamingChange(false)
        return
      }
    }
    ended.current = true
    setError(null)
    onRenamingChange(false)
    requestAnimationFrame(() => toggleRef.current?.focus())
  }

  const count = `${entryCount} ${entryCount === 1 ? entryNoun[0] : entryNoun[1]}`
  // The folder is named by its plain text; the name field shows the name as written.
  const plain = display?.plainName ?? name
  const shown = display?.name ?? name
  const label = `Folder ${plain}, level ${level}, ${count}`
  const toggleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'F2' && onRename) { event.preventDefault(); onRenamingChange(true) }
    else if (event.key === 'ArrowRight' && !expanded) { event.preventDefault(); onToggle() }
    else if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); onToggle() }
  }
  return (
    <div
      ref={rowRef}
      className={`folder-row${expanded ? '' : ' is-collapsed'}${handle ? ' has-handle' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--folder-level': level } as CSSProperties}
    >
      {handle && (
        <button
          type="button"
          className="reorder-handle folder-handle"
          aria-label={`Reorder folder ${plain}. Alt plus arrow keys to move.`}
          onPointerDown={handle.onPointerDown}
          onKeyDown={handle.onKeyDown}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      )}
      <button
        ref={toggleRef}
        type="button"
        className={`folder-toggle${onRename ? '' : ' is-wide'}`}
        aria-expanded={expanded}
        aria-label={label}
        onClick={onToggle}
        onKeyDown={toggleKeys}
      >
        <span className="folder-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {/* A read-only folder has no name button: its whole header toggles it. */}
        {!onRename && <span className="folder-name">{shown}</span>}
      </button>
      {renaming && onRename ? (
        <span className="folder-rename">
          <input
            ref={inputRef}
            className="folder-name-input"
            aria-label={`Name of folder ${plain}`}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            maxLength={512}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); finish(true, true) }
              else if (event.key === 'Backspace' && onNameBackspace &&
                event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
                if (!onNameBackspace(draft)) return
                event.preventDefault()
                ended.current = true
                setError(null)
                onRenamingChange(false)
              }
              else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false) }
            }}
            onBlur={() => { if (!error) finish(true) }}
          />
          {error && <span id={errorId} className="folder-error" role="alert">{error}</span>}
        </span>
      ) : onRename && (
        <button
          type="button"
          className="folder-name-button"
          aria-label={`Rename folder ${plain}`}
          title="Click to rename (F2)"
          onClick={() => onRenamingChange(true)}
          onKeyDown={toggleKeys}
        >
          <span className="folder-name">{shown}</span>
        </button>
      )}
      <span className="folder-count" aria-hidden="true">{entryCount}</span>
      {!renaming && (onDelete || onDeleteWithContents || children) && (
        <span className="folder-actions">
          {children}
          {onDeleteWithContents && (
            <DeleteContentsButton name={plain} contents={entryCount > 0 ? count : 'subfolders'} onConfirm={onDeleteWithContents} />
          )}
          {onDelete && (
            <button
              type="button"
              className="folder-action folder-delete"
              aria-label={`Remove folder ${plain}`}
              title="Remove folder"
              onClick={onDelete}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * Deletes a folder with its contents. A broad destructive action keeps the
 * sustained hold of the clear button (`useHoldToConfirm`), with the same
 * progress ring.
 */
function DeleteContentsButton({ name, contents, onConfirm }: Readonly<{ name: string; contents: string; onConfirm(): void }>) {
  const hold = useHoldToConfirm(onConfirm)
  return (
    <button
      type="button"
      className={`folder-action folder-delete-contents hold-action${hold.holding ? ' is-holding' : ''}`}
      aria-label={`Hold to delete folder ${name} and its ${contents}`}
      title="Hold to delete the folder and its rows"
      {...hold.props}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v4.5M9.2 6.5v4.5" />
      </svg>
    </button>
  )
}
