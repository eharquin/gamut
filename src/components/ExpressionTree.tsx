import type { CSSProperties, ReactNode } from 'react'
import type { ExpressionDocument } from '../document/expressionDocument'
import { expressionFolderTree, isFolderCollapsed, itemFolder } from '../document/expressionFolders'
import { flattenFolderTree, folderKey, isWithin, type FolderPath } from '../document/folderModel'
import type { ExpressionFolders } from '../hooks/useExpressionFolders'
import { FolderRow } from './FolderRow'

type ExpressionTreeProps = Readonly<{
  document: ExpressionDocument
  folders: ExpressionFolders
  /** One expression row. */
  renderItem(itemId: string): ReactNode
  /** The actions of a folder before its remove button, such as its eye and its appearance. */
  folderActions?(path: FolderPath, plainName: string): ReactNode
}>

/** Every row with the collapsed folder state that hides it, in folder order. */
function treeRows(document: ExpressionDocument) {
  const rows = flattenFolderTree(expressionFolderTree(document), () => false)
  const collapsedDepths: number[] = []
  return rows.map((row) => {
    while (collapsedDepths.length > 0 && collapsedDepths[collapsedDepths.length - 1] >= row.depth) collapsedDepths.pop()
    const hidden = collapsedDepths.length > 0
    if (row.kind === 'folder' && isFolderCollapsed(document, row.path)) collapsedDepths.push(row.depth)
    return { row, hidden }
  })
}

const indent = (depth: number): CSSProperties | undefined =>
  depth > 0 ? { '--folder-depth': depth } as CSSProperties : undefined

/**
 * The rows of the expression panel in folder order (DOC-013). The list stays
 * flat, so that a row moved between folders keeps its element and its focus;
 * the rows of a collapsed folder are hidden, not removed.
 */
export function ExpressionTree({ document, folders, renderItem, folderActions }: ExpressionTreeProps) {
  const target = folders.dropTarget
  return treeRows(document).map(({ row, hidden }) => {
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
          onNameEntered={() => {
            // The first row of the folder takes focus once the renamed folder has rendered.
            const first = document.items.find((item) => isWithin(itemFolder(item), row.path))
            if (!first || isFolderCollapsed(document, row.path)) return false
            requestAnimationFrame(() => window.document.getElementById(`expression-source-${first.id}`)?.focus())
            return true
          }}
          onDelete={() => folders.deleteFolder(row.path)}
          handle={{
            onPointerDown: (event) => folders.beginFolderReorder(event, row.path),
            onKeyDown: (event) => folders.reorderFolderWithKeyboard(event, row.path),
          }}
          className={dropClass}
          children={folderActions?.(row.path, row.name)}
          rowRef={(element) => {
            if (element) folders.folderRowRefs.current.set(key, element)
            else folders.folderRowRefs.current.delete(key)
          }}
        />
      </div>
    )
  })
}
