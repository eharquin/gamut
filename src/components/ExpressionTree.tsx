import type { CSSProperties, ReactNode } from 'react'
import type { ExpressionDocument } from '../document/expressionDocument'
import { expressionFolderTree, isFolderCollapsed } from '../document/expressionFolders'
import { flattenFolderTree, folderKey, type FolderPath } from '../document/folderModel'
import type { ExpressionFolders } from '../hooks/useExpressionFolders'
import { folderPlainName } from '../presentation/annotationText'
import { InlineMarkdown } from './AnnotationText'
import { FolderRow } from './FolderRow'

type ExpressionTreeProps = Readonly<{
  document: ExpressionDocument
  folders: ExpressionFolders
  /** One expression row. */
  renderItem(itemId: string): ReactNode
  /**
   * Enter in the name field of a folder: a row of the folder to write in. The
   * folder had `path` before the name was validated and has `renamed` now.
   */
  onEnterFolder?(path: FolderPath, renamed: FolderPath): void
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
export function ExpressionTree({ document, folders, renderItem, folderActions, onEnterFolder }: ExpressionTreeProps) {
  const target = folders.dropTarget
  const rows = treeRows(document)
  const kindOf = (itemId: string) => document.items.find((item) => item.id === itemId)?.kind === 'annotation' ? 'note' : 'expression'
  /**
   * Where a folder header or a row of a folder sits in the folder's block, for
   * the cards style, which joins them: the header is the block's first card,
   * then its visible rows.
   */
  const groupOf = (index: number): 'first' | 'middle' | 'last' | 'only' | undefined => {
    const { row } = rows[index]
    if (row.kind === 'folder') {
      const next = rows[index + 1]
      const opens = next !== undefined && !next.hidden && next.row.kind === 'entry' && folderKey(next.row.folder) === folderKey(row.path)
      return opens ? 'first' : 'only'
    }
    if (row.depth === 0) return undefined
    const inFolder = (other: (typeof rows)[number] | undefined) =>
      other !== undefined && (other.row.kind === 'entry'
        ? folderKey(other.row.folder) === folderKey(row.folder)
        : folderKey(other.row.path) === folderKey(row.folder))
    const after = rows[index + 1]
    const afterInFolder = after !== undefined && after.row.kind === 'entry' && folderKey(after.row.folder) === folderKey(row.folder)
    return inFolder(rows[index - 1]) ? afterInFolder ? 'middle' : 'last' : afterInFolder ? 'first' : 'only'
  }
  return rows.map(({ row, hidden }, index) => {
    const group = groupOf(index)
    if (row.kind === 'entry') {
      return (
        <div key={row.entry.id} className="folder-member" hidden={hidden} style={indent(row.depth)}
          data-group={group} data-kind={kindOf(row.entry.id)}>
          {renderItem(row.entry.id)}
        </div>
      )
    }
    const key = folderKey(row.path)
    const dropClass = target?.kind === 'before-folder' && folderKey(target.path) === key ? 'drop-before'
      : target?.kind === 'into-folder' && folderKey(target.path) === key ? 'drop-into' : undefined
    return (
      <div key={`folder:${key}`} className="folder-member" hidden={hidden} style={indent(row.depth)} data-kind="folder" data-group={group}>
        <FolderRow
          path={row.path}
          name={row.name}
          level={row.depth + 1}
          expanded={!isFolderCollapsed(document, row.path)}
          entryCount={row.entryCount}
          entryNoun={['row', 'rows']}
          display={{
            name: <InlineMarkdown id={`folder-name-${encodeURIComponent(key)}`} text={row.name} />,
            plainName: folderPlainName(row.name),
          }}
          renaming={folders.renamingKey === key}
          onRenamingChange={(renaming) => folders.setRenamingKey(renaming ? key : null)}
          onToggle={() => folders.toggleFolder(row.path)}
          onRename={(name) => folders.renameFolder(row.path, name)}
          onNameEntered={(name) => {
            if (!onEnterFolder) return false
            onEnterFolder(row.path, [...row.path.slice(0, -1), name])
            return true
          }}
          onDelete={() => folders.deleteFolder(row.path)}
          handle={{
            onPointerDown: (event) => folders.beginFolderReorder(event, row.path),
            onKeyDown: (event) => folders.reorderFolderWithKeyboard(event, row.path),
          }}
          className={dropClass}
          children={folderActions?.(row.path, folderPlainName(row.name))}
          rowRef={(element) => {
            if (element) folders.folderRowRefs.current.set(key, element)
            else folders.folderRowRefs.current.delete(key)
          }}
        />
      </div>
    )
  })
}
