/** The name an expression source declares (`A` in `A = …`), or `null` for an anonymous source. */
export function declaredName(source: string): string | null {
  return /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(source)?.[1] ?? null
}
