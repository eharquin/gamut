import { useEffect, useState } from 'react'

const matches = (query: string): boolean => {
  try {
    return window.matchMedia?.(query).matches ?? false
  } catch {
    return false
  }
}

/** Whether a CSS media query matches, following later changes of the window. */
export function useMediaQuery(query: string): boolean {
  const [matched, setMatched] = useState(() => matches(query))
  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list) return
    const change = () => setMatched(list.matches)
    change()
    list.addEventListener?.('change', change)
    return () => list.removeEventListener?.('change', change)
  }, [query])
  return matched
}
