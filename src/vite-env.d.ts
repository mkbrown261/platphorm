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
      writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
      readDir: (dirPath: string) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>
      exists: (filePath: string) => Promise<boolean>
      mkdir: (dirPath: string) => Promise<{ success: boolean; error?: string }>
      getHome: () => Promise<string>
      applyChanges: (changes: Array<{ path: string; type: string; after?: string }>) => Promise<Array<{ path: string; success: boolean; error?: string }>>
      gitBackup: (projectPath: string) => Promise<{ success: boolean; error?: string }>
      appendAuditLog: (projectPath: string, entry: string) => Promise<{ success: boolean; error?: string }>
      readAuditLog: (projectPath: string) => Promise<unknown[]>
    }
    ai: {
      listModels: (apiKey: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
    }
    preview: {
      open: (content: string, title?: string) => Promise<{ success: boolean; error?: string }>
      readForPreview: (filePath: string) => Promise<{ success: boolean; content?: string; ext?: string; error?: string }>
    }
  }
  electron: {
    ipcRenderer: Electron.IpcRenderer
  }
}
