import Link from 'next/link'
import { DemoBadge } from '@/components/demo-badge'
import { PrivacyNotice } from '@/components/privacy-notice'

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="text-lg font-bold text-gray-900">Chuya Motor</span>
          <DemoBadge />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-10">
        {/* Hero */}
        <section className="text-center space-y-3">
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            Chuya Motor
          </h1>
          <p className="text-xl text-gray-600">
            Claridad entre vos y tu taller.
          </p>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Describí tu síntoma o pegá tu presupuesto. Obtenés hipótesis orientativas y
            las preguntas correctas para hablar con tu mecánico.
          </p>
        </section>

        {/* CTA cards */}
        <section aria-labelledby="cta-heading">
          <h2 id="cta-heading" className="sr-only">
            ¿Con qué podemos ayudarte hoy?
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/falla"
              className="group flex flex-col gap-3 rounded-xl border-2 border-gray-200 bg-white p-6 shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span aria-hidden="true" className="text-3xl">🔧</span>
              <div>
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                  Tengo una falla
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Describí el síntoma, obtenemos hipótesis orientativas.
                </p>
              </div>
            </Link>

            <Link
              href="/presupuesto"
              className="group flex flex-col gap-3 rounded-xl border-2 border-gray-200 bg-white p-6 shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <span aria-hidden="true" className="text-3xl">📋</span>
              <div>
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                  Entender mi presupuesto
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Pegá las partidas del presupuesto para verificar la suma y hacer las
                  preguntas correctas al taller.
                </p>
              </div>
            </Link>
          </div>
        </section>

        {/* Future features */}
        <section aria-labelledby="upcoming-heading">
          <h2
            id="upcoming-heading"
            className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4"
          >
            Próximamente
          </h2>
          <ul className="space-y-3">
            {[
              {
                label: 'Asistente conversacional con memoria del caso',
                description: 'Continuá la consulta con contexto completo de tu vehículo.',
              },
              {
                label: 'Guías DIY seguras para mantenimiento de bajo riesgo',
                description: 'Paso a paso para tareas que podés hacer vos mismo.',
              },
              {
                label: 'Búsqueda de talleres por especialidad y zona',
                description: 'Encontrá talleres habilitados cerca tuyo.',
              },
              {
                label: 'Comparación de presupuestos',
                description: 'Comparar múltiples presupuestos de distintos talleres.',
              },
              {
                label: 'Historial de reparaciones',
                description: 'Registrá el historial de tu vehículo a lo largo del tiempo.',
              },
            ].map((feature) => (
              <li
                key={feature.label}
                className="flex items-start gap-3 rounded-lg border border-dashed border-gray-200 bg-white px-4 py-3"
              >
                <span className="mt-0.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-gray-200 flex-shrink-0">
                  Próximamente
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-600">{feature.label}</p>
                  <p className="text-xs text-gray-400">{feature.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Privacy notice */}
        <PrivacyNotice />
      </div>
    </main>
  )
}
