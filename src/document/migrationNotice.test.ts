import { describe, expect, it } from 'vitest'
import { documentMigration, parseCanonicalDocument, serializeCanonicalDocument, toCanonicalDocument } from './canonicalDocument'
import { expressionDocument } from './expressionDocument'
import { libraryDocumentKey, loadFromLibrary, type LibraryStorage } from './documentLibrary'
import { migrationNotice } from './migrationNotice'

const current = toCanonicalDocument(expressionDocument([
  { id: 'a', source: 'A = e1 + e2' },
  { id: 'd', source: 'd = A.norm' },
  { id: 'n', kind: 'annotation', source: 'A.norm in a note' },
], { a: { label: '|A| = ${A.norm}' } }, { id: 'old-graph' }), 'light')
/** The same graph as language version 1 wrote it. */
const version1 = JSON.stringify({ ...current, languageVersion: 1 })

describe('the migration of an opened document (#343)', () => {
  it('records the versions it came from and the rows rewritten', () => {
    expect(documentMigration(parseCanonicalDocument(version1))).toEqual({
      formatVersion: 13, languageVersion: 1, rewritten: ['A', 'd'],
    })
    const { valuesVisible: _hidden, ...display } = current.view.display
    const version7 = JSON.stringify({ ...current, formatVersion: 7, view: { ...current.view, display } })
    expect(documentMigration(parseCanonicalDocument(version7))).toEqual({
      formatVersion: 7, languageVersion: 2, rewritten: [],
    })
  })

  it('names the folders whose appearance was rewritten, and anonymous rows by position', () => {
    const withFolder = {
      ...current,
      languageVersion: 1,
      items: [...current.items, { ...current.items[0], id: 'x', source: 'A.dual' }],
      appearance: { ...current.appearance, x: current.appearance.a },
      folders: [{ path: ['Sums'], collapsed: false, overwriteAppearance: true, before: null,
        appearance: { ...current.appearance.a, label: '', opacitySource: 'A.norm' } }],
    }
    expect(documentMigration(parseCanonicalDocument(JSON.stringify(withFolder)))?.rewritten)
      .toEqual(['A', 'd', 'row 4', 'folder Sums'])
  })

  it('records nothing for a document in the current versions', () => {
    expect(documentMigration(parseCanonicalDocument(serializeCanonicalDocument(current)))).toBeNull()
    expect(migrationNotice(null)).toBeNull()
  })

  it('tells what changed and that saving writes the new format', () => {
    expect(migrationNotice({ formatVersion: 7, languageVersion: 1, rewritten: ['d', 'row 3'] })).toBe(
      'This graph was written by an earlier version of GAMUT (format 7, language 1) and opened as format 13, language 2. '
      + 'Rewritten in the current language, where operations such as A.norm are written norm(A): d and row 3. '
      + 'Saving it writes the new format.',
    )
    expect(migrationNotice({ formatVersion: 13, languageVersion: 1, rewritten: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }))
      .toContain(': a, b, c, d, e and 2 more.')
    expect(migrationNotice({ formatVersion: 12, languageVersion: 2, rewritten: [] })).toBe(
      'This graph was written by an earlier version of GAMUT (format 12, language 2) and opened as format 13, language 2. '
      + 'Saving it writes the new format.',
    )
  })

  it('reaches a graph opened from the library, which stays stored as it was', () => {
    const values = new Map([[libraryDocumentKey('old-graph'), version1]])
    const storage: LibraryStorage = {
      get length() { return values.size },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    }
    expect(documentMigration(loadFromLibrary(storage, 'old-graph'))).toMatchObject({ languageVersion: 1 })
    expect(values.get(libraryDocumentKey('old-graph'))).toBe(version1)
  })
})
