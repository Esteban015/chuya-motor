import Link from 'next/link'
import { Logo } from '@/components/logo'
import { DemoBadge } from '@/components/demo-badge'

// ── Illustrations ─────────────────────────────────────────────────────────────

function FallaIllustration() {
  return (
    <svg viewBox="0 0 120 90" fill="none" aria-hidden="true" className="w-full h-full">
      {/* Car */}
      <rect x="10" y="52" width="80" height="26" rx="8" fill="#103B3B" />
      <path d="M20 52 Q26 32 38 28 L72 28 Q84 28 90 52Z" fill="#1A5555" />
      {/* Windows */}
      <path d="M28 52 Q32 36 42 32 L68 32 Q78 32 82 46 L82 52Z" fill="#D9F4A5" opacity="0.25" />
      {/* Wheels */}
      <circle cx="30" cy="78" r="10" fill="#24373A" />
      <circle cx="30" cy="78" r="5" fill="#5A7275" />
      <circle cx="80" cy="78" r="10" fill="#24373A" />
      <circle cx="80" cy="78" r="5" fill="#5A7275" />
      {/* Sound waves */}
      <path d="M98 50 Q104 58 98 66" stroke="#F29C7B" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M103 44 Q112 58 103 72" stroke="#F29C7B" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      {/* Wrench icon */}
      <circle cx="22" cy="24" r="12" fill="#D9F4A5" opacity="0.2" />
      <path d="M17 29 L25 21 M23 19 L27 23" stroke="#D9F4A5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="30" r="2.5" fill="#D9F4A5" />
    </svg>
  )
}

