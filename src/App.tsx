import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  Eraser,
  FileText,
  ImageIcon,
  Languages,
  Monitor,
  Moon,
  Shield,
  Sun,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { applyPdfWatermark, inspectPdf } from './core/pdf/watermark.ts'
import { applyImageWatermark } from './core/image/watermark.ts'
import { profileFor, type ProtectionLevel, type RedactionRect } from './core/types.ts'
import { renderBase, type RenderedBase } from './core/preview/render.ts'
import { composite } from './core/preview/composite.ts'
import { Button } from './components/ui/button.tsx'
import { Input } from './components/ui/input.tsx'
import { Label } from './components/ui/label.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.tsx'
import { useTheme, type Theme } from './hooks/use-theme.ts'
import { useLang } from './hooks/use-lang.ts'
import { useDebounced } from './hooks/use-debounced.ts'
import { getStrings } from './locales/strings.ts'
import { cn } from './lib/utils.ts'

type LoadedFile = {
  file: File
  kind: 'pdf' | 'image'
  base: RenderedBase
  hasSignature: boolean
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
const LEVELS: ProtectionLevel[] = ['basic', 'recommended', 'maximum']
const MIN_RECT = 0.008 // 0.8% of the base dimension

const detectKind = (file: File): 'pdf' | 'image' | null => {
  const t = file.type.toLowerCase()
  if (t === 'application/pdf') return 'pdf'
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp') return 'image'
  return null
}

const suggestOutputName = (name: string, kind: 'pdf' | 'image'): string => {
  const dot = name.lastIndexOf('.')
  const base = dot >= 0 ? name.slice(0, dot) : name
  const ext = kind === 'pdf' ? 'pdf' : dot >= 0 ? name.slice(dot + 1) : 'png'
  return `${base}-blacklayer.${ext}`
}

const todayIso = (): string => {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const nextId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`

export function App(): JSX.Element {
  const { lang, setLang } = useLang()
  const { theme, setTheme } = useTheme()
  const t = useMemo(() => getStrings(lang), [lang])

  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [recipient, setRecipient] = useState('')
  const [purpose, setPurpose] = useState('')
  const [level, setLevel] = useState<ProtectionLevel>('recommended')
  const [redactions, setRedactions] = useState<RedactionRect[]>([])
  const [redactMode, setRedactMode] = useState(false)
  const [activeRect, setActiveRect] = useState<RedactionRect | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string>('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const debouncedRecipient = useDebounced(recipient, 80)
  const debouncedPurpose = useDebounced(purpose, 80)

  const previewProfile = useMemo(
    () =>
      profileFor(level, {
        recipient: debouncedRecipient.trim() || (lang === 'es' ? 'DESTINATARIO' : 'RECIPIENT'),
        purpose: debouncedPurpose.trim() || (lang === 'es' ? 'MOTIVO' : 'PURPOSE'),
        date: todayIso(),
      }),
    [level, debouncedRecipient, debouncedPurpose, lang],
  )

  // Live redraw on any relevant change.
  useEffect(() => {
    if (!loaded || !canvasRef.current) return
    composite({
      target: canvasRef.current,
      base: loaded.base,
      options: previewProfile.watermark,
      lang,
      redactions,
      activeRect,
    })
  }, [loaded, previewProfile, lang, redactions, activeRect])

  const clearOutput = useCallback(() => {
    setOutputUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setOutputName('')
  }, [])

  const onFiles = useCallback(
    async (list: FileList | null | undefined) => {
      const f = list?.[0]
      if (!f) return
      setError(null)
      clearOutput()
      const kind = detectKind(f)
      if (!kind) {
        setError(t.errors.unsupported)
        return
      }
      setLoading(true)
      try {
        const base = await renderBase(f)
        let hasSignature = false
        if (kind === 'pdf') {
          try {
            const info = await inspectPdf(await f.arrayBuffer())
            hasSignature = info.hasSignature
          } catch {
            // best-effort
          }
        }
        setLoaded({ file: f, kind, base, hasSignature })
        setRedactions([])
        setRedactMode(false)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`${t.errors.failed}: ${msg}`)
      } finally {
        setLoading(false)
      }
    },
    [t, clearOutput],
  )

  const clearDoc = useCallback(() => {
    if (loaded) loaded.base.bitmap.close?.()
    setLoaded(null)
    setRecipient('')
    setPurpose('')
    setLevel('recommended')
    setRedactions([])
    setRedactMode(false)
    clearOutput()
    setError(null)
  }, [loaded, clearOutput])

  const protect = useCallback(async () => {
    if (!loaded) return
    setWorking(true)
    setError(null)
    try {
      const profile = profileFor(level, {
        recipient: recipient.trim() || (lang === 'es' ? 'DESTINATARIO' : 'RECIPIENT'),
        purpose: purpose.trim() || (lang === 'es' ? 'MOTIVO' : 'PURPOSE'),
        date: todayIso(),
      })
      let blob: Blob
      if (loaded.kind === 'pdf') {
        const buf = await loaded.file.arrayBuffer()
        const redactionsByPage =
          redactions.length > 0 ? new Map<number, readonly RedactionRect[]>([[0, redactions]]) : undefined
        const { bytes } = await applyPdfWatermark({
          source: buf,
          profile,
          lang,
          redactionsByPage,
        })
        blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })
      } else {
        const outType =
          loaded.file.type === 'image/jpeg'
            ? 'image/jpeg'
            : loaded.file.type === 'image/webp'
              ? 'image/webp'
              : 'image/png'
        blob = await applyImageWatermark({
          source: loaded.file,
          profile,
          lang,
          redactions,
          outputType: outType,
        })
      }
      clearOutput()
      const url = URL.createObjectURL(blob)
      setOutputUrl(url)
      setOutputName(suggestOutputName(loaded.file.name, loaded.kind))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${t.errors.failed}: ${msg}`)
    } finally {
      setWorking(false)
    }
  }, [loaded, level, recipient, purpose, lang, redactions, t, clearOutput])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault()
      setDragActive(false)
      onFiles(e.dataTransfer.files)
    },
    [onFiles],
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    setDragActive(true)
  }, [])

  // ---------- Redaction pointer handlers ----------

  const canvasToNormalized = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const x = (clientX - rect.left) / rect.width
      const y = (clientY - rect.top) / rect.height
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      }
    },
    [],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!redactMode || !loaded) return
      e.preventDefault()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return
      dragStartRef.current = p
      setActiveRect({ id: 'active', x: p.x, y: p.y, w: 0, h: 0 })
    },
    [redactMode, loaded, canvasToNormalized],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!redactMode || !dragStartRef.current) return
      const p = canvasToNormalized(e.clientX, e.clientY)
      if (!p) return
      const start = dragStartRef.current
      setActiveRect({
        id: 'active',
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      })
    },
    [redactMode, canvasToNormalized],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!redactMode) return
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      const rect = activeRect
      dragStartRef.current = null
      setActiveRect(null)
      if (!rect) return
      if (rect.w < MIN_RECT || rect.h < MIN_RECT) return
      setRedactions((prev) => [...prev, { ...rect, id: nextId() }])
    },
    [redactMode, activeRect],
  )

  const undoRedaction = useCallback(() => {
    setRedactions((prev) => prev.slice(0, -1))
  }, [])

  const clearRedactions = useCallback(() => {
    setRedactions([])
    setActiveRect(null)
  }, [])

  const canProtect = !!loaded && !!recipient.trim() && !!purpose.trim() && !working

  return (
    <div className="min-h-screen flex flex-col">
      <Header lang={lang} onLangChange={setLang} theme={theme} onThemeChange={setTheme} strings={t} />

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 pt-6 pb-16">
        {!loaded && !loading && (
          <HeroDrop
            dragActive={dragActive}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={() => setDragActive(false)}
            onFiles={onFiles}
            strings={t}
            error={error}
          />
        )}

        {loading && (
          <div className="flex items-center justify-center py-32">
            <div className="text-sm text-muted-foreground animate-pulse">
              {lang === 'es' ? 'Cargando documento…' : 'Loading document…'}
            </div>
          </div>
        )}

        {loaded && !loading && (
          <Workspace
            loaded={loaded}
            canvasRef={canvasRef}
            recipient={recipient}
            purpose={purpose}
            level={level}
            onLevelChange={setLevel}
            onRecipient={setRecipient}
            onPurpose={setPurpose}
            onClear={clearDoc}
            onProtect={protect}
            canProtect={canProtect}
            working={working}
            outputUrl={outputUrl}
            outputName={outputName}
            error={error}
            strings={t}
            previewMetadataMode={previewProfile.metadata}
            redactMode={redactMode}
            onToggleRedactMode={() => setRedactMode((v) => !v)}
            redactionsCount={redactions.length}
            onUndoRedaction={undoRedaction}
            onClearRedactions={clearRedactions}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )}
      </main>

      <footer className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono tracking-tight">BlackLayer</span>
          <span>{t.footer.tagline}</span>
        </div>
      </footer>
    </div>
  )
}

