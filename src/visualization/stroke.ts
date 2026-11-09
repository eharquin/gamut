import type { CSSProperties } from 'react'
import type { StrokeStyle } from '../document/expressionDocument'

/**
 * Kind defaults of the stroke width, in reference pixels, as drawn before
 * format version 7 at object scale 1: lines 2.5, vectors and ideal-point
 * arrows 4 screen pixels, bivector outlines 3 screen pixels.
 */
export const DEFAULT_STROKE_WIDTHS = Object.freeze({
  line: 2.5,
  segment: 4 / 1.5,
  outline: 3 / 1.5,
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
