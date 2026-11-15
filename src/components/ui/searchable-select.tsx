'use client'

/**
 * searchable-select.tsx — One control to search AND choose (Incremento 7D.3).
 *
 * Editable combobox with list autocomplete (WAI-ARIA APG "Combobox" pattern): a single text input
 * with role="combobox" that controls a listbox right below it. No separate search box, no native
 * <select> for the same datum. No dependency: the project has no UI kit and this is ~250 lines.
 *
 * - Click / tap / ArrowDown opens every option; typing filters in the same field (case- and
 *   accent-insensitive, partial, every word must match, prefix matches first, optional keywords
 *   such as brand aliases).
 * - ArrowUp/ArrowDown move (aria-activedescendant), Home/End jump, Enter picks, Escape closes,
 *   Tab leaves without picking. Typed text is never a value: leaving restores the chosen label.
 * - The input always shows the option LABEL; catalog IDs are only `value`s.
 * - Long lists render at most `maxVisible` options and ask the user to keep typing (no freeze).
 * - With a value, the clear (×) button replaces the chevron so long labels keep their room.
 * - 44 px rows and field, 16 px text on phones (no iOS zoom), dropdown as wide as the field.
 * - The list is portalled to <body> with position: fixed, so cards with overflow-hidden never clip
 *   it; it opens upward when there is not enough room below (e.g. with the phone keyboard open).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface SearchableOption {
  value: string
  label: string
  /** Extra search terms that are not displayed (e.g. "VW" for Volkswagen). */
  keywords?: string[]
}

export interface SearchableSelectProps {
  id: string
  label: string
  options: SearchableOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  loadingText?: string
  emptyMessage?: string
  clearable?: boolean
  /** Always offered after the matches, even when nothing matches (e.g. "No sé el motor"). */
  pinnedOptions?: SearchableOption[]
  /** Label to show for `value` when it is not among `options` (never show the ID). */
  valueLabel?: string
  hint?: string
  maxVisible?: number
}

const COMBINING_MARKS = /[̀-ͯ]/g

export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const searchText = new WeakMap<SearchableOption, { label: string; all: string }>()
function textOf(o: SearchableOption) {
  let t = searchText.get(o)
  if (!t) {
    const label = normalizeSearch(o.label)
    t = { label, all: [label, ...(o.keywords ?? []).map(normalizeSearch)].join(' ') }
    searchText.set(o, t)
  }
  return t
}

/** Options whose label/keywords contain every typed word; label prefix first, then word prefix. */
export function filterOptions(options: SearchableOption[], query: string): SearchableOption[] {
  const q = normalizeSearch(query)
  if (!q) return options
  const words = q.split(' ')
  const ranked: Array<{ o: SearchableOption; rank: number; i: number }> = []
  options.forEach((o, i) => {
    const t = textOf(o)
    if (!words.every((w) => t.all.includes(w))) return
    const rank = t.label.startsWith(q) ? 0 : t.label.split(' ').some((w) => w.startsWith(words[0]!)) ? 1 : 2
    ranked.push({ o, rank, i })
  })
  return ranked.sort((a, b) => a.rank - b.rank || a.i - b.i).map((r) => r.o)
}

const POPUP_MAX_PX = 288
const POPUP_GAP_PX = 4

/** Fixed position for the list, aligned to the field, flipped up when the space below is short. */
function popupPlacement(field: DOMRect): CSSProperties {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const below = viewportHeight - field.bottom - POPUP_GAP_PX * 2
  const above = field.top - POPUP_GAP_PX * 2
  const up = below < Math.min(POPUP_MAX_PX, 200) && above > below
  const maxHeight = Math.max(120, Math.min(POPUP_MAX_PX, up ? above : below))
  return up
    ? { position: 'fixed', left: field.left, width: field.width, bottom: viewportHeight - field.top + POPUP_GAP_PX, maxHeight }
    : { position: 'fixed', left: field.left, width: field.width, top: field.bottom + POPUP_GAP_PX, maxHeight }
}

const fieldCls =
  'w-full min-h-[44px] rounded-xl border border-brand-border bg-white py-2.5 pl-3 text-base text-brand-text placeholder:text-brand-text-light focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:bg-brand-surface disabled:opacity-60 sm:text-sm'

