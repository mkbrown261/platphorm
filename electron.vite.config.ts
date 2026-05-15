import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('electron/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src'),
        '@core': resolve('src/core'),
        '@types': resolve('src/types'),
        '@store': resolve('src/store'),
        '@components': resolve('src/components')
      }
    },
    plugins: [react()],
    css: {
      postcss: {
        plugins: []
      }
    }
  }
})