// ---------- Header ----------

interface HeaderProps {
  lang: 'en' | 'es'
  onLangChange: (l: 'en' | 'es') => void
  theme: Theme
  onThemeChange: (t: Theme) => void
  strings: ReturnType<typeof getStrings>
}

function Header({ lang, onLangChange, theme, onThemeChange, strings }: HeaderProps): JSX.Element {
  return (
    <header className="border-b border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight">BlackLayer</span>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground border border-border/60 rounded px-2 py-0.5">
            <Shield className="h-3 w-3" />
            Local
          </span>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={strings.header.langLabel}>
                <Languages className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase">{lang}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onLangChange('en')}>English</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onLangChange('es')}>Español</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={strings.header.themeLabel}>
                {theme === 'dark' ? (
                  <Moon className="h-4 w-4" />
                ) : theme === 'light' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Monitor className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onThemeChange('system')}>
                <Monitor className="h-4 w-4 mr-2" />
                {strings.header.themeSystem}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onThemeChange('light')}>
                <Sun className="h-4 w-4 mr-2" />
                {strings.header.themeLight}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onThemeChange('dark')}>
                <Moon className="h-4 w-4 mr-2" />
                {strings.header.themeDark}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

// ---------- Hero drop ----------

interface HeroDropProps {
  dragActive: boolean
  onDrop: (e: React.DragEvent<HTMLElement>) => void
  onDragOver: (e: React.DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onFiles: (list: FileList | null | undefined) => void
  strings: ReturnType<typeof getStrings>
  error: string | null
}

function HeroDrop({
  dragActive,
  onDrop,
  onDragOver,
  onDragLeave,
  onFiles,
  strings,
  error,
}: HeroDropProps): JSX.Element {
  return (
    <div className="max-w-2xl mx-auto pt-12 pb-8 text-center animate-fade-in">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">
        {strings.hero.title}
      </h1>
      <p className="mt-3 text-muted-foreground text-base sm:text-lg text-balance">
        {strings.hero.subtitle}
      </p>

      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          'mt-10 group block cursor-pointer rounded-2xl border-2 border-dashed transition-colors',
          'px-6 py-16 sm:py-20',
          dragActive
            ? 'border-foreground bg-muted/60'
            : 'border-border hover:border-foreground/40 hover:bg-muted/30',
        )}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-foreground/70 group-hover:text-foreground transition-colors">
            <Upload className="h-6 w-6" />
          </div>
          <div>
            <p className="text-lg font-medium">{strings.hero.dropTitle}</p>
            <p className="text-sm text-muted-foreground mt-1">{strings.hero.dropSub}</p>
          </div>
          <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-1">
            {strings.hero.supported}
          </p>
        </div>
        <input
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>

