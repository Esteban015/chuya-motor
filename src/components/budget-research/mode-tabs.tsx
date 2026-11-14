'use client'

/**
 * mode-tabs.tsx — Accessible tabs (WAI-ARIA tabs pattern) for the two budget modes (7B).
 * Roving tabindex; Left/Right/Home/End move and activate. State only: the URL never changes,
 * so nothing typed here can reach Analytics.
 */
import { useRef } from 'react'

export type BudgetMode = 'parts' | 'quote'

export const MODE_TABS: ReadonlyArray<{ id: BudgetMode; label: string; hint: string }> = [
  { id: 'parts', label: 'Consultar repuestos', hint: 'Lista sin precios: buscá referencias' },
  { id: 'quote', label: 'Comparar presupuesto', hint: 'Precios del taller: verificá y compará' },
]

export const tabId = (m: BudgetMode) => `budget-tab-${m}`
export const panelId = (m: BudgetMode) => `budget-panel-${m}`

export function ModeTabs({ mode, onChange }: { mode: BudgetMode; onChange: (m: BudgetMode) => void }) {
  const refs = useRef<Record<BudgetMode, HTMLButtonElement | null>>({ parts: null, quote: null })

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const i = MODE_TABS.findIndex((t) => t.id === mode)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % MODE_TABS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + MODE_TABS.length) % MODE_TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = MODE_TABS.length - 1
    else return
    e.preventDefault()
    const target = MODE_TABS[next]!.id
    onChange(target)
    refs.current[target]?.focus()
  }

  return (
    <div role="tablist" aria-label="Modo de análisis del presupuesto" className="grid grid-cols-2 gap-1 rounded-2xl border border-brand-border-light bg-white p-1 shadow-brand-xs">
      {MODE_TABS.map((t) => {
        const selected = t.id === mode
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={selected}
            aria-controls={panelId(t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={onKeyDown}
            className={`min-w-0 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary sm:px-4 ${
              selected ? 'bg-brand-primary text-white shadow-brand-sm' : 'text-brand-text hover:bg-brand-bg'
            }`}
          >
            <span className="block text-sm font-semibold leading-tight">{t.label}</span>
            <span className={`mt-0.5 hidden text-xs sm:block ${selected ? 'text-white/80' : 'text-brand-text-muted'}`}>{t.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
