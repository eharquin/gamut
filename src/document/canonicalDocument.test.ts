import { describe, expect, it } from 'vitest'
import { executeDocumentCommand } from './documentCommands'
import { expressionDocument } from './expressionDocument'
import {
  fromCanonicalDocument,
  parseCanonicalDocument,
  parseCanonicalDocumentBytes,
  serializeCanonicalDocument,
  toCanonicalDocument,
  resolveCanonicalImport,
  type CanonicalDocument,
} from './canonicalDocument'

function sample() {
  return toCanonicalDocument(
    expressionDocument(
      [{ id: 'v', source: 'V = vector(2, 1)', positionSource: '(1, 1)', normalization: 'natural' }],
      { v: { visible: false, labelVisible: true, label: 'V', style: 'yellow-4' } },
      { id: 'doc-1', title: 'Vectors', description: 'A test document' },
    ),
    'dark',
  )
}

/** The canonical appearance of a new object with no stored setting. */
const DEFAULT_V7_APPEARANCE = {
  visible: true, labelVisible: false, label: '', style: 'blue-4', borderVisible: false,
  orientationVisible: true, bivectorShape: 'from-vectors', idealPointDisplay: 'vector',
  strokeStyle: 'solid', strokeWidthSource: '', pointStyle: 'dot', pointSizeSource: '',
  opacitySource: '', labelAngleSource: '', labelSizeSource: '', labelDistanceSource: '',
  labelAnchor: 'auto',
  primitiveStyles: {
    points: { visible: true, pointStyle: 'dot', pointSizeSource: '', connection: 'none', strokeStyle: 'solid', strokeWidthSource: '' },
    lines: { visible: true, strokeStyle: 'solid', strokeWidthSource: '', orientationVisible: true },
  },
} as const

/**
 * The same document in format version 6, the input of the migration tests:
 * no version 7 appearance fields, and the list settings at the top level.
 */
function version6(document: CanonicalDocument) {
  return {
    ...document,
    formatVersion: 6,
    appearance: Object.fromEntries(Object.entries(document.appearance).map(([id, entry]) => {
      const {
        strokeStyle: _strokeStyle, strokeWidthSource: _strokeWidthSource, pointStyle: _pointStyle,
        pointSizeSource: _pointSizeSource, opacitySource: _opacitySource, labelAngleSource: _labelAngleSource,
        labelSizeSource: _labelSizeSource, labelDistanceSource: _labelDistanceSource, labelAnchor: _labelAnchor,
        primitiveStyles, ...rest
      } = entry
      return [id, { ...rest, pointListDisplay: primitiveStyles.points.connection, pointMarkersVisible: primitiveStyles.points.visible }]
    })),
  }
}

