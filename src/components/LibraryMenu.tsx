import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { LibraryEntry } from '../document/documentLibrary'
import { popoverPosition } from './popoverPosition'

const POPOVER_WIDTH = 340
const ESTIMATED_POPOVER_HEIGHT = 240

export type LibraryGroup = Readonly<{ algebraId: string; label: string; entries: readonly LibraryEntry[] }>

type Pending =
  | Readonly<{ kind: 'delete'; entry: LibraryEntry }>
  | Readonly<{ kind: 'discard'; then: 'new' } | { kind: 'discard'; then: 'open'; entry: LibraryEntry }>
  | Readonly<{ kind: 'rename'; entry: LibraryEntry; draft: string }>

type LibraryMenuProps = Readonly<{
  /** The Library button, which the menu is placed against. */
  anchorRef: RefObject<HTMLButtonElement | null>
  /** The button focus returns to on close: Library, or Save when Save asked for a name. */
  returnFocusRef: RefObject<HTMLButtonElement | null>
  groups: readonly LibraryGroup[]
  /** Identity of the open graph, marked in the list when it is stored. */
  openId: string
  /** Set when Save asks for a name before the first save; the draft starts with the title. */
  naming: Readonly<{ initialName: string }> | null
  /** A library or storage problem to report in text. */
  diagnostic: string | null
  /** Whether the open graph differs from its stored revision, or is unsaved content. */
  hasUnsavedChanges(): boolean
  onSaveAs(name: string): void
  onNew(): void
  onOpen(entry: LibraryEntry): void
  onRename(entry: LibraryEntry, name: string): void
  onDuplicate(entry: LibraryEntry): void
  onDelete(entry: LibraryEntry): void
  onClose(): void
}>

const dateFormat = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return null
  }
})()

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return dateFormat ? dateFormat.format(date) : date.toISOString()
}

/**
 * The local library of named graphs (#212), opened from the header like the
 * appearance menu: placed against its button, closed by Escape, the close
 * button, or a click outside, and returning focus. It lists the graphs grouped
 * by algebra with their name and last update, and offers New, Open, Rename,
 * Duplicate, and Delete. Delete, and discarding unsaved changes, are confirmed
 * inside the menu.
 */
