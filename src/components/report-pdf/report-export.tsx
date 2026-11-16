'use client'

/**
 * report-export.tsx — "Chuya Informe" actions: download (7F), print (7F) and share (7G) the
 * consultation as a PDF, from the data already on the page. Used by the diagnosis, budget and
 * parts reports alike.
 *
 * - Generated on the device (pdf-lib, loaded on demand): no request to our server, the AI,
 *   SerpApi or any other service; nothing is stored or uploaded; no account; no quota is used.
 * - Privacy: personal data detected in free text is omitted by default; the preview shows what
 *   will be exported and lets the person include their original text or not. Download, print
 *   and share all use the same options and the same model.
 * - Share (Web Share API level 2, files): navigator.share() must run inside the click's user
 *   activation, and Safari loses it across an await. So when the device can share files, the PDF
 *   is PREPARED ahead (debounced, whenever the data or the privacy options change) and the click
 *   shares the ready file synchronously. If the click comes before the file is ready, the file is
 *   prepared and the person taps "Compartir" again. Only the document is shared — never a link
 *   with report data in its parameters. Devices that cannot share files get no share button, a
 *   short explanation and the download.
 * - States: preparing, ready, error, cancelled share (not an error) and "not enough information".
 *   Safety-blocked consultations have no report.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_PRIVACY, detectedPersonalData, type ChuyaReport, type PrivacyOptions, type Readiness } from '@/domain/report/chuya-report'
import { PERSONAL_DATA_LABEL } from '@/domain/report/personal-data'
import { ReportPreview } from './report-preview'

type Status =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'ready'; fileName: string }
  | { kind: 'error' }
  | { kind: 'share_preparing' }
  | { kind: 'share_tap_again' }
  | { kind: 'shared' }
  | { kind: 'share_cancelled' }
  | { kind: 'share_error' }

type ShareSupport = 'unknown' | 'files' | 'none'

const PRINT_ROOT_ID = 'chuya-print-root'
const PRINTING_CLASS = 'chuya-printing'
/** A prepared file older than this is regenerated (its "Generado el" time would be stale). */
const PREPARED_MAX_AGE_MS = 10 * 60 * 1000
const PREPARE_DEBOUNCE_MS = 400
/** Generic text: nothing from the report travels outside the file itself. */
const SHARE_TEXT = 'Informe de Chuya Motor para el taller (PDF).'
/** Fixed date used only to detect changes in the report content. */
const SIGNATURE_DATE = new Date(0)

interface Prepared {
  signature: string
  file: File
  title: string
  at: number
}

function triggerDownload(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke later: some mobile browsers read the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function renderFile(report: ChuyaReport): Promise<File> {
  const { renderReportPdf } = await import('@/domain/report/pdf-renderer')
  const { bytes } = await renderReportPdf(report)
  return new File([bytes as BlobPart], report.fileName, { type: 'application/pdf' })
}

/** Web Share API level 2 with PDF files (checked once on the client; never assumed). */
function detectShareSupport(): ShareSupport {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return 'none'
    const probe = new File([new Uint8Array([37, 80, 68, 70])], 'chuya-informe.pdf', { type: 'application/pdf' })
    return navigator.canShare({ files: [probe] }) ? 'files' : 'none'
  } catch {
    return 'none'
  }
}

