import { inspectMultivector, type OwnedMultivector } from './multivector'

export const MAX_GENERATED_VALUES = 10_000

export type ListElement = Readonly<{
  id: string
  value: OwnedMultivector
  sources?: readonly string[]
}>

export type OwnedList = Readonly<{
  kind: 'list'
  elements: readonly ListElement[]
  /**
   * A list of lists (#360), made only by `map`: the lengths of its inner
   * lists, in order, which partition `elements`. Absent for a flat list.
   * Only indexing reads its inner lists; every operation rejects it.
   */
  groups?: readonly number[]
}>

export type LanguageValue = OwnedMultivector | OwnedList

const elementIdentities = new WeakMap<OwnedMultivector, string>()

export function retainElementIdentity(
  value: OwnedMultivector,
  identity: string,
): OwnedMultivector {
  elementIdentities.set(value, identity)
  return value
}

export function elementIdentity(value: OwnedMultivector): string | null {
  return elementIdentities.get(value) ?? null
}

const operationSources = new WeakMap<OwnedMultivector, readonly string[]>()

/**
 * Records the identities a single value was computed from, so a list element
 * built by an operation keeps its operands' lineage (position inheritance).
 */
export function retainOperationSources(
  value: OwnedMultivector,
  sources: readonly string[],
): OwnedMultivector {
  if (sources.length > 0) operationSources.set(value, Object.freeze([...new Set(sources)]))
  return value
}

/** The identities a value stands for: its own identity, else its operands'. */
export function valueLineage(value: OwnedMultivector): readonly string[] {
  const identity = elementIdentity(value)
  return identity ? [identity] : operationSources.get(value) ?? []
}

const outerConstructions = new WeakMap<
  OwnedMultivector,
  readonly [OwnedMultivector, OwnedMultivector]
>()

/**
 * Records the two operands an outer product was built from. This is
 * presentation provenance only (VIZ2D-007): it never changes the value, and
 * the interpretation validates it against the value before drawing.
 */
export function retainOuterConstruction(
  value: OwnedMultivector,
  sides: readonly [OwnedMultivector, OwnedMultivector],
): OwnedMultivector {
  outerConstructions.set(value, Object.freeze([sides[0], sides[1]] as const))
  return value
}

export function outerConstruction(
  value: OwnedMultivector,
): readonly [OwnedMultivector, OwnedMultivector] | null {
  return outerConstructions.get(value) ?? null
}

export function ownedList(elements: readonly ListElement[], groups?: readonly number[]): OwnedList {
  if (elements.length > MAX_GENERATED_VALUES) {
    throw new RangeError('A list cannot contain more than 10,000 elements.')
  }
  if (groups && groups.reduce((sum, length) => sum + length, 0) !== elements.length) {
    throw new RangeError('The inner lists of a list of lists must partition its elements.')
  }
  elements.forEach((element) => retainElementIdentity(element.value, element.id))
  return Object.freeze({
    kind: 'list' as const,
    elements: Object.freeze(elements.map((element) => Object.freeze(element))),
    ...(groups ? { groups: Object.freeze([...groups]) } : {}),
  })
}

/** Whether a value is a list of lists (#360). */
export function isListOfLists(value: LanguageValue): value is OwnedList & Readonly<{ groups: readonly number[] }> {
  return value.kind === 'list' && value.groups !== undefined
}

/** The inner lists of a list of lists, as slices of its elements. */
export function innerLists(value: OwnedList & Readonly<{ groups: readonly number[] }>): readonly (readonly ListElement[])[] {
  let start = 0
  return value.groups.map((length) => {
    const inner = value.elements.slice(start, start + length)
    start += length
    return inner
  })
}

/**
 * Where element `index` of a list is: `[index]` in a flat list, `[i][j]` in
 * a list of lists (#360).
 */
export function elementPath(value: OwnedList, index: number): readonly number[] {
  if (!value.groups) return [index]
  let start = 0
  for (const [i, length] of value.groups.entries()) {
    if (index < start + length) return [i, index - start]
    start += length
  }
  return [index]
}

/** A list with the same elements' grouping as `like`, for a list rebuilt element by element. */
export function regroupedList(like: OwnedList, elements: readonly ListElement[]): OwnedList {
  return ownedList(elements, like.groups)
}

export function inspectLanguageValue(value: LanguageValue): string {
  // Blade names come from the value's own basis, so every algebra inspects alike.
  if (value.kind === 'multivector') return inspectMultivector(value)
  if (isListOfLists(value)) {
    return `[${innerLists(value).map((inner) =>
      `[${inner.map((element) => inspectLanguageValue(element.value)).join(', ')}]`).join(', ')}]`
  }
  return `[${value.elements.map((element) => inspectLanguageValue(element.value)).join(', ')}]`
}
