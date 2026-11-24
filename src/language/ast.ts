import type { SourceSpan } from '../domain/diagnostic'

export type ScalarLiteralNode = Readonly<{
  kind: 'scalar-literal'
  value: number
  span: SourceSpan
}>

/** A blade written with any generator order, resolved against the active basis at evaluation. */
export type BasisBladeNode = Readonly<{
  kind: 'basis-blade'
  name: string
  span: SourceSpan
}>

export type ReferenceNode = Readonly<{
  kind: 'reference'
  name: string
  property: 'position' | 'head' | null
  span: SourceSpan
}>

export type PseudoscalarNode = Readonly<{
  kind: 'pseudoscalar'
  span: SourceSpan
}>

export type PropertyExpressionNode = Readonly<{
  kind: 'property-expression'
  object: SurfaceExpressionNode
  property: string
  propertySpan: SourceSpan
  span: SourceSpan
}>

export type UnaryExpressionNode = Readonly<{
  kind: 'unary-expression'
  operator: '+' | '-' | '~' | '!'
  operand: SurfaceExpressionNode
  span: SourceSpan
}>

/** The comparisons of section 9, which give the scalar 1 when they hold and 0 otherwise (#339). */
export type ComparisonOperator = '<' | '<=' | '>' | '>=' | '==' | '!='

export type BinaryExpressionNode = Readonly<{
  kind: 'binary-expression'
  operator: '+' | '-' | '*' | '/' | '%' | '**' | '^' | '|' | '&' | '>>>' | ComparisonOperator
  left: SurfaceExpressionNode
  right: SurfaceExpressionNode
  implicit: boolean
  span: SourceSpan
}>

export type VectorConstructorNode = Readonly<{
  kind: 'vector-constructor'
  components: readonly [SurfaceExpressionNode, SurfaceExpressionNode]
  span: SourceSpan
}>

/**
 * A parenthesized coordinate list `(a, b, …)`, or `(a,)` with one component.
 * It is algebra-neutral: the active algebra decides at evaluation which
 * constructor and which arities a tuple denotes (language section 7).
 */
export type TupleNode = Readonly<{
  kind: 'tuple'
  components: readonly SurfaceExpressionNode[]
  span: SourceSpan
}>

/**
 * What a coordinate tuple means in an algebra: the registered constructor it
 * denotes and the numbers of components it accepts, each an arity of that
 * constructor (language section 7). Algebra engines declare it; the language
 * and its editing services read it.
 */
export type TupleConstructor = Readonly<{
  constructor: string
  arities: readonly number[]
}>

export type CallExpressionNode = Readonly<{
  kind: 'call-expression'
  callee: string
  arguments: readonly SurfaceExpressionNode[]
  span: SourceSpan
}>

export type ListExpressionNode = Readonly<{
  kind: 'list-expression'
  elements: readonly SurfaceExpressionNode[]
  span: SourceSpan
}>

export type RangeExpressionNode = Readonly<{
  kind: 'range-expression'
  start: SurfaceExpressionNode
  next: SurfaceExpressionNode | null
  end: SurfaceExpressionNode
  span: SourceSpan
}>

export type IndexExpressionNode = Readonly<{
  kind: 'index-expression'
  object: SurfaceExpressionNode
  index: SurfaceExpressionNode
  span: SourceSpan
}>

export type SurfaceExpressionNode =
  | ScalarLiteralNode
  | BasisBladeNode
  | ReferenceNode
  | PseudoscalarNode
  | PropertyExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | VectorConstructorNode
  | TupleNode
  | CallExpressionNode
  | ListExpressionNode
  | RangeExpressionNode
  | IndexExpressionNode

type CoreNodeBase = Readonly<{
  /** Span of the surface expression responsible for this core operation. */
  origin: SourceSpan
}>

export type CoreExpressionNode =
  | (CoreNodeBase &
      Readonly<{
        kind: 'scalar'
        value: number
      }>)
  | (CoreNodeBase & Readonly<{
      kind: 'list'
      elements: readonly CoreExpressionNode[]
      elementOrigins: readonly SourceSpan[]
    }>)
  | (CoreNodeBase & Readonly<{
      kind: 'range'
      start: CoreExpressionNode
      next: CoreExpressionNode | null
      end: CoreExpressionNode
    }>)
  | (CoreNodeBase & Readonly<{
      kind: 'index'
      object: CoreExpressionNode
      index: CoreExpressionNode
    }>)
  | (CoreNodeBase & Readonly<{ kind: 'pseudoscalar' }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'basis-blade'
        name: string
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'call'
        name: string
        arguments: readonly CoreExpressionNode[]
      }>)
  | (CoreNodeBase &
      Readonly<{
        /** A coordinate tuple, resolved by the active algebra's tuple constructor. */
        kind: 'tuple'
        components: readonly CoreExpressionNode[]
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'reference'
        name: string
        property: 'position' | 'head' | null
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind:
          | 'add'
          | 'multiply'
          | 'divide'
          | 'modulo'
          | 'outer'
          | 'inner'
          | 'regressive'
          | 'sandwich'
        left: CoreExpressionNode
        right: CoreExpressionNode
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'compare'
        operator: ComparisonOperator
        left: CoreExpressionNode
        right: CoreExpressionNode
      }>)
  | (CoreNodeBase &
      Readonly<{
        /** `if(condition, whenTrue, whenFalse)`: only the selected branch is evaluated. */
        kind: 'conditional'
        condition: CoreExpressionNode
        whenTrue: CoreExpressionNode
        whenFalse: CoreExpressionNode
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'power'
        base: CoreExpressionNode
        exponent: CoreExpressionNode
      }>)
  | (CoreNodeBase &
      Readonly<{
        /** The operators `-A`, `~A` and `!A`. */
        kind:
          | 'negate'
          | 'reverse'
          | 'dual'
        operand: CoreExpressionNode
      }>)
  | (CoreNodeBase &
      Readonly<{
        /** A function of the common language, such as `exp`, `abs` or `norm` (`functions.ts`). */
        kind: 'function'
        name: string
        arguments: readonly CoreExpressionNode[]
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'grade'
        operand: CoreExpressionNode
        grade: number
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'coefficient'
        operand: CoreExpressionNode
        blade: string
      }>)
  | (CoreNodeBase &
      Readonly<{
        kind: 'unsupported-property'
        operand: CoreExpressionNode
        property: string
        propertyOrigin: SourceSpan
        /** The function that replaced a property of language version 1, such as `norm`. */
        functionForm: string | null
      }>)