describe('canonical document format', () => {
  const errorCode = (action: () => unknown) => {
    try { action() } catch (error) { return (error as { code?: string }).code }
    return undefined
  }
  it('is byte-stable, whitespace-free, sorted, and has no trailing newline', () => {
    const encoded = serializeCanonicalDocument(sample())
    expect(encoded.endsWith('\n')).toBe(false)
    expect(encoded.startsWith('{"algebra":')).toBe(true)
    expect(serializeCanonicalDocument(parseCanonicalDocument(encoded))).toBe(encoded)
  })

  it('applies positions whenever a visualizer draws the document (NoViz alone turns them off)', () => {
    const canonical = parseCanonicalDocument(serializeCanonicalDocument(sample()))
    const off = { ...canonical, view: { ...canonical.view, positionEnabled: false } }
    expect(fromCanonicalDocument(off).document.view.positionEnabled).toBe(true)
    const noViz = { ...off, view: { ...off.view, visualizerId: null, viewport: { kind: 'none' as const } } }
    expect(fromCanonicalDocument(noViz).document.view.positionEnabled).toBe(false)
  })

  it('round-trips source, position, normalization, appearance, identity, and theme', () => {
    const canonical = parseCanonicalDocument(serializeCanonicalDocument(sample()))
    const restored = fromCanonicalDocument(canonical)
    expect(restored.theme).toBe('dark')
    expect(restored.document).toEqual(expect.objectContaining({
      id: 'doc-1',
      title: 'Vectors',
      description: 'A test document',
      items: [{ id: 'v', source: 'V = vector(2, 1)', positionSource: '(1, 1)', normalization: 'natural' }],
      appearance: { v: { ...DEFAULT_V7_APPEARANCE, visible: false, labelVisible: true, label: 'V', style: 'yellow-4' } },
    }))
  })

  it('round-trips annotation prose without assigning executable fields', () => {
    const document = sample()
    const annotation = {
      ...document,
      items: [{
        id: 'note', kind: 'annotation' as const, source: 'Let V be arbitrary. {not syntax}',
        positionSource: null, normalization: null, control: null,
      }],
      appearance: {
        note: { ...DEFAULT_V7_APPEARANCE, style: 'neutral-4' },
      },
    }
    const encoded = serializeCanonicalDocument(annotation)
    const restored = fromCanonicalDocument(parseCanonicalDocument(encoded))
    expect(restored.document.items).toEqual([{
      id: 'note', kind: 'annotation', source: 'Let V be arbitrary. {not syntax}',
    }])
    expect(serializeCanonicalDocument(toCanonicalDocument(restored.document, restored.theme)))
      .toBe(encoded)
  })

  it('exports object labels as hidden when no appearance override exists', () => {
    const document = expressionDocument([{ id: 'v', source: 'V = e1' }])

    expect(toCanonicalDocument(document, 'system').appearance.v.labelVisible).toBe(false)
  })

  it('migrates version one appearances to borderless version three records with orientation', () => {
    const current = version6(sample())
    const legacy = {
      ...current,
      formatVersion: 1,
      appearance: Object.fromEntries(Object.entries(current.appearance).map(
        ([id, appearance]) => {
          const {
            pointListDisplay: _pointListDisplay,
            pointMarkersVisible: _pointMarkersVisible,
            borderVisible: _borderVisible,
            orientationVisible: _orientationVisible,
            bivectorShape: _bivectorShape,
            ...versionOne
          } = appearance
          return [id, versionOne]
        },
      )),
    }
    const migrated = parseCanonicalDocument(JSON.stringify(legacy))
    expect(migrated.formatVersion).toBe(7)
    expect(migrated.appearance.v.borderVisible).toBe(false)
    expect(migrated.appearance.v.orientationVisible).toBe(true)
    expect(migrated.appearance.v.bivectorShape).toBe('from-vectors')
  })

  it('migrates version three documents to version four, defaulting to showing residue', () => {
    const current = version6(sample())
    const { showApproximatedResidue: _showApproximatedResidue, ...legacyDisplay } = current.view.display
    const legacy = {
      ...current,
      formatVersion: 3,
      view: { ...current.view, display: legacyDisplay },
    }
    const migrated = parseCanonicalDocument(JSON.stringify(legacy))
    expect(migrated.formatVersion).toBe(7)
    // Preserves the pre-existing document's prior appearance: version 3 had
    // no toggle, so it always behaved as if residue were shown.
    expect(migrated.view.display.showApproximatedResidue).toBe(true)
  })

  it('migrates version four documents to version five, drawing ideal points as arrows', () => {
    const current = version6(sample())
    const legacy = {
      ...current,
      formatVersion: 4,
      appearance: Object.fromEntries(Object.entries(current.appearance).map(([id, entry]) => {
        const { idealPointDisplay: _idealPointDisplay, pointListDisplay: _pointListDisplay, pointMarkersVisible: _pointMarkersVisible, ...rest } = entry
        return [id, rest]
      })),
    }
    const migrated = parseCanonicalDocument(JSON.stringify(legacy))
    expect(migrated.formatVersion).toBe(7)
    expect(migrated.appearance.v.idealPointDisplay).toBe('vector')
    expect(migrated.appearance.v.primitiveStyles.points.connection).toBe('none')
    expect(errorCode(() => parseCanonicalDocument(JSON.stringify({
      ...current, appearance: { v: { ...current.appearance.v, idealPointDisplay: 'arrow' } },
    })))).toBe('DOCUMENT_SCHEMA')
  })

  it('migrates version five documents to version six, drawing point lists as markers', () => {
    const current = version6(sample())
    const legacy = {
      ...current,
      formatVersion: 5,
      appearance: Object.fromEntries(Object.entries(current.appearance).map(([id, entry]) => {
        const { pointListDisplay: _pointListDisplay, pointMarkersVisible: _pointMarkersVisible, ...rest } = entry
        return [id, rest]
      })),
    }
    const migrated = parseCanonicalDocument(JSON.stringify(legacy))
    expect(migrated.formatVersion).toBe(7)
    expect(migrated.appearance.v.primitiveStyles.points.connection).toBe('none')
    expect(migrated.appearance.v.primitiveStyles.points.visible).toBe(true)
    expect(errorCode(() => parseCanonicalDocument(JSON.stringify({
      ...current, appearance: { v: { ...current.appearance.v, pointListDisplay: 'polygon' } },
    })))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(() => parseCanonicalDocument(JSON.stringify({
      ...current, appearance: { v: { ...current.appearance.v, pointMarkersVisible: 'no' } },
    })))).toBe('DOCUMENT_SCHEMA')
  })

  it('round-trips every point-list display and marker visibility', () => {
    for (const connection of ['none', 'open-polyline', 'closed-loop'] as const) {
      const document = expressionDocument(
        [{ id: 'p', source: 'P = [e1, e2]' }],
        { p: { visible: true, labelVisible: false, label: '', style: 'blue-4', primitiveStyles: { points: { connection, visible: false } } } },
      )
      const encoded = serializeCanonicalDocument(toCanonicalDocument(document, 'system'))
      const restored = fromCanonicalDocument(parseCanonicalDocument(encoded))
      expect(restored.document.appearance.p.primitiveStyles?.points?.connection).toBe(connection)
      expect(restored.document.appearance.p.primitiveStyles?.points?.visible).toBe(false)
    }
  })

  it('round-trips showApproximatedResidue and validates its type', () => {
    const encoded = serializeCanonicalDocument(sample())
    expect(parseCanonicalDocument(encoded).view.display.showApproximatedResidue).toBe(false)

    const invalid = {
      ...sample(),
      view: { ...sample().view, display: { ...sample().view.display, showApproximatedResidue: 'yes' } },
    }
    expect(errorCode(() => serializeCanonicalDocument(invalid as never))).toBe('DOCUMENT_SCHEMA')
  })

  it('rejects duplicate keys before schema validation', () => {
    expect(errorCode(() => parseCanonicalDocument('{"id":"a","id":"b"}'))).toBe('DOCUMENT_DUPLICATE_KEY')
  })

  it('selects the version boundary before complete schema validation', () => {
    expect(errorCode(() => parseCanonicalDocument('{"formatVersion":8,"future":true}'))).toBe('DOCUMENT_FORMAT_VERSION')
  })

  it('rejects unknown fields and unregistered styles', () => {
    const withUnknown = { ...sample(), extra: true }
    expect(errorCode(() => serializeCanonicalDocument(withUnknown as never))).toBe('DOCUMENT_UNKNOWN_FIELD')
    const invalidStyle = { ...sample(), appearance: { v: { ...sample().appearance.v, style: 'purple-9' } } }
    expect(errorCode(() => serializeCanonicalDocument(invalidStyle))).toBe('DOCUMENT_STYLE')
  })

  it('normalizes negative zero during canonicalization', () => {
    const document = { ...sample(), view: { ...sample().view, viewport: { ...sample().view.viewport, centerX: -0 } } }
    expect(serializeCanonicalDocument(document)).toContain('"centerX":0')
  })

  it('orders even integer-like object keys by Unicode code point', () => {
    const document = {
      ...sample(),
      algebra: { ...sample().algebra, parameters: { '2': 0, '10': 0 } },
    }
    expect(serializeCanonicalDocument(document)).toContain('"parameters":{"10":0,"2":0}')
  })

  it('preserves reserved numeric-control and view configuration records', () => {
    const document = sample()
    const configured = {
      ...document,
      items: [{
        ...document.items[0],
        control: {
          mode: 'slider' as const,
          minimumSource: '-2',
          maximumSource: '2',
          stepSource: '0.1',
          animation: {
            mode: 'ping-pong' as const,
            direction: 'forward' as const,
            durationSeconds: 3,
          },
        },
      }],
      view: {
        ...document.view,
        viewport: { ...document.view.viewport, centerX: 4, zoom: 90 },
      },
    }
    const encoded = serializeCanonicalDocument(configured)
    expect(serializeCanonicalDocument(toCanonicalDocument(
      fromCanonicalDocument(parseCanonicalDocument(encoded)).document,
      'dark',
    ))).toBe(encoded)
  })

  it('rejects malformed UTF-8 and a byte-order mark at the byte boundary', () => {
    expect(errorCode(() => parseCanonicalDocumentBytes(new Uint8Array([0xc3, 0x28])))).toBe('DOCUMENT_UTF8')
    expect(errorCode(() => parseCanonicalDocumentBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])))).toBe('DOCUMENT_BOM')
  })

  it('accepts and byte-stably round-trips the closed none viewport', () => {
    const document = sample()
    const withoutViewport = {
      ...document,
      interpretation: null,
      view: {
        ...document.view,
        visualizerId: null,
        positionEnabled: false,
        viewport: { kind: 'none' as const },
      },
    }
    const encoded = serializeCanonicalDocument(withoutViewport)
    expect(serializeCanonicalDocument(parseCanonicalDocument(encoded))).toBe(encoded)
    expect(fromCanonicalDocument(parseCanonicalDocument(encoded)).document.view.viewport)
      .toEqual({ kind: 'none' })
  })

  it('reports malformed and unknown closed viewport variants precisely', () => {
    const document = sample()
    expect(errorCode(() => serializeCanonicalDocument({
      ...document,
      view: { ...document.view, viewport: { kind: 'three-dimensional' } },
    } as never))).toBe('DOCUMENT_VIEWPORT')
    expect(errorCode(() => serializeCanonicalDocument({
      ...document,
      view: { ...document.view, viewport: { kind: 'none', zoom: 2 } },
    } as never))).toBe('DOCUMENT_UNKNOWN_FIELD')
  })

  it('preserves unsupported view combinations with a recovery diagnostic', () => {
    const document = sample()
    const unsupported = {
      ...document,
      view: { ...document.view, visualizerId: 'org.example.future-view' },
    }
    const restored = fromCanonicalDocument(parseCanonicalDocument(
      serializeCanonicalDocument(unsupported),
    ))
    expect(restored.document.view.visualizerId).toBe('org.example.future-view')
    expect(restored.recoveryDiagnostic).toMatch(/^DOCUMENT_VIEW_UNSUPPORTED:/)
  })

  it('duplicates identity collisions with fresh document and item identities', () => {
    const ids = ['new-document', 'new-item']
    const original = sample()
    const duplicated = resolveCanonicalImport('doc-1', original, 'duplicate', () => ids.shift()!)
    expect(duplicated.id).toBe('new-document')
    expect(duplicated.items[0]).toEqual(expect.objectContaining({
      id: 'new-item',
      source: 'V = vector(2, 1)',
      positionSource: '(1, 1)',
      normalization: 'natural',
    }))
    expect(duplicated.appearance['new-item']).toEqual(original.appearance.v)
    expect(duplicated.appearance.v).toBeUndefined()
    expect(resolveCanonicalImport('doc-1', original, 'replace')).toBe(original)
  })

  it('round-trips a PGA document with its algebra, interpretation, and visualizer', () => {
    const selected = executeDocumentCommand(expressionDocument([{ id: 'p', source: '' }]), {
      kind: 'select-algebra',
      algebra: { algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 } },
      interpretation: { interpretationId: 'org.multivector.pga-2d', interpretationVersion: 1 },
      visualizerId: 'org.multivector.pga-2d',
      title: 'PGA 2D Triangle Example',
      description: '',
    })
    expect(selected.status).toBe('applied')
    const withPoint = executeDocumentCommand(selected.document, { kind: 'update-source', itemId: 'p', source: 'P = point(1, 2)' })
    const restored = fromCanonicalDocument(
      parseCanonicalDocument(serializeCanonicalDocument(toCanonicalDocument(withPoint.document, 'system'))),
      { visualizerAvailable: (visualizerId) => visualizerId === 'org.multivector.pga-2d' },
    )
    expect(restored.document.algebra).toEqual({
      algebraId: 'org.multivector.pga', definitionVersion: 1, conventionVersion: 1, parameters: { dimension: 2 },
    })
    expect(restored.document.interpretation).toEqual({ interpretationId: 'org.multivector.pga-2d', interpretationVersion: 1 })
    expect(restored.document.view.visualizerId).toBe('org.multivector.pga-2d')
    expect(restored.document.items[0].source).toBe('P = point(1, 2)')
    expect(restored.recoveryDiagnostic).toBeNull()
  })
})

