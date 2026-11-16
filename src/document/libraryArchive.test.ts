import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { serializeCanonicalDocument, toCanonicalDocument, type CanonicalDocument } from './canonicalDocument'
import { ACTIVE_DOCUMENT_KEY } from './documentStorage'
import {
  createLibraryFolder,
  LIBRARY_INDEX_KEY,
  loadFromLibrary,
  readLibrary,
  saveToLibrary,
  type LibraryStorage,
} from './documentLibrary'
import { expressionDocument } from './expressionDocument'
import {
  ARCHIVE_MANIFEST_PATH,
  exportLibraryArchive,
  importLibraryArchive,
  describeArchiveImport,
  readLibraryArchive,
} from './libraryArchive'
import { ArchiveError, crc32, MAX_ARCHIVE_ENTRIES, openZip, readZipEntry, writeZip, type ZipFile } from './zipArchive'

const NOW = '2026-11-13T10:00:00.000Z'
const DATE = new Date(2026, 10, 13, 11, 0, 0)

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const state = { failWrites: (_key: string) => false }
  const storage: LibraryStorage = {
    get length() { return values.size },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (state.failWrites(key)) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      values.set(key, value)
    },
    removeItem: (key) => { values.delete(key) },
  }
  return { storage, values, state }
}

function graph(id: string, title: string, source = 'a = 1'): CanonicalDocument {
  return toCanonicalDocument(expressionDocument([{ id: 'item-1', source }], {}, { id, title }), 'light')
}

const encoder = new TextEncoder()
/** Reproducible text over four symbols, which deflates about four times: within the expansion bound. */
function noise(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = 12345
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    bytes[index] = 0x61 + (state >>> 30)
  }
  return bytes
}
const text = (value: string) => encoder.encode(value)
const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>])
const zip = (files: readonly ZipFile[]) => writeZip(files, DATE)
const documentFile = (path: string, document: CanonicalDocument): ZipFile => ({ path, bytes: text(serializeCanonicalDocument(document)) })

async function rejection(run: () => unknown): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (error instanceof ArchiveError) return error.code
    throw error
  }
  return 'accepted'
}

/** The archive with one 16-bit or 32-bit field of its first central record, or of its end record, replaced. */
function patched(bytes: Uint8Array, record: 'central' | 'local' | 'end', offset: number, value: number, size: 2 | 4 = 2): Uint8Array {
  const copy = bytes.slice()
  const view = new DataView(copy.buffer)
  const end = copy.byteLength - 22
  const start = record === 'end' ? end : record === 'central' ? view.getUint32(end + 16, true) : 0
  if (size === 2) view.setUint16(start + offset, value, true)
  else view.setUint32(start + offset, value, true)
  return copy
}

function library() {
  const { storage, values, state } = memoryStorage()
  createLibraryFolder(storage, ['Talks'], { now: NOW })
  createLibraryFolder(storage, ['Talks', '2026'], { now: NOW })
  createLibraryFolder(storage, ['Empty'], { now: NOW })
  saveToLibrary(storage, graph('a', 'Rotation'), 'Rotation', { now: NOW, boundId: null })
  saveToLibrary(storage, graph('b', 'Lines: a/b'), 'Lines: a/b', { now: NOW, boundId: null, folder: ['Talks', '2026'] })
  saveToLibrary(storage, graph('c', 'lines- a-b'), 'lines- a-b', { now: NOW, boundId: null, folder: ['Talks', '2026'] })
  return { storage, values, state }
}

