import { useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import {
  buildFolderTree,
  flattenFolderTree,
  folderKey,
  type FolderPath,
} from '../document/folderModel'
import { FolderRow } from './FolderRow'

/** The rename and remove actions of an editable folder, and further actions. */
export type LibraryFolderControls = Readonly<{
  renaming: boolean
  onRenamingChange(renaming: boolean): void
  onRename(name: string): string | null
  onDelete(): void
  actions?: ReactNode
}>

type LibraryTreeProps<T> = Readonly<{
  label: string
  entries: readonly T[]
  entryId(entry: T): string
  entryFolder(entry: T): FolderPath
  folders: readonly FolderPath[]
  isCollapsed(path: FolderPath): boolean
  onToggle(path: FolderPath): void
  renderEntry(entry: T): ReactNode
  entryClassName?(entry: T): string | undefined
  /** Absent for a read-only tree, such as Examples. */
  folderControls?(path: FolderPath): LibraryFolderControls
  /** Moves a dragged entry into a folder, or to the root; absent for a read-only tree. */
  onMoveEntry?(id: string, folder: FolderPath): void
  /** `entries` keeps the order given, folders included (Examples); folders first by name otherwise. */
  order?: 'entries' | 'folders-first'
}>

const indent = (depth: number): CSSProperties | undefined =>
  depth > 0 ? { '--folder-depth': depth } as CSSProperties : undefined

/**
 * A library section as a folder tree (STORE-016): by default folders by name,
 * then the entries in the order given, in one flat list so that a moved entry keeps its
 * element. The entries of a collapsed folder are hidden, not removed. Entries
 * of an editable tree can be dragged onto a folder, onto an entry to join its
 * folder, or onto the list to move to the root.
 */
export function LibraryTree<T>({
  label, entries, entryId, entryFolder, folders, isCollapsed, onToggle, renderEntry, entryClassName,
  folderControls, onMoveEntry, order = 'folders-first',
}: LibraryTreeProps<T>) {
  const [dragged, setDragged] = useState<string | null>(null)
  const [dropKey, setDropKey] = useState<string | null>(null)
  const tree = buildFolderTree(entries, entryFolder, folders, { kind: order })
  const rows = flattenFolderTree(tree, () => false)
  const hiddenDepths: number[] = []

  const dropProps = (folder: FolderPath) => onMoveEntry && dragged !== null ? {
    onDragOver: (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setDropKey(folderKey(folder))
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const id = dragged
      setDragged(null)
      setDropKey(null)
      if (id !== null) onMoveEntry(id, folder)
    },
  } : {}

  return (
    <ul className={`library-list library-tree${dragged !== null && dropKey === folderKey([]) ? ' is-drop-target' : ''}`}
      aria-label={label} {...dropProps([])}>
      {rows.map((row) => {
        while (hiddenDepths.length > 0 && hiddenDepths[hiddenDepths.length - 1] >= row.depth) hiddenDepths.pop()
        const hidden = hiddenDepths.length > 0
        if (row.kind === 'entry') {
          const id = entryId(row.entry)
          return (
            <li key={`entry:${id}`} hidden={hidden} className={entryClassName?.(row.entry)} style={indent(row.depth)}
              draggable={onMoveEntry ? true : undefined}
              onDragStart={onMoveEntry ? (event) => {
                event.dataTransfer?.setData('text/plain', id)
                setDragged(id)
              } : undefined}
              onDragEnd={onMoveEntry ? () => { setDragged(null); setDropKey(null) } : undefined}
              {...dropProps(row.folder)}>
              {renderEntry(row.entry)}
            </li>
          )
        }
        const collapsed = isCollapsed(row.path)
        if (collapsed) hiddenDepths.push(row.depth)
        const key = folderKey(row.path)
        const controls = folderControls?.(row.path)
        return (
          <li key={`folder:${key}`} hidden={hidden} className="library-folder" style={indent(row.depth)}
            {...dropProps(row.path)}>
            <FolderRow
              path={row.path}
              name={row.name}
              level={row.depth + 1}
              expanded={!collapsed}
              entryCount={row.entryCount}
              entryNoun={['graph', 'graphs']}
              renaming={controls?.renaming ?? false}
              onRenamingChange={controls?.onRenamingChange ?? (() => undefined)}
              onToggle={() => onToggle(row.path)}
              onRename={controls?.onRename}
              onDelete={controls?.onDelete}
              className={dragged !== null && dropKey === key ? 'drop-into' : undefined}
            >{controls?.actions}</FolderRow>
          </li>
        )
      })}
    </ul>
  )
}
