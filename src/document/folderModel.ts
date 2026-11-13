/**
 * The folder model shared by expression folders (DOC-013) and library folders
 * (STORE-016): a folder is identified by its path, the list of folder names
 * from the root. A name is plain text, never empty, at most
 * `MAX_FOLDER_NAME_LENGTH` code points, and unique among the folders of one
 * parent; it may contain `/`. The empty path is the root, which is not a
 * folder. Limits are owned by limits-and-constants.md §2.1.
 */
export type FolderPath = readonly string[]

/** Nesting depth, a root-level folder being depth 1 (`LIMIT_FOLDER_DEPTH`). */
export const MAX_FOLDER_DEPTH = 8
/** Expression folders per document (`LIMIT_FOLDER_COUNT`). */
export const MAX_EXPRESSION_FOLDERS = 256
/** Folders in the local library (`LIMIT_FOLDER_COUNT`). */
export const MAX_LIBRARY_FOLDERS = 1_000
/** Unicode code points per folder name (`LIMIT_FOLDER_NAME_LENGTH`). */
export const MAX_FOLDER_NAME_LENGTH = 128

export const ROOT_FOLDER: FolderPath = []

/** Why a folder operation is refused, with the diagnostic code of the limit or rule it crosses. */
export type FolderProblem = Readonly<{ code: string; message: string }>

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

/** Why a value cannot be a folder name, or null when it can. */
export function folderNameProblem(name: unknown): FolderProblem | null {
  if (typeof name !== 'string' || name.length === 0 || hasLoneSurrogate(name))
    return { code: 'FOLDER_NAME_EMPTY', message: 'A folder name cannot be empty.' }
  if (Array.from(name).length > MAX_FOLDER_NAME_LENGTH)
    return { code: 'LIMIT_FOLDER_NAME_LENGTH', message: `A folder name may contain at most ${MAX_FOLDER_NAME_LENGTH} characters.` }
  return null
}

/**
 * Whether a value is a folder path: an array of folder names no deeper than
 * the depth limit. The empty array, the root, is a path.
 */
export function isFolderPath(value: unknown): value is FolderPath {
  return Array.isArray(value) &&
    value.length <= MAX_FOLDER_DEPTH &&
    value.every((name) => folderNameProblem(name) === null)
}

/** A string key that identifies a path, for maps and sets. */
export function folderKey(path: FolderPath): string {
  return JSON.stringify(path)
}

export function samePath(left: FolderPath, right: FolderPath): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index])
}

/** Whether `path` is `ancestor` or lies below it. */
export function isWithin(path: FolderPath, ancestor: FolderPath): boolean {
  return path.length >= ancestor.length && ancestor.every((name, index) => name === path[index])
}

export function parentPath(path: FolderPath): FolderPath {
  return path.slice(0, -1)
}

export function folderName(path: FolderPath): string {
  return path.at(-1) ?? ''
}

/** Replaces the leading `from` of a path within it by `to`. */
export function replacePrefix(path: FolderPath, from: FolderPath, to: FolderPath): FolderPath {
  return isWithin(path, from) ? [...to, ...path.slice(from.length)] : path
}

/** Every folder a path lies in, from the outermost, the path itself included. */
export function ancestorPaths(path: FolderPath): FolderPath[] {
  return path.map((_, index) => path.slice(0, index + 1))
}

/** The folders of a list, with every ancestor, each once, in first-seen order. */
export function withAncestors(paths: readonly FolderPath[]): FolderPath[] {
  const seen = new Set<string>()
  const result: FolderPath[] = []
  for (const path of paths) {
    for (const ancestor of ancestorPaths(path)) {
      const key = folderKey(ancestor)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(ancestor)
    }
  }
  return result
}

/** The names of the folders directly inside `parent`. */
export function childNames(folders: readonly FolderPath[], parent: FolderPath): string[] {
  return folders
    .filter((path) => path.length === parent.length + 1 && isWithin(path, parent))
    .map(folderName)
}

/**
 * Why a new folder `name` cannot be created, or a folder renamed to it,
 * inside `parent` among `folders`; null when it can. `ignore` is the folder
 * being renamed, which does not collide with itself.
 */
export function newFolderProblem(
  folders: readonly FolderPath[],
  parent: FolderPath,
  name: string,
  limits: Readonly<{ maxCount: number }>,
  ignore?: FolderPath,
): FolderProblem | null {
  const nameProblem = folderNameProblem(name)
  if (nameProblem) return nameProblem
  if (parent.length + 1 > MAX_FOLDER_DEPTH)
    return { code: 'LIMIT_FOLDER_DEPTH', message: `Folders may be nested at most ${MAX_FOLDER_DEPTH} levels deep.` }
  const siblings = folders.filter((path) => path.length === parent.length + 1 && isWithin(path, parent) &&
    !(ignore && samePath(path, ignore)))
  if (siblings.some((path) => folderName(path) === name))
    return { code: 'FOLDER_NAME_TAKEN', message: `A folder named “${name}” already exists here.` }
  if (!ignore && folders.length >= limits.maxCount)
    return { code: 'LIMIT_FOLDER_COUNT', message: `There may be at most ${limits.maxCount} folders.` }
  return null
}

