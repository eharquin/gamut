import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { filterLibraryEntries, type LibraryEntry } from '../document/documentLibrary'
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
  /** The registered algebras, in filter order; the filter shows their family, such as `VGA`. */
  algebras: readonly Pick<AlgebraDefinition, 'algebraId' | 'badge'>[]
  /** Identity of the open graph, marked in the list when it is stored. */
  openId: string
  /** Set when Save asks for a name before the first save; the draft starts with the title. */
  naming: Readonly<{ initialName: string }> | null
  /** A library or storage problem to report in text. */
  diagnostic: string | null
  /** Whether the open graph differs from its last saved revision, or is unsaved content. */
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
  /** In a temporary session: copies the scene into the library, as Save local copy does. */
  onAddScene(): void
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
  returnFocusRef, overlayHost, entries, algebras, openId, naming, diagnostic,
  unsavedChanges, temporarySession, currentName,
  onSaveAs, onSaveAsNew, onNew, onOpen, onRename, onDuplicate, onDelete,
  onOpenExample, onAddExample, onAddScene, onClose,
}: LibraryPanelProps) {
  const ref = useRef<HTMLElement>(null)
  const overlay = useMediaQuery(LIBRARY_OVERLAY_QUERY)
  const [section, setSection] = useState<Section>('mine')
  const [algebraId, setAlgebraId] = useState<string | null>(null)
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

  // Focus moves into the panel on open and returns to the button that opened it.
  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current
    ref.current?.querySelector<HTMLElement>('.library-naming input, [role="tab"][aria-selected="true"]')?.focus()
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
              else if (pending.then === 'open') onOpen(pending.entry)
              else onOpenExample(pending.example)
            }}
          >{confirm}</button>
          <button type="button" onClick={() => setPending(null)}>Cancel</button>
        </div>
      </div>
    )
  })()

  const shownEntries = filterLibraryEntries(entries, algebraId)
  const shownExamples = examples.filter((example) => algebraId === null || example.algebraId === algebraId)

  const panel = (
    <section
      ref={ref}
      id="library-panel"
      className={`library-panel${overlay ? ' is-overlay' : ''}`}
      aria-label="Library"
    >
      <header className="appearance-header library-panel-header">
        <strong>Library</strong>
        <span />
        <button type="button" className="appearance-close" onClick={onClose}
          aria-label="Close library" title="Close">×</button>
      </header>
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
          <div className="library-commands">
            <button type="button" className="library-new" onClick={requestNew}>+ New graph</button>
            {!naming && !savingAsNew && (
              <button
                type="button"
                className="library-save-as"
                onClick={() => { setNameDraft(`${currentName} copy`); setSavingAsNew(true) }}
              >Save as new graph…</button>
            )}
          </div>
          {shownEntries.length === 0 ? (
            <p className="library-empty">{entries.length === 0
              ? 'No saved graphs yet. Save keeps the open graph here.'
              : 'No saved graphs in this algebra.'}</p>
          ) : (
            <ul className="library-list" aria-label="Saved graphs">
              {shownEntries.map((entry) => (
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
                    <span className="library-algebra">{label(entry.algebraId)}</span>
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
          )}
        </div>
        <div className="library-section" id="library-section-examples" role="tabpanel" aria-labelledby="library-tab-examples"
          hidden={section !== 'examples'}>
          {diagnostic && <p className="library-diagnostic" role="alert">{diagnostic}</p>}
          {examplesDiagnostic && <p className="library-diagnostic" role="alert">{examplesDiagnostic}</p>}
          <p className="library-note">Examples are read-only. Add one to your library to keep your changes.</p>
          {shownExamples.length === 0 ? (
            <p className="library-empty">No examples in this algebra.</p>
          ) : (
            <ul className="library-list" aria-label="Examples">
              {shownExamples.map((example) => (
                <li key={example.id}>
                  <button
                    type="button"
                    className="library-open"
                    aria-label={`Open example ${example.name}`}
                    onClick={() => requestExample(example)}
                  >
                    <span className="library-name">{example.name}</span>
                    {example.description && <span className="library-description">{example.description}</span>}
                  </button>
                  <div className="library-meta">
                    <span className="library-algebra">{label(example.algebraId)}</span>
                    <div className="library-actions">
                      <button type="button" aria-label={`Add ${example.name} to my library`} title="Add to my library"
                        onClick={() => onAddExample(example)}>Add to my library</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
  return overlay && overlayHost ? createPortal(panel, overlayHost) : panel
}
