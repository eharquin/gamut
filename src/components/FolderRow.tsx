import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { folderKey, type FolderPath } from '../document/folderModel'

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
  /** Absent for a read-only folder. */
  onDelete?(): void
  /** Classes the panel adds, such as a drop indicator. */
  className?: string
  rowRef?(element: HTMLElement | null): void
  /** Further actions after Rename and Remove. */
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
 * nesting level and its size and exposes its expanded state (A11Y-011), and
 * the rename and remove actions of an editable folder. The name is plain text.
 */
export function FolderRow({
  path, name, level, expanded, entryCount, entryNoun, renaming, onRenamingChange,
  onToggle, onRename, onDelete, className, rowRef, children,
}: FolderRowProps) {
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  /** Set once Enter or Escape ends the rename, so the blur that follows does not commit again. */
  const ended = useRef(false)
  const errorId = `folder-error-${path.map(encodeURIComponent).join('/')}`

  useEffect(() => {
    if (!renaming) return
    ended.current = false
    setDraft(name)
    setError(null)
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [renaming, name])

  useEffect(() => {
    if (focusOnMount !== folderKey(path)) return
    focusOnMount = null
    toggleRef.current?.focus()
    // Read on mount only: the row that a rename just created takes focus.
  }, [])

  const finish = (commit: boolean) => {
    if (ended.current) return
    if (commit && onRename) {
      const problem = onRename(draft)
      if (problem) {
        setError(problem)
        inputRef.current?.focus()
        return
      }
      const renamed = draft.trim()
      focusOnMount = renamed === name ? null : folderKey([...path.slice(0, -1), renamed])
    }
    ended.current = true
    setError(null)
    onRenamingChange(false)
    requestAnimationFrame(() => toggleRef.current?.focus())
  }

  const count = `${entryCount} ${entryCount === 1 ? entryNoun[0] : entryNoun[1]}`
  return (
    <div
      ref={rowRef}
      className={`folder-row${expanded ? '' : ' is-collapsed'}${className ? ` ${className}` : ''}`}
      style={{ '--folder-level': level } as CSSProperties}
    >
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
              if (event.key === 'Enter') { event.preventDefault(); finish(true) }
              else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false) }
            }}
            onBlur={() => { if (!error) finish(true) }}
          />
          {error && <span id={errorId} className="folder-error" role="alert">{error}</span>}
        </span>
      ) : (
        <button
          ref={toggleRef}
          type="button"
          className="folder-toggle"
          aria-expanded={expanded}
          aria-label={`Folder ${name}, level ${level}, ${count}`}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === 'F2' && onRename) { event.preventDefault(); onRenamingChange(true) }
            else if (event.key === 'ArrowRight' && !expanded) { event.preventDefault(); onToggle() }
            else if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); onToggle() }
          }}
        >
          <span className="folder-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          <span className="folder-name">{name}</span>
          <span className="folder-count" aria-hidden="true">{entryCount}</span>
        </button>
      )}
      {!renaming && (onRename || onDelete || children) && (
        <span className="folder-actions">
          {onRename && (
            <button type="button" className="folder-action" aria-label={`Rename folder ${name}`} title="Rename (F2)"
              onClick={() => onRenamingChange(true)}>
              <span aria-hidden="true">✎</span>
            </button>
          )}
          {onDelete && (
            <button type="button" className="folder-action" aria-label={`Remove folder ${name}`} title="Remove folder"
              onClick={onDelete}>
              <span aria-hidden="true">×</span>
            </button>
          )}
          {children}
        </span>
      )}
    </div>
  )
}
