import type { ExpressionDocument, ExpressionFolder, ExpressionItem } from './expressionDocument'
import {
  buildFolderTree,
  describeFolder,
  findFolderNode,
  flattenFolderTree,
  folderName,
  isWithin,
  MAX_EXPRESSION_FOLDERS,
  MAX_FOLDER_DEPTH,
  newFolderProblem,
  parentPath,
  replacePrefix,
  ROOT_FOLDER,
  samePath,
  type FolderPath,
  type FolderTreeNode,
  type FolderTreeRow,
} from './folderModel'

/**
 * Expression folders (DOC-013, document format §2.4): each item names the
 * folder that contains it, and the document lists every folder with its
 * collapsed state. Folders are structural only. The item order stays the
 * order of evaluation-independent rules and of the canvas draw order; the
 * commands below keep the items of each folder contiguous in that order, so
 * that the panel shows the rows in item order.
 */

export type ExpressionTreeNode = FolderTreeNode<ExpressionItem>
export type ExpressionRow = FolderTreeRow<ExpressionItem>

export function itemFolder(item: ExpressionItem): FolderPath {
  return item.folder ?? ROOT_FOLDER
}

export function documentFolders(document: ExpressionDocument): readonly ExpressionFolder[] {
  return document.folders ?? []
}

export function folderPaths(document: ExpressionDocument): FolderPath[] {
  return documentFolders(document).map(({ path }) => path)
}

export function hasFolder(document: ExpressionDocument, path: FolderPath): boolean {
  return path.length === 0 || documentFolders(document).some((folder) => samePath(folder.path, path))
}

export function isFolderCollapsed(document: ExpressionDocument, path: FolderPath): boolean {
  return documentFolders(document).some((folder) => folder.collapsed && samePath(folder.path, path))
}

/**
 * The panel tree: each folder sits at its first item, and a folder without
 * items follows the other rows of its parent.
 */
export function expressionFolderTree(document: ExpressionDocument): ExpressionTreeNode[] {
  return buildFolderTree(document.items, itemFolder, folderPaths(document))
}

/** The visible rows of the panel, without the contents of collapsed folders. */
export function expressionRows(document: ExpressionDocument): ExpressionRow[] {
  return flattenFolderTree(expressionFolderTree(document), (path) => isFolderCollapsed(document, path))
}

export type FolderEdit =
  | Readonly<{ status: 'applied'; document: ExpressionDocument }>
  | Readonly<{ status: 'invalid'; reason: string }>

function refused(reason: string): FolderEdit {
  return { status: 'invalid', reason }
}

/** Creates an empty, expanded folder at `path`, inside an existing parent. */
export function createFolder(document: ExpressionDocument, path: FolderPath): FolderEdit {
  if (path.length === 0) return refused('A folder needs a name.')
  const parent = parentPath(path)
  if (!hasFolder(document, parent)) return refused(`The folder “${describeFolder(parent)}” does not exist.`)
  const problem = newFolderProblem(folderPaths(document), parent, folderName(path), { maxCount: MAX_EXPRESSION_FOLDERS })
  if (problem) return refused(problem.message)
  return {
    status: 'applied',
    document: { ...document, folders: [...documentFolders(document), { path: [...path], collapsed: false }] },
  }
}

/** Gives a folder a new name; its items, subfolders, and collapsed state follow it. */
export function renameFolder(document: ExpressionDocument, path: FolderPath, name: string): FolderEdit {
  if (path.length === 0 || !hasFolder(document, path)) return refused('The folder does not exist.')
  if (folderName(path) === name) return refused('The folder already has this name.')
  const parent = parentPath(path)
  const problem = newFolderProblem(folderPaths(document), parent, name, { maxCount: MAX_EXPRESSION_FOLDERS }, path)
  if (problem) return refused(problem.message)
  const renamed = [...parent, name]
  return { status: 'applied', document: moveFolderContents(document, path, renamed) }
}

