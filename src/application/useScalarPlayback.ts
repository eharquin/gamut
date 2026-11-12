import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentCommand } from '../document/documentCommands'
import type { HistoryAction } from '../document/documentHistory'
import type { ExpressionControl, ExpressionItem } from '../document/expressionDocument'
import { declaredName } from '../language/declaredName'
import type { ScalarControlEvaluation } from './evaluateScalarControl'
import {
  scalarPlaybackFrame,
  scalarPlaybackOffset,
  type PlaybackParameters,
} from './scalarPlayback'

/** The animation a slider gets when its control does not configure one. */
export const DEFAULT_SCALAR_ANIMATION = {
  mode: 'ping-pong' as const,
  direction: 'forward' as const,
  durationSeconds: 2,
} satisfies NonNullable<ExpressionControl['animation']>

type ActiveScalarPlayback = Readonly<{
  itemId: string
  name: string
  startedAt: number
  offsetMilliseconds: number
  parameters: PlaybackParameters
}>
type PausedScalarPlayback = Omit<ActiveScalarPlayback, 'startedAt'>

function playbackParametersEqual(
  left: PlaybackParameters,
  right: PlaybackParameters,
): boolean {
  return left.minimum === right.minimum &&
    left.maximum === right.maximum &&
    left.step === right.step &&
    left.animation.mode === right.animation.mode &&
    left.animation.direction === right.animation.direction &&
    left.animation.durationSeconds === right.animation.durationSeconds
}

