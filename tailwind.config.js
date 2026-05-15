/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", 'monospace']
      },
      colors: {
        midnight: {
          50: '#0a0a14',
          100: '#080810',
          200: '#06060e',
          300: '#0d0d1a',
          400: '#1a1a2e'
        }
      }
    }
  },
  plugins: []
}