function moveFolderContents(document: ExpressionDocument, from: FolderPath, to: FolderPath): ExpressionDocument {
  return {
    ...document,
    folders: documentFolders(document).map((folder) =>
      isWithin(folder.path, from) ? { ...folder, path: replacePrefix(folder.path, from, to) } : folder),
    items: document.items.map((item) => {
      const folder = itemFolder(item)
      if (!isWithin(folder, from)) return item
      const moved = replacePrefix(folder, from, to)
      if (moved.length > 0) return { ...item, folder: moved }
      const { folder: _removed, ...rest } = item
      return rest
    }),
  }
}

/**
 * Removes a folder but keeps everything it holds: its items and subfolders
 * move to its parent, at the folder's position, in their order. Refused when
 * a subfolder has the name of a folder already in the parent.
 */
export function deleteFolder(document: ExpressionDocument, path: FolderPath): FolderEdit {
  if (path.length === 0 || !hasFolder(document, path)) return refused('The folder does not exist.')
  const parent = parentPath(path)
  const parentNames = new Set(folderPaths(document)
    .filter((candidate) => candidate.length === parent.length + 1 && isWithin(candidate, parent) && !samePath(candidate, path))
    .map(folderName))
  const clash = folderPaths(document)
    .find((candidate) => candidate.length === path.length + 1 && isWithin(candidate, path) && parentNames.has(folderName(candidate)))
  if (clash) {
    return refused(`The folder “${folderName(clash)}” inside it has the name of a folder in ${describeFolder(parent)}; rename one of them first.`)
  }
  const removed = { ...document, folders: documentFolders(document).filter((folder) => !samePath(folder.path, path)) }
  const lifted = moveFolderContents(removed, path, parent)
  return { status: 'applied', document: lifted }
}

/**
 * The collapsed state of one folder. It is document content but not a
 * history step: the history applies it to every snapshot that has the folder.
 * Returns the same document when nothing changes.
 */
export function setFolderCollapsed(document: ExpressionDocument, path: FolderPath, collapsed: boolean): ExpressionDocument {
  const folders = documentFolders(document)
  if (!folders.some((folder) => samePath(folder.path, path) && folder.collapsed !== collapsed)) return document
  return {
    ...document,
    folders: folders.map((folder) => samePath(folder.path, path) ? { ...folder, collapsed } : folder),
  }
}

/** Every folder that contains `path`, and the folder itself, expanded. */
export function foldersToReveal(document: ExpressionDocument, path: FolderPath): FolderPath[] {
  return path.map((_, index) => path.slice(0, index + 1))
    .filter((ancestor) => isFolderCollapsed(document, ancestor))
}

/** The move of one item to a position in the folder tree, as a document command. */
export type ItemMove = Readonly<{
  itemId: string
  folder: FolderPath
  anchorId?: string
  placement?: 'before' | 'after'
}>

/** Where an item goes, relative to the tree shown without it. */
export type ItemPlacement =
  | Readonly<{ kind: 'start' | 'end'; folder: FolderPath }>
  | Readonly<{ kind: 'before' | 'after'; itemId: string }>
  | Readonly<{ kind: 'before-folder' | 'after-folder'; path: FolderPath }>

type Anchor = Readonly<{ anchorId?: string; placement?: 'before' | 'after' }>

/**
 * Places an item in the item order: the item takes `folder` and moves next to
 * the anchor, or to the end without one. Unknown items, anchors, and folders
 * are refused.
 */
export function applyItemMove(document: ExpressionDocument, move: ItemMove): FolderEdit {
  const index = document.items.findIndex((item) => item.id === move.itemId)
  if (index < 0) return refused(`Item “${move.itemId}” does not exist.`)
  if (move.anchorId === move.itemId) return refused('An item cannot move relative to itself.')
  if (!hasFolder(document, move.folder)) return refused(`The folder “${describeFolder(move.folder)}” does not exist.`)
  const { folder: _previous, ...rest } = document.items[index]
  const item: ExpressionItem = move.folder.length > 0 ? { ...rest, folder: [...move.folder] } : rest
  const withoutItem = document.items.filter(({ id }) => id !== move.itemId)
  let target = withoutItem.length
  if (move.anchorId !== undefined) {
    const anchor = withoutItem.findIndex(({ id }) => id === move.anchorId)
    if (anchor < 0) return refused(`Item “${move.anchorId}” does not exist.`)
    target = anchor + (move.placement === 'before' ? 0 : 1)
  }
  return {
    status: 'applied',
    document: { ...document, items: [...withoutItem.slice(0, target), item, ...withoutItem.slice(target)] },
  }
}

