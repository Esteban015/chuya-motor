import Link from 'next/link'
import { Logo } from '@/components/logo'
import { PrivacyNotice } from '@/components/privacy-notice'

// ── SVG Illustrations ─────────────────────────────────────────────────────────

function ProductMockup() {
  return (
    <svg
      viewBox="0 0 360 420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      role="img"
      className="w-full max-w-sm mx-auto drop-shadow-2xl"
    >
      {/* Card shell */}
      <rect x="0" y="0" width="360" height="420" rx="20" fill="#F7F6F0" />

      {/* Header bar */}
      <rect x="0" y="0" width="360" height="52" rx="20" fill="#103B3B" />
      <rect x="0" y="32" width="360" height="20" fill="#103B3B" />
      {/* Logo dot */}
      <circle cx="24" cy="26" r="8" fill="#D9F4A5" opacity="0.3" />
      <circle cx="24" cy="26" r="4" fill="#D9F4A5" />
      <text x="38" y="30.5" fill="#F7F6F0" fontSize="11" fontWeight="600" fontFamily="system-ui">Chuya Motor</text>
      {/* Demo badge */}
      <rect x="260" y="17" width="84" height="18" rx="9" fill="#D9F4A5" opacity="0.2" />
      <text x="302" y="29" fill="#D9F4A5" fontSize="8" fontWeight="700" fontFamily="system-ui" textAnchor="middle">MODO DEMO</text>

      {/* Severity banner — critical */}
      <rect x="16" y="64" width="328" height="52" rx="10" fill="#FEF2F2" stroke="#FCA5A5" strokeWidth="1.5" />
      <rect x="28" y="78" width="20" height="20" rx="10" fill="#EF4444" opacity="0.15" />
      <circle cx="38" cy="88" r="5" fill="#EF4444" />
      <text x="56" y="84" fill="#991B1B" fontSize="9" fontWeight="700" fontFamily="system-ui">ADVERTENCIA CRÍTICA</text>
      <text x="56" y="97" fill="#7F1D1D" fontSize="8" fontFamily="system-ui">Revisá los frenos con un profesional</text>
      <text x="56" y="108" fill="#7F1D1D" fontSize="8" fontFamily="system-ui">antes de seguir circulando.</text>

      {/* Hipótesis heading */}
      <text x="16" y="138" fill="#24373A" fontSize="11" fontWeight="700" fontFamily="system-ui">Hipótesis orientativas</text>

      {/* Hypothesis 1 — high confidence */}
      <rect x="16" y="148" width="328" height="58" rx="8" fill="white" stroke="#EEECE5" strokeWidth="1" />
      <rect x="16" y="148" width="4" height="58" rx="2" fill="#103B3B" />
      <text x="30" y="164" fill="#24373A" fontSize="9.5" fontWeight="600" fontFamily="system-ui">Desgaste del sistema de frenos</text>
      <text x="30" y="177" fill="#5A7275" fontSize="8.5" fontFamily="system-ui">Las pastillas o discos pueden estar</text>
      <text x="30" y="188" fill="#5A7275" fontSize="8.5" fontFamily="system-ui">en límite de desgaste.</text>
      {/* Confidence pill */}
      <rect x="265" y="156" width="68" height="16" rx="8" fill="#EAF4F4" />
      <text x="299" y="167.5" fill="#103B3B" fontSize="8" fontWeight="600" fontFamily="system-ui" textAnchor="middle">Alta conf.</text>

      {/* Hypothesis 2 — medium confidence */}
      <rect x="16" y="214" width="328" height="58" rx="8" fill="white" stroke="#EEECE5" strokeWidth="1" />
      <rect x="16" y="214" width="4" height="58" rx="2" fill="#D9F4A5" />
      <text x="30" y="230" fill="#24373A" fontSize="9.5" fontWeight="600" fontFamily="system-ui">Fuga de líquido de frenos</text>
      <text x="30" y="243" fill="#5A7275" fontSize="8.5" fontFamily="system-ui">Verificar nivel del depósito</text>
      <text x="30" y="254" fill="#5A7275" fontSize="8.5" fontFamily="system-ui">y posibles pérdidas.</text>
      <rect x="253" y="222" width="80" height="16" rx="8" fill="#FEF9C3" />
      <text x="293" y="233.5" fill="#854D0E" fontSize="8" fontWeight="600" fontFamily="system-ui" textAnchor="middle">Media conf.</text>

      {/* Preguntas heading */}
      <text x="16" y="296" fill="#24373A" fontSize="11" fontWeight="700" fontFamily="system-ui">Preguntas para el taller</text>

      {/* Questions */}
      {[
        '¿Cuándo fue la última revisión de frenos?',
        '¿Hay alguna señal de líquido bajo el auto?',
        '¿El freno de mano funciona correctamente?',
      ].map((q, i) => (
        <g key={i}>
          <circle cx="24" cy={316 + i * 28} r="3" fill="#103B3B" />
          <text x="34" y={319.5 + i * 28} fill="#5A7275" fontSize="8.5" fontFamily="system-ui">{q}</text>
        </g>
      ))}

      {/* Bottom bar */}
      <rect x="0" y="398" width="360" height="22" rx="0" fill="#F7F6F0" />
      <rect x="0" y="398" width="360" height="22" rx="0" fill="url(#fade)" />
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F7F6F0" stopOpacity="0" />
          <stop offset="100%" stopColor="#F7F6F0" stopOpacity="1" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function BudgetMockup() {
  return (
    <svg
      viewBox="0 0 340 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full max-w-xs mx-auto drop-shadow-xl"
    >
      <rect width="340" height="280" rx="16" fill="#F7F6F0" stroke="#EEECE5" strokeWidth="1" />

      {/* Header */}
      <rect width="340" height="44" rx="16" fill="#103B3B" />
      <rect y="28" width="340" height="16" fill="#103B3B" />
      <text x="16" y="27" fill="#F7F6F0" fontSize="12" fontWeight="700" fontFamily="system-ui">Análisis de presupuesto</text>

      {/* Line items */}
      <text x="16" y="68" fill="#5A7275" fontSize="9" fontFamily="system-ui">CONCEPTO</text>
      <text x="260" y="68" fill="#5A7275" fontSize="9" fontFamily="system-ui">IMPORTE</text>
      <line x1="16" y1="74" x2="324" y2="74" stroke="#EEECE5" strokeWidth="1" />

      {[
        ['Aceite de motor 5W-40', '$4.200'],
        ['Filtro de aceite', '$1.800'],
        ['Filtro de aire', '$2.300'],
        ['Mano de obra', '$3.200'],
      ].map(([label, amount], i) => (
        <g key={i}>
          <text x="16" y={93 + i * 24} fill="#24373A" fontSize="9.5" fontFamily="system-ui">{label}</text>
          <text x="324" y={93 + i * 24} fill="#24373A" fontSize="9.5" fontFamily="system-ui" textAnchor="end">{amount}</text>
        </g>
      ))}

      <line x1="16" y1="192" x2="324" y2="192" stroke="#EEECE5" strokeWidth="1" />

      {/* Totals */}
      <text x="16" y="210" fill="#5A7275" fontSize="9.5" fontFamily="system-ui">Total calculado</text>
      <text x="324" y="210" fill="#103B3B" fontSize="11" fontWeight="700" fontFamily="system-ui" textAnchor="end">$11.500</text>

      {/* Discrepancy alert */}
      <rect x="16" y="222" width="308" height="40" rx="8" fill="#FEF0EB" stroke="#F29C7B" strokeWidth="1.5" />
      <text x="30" y="237" fill="#C97550" fontSize="9" fontWeight="700" fontFamily="system-ui">Diferencia detectada</text>
      <text x="30" y="251" fill="#C97550" fontSize="8.5" fontFamily="system-ui">Total declarado $12.500 · diferencia $1.000</text>
      <circle cx="308" cy="242" r="10" fill="#F29C7B" opacity="0.2" />
      <text x="308" y="246" fill="#C97550" fontSize="10" fontWeight="700" fontFamily="system-ui" textAnchor="middle">!</text>
    </svg>
  )
}

function SeverityMockup() {
  return (
    <svg
      viewBox="0 0 360 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full max-w-sm mx-auto drop-shadow-xl"
    >
      <rect width="360" height="160" rx="16" fill="#FEF2F2" stroke="#FCA5A5" strokeWidth="2" />

      {/* Icon */}
      <rect x="20" y="20" width="40" height="40" rx="20" fill="#EF4444" opacity="0.1" />
      <circle cx="40" cy="40" r="12" fill="#EF4444" />
      <text x="40" y="44.5" fill="white" fontSize="14" fontWeight="700" fontFamily="system-ui" textAnchor="middle">!</text>

      <text x="72" y="34" fill="#991B1B" fontSize="11" fontWeight="700" fontFamily="system-ui">ADVERTENCIA CRÍTICA DE SEGURIDAD</text>
      <text x="72" y="50" fill="#7F1D1D" fontSize="9.5" fontFamily="system-ui">Este síntoma requiere atención inmediata.</text>

      <line x1="20" y1="72" x2="340" y2="72" stroke="#FCA5A5" strokeWidth="1" />

      <text x="20" y="92" fill="#24373A" fontSize="9" fontWeight="600" fontFamily="system-ui">Síntoma detectado</text>
      <text x="20" y="107" fill="#991B1B" fontSize="9.5" fontFamily="system-ui" fontStyle="italic">&quot;Es necesario pisar el pedal muy a fondo</text>
      <text x="20" y="121" fill="#991B1B" fontSize="9.5" fontFamily="system-ui" fontStyle="italic"> para que comience a frenar.&quot;</text>

      <rect x="20" y="135" width="200" height="16" rx="8" fill="#991B1B" />
      <text x="120" y="146" fill="white" fontSize="9" fontWeight="600" fontFamily="system-ui" textAnchor="middle">No conduzcas: consultá un profesional</text>
    </svg>
  )
}

// ── Car + Person illustration for Misión ─────────────────────────────────────

function MisionIllustration() {
  return (
    <svg
      viewBox="0 0 320 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="w-full max-w-xs mx-auto"
    >
      {/* Ground */}
      <rect x="0" y="186" width="320" height="4" rx="2" fill="#DDD9CE" />

      {/* Car body */}
      <rect x="40" y="140" width="210" height="50" rx="12" fill="#103B3B" />
      {/* Car roof */}
      <path d="M80 140 Q95 100 130 95 L200 95 Q230 95 245 140Z" fill="#1A5555" />
      {/* Windows */}
      <path d="M90 140 Q102 108 128 103 L170 103 Q185 103 195 118 L195 140Z" fill="#D9F4A5" opacity="0.25" />
      {/* Wheels */}
      <circle cx="100" cy="190" r="20" fill="#24373A" />
      <circle cx="100" cy="190" r="10" fill="#5A7275" />
      <circle cx="100" cy="190" r="4" fill="#24373A" />
      <circle cx="210" cy="190" r="20" fill="#24373A" />
      <circle cx="210" cy="190" r="10" fill="#5A7275" />
      <circle cx="210" cy="190" r="4" fill="#24373A" />
      {/* Headlight */}
      <rect x="240" y="152" width="14" height="8" rx="4" fill="#D9F4A5" opacity="0.6" />

      {/* Person */}
      {/* Head */}
      <circle cx="276" cy="128" r="14" fill="#F5CBA7" />
      {/* Hair */}
      <path d="M264 122 Q268 112 276 110 Q284 112 288 122" fill="#5D4037" />
      {/* Body */}
      <rect x="264" y="142" width="24" height="38" rx="6" fill="#103B3B" />
      {/* Arm raised — holding phone */}
      <path d="M288 148 Q298 138 296 130" stroke="#F5CBA7" strokeWidth="6" strokeLinecap="round" />
      {/* Phone in hand */}
      <rect x="291" y="118" width="12" height="18" rx="3" fill="#24373A" />
      <rect x="293" y="121" width="8" height="12" rx="1.5" fill="#D9F4A5" opacity="0.5" />
      {/* Legs */}
      <rect x="265" y="178" width="9" height="10" rx="3" fill="#24373A" />
      <rect x="278" y="178" width="9" height="10" rx="3" fill="#24373A" />

      {/* Speech bubble with check */}
      <rect x="38" y="60" width="130" height="52" rx="10" fill="white" stroke="#EEECE5" strokeWidth="1.5" />
      <path d="M60 112 L50 122 L75 112Z" fill="white" stroke="#EEECE5" strokeWidth="1.5" />
      <path d="M60 112 L75 112" stroke="white" strokeWidth="2" />
      <circle cx="58" cy="82" r="8" fill="#EAF4F4" />
      <path d="M54 82 L57 85 L63 79" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="74" y="79" fill="#24373A" fontSize="9" fontWeight="600" fontFamily="system-ui">Pastillas de freno</text>
      <text x="74" y="92" fill="#5A7275" fontSize="8.5" fontFamily="system-ui">Alta confianza</text>
      <text x="74" y="104" fill="#103B3B" fontSize="8" fontFamily="system-ui">¿Cuándo cambiaste?</text>
    </svg>
  )
}

// ── Problem Scene Illustrations ───────────────────────────────────────────────

function SceneRuido() {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" className="w-full h-full">
      {/* Background tint */}
      <rect width="96" height="96" rx="16" fill="#F29C7B" opacity="0.08" />
      {/* Car silhouette (simple, stylized) */}
      <rect x="10" y="52" width="52" height="22" rx="6" fill="#103B3B" />
      <path d="M18 52 Q22 36 32 32 L52 32 Q62 32 66 52Z" fill="#1A5555" />
      {/* Windows */}
      <path d="M26 52 Q28 40 36 36 L50 36 Q58 36 60 46 L60 52Z" fill="#D9F4A5" opacity="0.3" />
      {/* Wheels */}
      <circle cx="22" cy="74" r="8" fill="#24373A" /><circle cx="22" cy="74" r="4" fill="#5A7275" />
      <circle cx="54" cy="74" r="8" fill="#24373A" /><circle cx="54" cy="74" r="4" fill="#5A7275" />
      {/* Sound waves */}
      <path d="M72 52 Q78 60 72 68" stroke="#F29C7B" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M77 46 Q86 60 77 74" stroke="#F29C7B" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.5" />
      {/* Question bubble */}
      <circle cx="80" cy="22" r="12" fill="#FEF0EB" />
      <text x="80" y="27" fill="#C97550" fontSize="14" fontWeight="700" textAnchor="middle" fontFamily="system-ui">?</text>
    </svg>
  )
}

function ScenePresupuesto() {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" className="w-full h-full">
      <rect width="96" height="96" rx="16" fill="#103B3B" opacity="0.05" />
      {/* Paper document */}
      <rect x="14" y="12" width="52" height="68" rx="6" fill="white" stroke="#DDD9CE" strokeWidth="2" />
      {/* Title line */}
      <rect x="22" y="22" width="30" height="4" rx="2" fill="#103B3B" opacity="0.4" />
      {/* Item rows */}
      <rect x="22" y="34" width="22" height="3" rx="1.5" fill="#DDD9CE" />
      <rect x="52" y="34" width="8" height="3" rx="1.5" fill="#DDD9CE" />
      <rect x="22" y="43" width="18" height="3" rx="1.5" fill="#DDD9CE" />
      <rect x="52" y="43" width="8" height="3" rx="1.5" fill="#DDD9CE" />
      <rect x="22" y="52" width="20" height="3" rx="1.5" fill="#DDD9CE" />
      <rect x="52" y="52" width="8" height="3" rx="1.5" fill="#DDD9CE" />
      {/* Divider */}
      <line x1="22" y1="62" x2="62" y2="62" stroke="#EEECE5" strokeWidth="1" />
      {/* Total — highlighted */}
      <rect x="22" y="68" width="38" height="5" rx="2" fill="#F29C7B" opacity="0.3" />
      {/* Warning badge */}
      <circle cx="74" cy="30" r="14" fill="#FEF0EB" stroke="#F29C7B" strokeWidth="1.5" />
      <text x="74" y="35" fill="#C97550" fontSize="16" fontWeight="700" textAnchor="middle" fontFamily="system-ui">?</text>
    </svg>
  )
}

