'use client'

import { useState } from 'react'
import type { NodeTraceSummary } from '@/app/api/analyze/schema'

interface TraceViewerProps {
  traces: NodeTraceSummary[]
  isLoading?: boolean
  error?: string | null
}

// Status → visual style (Tailwind classes)
function statusStyle(status: NodeTraceSummary['status']): {
  badge: string
  row: string
  dot: string
} {
  switch (status) {
    case 'success':
      return {
        badge: 'inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-300',
        row: 'hover:bg-green-50',
        dot: 'text-green-500',
      }
    case 'blocked':
      return {
        badge: 'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-300',
        row: 'hover:bg-amber-50 bg-amber-50/40',
        dot: 'text-amber-500',
      }
    case 'error':
      return {
        badge: 'inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-300',
        row: 'hover:bg-red-50 bg-red-50/40',
        dot: 'text-red-500',
      }
    case 'fallback_used':
      return {
        badge: 'inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-300',
        row: 'hover:bg-orange-50 bg-orange-50/40',
        dot: 'text-orange-500',
      }
    case 'skipped':
      return {
        badge: 'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-gray-200',
        row: 'hover:bg-gray-50 opacity-60',
        dot: 'text-gray-300',
      }
  }
}

function statusLabel(status: NodeTraceSummary['status']): string {
  switch (status) {
    case 'success': return 'ok'
    case 'blocked': return 'bloqueado'
    case 'error': return 'error'
    case 'fallback_used': return 'fallback'
    case 'skipped': return 'omitido'
  }
}

function totalDurationMs(traces: NodeTraceSummary[]): number {
  if (traces.length === 0) return 0
  if (traces.length === 1) return traces[0]!.durationMs
  const sorted = [...traces].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
  const first = new Date(sorted[0]!.timestamp).getTime()
  const last = new Date(sorted[sorted.length - 1]!.timestamp).getTime()
  return last - first + sorted[sorted.length - 1]!.durationMs
}

function LoadingState() {
  return (
    <div className="animate-pulse space-y-2 p-4" aria-label="Cargando trazas">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="h-4 bg-gray-200 rounded w-24" />
          <div className="h-4 bg-gray-200 rounded w-16" />
          <div className="h-4 bg-gray-200 rounded w-10" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <p className="px-4 py-6 text-center text-xs text-gray-400">
      No hay nodos ejecutados en esta traza.
    </p>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="px-4 py-4 flex items-center gap-2 text-xs text-red-600" role="alert">
      <span aria-hidden="true">⚠</span>
      <span>Error al cargar trazas: {message}</span>
    </div>
  )
}

export function TraceViewer({ traces, isLoading = false, error = null }: TraceViewerProps) {
  const [open, setOpen] = useState(false)

  const hasIssues = traces.some((t) =>
    t.status === 'error' || t.status === 'fallback_used' || t.status === 'blocked',
  )

  return (
    <section
      aria-labelledby="trace-viewer-heading"
      className="border border-gray-200 rounded-lg overflow-hidden"
    >
      {/* Always-visible DEMO notice */}
      <div className="px-4 py-1.5 bg-yellow-50 border-b border-yellow-100 text-center">
        <span className="text-xs font-medium text-yellow-700">
          MODO DEMO — Solo datos sintéticos. No ingresar datos reales.
        </span>
      </div>

      {/* Collapsible header */}
      <button
        type="button"
        id="trace-viewer-heading"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-left hover:bg-gray-100 transition-colors"
        aria-expanded={open}
        aria-controls="trace-viewer-body"
      >
        <span className="flex items-center gap-2 text-xs font-medium text-gray-600">
          <span aria-hidden="true">🔍</span>
          Trazas de nodos
          {hasIssues && (
            <span
              aria-label="hay nodos con advertencias"
              className="inline-flex items-center rounded-full bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-600 ring-1 ring-orange-300"
            >
              !
            </span>
          )}
          <span className="text-gray-400 font-normal">(modo desarrollo)</span>
        </span>
        <span
          aria-hidden="true"
          className="text-gray-400 text-xs"
        >
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Body */}
      {open && (
        <div id="trace-viewer-body">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : traces.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {/* Summary bar */}
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-4 text-xs text-gray-500">
                <span>Nodos: <strong className="text-gray-700">{traces.length}</strong></span>
                <span>Duración total: <strong className="text-gray-700">{totalDurationMs(traces)} ms</strong></span>
                {traces.some((t) => t.llmCalled) && (
                  <span className="text-green-600">LLM invocado</span>
                )}
              </div>

              {/* Trace table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs" role="table" aria-label="Tabla de nodos ejecutados">
                  <thead className="bg-gray-50 border-t border-gray-200">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Nodo</th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500">Estado</th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500 hidden sm:table-cell">Resultado</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium text-gray-500">ms</th>
                      <th scope="col" className="px-4 py-2 text-center font-medium text-gray-500">LLM</th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-gray-500 hidden md:table-cell">Código error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {traces.map((node, i) => {
                      const style = statusStyle(node.status)
                      return (
                        <tr key={`${node.nodeId}-${i}`} className={`${style.row} transition-colors`}>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-1.5">
                              <span aria-hidden="true" className={`${style.dot} text-[8px]`}>●</span>
                              <code className="font-mono text-gray-700">{node.nodeId}</code>
                              {node.policyVersion && (
                                <span className="text-gray-400 text-[10px]">v{node.policyVersion}</span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span className={style.badge}>
                              {statusLabel(node.status)}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-500 hidden sm:table-cell max-w-[120px] truncate">
                            {node.resultType ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-gray-600">
                            {node.durationMs}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {node.llmCalled ? (
                              <span title="LLM invocado" className="text-green-600" aria-label="LLM invocado">●</span>
                            ) : (
                              <span title="Sin invocación LLM" className="text-gray-300" aria-label="Sin LLM">○</span>
                            )}
                          </td>
                          <td className="px-4 py-2 hidden md:table-cell">
                            {node.errorCode ? (
                              <code className="text-red-600 font-mono">{node.errorCode}</code>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Footer note */}
              <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
                Datos de observabilidad internos. No contiene texto del usuario ni prompts.
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
