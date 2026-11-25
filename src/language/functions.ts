import { AlgebraOperationError, type AlgebraEngine, type NormKind } from '../algebra/algebraEngine'
import type { SourceSpan } from '../domain/diagnostic'
import type { OwnedMultivector } from '../domain/multivector'
import { SCALAR_FUNCTION_NAMES, SCALAR_FUNCTIONS } from '../domain/scalarFunctions'
import type { CoreExpressionNode } from './ast'

/**
 * A function of the common language (section 10): every algebra resolves the
 * name the same way, although an algebra may not provide it (`inorm` without
 * an ideal norm). Functions registered by an algebra, such as `point` or
 * `vector`, are resolved by the engine after these.
 */
export type LanguageFunction = Readonly<{
  name: string
  /** The accepted argument counts, checked when the source is parsed. */
  arities: readonly number[]
  /** For a function of a variable number of arguments, the least it takes, instead of `arities`. */
  minArity?: number
  /** Whether the result is a scalar whatever the arguments, for implicit coefficients (section 4). */
  scalarResult: boolean
  /**
   * How a list argument is distributed: `operation` keeps the identity of
   * each element, like the operators; `scalar` follows the n-ary rule of the
   * scalar functions (section 11).
   */
  distribution: 'operation' | 'scalar'
  /** Whether the active algebra provides the function. */
  available(engine: AlgebraEngine): boolean
  /** The function of its values, for every arity but the one-argument reduction. */
  apply?(engine: AlgebraEngine, args: readonly OwnedMultivector[]): OwnedMultivector
  /**
   * With one argument, the function reduces a list to one value instead
   * (`min(L)`, `sum(L)`): the argument shall be a list, and each element is
   * passed in list order.
   */
  reduction?: ListReduction
}>

export type ListReduction = Readonly<{
  /** The value of an empty list, or null when it has none. */
  empty(engine: AlgebraEngine): OwnedMultivector | null
  /** Checks one element; throws a domain error for an element it does not accept. */
  element?(value: OwnedMultivector): void
  combine(engine: AlgebraEngine, accumulated: OwnedMultivector, value: OwnedMultivector): OwnedMultivector
}>

const always = () => true

function operation(
  name: string,
  apply: (engine: AlgebraEngine, value: OwnedMultivector) => OwnedMultivector,
  options: Readonly<{ scalarResult?: boolean; available?: (engine: AlgebraEngine) => boolean }> = {},
): LanguageFunction {
  return {
    name,
    arities: [1],
    scalarResult: options.scalarResult ?? false,
    distribution: 'operation',
    available: options.available ?? always,
    apply: (engine, [value]) => apply(engine, value),
  }
}

const hasIdealNorm = (engine: AlgebraEngine) => engine.idealNorm !== undefined

/** Divides by the requested norm; a zero or non-finite norm is a domain error, never the value unchanged. */
function normalized(engine: AlgebraEngine, value: OwnedMultivector, kind: NormKind): OwnedMultivector {
  const result = engine.normalize(value, kind)
  if (result.status === 'normalized') return result.value
  throw new AlgebraOperationError(
    'ALG_DOMAIN',
    kind === 'euclidean'
      ? 'normalize requires a non-zero norm.'
      : 'inormalize requires a non-zero ideal norm.',
  )
}

/** A pure grade-zero value, or a domain error naming the function. */
function requireScalar(name: string): (value: OwnedMultivector) => void {
  return (value) => {
    if (value.coefficients.slice(1).some((coefficient) => coefficient !== 0)) {
      throw new AlgebraOperationError('ALG_DOMAIN', `${name} of a list requires scalar elements.`)
    }
  }
}

/** `min(L)` or `max(L)`: the smallest or largest scalar element; an empty list has none. */
function extremum(name: 'min' | 'max'): ListReduction {
  return {
    empty: () => null,
    element: requireScalar(name),
    combine: (engine, accumulated, value) =>
      engine.scalarFunction(name, [accumulated, value]),
  }
}