function SceneAlerta() {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" className="w-full h-full">
      <rect width="96" height="96" rx="16" fill="#EF4444" opacity="0.05" />
      {/* Dashboard / steering wheel */}
      <rect x="10" y="38" width="76" height="44" rx="12" fill="#24373A" />
      {/* Gauge cluster */}
      <circle cx="30" cy="62" r="12" fill="#103B3B" stroke="#1A5555" strokeWidth="1" />
      <circle cx="66" cy="62" r="12" fill="#103B3B" stroke="#1A5555" strokeWidth="1" />
      {/* Left gauge — OK */}
      <path d="M24 66 Q30 54 36 66" stroke="#D9F4A5" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <line x1="30" y1="62" x2="27" y2="56" stroke="#D9F4A5" strokeWidth="1.5" strokeLinecap="round" />
      {/* Right gauge — warning */}
      <path d="M60 66 Q66 54 72 66" stroke="#EF4444" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <line x1="66" y1="62" x2="72" y2="58" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" />
      <circle cx="72" cy="58" r="2.5" fill="#EF4444" />
      {/* Alert icon top */}
      <circle cx="66" cy="20" r="14" fill="#FEF2F2" stroke="#FCA5A5" strokeWidth="1.5" />
      <text x="66" y="25" fill="#EF4444" fontSize="14" fontWeight="700" textAnchor="middle" fontFamily="system-ui">!</text>
    </svg>
  )
}

