import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type { ExpressionDocument } from '../document/expressionDocument'
import {
  applyItemMove,
  expressionRows,
  folderPaths,
  foldersToReveal,
  isFolderCollapsed,
  itemPosition,
  planItemMove,
  stepPlacement,
  type ItemPlacement,
  type MoveStep,
} from '../document/expressionFolders'
import {
  describeFolder,
  folderKey,
  folderName,
  uniqueFolderName,
  type FolderPath,
} from '../document/folderModel'
import { declaredName } from '../language/declaredName'

/** Where a dragged row would land, shown by the panel while dragging. */
export type DropTarget =
  | Readonly<{ kind: 'before' | 'after'; itemId: string }>
  | Readonly<{ kind: 'before-folder'; path: FolderPath }>
  | Readonly<{ kind: 'into-folder'; path: FolderPath }>
  | Readonly<{ kind: 'end' }>

export type ExpressionFolders = Readonly<{
  /** The folder whose name field opens for renaming once it renders, by key. */
  renamingKey: string | null
  setRenamingKey(key: string | null): void
  dropTarget: DropTarget | null
  folderRowRefs: RefObject<Map<string, HTMLElement>>
  createFolder(): void
  /** Renames a folder; returns why it is refused, or null. */
  renameFolder(path: FolderPath, name: string): string | null
  deleteFolder(path: FolderPath): void
  toggleFolder(path: FolderPath): void
  /** Moves a row one step through the visible rows; false when it cannot move. */
  moveStep(itemId: string, step: MoveStep): boolean
  beginRowReorder(event: ReactPointerEvent<HTMLButtonElement>, itemId: string): void
  reorderRowWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, itemId: string): void
}>

type Options = Readonly<{
  document: ExpressionDocument
  executeCommand(command: DocumentCommand): void
  dispatchHistory(action: HistoryAction): void
  /** Each row's article, by item identity. */
  rowElements: RefObject<Map<string, HTMLElement>>
  announce(message: string): void
}>

function rowName(document: ExpressionDocument, itemId: string): string {
  const item = document.items.find((candidate) => candidate.id === itemId)
  return (item && declaredName(item.source)) ?? 'Expression'
}

/**
 * The interaction state of expression folders (DOC-013, A11Y-011): creating,
 * renaming, removing, collapsing, and moving rows into and out of folders by
 * pointer and keyboard, with one announcement per move. Every change goes
 * through a document command; collapsing is not a history step.
 */