function PresupuestoIllustration() {
  return (
    <svg viewBox="0 0 120 90" fill="none" aria-hidden="true" className="w-full h-full">
      {/* Paper */}
      <rect x="20" y="10" width="60" height="72" rx="8" fill="white" stroke="#DDD9CE" strokeWidth="1.5" />
      {/* Header */}
      <rect x="28" y="20" width="36" height="5" rx="2.5" fill="#103B3B" opacity="0.4" />
      {/* Rows */}
      {[32, 42, 52, 62].map((y, i) => (
        <g key={y}>
          <rect x="28" y={y} width={i < 3 ? 24 : 32} height="3.5" rx="1.5" fill={i === 3 ? '#F29C7B' : '#DDD9CE'} opacity={i === 3 ? 1 : 0.8} />
          <rect x="62" y={y} width="12" height="3.5" rx="1.5" fill={i === 3 ? '#F29C7B' : '#DDD9CE'} opacity={i === 3 ? 1 : 0.8} />
        </g>
      ))}
      {/* Divider */}
      <line x1="28" y1="72" x2="76" y2="72" stroke="#EEECE5" />
      {/* Total row */}
      <rect x="28" y="76" width="44" height="5" rx="2.5" fill="#103B3B" opacity="0.2" />
      {/* Alert badge */}
      <circle cx="98" cy="30" r="14" fill="#FEF0EB" stroke="#F29C7B" strokeWidth="1.5" />
      <text x="98" y="34.5" fontSize="14" fontWeight="700" textAnchor="middle" fill="#C97550" fontFamily="system-ui">!</text>
      {/* Check on left */}
      <circle cx="22" cy="78" r="10" fill="#EAF4F4" />
      <path d="M18 78 l3 3 5-5" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Demo Hub ──────────────────────────────────────────────────────────────────

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-brand-primary">

      {/* Nav */}
      <header className="border-b border-white/10 px-6">
        <div className="max-w-7xl mx-auto h-14 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors focus-visible:rounded"
            aria-label="Volver a inicio"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
            <span className="hidden sm:inline">Inicio</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 focus-visible:rounded" aria-label="Chuya Motor">
            <Logo size={22} variant="light" />
            <span className="text-sm font-bold text-white font-display hidden sm:block">Chuya Motor</span>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-16 pb-10 max-w-7xl mx-auto">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <div className="flex justify-center">
            <DemoBadge />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white font-display leading-tight">
            Entorno de prueba
          </h1>
          <p className="text-white/70 text-base leading-relaxed max-w-lg mx-auto">
            Explorá las funcionalidades con datos ficticios. No se requiere registro ni información personal real.
          </p>
        </div>
      </section>

      {/* CTA Cards */}
      <section
        className="px-6 pb-16 max-w-7xl mx-auto"
        aria-label="Funcionalidades del demo"
      >
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">

          {/* Falla */}
          <Link
            href="/demo/falla"
            className="group relative flex flex-col rounded-3xl border border-white/15 bg-white/[8%] hover:bg-white/[14%] transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary overflow-hidden"
          >
            {/* Top accent */}
            <div className="h-1 w-full bg-brand-accent rounded-t-3xl" aria-hidden="true" />

            <div className="flex flex-col h-full p-7 gap-6">
              {/* Illustration */}
              <div className="w-full h-28" aria-hidden="true">
                <FallaIllustration />
              </div>

              {/* Content */}
              <div className="space-y-3 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-brand-accent/20 px-2.5 py-0.5 text-2xs font-semibold text-brand-accent uppercase tracking-wider">
                    Análisis de síntomas
                  </span>
                </div>
                <h2 className="font-extrabold text-white font-display text-xl leading-snug group-hover:text-brand-accent transition-colors">
                  Tengo una falla
                </h2>
                <p className="text-sm text-white/60 leading-relaxed">
                  Describí qué siente el auto — un ruido, una vibración, una luz encendida. Recibís hipótesis orientativas y las preguntas exactas para el mecánico.
                </p>
              </div>

              {/* CTA row */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div className="space-y-0.5">
                  <p className="text-2xs text-white/40 uppercase tracking-wider">Proceso guiado</p>
                  <p className="text-xs text-white/60">3 pasos · 2 minutos</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-brand-accent px-4 py-2 text-sm font-bold text-brand-primary group-hover:bg-brand-accent-mid transition-colors" aria-hidden="true">
                  Empezar →
                </span>
              </div>
            </div>
          </Link>

          {/* Presupuesto */}
          <Link
            href="/demo/presupuesto"
            className="group relative flex flex-col rounded-3xl border border-white/15 bg-white/[8%] hover:bg-white/[14%] overflow-hidden transition-all focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
          >
            <div className="h-1 w-full bg-brand-coral rounded-t-3xl" aria-hidden="true" />

            <div className="flex flex-col h-full p-7 gap-6">
              <div className="w-full h-28" aria-hidden="true">
                <PresupuestoIllustration />
              </div>

              <div className="space-y-3 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-brand-coral/20 px-2.5 py-0.5 text-2xs font-semibold text-brand-coral uppercase tracking-wider">
                    Presupuestos
                  </span>
                </div>
                <h2 className="font-extrabold text-white font-display text-xl leading-snug group-hover:text-brand-accent transition-colors">
                  Entender mi presupuesto
                </h2>
                <p className="text-sm text-white/60 leading-relaxed">
                  Pegás las partidas del presupuesto del taller. Verificamos la suma, detectamos inconsistencias y preparamos las preguntas que necesitás hacer.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div className="space-y-0.5">
                  <p className="text-2xs text-white/40 uppercase tracking-wider">Análisis inmediato</p>
                  <p className="text-xs text-white/60">Verificación de sumas</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-4 py-2 text-sm font-bold text-white group-hover:bg-brand-accent group-hover:text-brand-primary transition-colors" aria-hidden="true">
                  Empezar →
                </span>
              </div>
            </div>
          </Link>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-white/35 mt-10 max-w-sm mx-auto leading-relaxed">
          Las orientaciones son indicativas. No reemplazan la inspección de un mecánico profesional.
          Usá datos ficticios durante la prueba.
        </p>
      </section>

    </main>
  )
}
