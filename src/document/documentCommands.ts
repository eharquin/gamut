import {
  MAX_EXPRESSION_ITEMS,
  type ExpressionAppearance,
  type ExpressionControl,
  type ExpressionDocument,
  type ExpressionItem,
  type ItemNormalization,
  mergeAppearance,
} from './expressionDocument'
import { directScalarEdit, formatScalarSource } from '../language/directScalarEdit'
import { applyItemMove, createFolder, deleteFolder, itemFolder, renameFolder } from './expressionFolders'
import type { FolderPath } from './folderModel'

export type DocumentCommand =
  | Readonly<{ kind: 'insert-item'; item: ExpressionItem; anchorId?: string; placement?: 'before' | 'after' }>
  /**
   * Moves an item next to the anchor, or to the end, and into `folder` when
   * given (the empty path is the top level); without it the item keeps its
   * folder (DOC-013).
   */
  | Readonly<{ kind: 'move-item'; itemId: string; anchorId?: string; placement?: 'before' | 'after'; folder?: FolderPath }>
  | Readonly<{ kind: 'create-folder'; path: FolderPath }>
  | Readonly<{ kind: 'rename-folder'; path: FolderPath; name: string }>
  /** Removes a folder and keeps its items and subfolders in its parent. */
  | Readonly<{ kind: 'delete-folder'; path: FolderPath }>
  | Readonly<{ kind: 'delete-item'; itemId: string }>
  | Readonly<{ kind: 'clear-items' }>
  | Readonly<{ kind: 'update-source'; itemId: string; source: string }>
  | Readonly<{ kind: 'update-position'; itemId: string; positionSource: string }>
  | Readonly<{ kind: 'update-normalization'; itemId: string; normalization?: ItemNormalization }>
  | Readonly<{ kind: 'update-appearance'; itemId: string; appearance: ExpressionAppearance }>
  | Readonly<{ kind: 'update-control'; itemId: string; control?: ExpressionControl }>
  | Readonly<{ kind: 'set-scalar-value'; itemId: string; value: number }>
  | Readonly<{ kind: 'update-algebra'; algebra: ExpressionDocument['algebra']; interpretation: ExpressionDocument['interpretation'] }>
  | Readonly<{
      /**
       * Selects an algebra with its standard interpretation and visualizer, and
       * the title and description of the example it loads; only on a document
       * without content.
       */
      kind: 'select-algebra'
      algebra: ExpressionDocument['algebra']
      interpretation: ExpressionDocument['interpretation']
      visualizerId: string | null
      title: string
      description: string
    }>
  | Readonly<{
      kind: 'rewrite-source-literal'
      itemId: string
      property: 'source' | 'positionSource'
      span: Readonly<{ start: number; end: number }>
      replacement: string
    }>

/**
 * The kind a source gives its item (language §3): an annotation when its first
 * non-whitespace character is `#`, an expression otherwise (#187).
 */
export function sourceKind(source: string): 'expression' | 'annotation' {
  return source.trimStart().startsWith('#') ? 'annotation' : 'expression'
}

/**
 * The item after a source edit, with its kind derived from the new source. An
 * item that becomes an annotation drops the position, normalization, and
 * control the format forbids on it; undo restores them with the source.
 */
function withSource(item: ExpressionItem, source: string): ExpressionItem {
  if (sourceKind(source) === 'annotation') return { id: item.id, kind: 'annotation', source }
  if (item.kind === 'annotation') return { id: item.id, source }
  return { ...item, source }
}

/**
 * A document has content once any item carries source text (EDIT), or it has
 * a folder (DOC-013); empty rows do not count.
 */
export function hasContent(document: ExpressionDocument): boolean {
  return (document.folders?.length ?? 0) > 0 || document.items.some((item) => item.source.trim() !== '' || (item.positionSource?.trim() ?? '') !== '')
}

export type CommandResult =
  | Readonly<{ status: 'applied'; document: ExpressionDocument }>
  | Readonly<{ status: 'unsupported' | 'invalid'; document: ExpressionDocument; reason: string }>

function itemIndex(document: ExpressionDocument, itemId: string): number {
  return document.items.findIndex((item) => item.id === itemId)
}

function invalid(document: ExpressionDocument, reason: string): CommandResult {
  return { status: 'invalid', document, reason }
}

