/**
 * report-preview.tsx — HTML rendering of the Chuya Informe model (7F). Used for the on-screen
 * preview and for "Imprimir informe" (the browser's own print, which also yields a tagged,
 * accessible PDF via "Guardar como PDF"). Same model as the downloaded PDF.
 */
import { PROVENANCE_LABEL, type ChuyaReport, type ReportBlock } from '@/domain/report/chuya-report'

const ALERT_STYLE = {
  critical: 'border-red-700 bg-red-50 text-red-900',
  high: 'border-amber-700 bg-amber-50 text-amber-900',
  info: 'border-brand-primary bg-brand-primary-tint text-brand-primary',
} as const

function Block({ block }: { block: ReportBlock }) {
  switch (block.kind) {
    case 'paragraph':
      return <p className={block.tone === 'muted' ? 'text-sm italic text-brand-text-muted' : block.tone === 'strong' ? 'text-sm font-semibold text-brand-text' : 'text-sm text-brand-text'}>{block.text}</p>
    case 'alert':
      return (
        <div role="note" className={`rounded-lg border-l-4 p-3 ${ALERT_STYLE[block.level]}`}>
          <p className="text-sm font-bold">{block.title}</p>
          {block.lines.map((l, i) => (
            <p key={i} className="text-sm">{l}</p>
          ))}
        </div>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag className={`space-y-1 pl-5 text-sm text-brand-text ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, i) => (
            <li key={i} className="break-words">{item}</li>
          ))}
        </Tag>
      )
    }
    case 'keyValues':
      return (
        // Narrow screens: label above value (a fixed label column squeezes values at 320px).
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm min-[480px]:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] min-[480px]:gap-y-1 print:grid-cols-[10rem_minmax(0,1fr)]">
          {block.rows.map(([k, v], i) => (
            <div key={i} className="contents">
              <dt className="font-semibold text-brand-text-muted">{k}</dt>
              <dd className="break-words text-brand-text">{v}</dd>
            </div>
          ))}
        </dl>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <thead>
              <tr className="bg-brand-primary-tint text-left text-brand-primary">
                {block.columns.map((c, i) => (
                  <th key={i} scope="col" className={`px-2 py-1.5 font-semibold ${block.align?.[i] === 'right' ? 'text-right' : ''}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-brand-border-light">
                  {row.map((cell, i) => (
                    <td key={i} className={`break-words px-2 py-1.5 ${block.align?.[i] === 'right' ? 'text-right tabular-nums' : ''}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'preformatted':
      return <pre className="whitespace-pre-wrap break-words rounded-lg bg-brand-bg p-3 font-mono text-xs leading-relaxed text-brand-text">{block.text}</pre>
    case 'entry':
      return (
        <div className="break-inside-avoid border-l-2 border-brand-border-light pl-3">
          <p className="break-words text-sm font-semibold text-brand-text">{block.title}</p>
          <p className="mt-1 flex flex-wrap gap-1">
            {block.badges.map((b, i) => (
              <span key={i} className="rounded border border-amber-700/40 bg-amber-50 px-1.5 py-0.5 text-2xs font-semibold text-amber-900">{b}</span>
            ))}
          </p>
          {block.lines.map((l, i) => (
            <p key={i} className="break-words text-sm text-brand-text-muted">{l}</p>
          ))}
          {block.link && (
            <p className="break-all text-xs">
              <span className="font-semibold text-brand-text">{block.link.label}: </span>
              <a href={block.link.url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="text-brand-primary underline">{block.link.url}</a>
            </p>
          )}
        </div>
      )
  }
}

export function ReportPreview({ report, headingLevel = 3 }: { report: ChuyaReport; headingLevel?: 2 | 3 }) {
  const Title = headingLevel === 2 ? 'h2' : 'h3'
  const Section = headingLevel === 2 ? 'h3' : 'h4'
  return (
    <article className="space-y-5 bg-white text-brand-text" data-testid="report-preview" lang="es-AR">
      <header className="border-b-2 border-brand-primary pb-3">
        <p className="text-xs font-bold tracking-wider text-brand-primary">CHUYA MOTOR</p>
        <Title className="font-display text-xl font-extrabold">{report.title}</Title>
        <p className="text-sm text-brand-text-muted">{report.subtitle}</p>
        <p className="text-xs text-brand-text-muted">{report.generatedAtLabel}</p>
      </header>
      {report.sections.map((s) => (
        <section key={s.id} className="space-y-2" data-section={s.id}>
          <Section className="font-display text-base font-extrabold text-brand-primary">{s.title}</Section>
          {s.provenance && <p className="text-xs italic text-brand-text-muted">{PROVENANCE_LABEL[s.provenance]}</p>}
          {s.blocks.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </section>
      ))}
      <section className="space-y-2 border-t border-brand-border-light pt-3">
        <Section className="font-display text-base font-extrabold text-brand-primary">Aviso importante</Section>
        <p className="text-sm">{report.disclaimer}</p>
      </section>
    </article>
  )
}
