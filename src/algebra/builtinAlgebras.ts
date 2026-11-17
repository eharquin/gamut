import { PGA_2D_INTERPRETATION } from '../geometry/pga2Interpretation'
import { VGA_2D_INTERPRETATION } from '../geometry/vga2Interpretation'
import { PGA_2D_VISUALIZER } from '../visualization/pga2Visualizer'
import { VGA_2D_VISUALIZER } from '../visualization/vga2Visualizer'
import { createAlgebraRegistry, type AlgebraRegistry } from './registry'
import { PGA_DEFINITION } from './pgaDefinition'
import { VGA_DEFINITION } from './vgaDefinition'

/**
 * The algebra of a first run (#217): an explicit choice, not a consequence of
 * the first-run document, which is this algebra's showcase example.
 */
export const DEFAULT_ALGEBRA_ID = VGA_DEFINITION.algebraId

/** The registry of definitions shipped with this runtime. */
export function createBuiltinAlgebraRegistry(): AlgebraRegistry {
  const registry = createAlgebraRegistry()
  registry.register(VGA_DEFINITION)
  registry.register(PGA_DEFINITION)
  registry.registerInterpretation(VGA_2D_INTERPRETATION as unknown as Parameters<AlgebraRegistry['registerInterpretation']>[0])
  registry.registerInterpretation(PGA_2D_INTERPRETATION as unknown as Parameters<AlgebraRegistry['registerInterpretation']>[0])
  registry.registerVisualizer(VGA_2D_VISUALIZER)
  registry.registerVisualizer(PGA_2D_VISUALIZER)
  return registry
}
