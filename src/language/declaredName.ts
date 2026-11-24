/**
 * The name an expression source declares (`A` in `A = …`, `f` in
 * `f(x, y) = …`), or `null` for an anonymous source such as `a == b`.
 */
export function declaredName(source: string): string | null {
  return /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*\s*\))?\s*=(?!=)/
    .exec(source)?.[1] ?? null
}
