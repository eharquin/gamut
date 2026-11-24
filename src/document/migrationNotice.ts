import { CURRENT_FORMAT_VERSION, type DocumentMigration } from './canonicalDocument'
import { CURRENT_LANGUAGE_VERSION } from '../language/migrateLanguage'

/**
 * What the reader is told when a document written by an earlier GAMUT opens
 * (#343): the versions, the rows the language migration rewrote, and that
 * saving writes the new format. Nothing is written until then.
 */
export function migrationNotice(migration: DocumentMigration | null): string | null {
  if (migration === null) return null
  const rows = migration.rewrittenRows
  const rewritten = rows === 0
    ? ''
    : ` ${rows} ${rows === 1 ? 'row was' : 'rows were'} rewritten in the current language, such as norm(A) for A.norm.`
  return `This graph was written by an earlier version of GAMUT (format ${migration.formatVersion}, language ${
    migration.languageVersion}) and opened as format ${CURRENT_FORMAT_VERSION}, language ${CURRENT_LANGUAGE_VERSION}.${
    rewritten} Saving it writes the new format.`
}
