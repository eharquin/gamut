import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

/** Hold duration that confirms a broad destructive action. */
export const HOLD_TO_CONFIRM_MS = 1_000

/**
 * A sustained hold that confirms a broad destructive action, such as clearing
 * every expression or deleting a folder with its rows. It works with the
 * pointer and the keyboard alike (A11Y-007): pressing Enter or Space starts
 * the hold, and releasing, leaving, or blurring the control cancels it. The
 * returned props drive the progress ring through `--hold-duration` and the
 * `is-holding` class; reduced-motion users get a static armed state.
 */
export function useHoldToConfirm(onConfirm: () => void, enabled = true) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirm = useRef(onConfirm)
  confirm.current = onConfirm

  const cancelHold = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
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
        if (!event.repeat) beginHold()
      },
      onKeyUp: cancelHold,
    },
  }
}
