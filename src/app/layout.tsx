import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Chuya Motor',
  description: 'Claridad entre vos y tu taller.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
