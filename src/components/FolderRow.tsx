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
import { CLEAR_HOLD_MS } from './ClearExpressionsButton'

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
   * Called when Enter has validated the name: moves focus into the folder and
   * returns true, or returns false to leave focus on the folder itself.
   */
  onNameEntered?(): boolean
  /** Absent for a read-only folder. */
  onDelete?(): void
  /**
   * Removes the folder with everything it holds. When given, a click on the
   * remove button keeps the entries (`onDelete`) and a sustained hold, as for
   * clearing every expression, removes them too.
   */
  onDeleteContents?(): void
  /** The handle that moves the folder by pointer and keyboard; absent when folders cannot be moved. */
  handle?: Readonly<{
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void
  }>
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
  onToggle, onRename, onNameEntered, onDelete, onDeleteContents, handle, className, rowRef, children,
}: FolderRowProps) {
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /** Set once Enter or Escape ends the rename, so the blur that follows does not commit again. */
  const ended = useRef(false)
  const idSuffix = path.map(encodeURIComponent).join('/')
  const errorId = `folder-error-${idSuffix}`
  const hintId = `folder-remove-hint-${idSuffix}`

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
      const inside = entered && (onNameEntered?.() ?? false)
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

  // Remove: a click keeps the entries; a sustained hold removes them too.
  const [holding, setHolding] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Set when the hold completed, so that the release that follows removes nothing more. */
  const held = useRef(false)
  const cancelHold = () => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current)
    holdTimer.current = null
    setHolding(false)
  }
  useEffect(() => cancelHold, [])
  const beginHold = () => {
    held.current = false
    if (!onDeleteContents || holdTimer.current !== null) return
    setHolding(true)
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      held.current = true
      setHolding(false)
      onDeleteContents()
    }, CLEAR_HOLD_MS)
  }
  /** The end of a press: a short one removes the folder only. */
  const release = () => {
    cancelHold()
    if (!held.current) onDelete?.()
    held.current = false
  }

  const count = `${entryCount} ${entryCount === 1 ? entryNoun[0] : entryNoun[1]}`
  const label = `Folder ${name}, level ${level}, ${count}`
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
          aria-label={`Reorder folder ${name}. Alt plus arrow keys to move.`}
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
        {!onRename && <span className="folder-name">{name}</span>}
      </button>
      {renaming && onRename ? (
        <span className="folder-rename">
          <input
            ref={inputRef}
            className="folder-name-input"
            aria-label={`Name of folder ${name}`}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            maxLength={512}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); finish(true, true) }
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
          aria-label={`Rename folder ${name}`}
          title="Click to rename (F2)"
          onClick={() => onRenamingChange(true)}
          onKeyDown={toggleKeys}
        >
          <span className="folder-name">{name}</span>
        </button>
      )}
      <span className="folder-count" aria-hidden="true">{entryCount}</span>
      {!renaming && (onDelete || children) && (
        <span className="folder-actions">
          {children}
          {onDelete && (
            <button
              type="button"
              className={`folder-action folder-delete${holding ? ' is-holding' : ''}`}
              style={onDeleteContents ? { '--hold-duration': `${CLEAR_HOLD_MS}ms` } as CSSProperties : undefined}
              aria-label={`Remove folder ${name}`}
              aria-describedby={onDeleteContents ? hintId : undefined}
              title={onDeleteContents ? `Remove folder; hold to remove its ${entryNoun[1]} too` : 'Remove folder'}
              // A pointer press is handled by its release, so that a completed hold is
              // not followed by a click; a click without a press comes from assistive technology.
              onClick={(event) => { if (event.detail === 0) onDelete() }}
              onPointerDown={(event) => { if (event.button === 0) beginHold() }}
              onPointerUp={(event) => { if (event.button === 0) release() }}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              onBlur={cancelHold}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                if (!event.repeat) beginHold()
              }}
              onKeyUp={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                release()
              }}
            >
              <span aria-hidden="true">×</span>
              {onDeleteContents && (
                <span className="visually-hidden" id={hintId}>
                  Press to remove the folder and keep its {entryNoun[1]}. Hold to remove the folder and its {count}.
                </span>
              )}
            </button>
          )}
        </span>
      )}
    </div>
  )
}