type PlacementTarget = Readonly<{ folder: FolderPath; anchor: Anchor }>

/**
 * The folder and the anchor of `placement` for a block of items that moves
 * together: one item, or every item of a folder. `origin` is the folder the
 * block lies in, and `movedFolder` the folder that moves with it, if any. The
 * anchor keeps the items of every folder contiguous in the item order.
 */
function placementTarget(
  document: ExpressionDocument,
  movedIds: ReadonlySet<string>,
  origin: FolderPath,
  placement: ItemPlacement,
  movedFolder?: FolderPath,
): PlacementTarget | null {
  const others = document.items.filter((candidate) => !movedIds.has(candidate.id))
  const without: ExpressionDocument = {
    ...document,
    items: others,
    folders: documentFolders(document).filter((folder) => !(movedFolder && isWithin(folder.path, movedFolder))),
  }
  const subtree = (path: FolderPath) => others.filter((candidate) => isWithin(itemFolder(candidate), path))
  const endAnchor = (path: FolderPath): Anchor => {
    const inside = subtree(path)
    if (inside.length > 0) return { anchorId: inside[inside.length - 1].id, placement: 'after' }
    // An empty folder follows the other rows of its parent.
    return path.length === 0 ? {} : endAnchor(parentPath(path))
  }
  /**
   * Next to a folder that holds no other item. A folder the block empties has
   * no position of its own any more, so the block keeps its place in the item
   * order; a folder that was already empty is among the last rows of its parent.
   */
  const emptyFolderAnchor = (path: FolderPath): Anchor => {
    if (movedIds.size === 0 || !isWithin(origin, path)) return endAnchor(parentPath(path))
    const first = document.items.findIndex((candidate) => movedIds.has(candidate.id))
    const previous = document.items[first - 1]
    if (previous) return { anchorId: previous.id, placement: 'after' }
    const next = document.items.slice(first).find((candidate) => !movedIds.has(candidate.id))
    return next ? { anchorId: next.id, placement: 'before' } : {}
  }
  const beforeFolderAnchor = (path: FolderPath): Anchor => {
    const inside = subtree(path)
    return inside.length > 0 ? { anchorId: inside[0].id, placement: 'before' } : emptyFolderAnchor(path)
  }
  const startAnchor = (path: FolderPath): Anchor => {
    const tree = expressionFolderTree(without)
    const children = path.length === 0 ? tree : findFolderNode(tree, path)?.children ?? []
    const first = children[0]
    if (!first) return endAnchor(path)
    return first.kind === 'entry' ? { anchorId: first.entry.id, placement: 'before' } : beforeFolderAnchor(first.path)
  }

  if (placement.kind === 'start' || placement.kind === 'end') {
    if (!hasFolder(document, placement.folder)) return null
    return { folder: placement.folder, anchor: placement.kind === 'start' ? startAnchor(placement.folder) : endAnchor(placement.folder) }
  }
  if (placement.kind === 'before' || placement.kind === 'after') {
    const anchor = others.find((candidate) => candidate.id === placement.itemId)
    if (!anchor) return null
    return { folder: itemFolder(anchor), anchor: { anchorId: anchor.id, placement: placement.kind } }
  }
  const { path } = placement as Extract<ItemPlacement, { path: FolderPath }>
  if (path.length === 0 || !hasFolder(document, path)) return null
  const inside = subtree(path)
  const anchor = placement.kind === 'before-folder'
    ? beforeFolderAnchor(path)
    : inside.length > 0 ? { anchorId: inside[inside.length - 1].id, placement: 'after' as const } : emptyFolderAnchor(path)
  return { folder: parentPath(path), anchor }
}

/**
 * The move that puts an item at `placement`, or null when the item, its
 * target, or the resulting document would not change.
 */
