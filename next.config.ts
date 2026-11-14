import type { NextConfig } from 'next'

const securityHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

// 7D.2: the versioned vehicle catalog (read from disk by the server, never sent whole to the
// browser) must ship with every server function that reads it.
const VEHICLE_CATALOG_FILES = ['./data/vehicle-catalog/dnrpa-2026-11-01/dataset.json']

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/vehicle-catalog': VEHICLE_CATALOG_FILES,
    '/api/analyze': VEHICLE_CATALOG_FILES,
    '/demo/falla': VEHICLE_CATALOG_FILES,
    '/demo/presupuesto': VEHICLE_CATALOG_FILES,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
