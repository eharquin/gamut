/**
 * A minimal `.zip` writer and reader for library archives (STORE-017,
 * STORE-018), on the browser's `deflate-raw` streams already used by scene
 * links, without a compression dependency. The reader treats the archive as
 * untrusted (SEC-010): it validates the directory before any entry is
 * inflated, and inflating is bounded by the caller's limits, never by the
 * sizes the archive declares.
 */

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 2_048
export const MAX_ARCHIVE_PATH_BYTES = 1_024
/** The same expansion bound as scene links. */
export const MAX_ARCHIVE_RATIO = 64

/** Thrown with a diagnostic code when an archive is rejected or cannot be written. */
export class ArchiveError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
  get diagnostic(): string {
    return `${this.code}: ${this.message}`
  }
}

function fail(code: string, message: string): never {
  throw new ArchiveError(code, message)
}

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EXTRA_ID = 0x0001
const FLAG_ENCRYPTED = 0x0001
const FLAG_STRONG_ENCRYPTION = 0x0040
const FLAG_UTF8 = 0x0800
const FLAG_MASKED_DIRECTORY = 0x2000
const METHOD_STORED = 0
const METHOD_DEFLATE = 8
const VERSION = 20

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.byteLength; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function compressionStream(decompress: boolean): ReadableWritablePair<Uint8Array, BufferSource> {
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined')
    fail('ARCHIVE_UNSUPPORTED', 'This browser does not support the compression that library archives need.')
  try {
    return (decompress ? new DecompressionStream('deflate-raw') : new CompressionStream('deflate-raw')) as
      ReadableWritablePair<Uint8Array, BufferSource>
  } catch {
    fail('ARCHIVE_UNSUPPORTED', 'This browser does not support the compression that library archives need.')
  }
}

/** Runs bytes through a `deflate-raw` stream, counting the output against `check` as it arrives. */
async function transform(bytes: Uint8Array, decompress: boolean, check: (length: number) => void): Promise<Uint8Array> {
  const pair = compressionStream(decompress)
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>)
      controller.close()
    },
  })
  const reader = input.pipeThrough(pair).getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      check(length)
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof ArchiveError) throw error
    fail('ARCHIVE_COMPRESSION', 'The archive holds compressed data that is invalid or truncated.')
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export type ZipFile = Readonly<{
  /** Segments joined by `/`; a directory ends with `/` and has no bytes. */
  path: string
  bytes?: Uint8Array
}>

function dosDateTime(date: Date): Readonly<{ time: number; date: number }> {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/**
 * Writes an archive with UTF-8 entry names. An entry is deflated unless that
 * does not shrink it, or shrinks it past the expansion bound the reader
 * enforces; it is stored then, so that an exported archive always imports.
 */
export async function writeZip(files: readonly ZipFile[], modified: Date): Promise<Uint8Array> {
  if (files.length > 0xfffe) fail('LIMIT_ARCHIVE_ENTRIES', 'The archive would hold too many entries.')
  const encoder = new TextEncoder()
  const stamp = dosDateTime(modified)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.path)
    const raw = file.bytes ?? new Uint8Array(0)
    let data = raw
    let method = METHOD_STORED
    if (raw.byteLength > 0) {
      const deflated = await transform(raw, false, () => undefined)
      if (deflated.byteLength < raw.byteLength && raw.byteLength <= deflated.byteLength * MAX_ARCHIVE_RATIO) {
        data = deflated
        method = METHOD_DEFLATE
      }
    }
    const crc = crc32(raw)
    const header = (signature: number, size: number, prefix: number) => {
      const bytes = new Uint8Array(size + name.byteLength)
      const view = new DataView(bytes.buffer)
      view.setUint32(0, signature, true)
      // The central record starts with one more field, "version made by".
      if (prefix > 0) view.setUint16(4, VERSION, true)
      view.setUint16(4 + prefix, VERSION, true)
      view.setUint16(6 + prefix, FLAG_UTF8, true)
      view.setUint16(8 + prefix, method, true)
      view.setUint16(10 + prefix, stamp.time, true)
      view.setUint16(12 + prefix, stamp.date, true)
      view.setUint32(14 + prefix, crc, true)
      view.setUint32(18 + prefix, data.byteLength, true)
      view.setUint32(22 + prefix, raw.byteLength, true)
      view.setUint16(26 + prefix, name.byteLength, true)
      bytes.set(name, size)
      return { bytes, view }
    }
    const local = header(LOCAL_SIGNATURE, 30, 0)
    const record = header(CENTRAL_SIGNATURE, 46, 2)
    record.view.setUint32(42, offset, true)
    parts.push(local.bytes, data)
    central.push(record.bytes)
    offset += local.bytes.byteLength + data.byteLength
    if (offset > 0xfffffffe) fail('LIMIT_ARCHIVE_SIZE', 'The archive would be too large.')
  }
  const centralSize = central.reduce((sum, record) => sum + record.byteLength, 0)
  const end = new Uint8Array(22)
  const view = new DataView(end.buffer)
  view.setUint32(0, END_SIGNATURE, true)
  view.setUint16(8, files.length, true)
  view.setUint16(10, files.length, true)
  view.setUint32(12, centralSize, true)
  view.setUint32(16, offset, true)
  const result = new Uint8Array(offset + centralSize + end.byteLength)
  let position = 0
  for (const part of [...parts, ...central, end]) {
    result.set(part, position)
    position += part.byteLength
  }
  return result
}