export function planItemMove(document: ExpressionDocument, itemId: string, placement: ItemPlacement): ItemMove | null {
  const item = document.items.find((candidate) => candidate.id === itemId)
  if (!item) return null
  const target = placementTarget(document, new Set([itemId]), itemFolder(item), placement)
  if (!target) return null
  const move: ItemMove = { itemId, folder: target.folder, ...target.anchor }
  const result = applyItemMove(document, move)
  if (result.status !== 'applied') return null
  const before = document.items.indexOf(item)
  const after = result.document.items.findIndex((candidate) => candidate.id === itemId)
  return before === after && samePath(itemFolder(item), move.folder) ? null : move
}

/** The move of a folder, with everything it holds, into `parent` and next to the anchor. */
export type FolderMove = Readonly<{
  path: FolderPath
  parent: FolderPath
  anchorId?: string
  placement?: 'before' | 'after'
}>

/**
 * Moves a folder into `parent`: its items move together, in their order, next
 * to the anchor or to the end, and its subfolders and collapsed state follow
 * it. Refused when the folder would enter itself, when `parent` already has a
 * folder of that name, or when its subfolders would lie too deep.
 */
export function applyFolderMove(document: ExpressionDocument, move: FolderMove): FolderEdit {
  const { path, parent } = move
  if (path.length === 0 || !hasFolder(document, path)) return refused('The folder does not exist.')
  if (!hasFolder(document, parent)) return refused(`The folder “${describeFolder(parent)}” does not exist.`)
  if (isWithin(parent, path)) return refused('A folder cannot move into itself.')
  const name = folderName(path)
  const moved = [...parent, name]
  if (!samePath(parent, parentPath(path))) {
    if (hasFolder(document, moved))
      return refused(`A folder named “${name}” already exists in ${parent.length === 0 ? 'the top level' : `“${describeFolder(parent)}”`}.`)
    const deepest = Math.max(...folderPaths(document).filter((candidate) => isWithin(candidate, path)).map((candidate) => candidate.length))
    if (deepest - path.length + moved.length > MAX_FOLDER_DEPTH)
      return refused(`Folders may be nested at most ${MAX_FOLDER_DEPTH} levels deep.`)
  }
  const block = document.items.filter((item) => isWithin(itemFolder(item), path))
  const others = document.items.filter((item) => !isWithin(itemFolder(item), path))
  let target = others.length
  if (move.anchorId !== undefined) {
    const anchor = others.findIndex(({ id }) => id === move.anchorId)
    if (anchor < 0) return refused(`Item “${move.anchorId}” does not exist outside the folder.`)
    target = anchor + (move.placement === 'before' ? 0 : 1)
  }
  const reordered = { ...document, items: [...others.slice(0, target), ...block, ...others.slice(target)] }
  return { status: 'applied', document: samePath(moved, path) ? reordered : moveFolderContents(reordered, path, moved) }
}

/**
 * The move that puts a folder at `placement`, or null when the folder or the
 * target does not exist, or nothing would change. A move that the document
 * refuses is still returned, so that its reason can be reported.
 */
export function planFolderMove(document: ExpressionDocument, path: FolderPath, placement: ItemPlacement): FolderMove | null {
  if (path.length === 0 || !hasFolder(document, path)) return null
  const movedIds = new Set(document.items.filter((item) => isWithin(itemFolder(item), path)).map(({ id }) => id))
  const target = placementTarget(document, movedIds, parentPath(path), placement, path)
  if (!target) return null
  const move: FolderMove = { path, parent: target.folder, ...target.anchor }
  const result = applyFolderMove(document, move)
  if (result.status !== 'applied') return move
  const unchanged = samePath(target.folder, parentPath(path)) &&
    result.document.items.every((item, index) => item.id === document.items[index].id)
  return unchanged ? null : move
}

export type MoveStep = 'up' | 'down' | 'first' | 'last'

function rowParent(row: ExpressionRow): FolderPath {
  return row.kind === 'folder' ? parentPath(row.path) : row.folder
}

/**
 * The keyboard move of one row through the visible rows (A11Y-011). Up and
 * down swap with a neighbour in the same folder, enter the expanded folder
 * next to the row, skip over a collapsed one, and leave the folder from its
 * first or last row; first and last go to the start or end of the row's
 * folder. Null when the row cannot move further.
 */
