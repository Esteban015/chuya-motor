'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logo } from '@/components/logo'
import { SiteModeBadge } from '@/components/ai-status-badge'

export function AppHeader() {
  const pathname = usePathname()
  const fromDemo = pathname.startsWith('/demo/')
  const backHref = fromDemo ? '/demo' : '/'
  const backLabel = fromDemo ? 'Demo' : 'Inicio'

  return (
    <header className="bg-white border-b border-brand-border-light px-4 py-3 sticky top-0 z-10">
      <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
        <Link
          href={backHref}
          className="flex items-center gap-1.5 text-sm text-brand-text-muted hover:text-brand-primary transition-colors focus-visible:rounded"
          aria-label={`Volver a ${backLabel}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
          <span>{backLabel}</span>
        </Link>

        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="flex items-center gap-1.5 focus-visible:rounded"
            aria-label="Chuya Motor — Inicio"
          >
            <Logo size={22} />
            <span className="hidden sm:block text-sm font-semibold text-brand-primary font-display">
              Chuya Motor
            </span>
          </Link>
          <SiteModeBadge />
        </div>
      </div>
    </header>
  )
}
