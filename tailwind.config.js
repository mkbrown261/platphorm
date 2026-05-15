/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ["'JetBrains Mono'", "'Fira Code'", 'ui-monospace', 'monospace']
      },
      colors: {
        void:   { DEFAULT: '#08090f', 50: '#0b0c14', 100: '#0d0f18', 200: '#11131d', 300: '#161824', 400: '#1c1f2e' },
        border: { DEFAULT: 'rgba(255,255,255,0.07)', strong: 'rgba(255,255,255,0.12)' },
        violet: {
          950: '#1a0533', 900: '#2e1065', 800: '#4c1d95',
          700: '#6d28d9', 600: '#7c3aed', 500: '#8b5cf6',
          400: '#a78bfa', 300: '#c4b5fd', 200: '#ddd6fe'
        }
      },
      boxShadow: {
        'glow-sm': '0 0 12px rgba(124,58,237,0.25)',
        'glow':    '0 0 24px rgba(124,58,237,0.3)',
        'glow-lg': '0 0 40px rgba(124,58,237,0.35)',
        'panel':   '0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06) inset'
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'violet-glow': 'radial-gradient(ellipse at top, rgba(124,58,237,0.15) 0%, transparent 70%)'
      }
    }
  },
  plugins: []
}