export function useExpressionFolders({ document, executeCommand, dispatchHistory, rowElements, announce }: Options): ExpressionFolders {
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const folderRowRefs = useRef(new Map<string, HTMLElement>())
  const drag = useRef<Readonly<{ itemId: string; pointerId: number; target: DropTarget | null }> | null>(null)

  /** Applies a planned move, reveals its folder, and announces where the row went. */
  const moveTo = useCallback((itemId: string, placement: ItemPlacement): boolean => {
    const move = planItemMove(document, itemId, placement)
    if (!move) return false
    const result = applyItemMove(document, move)
    if (result.status !== 'applied') return false
    executeCommand({ kind: 'move-item', ...move })
    for (const path of foldersToReveal(document, move.folder))
      dispatchHistory({ type: 'set-folder-collapsed', path, collapsed: false })
    const position = itemPosition(result.document, itemId)
    if (position) {
      announce(`Moved ${rowName(document, itemId)} to position ${position.position} of ${position.count}${
        position.folder.length === 0 ? '' : ` in folder ${describeFolder(position.folder)}`}.`)
    }
    return true
  }, [document, executeCommand, dispatchHistory, announce])

  const moveStep = useCallback((itemId: string, step: MoveStep): boolean => {
    const placement = stepPlacement(document, itemId, step)
    if (placement && moveTo(itemId, placement)) return true
    announce(`${rowName(document, itemId)} cannot move ${step === 'up' || step === 'first' ? 'up' : 'down'}.`)
    return false
  }, [document, moveTo, announce])

  const createFolder = useCallback(() => {
    const path = [uniqueFolderName(folderPaths(document), [])]
    executeCommand({ kind: 'create-folder', path })
    setRenamingKey(folderKey(path))
    announce(`Folder ${path[0]} created at the end of the top level.`)
  }, [document, executeCommand, announce])

  const renameFolder = useCallback((path: FolderPath, rawName: string): string | null => {
    const name = rawName.trim()
    if (name === folderName(path)) return null
    if (name === '') return 'A folder name cannot be empty.'
    const renamed = [...path.slice(0, -1), name]
    if (folderPaths(document).some((candidate) => folderKey(candidate) === folderKey(renamed)))
      return `A folder named “${name}” already exists here.`
    executeCommand({ kind: 'rename-folder', path, name })
    announce(`Folder renamed to ${name}.`)
    return null
  }, [document, executeCommand, announce])

  const deleteFolder = useCallback((path: FolderPath) => {
    const children = folderPaths(document)
      .filter((candidate) => candidate.length === path.length + 1 && folderKey(candidate.slice(0, -1)) === folderKey(path))
    const siblings = new Set(folderPaths(document)
      .filter((candidate) => candidate.length === path.length && folderKey(candidate.slice(0, -1)) === folderKey(path.slice(0, -1)))
      .map(folderName))
    const clash = children.find((child) => siblings.has(folderName(child)))
    if (clash) {
      announce(`Folder ${folderName(path)} cannot be removed: the folder ${folderName(clash)} inside it has the name of a folder next to it.`)
      return
    }
    executeCommand({ kind: 'delete-folder', path })
    announce(`Folder ${folderName(path)} removed; its rows stay in ${describeFolder(path.slice(0, -1))}.`)
  }, [document, executeCommand, announce])

  const toggleFolder = useCallback((path: FolderPath) => {
    const collapsed = !isFolderCollapsed(document, path)
    dispatchHistory({ type: 'set-folder-collapsed', path, collapsed })
  }, [document, dispatchHistory])

  /** The drop target under a pointer, from the visible rows of the panel. */
  const resolveDropTarget = useCallback((clientY: number, draggedId: string): DropTarget | null => {
    for (const row of expressionRows(document)) {
      const element = row.kind === 'entry'
        ? rowElements.current.get(row.entry.id)
        : folderRowRefs.current.get(folderKey(row.path))
      if (!element) continue
      const rect = element.getBoundingClientRect()
      if (clientY > rect.bottom) continue
      const upper = clientY < rect.top + rect.height / 2
      if (row.kind === 'folder') return upper ? { kind: 'before-folder', path: row.path } : { kind: 'into-folder', path: row.path }
      if (row.entry.id === draggedId) return null
      return { kind: upper ? 'before' : 'after', itemId: row.entry.id }
    }
    return { kind: 'end' }
  }, [document, rowElements])

  const placementOf = (target: DropTarget): ItemPlacement => {
    if (target.kind === 'end') return { kind: 'end', folder: [] }
    if (target.kind === 'into-folder') {
      return { kind: isFolderCollapsed(document, target.path) ? 'end' : 'start', folder: target.path }
    }
    return target
  }
  const placementRef = useRef(placementOf)
  placementRef.current = placementOf

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const current = drag.current
      if (!current) return
      const target = resolveDropTarget(event.clientY, current.itemId)
      drag.current = { ...current, target }
      setDropTarget(target)
    }
    const endDrag = (commit: boolean) => {
      const current = drag.current
      drag.current = null
      window.document.body.classList.remove('reordering-items')
      setDropTarget(null)
      if (!current) return
      if (commit && current.target) moveTo(current.itemId, placementRef.current(current.target))
      dispatchHistory({ type: commit ? 'commit-transaction' : 'cancel-transaction' })
    }
    const handlePointerUp = () => endDrag(true)
    const handlePointerCancel = () => endDrag(false)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.document.body.classList.remove('reordering-items')
    }
  }, [resolveDropTarget, moveTo, dispatchHistory])

  const beginRowReorder = useCallback((event: ReactPointerEvent<HTMLButtonElement>, itemId: string) => {
    drag.current = { itemId, pointerId: event.pointerId, target: null }
    dispatchHistory({ type: 'begin-transaction' })
    window.document.body.classList.add('reordering-items')
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [dispatchHistory])

  const reorderRowWithKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>, itemId: string) => {
    if (!event.shiftKey && !event.altKey) return
    const step: MoveStep | null = event.key === 'ArrowUp' ? 'up'
      : event.key === 'ArrowDown' ? 'down'
        : event.key === 'Home' ? 'first'
          : event.key === 'End' ? 'last' : null
    if (!step) return
    event.preventDefault()
    moveStep(itemId, step)
  }, [moveStep])

  return {
    renamingKey, setRenamingKey, dropTarget, folderRowRefs,
    createFolder, renameFolder, deleteFolder, toggleFolder, moveStep,
    beginRowReorder, reorderRowWithKeyboard,
  }
}