const FUNCTIONS: readonly LanguageFunction[] = [
  operation('exp', (engine, value) => engine.exp(value)),
  ...SCALAR_FUNCTION_NAMES.map((name): LanguageFunction => ({
    name,
    // `min(L)` and `max(L)` also reduce a list (#338).
    arities: name === 'min' || name === 'max' ? [1, 2] : [SCALAR_FUNCTIONS[name].arity],
    scalarResult: true,
    distribution: 'scalar',
    available: always,
    apply: (engine, args) => engine.scalarFunction(name, args),
    ...(name === 'min' || name === 'max' ? { reduction: extremum(name) } : {}),
  })),
  {
    // `if(condition, whenTrue, whenFalse)` evaluates only the branch it
    // selects, so it is lowered to its own node instead of being applied
    // (#339); it has no `apply`, and the parser enforces its three arguments.
    name: 'if',
    arities: [3],
    scalarResult: false,
    distribution: 'scalar',
    available: always,
  },
  {
    // `iterate(f, x0, n)` takes a function name, not a value, so it is
    // lowered to its own node instead of being applied (#341).
    name: 'iterate',
    arities: [3],
    scalarResult: false,
    distribution: 'scalar',
    available: always,
  },
  {
    // `map(f, L1, …, Lk)` (#360) takes a function name and one list per
    // parameter of the function, so it is lowered to its own node too.
    name: 'map',
    arities: [],
    minArity: 2,
    scalarResult: false,
    distribution: 'scalar',
    available: always,
  },
  {
    // The sum of the elements of a list, with the algebra's addition; zero for an empty list.
    name: 'sum',
    arities: [1],
    scalarResult: false,
    distribution: 'scalar',
    available: always,
    reduction: {
      empty: (engine) => engine.scalar(0),
      combine: (engine, accumulated, value) => engine.add(accumulated, value),
    },
  },
  operation('norm', (engine, value) => engine.norm(value), { scalarResult: true }),
  operation('inorm', (engine, value) => engine.idealNorm!(value), {
    scalarResult: true, available: hasIdealNorm,
  }),
  operation('normalize', (engine, value) => normalized(engine, value, 'euclidean')),
  operation('inormalize', (engine, value) => normalized(engine, value, 'ideal'), {
    available: hasIdealNorm,
  }),
  operation('dual', (engine, value) => engine.dual(value)),
  operation('inverse', (engine, value) => engine.inverse(value)),
  operation('reverse', (engine, value) => engine.reverse(value)),
  operation('involution', (engine, value) => engine.gradeInvolution(value)),
]

const FUNCTIONS_BY_NAME: ReadonlyMap<string, LanguageFunction> =
  new Map(FUNCTIONS.map((entry) => [entry.name, entry]))

/** The common-language function of this name, if any. */
export function languageFunction(name: string): LanguageFunction | undefined {
  return FUNCTIONS_BY_NAME.get(name)
}

/** Every common-language function name; these names cannot be declared. */
export const LANGUAGE_FUNCTION_NAMES: ReadonlySet<string> = new Set(FUNCTIONS_BY_NAME.keys())

/**
 * The postfix properties of language version 1 that version 2 writes as
 * functions: `A.norm` is `norm(A)`.
 */
export const REMOVED_PROPERTIES: ReadonlySet<string> =
  new Set(['norm', 'inorm', 'dual', 'inverse', 'reverse', 'involution'])

/**
 * A postfix property of the common language (section 13): a family of
 * names and the core node it lowers to. Item-part references (`.position`,
 * `.head`) are not properties of a value and are parsed as references.
 */
export type LanguageProperty = Readonly<{
  matches(property: string): boolean
  lower(operand: CoreExpressionNode, property: string, origin: SourceSpan): CoreExpressionNode
}>

export const LANGUAGE_PROPERTIES: readonly LanguageProperty[] = [
  {
    // Grade projection `A.g1`.
    matches: (property) => /^g\d+$/.test(property),
    lower: (operand, property, origin) => ({ kind: 'grade', operand, grade: Number(property.slice(1)), origin }),
  },
  {
    // Blade coefficient `A.e12`, in any generator order.
    matches: (property) => /^e\d*$/.test(property),
    lower: (operand, property, origin) => ({ kind: 'coefficient', operand, blade: property, origin }),
  },
]
