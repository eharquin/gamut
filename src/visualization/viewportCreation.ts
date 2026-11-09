import { formatRoundTripNumber } from '../domain/numberFormat'

const DECLARATION_NAME = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/
const MAX_COORDINATE_DECIMALS = 8

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * The first free name for an object created in the viewport: `A` through `Z`,
 * then `A1` through `Z1`, `A2`, and so on, skipping every declared name.
 */
export function nextObjectName(sources: readonly string[]): string {
  const declarations = new Set(
    sources.flatMap((source) => {
      const name = DECLARATION_NAME.exec(source)?.[1]
      return name ? [name] : []
    }),
  )
  for (let round = 0; ; round += 1) {
    const suffix = round === 0 ? '' : String(round)
    const free = [...LETTERS].find((letter) => !declarations.has(`${letter}${suffix}`))
    if (free) return `${free}${suffix}`
  }
}

/**
 * The decimal places of a coordinate written by the viewport: about one
 * reference screen pixel at the given scale, `round(log10(pixelsPerUnit))`
 * clamped from zero through eight. Precision grows as the user zooms in.
 */
export function viewportCoordinateDecimals(pixelsPerUnit: number): number {
  return Math.max(0, Math.min(MAX_COORDINATE_DECIMALS, Math.round(Math.log10(pixelsPerUnit))))
}

/**
 * Formats a coordinate written by creation, drags, and keyboard moves, so that
 * source shows only the digits the screen can resolve. Trailing zeroes are
 * removed and negative zero is written `0`. A caller that needs a finer step,
 * such as line coefficients, passes a proportionally larger scale.
 */
export function formatViewportCoordinate(
  value: number,
  pixelsPerUnit: number,
): string {
  return formatRoundTripNumber(Number(value.toFixed(viewportCoordinateDecimals(pixelsPerUnit))))
}

/** The declaration created for a located object at a viewport point (INTERACT2D-001). */
export function creationSource(
  constructor: string,
  name: string,
  point: Readonly<{ x: number; y: number }>,
  pixelsPerUnit: number,
): string {
  return `${name} = ${constructor}(${formatViewportCoordinate(point.x, pixelsPerUnit)}, ${
    formatViewportCoordinate(point.y, pixelsPerUnit)
  })`
}

export function vectorCreationSource(
  name: string,
  point: Readonly<{ x: number; y: number }>,
  pixelsPerUnit: number,
): string {
  return creationSource('vector', name, point, pixelsPerUnit)
}
