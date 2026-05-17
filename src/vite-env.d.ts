/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY: string
  readonly VITE_ANTHROPIC_API_KEY: string
  readonly VITE_OPENAI_API_KEY: string
  readonly VITE_GOOGLE_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  api: {
    // ── File system ──────────────────────────────────────────────────────────
    fs: {
      openFolder: () => Promise<string | null>
      readFile: (filePath: string) => Promise<string | null>
      writeFile: (
        filePath: string,
        content: string
      ) => Promise<{ success: boolean; error?: string }>
      readDir: (
        dirPath: string
      ) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>
      exists: (filePath: string) => Promise<boolean>
      mkdir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
      getHome: () => Promise<string>
    }
    // ── Persistent settings (electron-store) ─────────────────────────────────
    store: {
      get:    (key: string) => Promise<unknown>
      set:    (key: string, value: unknown) => Promise<{ success: boolean }>
      delete: (key: string) => Promise<{ success: boolean }>
      getAll: () => Promise<Record<string, unknown>>
    }
    // ── Live preview: spawns dev server as child process ─────────────────────
    preview: {
      start:  (projectPath: string) => Promise<{ success: boolean; port?: number; url?: string; error?: string }>
      stop:   (projectPath: string) => Promise<{ success: boolean }>
      status: (projectPath: string) => Promise<{ running: boolean; port?: number; url?: string }>
    }
    // ── Shell utilities ──────────────────────────────────────────────────────
    // NOTE: electronAPI from @electron-toolkit/preload does NOT expose shell.
    // We use a safe IPC-based route for openExternal instead.
    shell: {
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
    }
  }
  electron: {
    ipcRenderer: {
      send: (channel: string, ...args: unknown[]) => void
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => () => void
      once: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
      removeAllListeners: (channel: string) => void
    }
  }
}