// ── Landing Page ──────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-brand-bg">

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-20 bg-brand-bg/95 backdrop-blur-sm border-b border-brand-border-light px-6"
        aria-label="Navegación principal"
      >
        <div className="max-w-7xl mx-auto h-14 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 focus-visible:rounded"
            aria-label="Chuya Motor — Inicio"
          >
            <Logo size={28} />
            <span className="font-bold text-brand-primary font-display text-base tracking-tight">Chuya Motor</span>
          </Link>

          <div className="flex items-center gap-6">
            <Link
              href="#problema"
              className="hidden md:block text-sm text-brand-text-muted hover:text-brand-primary transition-colors"
            >
              El problema
            </Link>
            <Link
              href="#como-funciona"
              className="hidden md:block text-sm text-brand-text-muted hover:text-brand-primary transition-colors"
            >
              Cómo funciona
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-light transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
            >
              Probar demo
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden bg-brand-primary"
        aria-labelledby="hero-heading"
      >
        {/* Background gauge — large decorative */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -left-20 opacity-5"
        >
          <svg width="600" height="600" viewBox="0 0 40 40" fill="none">
            <path d="M7 34 A15 15 0 1 1 33 34" stroke="#D9F4A5" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="20" y1="26" x2="14" y2="16" stroke="#D9F4A5" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24">
          <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-center">

            {/* Copy — left on desktop, top on mobile */}
            <div className="space-y-7">
              <p className="inline-flex items-center gap-2 rounded-full bg-brand-accent/15 px-4 py-1.5 text-xs font-semibold text-brand-accent uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-accent" aria-hidden="true" />
                Demo disponible ahora · Sin registro
              </p>

              <h1
                id="hero-heading"
                className="text-4xl md:text-5xl lg:text-[3.25rem] font-extrabold text-white font-display leading-[1.1] tracking-tight"
              >
                ¿Tu auto hace
                <br />
                algo raro?{' '}
                <span className="text-brand-accent">Entendé</span>
                <br />
                qué podría pasar.
              </h1>

              <p className="text-base md:text-lg text-white/70 leading-relaxed max-w-md">
                Describí el síntoma, revisá el presupuesto del taller y llegá con más información y mejores preguntas.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/demo"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-accent px-6 py-3.5 text-base font-bold text-brand-primary hover:bg-brand-accent-mid transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
                >
                  Probar demo gratis
                  <span aria-hidden="true">→</span>
                </Link>
                <Link
                  href="#como-funciona"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/25 px-6 py-3.5 text-base font-semibold text-white hover:bg-white/10 transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
                >
                  Cómo funciona
                </Link>
              </div>

              <p className="text-xs text-white/40">
                Sin registro · Sin patentes · Sin datos personales
              </p>
            </div>

            {/* Product mockup — right on desktop, below copy on mobile */}
            <div
              aria-hidden="true"
              className="flex items-center justify-center"
            >
              <div className="relative w-full max-w-sm">
                {/* Glow behind card */}
                <div className="absolute inset-0 bg-brand-accent/10 blur-3xl rounded-full scale-110" />
                <div className="relative">
                  <ProductMockup />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLEMA ────────────────────────────────────────────────────────── */}
      <section
        id="problema"
        className="px-6 py-20 md:py-28 bg-brand-bg"
        aria-labelledby="problema-heading"
      >
        <div className="max-w-7xl mx-auto">
          <div className="max-w-2xl mb-16">
            <p className="text-xs font-semibold text-brand-text-muted uppercase tracking-widest mb-3">
              ¿Te pasó alguna vez?
            </p>
            <h2
              id="problema-heading"
              className="text-3xl md:text-4xl font-extrabold text-brand-text font-display leading-tight"
            >
              Ir al taller sin saber bien qué decirle al mecánico.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {[
              {
                scene: <SceneRuido />,
                label: 'El ruido extraño',
                title: 'Escuchás algo y no sabés si es grave',
                desc: 'Un clic, un chirrido, una vibración. No sabés si puede esperar o si tenés que parar el auto ahora mismo.',
              },
              {
                scene: <ScenePresupuesto />,
                label: 'El presupuesto',
                title: 'Recibís la factura y no entendés nada',
                desc: '"Reparación del sistema de dirección asistida electro-hidráulica" — ¿eso es mucho? ¿es razonable? ¿te están cobrando bien?',
              },
              {
                scene: <SceneAlerta />,
                label: 'La luz de alarma',
                title: 'Se prendió una luz y Google no ayuda',
                desc: 'El ícono de alerta apareció y cada foro dice algo diferente. No sabés si seguir manejando o llamar a la grúa.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="group relative rounded-2xl bg-white border border-brand-border-light p-7 shadow-brand-xs hover:shadow-brand transition-shadow"
              >
                <div className="w-20 h-20 mb-5">
                  {item.scene}
                </div>
                <p className="text-xs font-semibold text-brand-text-muted uppercase tracking-widest mb-2">
                  {item.label}
                </p>
                <h3 className="font-bold text-brand-text font-display text-lg leading-snug mb-2">
                  {item.title}
                </h3>
                <p className="text-sm text-brand-text-muted leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ANÁLISIS DE SÍNTOMAS ─────────────────────────────────────────────── */}
      <section
        id="sintomas"
        className="px-6 py-20 md:py-28 bg-white overflow-hidden"
        aria-labelledby="sintomas-heading"
      >
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">

            {/* Mockup — left */}
            <div aria-hidden="true" className="relative">
              <div className="absolute -inset-8 bg-brand-primary/5 rounded-3xl" />
              <div className="relative">
                <ProductMockup />
              </div>
            </div>

            {/* Copy — right */}
            <div className="space-y-6">
              <p className="text-xs font-semibold text-brand-text-muted uppercase tracking-widest">
                Análisis de síntomas
              </p>
              <h2
                id="sintomas-heading"
                className="text-3xl md:text-4xl font-extrabold text-brand-text font-display leading-tight"
              >
                Entendé mejor lo que le pasa a tu auto.
              </h2>
              <p className="text-brand-text-muted leading-relaxed">
                Describís el síntoma con tus propias palabras. El sistema genera hipótesis orientativas con niveles de confianza y prepara las preguntas exactas que necesitás hacerle al mecánico.
              </p>

              <ul className="space-y-3" aria-label="Qué incluye el análisis de síntomas">
                {[
                  'Hipótesis ordenadas por probabilidad',
                  'Niveles de confianza para cada causa posible',
                  'Preguntas preparadas para el taller',
                  'Alerta automática si el síntoma es urgente',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-brand-text">
                    <span
                      aria-hidden="true"
                      className="flex-shrink-0 w-5 h-5 rounded-full bg-brand-primary-tint flex items-center justify-center mt-0.5"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                        <path d="M2 5l2 2 4-4" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <Link
                href="/demo/falla"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-white hover:bg-brand-primary-light transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
              >
                Probarlo con un ejemplo
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRESUPUESTOS ─────────────────────────────────────────────────────── */}
      <section
        id="presupuestos"
        className="px-6 py-20 md:py-28 bg-brand-bg overflow-hidden"
        aria-labelledby="presupuestos-heading"
      >
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">

            {/* Copy — left */}
            <div className="space-y-6">
              <p className="text-xs font-semibold text-brand-text-muted uppercase tracking-widest">
                Interpretación de presupuesto
              </p>
              <h2
                id="presupuestos-heading"
                className="text-3xl md:text-4xl font-extrabold text-brand-text font-display leading-tight"
              >
                Que los números del taller también sean claros.
              </h2>
              <p className="text-brand-text-muted leading-relaxed">
                Pegás las partidas del presupuesto y el sistema verifica la suma, detecta inconsistencias y te prepara para hacer las preguntas correctas.
              </p>

              <div className="rounded-xl bg-white border border-brand-border-light p-5 space-y-3">
                <p className="text-xs font-semibold text-brand-text-muted uppercase tracking-widest">Ejemplo real</p>
                <div className="flex justify-between text-sm">
                  <span className="text-brand-text">Total declarado</span>
                  <span className="font-bold text-brand-text">$12.500</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-brand-text">Total calculado</span>
                  <span className="font-bold text-brand-primary">$11.500</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-brand-coral-light border border-brand-coral/30 px-3 py-2">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <circle cx="7" cy="7" r="6" stroke="#C97550" strokeWidth="1.5" />
                    <path d="M7 4.5v3" stroke="#C97550" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="7" cy="10" r="0.75" fill="#C97550" />
                  </svg>
                  <span className="text-xs font-semibold text-brand-coral-dark">Diferencia de $1.000 detectada</span>
                </div>
              </div>

              <Link
                href="/demo/presupuesto"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-5 py-3 text-sm font-bold text-white hover:bg-brand-primary-light transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
              >
                Probarlo con un ejemplo
                <span aria-hidden="true">→</span>
              </Link>
            </div>

            {/* Mockup — right */}
            <div aria-hidden="true" className="flex items-center justify-center">
              <div className="relative w-full">
                <div className="absolute -inset-8 bg-brand-coral/5 rounded-3xl" />
                <div className="relative">
                  <BudgetMockup />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SEGURIDAD ────────────────────────────────────────────────────────── */}
      <section
        id="seguridad"
        className="px-6 py-20 md:py-28 bg-white"
        aria-labelledby="seguridad-heading"
      >
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">

            {/* Mockup — left */}
            <div aria-hidden="true" className="flex items-center justify-center">
              <div className="relative w-full max-w-sm">
                <div className="absolute -inset-6 bg-red-50 rounded-3xl" />
                <div className="relative space-y-4">
                  <SeverityMockup />
                  {/* Below the banner: small context note */}
                  <div className="rounded-xl bg-brand-primary-tint border border-brand-primary/10 px-4 py-3 text-center">
                    <p className="text-xs text-brand-primary font-semibold">Análisis continúa normalmente</p>
                    <p className="text-xs text-brand-text-muted mt-0.5">La consulta no queda bloqueada. Recibís hipótesis y preguntas.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Copy — right */}
            <div className="space-y-6">
              <p className="text-xs font-semibold text-brand-text-muted uppercase tracking-widest">
                Alertas de seguridad
              </p>
              <h2
                id="seguridad-heading"
                className="text-3xl md:text-4xl font-extrabold text-brand-text font-display leading-tight"
              >
                Hay señales que no conviene ignorar.
              </h2>
              <p className="text-brand-text-muted leading-relaxed">
                Cuando detectamos síntomas que podrían implicar riesgo inmediato, lo comunicamos claramente. No para generar miedo, sino para que tomes la decisión correcta antes de seguir circulando.
              </p>

              <div className="space-y-3">
                {[
                  { color: 'bg-red-100 text-red-800', label: 'Crítico', desc: 'Atención profesional urgente' },
                  { color: 'bg-orange-100 text-orange-800', label: 'Alto', desc: 'Revisá pronto con un mecánico' },
                  { color: 'bg-brand-primary-tint text-brand-primary', label: 'Normal', desc: 'Puede esperar la próxima service' },
                ].map((level) => (
                  <div key={level.label} className="flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${level.color} flex-shrink-0`}>
                      {level.label}
                    </span>
                    <span className="text-sm text-brand-text-muted">{level.desc}</span>
                  </div>
                ))}
              </div>

              <p className="text-sm text-brand-text-muted italic border-l-2 border-brand-border pl-4">
                La evaluación de severidad es determinista y no reemplaza el criterio de un profesional.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── MISIÓN ───────────────────────────────────────────────────────────── */}
      <section
        id="como-funciona"
        className="px-6 py-20 md:py-28 bg-brand-primary overflow-hidden"
        aria-labelledby="mision-heading"
      >
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 md:gap-20 items-center">

            {/* Copy — left */}
            <div className="space-y-6">
              <p className="text-xs font-semibold text-brand-accent/70 uppercase tracking-widest">
                Nuestra misión
              </p>
              <h2
                id="mision-heading"
                className="text-3xl md:text-4xl font-extrabold text-white font-display leading-tight"
              >
                Entender tu auto no debería ser solo para expertos.
              </h2>
              <p className="text-white/70 leading-relaxed">
                Chuya Motor existe para que cualquier persona llegue al taller con más información y más confianza. No para reemplazar al mecánico, sino para que la conversación sea más clara y más justa.
              </p>

              <ol className="space-y-5" aria-label="Pasos del proceso">
                {[
                  { n: '1', title: 'Describís con tus palabras', desc: 'Sin tecnicismos. El sistema entiende español natural.' },
                  { n: '2', title: 'Recibís hipótesis y advertencias', desc: 'En segundos. Con niveles de confianza y preguntas preparadas.' },
                  { n: '3', title: 'Llegás mejor preparado', desc: 'Al taller. Con contexto. Con preguntas. Con claridad.' },
                ].map((s) => (
                  <li key={s.n} className="flex items-start gap-4">
                    <span
                      aria-hidden="true"
                      className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-accent/15 border border-brand-accent/30 flex items-center justify-center text-brand-accent font-bold font-display text-sm"
                    >
                      {s.n}
                    </span>
                    <div className="pt-0.5">
                      <p className="font-bold text-white font-display text-sm">{s.title}</p>
                      <p className="text-sm text-white/60 mt-0.5">{s.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Illustration — right */}
            <div aria-hidden="true" className="flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-brand-accent/5 blur-3xl rounded-full" />
                <MisionIllustration />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONFIANZA Y LÍMITES ──────────────────────────────────────────────── */}
      <section
        id="limites"
        className="px-6 py-16 md:py-20 bg-brand-bg"
        aria-labelledby="limites-heading"
      >
        <div className="max-w-4xl mx-auto">
          <h2
            id="limites-heading"
            className="text-xl font-bold text-brand-text font-display text-center mb-10"
          >
            Una herramienta de orientación, no un diagnóstico definitivo
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 mb-8">
            <div className="rounded-xl bg-brand-primary-tint border border-brand-primary/10 p-5 space-y-3">
              <h3 className="font-bold text-brand-primary font-display text-sm uppercase tracking-wide">
                Lo que hace
              </h3>
              <ul className="space-y-2">
                {[
                  'Hipótesis orientativas a partir del síntoma',
                  'Verificación de sumas del presupuesto',
                  'Identificación de síntomas urgentes',
                  'Preguntas preparadas para el mecánico',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-brand-text leading-relaxed">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 mt-0.5" aria-hidden="true">
                      <circle cx="7" cy="7" r="6" fill="#103B3B" opacity="0.12" />
                      <path d="M4 7l2 2 4-4" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-white border border-brand-border-light p-5 space-y-3">
              <h3 className="font-bold text-brand-text-muted font-display text-sm uppercase tracking-wide">
                Lo que no hace
              </h3>
              <ul className="space-y-2">
                {[
                  'Diagnosticar definitivamente la causa',
                  'Recomendar reparaciones con riesgo',
                  'Reemplazar la inspección profesional',
                  'Garantizar que el precio sea razonable',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-brand-text-muted leading-relaxed">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0 mt-0.5" aria-hidden="true">
                      <circle cx="7" cy="7" r="6" fill="#5A7275" opacity="0.12" />
                      <path d="M5 5l4 4M9 5l-4 4" stroke="#5A7275" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <PrivacyNotice />
        </div>
      </section>

      {/* ── CTA FINAL ───────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden px-6 py-20 md:py-28 bg-brand-primary"
        aria-labelledby="cta-final-heading"
      >
        {/* Background gauge decoration */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-0 opacity-10 translate-x-1/4 translate-y-1/4"
        >
          <svg width="400" height="400" viewBox="0 0 40 40" fill="none">
            <path d="M7 34 A15 15 0 1 1 33 34" stroke="#D9F4A5" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="20" y1="26" x2="14" y2="16" stroke="#D9F4A5" strokeWidth="1" strokeLinecap="round" />
            <circle cx="13" cy="15" r="3" fill="#D9F4A5" />
          </svg>
        </div>

        <div className="relative max-w-2xl mx-auto text-center space-y-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-accent/15 mx-auto">
            <Logo size={32} variant="light" />
          </div>

          <h2
            id="cta-final-heading"
            className="text-3xl md:text-4xl font-extrabold text-white font-display leading-tight"
          >
            Tu próximo paso empieza entendiendo tu auto.
          </h2>

          <p className="text-white/60 text-base max-w-sm mx-auto leading-relaxed">
            Probá Chuya Motor ahora. Gratis, sin registro, sin datos personales.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/demo"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-accent px-8 py-4 text-base font-bold text-brand-primary hover:bg-brand-accent-mid transition-colors focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-primary"
            >
              Probar Chuya Motor gratis
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer
        className="bg-brand-primary border-t border-white/10 px-6 py-8"
        aria-label="Pie de página"
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 focus-visible:rounded"
            aria-label="Chuya Motor"
          >
            <Logo size={22} variant="light" />
            <span className="font-bold text-white font-display text-sm">Chuya Motor</span>
          </Link>

          <p className="text-xs text-white/40 text-center sm:text-right leading-relaxed">
            Tu auto, más claro.{' '}
            <span className="block sm:inline">Esta herramienta no reemplaza la inspección de un profesional.</span>
          </p>
        </div>
      </footer>

    </div>
  )
}