describe('zip archives', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips stored and deflated entries with UTF-8 names', async () => {
    const long = noise(3000)
    const bytes = await zip([{ path: 'dossier é/' }, { path: 'dossier é/été.txt', bytes: text('x') }, { path: 'long.txt', bytes: long }])
    const entries = openZip(bytes)
    expect(entries.map(({ path, directory, method }) => ({ path, directory, method }))).toEqual([
      { path: 'dossier é', directory: true, method: 0 },
      { path: 'dossier é/été.txt', directory: false, method: 0 },
      { path: 'long.txt', directory: false, method: 8 },
    ])
    expect(await readZipEntry(bytes, entries[2], () => undefined)).toEqual(long)
    expect(bytes.byteLength).toBeLessThan(long.byteLength)
  })

  it('stores an entry that would deflate past the expansion bound, so that it reads back', async () => {
    const zeros = new Uint8Array(1024 * 1024)
    const bytes = await zip([{ path: 'zeros.bin', bytes: zeros }])
    const [entry] = openZip(bytes)
    expect(entry.method).toBe(0)
    expect((await readZipEntry(bytes, entry, () => undefined)).byteLength).toBe(zeros.byteLength)
  })

  it('rejects unsafe, undecodable, and duplicate paths', async () => {
    for (const path of ['/absolute.json', '../up.json', 'a/../b.json', 'a\\b.json', 'a//b.json', './a.json', 'a\u0001.json']) {
      expect(await rejection(async () => openZip(await zip([{ path, bytes: text('{}') }]))), path).toBe('ARCHIVE_PATH')
    }
    expect(await rejection(async () => openZip(await zip([{ path: `${'a'.repeat(1025)}`, bytes: text('{}') }])))).toBe('LIMIT_ARCHIVE_PATH_LENGTH')
    expect(await rejection(async () => openZip(await zip([{ path: 'a.json', bytes: text('1') }, { path: 'a.json', bytes: text('2') }]))))
      .toBe('ARCHIVE_DUPLICATE_PATH')
    // The same name, composed and decomposed, is one path.
    expect(await rejection(async () => openZip(await zip([{ path: 'é.json', bytes: text('1') }, { path: 'é.json', bytes: text('2') }]))))
      .toBe('ARCHIVE_DUPLICATE_PATH')
    const bytes = await zip([{ path: 'ab.json', bytes: text('{}') }])
    const invalid = bytes.slice()
    const central = new DataView(invalid.buffer).getUint32(invalid.byteLength - 22 + 16, true)
    invalid[central + 46] = 0xff
    expect(await rejection(() => openZip(invalid))).toBe('ARCHIVE_PATH_ENCODING')
  })

  it('rejects encrypted entries, ZIP64, other methods, split archives, and too many entries', async () => {
    const bytes = await zip([{ path: 'a.json', bytes: noise(600) }])
    expect(await rejection(() => openZip(patched(bytes, 'central', 8, 0x0801)))).toBe('ARCHIVE_ENCRYPTED')
    expect(await rejection(() => openZip(patched(bytes, 'local', 6, 0x0801)))).toBe('ARCHIVE_ENCRYPTED')
    expect(await rejection(() => openZip(patched(bytes, 'central', 10, 12)))).toBe('ARCHIVE_METHOD')
    expect(await rejection(() => openZip(patched(bytes, 'central', 24, 0xffffffff, 4)))).toBe('ARCHIVE_ZIP64')
    expect(await rejection(() => openZip(patched(bytes, 'end', 10, 0xffff)))).toBe('ARCHIVE_ZIP64')
    expect(await rejection(() => openZip(patched(bytes, 'end', 4, 1)))).toBe('ARCHIVE_INVALID')
    expect(await rejection(() => openZip(text('not a zip archive at all')))).toBe('ARCHIVE_INVALID')
    expect(await rejection(() => openZip(bytes.subarray(0, bytes.byteLength - 5)))).toBe('ARCHIVE_INVALID')
    const many = await zip(Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, index) => ({ path: `d${index}/` })))
    expect(await rejection(() => openZip(many))).toBe('LIMIT_ARCHIVE_ENTRIES')
  })

  it('stops inflating at the expansion bound, whatever sizes the archive declares', async () => {
    // A deflate stream of zeros, written as a stored entry and then declared deflated.
    const bomb = new Uint8Array(deflateRawSync(new Uint8Array(64 * 1024 * 1024)))
    const stored = await zip([{ path: 'bomb.json', bytes: bomb }])
    const bytes = patched(patched(stored, 'central', 10, 8), 'local', 8, 8)
    let counted = 0
    expect(await rejection(() => readZipEntry(bytes, openZip(bytes)[0], (length) => { counted = length }))).toBe('LIMIT_DECOMPRESSION_RATIO')
    // The check ran while inflating, long before the whole entry was expanded.
    expect(counted).toBeLessThan(8 * 1024 * 1024)
  })

  it('rejects a checksum mismatch and data that expands past the declared bounds', async () => {
    const bytes = await zip([{ path: 'a.json', bytes: noise(600) }])
    const damaged = patched(bytes, 'central', 16, 0x12345678, 4)
    expect(await rejection(() => readZipEntry(damaged, openZip(damaged)[0], () => undefined))).toBe('ARCHIVE_CRC')
    const truncated = bytes.slice()
    truncated.fill(0xff, 40, 44)
    expect(['ARCHIVE_COMPRESSION', 'ARCHIVE_CRC']).toContain(await rejection(() => readZipEntry(truncated, openZip(truncated)[0], () => undefined)))
  })
})

