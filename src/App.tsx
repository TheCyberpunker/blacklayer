import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  FileText,
  ImageIcon,
  Languages,
  Monitor,
  Moon,
  Shield,
  Sun,
  Upload,
  X,
} from 'lucide-react'
import { applyPdfWatermark } from './core/pdf/watermark.ts'
import { applyImageWatermark } from './core/image/watermark.ts'
import { defaultWatermarkOptions } from './core/types.ts'
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
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'

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

export function App(): JSX.Element {
  const { lang, setLang } = useLang()
  const { theme, setTheme } = useTheme()
  const t = useMemo(() => getStrings(lang), [lang])

  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [recipient, setRecipient] = useState('')
  const [purpose, setPurpose] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string>('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const debouncedRecipient = useDebounced(recipient, 80)
  const debouncedPurpose = useDebounced(purpose, 80)

  const options = useMemo(
    () =>
      defaultWatermarkOptions({
        recipient: debouncedRecipient.trim() || (lang === 'es' ? 'DESTINATARIO' : 'RECIPIENT'),
        purpose: debouncedPurpose.trim() || (lang === 'es' ? 'MOTIVO' : 'PURPOSE'),
        date: todayIso(),
      }),
    [debouncedRecipient, debouncedPurpose, lang],
  )

  // Live redraw on every relevant change.
  useEffect(() => {
    if (!loaded || !canvasRef.current) return
    composite({ target: canvasRef.current, base: loaded.base, options, lang })
  }, [loaded, options, lang])

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
        setLoaded({ file: f, kind, base })
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
    clearOutput()
    setError(null)
  }, [loaded, clearOutput])

  const protect = useCallback(async () => {
    if (!loaded) return
    setWorking(true)
    setError(null)
    try {
      const realOptions = defaultWatermarkOptions({
        recipient: recipient.trim() || (lang === 'es' ? 'DESTINATARIO' : 'RECIPIENT'),
        purpose: purpose.trim() || (lang === 'es' ? 'MOTIVO' : 'PURPOSE'),
        date: todayIso(),
      })
      let blob: Blob
      if (loaded.kind === 'pdf') {
        const buf = await loaded.file.arrayBuffer()
        const bytes = await applyPdfWatermark({ source: buf, options: realOptions, lang })
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
          options: realOptions,
          lang,
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
  }, [loaded, recipient, purpose, lang, t, clearOutput])

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

  const canProtect = !!loaded && !!recipient.trim() && !!purpose.trim() && !working

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        lang={lang}
        onLangChange={setLang}
        theme={theme}
        onThemeChange={setTheme}
        strings={t}
      />

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

      {error && (
        <p className="mt-6 text-sm text-destructive">{error}</p>
      )}
    </div>
  )
}

// ---------- Workspace ----------

interface WorkspaceProps {
  loaded: LoadedFile
  canvasRef: React.RefObject<HTMLCanvasElement>
  recipient: string
  purpose: string
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
}

function Workspace(props: WorkspaceProps): JSX.Element {
  const {
    loaded,
    canvasRef,
    recipient,
    purpose,
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
  } = props

  const sizeKb = (loaded.file.size / 1024).toFixed(1)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-8 animate-fade-in">
      {/* Preview */}
      <section className="min-w-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm">
            {loaded.kind === 'pdf' ? (
              <FileText className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium truncate max-w-xs" title={loaded.file.name}>
              {loaded.file.name}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {loaded.kind === 'pdf' ? strings.workspace.pageCount(loaded.base.pageCount) : ''}
              {loaded.kind === 'pdf' ? ' · ' : ''}
              {strings.workspace.fileSize(sizeKb)}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-4 w-4" />
            {strings.workspace.clear}
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
          <div className="relative w-full aspect-[3/4] sm:aspect-auto sm:min-h-[520px] bg-white rounded-lg overflow-hidden shadow-sm">
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain"
            />
          </div>
          {loaded.kind === 'pdf' && loaded.base.pageCount > 1 && (
            <p className="mt-2 text-[11px] text-muted-foreground font-mono uppercase tracking-wider text-center">
              {strings.workspace.documentLabel} · page 1 preview · all {loaded.base.pageCount} pages get the watermark on download
            </p>
          )}
        </div>
      </section>

      {/* Controls */}
      <aside className="lg:sticky lg:top-20 lg:self-start space-y-5">
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

        <Button
          onClick={onProtect}
          disabled={!canProtect}
          size="lg"
          className="w-full"
        >
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
              <AppliedItem>{strings.result.appliedTiled}</AppliedItem>
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

function AppliedItem({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1 h-1 w-1 rounded-full bg-foreground/60" />
      <span>{children}</span>
    </li>
  )
}