export function SearchableSelect(props: SearchableSelectProps) {
  const {
    id,
    label,
    options,
    value,
    onChange,
    placeholder,
    disabled = false,
    loading = false,
    loadingText = 'Cargando…',
    emptyMessage = 'No hay opciones que coincidan.',
    clearable = false,
    pinnedOptions = [],
    valueLabel,
    hint,
    maxVisible = 150,
  } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  /** null = nothing typed since opening (the field shows the chosen label, every option listed). */
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const [mounted, setMounted] = useState(false)
  const [placement, setPlacement] = useState<CSSProperties>({})
  const inactive = disabled || loading

  const selected = useMemo(() => options.find((o) => o.value === value) ?? pinnedOptions.find((o) => o.value === value), [options, pinnedOptions, value])
  const shownLabel = selected?.label ?? (value ? (valueLabel ?? '') : '')
  const matches = useMemo(() => filterOptions(options, query ?? ''), [options, query])
  const visible = matches.length > maxVisible ? matches.slice(0, maxVisible) : matches
  const items = useMemo(() => [...visible, ...pinnedOptions], [visible, pinnedOptions])
  const typed = query !== null && query.trim() !== ''

  const listId = `${id}-listbox`
  const optionId = (i: number) => `${id}-option-${i}`

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (inactive) close()
  }, [inactive])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (inputRef.current) setPlacement(popupPlacement(inputRef.current.getBoundingClientRect()))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [open])
  useEffect(() => {
    setActive(-1)
  }, [options])
  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  function close() {
    setOpen(false)
    setQuery(null)
    setActive(-1)
  }

  function openList(activeIndex = -1) {
    if (inactive) return
    setOpen(true)
    setActive(activeIndex)
  }

  function pick(o: SearchableOption) {
    onChange(o.value)
    close()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (inactive) return
    const last = items.length - 1
    const selectedIndex = items.findIndex((o) => o.value === value)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) return openList(selectedIndex >= 0 ? selectedIndex : 0)
        if (last >= 0) setActive((i) => (i >= last ? 0 : i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        if (!open) return openList(selectedIndex >= 0 ? selectedIndex : last)
        if (last >= 0) setActive((i) => (i <= 0 ? last : i - 1))
        return
      case 'Home':
      case 'End':
        if (!open || last < 0) return
        e.preventDefault()
        setActive(e.key === 'Home' ? 0 : last)
        return
      case 'Enter': {
        if (!open) return
        e.preventDefault()
        const target = active >= 0 ? items[active] : typed ? visible[0] : undefined
        if (target) pick(target)
        return
      }
      case 'Escape':
        if (!open) return
        e.preventDefault()
        close()
        return
      case 'Tab':
        if (open) close()
        return
    }
  }

  const showClear = clearable && !inactive && value !== ''
  const statusText = open && query !== null ? `${matches.length} ${matches.length === 1 ? 'resultado' : 'resultados'}` : ''
  const describedBy = [hint ? `${id}-hint` : null, `${id}-count`].filter(Boolean).join(' ')

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-brand-text-muted">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 && items[active] ? optionId(active) : undefined}
          aria-describedby={describedBy}
          aria-busy={loading || undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={inactive}
          placeholder={loading ? loadingText : placeholder}
          value={open && query !== null ? query : shownLabel}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onClick={(e) => {
            if (open) return
            openList()
            e.currentTarget.select()
          }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={close}
          onKeyDown={onKeyDown}
          title={shownLabel || undefined}
          className={`${fieldCls} ${showClear ? 'pr-12' : 'pr-10'}`}
        />
        {showClear && (
          <button
            type="button"
            aria-label={`Borrar ${label.toLowerCase()}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('')
              close()
              inputRef.current?.focus()
            }}
            className="absolute inset-y-0 right-0 my-auto flex h-11 w-11 items-center justify-center rounded-lg text-brand-text-light hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        )}
        {!showClear && <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-light transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>}
      </div>
      {mounted && createPortal(
        <div
          hidden={!open}
          onMouseDown={(e) => e.preventDefault()}
          style={placement}
          className="z-50 overflow-y-auto overscroll-contain rounded-xl border border-brand-border bg-white py-1 shadow-lg"
          data-testid={`${id}-popup`}
        >
          <ul id={listId} role="listbox" aria-label={label}>
            {open &&
              items.map((o, i) => {
                const isSelected = o.value === value
                const isPinned = i >= visible.length
                return (
                  <li
                    key={`${isPinned ? 'p' : 'o'}-${o.value}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    data-label={o.label}
                    onClick={() => pick(o)}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-sm text-brand-text hover:bg-brand-surface ${
                      i === active ? 'bg-brand-primary/10 outline outline-2 -outline-offset-2 outline-brand-primary' : ''
                    } ${isSelected ? 'font-semibold' : ''} ${isPinned && i === visible.length && visible.length > 0 ? 'border-t border-brand-border' : ''} ${isPinned ? 'text-brand-text-muted' : ''}`}
                  >
                    <span className="min-w-0 flex-1 break-words">{o.label}</span>
                    {isSelected && (
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-brand-primary" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 10.5l4 4 8-9" />
                      </svg>
                    )}
                  </li>
                )
              })}
          </ul>
          {open && matches.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-brand-text-muted" data-testid={`${id}-empty`}>{typed ? emptyMessage : 'No hay opciones para elegir.'}</p>
          )}
          {open && matches.length > visible.length && (
            <p className="border-t border-brand-border px-3 py-2 text-xs text-brand-text-muted" data-testid={`${id}-more`}>
              Mostrando {visible.length} de {matches.length}. Escribí para acotar la lista.
            </p>
          )}
        </div>
        , document.body)}
      <p id={`${id}-count`} aria-live="polite" className="sr-only" data-testid={`${id}-count`}>{statusText}</p>
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-brand-text-light">{hint}</p>}
    </div>
  )
}