describe('library archive export (STORE-017)', () => {
  it('writes one canonical document per graph in the library folders, with safe unique names and a manifest', async () => {
    const { storage, values } = library()
    const before = new Map(values)
    const exported = await exportLibraryArchive(storage, { now: NOW, date: DATE })
    expect(exported.fileName).toBe('gamut-library-2026-11-13.zip')
    expect(exported.count).toBe(3)
    expect(exported.skipped).toEqual([])
    expect(exported.warnings).toEqual([])
    // Export never writes.
    expect(values).toEqual(before)
    const entries = openZip(exported.bytes)
    expect(entries.map((entry) => entry.path + (entry.directory ? '/' : ''))).toEqual([
      // Only a folder without any graph needs its own entry.
      'Empty/',
      'Rotation.gamut.json',
      'Talks/2026/Lines- a-b.gamut.json',
      'Talks/2026/lines- a-b 2.gamut.json',
      ARCHIVE_MANIFEST_PATH,
    ])
    const read = async (path: string) => new TextDecoder().decode(
      await readZipEntry(exported.bytes, entries.find((entry) => entry.path === path)!, () => undefined))
    // Identical to the single-graph export of the stored graph.
    expect(await read('Rotation.gamut.json')).toBe(serializeCanonicalDocument(loadFromLibrary(storage, 'a')))
    expect(JSON.parse(await read(ARCHIVE_MANIFEST_PATH))).toEqual({
      version: 1,
      exportedAt: DATE.toISOString(),
      entries: [
        { path: 'Rotation.gamut.json', name: 'Rotation', id: 'a', updatedAt: NOW },
        { path: 'Talks/2026/Lines- a-b.gamut.json', name: 'Lines: a/b', id: 'b', updatedAt: NOW },
        { path: 'Talks/2026/lines- a-b 2.gamut.json', name: 'lines- a-b', id: 'c', updatedAt: NOW },
      ],
    })
  })

  it('leaves out a graph that cannot be read and reports it', async () => {
    const { storage, values } = library()
    values.set('gamut.library.v1.document.a', '{ not json')
    const exported = await exportLibraryArchive(storage, { now: NOW, date: DATE })
    expect(exported.count).toBe(2)
    expect(exported.skipped).toEqual([{ name: 'Rotation', diagnostic: expect.stringMatching(/^LIBRARY_ENTRY_INVALID: /) }])
  })

  it('exports the former active document while it still awaits its migration into the library', async () => {
    const active = graph('former', 'Former work')
    const { storage, values } = memoryStorage({ [ACTIVE_DOCUMENT_KEY]: serializeCanonicalDocument(active) })
    const exported = await exportLibraryArchive(storage, { now: NOW, date: DATE })
    expect(exported.count).toBe(1)
    expect(exported.skipped).toEqual([])
    expect(openZip(exported.bytes).map((entry) => entry.path)).toEqual(['Former work.gamut.json', ARCHIVE_MANIFEST_PATH])
    expect(values.size).toBe(1)
  })

  it('refuses to export a library it cannot read, instead of an empty archive', async () => {
    const { storage } = library()
    const blocked: LibraryStorage = { ...storage, get length(): number { throw new DOMException('denied', 'SecurityError') }, getItem: () => { throw new DOMException('denied', 'SecurityError') } }
    await expect(exportLibraryArchive(blocked, { now: NOW, date: DATE })).rejects.toMatchObject({ code: 'LIBRARY_UNAVAILABLE' })
    await expect(exportLibraryArchive(null, { now: NOW, date: DATE })).rejects.toMatchObject({ code: 'LIBRARY_UNAVAILABLE' })
  })

  it('never writes a dot segment, whatever surrounds a name', async () => {
    const { storage } = memoryStorage()
    for (const name of ['\u00a0..\u00a0', ' . ', '...', '.hidden']) createLibraryFolder(storage, [name], { now: NOW })
    const exported = await exportLibraryArchive(storage, { now: NOW, date: DATE })
    const paths = openZip(exported.bytes).map((entry) => entry.path)
    expect(paths).toHaveLength(5)
    for (const path of paths) expect(path).not.toMatch(/^\./)
  })

  it('warns when the archive could not be imported back as it is', async () => {
    const { storage } = memoryStorage()
    const deep = Array.from({ length: 8 }, (_, index) => `d${index}`)
    for (let depth = 1; depth <= deep.length; depth += 1) createLibraryFolder(storage, deep.slice(0, depth), { now: NOW })
    const exported = await exportLibraryArchive(storage, { now: NOW, date: DATE })
    expect(exported.warnings).toEqual([expect.stringMatching(/^LIMIT_FOLDER_DEPTH: /)])
  })

  it('keeps every entry path within the limit the import enforces', async () => {
    const { storage } = memoryStorage()
    const deep = Array.from({ length: 8 }, (_, index) => `${index}`.padEnd(128, 'é'))
    for (let depth = 1; depth <= deep.length; depth += 1) createLibraryFolder(storage, deep.slice(0, depth), { now: NOW })
    saveToLibrary(storage, graph('a', 'A'), 'é'.repeat(300), { now: NOW, boundId: null, folder: deep })
    const exported = await exportLibraryArchive(storage, { now: NOW, date: DATE })
    expect(() => openZip(exported.bytes)).not.toThrow()
  })
})

