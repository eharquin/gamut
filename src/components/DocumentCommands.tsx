import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

export type GraphNameFieldProps = Readonly<{
  /** The open graph's name, or `''` for a graph never saved, shown as “Untitled”. */
  name: string
  /** Set in a temporary scene-link session, whose label the field shows read-only. */
  temporaryLabel: string | null
  /** Called with a new, non-empty name when the field is confirmed. */
  onRename(name: string): void
}>

/**
 * The open graph's name, left of Save (#212). Clicking it edits the name;
 * Enter or leaving the field confirms it, and Escape restores it.
 */
export function GraphNameField({ name, temporaryLabel, onRename }: GraphNameFieldProps) {
  const [draft, setDraft] = useState(name)
  const editing = useRef(false)
  // The shown name follows the open graph unless the user is editing it.
  useEffect(() => {
    if (!editing.current) setDraft(name)
  }, [name])
  const commit = () => {
    editing.current = false
    const next = draft.trim()
    if (next && next !== name) onRename(next)
    else setDraft(name)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // Leaving the field must not confirm the abandoned draft.
      editing.current = false
      setDraft(name)
      event.currentTarget.blur()
    }
  }
  // Inputs do not truncate their text with an ellipsis in every browser, so
  // the name is drawn by a truncated copy while the field is not edited.
  if (temporaryLabel !== null) {
    return (
      <span className="graph-name-field">
        <input
          className="graph-name is-placeholder"
          value={temporaryLabel}
          readOnly
          aria-label="Open graph name"
          title="A shared scene is temporary until it is saved"
        />
        <span className="graph-name-text is-placeholder" aria-hidden="true">{temporaryLabel}</span>
      </span>
    )
  }
  return (
    <span className="graph-name-field">
      <input
        className={`graph-name${name === '' ? ' is-placeholder' : ''}`}
        value={draft}
        placeholder="Untitled"
        aria-label="Open graph name"
        title={name === '' ? 'Name this graph to save it in the library' : 'Rename this graph'}
        spellCheck={false}
        onFocus={(event) => {
          editing.current = true
          event.currentTarget.select()
        }}
        onChange={(event) => {
          editing.current = true
          setDraft(event.target.value)
        }}
        onBlur={() => {
          if (editing.current) commit()
        }}
        onKeyDown={onKeyDown}
      />
      <span className="graph-name-text" aria-hidden="true">{draft}</span>
    </span>
  )
}

export type LibraryCommandProps = Readonly<{
  /** Saves the open graph in the local library (#212). */
  onSave(): void
  /** Whether the open graph differs from its last saved revision. */
  unsavedChanges: boolean
  /** Opens or closes the library menu. */
  onLibrary(): void
  libraryOpen: boolean
  saveRef: RefObject<HTMLButtonElement | null>
  libraryRef: RefObject<HTMLButtonElement | null>
}>

/** Save, with a dot while the open graph has unsaved changes, and Library (#212). */
export function LibraryCommands({ onSave, unsavedChanges, onLibrary, libraryOpen, saveRef, libraryRef }: LibraryCommandProps) {
  const saveLabel = unsavedChanges ? 'Save (unsaved changes)' : 'Save'
  return (
    <>
      <button
        ref={saveRef}
        type="button"
        className="settings-menu-button document-command-button save-button"
        aria-label={saveLabel}
        title={saveLabel}
        onClick={onSave}
      >
        {/* A floppy disk. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.75 3.5c0-.41.34-.75.75-.75h7.19l2.56 2.56v7.19c0 .41-.34.75-.75.75h-9c-.41 0-.75-.34-.75-.75z" fill="none" strokeLinejoin="round" />
          <path d="M5.25 2.75v3h4.5v-3M5 13.25v-4h6v4" fill="none" strokeLinejoin="round" />
        </svg>
        {unsavedChanges && <span className="unsaved-dot" aria-hidden="true" />}
      </button>
      <button
        ref={libraryRef}
        type="button"
        className={`settings-menu-button document-command-button${libraryOpen ? ' is-open' : ''}`}
        aria-label="Library"
        title="Library"
        aria-haspopup="dialog"
        aria-expanded={libraryOpen}
        onClick={onLibrary}
      >
        {/* Three books on a shelf. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 13.5h11M3.5 13.5v-10h2.5v10M6 13.5v-8h2.5v8M9.25 13.35l-1.1-7.6 2.45-.35 1.1 7.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  )
}

/** File commands offered in the header; the caller owns their effects. */
export type DocumentCommandHandlers = Readonly<{
  onImport(): void
  onExport(): void
  onCopyLink(): void
  /** True while a scene link is being created. */
  sharing: boolean
}>

/**
 * Import, Export, and Copy link as icon buttons, drawn like the theme button
 * and the settings cogwheel (#249). They keep the behavior they had in the
 * settings menu: the file chooser, the `.gamut.json` download, and the
 * copied-link notice.
 */
export function DocumentCommands({ onImport, onExport, onCopyLink, sharing }: DocumentCommandHandlers) {
  return (
    <>
      <button
        type="button"
        className="settings-menu-button document-command-button"
        aria-label="Import document"
        title="Import document"
        onClick={onImport}
      >
        {/* A tray with an arrow coming in. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 10.25v2.5c0 .41.34.75.75.75h9.5c.41 0 .75-.34.75-.75v-2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 1.75v7.5M5 6.25l3 3 3-3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="settings-menu-button document-command-button"
        aria-label="Export document"
        title="Export document"
        onClick={onExport}
      >
        {/* A tray with an arrow going out. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 10.25v2.5c0 .41.34.75.75.75h9.5c.41 0 .75-.34.75-.75v-2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 9.25v-7.5M5 4.75l3-3 3 3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="settings-menu-button document-command-button"
        aria-label="Copy link"
        title="Copy link"
        disabled={sharing}
        onClick={onCopyLink}
      >
        {/* A chain link. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6.9 9.1a2.6 2.6 0 0 0 3.68 0l2.45-2.45a2.6 2.6 0 0 0-3.68-3.68l-.85.85" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.1 6.9a2.6 2.6 0 0 0-3.68 0L2.97 9.35a2.6 2.6 0 0 0 3.68 3.68l.85-.85" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  )
}
