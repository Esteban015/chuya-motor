import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#103B3B',
          'primary-light': '#1A5555',
          'primary-dark': '#0C2C2C',
          'primary-muted': '#1E4F4F',
          'primary-tint': '#EAF4F4',
          accent: '#D9F4A5',
          'accent-mid': '#B8E070',
          'accent-dark': '#4E6E20',
          bg: '#F7F6F0',
          'bg-alt': '#EFEDE5',
          coral: '#F29C7B',
          'coral-light': '#FDF0EB',
          'coral-dark': '#C97550',
          text: '#24373A',
          'text-muted': '#5A7275',
          'text-light': '#90AAAC',
          'border': '#DDD9CE',
          'border-light': '#EEECE5',
        },
      },
      fontFamily: {
        display: ['var(--font-manrope)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        'brand-xs': '0 1px 2px rgba(16, 59, 59, 0.06)',
        'brand-sm': '0 1px 4px rgba(16, 59, 59, 0.08)',
        brand: '0 2px 8px rgba(16, 59, 59, 0.10)',
        'brand-md': '0 4px 16px rgba(16, 59, 59, 0.12)',
        'brand-lg': '0 8px 32px rgba(16, 59, 59, 0.14)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      maxWidth: {
        '8xl': '88rem',
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
