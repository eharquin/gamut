import type { CSSProperties, ReactNode } from 'react'
import type { ExpressionDocument, ExpressionItem } from '../document/expressionDocument'
import { expressionFolderTree, isFolderCollapsed } from '../document/expressionFolders'
import { flattenFolderTree, folderKey } from '../document/folderModel'
import type { ExpressionFolders } from '../hooks/useExpressionFolders'
import { FolderRow } from './FolderRow'

type ExpressionTreeProps = Readonly<{
  document: ExpressionDocument
  folders: ExpressionFolders
  /** One expression row. */
  renderItem(itemId: string): ReactNode
}>

type TreeRow =
  | Readonly<{ kind: 'row'; row: ReturnType<typeof flattenFolderTree<ExpressionItem>>[number]; hidden: boolean }>
  /** The thin bar that closes an expanded folder with rows. */
  | Readonly<{ kind: 'end'; key: string; depth: number; hidden: boolean }>

/** Every row with the collapsed folder state that hides it, in folder order, and the end of each open folder. */
function treeRows(document: ExpressionDocument): TreeRow[] {
  const rows = flattenFolderTree(expressionFolderTree(document), () => false)
  const result: TreeRow[] = []
  const collapsedDepths: number[] = []
  const open: { key: string; depth: number; hidden: boolean }[] = []
  const closeTo = (depth: number) => {
    while (open.length > 0 && open[open.length - 1].depth >= depth) result.push({ kind: 'end', ...open.pop()! })
  }
  for (const row of rows) {
    closeTo(row.depth)
    while (collapsedDepths.length > 0 && collapsedDepths[collapsedDepths.length - 1] >= row.depth) collapsedDepths.pop()
    const hidden = collapsedDepths.length > 0
    result.push({ kind: 'row', row, hidden })
    if (row.kind !== 'folder') continue
    if (isFolderCollapsed(document, row.path)) collapsedDepths.push(row.depth)
    else if (row.childCount > 0) open.push({ key: folderKey(row.path), depth: row.depth, hidden })
  }
  closeTo(0)
  return result
}

const indent = (depth: number): CSSProperties | undefined =>
  depth > 0 ? { '--folder-depth': depth } as CSSProperties : undefined

/**
 * The rows of the expression panel in folder order (DOC-013). The list stays
 * flat, so that a row moved between folders keeps its element and its focus;
 * the rows of a collapsed folder are hidden, not removed.
 */
export function ExpressionTree({ document, folders, renderItem }: ExpressionTreeProps) {
  const target = folders.dropTarget
  return treeRows(document).map((entry) => {
    if (entry.kind === 'end') {
      return <div key={`end:${entry.key}`} className="folder-end" hidden={entry.hidden} style={indent(entry.depth)} aria-hidden="true" />
    }
    const { row, hidden } = entry
    if (row.kind === 'entry') {
      return (
        <div key={row.entry.id} className="folder-member" hidden={hidden} style={indent(row.depth)}>
          {renderItem(row.entry.id)}
        </div>
      )
    }
    const key = folderKey(row.path)
    const dropClass = target?.kind === 'before-folder' && folderKey(target.path) === key ? 'drop-before'
      : target?.kind === 'into-folder' && folderKey(target.path) === key ? 'drop-into' : undefined
    return (
      <div key={`folder:${key}`} className="folder-member" hidden={hidden} style={indent(row.depth)}>
        <FolderRow
          path={row.path}
          name={row.name}
          level={row.depth + 1}
          expanded={!isFolderCollapsed(document, row.path)}
          entryCount={row.entryCount}
          entryNoun={['row', 'rows']}
          renaming={folders.renamingKey === key}
          onRenamingChange={(renaming) => folders.setRenamingKey(renaming ? key : null)}
          onToggle={() => folders.toggleFolder(row.path)}
          onRename={(name) => folders.renameFolder(row.path, name)}
          onDelete={() => folders.deleteFolder(row.path)}
          onDeleteContents={() => folders.deleteFolderContents(row.path)}
          handle={{
            onPointerDown: (event) => folders.beginFolderReorder(event, row.path),
            onKeyDown: (event) => folders.reorderFolderWithKeyboard(event, row.path),
          }}
          className={dropClass}
          rowRef={(element) => {
            if (element) folders.folderRowRefs.current.set(key, element)
            else folders.folderRowRefs.current.delete(key)
          }}
        />
      </div>
    )
  })
}
