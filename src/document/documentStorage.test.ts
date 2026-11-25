import { describe, expect, it } from 'vitest'
import { toCanonicalDocument } from './canonicalDocument'
import {
  ACTIVE_DOCUMENT_KEY,
  browserDocumentStorage,
  discardKeptDocument,
  keepUnreadableDocument,
  KEPT_DOCUMENT_KEY,
  readKeptDocument,
} from './documentStorage'
import { expressionDocument } from './expressionDocument'

describe('document storage', () => {
  it('retains the historical active-document key across product renames', () => {
    expect(ACTIVE_DOCUMENT_KEY).toBe('multivector.document.active.v1')
  })

  it('stores and restores a validated canonical revision', () => {
    const values = new Map<string, string>()
    const storage = browserDocumentStorage({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
    })
    const document = toCanonicalDocument(expressionDocument([{ id: 'a', source: '2' }]), 'system')
    storage.save(document)
    expect(storage.load()).toEqual(document)
  })

  it('retains the last valid revision when a later write fails', () => {
    let stored: string | null = null
    let fail = false
    const storage = browserDocumentStorage({
      getItem: () => stored,
      setItem: (_key, value) => {
        if (fail) throw new DOMException('Quota exceeded', 'QuotaExceededError')
        stored = value
      },
    })
    const document = toCanonicalDocument(expressionDocument([{ id: 'a', source: '2' }]), 'light')
    storage.save(document)
    fail = true
    expect(() => storage.save({ ...document, metadata: { title: 'Changed', description: '' } })).toThrow()
    expect(storage.load()).toEqual(document)
  })
})

describe('keeping a stored document this version cannot read (#275)', () => {
  const memory = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial))
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
  }
  const document = toCanonicalDocument(expressionDocument([{ id: 'a', source: '2' }]), 'system')
  const newer = JSON.stringify({ ...document, formatVersion: 99 })

  it('copies the stored text to the kept key, once', () => {
    const storage = memory({ [ACTIVE_DOCUMENT_KEY]: newer })
    expect(keepUnreadableDocument(storage)).toBe(true)
    expect(keepUnreadableDocument(storage)).toBe(true)
    expect(storage.values.get(KEPT_DOCUMENT_KEY)).toBe(newer)
  })

  it('never replaces a different kept copy, and says the stored one is not kept', () => {
    const earlier = JSON.stringify({ ...document, formatVersion: 98 })
    const storage = memory({ [ACTIVE_DOCUMENT_KEY]: newer, [KEPT_DOCUMENT_KEY]: earlier })
    expect(keepUnreadableDocument(storage)).toBe(false)
    expect(storage.values.get(KEPT_DOCUMENT_KEY)).toBe(earlier)
  })

  it('keeps nothing that no version could read, and replaces such a kept text', () => {
    const truncated = newer.slice(0, 40)
    const junk = memory({ [ACTIVE_DOCUMENT_KEY]: truncated })
    expect(keepUnreadableDocument(junk)).toBe(true)
    expect(junk.values.has(KEPT_DOCUMENT_KEY)).toBe(false)
    const blocked = memory({ [ACTIVE_DOCUMENT_KEY]: newer, [KEPT_DOCUMENT_KEY]: truncated })
    expect(keepUnreadableDocument(blocked)).toBe(true)
    expect(blocked.values.get(KEPT_DOCUMENT_KEY)).toBe(newer)
  })

  it('reports a failed write as not kept', () => {
    const storage = { ...memory({ [ACTIVE_DOCUMENT_KEY]: newer }), setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') } }
    expect(keepUnreadableDocument(storage)).toBe(false)
  })

  it('reads the kept copy as unchanged, readable or unreadable', () => {
    expect(readKeptDocument(memory()).status).toBe('none')
    expect(readKeptDocument(memory({ [ACTIVE_DOCUMENT_KEY]: newer, [KEPT_DOCUMENT_KEY]: newer })).status).toBe('unchanged')
    expect(readKeptDocument(memory({ [KEPT_DOCUMENT_KEY]: newer })).status).toBe('unreadable')
    const readable = readKeptDocument(memory({ [KEPT_DOCUMENT_KEY]: JSON.stringify(document) }))
    expect(readable).toEqual({ status: 'readable', document })
    // A copy this version parses but cannot restore stays kept.
    const refused = readKeptDocument(memory({ [KEPT_DOCUMENT_KEY]: JSON.stringify(document) }), () => {
      throw new Error('ALGEBRA_UNAVAILABLE')
    })
    expect(refused.status).toBe('unreadable')
    const storage = memory({ [KEPT_DOCUMENT_KEY]: newer })
    discardKeptDocument(storage)
    expect(storage.values.has(KEPT_DOCUMENT_KEY)).toBe(false)
  })
})
