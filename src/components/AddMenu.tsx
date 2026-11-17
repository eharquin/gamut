import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'

type AddMenuProps = Readonly<{
  /** The + button, which focus returns to after an action. */
  addButtonRef: RefObject<HTMLButtonElement | null>
  /** The document holds as many items as it may. */
  full: boolean
  onAddExpression(): void
  onAddComment(): void
  onAddFolder(): void
}>

const PLUS = <path d="M9 3.5v11M3.5 9h11" strokeLinecap="round" />

/** Two quotation marks, the character that makes a row a note. */
function QuoteIcon({ size }: Readonly<{ size: number }>) {
  return (
    <svg className="add-menu-icon is-filled" width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path d="M3 4h4.5v4.2c0 2.6-1.3 4.4-3.8 5.3l-.6-1.2c1.3-.6 2-1.6 2.1-3.1H3z" />
      <path d="M10.5 4H15v4.2c0 2.6-1.3 4.4-3.8 5.3l-.6-1.2c1.3-.6 2-1.6 2.1-3.1h-2.2z" />
    </svg>
  )
}

function FolderIcon({ size }: Readonly<{ size: number }>) {
  return (
    <svg className="add-menu-icon" width={size + 1} height={size} viewBox="0 0 20 18" aria-hidden="true">
      <path d="M1.5 15.5v-13h5.5l1.6 2h9.9v11z" strokeLinejoin="round" />
      <path d="M10 7.2v6M7 10.2h6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The add control of the expression toolbar: + adds an expression, and the
 * arrow beside it opens a menu that also adds a comment or a folder, each
 * with the key that does the same in a row (Enter, `"`, `/`). The menu is a
 * WAI-ARIA menu button: arrows move through its items, Escape closes it and
 * gives focus back to the arrow.
 */
export function AddMenu({ addButtonRef, full, onAddExpression, onAddComment, onAddFolder }: AddMenuProps) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])

  const choose = (action: () => void) => {
    setOpen(false)
    action()
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items()
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    const move = (to: number) => {
      event.preventDefault()
      list[(to + list.length) % list.length]?.focus()
    }
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(list.length - 1)
    else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        toggleRef.current?.focus()
      }
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="add-menu">
      <div className="add-menu-split">
        <button
          ref={addButtonRef}
          type="button"
          className="add-menu-main"
          onClick={onAddExpression}
          disabled={full}
          aria-label="Add expression"
          title="Add expression"
        >
          <svg className="add-menu-icon" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">{PLUS}</svg>
        </button>
        <button
          ref={toggleRef}
          type="button"
          className="add-menu-toggle"
          aria-label="More to add"
          title="Add an expression, a comment, or a folder"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls="add-menu"
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div ref={menuRef} id="add-menu" className="add-menu-list" role="menu" aria-label="Add" onKeyDown={onMenuKeyDown}>
          <button type="button" role="menuitem" aria-label="Add expression" disabled={full} onClick={() => choose(onAddExpression)}>
            <svg className="add-menu-icon" width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">{PLUS}</svg>
            <span className="add-menu-label">Expression</span>
            <kbd aria-hidden="true">Enter</kbd>
          </button>
          <button type="button" role="menuitem" aria-label="Add comment" disabled={full} onClick={() => choose(onAddComment)}>
            <QuoteIcon size={15} />
            <span className="add-menu-label">Comment</span>
            <kbd aria-hidden="true">"</kbd>
          </button>
          <button type="button" role="menuitem" aria-label="New folder" onClick={() => choose(onAddFolder)}>
            <FolderIcon size={15} />
            <span className="add-menu-label">Folder</span>
            <kbd aria-hidden="true">/</kbd>
          </button>
        </div>
      )}
    </div>
  )
}
