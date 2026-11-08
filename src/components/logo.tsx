interface LogoProps {
  size?: number
  variant?: 'default' | 'light'
  className?: string
}

/**
 * Logotipo de Chuya Motor: arco de velocímetro con aguja.
 * Comunicado: precisión + claridad + automotriz.
 * No representa ninguna marca registrada.
 */
export function Logo({ size = 36, variant = 'default', className = '' }: LogoProps) {
  const arcColor = variant === 'light' ? '#D9F4A5' : '#103B3B'
  const needleColor = variant === 'light' ? '#F7F6F0' : '#103B3B'
  const pivotColor = variant === 'light' ? '#D9F4A5' : '#103B3B'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Arco del velocímetro: de las 8 a las 4 del reloj, pasando por las 12 */}
      <path
        d="M7 34 A15 15 0 1 1 33 34"
        stroke={arcColor}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Aguja apuntando a las 11, sugeriendo una lectura óptima */}
      <line
        x1="20"
        y1="26"
        x2="14"
        y2="16"
        stroke={needleColor}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Punto de acento en la punta de la aguja */}
      <circle cx="13" cy="15" r="3" fill="#D9F4A5" />
      {/* Pivote de la aguja */}
      <circle cx="20" cy="26" r="2.5" fill={pivotColor} />
    </svg>
  )
}
