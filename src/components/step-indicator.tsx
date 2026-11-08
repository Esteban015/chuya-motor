interface StepIndicatorProps {
  current: 1 | 2 | 3
  steps: readonly [string, string, string]
}

export function StepIndicator({ current, steps }: StepIndicatorProps) {
  return (
    <nav aria-label="Pasos del asistente">
      <ol className="flex items-center gap-0">
        {steps.map((label, idx) => {
          const n = (idx + 1) as 1 | 2 | 3
          const isCompleted = n < current
          const isCurrent = n === current
          const isLast = n === 3

          return (
            <li key={n} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <div
                  aria-current={isCurrent ? 'step' : undefined}
                  className={[
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold font-display transition-colors',
                    isCompleted
                      ? 'bg-brand-primary text-brand-accent'
                      : isCurrent
                        ? 'bg-brand-accent text-brand-primary ring-2 ring-brand-primary/20'
                        : 'bg-brand-border-light text-brand-text-light',
                  ].join(' ')}
                >
                  {isCompleted ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path
                        d="M3 7l2.5 2.5L11 4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <span aria-hidden="true">{n}</span>
                  )}
                  <span className="sr-only">
                    {isCompleted ? 'Completado' : isCurrent ? 'Paso actual' : 'Pendiente'}
                    : {label}
                  </span>
                </div>
                <span
                  className={[
                    'text-2xs font-medium whitespace-nowrap hidden sm:block',
                    isCurrent ? 'text-brand-primary' : isCompleted ? 'text-brand-text-muted' : 'text-brand-text-light',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {label}
                </span>
              </div>

              {/* Connector line */}
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={[
                    'flex-1 h-0.5 mx-2 mt-[-10px] sm:mt-[-22px] rounded-full transition-colors',
                    isCompleted ? 'bg-brand-primary' : 'bg-brand-border-light',
                  ].join(' ')}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
