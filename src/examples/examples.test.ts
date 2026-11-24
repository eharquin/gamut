import { describe, expect, it } from 'vitest'
import { createBuiltinAlgebraRegistry } from '../algebra/builtinAlgebras'
import { requireAvailableAlgebra } from '../application/algebraAvailability'
import { evaluateDocument } from '../application/evaluateDocument'
import {
  CURRENT_FORMAT_VERSION,
  fromCanonicalDocument,
  parseCanonicalDocument,
  serializeCanonicalDocument,
} from '../document/canonicalDocument'
import { CURRENT_LANGUAGE_VERSION, migrateSourceToVersion2 } from '../language/migrateLanguage'
import { readExamples, SHIPPED_EXAMPLES } from '.'

const registry = createBuiltinAlgebraRegistry()
const REGENERATE = 'Run `npm run examples:regenerate` to rewrite the examples in the current canonical format.'
const restoreOptions = {
  visualizerAvailable: (visualizerId: string) => registry.resolveVisualizer(visualizerId) !== null,
}

describe('shipped examples (#266, STORE-015)', () => {
  it('lists every shipped example, with unique identities', () => {
    const { examples, diagnostic } = readExamples()
    expect(diagnostic).toBeNull()
    expect(examples.map((example) => example.id)).toEqual(SHIPPED_EXAMPLES.map((example) => example.id))
    expect(new Set(examples.map((example) => example.document.id)).size).toBe(examples.length)
  })

  it('isolates an unreadable example with a diagnostic and keeps the others', () => {
    const read = readExamples([
      { id: 'broken', source: '{"formatVersion": 7' },
      SHIPPED_EXAMPLES[0],
    ])
    expect(read.examples.map((example) => example.id)).toEqual([SHIPPED_EXAMPLES[0].id])
    expect(read.diagnostic).toBe('EXAMPLE_INVALID: broken could not be read.')
    // The shipped examples are read on their own, and not replaced by that read.
    expect(readExamples().diagnostic).toBeNull()
  })

  it('migrates the language version 1 sources of 0.3.0 to the shipped ones (#342)', () => {
    // Every source of the 0.3.0 examples that used a removed property.
    const sources = SHIPPED_EXAMPLES.flatMap(({ source }) =>
      (JSON.parse(source).items as { source: string }[]).map((item) => item.source))
    for (const [version1, version2] of [
      ['AB = (B & A) / (B & A).norm', 'AB = (B & A) / norm(B & A)'],
      ['BC = (C & B) / (C & B).norm', 'BC = (C & B) / norm(C & B)'],
      ['CA = (C & A) / (C & A).norm', 'CA = (C & A) / norm(C & A)'],
      ['dAB = (A & B).norm', 'dAB = norm(A & B)'],
      ['dBC = (B & C).norm', 'dBC = norm(B & C)'],
      ['dCA = (C & A).norm', 'dCA = norm(C & A)'],
      ['dB = (B & CA).norm', 'dB = norm(B & CA)'],
      ['a = line(0.5, 1, 1.5) / line(0.5, 1, 1.5).norm', 'a = line(0.5, 1, 1.5) / norm(line(0.5, 1, 1.5))'],
      ['b = line(1.4, 0.8, 2.5) / line(1.4, 0.8, 2.5).norm', 'b = line(1.4, 0.8, 2.5) / norm(line(1.4, 0.8, 2.5))'],
      ['hC = (L ^ C).e012 / L.norm', 'hC = (L ^ C).e012 / norm(L)'],
      ['R = sqrt(M * L / (M.norm * L.norm))', 'R = sqrt(M * L / (norm(M) * norm(L)))'],
    ]) {
      expect(migrateSourceToVersion2(version1)).toBe(version2)
      expect(sources).toContain(version2)
    }
    // No other source changes, and none keeps a removed property.
    for (const source of sources) expect(migrateSourceToVersion2(source)).toBe(source)
  })

  for (const { id, source } of SHIPPED_EXAMPLES) {
    describe(id, () => {
      it('is stored in the current canonical format, byte for byte', () => {
        expect(JSON.parse(source).formatVersion, REGENERATE).toBe(CURRENT_FORMAT_VERSION)
        expect(JSON.parse(source).languageVersion, REGENERATE).toBe(CURRENT_LANGUAGE_VERSION)
        expect(source, REGENERATE).toBe(`${serializeCanonicalDocument(parseCanonicalDocument(source))}\n`)
      })

      it('opens and evaluates without diagnostics', () => {
        const restored = fromCanonicalDocument(parseCanonicalDocument(source), restoreOptions)
        expect(restored.recoveryDiagnostic).toBeNull()
        expect(() => requireAvailableAlgebra(registry, restored.document.algebra)).not.toThrow()
        const resolution = registry.resolve(restored.document.algebra)
        const interpretation = registry.resolveInterpretation(restored.document.interpretation)
        if (resolution.status !== 'resolved' || interpretation.status !== 'resolved') throw new Error('unresolved')
        const evaluated = evaluateDocument(restored.document, {
          engine: resolution.engine,
          interpretation: interpretation.interpretation,
        })
        expect(evaluated.length).toBeGreaterThan(0)
        const failing = evaluated.filter((item) =>
          item.item.kind !== 'annotation' &&
          (item.evaluation?.status !== 'valid' || (item.positionEvaluation && item.positionEvaluation.status !== 'valid')))
        expect(failing.map((item) => item.item.source)).toEqual([])
      })
    })
  }

  // Each algebra opens its showcase example on a first run and on a switch (#217).
  it('ships the showcase example of every algebra, in that algebra and its standard view', () => {
    for (const definition of registry.definitions()) {
      const example = readExamples().examples.find((candidate) => candidate.id === definition.showcaseExampleId)
      expect(example, definition.algebraId).toBeDefined()
      expect(example!.algebraId).toBe(definition.algebraId)
      expect(example!.document.view.visualizerId).toBe(definition.standardVisualizerId)
      expect(example!.document.interpretation?.interpretationId).toBe(definition.standardInterpretationId)
    }
  })
})
