/**
 * badges.tsx — Provenance labels so the person can tell apart (7B):
 * declared data · reference entered by the person · unverified · calculation · missing data.
 */
export type Provenance = 'declared' | 'user_reference' | 'unverified' | 'calculation' | 'missing'

const STYLE: Record<Provenance, string> = {
  declared: 'bg-brand-primary-tint text-brand-primary ring-brand-primary/20',
  user_reference: 'bg-sky-50 text-sky-800 ring-sky-200',
  unverified: 'bg-amber-50 text-amber-800 ring-amber-200',
  calculation: 'bg-brand-accent/60 text-brand-accent-dark ring-brand-accent-dark/20',
  missing: 'bg-brand-bg-alt text-brand-text-muted ring-brand-border',
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  declared: 'Dato declarado',
  user_reference: 'Referencia ingresada por vos',
  unverified: 'Sin verificar',
  calculation: 'Cálculo',
  missing: 'Falta información',
}

export function ProvenanceBadge({ kind, label }: { kind: Provenance; label?: string }) {
  return (
    <span data-provenance={kind} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ${STYLE[kind]}`}>
      {label ?? PROVENANCE_LABEL[kind]}
    </span>
  )
}

export function ProvenanceLegend() {
  return (
    <div className="rounded-2xl border border-brand-border-light bg-white p-4" aria-label="Cómo leer los datos">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand-text-muted">Cómo leer los datos</p>
      <ul className="mt-3 space-y-2 text-xs leading-relaxed text-brand-text-muted">
        <li className="flex flex-wrap items-center gap-2"><ProvenanceBadge kind="declared" /> lo que escribiste vos o lo que dice el presupuesto.</li>
        <li className="flex flex-wrap items-center gap-2"><ProvenanceBadge kind="user_reference" /> precios que cargaste a mano.</li>
        <li className="flex flex-wrap items-center gap-2"><ProvenanceBadge kind="unverified" /> Chuya Motor no lo comprobó.</li>
        <li className="flex flex-wrap items-center gap-2"><ProvenanceBadge kind="calculation" /> aritmética sobre esos datos.</li>
        <li className="flex flex-wrap items-center gap-2"><ProvenanceBadge kind="missing" /> dato que todavía no tenemos.</li>
      </ul>
    </div>
  )
}
