import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chuya Motor',
  description:
    'Tu auto, más claro. Entendé qué le pasa a tu auto y llegá al taller con más confianza.',
}

const fontVariables = {
  '--font-manrope': '"Manrope"',
  '--font-inter': '"Inter"',
} as CSSProperties

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" style={fontVariables}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans bg-brand-bg text-brand-text antialiased">{children}</body>
    </html>
  )
}
