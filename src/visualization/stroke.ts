import type { CSSProperties } from 'react'
import type { StrokeStyle } from '../document/expressionDocument'

/**
 * Kind defaults of the stroke width, in reference pixels, as drawn before
 * format version 7 at object scale 1: lines 2.5, vectors and ideal-point
 * arrows 4 screen pixels, bivector outlines 3 screen pixels, point-list
 * connections 2.
 */
export const DEFAULT_STROKE_WIDTHS = Object.freeze({
  line: 2.5,
  segment: 4 / 1.5,
  outline: 3 / 1.5,
  connection: 2,
})

/**
 * A vector's size, in the units of a point's size: its anchor is the point of
 * that size, and its shaft, arrowhead and head point grow in proportion. A
 * width set before sizes existed still sizes the vector by its shaft. This is
 * the factor applied to the object scale; 1 when neither is set.
 */
export function segmentSizeFactor(
  pointSize: number | null | undefined,
  strokeWidth: number | null | undefined,
): number {
  if (pointSize !== null && pointSize !== undefined && pointSize >= 0) return pointSize / DEFAULT_POINT_SIZE
  if (strokeWidth !== null && strokeWidth !== undefined && strokeWidth >= 0) return strokeWidth / DEFAULT_STROKE_WIDTHS.segment
  return 1
}

/**
 * The dash pattern of a stroke style for a drawn width, so that dashes and
 * dots grow with the stroke. Dots are zero-length dashes with round caps.
 *
 * `anchor` is the distance along the path, from its start, of a fixed point
 * on which a dash or a dot is centred: a wider stroke then scales the pattern
 * around that point instead of from the start of the path, which for a
 * clipped line lies on the viewport edge.
 */
export function strokePattern(style: StrokeStyle, width: number, anchor = 0): CSSProperties {
  if (style === 'dashed') return {
    strokeDasharray: `${4 * width} ${3 * width}`,
    ...(anchor === 0 ? {} : { strokeDashoffset: 2 * width - anchor }),
  }
  if (style === 'dotted') return {
    strokeDasharray: `0 ${2 * width}`,
    strokeLinecap: 'round',
    ...(anchor === 0 ? {} : { strokeDashoffset: -anchor }),
  }
  return {}
}

/** Point core radius in reference pixels, as drawn before format version 7. */
export const DEFAULT_POINT_SIZE = 4.5

/**
 * The outer shape of a point is the core's own form, this many times larger:
 * 10 px for the 4.5 px core. A hovered or dragged core grows to fill it.
 */
export const POINT_OUTER_SCALE = 10 / 4.5

/** The default share of a list's color its fill takes, in percent. */
export const DEFAULT_FILL_OPACITY = 20
