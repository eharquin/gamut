import { useEffect, useState } from 'react'

const matches = (query: string): boolean => {
  try {
    return window.matchMedia?.(query).matches ?? false
  } catch {
    return false
  }
}

/**
 * Whether a CSS media query matches, following later changes of the window.
 * Without `matchMedia`, or when it throws, the query never matches.
 */
export function useMediaQuery(query: string): boolean {
  const [matched, setMatched] = useState(() => matches(query))
  useEffect(() => {
    let list: MediaQueryList | undefined
    try {
      list = window.matchMedia?.(query)
    } catch {
      list = undefined
    }
    if (!list) return
    const media = list
    const change = () => setMatched(media.matches)
    change()
    // Older Safari versions only offer the deprecated listener methods.
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', change)
      return () => media.removeEventListener('change', change)
    }
    media.addListener?.(change)
    return () => media.removeListener?.(change)
  }, [query])
  return matched
}