      <p className="mt-6 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
        <Shield className="h-3 w-3" />
        {strings.hero.privacy}
      </p>

      {error && <p className="mt-6 text-sm text-destructive">{error}</p>}
    </div>
  )
}

// ---------- Workspace ----------

interface WorkspaceProps {
  loaded: LoadedFile
  canvasRef: React.RefObject<HTMLCanvasElement>
  recipient: string
  purpose: string
  level: ProtectionLevel
  onLevelChange: (l: ProtectionLevel) => void
  onRecipient: (v: string) => void
  onPurpose: (v: string) => void
  onClear: () => void
  onProtect: () => void
  canProtect: boolean
  working: boolean
  outputUrl: string | null
  outputName: string
  error: string | null
  strings: ReturnType<typeof getStrings>
  previewMetadataMode: 'preserve' | 'neutralize'
  redactMode: boolean
  onToggleRedactMode: () => void
  redactionsCount: number
  onUndoRedaction: () => void
  onClearRedactions: () => void
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void
}

function Workspace(props: WorkspaceProps): JSX.Element {
  const {
    loaded,
    canvasRef,
    recipient,
    purpose,
    level,
    onLevelChange,
    onRecipient,
    onPurpose,
    onClear,
    onProtect,
    canProtect,
    working,
    outputUrl,
    outputName,
    error,
    strings,
    previewMetadataMode,
    redactMode,
    onToggleRedactMode,
    redactionsCount,
    onUndoRedaction,
    onClearRedactions,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  } = props

  const sizeKb = (loaded.file.size / 1024).toFixed(1)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-8 animate-fade-in">
      {/* Preview */}
      <section className="min-w-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            {loaded.kind === 'pdf' ? (
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="font-medium truncate" title={loaded.file.name}>
              {loaded.file.name}
            </span>
            <span className="text-xs text-muted-foreground font-mono shrink-0">
              {loaded.kind === 'pdf' ? `${strings.workspace.pageCount(loaded.base.pageCount)} · ` : ''}
              {strings.workspace.fileSize(sizeKb)}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-4 w-4" />
            {strings.workspace.clear}
          </Button>
        </div>

        <div
          className={cn(
            'rounded-xl border bg-muted/30 p-3 sm:p-4 transition-colors',
            redactMode ? 'border-foreground/60' : 'border-border',
          )}
        >
          <div className="relative w-full aspect-[3/4] sm:aspect-auto sm:min-h-[520px] bg-white rounded-lg overflow-hidden shadow-sm">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={cn(
                'absolute inset-0 w-full h-full object-contain touch-none select-none',
                redactMode ? 'cursor-crosshair' : '',
              )}
            />
            {redactMode && (
              <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 text-white text-[10px] font-mono uppercase tracking-wider px-2 py-1">
                {strings.workspace.redactSectionTitle}
              </div>
            )}
          </div>
          {loaded.kind === 'pdf' && loaded.base.pageCount > 1 && (
            <p className="mt-2 text-[11px] text-muted-foreground font-mono uppercase tracking-wider text-center">
              page 1 preview · watermark applied to all {loaded.base.pageCount} pages on download
            </p>
          )}
        </div>
      </section>

      {/* Controls */}
      <aside className="lg:sticky lg:top-20 lg:self-start space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{strings.workspace.protectionTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{strings.workspace.protectionHelper}</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recipient">{strings.workspace.recipient}</Label>
            <Input
              id="recipient"
              value={recipient}
              onChange={(e) => onRecipient(e.target.value)}
              placeholder={strings.workspace.recipientPh}
              autoComplete="off"
              maxLength={80}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="purpose">{strings.workspace.purpose}</Label>
            <Input
              id="purpose"
              value={purpose}
              onChange={(e) => onPurpose(e.target.value)}
              placeholder={strings.workspace.purposePh}
              autoComplete="off"
              maxLength={80}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>{strings.workspace.levelHeading}</Label>
          <LevelPicker level={level} onChange={onLevelChange} strings={strings} />
          <p className="text-xs text-muted-foreground pt-0.5">
            {strings.workspace.levelDescription[level]}
          </p>
          {previewMetadataMode === 'neutralize' && (
            <p className="text-xs text-muted-foreground/80 font-mono">
              {strings.workspace.metadataNoteRemoved}
            </p>
          )}
        </div>

        {/* Redaction */}
        <div className="space-y-2 pt-1 border-t border-border/60">
          <div className="flex items-center justify-between pt-3">
            <Label>{strings.workspace.redactSectionTitle}</Label>
            {redactionsCount > 0 && (
              <span className="text-[11px] font-mono text-muted-foreground">
                {strings.workspace.redactCount(redactionsCount)}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant={redactMode ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleRedactMode}
              className="flex-1"
            >
              {redactMode ? (
                <>
                  <Check className="h-4 w-4" />
                  {strings.workspace.redactStop}
                </>
              ) : (
                <>
                  <Eraser className="h-4 w-4" />
                  {strings.workspace.redactStart}
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onUndoRedaction}
              disabled={redactionsCount === 0}
              aria-label={strings.workspace.redactUndo}
              title={strings.workspace.redactUndo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearRedactions}
              disabled={redactionsCount === 0}
            >
              {strings.workspace.redactClear}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {redactMode ? strings.workspace.redactHint : ''}
          </p>
          {loaded.kind === 'pdf' && loaded.base.pageCount > 1 && (
            <p className="text-[11px] text-muted-foreground/80 font-mono">
              {strings.workspace.redactPdfLimitation}
            </p>
          )}
        </div>

        {loaded.kind === 'pdf' && loaded.hasSignature && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
            <span>{strings.workspace.signatureWarning}</span>
          </div>
        )}

        <Button onClick={onProtect} disabled={!canProtect} size="lg" className="w-full">
          {working ? strings.workspace.working : strings.workspace.protect}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {outputUrl && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3 animate-fade-in">
            <div>
              <p className="text-sm font-semibold">{strings.result.ready}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{strings.result.readySub}</p>
            </div>
            <a
              href={outputUrl}
              download={outputName}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 h-10 px-4',
                'rounded-md bg-primary text-primary-foreground text-sm font-medium',
                'hover:bg-primary/90 transition-colors',
              )}
            >
              <Download className="h-4 w-4" />
              {strings.result.download}
            </a>
            <ul className="text-xs text-muted-foreground space-y-1 pt-1">
              <AppliedItem>{strings.result.appliedRecipient}</AppliedItem>
              <AppliedItem>{strings.result.appliedPurpose}</AppliedItem>
              <AppliedItem>
                {level === 'basic' ? strings.result.appliedSingle : strings.result.appliedTiled}
              </AppliedItem>
              {previewMetadataMode === 'neutralize' && (
                <AppliedItem>{strings.result.appliedMetadata}</AppliedItem>
              )}
              {redactionsCount > 0 && (
                <AppliedItem>{strings.result.appliedRedactions(redactionsCount)}</AppliedItem>
              )}
              <AppliedItem>{strings.result.appliedLocalOnly}</AppliedItem>
            </ul>
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/60">
              {strings.result.originalNote}
            </p>
          </div>
        )}
      </aside>
    </div>
  )
}

function LevelPicker({
  level,
  onChange,
  strings,
}: {
  level: ProtectionLevel
  onChange: (l: ProtectionLevel) => void
  strings: ReturnType<typeof getStrings>
}): JSX.Element {
  const labels: Record<ProtectionLevel, string> = {
    basic: strings.workspace.levelBasic,
    recommended: strings.workspace.levelRecommended,
    maximum: strings.workspace.levelMaximum,
  }
  return (
    <div
      role="radiogroup"
      aria-label={strings.workspace.levelHeading}
      className="grid grid-cols-3 gap-1 p-1 rounded-md bg-muted"
    >
      {LEVELS.map((l) => {
        const selected = l === level
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(l)}
            className={cn(
              'h-8 text-xs font-medium rounded transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {labels[l]}
          </button>
        )
      })}
    </div>
  )
}

function AppliedItem({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1 h-1 w-1 rounded-full bg-foreground/60 shrink-0" />
      <span>{children}</span>
    </li>
  )
}