function naturalList(values: readonly string[]): string {
  if (values.length < 2) return values[0] ?? ''
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function animationSubject(names: readonly string[]): string {
  return `${naturalList(names)} animation${names.length === 1 ? '' : 's'}`
}

export type ScalarPlaybackOptions = Readonly<{
  items: readonly ExpressionItem[]
  scalarControlEvaluations: ReadonlyMap<string, ScalarControlEvaluation>
  executeCommand: (command: DocumentCommand) => void
  dispatchHistory: (action: HistoryAction) => void
  reducedMotion: boolean
}>

export type ScalarPlayback = Readonly<{
  /** Whether the slider of this item is playing. */
  isPlaying(itemId: string): boolean
  /** Whether any slider is playing. */
  anyPlaying: boolean
  /** Starts, or resumes from where it was paused, the slider of an item. */
  start(item: ExpressionItem, parameters: PlaybackParameters, currentValue: number): void
  /** Pauses one slider; it resumes from the same point when started again. */
  stop(itemId: string): void
  /** Stops every slider and commits the playback history entry. */
  stopAll(): void
  /** Forgets where a paused slider stopped, so the next start uses its current value. */
  forgetPaused(itemId: string): void
  /** The latest live-region message about playback. */
  announcement: string
}>

/**
 * Scalar slider playback: one history transaction per playback session, a
 * frame loop that writes the animated values, pause and resume, Escape to
 * cancel the session, and announcements (ANIM).
 */
export function useScalarPlayback({
  items,
  scalarControlEvaluations,
  executeCommand,
  dispatchHistory,
  reducedMotion,
}: ScalarPlaybackOptions): ScalarPlayback {
  const pausedPlaybacks = useRef(new Map<string, PausedScalarPlayback>())
  /** Names every slider whose value belongs to the open playback transaction. */
  const playbackSessionNames = useRef(new Map<string, string>())
  const [activePlaybacks, setActivePlaybacks] = useState<
    ReadonlyMap<string, ActiveScalarPlayback>
  >(() => new Map())
  const [announcement, setAnnouncement] = useState('')

  const stop = useCallback((itemId: string) => {
    const playback = activePlaybacks.get(itemId)
    if (!playback) return
    pausedPlaybacks.current.set(itemId, {
      itemId,
      name: playback.name,
      offsetMilliseconds:
        performance.now() - playback.startedAt + playback.offsetMilliseconds,
      parameters: playback.parameters,
    })
    const next = new Map(activePlaybacks)
    next.delete(itemId)
    if (next.size === 0) {
      dispatchHistory({ type: 'commit-transaction' })
      playbackSessionNames.current.clear()
    }
    setAnnouncement(`${playback.name} animation paused.`)
    setActivePlaybacks(next)
  }, [activePlaybacks, dispatchHistory])

  const stopAll = useCallback(() => {
    if (activePlaybacks.size === 0) return
    const names = [...activePlaybacks.values()].map((playback) => playback.name)
    dispatchHistory({ type: 'commit-transaction' })
    pausedPlaybacks.current.clear()
    playbackSessionNames.current.clear()
    setAnnouncement(`${animationSubject(names)} stopped.`)
    setActivePlaybacks(new Map())
  }, [activePlaybacks, dispatchHistory])

  const cancelSession = useCallback(() => {
    if (activePlaybacks.size === 0) return
    const names = [...playbackSessionNames.current.values()]
    for (const itemId of playbackSessionNames.current.keys()) {
      pausedPlaybacks.current.delete(itemId)
    }
    playbackSessionNames.current.clear()
    dispatchHistory({ type: 'cancel-transaction' })
    setAnnouncement(`${animationSubject(names)} cancelled.`)
    setActivePlaybacks(new Map())
  }, [activePlaybacks, dispatchHistory])

  const start = (
    item: ExpressionItem,
    parameters: PlaybackParameters,
    currentValue: number,
  ) => {
    if (activePlaybacks.size === 0) {
      dispatchHistory({ type: 'boundary' })
      dispatchHistory({ type: 'begin-transaction' })
      playbackSessionNames.current.clear()
    }
    const currentOffset = scalarPlaybackOffset(parameters, currentValue)
    const duration = parameters.animation.durationSeconds * 1000
    const resumable = pausedPlaybacks.current.get(item.id) ?? null
    pausedPlaybacks.current.delete(item.id)
    const name = declaredName(item.source) ?? 'Scalar'
    playbackSessionNames.current.set(item.id, name)
    setActivePlaybacks((current) => new Map(current).set(item.id, {
      itemId: item.id,
      name,
      startedAt: performance.now(),
      offsetMilliseconds: resumable?.offsetMilliseconds ?? (
        parameters.animation.mode === 'once' && currentOffset >= duration
          ? 0
          : currentOffset
      ),
      parameters,
    }))
    setAnnouncement(
      `${name} animation started.${
        reducedMotion ? ' Reduced motion preference is active.' : ''
      }`,
    )
  }

  useEffect(() => {
    if (activePlaybacks.size === 0) return
    const next = new Map(activePlaybacks)
    const stopped: ActiveScalarPlayback[] = []
    let changed = false
    for (const [itemId, playback] of activePlaybacks) {
      const item = items.find((candidate) => candidate.id === itemId)
      if (!item) {
        next.delete(itemId)
        pausedPlaybacks.current.delete(itemId)
        stopped.push(playback)
        changed = true
        continue
      }
      const control = item?.control
      if (!control) continue
      const evaluation = scalarControlEvaluations.get(itemId)
      if (control.mode !== 'slider' ||
          !evaluation || evaluation.status === 'invalid') {
        next.delete(itemId)
        pausedPlaybacks.current.delete(itemId)
        stopped.push(playback)
        changed = true
        continue
      }
      const parameters: PlaybackParameters = {
        minimum: evaluation.minimum!,
        maximum: evaluation.maximum!,
        step: evaluation.step!,
        animation: control.animation ?? DEFAULT_SCALAR_ANIMATION,
      }
      if (!playbackParametersEqual(playback.parameters, parameters)) {
        next.set(itemId, { ...playback, parameters })
        changed = true
      }
    }
    if (!changed) return
    if (stopped.length > 0) {
      const names = stopped.map((playback) => playback.name)
      setAnnouncement(stopped.length === 1
        ? `${names[0]} animation stopped because its interval became invalid.`
        : `${naturalList(names)} animations stopped because their intervals became invalid.`)
      if (next.size === 0) {
        dispatchHistory({ type: 'commit-transaction' })
        playbackSessionNames.current.clear()
      }
    }
    setActivePlaybacks(next)
  }, [activePlaybacks, items, scalarControlEvaluations, dispatchHistory])

  useEffect(() => {
    if (activePlaybacks.size === 0) return
    let frame = 0
    const tick = (now: number) => {
      const completed: ActiveScalarPlayback[] = []
      for (const playback of activePlaybacks.values()) {
        const result = scalarPlaybackFrame(
          playback.parameters,
          now - playback.startedAt + playback.offsetMilliseconds,
        )
        executeCommand({
          kind: 'set-scalar-value', itemId: playback.itemId,
          value: result.value,
        })
        if (result.completed) completed.push(playback)
      }
      if (completed.length > 0) {
        const next = new Map(activePlaybacks)
        for (const playback of completed) {
          next.delete(playback.itemId)
          pausedPlaybacks.current.delete(playback.itemId)
        }
        const names = completed.map((playback) => playback.name)
        setAnnouncement(`${animationSubject(names)} completed.`)
        if (next.size === 0) {
          dispatchHistory({ type: 'commit-transaction' })
          playbackSessionNames.current.clear()
        }
        setActivePlaybacks(next)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [activePlaybacks, executeCommand, dispatchHistory])

  useEffect(() => {
    if (activePlaybacks.size === 0) return
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelSession()
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [activePlaybacks, cancelSession])

  const forgetPaused = useCallback((itemId: string) => {
    pausedPlaybacks.current.delete(itemId)
  }, [])

  return {
    isPlaying: (itemId) => activePlaybacks.has(itemId),
    anyPlaying: activePlaybacks.size > 0,
    start,
    stop,
    stopAll,
    forgetPaused,
    announcement,
  }
}
