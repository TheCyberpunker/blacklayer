import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Button } from './button.tsx'
import { cn } from '../../lib/utils.ts'

export interface OnboardingStep {
  /** CSS selector for the element to highlight. */
  target: string
  title: string
  body: string
  /**
   * Preferred side to place the tooltip relative to the target. Falls back to
   * the opposite side if there is not enough room on-screen.
   */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /**
   * Called when the step becomes active, BEFORE the target is queried. Use it
   * to switch app state so the target actually renders (e.g. change a tab).
   * Runs on every enter, including when the user navigates back to the step.
   */
  onEnter?: () => void
}

export interface OnboardingProps {
  steps: readonly OnboardingStep[]
  active: boolean
  onDone: () => void
  labels: {
    step: (current: number, total: number) => string
    prev: string
    next: string
    done: string
    skip: string
  }
}

/**
 * Contextual first-run tour. Renders a fixed backdrop with a "hole" cut around
 * the current step's target, plus a small tooltip card with title/body and
 * Prev/Next/Skip. Uses `box-shadow` for the cut-out so a single element covers
 * the whole viewport without SVG masks or clip-paths.
 *
 * If a step's target cannot be found in the DOM (e.g. it's conditionally
 * rendered and the user hasn't triggered that condition), the step is skipped
 * automatically after a short poll timeout.
 */
export function Onboarding({ steps, active, onDone, labels }: OnboardingProps): JSX.Element | null {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [notFound, setNotFound] = useState(false)

  // Resolve the target element on step change. Poll for a few seconds AND
  // watch the DOM via MutationObserver so (a) a target that mounts late
  // still connects, and (b) if the current target disappears mid-step (e.g.
  // hero drop zone vanishing after the user drops a file), we auto-advance.
  useEffect(() => {
    if (!active) return
    // Let the step prime the UI (e.g. switch sidebar tab) before we query.
    steps[step]?.onEnter?.()
    let cancelled = false
    let attempts = 0
    const maxAttempts = 100 // ~10 s at 100 ms
    let liveTarget: HTMLElement | null = null
    let observer: MutationObserver | null = null

    const measure = (target: HTMLElement): void => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      window.setTimeout(() => {
        if (cancelled) return
        setRect(target.getBoundingClientRect())
      }, 220)
    }

    const tryFind = (): boolean => {
      if (cancelled) return true
      const target = document.querySelector(steps[step]!.target) as HTMLElement | null
      if (target) {
        liveTarget = target
        setNotFound(false)
        measure(target)
        return true
      }
      return false
    }

    const checkStillThere = (): void => {
      if (cancelled || !liveTarget) return
      if (!document.body.contains(liveTarget)) {
        // Current target has been unmounted (e.g. dropped a file so the
        // hero disappeared). If more steps remain, advance; otherwise finish.
        liveTarget = null
        if (step < steps.length - 1) {
          setStep(step + 1)
        } else {
          setNotFound(true)
        }
      }
    }

    setRect(null)
    observer = new MutationObserver(() => {
      if (!liveTarget) {
        tryFind()
      } else {
        checkStillThere()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    if (!tryFind()) {
      const poll = (): void => {
        if (cancelled || liveTarget) return
        if (tryFind()) return
        attempts++
        if (attempts >= maxAttempts) {
          // Target genuinely didn't appear (e.g. conditional section). If
          // there are more steps, skip forward instead of dead-ending.
          if (step < steps.length - 1) setStep(step + 1)
          else setNotFound(true)
          return
        }
        window.setTimeout(poll, 100)
      }
      window.setTimeout(poll, 100)
    }
    return () => {
      cancelled = true
      if (observer) observer.disconnect()
    }
  }, [active, step, steps])

  // Re-measure on resize or scroll so the highlight follows the target.
  useLayoutEffect(() => {
    if (!active) return
    const onChange = (): void => {
      const target = document.querySelector(steps[step]!.target) as HTMLElement | null
      if (target) setRect(target.getBoundingClientRect())
    }
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [active, step, steps])

  // Keyboard: Esc to skip, Enter/Right to advance, Left to go back.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onDone() }
      else if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (step >= steps.length - 1) onDone()
        else setStep(step + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (step > 0) setStep(step - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, step, steps.length, onDone])

  const finish = useCallback(() => {
    setStep(0)
    setRect(null)
    onDone()
  }, [onDone])

  if (!active) return null
  const current = steps[step]
  if (!current) return null

  // If the target genuinely does not exist, silently end the tour instead of
  // blocking the app with an unmovable backdrop.
  if (notFound) {
    return null
  }
  if (!rect) return null

  const pad = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Prefer the side asked for, fall back if there is no room.
  const wantSide = current.side ?? 'bottom'
  const roomBottom = vh - rect.bottom
  const roomTop = rect.top
  const roomLeft = rect.left
  const roomRight = vw - rect.right
  const cardEstW = 340
  const cardEstH = 180
  let side = wantSide
  if (side === 'bottom' && roomBottom < cardEstH + 24) side = 'top'
  if (side === 'top' && roomTop < cardEstH + 24) side = 'bottom'
  if (side === 'right' && roomRight < cardEstW + 24) side = 'left'
  if (side === 'left' && roomLeft < cardEstW + 24) side = 'right'

  let cardTop = 0
  let cardLeft = 0
  if (side === 'bottom') {
    cardTop = rect.bottom + pad + 8
    cardLeft = Math.max(16, Math.min(vw - cardEstW - 16, rect.left))
  } else if (side === 'top') {
    cardTop = Math.max(16, rect.top - pad - 8 - cardEstH)
    cardLeft = Math.max(16, Math.min(vw - cardEstW - 16, rect.left))
  } else if (side === 'right') {
    cardTop = Math.max(16, Math.min(vh - cardEstH - 16, rect.top))
    cardLeft = Math.min(vw - cardEstW - 16, rect.right + pad + 8)
  } else {
    cardTop = Math.max(16, Math.min(vh - cardEstH - 16, rect.top))
    cardLeft = Math.max(16, rect.left - pad - 8 - cardEstW)
  }

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none" role="dialog" aria-modal="true" aria-label={current.title}>
      <div
        className="absolute rounded-lg pointer-events-none transition-all duration-200 ease-out"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: '0 0 0 9999px rgba(17,24,39,0.6)',
        }}
      />
      <div
        className={cn(
          'absolute pointer-events-auto rounded-lg border border-border bg-popover text-popover-foreground p-4 shadow-lg animate-fade-in',
          'w-[340px] max-w-[calc(100vw-2rem)]',
        )}
        style={{ top: cardTop, left: cardLeft }}
      >
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {labels.step(step + 1, steps.length)}
        </div>
        <h4 className="text-sm font-semibold mt-1 leading-tight">{current.title}</h4>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{current.body}</p>
        <div className="flex items-center justify-between mt-3 gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {labels.skip}
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
                {labels.prev}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => (step >= steps.length - 1 ? finish() : setStep(step + 1))}
            >
              {step >= steps.length - 1 ? labels.done : labels.next}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
