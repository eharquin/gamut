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
 * The dash pattern of a stroke style for a drawn width, so that dashes and
 * dots grow with the stroke. Dots are zero-length dashes with round caps.
 */
export function strokePattern(style: StrokeStyle, width: number): CSSProperties {
  if (style === 'dashed') return { strokeDasharray: `${4 * width} ${3 * width}` }
  if (style === 'dotted') return { strokeDasharray: `0 ${2 * width}`, strokeLinecap: 'round' }
  return {}
}

/** Point core radius in reference pixels, as drawn before format version 7. */
export const DEFAULT_POINT_SIZE = 4.5

/**
 * The outer shape of a point is the core's own form, this many times larger:
 * 10 px for the 4.5 px core. A hovered or dragged core grows to fill it.
 */
export const POINT_OUTER_SCALE = 10 / 4.5
