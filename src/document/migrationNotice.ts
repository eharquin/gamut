import { CURRENT_FORMAT_VERSION, type DocumentMigration } from './canonicalDocument'
import { CURRENT_LANGUAGE_VERSION } from '../language/migrateLanguage'

/**
 * What the reader is told when a document written by an earlier GAMUT opens
 * (#343): the versions, the rows the language migration rewrote, and that
 * saving writes the new format. Nothing is written until then.
 */
/** How long a migration notice stays, in milliseconds. */
export const MIGRATION_NOTICE_MS = 12_000

/** Rows named in the notice before the rest are counted. */
const MAX_LISTED = 5

export function migrationNotice(migration: DocumentMigration | null): string | null {
  if (migration === null) return null
  const rows = migration.rewritten
  const shown = rows.length > MAX_LISTED ? [...rows.slice(0, MAX_LISTED), `${rows.length - MAX_LISTED} more`] : rows
  const listed = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
  const rewritten = rows.length === 0
    ? ''
    : ` Rewritten in the current language, where operations such as A.norm are written norm(A): ${listed}.`
  return `This graph was written by an earlier version of GAMUT (format ${migration.formatVersion}, language ${
    migration.languageVersion}) and opened as format ${CURRENT_FORMAT_VERSION}, language ${CURRENT_LANGUAGE_VERSION}.${
    rewritten} Saving it writes the new format.`
}
