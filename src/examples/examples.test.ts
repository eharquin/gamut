import { describe, expect, it } from 'vitest'
import { showcaseMetadata } from '../algebra/algebraDefinition'
import { createBuiltinAlgebraRegistry } from '../algebra/builtinAlgebras'
import { requireAvailableAlgebra } from '../application/algebraAvailability'
import { evaluateDocument } from '../application/evaluateDocument'
import {
  CURRENT_FORMAT_VERSION,
  fromCanonicalDocument,
  parseCanonicalDocument,
  serializeCanonicalDocument,
} from '../document/canonicalDocument'
import { showcaseItems, vga2FoundationExampleDocument } from '../document/expressionDocument'
import { readExamples, SHIPPED_EXAMPLES } from '.'

const registry = createBuiltinAlgebraRegistry()
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

  for (const { id, source } of SHIPPED_EXAMPLES) {
    describe(id, () => {
      it('is stored in the current canonical format, byte for byte', () => {
        expect(JSON.parse(source).formatVersion).toBe(CURRENT_FORMAT_VERSION)
        expect(source).toBe(`${serializeCanonicalDocument(parseCanonicalDocument(source))}\n`)
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

  // Until the showcase becomes an example (#217), the first run and the
  // algebra switch still read their own sources; these examples must match.
  it('matches the first-run document and each algebra showcase', () => {
    const items = (id: string) => readExamples().examples.find((example) => example.id === id)!.document
    const vga = items('vga2-rotation')
    const firstRun = vga2FoundationExampleDocument()
    expect(vga.metadata).toEqual({ title: firstRun.title, description: firstRun.description })
    expect(vga.items.map(({ id, source, control }) => ({ id, source, ...(control ? { control } : {}) })))
      .toEqual(firstRun.items)
    for (const definition of registry.definitions()) {
      const example = readExamples().examples.find((candidate) => candidate.algebraId === definition.algebraId)!.document
      expect(example.metadata).toEqual(showcaseMetadata(definition))
      expect(example.view.visualizerId).toBe(definition.standardVisualizerId)
      expect(example.items.map(({ id, source, control }) => ({ id, source, ...(control ? { control } : {}) })))
        .toEqual(showcaseItems(definition.showcase))
    }
  })
})
