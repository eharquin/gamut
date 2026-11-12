import { useCallback, useEffect, useState } from 'react'

/**
 * Fullscreen for the whole page, offered only when the host allows it (an
 * iframe needs `allowfullscreen`). A request the browser refuses leaves the
 * page as it is.
 */
export function useFullscreen(): Readonly<{ available: boolean; active: boolean; toggle: () => void }> {
  const available = document.fullscreenEnabled === true
  const [active, setActive] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    const change = () => setActive(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])
  const toggle = useCallback(() => {
    const request = document.fullscreenElement
      ? document.exitFullscreen?.()
      : document.documentElement.requestFullscreen?.()
    void request?.catch(() => undefined)
  }, [])
  return { available, active, toggle }
}