/** `base`, or `base 2`, `base 3`… : the first name no folder inside `parent` has. */
export function uniqueFolderName(folders: readonly FolderPath[], parent: FolderPath, base = 'New folder'): string {
  const taken = new Set(childNames(folders, parent))
  if (!taken.has(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`
    if (!taken.has(candidate)) return candidate
  }
}

/** A folder or an entry of a folder tree, in display order. */
export type FolderTreeNode<T> =
  | Readonly<{
      kind: 'folder'
      path: FolderPath
      name: string
      children: readonly FolderTreeNode<T>[]
      /** Entries in this folder and its subfolders. */
      entryCount: number
    }>
  | Readonly<{ kind: 'entry'; entry: T; folder: FolderPath }>

type MutableFolder<T> = {
  kind: 'folder'
  path: FolderPath
  name: string
  children: MutableNode<T>[]
  entryCount: number
}
type MutableNode<T> = MutableFolder<T> | Readonly<{ kind: 'entry'; entry: T; folder: FolderPath }>

export type FolderTreeOrder<T> =
  /**
   * Expression order: each folder sits where its first entry is, and folders
   * that hold no entry follow the other children of their parent, in the
   * order of the folder list.
   */
  | Readonly<{ kind: 'entries' }>
  /** Library order: at each level, folders by name, then entries in the given order. */
  | Readonly<{ kind: 'folders-first'; compareNames?: (left: string, right: string) => number; compareEntries?: (left: T, right: T) => number }>

/**
 * Builds the tree of `entries` placed by `folderOf`, with the declared
 * `folders`, which may be empty. A folder named only by an entry exists too,
 * with its ancestors.
 */
export function buildFolderTree<T>(
  entries: readonly T[],
  folderOf: (entry: T) => FolderPath,
  folders: readonly FolderPath[],
  order: FolderTreeOrder<T> = { kind: 'entries' },
): FolderTreeNode<T>[] {
  const root: MutableFolder<T> = { kind: 'folder', path: ROOT_FOLDER, name: '', children: [], entryCount: 0 }
  const byKey = new Map<string, MutableFolder<T>>([[folderKey(ROOT_FOLDER), root]])
  const folderAt = (path: FolderPath): MutableFolder<T> => {
    const existing = byKey.get(folderKey(path))
    if (existing) return existing
    const parent = folderAt(parentPath(path))
    const folder: MutableFolder<T> = { kind: 'folder', path, name: folderName(path), children: [], entryCount: 0 }
    parent.children.push(folder)
    byKey.set(folderKey(path), folder)
    return folder
  }
  for (const entry of entries) {
    const path = folderOf(entry)
    folderAt(path).children.push({ kind: 'entry', entry, folder: path })
    for (let depth = 0; depth <= path.length; depth += 1)
      byKey.get(folderKey(path.slice(0, depth)))!.entryCount += 1
  }
  for (const path of folders) folderAt(path)

  if (order.kind === 'folders-first') {
    const compareNames = order.compareNames ?? ((left: string, right: string) => left.localeCompare(right))
    const sort = (folder: MutableFolder<T>) => {
      const subfolders = folder.children.filter((node): node is MutableFolder<T> => node.kind === 'folder')
      const items = folder.children.filter((node) => node.kind === 'entry')
      subfolders.sort((left, right) => compareNames(left.name, right.name))
      if (order.compareEntries) {
        const compare = order.compareEntries
        items.sort((left, right) => compare(left.entry, right.entry))
      }
      folder.children = [...subfolders, ...items]
      subfolders.forEach(sort)
    }
    sort(root)
  }
  return root.children
}

/** A visible row of a flattened folder tree. */
export type FolderTreeRow<T> =
  | Readonly<{ kind: 'folder'; path: FolderPath; name: string; depth: number; expanded: boolean; entryCount: number; childCount: number }>
  | Readonly<{ kind: 'entry'; entry: T; folder: FolderPath; depth: number }>

/**
 * The rows of a tree in display order, without the contents of collapsed
 * folders. The depth of a root-level row is 0.
 */
export function flattenFolderTree<T>(
  nodes: readonly FolderTreeNode<T>[],
  isCollapsed: (path: FolderPath) => boolean,
): FolderTreeRow<T>[] {
  const rows: FolderTreeRow<T>[] = []
  const visit = (node: FolderTreeNode<T>, depth: number) => {
    if (node.kind === 'entry') {
      rows.push({ kind: 'entry', entry: node.entry, folder: node.folder, depth })
      return
    }
    const expanded = !isCollapsed(node.path)
    rows.push({
      kind: 'folder', path: node.path, name: node.name, depth, expanded,
      entryCount: node.entryCount, childCount: node.children.length,
    })
    if (expanded) node.children.forEach((child) => visit(child, depth + 1))
  }
  nodes.forEach((node) => visit(node, 0))
  return rows
}

/** The folder node at `path` in a tree, if any. */
export function findFolderNode<T>(
  nodes: readonly FolderTreeNode<T>[],
  path: FolderPath,
): Extract<FolderTreeNode<T>, { kind: 'folder' }> | undefined {
  let children = nodes
  let found: Extract<FolderTreeNode<T>, { kind: 'folder' }> | undefined
  for (const name of path) {
    found = children.find((node): node is Extract<FolderTreeNode<T>, { kind: 'folder' }> =>
      node.kind === 'folder' && node.name === name)
    if (!found) return undefined
    children = found.children
  }
  return found
}

/** A human-readable path, for announcements: `Triangle › Angles`, or `top level`. */
export function describeFolder(path: FolderPath): string {
  return path.length === 0 ? 'top level' : path.join(' › ')
}
