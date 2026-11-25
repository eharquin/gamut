import { describe, expect, it } from 'vitest'
import { createBuiltinAlgebraRegistry } from '../algebra/builtinAlgebras'
import { DocumentFormatError, parseCanonicalDocument, toCanonicalDocument } from '../document/canonicalDocument'
import { expressionDocument } from '../document/expressionDocument'
import { HELD_STORED_DOCUMENT, restoreActiveDocument } from './restoreActiveDocument'

const registry = createBuiltinAlgebraRegistry()
const stored = toCanonicalDocument(expressionDocument([{ id: 'a', source: 'A = norm(3e1 + 4e2)' }]), 'dark')

describe('restoring the active document (#173)', () => {
  it('finds nothing to restore', () => {
    expect(restoreActiveDocument(() => null, registry, {})).toEqual({ status: 'none' })
  })

  it('restores the stored document with its theme, and no notice when it is current', () => {
    const result = restoreActiveDocument(() => stored, registry, {})
    expect(result.status).toBe('restored')
    if (result.status !== 'restored') return
    expect(result.restored.document.items[0].source).toBe('A = norm(3e1 + 4e2)')
    expect(result.restored.theme).toBe('dark')
    expect(result.migrationNotice).toBeNull()
  })

  it('tells the reader when an earlier version wrote it', () => {
    // As the browser storage reads it: parsing records the migration.
    const earlier = JSON.stringify({ ...stored, languageVersion: 1 })
    const result = restoreActiveDocument(() => parseCanonicalDocument(earlier), registry, {})
    expect(result.status === 'restored' && result.migrationNotice).toMatch(/written by an earlier version of GAMUT/)
  })

  it('holds a document it cannot read, with the reason', () => {
    const newer = restoreActiveDocument(() => {
      throw new DocumentFormatError('DOCUMENT_FORMAT_VERSION', 'Unsupported format version 99.')
    }, registry, {})
    expect(newer).toEqual({
      status: 'held',
      diagnostic: 'DOCUMENT_FORMAT_VERSION: Unsupported format version 99. ' + HELD_STORED_DOCUMENT,
    })
    const unreadable = restoreActiveDocument(() => { throw new Error('quota') }, registry, {})
    expect(unreadable.status === 'held' && unreadable.diagnostic).toMatch(/^STORE_READ_FAILED: /)
  })

  it('holds a document whose algebra this runtime does not have', () => {
    const unknown = { ...stored, algebra: { ...stored.algebra, algebraId: 'org.example.unknown' } }
    expect(restoreActiveDocument(() => unknown, registry, {}).status).toBe('held')
  })
})
