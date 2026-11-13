import { useCallback, useState } from 'react'
import { folderKey, isFolderPath, isWithin, replacePrefix, type FolderPath } from '../document/folderModel'

/** Per-browser preference: the collapsed folders of each library section (STORE-016). */
export const LIBRARY_COLLAPSED_FOLDERS_KEY = 'gamut.libraryCollapsedFolders'

export type LibrarySection = 'mine' | 'examples'

type Collapsed = Readonly<Record<LibrarySection, readonly string[]>>

function readCollapsed(): Collapsed {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIBRARY_COLLAPSED_FOLDERS_KEY) ?? 'null') as Partial<Record<LibrarySection, unknown>> | null
    const keys = (value: unknown) => Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : []
    return { mine: keys(parsed?.mine), examples: keys(parsed?.examples) }
  } catch {
    return { mine: [], examples: [] }
  }
}

function keyPath(key: string): FolderPath | null {
  try {
    const path: unknown = JSON.parse(key)
    return isFolderPath(path) ? path : null
  } catch {
    return null
  }
}

/**
 * The collapsed state of library folders, a per-browser preference and not
 * document content (STORE-016). It tolerates unavailable storage, and a
 * temporary shared-scene session keeps it in memory without writing it
 * (scene links, temporary sessions).
 */
export function useLibraryFolderCollapse(temporarySession: boolean) {
  const [collapsed, setCollapsed] = useState<Collapsed>(readCollapsed)
  const isCollapsed = useCallback(
    (section: LibrarySection, path: FolderPath) => collapsed[section].includes(folderKey(path)),
    [collapsed],
  )
  const update = useCallback((section: LibrarySection, change: (keys: readonly string[]) => readonly string[]) => {
    setCollapsed((current) => {
      const next = { ...current, [section]: change(current[section]) }
      if (!temporarySession) {
        try {
          window.localStorage.setItem(LIBRARY_COLLAPSED_FOLDERS_KEY, JSON.stringify(next))
        } catch {
          // The preference lasts for this visit only.
        }
      }
      return next
    })
  }, [temporarySession])
  const toggle = useCallback((section: LibrarySection, path: FolderPath) => {
    const key = folderKey(path)
    update(section, (keys) => keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key])
  }, [update])
  /** The collapsed state follows a renamed folder and its subfolders. */
  const rename = useCallback((section: LibrarySection, from: FolderPath, to: FolderPath) => {
    update(section, (keys) => keys.map((key) => {
      const path = keyPath(key)
      return path && isWithin(path, from) ? folderKey(replacePrefix(path, from, to)) : key
    }))
  }, [update])
  /** Forgets a deleted folder and its subfolders, so that a later folder of that name starts expanded. */
  const remove = useCallback((section: LibrarySection, deleted: FolderPath) => {
    update(section, (keys) => keys.filter((key) => {
      const path = keyPath(key)
      return !(path && isWithin(path, deleted))
    }))
  }, [update])
  return { isCollapsed, toggle, rename, remove }
}
