import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { entryFolder, filterLibraryEntries, libraryFolderEntries, type LibraryEntry } from '../document/documentLibrary'
import { ancestorPaths, describeFolder, folderKey, samePath, withAncestors, type FolderPath } from '../document/folderModel'
import type { LibraryFolderActions } from '../hooks/useLibraryFolderActions'
import { useLibraryFolderCollapse } from '../hooks/useLibraryFolderCollapse'
import { LibraryTree } from './LibraryTree'
import type { AlgebraDefinition } from '../algebra/algebraDefinition'
import { readExamples, type LibraryExample } from '../examples'
import { useMediaQuery } from '../hooks/useMediaQuery'

/**
 * Below this window width the panel opens over the viewport instead of beside
 * it (A11Y-012, #266): 720 CSS pixels, written as a query that excludes 720.
 */
export const LIBRARY_OVERLAY_QUERY = '(max-width: 719.98px)'

type Section = 'mine' | 'examples'

type Pending =
  | Readonly<{ kind: 'delete'; entry: LibraryEntry }>
  | Readonly<
    | { kind: 'discard'; then: 'new' }
    | { kind: 'discard'; then: 'open'; entry: LibraryEntry }
    | { kind: 'discard'; then: 'example'; example: LibraryExample }
  >
  | Readonly<{ kind: 'rename'; entry: LibraryEntry; draft: string }>
  | Readonly<{ kind: 'delete-folder'; path: FolderPath; count: number }>

/** What a library export or import did: one sentence, and the entries it left out. */
export type LibraryArchiveReport = Readonly<{ message: string; details: readonly string[] }>

export type LibraryPanelProps = Readonly<{
  /** The button focus returns to on close: Library, or Save when Save asked for a name. */
  returnFocusRef: RefObject<HTMLButtonElement | null>
  /**
   * The viewport the panel is laid over on a narrow window, so that it never
   * covers the expression panel; without a viewport (NoViz) it covers the
   * workspace.
   */
  overlayHost: HTMLElement | null
  entries: readonly LibraryEntry[]
  /** Every folder of My library, empty ones included (STORE-016). */
  folders: readonly FolderPath[]
  folderActions: LibraryFolderActions
  /** The registered algebras, in filter order; the filter shows their family, such as `VGA`. */
  algebras: readonly Pick<AlgebraDefinition, 'algebraId' | 'badge'>[]
  /** Identity of the open graph, marked in the list when it is stored. */
  openId: string
  /** Set when Save asks for a name before the first save; the draft starts with the title. */
  naming: Readonly<{ initialName: string }> | null
  /** A library or storage problem to report in text. */
  diagnostic: string | null
  /**
   * Whether leaving the open graph discards work: it differs from its last saved
   * revision, or is unsaved content other than an example opened unchanged.
   */
  unsavedChanges: boolean
  /** Set in a temporary scene-link session, whose scene is not stored. */
  temporarySession: boolean
  /** The open graph's name, the start of a Save as new graph name. */
  currentName: string
  onSaveAs(name: string): void
  /** Saves the open graph as a new library graph, leaving its saved version untouched. */
  onSaveAsNew(name: string): void
  onNew(): void
  onOpen(entry: LibraryEntry): void
  onRename(entry: LibraryEntry, name: string): void
  onDuplicate(entry: LibraryEntry): void
  onDelete(entry: LibraryEntry): void
  /** Opens an example unbound from any library graph. */
  onOpenExample(example: LibraryExample): void
  /** Stores a copy of an example in My library. */
  onAddExample(example: LibraryExample): void
  /** In a temporary session: copies the scene into the library. */
  onAddScene(): void
  /** The drawing of a saved graph on its card, or nothing while it cannot be read. */
  graphThumbnail?(entry: LibraryEntry): ReactNode
  /** The drawing of an example on its card. */
  exampleThumbnail?(example: LibraryExample): ReactNode
  /** The outcome of the last library export or import, shown until dismissed. */
  archiveReport: LibraryArchiveReport | null
  onDismissArchiveReport(): void
  /** Downloads the whole library as a `.zip` archive (STORE-017). */
  onExportLibrary(): void
  /** Imports a `.zip` archive into a new folder (STORE-018). */
  onImportLibrary(file: File): void
  onClose(): void
}>

