import { describe, expect, it } from 'vitest'
import { directPositionAnchorReference } from './directVectorEdit'

describe('direct position anchors', () => {
  it('recognizes only explicit position anchor references', () => {
    expect(directPositionAnchorReference('V.position')).toEqual({
      name: 'V', property: 'position',
    })
    expect(directPositionAnchorReference('V.head')).toEqual({
      name: 'V', property: 'head',
    })
    expect(directPositionAnchorReference('V')).toBeNull()
    expect(directPositionAnchorReference('(1, 2)')).toBeNull()
  })
})
