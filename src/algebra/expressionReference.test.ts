import { describe, expect, it } from 'vitest'
import { evaluateDocument } from '../application/evaluateDocument'
import type { EvaluationState } from '../application/evaluateSource'
import { expressionDocument } from '../document/expressionDocument'
import type { ReferenceEntry } from '../language/expressionReference'
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
      const entries = definition.expressionReference.flatMap((section) =>
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

      it('has unique section titles and entry syntax', () => {
        const titles = definition.expressionReference.map((section) => section.title)
        expect(new Set(titles).size).toBe(titles.length)
        for (const section of definition.expressionReference) {
          const syntax = section.entries.map((entry) => entry.syntax)
          expect(new Set(syntax).size, section.title).toBe(syntax.length)
        }
      })
    })
  }

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
})
