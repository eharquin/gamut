import type { CSSProperties, SVGProps } from 'react'
import type { PointStyle } from '../document/expressionDocument'

type PointShapeProps = Readonly<{
  pointStyle: PointStyle
  x: number
  y: number
  /** Half the size of the shape: the radius of a dot. */
  radius: number
}> & Omit<SVGProps<SVGElement>, 'x' | 'y' | 'radius' | 'ref'>

/**
 * One point shape, from the validated mock-up (#222). Dot, square and diamond
 * are filled; ring, cross and plus are stroked, with a stroke proportional to
 * their size so that it grows with them. The color is `currentColor`, set by
 * the caller's class or by its own `fill`.
 */
export function PointShape({ pointStyle, x, y, radius: r, style, ...rest }: PointShapeProps) {
  const stroked = (width: number): CSSProperties => ({
    fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', ...style,
  })
  const props = rest as SVGProps<SVGPathElement & SVGCircleElement & SVGRectElement>
  switch (pointStyle) {
    case 'square':
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} style={style} {...props} />
    case 'diamond': {
      const d = r * 1.25
      return <path d={`M ${x} ${y - d} L ${x + d} ${y} L ${x} ${y + d} L ${x - d} ${y} Z`} style={style} {...props} />
    }
    case 'cross':
      return <path d={`M ${x - r} ${y - r} L ${x + r} ${y + r} M ${x + r} ${y - r} L ${x - r} ${y + r}`}
        style={stroked(r * 0.62)} {...props} />
    case 'plus': {
      const d = r * 1.3
      return <path d={`M ${x} ${y - d} V ${y + d} M ${x - d} ${y} H ${x + d}`} style={stroked(r * 0.62)} {...props} />
    }
    case 'ring':
      return <circle cx={x} cy={y} r={r} style={stroked(r * 0.45)} {...props} />
    case 'dot':
      return <circle cx={x} cy={y} r={r} style={style} {...props} />
  }
}
