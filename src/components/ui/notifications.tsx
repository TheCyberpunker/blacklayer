import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.tsx'
import { Button } from './button.tsx'
import { Input } from './input.tsx'
import { Label } from './label.tsx'
import { cn } from '../../lib/utils.ts'

export interface Toast {
  id: string
  message: string
  tone?: 'default' | 'destructive'
}

export function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: readonly Toast[]
  onDismiss: (id: string) => void
}): JSX.Element {
  return (
    <div
      // On mobile the sticky bottom Protect bar (~72px + safe area) sits at
      // bottom-0, so lift toasts above it. On lg+ there is no sticky bar,
      // so the regular bottom-4 spacing applies.
      className="pointer-events-none fixed right-4 z-[60] flex flex-col gap-2 max-w-[calc(100vw-2rem)] bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-4"
      role="region"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onDismiss(t.id)}
          className={cn(
            'pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg text-left',
            'animate-fade-in min-w-[220px] max-w-[360px]',
            t.tone === 'destructive'
              ? 'border-destructive/40 bg-destructive text-destructive-foreground'
              : 'border-border bg-popover text-popover-foreground',
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  )
}

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  destructive?: boolean
}

export function ConfirmDialog({
  open,
  options,
  onResult,
}: {
  open: boolean
  options: ConfirmOptions | null
  onResult: (ok: boolean) => void
}): JSX.Element | null {
  if (!options) return null
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onResult(false) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          {options.body && <DialogDescription>{options.body}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onResult(false)}>
            {options.cancelLabel}
          </Button>
          <Button
            variant={options.destructive ? 'destructive' : 'default'}
            onClick={() => onResult(true)}
            autoFocus
          >
            {options.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface PromptOptions {
  title: string
  body?: string
  inputLabel: string
  defaultValue?: string
  placeholder?: string
  confirmLabel: string
  cancelLabel: string
}

export function PromptDialog({
  open,
  options,
  onResult,
}: {
  open: boolean
  options: PromptOptions | null
  onResult: (value: string | null) => void
}): JSX.Element | null {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(options?.defaultValue ?? '')
      // Focus after Radix opens the dialog and mounts the input.
      const id = window.setTimeout(() => inputRef.current?.select(), 30)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [open, options?.defaultValue])

  if (!options) return null

  const submit = () => {
    const v = value.trim()
    onResult(v.length ? v : null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onResult(null) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          {options.body && <DialogDescription>{options.body}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="prompt-dialog-input">{options.inputLabel}</Label>
            <Input
              id="prompt-dialog-input"
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={options.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onResult(null)}>
              {options.cancelLabel}
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {options.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
