import { describe, expect, it } from 'vitest'
import { evaluateDocument } from '../application/evaluateDocument'
import type { EvaluationState } from '../application/evaluateSource'
import { expressionDocument } from '../document/expressionDocument'
import { MAX_REFERENCE_EXAMPLES, STYLE_REFERENCE, type ReferenceEntry } from '../language/expressionReference'
import { createBuiltinAlgebraRegistry } from './builtinAlgebras'

const registry = createBuiltinAlgebraRegistry()

function describeState(state: EvaluationState | null): string {
  if (state === null) return 'no value'
  return state.status === 'valid' ? state.inspection : `invalid: ${state.diagnostic.message}`
}

/** Evaluates an entry's examples as one document of the definition's algebra. */
function evaluateEntry(algebraId: string, entry: ReferenceEntry) {
  const definition = registry.definitions().find((candidate) => candidate.algebraId === algebraId)!
  const validation = definition.validateParameters({})
  if (validation.status !== 'valid') throw new Error('invalid default parameters')
  const algebra = {
    algebraId,
    definitionVersion: definition.definitionVersion,
    conventionVersion: definition.conventionVersions[definition.conventionVersions.length - 1],
    parameters: validation.parameters,
  }
  const resolution = registry.resolve(algebra)
  const interpretation = registry.resolveInterpretation({
    interpretationId: definition.standardInterpretationId, interpretationVersion: 1,
  })
  if (resolution.status !== 'resolved' || interpretation.status !== 'resolved') throw new Error('unresolved')
  const document = {
    ...expressionDocument(entry.examples.map((example, index) => ({
      id: `example-${index}`,
      source: example.source,
      ...(example.positionSource === undefined ? {} : { positionSource: example.positionSource }),
    }))),
    algebra,
  }
  return evaluateDocument(document, { engine: resolution.engine, interpretation: interpretation.interpretation })
}

