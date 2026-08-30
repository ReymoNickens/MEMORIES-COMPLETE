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
      // One palette, matching the tokens in globals.css. The house is a dark
      // room: near-black ground, bone type, crimson for the one thing that
      // matters on a screen. Two competing palettes under the same `ev.*`
      // names is why the customer walked from a black landing page onto a
      // grey-white menu.
      colors: {
        ev: {
          bg:         '#08070D',  // the room
          elevated:   '#100E14',  // a card lifted off it
          card:       '#16131A',
          page:       '#08070D',
          primary:    '#F3EDE4',  // bone
          secondary:  '#C4B8A8',
          dark:       '#14090B',
          muted:      '#8A8580',
          faint:      '#6B6570',
          crimson:    '#B8122A',  // the only accent
          accent:     '#C4B8A8',
          success:    '#1A5C2E',
          successText:'#7DCF8A',
          warning:    '#E0A24A',
          error:      '#B8122A',
          border:     '#2A242C',
          borderDark: '#2A242C',
          momo:       '#FFCB05',  // MTN yellow, not ours to change
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'Arial', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
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