describe('canonical document format version 7', () => {
  const errorCode = (action: () => unknown) => {
    try { action() } catch (error) { return (error as { code?: string }).code }
    return undefined
  }
  /** A version 6 document with one record per point-list case. */
  function legacyListDocument() {
    const current = toCanonicalDocument(expressionDocument(
      [
        { id: 'plain', source: 'P = [e1, e2]', normalization: 'natural' },
        { id: 'hidden-unconnected', source: 'Q = [e1, e2]' },
        { id: 'connected', source: 'R = [e1, e2]' },
        { id: 'loop', source: 'S = [e1, e2]' },
      ],
      {
        plain: { label: 'p', labelVisible: true, orientationVisible: false },
        'hidden-unconnected': { primitiveStyles: { points: { connection: 'none', visible: false } } },
        connected: { primitiveStyles: { points: { connection: 'open-polyline', visible: false } } },
        loop: { primitiveStyles: { points: { connection: 'closed-loop', visible: true } } },
      },
      { id: 'doc-6' },
    ), 'light')
    return version6(current)
  }

  it('migrates version 6 documents without changing what they draw', () => {
    const legacy = legacyListDocument()
    expect(legacy.appearance['hidden-unconnected']).toEqual(expect.objectContaining({ pointListDisplay: 'none', pointMarkersVisible: false }))
    const migrated = parseCanonicalDocument(JSON.stringify(legacy))
    expect(migrated.formatVersion).toBe(7)
    expect(migrated.items[0].normalization).toBe('natural')
    expect(migrated.appearance.plain).toEqual({
      visible: true, labelVisible: true, label: 'p', style: 'blue-4', borderVisible: false,
      orientationVisible: false, bivectorShape: 'from-vectors', idealPointDisplay: 'vector',
      strokeStyle: 'solid', strokeWidthSource: '', pointStyle: 'dot', pointSizeSource: '',
      opacitySource: '', labelAngleSource: '', labelSizeSource: '', labelDistanceSource: '',
      // The fixed version 6 position, so existing labels do not move.
      labelAnchor: 'top-right',
      primitiveStyles: {
        points: { visible: true, pointStyle: 'dot', pointSizeSource: '', connection: 'none', strokeStyle: 'solid', strokeWidthSource: '' },
        // List lines used the item's orientation in version 6.
        lines: { visible: true, strokeStyle: 'solid', strokeWidthSource: '', orientationVisible: false },
      },
    })
    // Version 6 always drew the markers of an unconnected list.
    expect(migrated.appearance['hidden-unconnected'].primitiveStyles.points).toEqual(expect.objectContaining({ connection: 'none', visible: true }))
    expect(migrated.appearance.connected.primitiveStyles.points).toEqual(expect.objectContaining({ connection: 'open-polyline', visible: false }))
    expect(migrated.appearance.loop.primitiveStyles.points).toEqual(expect.objectContaining({ connection: 'closed-loop', visible: true }))
    expect(fromCanonicalDocument(migrated).document.appearance.plain.labelAnchor).toBe('top-right')
  })

  it('migrates byte-stably: a migrated document serializes and reparses unchanged', () => {
    const encoded = serializeCanonicalDocument(parseCanonicalDocument(JSON.stringify(legacyListDocument())))
    expect(encoded).toContain('"formatVersion":7')
    expect(encoded).not.toContain('pointListDisplay')
    expect(encoded).not.toContain('pointMarkersVisible')
    expect(serializeCanonicalDocument(parseCanonicalDocument(encoded))).toBe(encoded)
  })

  it('saves a new line without orientation, and keeps a stored orientation', () => {
    const document = expressionDocument([{ id: 'new', source: 'L = line(1, 1, 0)' }, { id: 'kept', source: 'M = line(1, 0, 0)' }],
      { kept: { orientationVisible: true } })
    const canonical = toCanonicalDocument(document, 'light', {}, { new: false, kept: false })
    expect(canonical.appearance.new.orientationVisible).toBe(false)
    expect(canonical.appearance.new.primitiveStyles.lines.orientationVisible).toBe(false)
    expect(canonical.appearance.kept.orientationVisible).toBe(true)
  })

  it('places the label of a new object automatically', () => {
    const canonical = toCanonicalDocument(expressionDocument([{ id: 'v', source: 'V = e1' }]), 'system')
    expect(canonical.appearance.v.labelAnchor).toBe('auto')
    expect(canonical.appearance.v).toEqual({ ...DEFAULT_V7_APPEARANCE })
  })

  it('round-trips every version 7 appearance field', () => {
    const appearance = {
      strokeStyle: 'dotted', strokeWidthSource: 'w', pointStyle: 'diamond', pointSizeSource: '7.5',
      opacitySource: '40', labelAngleSource: '-45', labelSizeSource: 's * 2', labelDistanceSource: '12',
      labelAnchor: 'bottom-left',
      primitiveStyles: {
        points: { visible: false, pointStyle: 'cross', pointSizeSource: 'size', connection: 'closed-loop', strokeStyle: 'dashed', strokeWidthSource: '0.25' },
        lines: { visible: false, strokeStyle: 'dotted', strokeWidthSource: '10', orientationVisible: false },
      },
    } as const
    const document = expressionDocument([{ id: 'v', source: 'V = e1' }], { v: appearance })
    const encoded = serializeCanonicalDocument(toCanonicalDocument(document, 'system'))
    const parsed = parseCanonicalDocument(encoded)
    expect(parsed.appearance.v).toEqual(expect.objectContaining(appearance))
    const restored = fromCanonicalDocument(parsed)
    expect(restored.document.appearance.v).toEqual(expect.objectContaining(appearance))
    expect(serializeCanonicalDocument(toCanonicalDocument(restored.document, restored.theme))).toBe(encoded)
  })

  it('round-trips each enumerated value', () => {
    const roundTrip = (appearance: Parameters<typeof expressionDocument>[1]) => {
      const document = expressionDocument([{ id: 'v', source: 'V = e1' }], appearance)
      return parseCanonicalDocument(serializeCanonicalDocument(toCanonicalDocument(document, 'system'))).appearance.v
    }
    for (const strokeStyle of ['solid', 'dashed', 'dotted'] as const) {
      expect(roundTrip({ v: { strokeStyle } }).strokeStyle).toBe(strokeStyle)
      expect(roundTrip({ v: { primitiveStyles: { points: { strokeStyle } } } }).primitiveStyles.points.strokeStyle).toBe(strokeStyle)
      expect(roundTrip({ v: { primitiveStyles: { lines: { strokeStyle } } } }).primitiveStyles.lines.strokeStyle).toBe(strokeStyle)
    }
    for (const pointStyle of ['dot', 'ring', 'cross', 'plus', 'square', 'diamond'] as const) {
      expect(roundTrip({ v: { pointStyle } }).pointStyle).toBe(pointStyle)
      expect(roundTrip({ v: { primitiveStyles: { points: { pointStyle } } } }).primitiveStyles.points.pointStyle).toBe(pointStyle)
    }
    for (const labelAnchor of ['auto', 'top-left', 'top', 'top-right', 'left', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const) {
      expect(roundTrip({ v: { labelAnchor } }).labelAnchor).toBe(labelAnchor)
    }
  })

  it('round-trips every normalization mode', () => {
    for (const normalization of ['natural', 'euclidean', 'ideal'] as const) {
      const document = expressionDocument([{ id: 'v', source: 'V = e1', normalization }])
      const restored = fromCanonicalDocument(parseCanonicalDocument(serializeCanonicalDocument(toCanonicalDocument(document, 'system'))))
      expect(restored.document.items[0].normalization).toBe(normalization)
    }
    const current = sample()
    expect(errorCode(() => serializeCanonicalDocument({
      ...current, items: [{ ...current.items[0], normalization: 'inorm' as never }],
    }))).toBe('DOCUMENT_SCHEMA')
  })

  it('rejects invalid version 7 appearance values', () => {
    const current = sample()
    const withAppearance = (patch: Record<string, unknown>) => () => serializeCanonicalDocument({
      ...current, appearance: { v: { ...current.appearance.v, ...patch } },
    } as never)
    const withPrimitive = (kind: 'points' | 'lines', patch: Record<string, unknown>) => withAppearance({
      primitiveStyles: { ...current.appearance.v.primitiveStyles, [kind]: { ...current.appearance.v.primitiveStyles[kind], ...patch } },
    })
    expect(errorCode(withAppearance({ strokeStyle: 'dash-dot' }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withAppearance({ pointStyle: 'star' }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withAppearance({ labelAnchor: 'center' }))).toBe('DOCUMENT_SCHEMA')
    for (const field of ['strokeWidthSource', 'pointSizeSource', 'opacitySource', 'labelAngleSource', 'labelSizeSource', 'labelDistanceSource']) {
      // Sources are text, like slider bounds: a bare number is not a source.
      expect(errorCode(withAppearance({ [field]: 2 })), field).toBe('DOCUMENT_SCHEMA')
      expect(errorCode(withAppearance({ [field]: null })), field).toBe('DOCUMENT_SCHEMA')
      expect(errorCode(withAppearance({ [field]: 'x'.repeat(65_537) })), field).toBe('LIMIT_SOURCE_LENGTH')
    }
    expect(errorCode(withAppearance({ primitiveStyles: null }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withAppearance({ primitiveStyles: { points: current.appearance.v.primitiveStyles.points } }))).toBe('DOCUMENT_UNKNOWN_FIELD')
    expect(errorCode(withAppearance({ primitiveStyles: { ...current.appearance.v.primitiveStyles, areas: {} } }))).toBe('DOCUMENT_UNKNOWN_FIELD')
    expect(errorCode(withPrimitive('points', { connection: 'polygon' }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withPrimitive('points', { visible: 'yes' }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withPrimitive('points', { pointStyle: 'star' }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withPrimitive('points', { strokeStyle: 'wavy' }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withPrimitive('points', { pointSizeSource: 3 }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withPrimitive('points', { label: 'P' }))).toBe('DOCUMENT_UNKNOWN_FIELD')
    expect(errorCode(withPrimitive('lines', { orientationVisible: 1 }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withPrimitive('lines', { strokeWidthSource: 1 }))).toBe('DOCUMENT_SCHEMA')
    expect(errorCode(withPrimitive('lines', { pointStyle: 'dot' }))).toBe('DOCUMENT_UNKNOWN_FIELD')
    // The version 6 fields are no longer part of an appearance record.
    expect(errorCode(withAppearance({ pointListDisplay: 'none' }))).toBe('DOCUMENT_UNKNOWN_FIELD')
    const { labelAnchor: _labelAnchor, ...missing } = current.appearance.v
    expect(errorCode(() => serializeCanonicalDocument({ ...current, appearance: { v: missing } } as never))).toBe('DOCUMENT_UNKNOWN_FIELD')
  })

  it('accepts the four new hues and still rejects unregistered shades', () => {
    const current = sample()
    for (const style of ['orange-1', 'teal-3', 'purple-4', 'pink-6']) {
      const encoded = serializeCanonicalDocument({ ...current, appearance: { v: { ...current.appearance.v, style } } })
      expect(parseCanonicalDocument(encoded).appearance.v.style).toBe(style)
    }
    for (const style of ['orange-7', 'teal-0', 'violet-4']) {
      expect(errorCode(() => serializeCanonicalDocument({ ...current, appearance: { v: { ...current.appearance.v, style } } }))).toBe('DOCUMENT_STYLE')
    }
  })
})
