// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentFormatError, serializeCanonicalDocument, toCanonicalDocument } from './canonicalDocument'
import { documentFileDiagnostic, documentFileName, readDocumentFile } from './documentFile'
import { expressionDocument } from './expressionDocument'

describe('document files', () => {
  it('names an exported file after the document title', () => {
    expect(documentFileName('VGA 2D Rotation Example')).toBe('VGA-2D-Rotation-Example.gamut.json')
    expect(documentFileName('  Scène ∧ Δ  ')).toBe('Sc-ne.gamut.json')
    expect(documentFileName('')).toBe('gamut-document.gamut.json')
    expect(documentFileName('∧∧')).toBe('gamut-document.gamut.json')
  })

  it('reads a document file into its canonical form', async () => {
    const canonical = toCanonicalDocument(expressionDocument([
      { id: 'point', source: 'V = vector(2, 3)' },
    ], {}, { id: 'file-document', title: 'File' }), 'dark')
    const file = new Blob([serializeCanonicalDocument(canonical)])
    expect(await readDocumentFile(file)).toEqual(canonical)
    await expect(readDocumentFile(new Blob(['not json']))).rejects.toBeInstanceOf(DocumentFormatError)
  })

  it('reports format errors by code and other failures by the fallback', () => {
    expect(documentFileDiagnostic(new DocumentFormatError('DOCUMENT_JSON_INVALID', 'Bad JSON.'), 'FALLBACK'))
      .toBe('DOCUMENT_JSON_INVALID: Bad JSON.')
    expect(documentFileDiagnostic(new Error('boom'), 'FALLBACK')).toBe('FALLBACK')
  })
})
