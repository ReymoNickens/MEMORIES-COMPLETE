import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontSize: {
        'display-xl': ['40px', { lineHeight: '1.1', fontWeight: '700' }],
        'display-lg': ['28px', { lineHeight: '1.15', fontWeight: '700' }],
        'h1':         ['24px', { lineHeight: '1.2', fontWeight: '700' }],
        'h2':         ['18px', { lineHeight: '1.25', fontWeight: '700' }],
        'h3':         ['14px', { lineHeight: '1.3', fontWeight: '600' }],
        'body-lg':    ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-md':    ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        'label':      ['12px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.08em' }],
        'micro':      ['11px', { lineHeight: '1.3', fontWeight: '400' }],
        'data':       ['14px', { lineHeight: '1.4' }],
        'scanner-lg': ['40px', { lineHeight: '1.1', fontWeight: '700' }],
        'scanner-md': ['24px', { lineHeight: '1.2', fontWeight: '400' }],
      },
      colors: {
        ev: {
          bg:         '#0A0B0C',
          elevated:   '#121416',
          page:       '#F8F9FA',
          card:       '#FFFFFF',
          primary:    '#ECECE8',
          secondary:  '#9A9E9F',
          dark:       '#111111',
          muted:      '#6B7380',
          navy:       '#0B1F4B',
          crimson:    '#B8122A',
          accent:     '#C8CCD4',
          success:    '#1A5C2E',
          warning:    '#B86800',
          border:     '#D8DCE2',
          borderDark: '#2A2D32',
          momo:       '#FFCB05',
        },
      },
      minHeight: {
        'tap': '48px',
        'tap-lg': '56px',
      },
      minWidth: {
        'tap': '48px',
      },
    },
  },
  plugins: [],
}

export default config
