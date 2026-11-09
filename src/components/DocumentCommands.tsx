/** Document commands offered in the header; the caller owns their effects. */
export type DocumentCommandHandlers = Readonly<{
  onImport(): void
  onExport(): void
  onCopyLink(): void
  /** True while a scene link is being created. */
  sharing: boolean
}>

/**
 * Import, Export, and Copy link as icon buttons, drawn like the theme button
 * and the settings cogwheel beside them (#249). Each keeps the behavior it had
 * in the settings menu: the file chooser, the `.gamut.json` download, and the
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
