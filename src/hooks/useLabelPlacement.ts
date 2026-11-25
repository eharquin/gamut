import { useRef } from 'react'
import { placeLabels, type LabelArea, type LabelObstacle, type LabelRequest, type PlacedLabel } from '../visualization/labels'

/**
 * Places the labels of a scene (#226). Placement compares every label with
 * every obstacle, so it is redone only when its inputs change, not on every
 * frame of an unrelated animation.
 */
export function useLabelPlacement(
  inputs: Readonly<{ requests: readonly LabelRequest[]; obstacles: readonly LabelObstacle[]; areas: readonly LabelArea[] }>,
  objectScale: number,
): (id: string) => PlacedLabel | null {
  const cache = useRef<{ key: string; placed: ReadonlyMap<string, PlacedLabel> } | null>(null)
  const { requests, obstacles, areas } = inputs
  const key = requests.length === 0 ? '' : JSON.stringify([requests, obstacles, areas, objectScale])
  if (cache.current?.key !== key) {
    cache.current = {
      key,
      placed: requests.length === 0 ? new Map() : placeLabels(requests, obstacles, objectScale, areas),
    }
  }
  const placed = cache.current.placed
  return (id) => placed.get(id) ?? null
}
