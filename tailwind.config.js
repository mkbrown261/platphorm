/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ["'JetBrains Mono'", "'Fira Code'", 'monospace']
      },
      colors: {
        base: {
          950: '#07070e',
          900: '#0d0d14',
          800: '#0b0b12',
          700: '#11111a',
          600: '#16161f',
          500: '#1a1a2e',
          400: '#252540'
        },
        violet: {
          950: '#2e1065',
          900: '#4c1d95',
          800: '#5b21b6',
          700: '#6d28d9',
          600: '#7c3aed',
          500: '#8b5cf6',
          400: '#a78bfa',
          300: '#c4b5fd',
          200: '#ddd6fe',
          100: '#ede9fe'
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      }
    }
  },
  plugins: []
}
