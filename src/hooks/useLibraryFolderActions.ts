import {
  browserLibraryStorage,
  createLibraryFolder,
  deleteLibraryFolder,
  LibraryError,
  moveInLibrary,
  renameLibraryFolder,
  type LibraryEntry,
  type LibraryOptions,
  type LibraryRead,
} from '../document/documentLibrary'
import { folderName, uniqueFolderName, type FolderPath } from '../document/folderModel'

export type LibraryFolderActions = Readonly<{
  /** Creates a folder named `New folder` (or a free variant) inside `parent`; returns its path, or null. */
  createFolder(parent: FolderPath): FolderPath | null
  /** Returns why the name is refused, or null once renamed. */
  renameFolder(path: FolderPath, name: string): string | null
  /** Deletes a folder with its subfolders and graphs, already confirmed by the panel; false when the write failed. */
  deleteFolder(path: FolderPath): boolean
  /** Moves a graph into a folder, or to the root; false when the write failed. */
  moveGraph(entry: LibraryEntry, folder: FolderPath): boolean
}>

type Options = Readonly<{
  library: LibraryRead | null
  libraryOptions(): LibraryOptions
  setLibrary(read: LibraryRead): void
  reportLibraryFailure(error: unknown, fallback: string): void
  /** The graphs a folder deletion removed, so that the open one becomes unsaved. */
  onGraphsDeleted(ids: readonly string[]): void
}>

/**
 * The folder operations of My library (STORE-016): each reads the library
 * again before its write, as the other library writes do, and reports a
 * failure in the panel without changing the library.
 */
export function useLibraryFolderActions({
  library, libraryOptions, setLibrary, reportLibraryFailure, onGraphsDeleted,
}: Options): LibraryFolderActions {
  const show = (write: Readonly<{ entries: readonly LibraryEntry[]; folders: readonly FolderPath[] }>) =>
    setLibrary({ entries: write.entries, folders: write.folders, diagnostic: null })
  return {
    createFolder(parent) {
      const path = [...parent, uniqueFolderName(library?.folders ?? [], parent)]
      try {
        show(createLibraryFolder(browserLibraryStorage(), path, libraryOptions()))
        return path
      } catch (error) {
        reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: The folder could not be created.')
        return null
      }
    },
    renameFolder(path, rawName) {
      const name = rawName.trim()
      if (name === folderName(path)) return null
      if (name === '') return 'A folder name cannot be empty.'
      try {
        show(renameLibraryFolder(browserLibraryStorage(), path, name, libraryOptions()))
        return null
      } catch (error) {
        if (error instanceof LibraryError && (error.code === 'FOLDER_NAME_TAKEN' || error.code.startsWith('LIMIT_')))
          return error.message
        reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: The folder could not be renamed.')
        return null
      }
    },
    deleteFolder(path) {
      try {
        const deleted = deleteLibraryFolder(browserLibraryStorage(), path, libraryOptions())
        show(deleted)
        onGraphsDeleted(deleted.deletedIds)
        return true
      } catch (error) {
        reportLibraryFailure(error, 'LIBRARY_WRITE_FAILED: The folder could not be deleted.')
        return false
      }
    },
    moveGraph(entry, folder) {
      try {
        show(moveInLibrary(browserLibraryStorage(), entry.id, folder, libraryOptions()))
        return true
      } catch (error) {
        reportLibraryFailure(error, `LIBRARY_WRITE_FAILED: “${entry.name}” could not be moved.`)
        return false
      }
    },
  }
}