export type ZipEntry = Readonly<{
  /** The validated path, without the trailing `/` of a directory. */
  path: string
  segments: readonly string[]
  directory: boolean
  method: number
  crc: number
  compressedSize: number
  declaredSize: number
  dataOffset: number
}>

const INVALID = 'The file is not a valid .zip archive.'
const ZIP64 = 'The archive uses the ZIP64 format, which is not supported.'

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function entrySegments(name: Uint8Array): Readonly<{ segments: string[]; directory: boolean }> {
  if (name.byteLength > MAX_ARCHIVE_PATH_BYTES)
    fail('LIMIT_ARCHIVE_PATH_LENGTH', `An entry path exceeds ${MAX_ARCHIVE_PATH_BYTES} bytes.`)
  let path: string
  try {
    path = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(name)
  } catch {
    fail('ARCHIVE_PATH_ENCODING', 'An entry name is not valid UTF-8.')
  }
  const shown = JSON.stringify(path)
  if (path === '' || path === '/') fail('ARCHIVE_PATH', 'An entry has an empty path.')
  if (path.startsWith('/')) fail('ARCHIVE_PATH', `The entry path ${shown} is absolute.`)
  if (path.includes('\\')) fail('ARCHIVE_PATH', `The entry path ${shown} contains a backslash.`)
  if (hasControlCharacter(path)) fail('ARCHIVE_PATH', `The entry path ${shown} contains a control character.`)
  const directory = path.endsWith('/')
  const segments = (directory ? path.slice(0, -1) : path).normalize('NFC').split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    fail('ARCHIVE_PATH', `The entry path ${shown} contains an empty, “.” or “..” segment.`)
  return { segments, directory }
}

/**
 * Reads and validates the directory of an archive without inflating
 * anything. Every SEC-010 check that does not need the entry data is made
 * here, so a rejected archive supplies no entry at all.
 */
