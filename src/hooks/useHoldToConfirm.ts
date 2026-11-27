import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

/** Hold duration that confirms a broad destructive action. */
export const HOLD_TO_CONFIRM_MS = 1_000

/**
 * A sustained hold that confirms a broad destructive action, such as clearing
 * every expression or deleting a folder with its rows. It works with the
 * pointer and the keyboard alike (A11Y-007): pressing Enter or Space starts
 * the hold, and releasing, leaving, or blurring the control cancels it. The
 * returned props drive the progress ring through `--hold-duration` and the
 * `is-holding` class; reduced-motion users get a static armed state. A key
 * still held after the confirmation repeats into nothing: the action usually
 * moves focus, and the repeats would act on what takes it.
 */
export function useHoldToConfirm(onConfirm: () => void, enabled = true) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirm = useRef(onConfirm)
  confirm.current = onConfirm
  /** The key that started the hold, if a key did. */
  const heldKey = useRef<string | null>(null)

  const cancelHold = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    heldKey.current = null
    setHolding(false)
  }

  /** Swallows the repeats of a key held past the confirmation, until it is released. */
  const swallowUntilReleased = (key: string) => {
    const swallow = (event: globalThis.KeyboardEvent) => {
      if (event.key !== key) return
      // A new press means the release went unseen, for instance outside the page.
      if (!event.repeat) { stop(); return }
      event.preventDefault()
      event.stopPropagation()
    }
    const release = (event: globalThis.KeyboardEvent) => {
      if (event.key !== key) return
      window.removeEventListener('keydown', swallow, true)
      window.removeEventListener('keyup', release, true)
      window.removeEventListener('blur', stop)
    }
    const stop = () => release({ key } as globalThis.KeyboardEvent)
    window.addEventListener('keydown', swallow, true)
    window.addEventListener('keyup', release, true)
    window.addEventListener('blur', stop)
  }

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  const beginHold = () => {
    if (!enabled || timer.current !== null) return
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      if (heldKey.current !== null) swallowUntilReleased(heldKey.current)
      heldKey.current = null
      confirm.current()
    }, HOLD_TO_CONFIRM_MS)
  }

  return {
    holding,
    props: {
      style: { '--hold-duration': `${HOLD_TO_CONFIRM_MS}ms` } as CSSProperties,
      onPointerDown: beginHold,
      onPointerUp: cancelHold,
      onPointerLeave: cancelHold,
      onPointerCancel: cancelHold,
      onBlur: cancelHold,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        if (event.repeat) return
        beginHold()
        if (timer.current !== null) heldKey.current = event.key
      },
      onKeyUp: cancelHold,
    },
  }
}