/** Applies document-owned changes by stable identity, without consulting evaluated or rendered state. */
export function executeDocumentCommand(
  document: ExpressionDocument,
  command: DocumentCommand,
): CommandResult {
  if (command.kind === 'clear-items') {
    if (document.items.length === 0 && (document.folders?.length ?? 0) === 0)
      return invalid(document, 'The document is already empty.')
    return { status: 'applied', document: { ...document, items: [], appearance: {}, folders: [] } }
  }

  if (command.kind === 'create-folder' || command.kind === 'rename-folder' || command.kind === 'delete-folder') {
    const edit = command.kind === 'create-folder'
      ? createFolder(document, command.path)
      : command.kind === 'rename-folder'
        ? renameFolder(document, command.path, command.name)
        : deleteFolder(document, command.path)
    return edit.status === 'applied' ? edit : invalid(document, edit.reason)
  }

  if (command.kind === 'insert-item') {
    if (!command.item.id) return invalid(document, 'An item identity cannot be empty.')
    if (itemIndex(document, command.item.id) >= 0)
      return invalid(document, `Item “${command.item.id}” already exists.`)
    if (document.items.length >= MAX_EXPRESSION_ITEMS)
      return invalid(document, `A document may contain at most ${MAX_EXPRESSION_ITEMS} items.`)
    let index = document.items.length
    let inserted = withSource(command.item, command.item.source)
    if (command.anchorId !== undefined) {
      const anchor = itemIndex(document, command.anchorId)
      if (anchor < 0) return invalid(document, `Item “${command.anchorId}” does not exist.`)
      index = anchor + (command.placement === 'before' ? 0 : 1)
      // A row inserted next to another joins its folder (DOC-013).
      const folder = itemFolder(document.items[anchor])
      if (command.item.folder === undefined && folder.length > 0) inserted = { ...inserted, folder }
    }
    return {
      status: 'applied',
      document: {
        ...document,
        // An inserted source gets its kind like an edited one (#187).
        items: [...document.items.slice(0, index), inserted, ...document.items.slice(index)],
      },
    }
  }

  if (command.kind === 'move-item') {
    const item = document.items.find(({ id }) => id === command.itemId)
    if (!item) return invalid(document, `Item “${command.itemId}” does not exist.`)
    const edit = applyItemMove(document, {
      itemId: command.itemId,
      folder: command.folder ?? itemFolder(item),
      anchorId: command.anchorId,
      placement: command.placement,
    })
    return edit.status === 'applied' ? edit : invalid(document, edit.reason)
  }

  if (command.kind === 'update-algebra') {
    return {
      status: 'applied',
      document: { ...document, algebra: command.algebra, interpretation: command.interpretation },
    }
  }

  if (command.kind === 'select-algebra') {
    if (hasContent(document)) {
      return invalid(document, 'The algebra of a document with content cannot be changed.')
    }
    return {
      status: 'applied',
      document: {
        ...document,
        title: command.title,
        description: command.description,
        algebra: command.algebra,
        interpretation: command.interpretation,
        view: { ...document.view, visualizerId: command.visualizerId },
      },
    }
  }

  const index = itemIndex(document, command.itemId)
  if (index < 0) return invalid(document, `Item “${command.itemId}” does not exist.`)
  const item = document.items[index]

  if (command.kind === 'delete-item') {
    return {
      status: 'applied',
      document: {
        ...document,
        items: document.items.filter(({ id }) => id !== command.itemId),
        appearance: Object.fromEntries(Object.entries(document.appearance)
          .filter(([id]) => id !== command.itemId)),
      },
    }
  }
  if (command.kind === 'update-position' && item.kind === 'annotation')
    return { status: 'unsupported', document, reason: 'Annotations do not own position source.' }
  if ((command.kind === 'update-normalization' || command.kind === 'update-control') && item.kind === 'annotation')
    return { status: 'unsupported', document, reason: 'Annotations do not own algebraic controls.' }

  if (command.kind === 'set-scalar-value') {
    if (item.kind === 'annotation')
      return { status: 'unsupported', document, reason: 'Annotations do not own algebraic controls.' }
    if (!Number.isFinite(command.value))
      return invalid(document, 'A controlled scalar value must be finite.')
    const edit = directScalarEdit(item.source)
    if (!edit) return {
      status: 'unsupported', document,
      reason: 'Only a directly declared numeric scalar literal can be controlled.',
    }
    const replacement = formatScalarSource(command.value)
    return {
      status: 'applied',
      document: {
        ...document,
        items: document.items.map((candidate, candidateIndex) =>
          candidateIndex === index
            ? { ...item, source: item.source.slice(0, edit.span.start) + replacement + item.source.slice(edit.span.end) }
            : candidate),
      },
    }
  }

  if (command.kind === 'rewrite-source-literal') {
    if (item.kind === 'annotation')
      return { status: 'unsupported', document, reason: 'Annotations are non-executable and cannot be inverse-edited.' }
    const source = command.property === 'source' ? item.source : item.positionSource
    if (source === undefined)
      return { status: 'unsupported', document, reason: 'The requested source property is not present.' }
    const { start, end } = command.span
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > source.length)
      return invalid(document, 'The requested source span is invalid.')
    const numericLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
    if (!numericLiteral.test(source.slice(start, end))) {
      return {
        status: 'unsupported', document,
        reason: 'Only a direct numeric or unary-signed numeric literal can be rewritten.',
      }
    }
    if (!numericLiteral.test(command.replacement) || !Number.isFinite(Number(command.replacement)))
      return invalid(document, 'The replacement must be a finite numeric literal.')
    const rewritten = source.slice(0, start) + command.replacement + source.slice(end)
    const replacement = command.property === 'source'
      ? { ...item, source: rewritten }
      : { ...item, positionSource: rewritten }
    return {
      status: 'applied',
      document: {
        ...document,
        items: document.items.map((candidate, candidateIndex) =>
          candidateIndex === index ? replacement : candidate),
      },
    }
  }

  if (command.kind === 'update-appearance') {
    return {
      status: 'applied',
      document: {
        ...document,
        appearance: {
          ...document.appearance,
          [command.itemId]: mergeAppearance(document.appearance[command.itemId], command.appearance),
        },
      },
    }
  }

  const replacement = command.kind === 'update-source'
    ? withSource(item, command.source)
    : command.kind === 'update-position'
      ? { ...item, positionSource: command.positionSource }
      : command.kind === 'update-normalization'
        ? { ...item, normalization: command.normalization }
        : { ...item, control: command.control }
  // Writing a position means positions are wanted: a document whose positions
  // are turned off would otherwise keep drawing the object at the origin.
  const enablesPositions = command.kind === 'update-position' &&
    !document.view.positionEnabled && command.positionSource.trim() !== ''
  return {
    status: 'applied',
    document: {
      ...document,
      ...(enablesPositions ? { view: { ...document.view, positionEnabled: true } } : {}),
      items: document.items.map((candidate, candidateIndex) =>
        candidateIndex === index ? replacement : candidate),
    },
  }
}
