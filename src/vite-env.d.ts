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
    }
  }
  electron: {
    ipcRenderer: Electron.IpcRenderer
  }
}
