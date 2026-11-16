import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { executeDocumentCommand, type DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type { ExpressionDocument } from '../document/expressionDocument'
import {
  applyFolderMove,
  applyItemMove,
  createFolder as createFolderEdit,
  expressionRows,
  folderPaths,
  folderPosition,
  folderStepPlacement,
  foldersToReveal,
  isFolderCollapsed,
  itemFolder,
  itemPosition,
  planFolderMove,
  planItemMove,
  renameFolder as renameFolderEdit,
  stepPlacement,
  type ItemPlacement,
  type MoveStep,
} from '../document/expressionFolders'
import {
  describeFolder,
  folderKey,
  folderName,
  isWithin,
  MAX_FOLDER_NAME_LENGTH,
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
  /**
   * Makes a folder of a row, where the row is: the folder takes `name` (or a
   * free default name) and holds the row, emptied. Folders are created at
   * the top level, so a row inside a folder leaves it first.
   */
  convertRowToFolder(itemId: string, name: string): void
  /** Renames a folder; returns why it is refused, or null. */
  renameFolder(path: FolderPath, name: string): string | null
  deleteFolder(path: FolderPath): void
  toggleFolder(path: FolderPath): void
  beginFolderReorder(event: ReactPointerEvent<HTMLButtonElement>, path: FolderPath): void
  reorderFolderWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, path: FolderPath): void
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

/** What a drag moves: one row, or a folder with everything it holds. */
type Dragged = Readonly<{ kind: 'item'; itemId: string }> | Readonly<{ kind: 'folder'; path: FolderPath }>

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
  const drag = useRef<Readonly<{ dragged: Dragged; pointerId: number; target: DropTarget | null }> | null>(null)

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

  /** Moves a folder with its rows, reveals its new parent, keeps focus on its handle, and announces where it went. */
  const moveFolderTo = useCallback((path: FolderPath, placement: ItemPlacement): boolean => {
    const move = planFolderMove(document, path, placement)
    if (!move) return false
    const result = applyFolderMove(document, move)
    if (result.status !== 'applied') {
      announce(`Folder ${folderName(path)} cannot move there. ${result.reason}`)
      return true
    }
    executeCommand({ kind: 'move-folder', ...move })
    for (const ancestor of foldersToReveal(document, move.parent))
      dispatchHistory({ type: 'set-folder-collapsed', path: ancestor, collapsed: false })
    const moved = [...move.parent, folderName(path)]
    const position = folderPosition(result.document, moved)
    if (position) {
      announce(`Moved folder ${folderName(path)} to position ${position.position} of ${position.count}${
        position.parent.length === 0 ? '' : ` in folder ${describeFolder(position.parent)}`}.`)
    }
    // A folder that changes parent gets a new row; its handle takes focus back.
    requestAnimationFrame(() => {
      const handle = folderRowRefs.current.get(folderKey(moved))?.querySelector<HTMLElement>('.folder-handle')
      if (handle && window.document.activeElement !== handle) handle.focus()
    })
    return true
  }, [document, executeCommand, dispatchHistory, announce])

  const folderMoveStep = useCallback((path: FolderPath, step: MoveStep): boolean => {
    const placement = folderStepPlacement(document, path, step)
    if (placement && moveFolderTo(path, placement)) return true
    announce(`Folder ${folderName(path)} cannot move ${step === 'up' || step === 'first' ? 'up' : 'down'}.`)
    return false
  }, [document, moveFolderTo, announce])

  const createFolder = useCallback(() => {
    const path = [uniqueFolderName(folderPaths(document), [])]
    const edit = createFolderEdit(document, path)
    if (edit.status !== 'applied') {
      announce(`The folder could not be created. ${edit.reason}`)
      return
    }
    executeCommand({ kind: 'create-folder', path })
    setRenamingKey(folderKey(path))
    announce(`Folder ${path[0]} created at the end of the top level.`)
  }, [document, executeCommand, announce])

  const convertRowToFolder = useCallback((itemId: string, rawName: string) => {
    const item = document.items.find((candidate) => candidate.id === itemId)
    if (!item) return
    const typed = Array.from(rawName.trim()).slice(0, MAX_FOLDER_NAME_LENGTH).join('')
    const path = [uniqueFolderName(folderPaths(document), [], typed === '' ? undefined : typed)]
    // The commands are tried on a copy first, so that either all of them run or none.
    let current = document
    const commands: DocumentCommand[] = []
    const run = (command: DocumentCommand): string | null => {
      const result = executeDocumentCommand(current, command)
      if (result.status !== 'applied') return result.reason
      current = result.document
      commands.push(command)
      return null
    }
    const steps: (() => string | null)[] = [
      () => {
        // A row inside a folder first leaves it, to just after that folder.
        const origin = itemFolder(item)
        const leave = origin.length === 0 ? null : planItemMove(current, itemId, { kind: 'after-folder', path: origin.slice(0, 1) })
        return leave ? run({ kind: 'move-item', ...leave }) : null
      },
      () => run({ kind: 'create-folder', path }),
      () => {
        // The row keeps its place in the item order, which is where its folder shows.
        const index = current.items.findIndex((candidate) => candidate.id === itemId)
        const previous = current.items[index - 1]
        const next = current.items[index + 1]
        return run({
          kind: 'move-item', itemId, folder: path,
          ...(previous ? { anchorId: previous.id, placement: 'after' as const } : next ? { anchorId: next.id, placement: 'before' as const } : {}),
        })
      },
      // What was typed became the name: the row starts empty.
      () => item.source === '' ? null : run({ kind: 'update-source', itemId, source: '' }),
      () => item.positionSource ? run({ kind: 'update-position', itemId, positionSource: '' }) : null,
      () => item.normalization ? run({ kind: 'update-normalization', itemId }) : null,
      () => item.control ? run({ kind: 'update-control', itemId }) : null,
    ]
    for (const step of steps) {
      const problem = step()
      if (problem) {
        announce(`The folder could not be created. ${problem}`)
        return
      }
    }
    dispatchHistory({ type: 'begin-transaction' })
    commands.forEach((command) => executeCommand(command))
    dispatchHistory({ type: 'commit-transaction' })
    setRenamingKey(folderKey(path))
    announce(`Folder ${path[0]} created with this row.`)
  }, [document, executeCommand, dispatchHistory, announce])

  const renameFolder = useCallback((path: FolderPath, rawName: string): string | null => {
    const name = rawName.trim()
    if (name === folderName(path)) return null
    if (name === '') return 'A folder name cannot be empty.'
    const edit = renameFolderEdit(document, path, name)
    if (edit.status !== 'applied') return edit.reason
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
  const resolveDropTarget = useCallback((clientY: number, dragged: Dragged): DropTarget | null => {
    for (const row of expressionRows(document)) {
      const element = row.kind === 'entry'
        ? rowElements.current.get(row.entry.id)
        : folderRowRefs.current.get(folderKey(row.path))
      if (!element) continue
      const rect = element.getBoundingClientRect()
      if (clientY > rect.bottom) continue
      const upper = clientY < rect.top + rect.height / 2
      if (dragged.kind === 'folder') {
        // A folder is not dropped on itself or on anything it holds, and it
        // stays at the top level: next to a top-level row, or before another folder.
        if (isWithin(row.kind === 'folder' ? row.path : row.folder, dragged.path)) return null
        if (row.kind === 'entry') return row.folder.length === 0 ? { kind: upper ? 'before' : 'after', itemId: row.entry.id } : null
        return row.path.length === 1 ? { kind: 'before-folder', path: row.path } : null
      }
      if (row.kind === 'folder') return upper ? { kind: 'before-folder', path: row.path } : { kind: 'into-folder', path: row.path }
      if (dragged.kind === 'item' && row.entry.id === dragged.itemId) return null
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
      const target = resolveDropTarget(event.clientY, current.dragged)
      drag.current = { ...current, target }
      setDropTarget(target)
    }
    const endDrag = (commit: boolean) => {
      const current = drag.current
      drag.current = null
      window.document.body.classList.remove('reordering-items')
      setDropTarget(null)
      if (!current) return
      if (commit && current.target) {
        const placement = placementRef.current(current.target)
        if (current.dragged.kind === 'item') moveTo(current.dragged.itemId, placement)
        else moveFolderTo(current.dragged.path, placement)
      }
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
  }, [resolveDropTarget, moveTo, moveFolderTo, dispatchHistory])

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, dragged: Dragged) => {
    drag.current = { dragged, pointerId: event.pointerId, target: null }
    dispatchHistory({ type: 'begin-transaction' })
    window.document.body.classList.add('reordering-items')
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }, [dispatchHistory])
  const beginRowReorder = useCallback((event: ReactPointerEvent<HTMLButtonElement>, itemId: string) =>
    beginDrag(event, { kind: 'item', itemId }), [beginDrag])
  const beginFolderReorder = useCallback((event: ReactPointerEvent<HTMLButtonElement>, path: FolderPath) =>
    beginDrag(event, { kind: 'folder', path }), [beginDrag])

  const keyboardStep = (event: KeyboardEvent<HTMLButtonElement>): MoveStep | null => {
    if (!event.shiftKey && !event.altKey) return null
    return event.key === 'ArrowUp' ? 'up'
      : event.key === 'ArrowDown' ? 'down'
        : event.key === 'Home' ? 'first'
          : event.key === 'End' ? 'last' : null
  }
  const reorderRowWithKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>, itemId: string) => {
    const step = keyboardStep(event)
    if (!step) return
    event.preventDefault()
    moveStep(itemId, step)
  }, [moveStep])
  const reorderFolderWithKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>, path: FolderPath) => {
    const step = keyboardStep(event)
    if (!step) return
    event.preventDefault()
    folderMoveStep(path, step)
  }, [folderMoveStep])

  return {
    renamingKey, setRenamingKey, dropTarget, folderRowRefs,
    createFolder, convertRowToFolder, renameFolder, deleteFolder, toggleFolder, moveStep,
    beginRowReorder, reorderRowWithKeyboard, beginFolderReorder, reorderFolderWithKeyboard,
  }
}
