import { type ReferenceSection, type ReferenceTopic } from '../language/expressionReference'
import { type AlgebraEngine } from './algebraEngine'

/** Presentation-neutral description of a definition for the algebra dialog. */
export type AlgebraInfo = Readonly<{
  name: string
  signature: string
  description: string
  blades: readonly string[]
  bladeSquares: readonly string[]
  cayley: ReadonlyArray<readonly string[]>
  objects: ReadonlyArray<readonly [string, string]>
  subalgebras: ReadonlyArray<readonly [string, string]>
  notes: readonly string[]
}>

export type AlgebraParameters = Readonly<Record<string, unknown>>

/** The `document.algebra` record: what a document says about its algebra (ALG-004). */
export type AlgebraReference = Readonly<{
  algebraId: string
  definitionVersion: number
  conventionVersion: number
  parameters: AlgebraParameters
}>

export type ParameterValidation =
  | Readonly<{ status: 'valid'; parameters: AlgebraParameters }>
  | Readonly<{ status: 'invalid'; message: string }>

/**
 * A registered algebra definition (ALG-001 through ALG-005, ALG-023 through
 * ALG-025, ALG-028). The definition validates and canonicalizes parameters
 * before an engine is constructed and declares which interpretation and
 * visualizer a new document of this algebra uses by default.
 */
export type AlgebraDefinition = Readonly<{
  algebraId: string
  /** Short header label, such as `VGA · 2D`. */
  badge: string
  definitionVersion: number
  conventionVersions: readonly number[]
  capabilities: ReadonlySet<string>
  validateParameters(parameters: AlgebraParameters): ParameterValidation
  createEngine(parameters: AlgebraParameters, conventionVersion: number): AlgebraEngine
  info(parameters: AlgebraParameters): AlgebraInfo
  standardInterpretationId: string
  standardVisualizerId: string
  /**
   * The identifier of the example that shows this algebra (#217): a first run
   * in the default algebra and a switch to this one both open it, as listed
   * in Examples.
   */
  showcaseExampleId: string
  /** The expression reference shown for documents of this algebra: shared sections plus its own syntax. */
  /** The general expressions, shared by every algebra; built with `generalReference`. */
  generalReference: readonly ReferenceSection[]
  /** The expressions specific to this algebra: its values, properties, functions and positioning. */
  expressionReference: readonly ReferenceSection[]
  /**
   * The reference's first section, `Algebra <badge>`: each primitive of the
   * algebra with how it is written and one short line, then normalization.
   */
  algebraReference: readonly ReferenceTopic[]
}>
