import { useCallback, useState } from 'react'
import { folderKey, type FolderPath } from '../document/folderModel'

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
  const toggle = useCallback((section: LibrarySection, path: FolderPath) => {
    setCollapsed((current) => {
      const key = folderKey(path)
      const keys = current[section].includes(key)
        ? current[section].filter((candidate) => candidate !== key)
        : [...current[section], key]
      const next = { ...current, [section]: keys }
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
  return { isCollapsed, toggle }
}