export function openZip(bytes: Uint8Array): ZipEntry[] {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) fail('LIMIT_ARCHIVE_SIZE', 'The archive exceeds 32 MiB.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // The end record is the last one; only an archive comment may follow it.
  let end = -1
  for (let position = bytes.byteLength - 22; position >= Math.max(0, bytes.byteLength - 22 - 0xffff); position -= 1) {
    if (view.getUint32(position, true) === END_SIGNATURE && position + 22 + view.getUint16(position + 20, true) === bytes.byteLength) {
      end = position
      break
    }
  }
  if (end < 0) fail('ARCHIVE_INVALID', INVALID)
  if (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR_SIGNATURE) fail('ARCHIVE_ZIP64', ZIP64)
  const count = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  const centralOffset = view.getUint32(end + 16, true)
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ARCHIVE_ZIP64', ZIP64)
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint16(end + 8, true) !== count)
    fail('ARCHIVE_INVALID', 'The archive is split over several files, which is not supported.')
  if (count > MAX_ARCHIVE_ENTRIES)
    fail('LIMIT_ARCHIVE_ENTRIES', `The archive holds more than ${MAX_ARCHIVE_ENTRIES.toLocaleString('en-US')} entries.`)
  if (centralOffset + centralSize > end) fail('ARCHIVE_INVALID', INVALID)

  const entries: ZipEntry[] = []
  const seen = new Set<string>()
  let position = centralOffset
  for (let index = 0; index < count; index += 1) {
    if (position + 46 > end || view.getUint32(position, true) !== CENTRAL_SIGNATURE) fail('ARCHIVE_INVALID', INVALID)
    const flags = view.getUint16(position + 8, true)
    const method = view.getUint16(position + 10, true)
    const crc = view.getUint32(position + 16, true)
    const compressedSize = view.getUint32(position + 20, true)
    const declaredSize = view.getUint32(position + 24, true)
    const nameLength = view.getUint16(position + 28, true)
    const extraLength = view.getUint16(position + 30, true)
    const commentLength = view.getUint16(position + 32, true)
    const localOffset = view.getUint32(position + 42, true)
    const next = position + 46 + nameLength + extraLength + commentLength
    if (next > end) fail('ARCHIVE_INVALID', INVALID)
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_DIRECTORY))
      fail('ARCHIVE_ENCRYPTED', 'The archive holds an encrypted entry, which is not supported.')
    if (compressedSize === 0xffffffff || declaredSize === 0xffffffff || localOffset === 0xffffffff) fail('ARCHIVE_ZIP64', ZIP64)
    for (let extra = position + 46 + nameLength; extra + 4 <= position + 46 + nameLength + extraLength;) {
      if (view.getUint16(extra, true) === ZIP64_EXTRA_ID) fail('ARCHIVE_ZIP64', ZIP64)
      extra += 4 + view.getUint16(extra + 2, true)
    }
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE)
      fail('ARCHIVE_METHOD', 'The archive uses a compression method other than stored and deflate.')
    const { segments, directory } = entrySegments(bytes.subarray(position + 46, position + 46 + nameLength))
    const path = segments.join('/')
    if (seen.has(path)) fail('ARCHIVE_DUPLICATE_PATH', `The archive holds the path ${JSON.stringify(path)} more than once.`)
    seen.add(path)
    // The local header repeats the name and may carry another extra field.
    if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) fail('ARCHIVE_INVALID', INVALID)
    if (view.getUint16(localOffset + 6, true) & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION))
      fail('ARCHIVE_ENCRYPTED', 'The archive holds an encrypted entry, which is not supported.')
    const dataOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    if (dataOffset + compressedSize > centralOffset) fail('ARCHIVE_INVALID', INVALID)
    if (directory && (compressedSize !== 0 || declaredSize !== 0)) fail('ARCHIVE_INVALID', INVALID)
    if (method === METHOD_STORED && compressedSize !== declaredSize) fail('ARCHIVE_INVALID', INVALID)
    entries.push({ path, segments, directory, method, crc, compressedSize, declaredSize, dataOffset })
    position = next
  }
  return entries
}

/**
 * Inflates one entry. `check` receives the number of decompressed bytes as
 * they arrive and throws to stop at a limit; the expansion ratio and the
 * checksum are verified here.
 */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry, check: (length: number) => void): Promise<Uint8Array> {
  const data = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
  let content: Uint8Array
  if (entry.method === METHOD_STORED) {
    check(data.byteLength)
    content = data
  } else {
    content = await transform(data, true, (length) => {
      if (length > data.byteLength * MAX_ARCHIVE_RATIO)
        fail('LIMIT_DECOMPRESSION_RATIO', `The entry ${JSON.stringify(entry.path)} exceeds the 64:1 decompression limit.`)
      check(length)
    })
  }
  if (content.byteLength !== entry.declaredSize || crc32(content) !== entry.crc)
    fail('ARCHIVE_CRC', `The entry ${JSON.stringify(entry.path)} is damaged: its checksum does not match.`)
  return content
}
