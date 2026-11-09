import { describe, expect, it } from 'vitest'
import { selectDroppedDocument } from './droppedDocument'

const file = (name: string, type = '') => new File(['{}'], name, { type })

describe('dropped document selection', () => {
  it('ignores a drop that carries no file', () => {
    expect(selectDroppedDocument([])).toEqual({ status: 'ignored' })
  })

  it('accepts one current, historical, or plain JSON document, or a JSON media type', () => {
    for (const dropped of [file('scene.gamut.json'), file('old.multivector.json'), file('SCENE.JSON'), file('export', 'application/json')])
      expect(selectDroppedDocument([dropped])).toEqual({ status: 'file', file: dropped })
  })

  it('rejects several files and a file that is not JSON', () => {
    const several = selectDroppedDocument([file('a.json'), file('b.json')])
    expect(several).toEqual({ status: 'rejected', diagnostic: expect.stringMatching(/^DOCUMENT_DROP_MULTIPLE: 2 files were dropped/) })
    const image = selectDroppedDocument([file('picture.png', 'image/png')])
    expect(image).toEqual({ status: 'rejected', diagnostic: expect.stringMatching(/^DOCUMENT_DROP_TYPE: “picture.png” is not a JSON document/) })
  })
})