export function ReportExport({
  build,
  readiness,
  freeTexts,
}: {
  /** Builds the report model from the page's data (pure, no network). */
  build: (privacy: PrivacyOptions, generatedAt: Date) => ChuyaReport
  readiness: Readiness
  /** The person's free text that would be exported (for the personal data notice). */
  freeTexts: ReadonlyArray<string | null | undefined>
}) {
  const uid = useId()
  const [privacy, setPrivacy] = useState<PrivacyOptions>(DEFAULT_PRIVACY)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [printReport, setPrintReport] = useState<ChuyaReport | null>(null)
  const [shareSupport, setShareSupport] = useState<ShareSupport>('unknown')
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const busy = useRef(false)
  const buildRef = useRef(build)
  buildRef.current = build
  const insufficient = readiness.ok === false
  const detected = useMemo(() => detectedPersonalData(freeTexts), [freeTexts])
  // A failing build must never break the page: actions then report a recoverable error.
  const preview = useMemo(() => {
    if (!previewOpen) return null
    try {
      return build(privacy, new Date())
    } catch {
      return null
    }
  }, [previewOpen, build, privacy])
  // What the document would contain now (without the generation time).
  let signature = ''
  if (!insufficient) {
    try {
      signature = JSON.stringify(build(privacy, SIGNATURE_DATE))
    } catch {
      signature = ''
    }
  }

  useEffect(() => setShareSupport(detectShareSupport()), [])

  // Share-capable devices: keep a ready PDF that matches the current data and privacy options.
  useEffect(() => {
    if (shareSupport !== 'files' || insufficient || !signature || prepared?.signature === signature) return
    let cancelled = false
    const t = window.setTimeout(() => {
      let report: ChuyaReport
      try {
        report = buildRef.current(privacy, new Date())
      } catch {
        return // the share click will retry and report the error
      }
      renderFile(report)
        .then((file) => {
          if (!cancelled) setPrepared({ signature, file, title: report.title, at: Date.now() })
        })
        .catch(() => undefined) // the share click will retry and report the error
    }, PREPARE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [shareSupport, insufficient, signature, privacy, prepared?.signature])

  // Print: render the report into a body-level root, print it, then clean up.
  useEffect(() => {
    if (!printReport) return
    const html = document.documentElement
    const done = () => {
      html.classList.remove(PRINTING_CLASS)
      setPrintReport(null)
    }
    html.classList.add(PRINTING_CLASS)
    window.addEventListener('afterprint', done, { once: true })
    const t = window.setTimeout(() => {
      try {
        window.print()
      } catch {
        done()
      }
    }, 50)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('afterprint', done)
      html.classList.remove(PRINTING_CLASS)
    }
  }, [printReport])

  if (readiness.ok === false && readiness.reason === 'safety_blocked') return null

  async function download() {
    if (busy.current || insufficient) return
    busy.current = true
    setStatus({ kind: 'preparing' })
    try {
      const report = build(privacy, new Date())
      const { renderReportPdf } = await import('@/domain/report/pdf-renderer')
      const { bytes } = await renderReportPdf(report)
      triggerDownload(bytes, report.fileName)
      setStatus({ kind: 'ready', fileName: report.fileName })
    } catch {
      setStatus({ kind: 'error' })
    } finally {
      busy.current = false
    }
  }

  function print() {
    if (insufficient) return
    setPrintReport(build(privacy, new Date()))
  }

  /** Must stay synchronous up to navigator.share(): the call needs this click's activation. */
  function share() {
    if (insufficient || busy.current) return
    const ready = prepared && prepared.signature === signature && Date.now() - prepared.at < PREPARED_MAX_AGE_MS ? prepared : null
    if (!ready) {
      let report: ChuyaReport
      try {
        report = build(privacy, new Date())
      } catch {
        setStatus({ kind: 'share_error' })
        return
      }
      busy.current = true
      setStatus({ kind: 'share_preparing' })
      renderFile(report)
        .then((file) => {
          setPrepared({ signature, file, title: report.title, at: Date.now() })
          setStatus({ kind: 'share_tap_again' })
        })
        .catch(() => setStatus({ kind: 'share_error' }))
        .finally(() => {
          busy.current = false
        })
      return
    }
    let pending: Promise<void>
    try {
      pending = navigator.share({ files: [ready.file], title: ready.title, text: SHARE_TEXT })
    } catch (e) {
      pending = Promise.reject(e)
    }
    busy.current = true
    pending
      .then(() => setStatus({ kind: 'shared' }))
      .catch((e: unknown) => {
        const name = (e as { name?: string } | null)?.name
        if (name === 'AbortError') setStatus({ kind: 'share_cancelled' })
        else if (name === 'NotAllowedError') setStatus({ kind: 'share_tap_again' })
        else setStatus({ kind: 'share_error' })
      })
      .finally(() => {
        busy.current = false
      })
  }

  const btn =
    'inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
  const canShare = shareSupport === 'files' && !insufficient
  const sharing = status.kind === 'share_preparing'

  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-2xl border border-brand-border-light bg-white p-4 shadow-brand-xs sm:p-5" data-testid="report-export">
      <div className="min-w-0">
        <h2 id={`${uid}-title`} className="font-display text-base font-extrabold text-brand-text">Chuya Informe para el taller</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-brand-text-muted">
          {canShare
            ? 'Descargá, compartí o imprimí este resultado en PDF (A4) para tu taller. Se genera en tu dispositivo: no se envía a ningún servidor.'
            : 'Descargá este resultado en PDF (A4) para llevarlo o enviarlo a tu taller. Se genera en tu dispositivo: no se envía a ningún servidor.'}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 min-[480px]:flex min-[480px]:flex-wrap">
        <button type="button" onClick={download} disabled={insufficient || status.kind === 'preparing'} aria-describedby={`${uid}-status`} className={`${btn} bg-brand-primary text-white hover:bg-brand-primary-light`}>
          {status.kind === 'preparing' ? 'Preparando PDF…' : 'Descargar informe PDF'}
        </button>
        {canShare && (
          <button type="button" onClick={share} disabled={sharing} data-ready={prepared?.signature === signature ? 'true' : 'false'} aria-describedby={`${uid}-status ${uid}-share-note`} className={`${btn} border border-brand-primary bg-white text-brand-primary hover:bg-brand-primary-tint`}>
            {sharing ? 'Preparando para compartir…' : 'Compartir informe'}
          </button>
        )}
        <button type="button" onClick={print} disabled={insufficient} className={`${btn} border border-brand-border bg-white text-brand-text hover:bg-brand-bg`}>
          Imprimir informe
        </button>
      </div>

      {canShare && (
        <p id={`${uid}-share-note`} className="mt-2 text-xs text-brand-text-muted" data-testid="report-share-note">
          Al compartir, el PDF se entrega a la app que elijas (por ejemplo, WhatsApp o el correo), bajo sus propias condiciones.
        </p>
      )}
      {shareSupport === 'none' && !insufficient && (
        <p className="mt-2 text-xs text-brand-text-muted" data-testid="report-share-unsupported">
          Este navegador no permite compartir archivos desde la página. Descargá el PDF y compartilo desde tus archivos o desde la app que uses.
        </p>
      )}

      <div id={`${uid}-status`} role="status" aria-live="polite" className="mt-2 text-xs" data-testid="report-export-status">
        {insufficient && <span className="text-brand-text-muted">Todavía no hay información suficiente para armar un informe.</span>}
        {status.kind === 'preparing' && <span className="text-brand-text-muted">Preparando PDF…</span>}
        {status.kind === 'ready' && <span className="text-brand-primary">Descarga lista: {status.fileName}. Podés descargarlo de nuevo cuando quieras.</span>}
        {status.kind === 'error' && <span className="text-red-700">No pudimos generar el PDF. Probá de nuevo o usá «Imprimir informe».</span>}
        {status.kind === 'share_preparing' && <span className="text-brand-text-muted">Preparando el PDF para compartir…</span>}
        {status.kind === 'share_tap_again' && <span className="text-brand-primary">El PDF está listo. Tocá «Compartir informe» de nuevo para elegir la app.</span>}
        {status.kind === 'shared' && <span className="text-brand-primary">Informe compartido.</span>}
        {status.kind === 'share_cancelled' && <span className="text-brand-text-muted">No se compartió el informe. Podés intentarlo de nuevo o descargarlo.</span>}
        {status.kind === 'share_error' && <span className="text-red-700">No pudimos compartir el informe. Descargalo y compartilo desde tus archivos.</span>}
      </div>

      {!insufficient && detected.length > 0 && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="report-personal-data">
          {privacy.redactPersonalData
            ? `Encontramos posibles datos personales en tu texto (${detected.map((k) => PERSONAL_DATA_LABEL[k]).join(', ')}) y los omitimos del informe.`
            : `Tu informe incluirá posibles datos personales (${detected.map((k) => PERSONAL_DATA_LABEL[k]).join(', ')}).`}{' '}
          Revisalo en la vista previa.
        </p>
      )}

      {!insufficient && (
        <div className="mt-3 border-t border-brand-border-light pt-3">
          <button
            type="button"
            aria-expanded={previewOpen}
            aria-controls={`${uid}-preview`}
            onClick={() => setPreviewOpen((v) => !v)}
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <span aria-hidden="true" className={`inline-block transition-transform ${previewOpen ? 'rotate-90' : ''}`}>›</span>
            Vista previa y privacidad
          </button>
          <div id={`${uid}-preview`} hidden={!previewOpen} className="mt-2 space-y-3">
            <fieldset className="space-y-2 rounded-xl bg-brand-bg p-3">
              <legend className="sr-only">Opciones de privacidad del informe</legend>
              <label className="flex min-h-[44px] items-start gap-2 text-sm text-brand-text">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={privacy.redactPersonalData} onChange={(e) => setPrivacy((p) => ({ ...p, redactPersonalData: e.target.checked }))} />
                <span>Omitir datos personales detectados (teléfono, correo, patente, chasis, DNI, nombre o dirección)</span>
              </label>
              <label className="flex min-h-[44px] items-start gap-2 text-sm text-brand-text">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={privacy.includeOriginalText} onChange={(e) => setPrivacy((p) => ({ ...p, includeOriginalText: e.target.checked }))} />
                <span>Incluir mi texto original</span>
              </label>
              <p className="text-xs text-brand-text-muted">La detección es automática y puede no encontrar todo: revisá la vista previa antes de descargar o compartir el informe.</p>
            </fieldset>
            {preview && (
              <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-brand-border-light p-3 sm:p-5" tabIndex={0} aria-label="Vista previa del informe">
                <ReportPreview report={preview} />
              </div>
            )}
          </div>
        </div>
      )}

      {printReport &&
        createPortal(
          <div id={PRINT_ROOT_ID} data-testid="report-print-root">
            <ReportPreview report={printReport} headingLevel={2} />
          </div>,
          document.body,
        )}
    </section>
  )
}
