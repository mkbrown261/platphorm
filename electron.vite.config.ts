import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // electron-store v10+ is ESM-only; exclude it from externalization so it
    // gets bundled into the CJS main output instead of require()'d at runtime
    // (a raw require of an ESM package yields a namespace object, not the
    // Store constructor → "TypeError: Store is not a constructor").
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
    build: {
      lib: {
        entry: resolve('electron/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@main': resolve('electron/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('electron/preload/index.ts')
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: {
        input: resolve('index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src'),
        '@core': resolve('src/core'),
        '@types': resolve('src/types'),
        '@store': resolve('src/store'),
        '@components': resolve('src/components')
      }
    },
    plugins: [react()]
  }
})
