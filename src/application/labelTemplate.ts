import type { LanguageValue } from '../domain/languageValue'
import type { SourceValueState } from './evaluateScalarControl'

/**
 * A label's text, split into literal text and inserted expressions:
 * `A = ${t}` shows the value of `t`. `$` is reserved for inline math, which
 * may come later; `\$` writes a dollar sign.
 */
export type LabelTemplatePart =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'expression'; source: string }>

export type ParsedLabelTemplate = Readonly<{
  parts: readonly LabelTemplatePart[]
  /** Why the text is not read as written: an unclosed `${`, or a lone `$`. */
  problems: readonly string[]
}>

export const UNCLOSED_INSERTION = 'A “${” is not closed by “}”.'
export const RESERVED_DOLLAR = '“$” is reserved for inline math; write “\\$” for a dollar sign.'
export const EMPTY_INSERTION = 'A “${}” holds no expression.'

/** Whether a label text needs reading as a template; most labels are plain text. */
export const isLabelTemplate = (text: string) => text.includes('$')

export function parseLabelTemplate(text: string): ParsedLabelTemplate {
  const parts: LabelTemplatePart[] = []
  const problems = new Set<string>()
  let literal = ''
  const flush = () => {
    if (literal) parts.push({ kind: 'text', text: literal })
    literal = ''
  }
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '\\' && text[index + 1] === '$') {
      literal += '$'
      index += 2
      continue
    }
    if (character === '$' && text[index + 1] === '{') {
      // The expression ends at the brace that closes the opening one.
      let depth = 1
      let end = index + 2
      for (; end < text.length && depth > 0; end++) {
        if (text[end] === '{') depth++
        else if (text[end] === '}') depth--
      }
      if (depth > 0) {
        problems.add(UNCLOSED_INSERTION)
        literal += text.slice(index)
        break
      }
      const source = text.slice(index + 2, end - 1)
      if (source.trim() === '') {
        problems.add(EMPTY_INSERTION)
      } else {
        flush()
        parts.push({ kind: 'expression', source })
      }
      index = end
      continue
    }
    if (character === '$') problems.add(RESERVED_DOLLAR)
    literal += character
    index++
  }
  flush()
  return { parts, problems: [...problems] }
}

/** The text a label shows, and what went wrong while making it. */
export type LabelTextResult = Readonly<{ text: string; error: string | null }>

/**
 * Replaces each `${expression}` with its formatted value. An expression that
 * cannot be evaluated shows “?” and says why; the rest of the label is kept.
 */
export function resolveLabelTemplate(
  text: string,
  evaluate: (source: string) => SourceValueState,
  format: (value: LanguageValue) => string,
): LabelTextResult {
  const { parts, problems } = parseLabelTemplate(text)
  const errors = [...problems]
  const shown = parts.map((part) => {
    if (part.kind === 'text') return part.text
    const result = evaluate(part.source)
    if (result.status === 'valid') return format(result.value)
    errors.push(`\${${part.source.trim()}}: ${result.diagnostic.message}`)
    return '?'
  }).join('')
  return { text: shown, error: errors.length > 0 ? errors.join(' ') : null }
}
