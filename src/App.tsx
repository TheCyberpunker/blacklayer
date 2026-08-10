import { useCallback, useMemo, useRef, useState } from 'react'
import { applyPdfWatermark } from './core/pdf/watermark'
import { applyImageWatermark } from './core/image/watermark'
import { defaultWatermarkOptions } from './core/types'

type Lang = 'en' | 'es'

type LoadedFile = {
  file: File
  kind: 'pdf' | 'image'
}

const detectKind = (file: File): LoadedFile['kind'] | null => {
  const t = file.type.toLowerCase()
  if (t === 'application/pdf') return 'pdf'
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp') return 'image'
  return null
}

const suggestOutputName = (name: string, kind: LoadedFile['kind']): string => {
  const dot = name.lastIndexOf('.')
  const base = dot >= 0 ? name.slice(0, dot) : name
  const ext = kind === 'pdf' ? 'pdf' : (dot >= 0 ? name.slice(dot + 1) : 'png')
  return `${base}-blacklayer.${ext}`
}

const todayIso = (): string => {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function App(): JSX.Element {
  const [lang, setLang] = useState<Lang>(() => (navigator.language?.startsWith('es') ? 'es' : 'en'))
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [recipient, setRecipient] = useState('')
  const [purpose, setPurpose] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string>('')
  const dropRef = useRef<HTMLDivElement>(null)

  const t = useMemo(() => (lang === 'es' ? esStrings : enStrings), [lang])
  const canProtect = !!loaded && recipient.trim() && purpose.trim() && !working

  const onFile = useCallback((f: File | null | undefined) => {
    setError(null)
    if (outputUrl) URL.revokeObjectURL(outputUrl)
    setOutputUrl(null)
    setOutputName('')
    if (!f) return
    const kind = detectKind(f)
    if (!kind) {
      setError(t.errUnsupported)
      return
    }
    setLoaded({ file: f, kind })
  }, [outputUrl, t])

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dropRef.current?.classList.remove('drop-hot')
    onFile(e.dataTransfer.files?.[0])
  }, [onFile])

  const clearDoc = useCallback(() => {
    if (outputUrl) URL.revokeObjectURL(outputUrl)
    setLoaded(null)
    setRecipient('')
    setPurpose('')
    setOutputUrl(null)
    setOutputName('')
    setError(null)
  }, [outputUrl])

  const protect = useCallback(async () => {
    if (!loaded) return
    setWorking(true)
    setError(null)
    try {
      const options = defaultWatermarkOptions({
        recipient: recipient.trim(),
        purpose: purpose.trim(),
        date: todayIso(),
      })
      let blob: Blob
      if (loaded.kind === 'pdf') {
        const buf = await loaded.file.arrayBuffer()
        const bytes = await applyPdfWatermark({ source: buf, options, lang })
        blob = new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })
      } else {
        const outType = loaded.file.type === 'image/jpeg' ? 'image/jpeg'
          : loaded.file.type === 'image/webp' ? 'image/webp'
          : 'image/png'
        blob = await applyImageWatermark({ source: loaded.file, options, lang, outputType: outType })
      }
      const url = URL.createObjectURL(blob)
      setOutputUrl(url)
      setOutputName(suggestOutputName(loaded.file.name, loaded.kind))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${t.errFailed}: ${msg}`)
    } finally {
      setWorking(false)
    }
  }, [loaded, recipient, purpose, lang, t])

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.wordmark}>BlackLayer</h1>
        <div>
          <button
            type="button"
            style={styles.langBtn}
            onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
            aria-label="Toggle language"
          >
            {lang.toUpperCase()}
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <p style={styles.privacy}>{t.privacy}</p>

        {!loaded && (
          <div
            ref={dropRef}
            style={styles.drop}
            onDragOver={(e) => { e.preventDefault(); dropRef.current?.classList.add('drop-hot') }}
            onDragLeave={() => dropRef.current?.classList.remove('drop-hot')}
            onDrop={onDrop}
          >
            <p style={styles.dropTitle}>{t.dropTitle}</p>
            <p style={styles.dropSub}>{t.dropSub}</p>
            <label style={styles.chooseBtn}>
              {t.choose}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
          </div>
        )}

        {loaded && (
          <section style={styles.workspace}>
            <div style={styles.docCard}>
              <p style={styles.docName}>{loaded.file.name}</p>
              <p style={styles.docMeta}>
                {loaded.kind === 'pdf' ? 'PDF' : 'Image'} · {(loaded.file.size / 1024).toFixed(1)} KB
              </p>
              <button type="button" style={styles.linkBtn} onClick={clearDoc}>{t.clear}</button>
            </div>

            <div style={styles.form}>
              <label style={styles.label}>
                <span>{t.recipient}</span>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={t.recipientPh}
                  style={styles.input}
                  maxLength={80}
                />
              </label>
              <label style={styles.label}>
                <span>{t.purpose}</span>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder={t.purposePh}
                  style={styles.input}
                  maxLength={80}
                />
              </label>

              <button
                type="button"
                onClick={protect}
                disabled={!canProtect}
                style={{ ...styles.primaryBtn, opacity: canProtect ? 1 : 0.5 }}
              >
                {working ? t.working : t.protect}
              </button>

              {error && <p style={styles.error}>{error}</p>}

              {outputUrl && (
                <div style={styles.result}>
                  <p style={styles.resultTitle}>{t.ready}</p>
                  <a href={outputUrl} download={outputName} style={styles.downloadBtn}>
                    {t.download}
                  </a>
                  <p style={styles.originalNote}>{t.originalUntouched}</p>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <footer style={styles.footer}>
        <span>BlackLayer</span>
        <span>·</span>
        <span>{t.footerLocal}</span>
      </footer>
    </div>
  )
}

const enStrings = {
  privacy: 'Your document never leaves this device.',
  dropTitle: 'Drop a document here',
  dropSub: 'PDF, JPG, PNG or WebP',
  choose: 'Choose document',
  recipient: 'Who is this copy for?',
  recipientPh: 'Hotel, lawyer, landlord, company…',
  purpose: 'Why are you sharing it?',
  purposePh: 'Identity verification, hotel check-in…',
  protect: 'Create protected copy',
  working: 'Preparing…',
  ready: 'Your protected copy is ready',
  download: 'Download protected copy',
  originalUntouched: 'Your original document has not been changed.',
  clear: 'Clear document',
  footerLocal: 'Local-first, open source.',
  errUnsupported: 'Unsupported file type. Use PDF, JPG, PNG or WebP.',
  errFailed: 'Could not create protected copy',
}

const esStrings: typeof enStrings = {
  privacy: 'Tus documentos nunca salen de este dispositivo.',
  dropTitle: 'Arrastra un documento aquí',
  dropSub: 'PDF, JPG, PNG o WebP',
  choose: 'Seleccionar documento',
  recipient: '¿Para quién es esta copia?',
  recipientPh: 'Hotel, abogado, arrendador, empresa…',
  purpose: '¿Para qué la vas a compartir?',
  purposePh: 'Verificación de identidad, registro en hotel…',
  protect: 'Crear copia protegida',
  working: 'Preparando…',
  ready: 'Tu copia protegida está lista',
  download: 'Descargar copia protegida',
  originalUntouched: 'El documento original no ha sido modificado.',
  clear: 'Descartar documento',
  footerLocal: 'Local, código abierto.',
  errUnsupported: 'Tipo de archivo no soportado. Usa PDF, JPG, PNG o WebP.',
  errFailed: 'No se pudo crear la copia protegida',
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 960, margin: '0 auto', padding: '32px 24px', minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 24 },
  wordmark: { margin: 0, fontSize: 28, letterSpacing: '-0.02em', fontWeight: 700 },
  langBtn: { background: 'transparent', border: '1px solid currentColor', padding: '6px 12px', borderRadius: 6, fontSize: 12, letterSpacing: '0.05em' },
  main: { flex: 1 },
  privacy: { fontSize: 14, opacity: 0.75, textAlign: 'center', marginTop: 0, marginBottom: 32 },
  drop: { border: '2px dashed rgba(127,127,127,0.4)', borderRadius: 12, padding: '64px 24px', textAlign: 'center' },
  dropTitle: { fontSize: 22, fontWeight: 500, marginBottom: 8, marginTop: 0 },
  dropSub: { fontSize: 14, opacity: 0.6, marginTop: 0, marginBottom: 24 },
  chooseBtn: { display: 'inline-block', padding: '10px 20px', border: '1px solid currentColor', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  workspace: { display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2fr', gap: 32, alignItems: 'start' },
  docCard: { padding: 20, border: '1px solid rgba(127,127,127,0.25)', borderRadius: 10 },
  docName: { margin: 0, fontWeight: 600, fontSize: 14, wordBreak: 'break-all' },
  docMeta: { margin: '4px 0 12px', fontSize: 12, opacity: 0.6 },
  linkBtn: { background: 'transparent', border: 'none', padding: 0, textDecoration: 'underline', fontSize: 13, color: 'inherit' },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  label: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 500 },
  input: { padding: '10px 12px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.35)', fontSize: 14, background: 'transparent', color: 'inherit' },
  primaryBtn: { padding: '12px 20px', border: 'none', borderRadius: 6, background: '#111', color: '#fff', fontSize: 15, fontWeight: 500 },
  error: { color: '#b91c1c', fontSize: 13, margin: 0 },
  result: { marginTop: 8, padding: 16, border: '1px solid rgba(127,127,127,0.25)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 },
  resultTitle: { margin: 0, fontWeight: 600, fontSize: 15 },
  downloadBtn: { display: 'inline-block', padding: '10px 16px', background: '#111', color: '#fff', textDecoration: 'none', borderRadius: 6, textAlign: 'center', fontSize: 14 },
  originalNote: { margin: 0, fontSize: 12, opacity: 0.6 },
  footer: { marginTop: 32, paddingTop: 16, borderTop: '1px solid rgba(127,127,127,0.15)', display: 'flex', gap: 8, justifyContent: 'center', fontSize: 12, opacity: 0.5 },
}
