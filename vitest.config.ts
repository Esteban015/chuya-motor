import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'e2e'],
    coverage: {
      provider: 'v8',
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        'src/__test-utils__/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