describe('expression reference', () => {
  for (const definition of registry.definitions()) {
    describe(definition.badge, () => {
      // Both categories: the general expressions and those of this algebra.
      const allSections = [...definition.generalReference, ...definition.expressionReference]
      const entries = allSections.flatMap((section) =>
        section.entries.map((entry) => [section.title, entry] as const))

      it.each(entries.map(([title, entry]) => [`${title}: ${entry.syntax}`, entry] as const))(
        '%s evaluates as documented',
        (_, entry) => {
          expect(entry.examples.length).toBeGreaterThan(0)
          const evaluated = evaluateEntry(definition.algebraId, entry)
          entry.examples.forEach((example, index) => {
            const { evaluation, positionEvaluation } = evaluated[index]
            const label = `${example.source}${example.positionSource ? ` @ ${example.positionSource}` : ''}`
            expect(evaluation?.status, `${label}: ${describeState(evaluation)}`).toBe('valid')
            if (example.inspection !== undefined)
              expect(describeState(evaluation), label).toBe(example.inspection)
            if (example.positionSource !== undefined && example.positionSource.trim() !== '') {
              expect(positionEvaluation?.status, `${label}: ${describeState(positionEvaluation)}`)
                .toBe(example.positionInvalid ? 'invalid' : 'valid')
            }
          })
        },
      )

      it('keeps every entry to one short line and at most two examples', () => {
        for (const section of allSections) {
          for (const entry of section.entries) {
            expect(entry.examples.length, entry.syntax).toBeLessThanOrEqual(MAX_REFERENCE_EXAMPLES)
            expect(entry.meaning, entry.syntax).not.toMatch(/;/)
            expect(entry.meaning.length, entry.syntax).toBeLessThanOrEqual(90)
          }
        }
      })

      it('supplies its own Algebra section, ending with normalization, without default colors', () => {
        const topics = definition.algebraReference
        expect(topics.length).toBeGreaterThan(1)
        expect(topics.at(-1)).toMatchObject({ name: 'Normalization', syntax: 'norm button' })
        const text = topics.map(({ name, syntax, meaning }) => `${name} ${syntax} ${meaning ?? ''}`).join('\n')
        expect(text).not.toMatch(/colou?r|#[0-9a-f]{3,6}\b|green|yellow|red|blue|neutral/i)
      })

      it('has unique section titles and entries, and keeps general expressions out of the algebra sections', () => {
        for (const category of [definition.generalReference, definition.expressionReference]) {
          const titles = category.map((section) => section.title)
          expect(new Set(titles).size).toBe(titles.length)
        }
        for (const section of allSections) {
          const syntax = section.entries.map((entry) => entry.syntax)
          expect(new Set(syntax).size, section.title).toBe(syntax.length)
        }
        // The algebra's own sections never repeat a general expression.
        const general = new Set(definition.generalReference.flatMap((section) => section.entries.map((entry) => entry.syntax)))
        const repeated = definition.expressionReference.flatMap((section) => section.entries)
          .filter((entry) => general.has(entry.syntax)).map((entry) => entry.syntax)
        expect(repeated).toEqual([])
      })
    })
  }

  it('shares the general expressions: same syntax and meaning in every algebra', () => {
    const general = registry.definitions().map((definition) => definition.generalReference
      .flatMap((section) => section.entries.map((entry) => `${section.title} | ${entry.syntax} | ${entry.meaning}`)))
    for (const other of general.slice(1)) expect(other).toEqual(general[0])
    expect(general[0].length).toBeGreaterThan(20)
  })

  it('documents the PGA(2) constructors, blades, norms, and motor functions without VGA-only syntax', () => {
    const pga = registry.definitions().find((definition) => definition.algebraId === 'org.multivector.pga')!
    const syntax = pga.expressionReference.flatMap((section) => section.entries.map((entry) => entry.syntax))
    expect(syntax).toEqual(expect.arrayContaining([
      'point(x, y)', 'point(x, y, w)', 'ipoint(x, y)', 'line(a, b, c)',
      'e0, e1, e2, e01, e02, e12, e012', 'e0 * e0',
      'A.norm', 'A.inorm', 'A.e, A.e0, A.e1, A.e2, A.e01, A.e02, A.e12, A.e012',
      'log(M), sqrt(M)', 'I.head', 'position point(x, y)',
    ]))
    const text = pga.expressionReference
      .flatMap((section) => section.entries.map((entry) => `${entry.syntax} ${entry.meaning}`)).join('\n')
    expect(text).not.toMatch(/VGA|vector\(|\(2, 1\)|V\.head|bivector row/)
  })

  it('names the primitives and normalization choices of each algebra', () => {
    const topics = (algebraId: string) => registry.definitions()
      .find((definition) => definition.algebraId === algebraId)!.algebraReference
    expect(topics('org.multivector.vga').map((topic) => topic.name)).toEqual([
      'Scalar', 'Vector', 'Bivector', 'Rotor', 'Mixed multivector', 'List', 'Normalization',
    ])
    expect(topics('org.multivector.vga').at(-1)?.meaning).toBe('off · auto')
    expect(topics('org.multivector.pga').map((topic) => topic.name)).toEqual([
      'Point', 'Ideal point', 'Line', 'Line at infinity', 'Translator', 'Motor', 'Reflection', 'List', 'Normalization',
    ])
    expect(topics('org.multivector.pga').find((topic) => topic.name === 'Line')?.syntax).toBe('line(a, b, c), A & B')
    expect(topics('org.multivector.pga').at(-1)?.meaning).toBe('off · auto · norm · inorm')
  })

  it('lists only the values of each style setting', () => {
    expect(STYLE_REFERENCE.map((topic) => topic.name)).toEqual([
      'Color', 'Opacity', 'Stroke', 'Point', 'Label', 'Visibility', 'Values',
    ])
    expect(STYLE_REFERENCE.every((topic) => topic.meaning === undefined)).toBe(true)
  })
})