const dateFormat = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return null
  }
})()

const dayFormat = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
  } catch {
    return null
  }
})()

/** The day of a date, for a card; its time shows on hover. */
function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return dayFormat ? dayFormat.format(date) : date.toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return dateFormat ? dateFormat.format(date) : date.toISOString()
}

/** The docked panel's width, in CSS pixels: 420 by default, never narrower than 320. */
export const LIBRARY_DEFAULT_WIDTH = 420
export const LIBRARY_MIN_WIDTH = 320
/** The width the panel always leaves to the canvas, or to the expressions in NoViz. */
export const LIBRARY_RESERVED_WIDTH = 320
/** How far an arrow key moves the panel's edge; with Shift, four times as far. */
const LIBRARY_WIDTH_STEP = 20
/** Per-browser preference: the width of the docked library panel. */
export const LIBRARY_WIDTH_STORAGE_KEY = 'gamut.libraryWidth'

function restoredLibraryWidth(temporarySession: boolean): number {
  if (temporarySession) return LIBRARY_DEFAULT_WIDTH
  try {
    const stored = Number(window.localStorage.getItem(LIBRARY_WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored >= LIBRARY_MIN_WIDTH ? Math.round(stored) : LIBRARY_DEFAULT_WIDTH
  } catch {
    return LIBRARY_DEFAULT_WIDTH
  }
}

function persistLibraryWidth(width: number): void {
  try {
    if (width === LIBRARY_DEFAULT_WIDTH) window.localStorage.removeItem(LIBRARY_WIDTH_STORAGE_KEY)
    else window.localStorage.setItem(LIBRARY_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // The width still applies for this visit when browser storage is unavailable.
  }
}

/** Three dots: the button of a group of further actions. */
const moreIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" />
  </svg>
)

/**
 * A button that shows a group of further actions below it, and hides it on a
 * second press, on Escape (which then answers nothing else), on a press
 * outside, or once one of its buttons is used.
 */
function ActionsDisclosure({ label, title, className, children }: Readonly<{
  label: string
  title?: string
  className?: string
  children: ReactNode
}>) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])
  return (
    <div
      ref={wrapperRef}
      className={`library-disclosure${className ? ` ${className}` : ''}${open ? ' is-open' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        event.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="library-more"
        aria-label={label}
        title={title ?? label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >{moreIcon}</button>
      <div
        id={id}
        className="library-popover"
        role="group"
        aria-label={label}
        hidden={!open}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button')) setOpen(false)
        }}
      >{children}</div>
    </div>
  )
}

/** Whether a name or description holds the searched text, whatever its case. */
function matches(query: string, ...texts: readonly (string | undefined)[]): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return needle === '' || texts.some((text) => text?.toLocaleLowerCase().includes(needle))
}

const SECTIONS: readonly Readonly<{ id: Section; label: string }>[] = [
  { id: 'mine', label: 'My library' },
  { id: 'examples', label: 'Examples' },
]

/**
 * The library panel (#266, STORE-014, A11Y-010), docked on the right of the
 * workspace so that the viewport resizes beside it, and laid over the
 * viewport on a narrow window. It opens on **My library**, the graphs of the
 * local library (#212) with New, Open, Rename, Duplicate, Delete, and Save as
 * new graph; **Examples** lists the shipped, read-only examples, which open
 * unbound or are copied into My library. An algebra filter applies to both
 * sections. Delete, and discarding unsaved changes, are confirmed inside the
 * panel; Escape answers a confirmation before it closes the panel.
 */
export function LibraryPanel({
  returnFocusRef, overlayHost, entries, folders, folderActions, algebras, openId, naming, diagnostic,
  unsavedChanges, temporarySession, currentName,
  onSaveAs, onSaveAsNew, onNew, onOpen, onRename, onDuplicate, onDelete,
  onOpenExample, onAddExample, onAddScene, graphThumbnail, exampleThumbnail, archiveReport, onDismissArchiveReport, onExportLibrary, onImportLibrary, onClose,
}: LibraryPanelProps) {
  const ref = useRef<HTMLElement>(null)
  const archiveInputRef = useRef<HTMLInputElement>(null)
  const overlay = useMediaQuery(LIBRARY_OVERLAY_QUERY)
  const [section, setSection] = useState<Section>('mine')
  const [algebraId, setAlgebraId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState(() => restoredLibraryWidth(temporarySession))
  const [pending, setPending] = useState<Pending | null>(null)
  // Escape answers a confirmation first, and closes the panel only without one.
  const pendingRef = useRef<Pending | null>(null)
  pendingRef.current = pending
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay
  const [nameDraft, setNameDraft] = useState(naming?.initialName ?? '')
  // Save as new graph asks for the copy's name in the same form as a first save.
  const [savingAsNew, setSavingAsNew] = useState(false)
  const showNaming = naming !== null || savingAsNew
  const collapse = useLibraryFolderCollapse(temporarySession)
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // An export or import reports in My library, whichever section was shown, and in the live region.
  useEffect(() => {
    if (!archiveReport) return
    setSection('mine')
    setAnnouncement(archiveReport.message)
  }, [archiveReport])
  // A library problem is shown in My library too.
  useEffect(() => { if (diagnostic) setSection('mine') }, [diagnostic])

  // Focus moves into the panel on open and returns to the button that opened it.
  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current
    // The name asked for by Save first, else the selected section's tab.
    const target = ref.current?.querySelector<HTMLElement>('.library-naming input') ??
      ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    target?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // Docked, the panel answers Escape only while it holds the focus; laid
      // over the viewport, it closes on Escape wherever the focus is, except
      // inside another dialog or popover, which answers it first.
      const focused = document.activeElement
      const inPanel = !!ref.current?.contains(focused)
      if (!inPanel && (!overlayRef.current || focused?.closest('[role="dialog"], [role="alertdialog"]'))) return
      if (pendingRef.current) setPending(null)
      else onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnFocusTarget?.focus()
    }
  }, [returnFocusRef, onClose])

  // A confirmation takes focus, so that the keyboard lands on its question;
  // once it is answered or dismissed, focus stays in the panel.
  const hadPending = useRef(false)
  useEffect(() => {
    if (pending) ref.current?.querySelector<HTMLElement>('.library-confirm input, .library-confirm button')?.focus()
    else if (hadPending.current && !ref.current?.contains(document.activeElement)) {
      ref.current?.querySelector<HTMLElement>('.library-new, [role="tab"][aria-selected="true"]')?.focus()
    }
    hadPending.current = pending !== null
  }, [pending])

  const { examples, diagnostic: examplesDiagnostic } = readExamples()
  // The family part of the badge: `VGA · 2D` is filtered as VGA.
  const filters = [
    { algebraId: null, label: 'All' },
    ...algebras.map((algebra) => ({ algebraId: algebra.algebraId, label: algebra.badge.split(' · ')[0] })),
  ]
  const label = (id: string) => algebras.find((algebra) => algebra.algebraId === id)?.badge ?? (id || 'Unknown algebra')
  const requestOpen = (entry: LibraryEntry) => {
    if (entry.id !== openId && unsavedChanges) setPending({ kind: 'discard', then: 'open', entry })
    else onOpen(entry)
  }
  const requestNew = () => {
    if (unsavedChanges) setPending({ kind: 'discard', then: 'new' })
    else onNew()
  }
  const requestExample = (example: LibraryExample) => {
    if (unsavedChanges) setPending({ kind: 'discard', then: 'example', example })
    else onOpenExample(example)
  }
  const submitName = (event: FormEvent) => {
    event.preventDefault()
    const name = nameDraft.trim()
    if (!name) return
    if (savingAsNew) onSaveAsNew(name)
    else onSaveAs(name)
  }
  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    if (pending?.kind !== 'rename') return
    const name = pending.draft.trim()
    if (!name) return
    onRename(pending.entry, name)
    setPending(null)
  }
  const selectSection = (next: Section) => {
    setSection(next)
    setPending(null)
  }
  // Arrow keys, Home, and End move between the section tabs.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = SECTIONS.findIndex((candidate) => candidate.id === section)
    const target = event.key === 'ArrowRight' ? (index + 1) % SECTIONS.length
      : event.key === 'ArrowLeft' ? (index + SECTIONS.length - 1) % SECTIONS.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? SECTIONS.length - 1
            : null
    if (target === null) return
    event.preventDefault()
    selectSection(SECTIONS[target].id)
    ref.current?.querySelector<HTMLElement>(`#library-tab-${SECTIONS[target].id}`)?.focus()
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
      : pending.kind === 'delete-folder'
        ? `Delete the folder “${describeFolder(pending.path)}” with its subfolders and the ${pending.count === 1 ? 'graph' : `${pending.count} graphs`} it contains? This cannot be undone.`
        : 'The open graph has changes that are not saved in the library. Discard them?'
    const confirm = pending.kind === 'delete' ? 'Delete'
      : pending.kind === 'delete-folder' ? `Delete folder and ${pending.count === 1 ? 'graph' : `${pending.count} graphs`}`
        : pending.then === 'new' ? 'Discard and create' : 'Discard and open'
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
              else if (pending.kind === 'delete-folder') deleteFolder(pending.path)
              else if (pending.then === 'new') onNew()
              else if (pending.then === 'open') onOpen(pending.entry)
              else onOpenExample(pending.example)
            }}
          >{confirm}</button>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      </div>
    )
  })()

  const searching = query.trim() !== ''
  const shownEntries = filterLibraryEntries(entries, algebraId).filter((entry) => matches(query, entry.name))
  const shownExamples = examples.filter((example) => (algebraId === null || example.algebraId === algebraId) &&
    matches(query, example.name, example.description))
  // A filtered list shows the folders that hold a graph of that algebra, and
  // those that hold no graph at all, so that a new folder is not hidden.
  // A search shows only the folders that hold a match.
  const shownFolders = algebraId === null && !searching ? folders : withAncestors([
    ...(searching ? [] : folders.filter((path) => libraryFolderEntries(entries, path).length === 0)),
    ...shownEntries.map(entryFolder),
  ])
  const createFolder = (parent: FolderPath) => {
    const path = folderActions.createFolder(parent)
    if (!path) return
    if (parent.length > 0 && collapse.isCollapsed('mine', parent)) collapse.toggle('mine', parent)
    setRenamingFolder(folderKey(path))
    setAnnouncement(`Folder ${path[path.length - 1]} created in ${describeFolder(parent)}.`)
  }
  const deleteFolder = (path: FolderPath) => {
    if (!folderActions.deleteFolder(path)) return
    collapse.remove('mine', path)
    setAnnouncement(`Folder ${describeFolder(path)} deleted.`)
  }
  const requestDeleteFolder = (path: FolderPath) => {
    const count = libraryFolderEntries(entries, path).length
    if (count > 0) setPending({ kind: 'delete-folder', path, count })
    else deleteFolder(path)
  }
  const renameFolder = (path: FolderPath, name: string) => {
    const problem = folderActions.renameFolder(path, name)
    const renamed = [...path.slice(0, -1), name.trim()]
    if (problem === null && !samePath(path, renamed)) collapse.rename('mine', path, renamed)
    return problem
  }
  const moveGraph = (entry: LibraryEntry, folder: FolderPath) => {
    if (samePath(entryFolder(entry), folder) || !folderActions.moveGraph(entry, folder)) return
    // Every folder above the graph opens, so that its row stays visible.
    for (const ancestor of ancestorPaths(folder))
      if (collapse.isCollapsed('mine', ancestor)) collapse.toggle('mine', ancestor)
    setAnnouncement(`Moved ${entry.name} to ${folder.length === 0 ? 'the top level' : `folder ${describeFolder(folder)}`}.`)
    // Focus returns to the row's control once the list has reordered.
    requestAnimationFrame(() => document.getElementById(`library-move-${entry.id}`)?.focus())
  }
  const folderOptions = [{ key: folderKey([]), path: [] as FolderPath, label: 'Top level' },
    ...[...folders].sort((left, right) => describeFolder(left).localeCompare(describeFolder(right)))
      .map((path) => ({ key: folderKey(path), path, label: describeFolder(path) }))]

  // The docked panel widens to the left from its edge, and keeps the canvas
  // (or, in NoViz, the expressions) at least LIBRARY_RESERVED_WIDTH wide.
  const maximumWidth = () => {
    const frame = ref.current?.parentElement
    const frameWidth = frame?.getBoundingClientRect().width ?? 0
    // Without a layout (as in tests), only the minimum applies.
    if (!frame || frameWidth <= 0) return Number.POSITIVE_INFINITY
    const expressions = frame.querySelector('.visualizer') ? document.getElementById('expression-panel') : null
    const reserved = LIBRARY_RESERVED_WIDTH + (expressions?.getBoundingClientRect().width ?? 0)
    return Math.max(LIBRARY_MIN_WIDTH, frameWidth - reserved)
  }
  const resize = (next: number, persist: boolean) => {
    const clamped = Math.round(Math.max(LIBRARY_MIN_WIDTH, Math.min(maximumWidth(), next)))
    setWidth(clamped)
    if (persist && !temporarySession) persistLibraryWidth(clamped)
  }
  const resizeDrag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    resizeDrag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
  }
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current
    if (drag?.pointerId !== event.pointerId) return
    resize(drag.startWidth + drag.startX - event.clientX, false)
  }
  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeDrag.current?.pointerId !== event.pointerId) return
    resizeDrag.current = null
    resize(width, true)
  }
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? LIBRARY_WIDTH_STEP * 4 : LIBRARY_WIDTH_STEP
    const next = event.key === 'ArrowLeft' ? width + step
      : event.key === 'ArrowRight' ? width - step
        : event.key === 'Home' ? LIBRARY_MIN_WIDTH
          : event.key === 'End' ? Number.POSITIVE_INFINITY
            : null
    if (next === null) return
    event.preventDefault()
    resize(next, true)
  }

  const panel = (
    <section
      ref={ref}
      id="library-panel"
      className={`library-panel${overlay ? ' is-overlay' : ''}`}
      aria-label="Library"
      style={overlay ? undefined : { '--library-width': `${width}px` } as CSSProperties}
    >
      {!overlay && (
        <div
          className="library-resizer"
          role="separator"
          aria-label="Resize library panel"
          aria-orientation="vertical"
          aria-valuemin={LIBRARY_MIN_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to widen the library; double-click to reset its width"
          onPointerDown={beginResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={() => resize(LIBRARY_DEFAULT_WIDTH, true)}
          onKeyDown={resizeWithKeyboard}
        />
      )}
      <header className="library-panel-header">
        <h2>Library</h2>
        <div className="library-tabs" role="tablist" aria-label="Library sections">
          {SECTIONS.map((candidate) => (
            <button
              key={candidate.id}
              id={`library-tab-${candidate.id}`}
              type="button"
              role="tab"
              aria-selected={section === candidate.id}
              aria-controls={`library-section-${candidate.id}`}
              tabIndex={section === candidate.id ? 0 : -1}
              onClick={() => selectSection(candidate.id)}
              onKeyDown={onTabKeyDown}
            >{candidate.label}</button>
          ))}
        </div>
        <button type="button" className="library-close" onClick={onClose}
          aria-label="Close library" title="Close">×</button>
      </header>
      <div className="library-toolbar">
        <label className="library-search">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" />
            <path d="M10.5 10.5 14 14" />
          </svg>
          <input
            type="search"
            aria-label={section === 'mine' ? 'Search my library' : 'Search the examples'}
            placeholder={section === 'mine' ? 'Search graphs' : 'Search examples'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {section === 'mine' && <>
          <button type="button" className="library-new" onClick={requestNew}>+ New graph</button>
          <button type="button" className="library-new-folder" onClick={() => createFolder([])}>New folder</button>
          <ActionsDisclosure label="More library actions" title="Save as new graph, export or import the library">
            {!naming && !savingAsNew && (
              <button
                type="button"
                className="library-save-as"
                onClick={() => { setNameDraft(`${currentName} copy`); setSavingAsNew(true) }}
              >Save as new graph…</button>
            )}
            <button type="button" className="library-archive" onClick={onExportLibrary}>Export library</button>
            <button
              type="button"
              className="library-archive"
              aria-disabled={temporarySession || undefined}
              aria-describedby={temporarySession ? 'library-import-unavailable' : undefined}
              onClick={() => { if (!temporarySession) archiveInputRef.current?.click() }}
            >Import library</button>
          </ActionsDisclosure>
          <input
            ref={archiveInputRef}
            className="visually-hidden"
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            aria-label="Library archive to import"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0]
              // The same archive can be chosen again.
              event.target.value = ''
              if (file) onImportLibrary(file)
            }}
          />
        </>}
      </div>
      <div className="library-body">
        {showNaming && (
          <form className="library-confirm library-naming" onSubmit={submitName}>
            <label>
              <span>{savingAsNew
                ? 'Name the new graph; the saved version of this one stays as it is'
                : 'Name this graph to save it in the library'}</span>
              <input
                value={nameDraft}
                aria-label="Graph name"
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </label>
            <div className="library-confirm-actions">
              <button type="submit" disabled={!nameDraft.trim()}>Save</button>
              <button type="button" onClick={() => { if (savingAsNew) setSavingAsNew(false); else onClose() }}>Cancel</button>
            </div>
          </form>
        )}
        <div className="library-filter" role="group" aria-label="Filter by algebra">
          {filters.map((filter) => (
            <button
              key={filter.algebraId ?? 'all'}
              type="button"
              aria-pressed={algebraId === filter.algebraId}
              onClick={() => setAlgebraId(filter.algebraId)}
            >{filter.label}</button>
          ))}
        </div>
        {confirmation}
        {/* Both sections stay rendered, so that every tab controls its panel; the other one is hidden. */}
        <div className="library-section" id="library-section-mine" role="tabpanel" aria-labelledby="library-tab-mine"
          hidden={section !== 'mine'}>
          {temporarySession && (
            <div className="library-temporary">
              <p>This shared scene is temporary: browser storage is not used until you add it to your library.</p>
              <button type="button" className="library-add-scene" onClick={onAddScene}>Add to my library</button>
            </div>
          )}
          {diagnostic && <p className="library-diagnostic" role="alert">{diagnostic}</p>}
          {temporarySession && (
            <p id="library-import-unavailable" className="library-archive-note">
              Import library is unavailable in a temporary shared scene, which does not use browser storage.
            </p>
          )}
          {archiveReport && (
            <div className="library-archive-report" role="group" aria-label="Library archive">
              <p>{archiveReport.message}</p>
              {archiveReport.details.length > 0 && (
                <ul>{archiveReport.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
              )}
              <button type="button" onClick={onDismissArchiveReport}>Dismiss</button>
            </div>
          )}
          {shownEntries.length === 0 && shownFolders.length === 0 ? (
            <p className="library-empty">{searching
              ? `No saved graph matches “${query.trim()}”.`
              : entries.length === 0
                ? 'No saved graphs yet. Save keeps the open graph here.'
                : 'No saved graphs in this algebra.'}</p>
          ) : (
            <LibraryTree
              label="Saved graphs"
              entries={shownEntries}
              entryId={(entry) => entry.id}
              entryFolder={entryFolder}
              folders={shownFolders}
              // A search shows every match, inside collapsed folders too.
              isCollapsed={(path) => !searching && collapse.isCollapsed('mine', path)}
              onToggle={(path) => collapse.toggle('mine', path)}
              entryClassName={(entry) => entry.id === openId ? 'is-open' : undefined}
              onMoveEntry={(id, folder) => {
                const entry = entries.find((candidate) => candidate.id === id)
                if (entry) moveGraph(entry, folder)
              }}
              folderControls={(path) => ({
                renaming: renamingFolder === folderKey(path),
                onRenamingChange: (renaming) => setRenamingFolder(renaming ? folderKey(path) : null),
                onRename: (name) => renameFolder(path, name),
                onDelete: () => requestDeleteFolder(path),
                actions: (
                  <button type="button" className="folder-action" aria-label={`New folder in ${path[path.length - 1]}`}
                    title="New folder inside" onClick={() => createFolder(path)}>
                    <span aria-hidden="true">+</span>
                  </button>
                ),
              })}
              renderEntry={(entry) => <>
                <button
                  type="button"
                  className="library-open"
                  aria-current={entry.id === openId ? 'true' : undefined}
                  aria-label={`Open ${entry.name}`}
                  onClick={() => requestOpen(entry)}
                >
                  <span className="library-thumbnail">
                    {graphThumbnail?.(entry)}
                    {entry.id === openId && <span className="library-open-badge" aria-hidden="true">Open</span>}
                  </span>
                  <span className="library-name">{entry.name}</span>
                  <span className="library-meta">
                    <span className="library-algebra">{label(entry.algebraId)}</span>
                    <time dateTime={entry.updatedAt} title={formatDate(entry.updatedAt)}>{formatDay(entry.updatedAt)}</time>
                  </span>
                </button>
                <ActionsDisclosure label={`Actions for ${entry.name}`} className="library-card-actions">
                  <button type="button" aria-label={`Rename ${entry.name}`}
                    onClick={() => setPending({ kind: 'rename', entry, draft: entry.name })}>Rename</button>
                  <button type="button" aria-label={`Duplicate ${entry.name}`}
                    onClick={() => onDuplicate(entry)}>Duplicate</button>
                  {folders.length > 0 && (
                    <label className="library-move-field">
                      <span aria-hidden="true">Move to</span>
                      <select
                        id={`library-move-${entry.id}`}
                        className="library-move"
                        aria-label={`Move ${entry.name} to folder`}
                        value={folderKey(entryFolder(entry))}
                        onChange={(event) => {
                          const option = folderOptions.find((candidate) => candidate.key === event.target.value)
                          if (option) moveGraph(entry, option.path)
                        }}
                      >
                        {folderOptions.map((option) => (
                          <option key={option.key} value={option.key}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button type="button" className="is-destructive" aria-label={`Delete ${entry.name}`}
                    onClick={() => setPending({ kind: 'delete', entry })}>Delete</button>
                </ActionsDisclosure>
              </>}
            />
          )}
        </div>
        <div className="library-section" id="library-section-examples" role="tabpanel" aria-labelledby="library-tab-examples"
          hidden={section !== 'examples'}>
          {diagnostic && <p className="library-diagnostic" role="alert">{diagnostic}</p>}
          {examplesDiagnostic && <p className="library-diagnostic" role="alert">{examplesDiagnostic}</p>}
          <p className="library-note">Examples are read-only. Add one to your library to keep your changes.</p>
          {shownExamples.length === 0 ? (
            <p className="library-empty">{searching
              ? `No example matches “${query.trim()}”.`
              : 'No examples in this algebra.'}</p>
          ) : (
            <LibraryTree
              label="Examples"
              entries={shownExamples}
              entryId={(example) => example.id}
              entryFolder={(example) => example.folder}
              folders={[]}
              // The examples keep the order of their index.
              order="entries"
              isCollapsed={(path) => !searching && collapse.isCollapsed('examples', path)}
              onToggle={(path) => collapse.toggle('examples', path)}
              renderEntry={(example) => <>
                <button
                  type="button"
                  className="library-open"
                  aria-label={`Open example ${example.name}`}
                  onClick={() => requestExample(example)}
                >
                  <span className="library-thumbnail">{exampleThumbnail?.(example)}</span>
                  <span className="library-name">{example.name}</span>
                  {example.description && <span className="library-description">{example.description}</span>}
                  <span className="library-meta">
                    <span className="library-algebra">{label(example.algebraId)}</span>
                  </span>
                </button>
                <button type="button" className="library-add-example" aria-label={`Add ${example.name} to my library`}
                  title="Add to my library" onClick={() => onAddExample(example)}>
                  <span aria-hidden="true">+</span> Add to my library
                </button>
              </>}
            />
          )}
        </div>
        <output className="visually-hidden" aria-live="polite">{announcement}</output>
      </div>
    </section>
  )
  return overlay && overlayHost ? createPortal(panel, overlayHost) : panel
}