describe('library archive import (STORE-018, SEC-010, SEC-011)', () => {
  it('round-trips a library into a new Imported folder, without replacing any graph', async () => {
    const { storage } = library()
    const exported = await exportLibraryArchive(storage, { now: NOW, date: DATE })
    let fresh = 0
    const result = await importLibraryArchive(storage, blob(exported.bytes), { now: '2026-11-14T08:00:00.000Z', date: DATE, createId: () => `new-${fresh += 1}` })
    expect(result.folder).toEqual(['Imported 2026-11-13'])
    expect(result.imported).toBe(3)
    expect(result.skipped).toEqual([])
    expect(result.warnings).toEqual([])
    expect(describeArchiveImport(result)).toBe('Imported 3 graphs into the folder Imported 2026-11-13.')
    const read = readLibrary(storage)
    expect(read.entries.map(({ id, name, folder, updatedAt }) => ({ id, name, folder, updatedAt }))).toEqual([
      { id: 'a', name: 'Rotation', folder: undefined, updatedAt: NOW },
      { id: 'b', name: 'Lines: a/b', folder: ['Talks', '2026'], updatedAt: NOW },
      { id: 'c', name: 'lines- a-b', folder: ['Talks', '2026'], updatedAt: NOW },
      // Identities already in the library are replaced; names and update times are kept.
      { id: 'new-1', name: 'Rotation', folder: ['Imported 2026-11-13'], updatedAt: NOW },
      { id: 'new-2', name: 'Lines: a/b', folder: ['Imported 2026-11-13', 'Talks', '2026'], updatedAt: NOW },
      { id: 'new-3', name: 'lines- a-b', folder: ['Imported 2026-11-13', 'Talks', '2026'], updatedAt: NOW },
    ])
    expect(read.folders).toContainEqual(['Imported 2026-11-13', 'Empty'])
    expect(loadFromLibrary(storage, 'new-1')).toEqual({ ...loadFromLibrary(storage, 'a'), id: 'new-1' })
    // A second import on the same day gets its own folder.
    const again = await importLibraryArchive(storage, blob(exported.bytes), { now: NOW, date: DATE })
    expect(again.folder).toEqual(['Imported 2026-11-13 2'])
  })

  it('imports into an empty library under the identities of the documents', async () => {
    const exported = await exportLibraryArchive(library().storage, { now: NOW, date: DATE })
    const { storage } = memoryStorage()
    await importLibraryArchive(storage, blob(exported.bytes), { now: NOW, date: DATE })
    expect(readLibrary(storage).entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('skips invalid entries, lists them, and imports the valid ones', async () => {
    const bytes = await zip([
      documentFile('ok.gamut.json', graph('ok', 'Fine')),
      { path: 'broken.json', bytes: text('{ not json') },
      { path: 'notes/readme.txt', bytes: text('hello') },
      documentFile('refused.json', graph('refused', 'Refused')),
    ])
    const { storage } = memoryStorage()
    const result = await importLibraryArchive(storage, blob(bytes), {
      now: NOW,
      date: DATE,
      validate: (document) => { if (document.id === 'refused') throw new Error('ALGEBRA_UNAVAILABLE: no such algebra.') },
    })
    expect(result.imported).toBe(1)
    expect(result.skipped).toEqual([
      { path: 'broken.json', diagnostic: expect.stringMatching(/^[A-Z_]+: /) },
      { path: 'notes/readme.txt', diagnostic: 'ARCHIVE_ENTRY_TYPE: Not a JSON document.' },
      { path: 'refused.json', diagnostic: 'ALGEBRA_UNAVAILABLE: no such algebra.' },
    ])
    expect(describeArchiveImport(result)).toBe('Imported 1 graph into the folder Imported 2026-11-13. 3 entries were skipped.')
    expect(readLibrary(storage).entries.map((entry) => entry.name)).toEqual(['Fine'])
  })

  it('writes nothing when the archive holds no valid document', async () => {
    const { storage, values } = memoryStorage()
    const result = await importLibraryArchive(storage, blob(await zip([{ path: 'broken.json', bytes: text('nope') }])), { now: NOW, date: DATE })
    expect(result.folder).toBeNull()
    expect(describeArchiveImport(result)).toBe('No graph was imported: the archive holds no valid document. 1 entry was skipped.')
    expect(values.size).toBe(0)
  })

  it('rejects the whole archive, and writes nothing, when one check fails', async () => {
    const good = documentFile('ok.gamut.json', graph('ok', 'Fine'))
    const { storage, values } = memoryStorage()
    const attempt = async (files: readonly ZipFile[]) => rejection(async () => importLibraryArchive(storage, blob(await zip(files)), { now: NOW, date: DATE }))
    expect(await attempt([good, { path: '../escape.json', bytes: text('{}') }])).toBe('ARCHIVE_PATH')
    expect(await attempt([good, { path: 'big.json', bytes: text(' '.repeat(4 * 1024 * 1024 + 1)) }])).toBe('LIMIT_DOCUMENT_DECODED_SIZE')
    expect(await attempt([good, documentFile(`${Array.from({ length: 8 }, (_, index) => `d${index}`).join('/')}/deep.json`, graph('deep', 'Deep'))]))
      .toBe('LIMIT_FOLDER_DEPTH')
    expect(await attempt([good, { path: `${'n'.repeat(129)}/` }])).toBe('LIMIT_FOLDER_NAME_LENGTH')
    const damaged = patched(await zip([{ path: 'a.json', bytes: text(serializeCanonicalDocument(graph('a', 'A'))) }]), 'central', 16, 1, 4)
    expect(await rejection(() => importLibraryArchive(storage, blob(damaged), { now: NOW, date: DATE }))).toBe('ARCHIVE_CRC')
    expect(await rejection(() => importLibraryArchive(storage, { size: 32 * 1024 * 1024 + 1 } as Blob))).toBe('LIMIT_ARCHIVE_SIZE')
    expect(values.size).toBe(0)
  })

  it('bounds the total decompressed size while inflating', async () => {
    const filler = noise(100_000)
    const files = Array.from({ length: 3 }, (_, index) => ({ path: `f${index}.json`, bytes: filler }))
    const bytes = await zip(files)
    expect(await rejection(() => readLibraryArchive(bytes, { maxDecodedBytes: 250_000 }))).toBe('LIMIT_ARCHIVE_DECODED_SIZE')
    expect((await readLibraryArchive(bytes, { maxDecodedBytes: 300_000 })).skipped).toHaveLength(3)
  })

  it('treats the manifest as a hint only', async () => {
    const document = graph('real', 'Real title')
    const manifest = (value: unknown) => ({ path: ARCHIVE_MANIFEST_PATH, bytes: text(JSON.stringify(value)) })
    // A lying manifest changes neither the name nor the identity; only a plausible date of that very graph is used.
    const lying = await readLibraryArchive(await zip([
      documentFile('x.json', document),
      documentFile('y.json', graph('other', 'Other')),
      manifest({ version: 1, exportedAt: NOW, entries: [
        { path: 'x.json', name: 'Fake', id: 'real', updatedAt: '2020-01-01T00:00:00.000Z' },
        { path: 'y.json', name: 'Fake', id: 'not-it', updatedAt: '2020-01-01T00:00:00.000Z' },
        { path: '../z.json', name: 'Fake', id: 'z', updatedAt: 'never' },
      ] }),
    ]), { now: DATE })
    expect(lying.graphs.map(({ name, document: { id }, updatedAt }) => ({ name, id, updatedAt }))).toEqual([
      { name: 'Real title', id: 'real', updatedAt: '2020-01-01T00:00:00.000Z' },
      { name: 'Other', id: 'other', updatedAt: undefined },
    ])
    expect(lying.warnings).toEqual([])
    const future = await readLibraryArchive(await zip([documentFile('x.json', document),
      manifest({ version: 1, exportedAt: NOW, entries: [{ path: 'x.json', name: 'x', id: 'real', updatedAt: '2999-01-01T00:00:00.000Z' }] })]), { now: DATE })
    expect(future.graphs[0].updatedAt).toBeUndefined()
    // A malformed or oversized manifest never makes a document fail.
    const malformed = await readLibraryArchive(await zip([documentFile('x.json', document), { path: ARCHIVE_MANIFEST_PATH, bytes: text('{') }]))
    expect(malformed.graphs).toHaveLength(1)
    expect(malformed.warnings).toEqual([expect.stringMatching(/^ARCHIVE_MANIFEST_INVALID: /)])
    const oversized = await readLibraryArchive(await zip([documentFile('x.json', document),
      { path: ARCHIVE_MANIFEST_PATH, bytes: text(`"${'x'.repeat(1024 * 1024)}"`) }]))
    expect(oversized.graphs).toHaveLength(1)
    expect(oversized.warnings).toEqual([expect.stringMatching(/^LIMIT_ARCHIVE_MANIFEST_SIZE: /)])
    const missing = await readLibraryArchive(await zip([documentFile('x.json', document)]))
    expect(missing.warnings).toEqual([])
  })

  it('leaves the library as it was when storage fills during the import', async () => {
    const exported = await exportLibraryArchive(library().storage, { now: NOW, date: DATE })
    const { storage, values, state } = memoryStorage()
    saveToLibrary(storage, graph('mine', 'Mine'), 'Mine', { now: NOW, boundId: null })
    const before = new Map(values)
    state.failWrites = (key) => key === LIBRARY_INDEX_KEY
    await expect(importLibraryArchive(storage, blob(exported.bytes), { now: NOW, date: DATE }))
      .rejects.toMatchObject({ code: 'LIBRARY_WRITE_FAILED', message: expect.stringContaining('Nothing was imported') })
    expect(values).toEqual(before)
  })
})
