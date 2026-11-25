import type { ReactElement } from 'react'
import type { InterpretedEntity, Point2d } from '../geometry/interpretation'
import {
  DirectionMarkerGlyph,
  LineAtInfinityGlyph,
  OrientedAreaGlyph,
  OrientedSegmentGlyph,
  PointListConnectionGlyph,
  PointMarkerGlyph,
  UnboundedLineGlyph,
  type HandleController,
} from './glyphs'
import type { PlacedLabel } from './labels'
import { layoutLineSelection, layoutPointListConnection, layoutPointListFill, lineOrientationTicks } from './layout'
import { ownerOf, type SceneLayout } from './sceneLayout'
import type { Viewport2d } from './viewport'

/**
 * What the reader may do with the object a rendered element draws. Each
 * answer is false for an element that is no item of the document; the glyphs
 * ask `present` first, so the others run only when they did before.
 */
export type GlyphMovability = Readonly<{
  present(id: string): boolean
  head(id: string, entity: InterpretedEntity): boolean
  base(id: string, entity: InterpretedEntity): boolean
  line(id: string, entity: InterpretedEntity): boolean
}>

export type SceneGlyphsProps = Readonly<{
  scene: SceneLayout
  viewport: Viewport2d
  /** The scale objects are drawn at. */
  scale: number
  placedLabel: (id: string) => PlacedLabel | null
  movability: GlyphMovability
  controller: HandleController
  selectedObjectId: string | null
  selectedLine: Readonly<{ itemId: string; anchor: Point2d }> | null
}>

/**
 * The glyphs of a laid-out scene, one per rendered element (#173). The
 * glyphs of the selected object are drawn after all others, so that its
 * handles are on top where handles coincide (#100). Keys are item ids, list
 * element ids `id:index`, or `connection-id` for a list's links.
 */
export function SceneGlyphs({
  scene, viewport, scale, placedLabel, movability, controller, selectedObjectId, selectedLine,
}: SceneGlyphsProps) {
  const raiseSelectedGlyphs = (glyphs: readonly ReactElement[]): readonly ReactElement[] => {
    if (selectedObjectId === null) return glyphs
    const owned = (glyph: ReactElement) =>
      ownerOf(String(glyph.key).replace(/^connection-/, '')) === selectedObjectId
    return [...glyphs.filter((glyph) => !owned(glyph)), ...glyphs.filter(owned)]
  }
  return <>{
      raiseSelectedGlyphs([
        ...scene.vectors.map(({ id, primitive, entity, layout, color, strokeStyle, strokeWidth, pointSize, opacity, labelOpacity }) => {
          const present = movability.present(id)
          return <OrientedSegmentGlyph
            key={id}
            id={id}
            primitive={primitive}
            layout={layout}
            color={color}
            label={placedLabel(id)}
            scale={scale}
            itemPresent={present}
            headMovable={present && movability.head(id, entity)}
            baseMovable={present && movability.base(id, entity)}
            controller={controller}
            strokeStyle={strokeStyle}
            strokeWidth={strokeWidth}
            pointSize={pointSize}
            opacity={opacity}
            labelOpacity={labelOpacity}
          />
        }),
        ...scene.areas.map(({ id, primitive, entity, layout, color, borderVisible, orientationVisible, strokeStyle, strokeWidth, opacity, labelOpacity }) => {
          const present = movability.present(id)
          return <OrientedAreaGlyph
            key={id}
            id={id}
            primitive={primitive}
            layout={layout}
            color={color}
            label={placedLabel(id)}
            scale={scale}
            borderVisible={borderVisible}
            orientationVisible={orientationVisible}
            itemPresent={present}
            baseMovable={present && movability.base(id, entity)}
            controller={controller}
            strokeStyle={strokeStyle}
            strokeWidth={strokeWidth}
            opacity={opacity}
            labelOpacity={labelOpacity}
          />
        }),
        ...scene.lines.map(({ id, primitive, entity, layout, color, orientationVisible, strokeStyle, strokeWidth, opacity, labelOpacity }) => {
          const present = movability.present(id)
          const selection = selectedLine?.itemId === id
            ? layoutLineSelection(primitive, selectedLine.anchor, viewport, scale)
            : null
          return <UnboundedLineGlyph
            key={id}
            id={id}
            primitive={primitive}
            layout={layout}
            color={color}
            label={placedLabel(id)}
            scale={scale}
            itemPresent={present}
            movable={present && movability.line(id, entity)}
            orientationVisible={orientationVisible}
            orientationTicks={lineOrientationTicks(primitive, layout, scale)}
            selection={selection}
            controller={controller}
            strokeStyle={strokeStyle}
            strokeWidth={strokeWidth}
            opacity={opacity}
            labelOpacity={labelOpacity}
          />
        }),
        ...scene.infinity.map(({ id, primitive, layout, color, opacity, labelOpacity }) => (
          <LineAtInfinityGlyph key={id} accessibleName={primitive.accessibleName} layout={layout} color={color} label={placedLabel(id)} scale={scale} opacity={opacity} labelOpacity={labelOpacity} />
        )),
        ...scene.idealPoints.map(({ id, primitive, entity, arrow, marker, color, strokeStyle, strokeWidth, pointSize, opacity, labelOpacity }) => {
          const present = movability.present(id)
          return <g key={id}>
            {marker && <DirectionMarkerGlyph
              accessibleName={primitive.accessibleName}
              layout={marker}
              color={color}
              label={arrow ? null : placedLabel(id)}
              scale={scale}
              opacity={opacity}
              labelOpacity={labelOpacity}
            />}
            {arrow && <OrientedSegmentGlyph
              id={id}
              primitive={{ kind: 'oriented-segment', start: primitive.position, end: {
                x: primitive.position.x + primitive.direction.x * primitive.magnitude,
                y: primitive.position.y + primitive.direction.y * primitive.magnitude,
              }, accessibleName: primitive.accessibleName }}
              layout={arrow}
              color={color}
              label={placedLabel(id)}
              scale={scale}
              itemPresent={present}
              headMovable={present && movability.head(id, entity)}
              baseMovable={present && movability.base(id, entity)}
              controller={controller}
              strokeStyle={strokeStyle}
              strokeWidth={strokeWidth}
              pointSize={pointSize}
              opacity={opacity}
              labelOpacity={labelOpacity}
            />}
          </g>
        }),
        ...scene.connections.map(({ id, segments, fill, fillOpacity, color, opacity, strokeStyle, strokeWidth }) => (
          <PointListConnectionGlyph
            key={`connection-${id}`}
            path={layoutPointListConnection(segments, viewport)}
            fillPath={fill ? layoutPointListFill(fill, viewport) : null}
            fillOpacity={fillOpacity}
            color={color}
            scale={scale}
            opacity={opacity}
            strokeStyle={strokeStyle}
            strokeWidth={strokeWidth}
          />
        )),
        ...scene.points.map(({ id, primitive, entity, point, color, markerVisible, opacity, labelOpacity, pointStyle, pointSize }) => {
          const present = movability.present(id)
          return <PointMarkerGlyph
            key={id}
            id={id}
            primitive={primitive}
            point={point}
            color={color}
            label={placedLabel(id)}
            scale={scale}
            itemPresent={present}
            movable={present && movability.base(id, entity)}
            markerVisible={markerVisible}
            controller={controller}
            opacity={opacity}
            labelOpacity={labelOpacity}
            pointStyle={pointStyle}
            pointSize={pointSize}
          />
        }),
      ])
  }</>
}
