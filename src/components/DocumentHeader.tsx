import { useRef, type ChangeEvent, type RefObject } from 'react'
import type { ThemeMode } from '../document/canonicalDocument'
import { AlgebraMenu, type AlgebraChoice } from './AlgebraMenu'
import { DocumentCommands, GraphNameField, LibraryCommands } from './DocumentCommands'
import { SettingsMenu, type DisplaySettings } from './SettingsMenu'
import { ThemeToggle } from './ThemeToggle'

/** The header buttons that other parts of the editor focus or anchor to. */
export type DocumentHeaderRefs = Readonly<{
  /** The algebra information button, to which the information dialog returns focus. */
  algebraInfoButtonRef: RefObject<HTMLButtonElement | null>
  /** The Save button, to which the library menu returns focus after a save request. */
  saveButtonRef: RefObject<HTMLButtonElement | null>
  /** The Library button, which anchors the library menu. */
  libraryButtonRef: RefObject<HTMLButtonElement | null>
}>

export type DocumentHeaderActions = Readonly<{
  selectAlgebra(algebraId: string): void
  showAlgebraInfo(): void
  renameGraph(name: string): void
  saveToLibrary(): void
  toggleLibrary(): void
  /** Opens a document file chosen in the file dialog. */
  importFile(file: File): Promise<void>
  exportDocument(): void
  copyLink(): void
  changeTheme(theme: ThemeMode): void
  changeDisplay(change: Partial<DisplaySettings>): void
}>

export type DocumentHeaderProps = Readonly<{
  algebraBadge: string
  algebraChoices: readonly AlgebraChoice[]
  selectedAlgebraId: string
  /** The open graph's name, or `''` for a graph never saved. */
  graphName: string
  /** Set in a temporary scene-link session, whose graph name is read-only. */
  temporarySession: boolean
  unsavedChanges: boolean
  libraryOpen: boolean
  /** Set while a scene link is being created. */
  sharing: boolean
  theme: ThemeMode
  display: DisplaySettings
  /** Whether the display settings that only affect the canvas are offered. */
  renderingSettings: boolean
  refs: DocumentHeaderRefs
  actions: DocumentHeaderActions
}>

/**
 * The application header: home link, algebra menu, and three command groups
 * for the open graph (name, Save, Library), the document file (Import,
 * Export, Copy link), and the display (theme and settings).
 */
export function DocumentHeader({
  algebraBadge,
  algebraChoices,
  selectedAlgebraId,
  graphName,
  temporarySession,
  unsavedChanges,
  libraryOpen,
  sharing,
  theme,
  display,
  renderingSettings,
  refs,
  actions,
}: DocumentHeaderProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const importDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await actions.importFile(file)
  }
  return (
    <header className="app-header">
      <a
        className="app-title"
        href={import.meta.env.BASE_URL}
        aria-label="GAMUT home"
      >
        GAMUT
      </a>
      <AlgebraMenu
        badge={algebraBadge}
        choices={algebraChoices}
        selectedAlgebraId={selectedAlgebraId}
        onSelect={actions.selectAlgebra}
        onInfo={actions.showAlgebraInfo}
        infoButtonRef={refs.algebraInfoButtonRef}
      />
      <input
        ref={importInputRef}
        className="document-file-input"
        type="file"
        accept="application/json,.json,.gamut.json,.multivector.json"
        aria-label="Import document file"
        onChange={importDocument}
      />
      <div className="header-actions">
        {/* Three groups: the open graph, the document file, the display. */}
        <div className="header-group header-group-graph" role="group" aria-label="Graph">
          <GraphNameField
            name={graphName}
            temporaryLabel={temporarySession ? graphName : null}
            onRename={actions.renameGraph}
          />
          <LibraryCommands
            onSave={actions.saveToLibrary}
            unsavedChanges={unsavedChanges}
            onLibrary={actions.toggleLibrary}
            libraryOpen={libraryOpen}
            saveRef={refs.saveButtonRef}
            libraryRef={refs.libraryButtonRef}
          />
        </div>
        <div className="header-group" role="group" aria-label="Document file">
          <DocumentCommands
            onImport={() => importInputRef.current?.click()}
            onExport={actions.exportDocument}
            onCopyLink={actions.copyLink}
            sharing={sharing}
          />
        </div>
        <div className="header-group" role="group" aria-label="Display">
          <ThemeToggle theme={theme} onThemeChange={actions.changeTheme} />
          <SettingsMenu
            display={display}
            theme={theme}
            onDisplayChange={actions.changeDisplay}
            onThemeChange={actions.changeTheme}
            renderingSettings={renderingSettings}
          />
        </div>
      </div>
    </header>
  )
}

/** The text of a scene link that could not be copied, offered for manual selection. */
export type ShareResult = Readonly<{ content: string; label: string; message: string }>

export type DocumentNoticesProps = Readonly<{
  /** Set in a temporary scene-link session, which offers to save a local copy. */
  temporarySession: boolean
  onSaveLocalCopy(): void
  /** The transient notice after a link is copied, or `null`. */
  copyNotice: string | null
  shareResult: ShareResult | null
  onCloseShare(): void
  /** The diagnostic of the last failed document operation, or `null`. */
  documentDiagnostic: string | null
}>

/**
 * The notices under the header that report on the document commands: the
 * temporary-session banner, the copied-link notice, the scene link to copy
 * by hand, and the document diagnostic.
 */
export function DocumentNotices({
  temporarySession,
  onSaveLocalCopy,
  copyNotice,
  shareResult,
  onCloseShare,
  documentDiagnostic,
}: DocumentNoticesProps) {
  return (
    <>
      {temporarySession && (
        <div className="shared-session-notice">
          <span>Temporary session. Changes are not saved automatically.</span>
          <button type="button" className="document-command" onClick={onSaveLocalCopy}>Save local copy</button>
        </div>
      )}
      <p className="copy-notice" role="status" hidden={copyNotice === null}>{copyNotice}</p>
      {shareResult && (
        <section className="share-result" aria-label="Share scene">
          <p role="status">{shareResult.message}</p>
          <label>{shareResult.label}<textarea readOnly value={shareResult.content} onFocus={(event) => event.currentTarget.select()} /></label>
          <button type="button" onClick={onCloseShare}>Close sharing</button>
        </section>
      )}

      {documentDiagnostic && (
        <div className="document-diagnostic" role="alert">
          {documentDiagnostic}
        </div>
      )}
    </>
  )
}
