import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Faunterra four-colour system
        ivory:        '#F5F1E8',
        charcoal:     '#0B0B0B',
        forest:       '#2D3B2F',
        bronze:       '#A68A64',
        // Tonal extensions (derived, not additional colours)
        stone:        '#EDE8DC',
        'stone-dark': '#E6E1D5',
        'forest-deep':'#1C2B1E',
        moss:         '#6B705C',
        'bronze-2':   '#C9A97A',
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        ui:      ['Syne', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
      },
      letterSpacing: {
        widest: '0.4em',
        wider:  '0.25em',
        wide:   '0.15em',
      },
    },
  },
  plugins: [],
};

export default config;