export function stepPlacement(document: ExpressionDocument, itemId: string, step: MoveStep): ItemPlacement | null {
  const rows = expressionRows(document)
  const index = rows.findIndex((row) => row.kind === 'entry' && row.entry.id === itemId)
  if (index < 0) return null
  const own = (rows[index] as Extract<ExpressionRow, { kind: 'entry' }>).folder
  if (step === 'first') return { kind: 'start', folder: own }
  if (step === 'last') return { kind: 'end', folder: own }
  const leave: ItemPlacement | null = own.length === 0 ? null : { kind: 'after-folder', path: own }
  if (step === 'up') {
    const previous = rows[index - 1]
    if (!previous) return null
    if (previous.kind === 'entry') {
      return samePath(previous.folder, own)
        ? { kind: 'before', itemId: previous.entry.id }
        : { kind: 'after', itemId: previous.entry.id }
    }
    if (samePath(previous.path, own)) return { kind: 'before-folder', path: own }
    return previous.expanded ? { kind: 'end', folder: previous.path } : { kind: 'before-folder', path: previous.path }
  }
  const next = rows[index + 1]
  if (!next || !samePath(rowParent(next), own)) return leave
  if (next.kind === 'entry') return { kind: 'after', itemId: next.entry.id }
  if (next.expanded) return { kind: 'start', folder: next.path }
  // A collapsed folder is skipped; one without items is among the last rows
  // of its parent, so the row is already last there.
  return next.entryCount > 0 ? { kind: 'after-folder', path: next.path } : leave
}

/**
 * The keyboard move of a folder among the rows of its parent (A11Y-011): up
 * and down pass the row or the folder next to it, and first and last go to
 * the start or the end. A folder never enters another one this way. Null
 * when it cannot move further.
 */
export function folderStepPlacement(document: ExpressionDocument, path: FolderPath, step: MoveStep): ItemPlacement | null {
  if (path.length === 0 || !hasFolder(document, path)) return null
  const parent = parentPath(path)
  if (step === 'first') return { kind: 'start', folder: parent }
  if (step === 'last') return { kind: 'end', folder: parent }
  const tree = expressionFolderTree(document)
  const children = parent.length === 0 ? tree : findFolderNode(tree, parent)?.children ?? []
  const index = children.findIndex((node) => node.kind === 'folder' && samePath(node.path, path))
  const beside = index < 0 ? undefined : children[index + (step === 'up' ? -1 : 1)]
  if (!beside) return null
  if (beside.kind === 'entry') return { kind: step === 'up' ? 'before' : 'after', itemId: beside.entry.id }
  // A folder without rows holds one of the last places of its parent and cannot be passed.
  if (beside.entryCount === 0) return null
  return { kind: step === 'up' ? 'before-folder' : 'after-folder', path: beside.path }
}

/** The position of a folder among the rows of its parent, for announcements. */
export function folderPosition(
  document: ExpressionDocument,
  path: FolderPath,
): Readonly<{ parent: FolderPath; position: number; count: number }> | null {
  const parent = parentPath(path)
  const tree = expressionFolderTree(document)
  const children = parent.length === 0 ? tree : findFolderNode(tree, parent)?.children ?? []
  const position = children.findIndex((node) => node.kind === 'folder' && samePath(node.path, path))
  return position < 0 ? null : { parent, position: position + 1, count: children.length }
}

/** The position of an item among the rows of its folder, for announcements. */
export function itemPosition(
  document: ExpressionDocument,
  itemId: string,
): Readonly<{ folder: FolderPath; position: number; count: number }> | null {
  const item = document.items.find((candidate) => candidate.id === itemId)
  if (!item) return null
  const folder = itemFolder(item)
  const tree = expressionFolderTree(document)
  const children = folder.length === 0 ? tree : findFolderNode(tree, folder)?.children ?? []
  const position = children.findIndex((node) => node.kind === 'entry' && node.entry.id === itemId)
  return position < 0 ? null : { folder, position: position + 1, count: children.length }
}