export function LibraryMenu({
  anchorRef, returnFocusRef, groups, openId, naming, diagnostic, hasUnsavedChanges,
  onSaveAs, onNew, onOpen, onRename, onDuplicate, onDelete, onClose,
}: LibraryMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [nameDraft, setNameDraft] = useState(naming?.initialName ?? '')
  const [placement, setPlacement] = useState(() =>
    popoverPosition(anchorRef.current, POPOVER_WIDTH, ESTIMATED_POPOVER_HEIGHT))
  const place = useCallback(() => {
    const measured = ref.current?.scrollHeight ?? 0
    const next = popoverPosition(anchorRef.current, POPOVER_WIDTH, measured > 0 ? measured : ESTIMATED_POPOVER_HEIGHT)
    // Anchored at the right end of the header, the menu opens leftwards.
    const rect = anchorRef.current?.getBoundingClientRect?.()
    const left = rect ? Math.max(8, Math.min(next.left, rect.right - POPOVER_WIDTH)) : next.left
    setPlacement((current) => current.top === next.top && current.left === left ? current : { top: next.top, left })
  }, [anchorRef])

  useLayoutEffect(place)

  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current
    const anchor = anchorRef.current
    ref.current?.querySelector<HTMLElement>('input, button:not(.appearance-close)')?.focus()
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return
      if (anchor?.contains(event.target as Node)) return
      if (returnFocusTarget?.contains(event.target as Node)) return
      onClose()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      returnFocusTarget?.focus()
    }
  }, [anchorRef, returnFocusRef, onClose])

  // A confirmation takes focus, so that the keyboard lands on its question.
  useEffect(() => {
    if (pending) ref.current?.querySelector<HTMLElement>('.library-confirm input, .library-confirm button')?.focus()
  }, [pending])

  const requestOpen = (entry: LibraryEntry) => {
    if (entry.id !== openId && hasUnsavedChanges()) setPending({ kind: 'discard', then: 'open', entry })
    else onOpen(entry)
  }
  const requestNew = () => {
    if (hasUnsavedChanges()) setPending({ kind: 'discard', then: 'new' })
    else onNew()
  }
  const submitName = (event: FormEvent) => {
    event.preventDefault()
    const name = nameDraft.trim()
    if (name) onSaveAs(name)
  }
  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    if (pending?.kind !== 'rename') return
    const name = pending.draft.trim()
    if (!name) return
    onRename(pending.entry, name)
    setPending(null)
  }

  const confirmation = (() => {
    if (!pending) return null
    if (pending.kind === 'rename') {
      return (
        <form className="library-confirm" onSubmit={submitRename}>
          <label>
            <span>Rename “{pending.entry.name}”</span>
            <input
              value={pending.draft}
              aria-label={`New name for ${pending.entry.name}`}
              onChange={(event) => setPending({ ...pending, draft: event.target.value })}
            />
          </label>
          <div className="library-confirm-actions">
            <button type="submit" disabled={!pending.draft.trim()}>Rename</button>
            <button type="button" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </form>
      )
    }
    const question = pending.kind === 'delete'
      ? `Delete “${pending.entry.name}” from the library? This cannot be undone.`
      : 'The open graph has changes that are not saved in the library. Discard them?'
    const confirm = pending.kind === 'delete' ? 'Delete' : pending.then === 'new' ? 'Discard and create' : 'Discard and open'
    return (
      <div className="library-confirm" role="alertdialog" aria-label="Confirm" aria-describedby="library-confirm-question">
        <p id="library-confirm-question">{question}</p>
        <div className="library-confirm-actions">
          <button
            type="button"
            className="is-destructive"
            onClick={() => {
              setPending(null)
              if (pending.kind === 'delete') onDelete(pending.entry)
              else if (pending.then === 'new') onNew()
              else onOpen(pending.entry)
            }}
          >{confirm}</button>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      </div>
    )
  })()

  return createPortal(
    <div
      ref={ref}
      className="appearance-popover library-popover"
      role="dialog"
      aria-label="Library"
      style={{ top: placement.top, left: placement.left, width: POPOVER_WIDTH }}
    >
      <header className="appearance-header">
        <strong>Library</strong>
        <span />
        <button type="button" className="appearance-close" onClick={onClose}
          aria-label="Close Library menu" title="Close">×</button>
      </header>
      <div className="library-body">
        {naming && (
          <form className="library-confirm library-naming" onSubmit={submitName}>
            <label>
              <span>Name this graph to save it in the library</span>
              <input
                value={nameDraft}
                aria-label="Graph name"
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </label>
            <div className="library-confirm-actions">
              <button type="submit" disabled={!nameDraft.trim()}>Save</button>
              <button type="button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
        {diagnostic && <p className="library-diagnostic" role="alert">{diagnostic}</p>}
        {confirmation}
        <button type="button" className="library-new" onClick={requestNew}>+ New graph</button>
        {groups.length === 0 ? (
          <p className="library-empty">No saved graphs yet. Save keeps the open graph here.</p>
        ) : groups.map((group) => (
          <section key={group.algebraId} className="library-group" aria-label={group.label}>
            <h3>{group.label}</h3>
            <ul>
              {group.entries.map((entry) => (
                <li key={entry.id} className={entry.id === openId ? 'is-open' : undefined}>
                  <button
                    type="button"
                    className="library-open"
                    aria-current={entry.id === openId ? 'true' : undefined}
                    aria-label={`Open ${entry.name}`}
                    onClick={() => requestOpen(entry)}
                  >
                    <span className="library-name">{entry.name}</span>
                  </button>
                  <div className="library-meta">
                    <time dateTime={entry.updatedAt}>{formatDate(entry.updatedAt)}</time>
                    <div className="library-actions">
                      <button type="button" aria-label={`Rename ${entry.name}`} title="Rename"
                        onClick={() => setPending({ kind: 'rename', entry, draft: entry.name })}>Rename</button>
                      <button type="button" aria-label={`Duplicate ${entry.name}`} title="Duplicate"
                        onClick={() => onDuplicate(entry)}>Duplicate</button>
                      <button type="button" aria-label={`Delete ${entry.name}`} title="Delete"
                        onClick={() => setPending({ kind: 'delete', entry })}>Delete</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  )
}
