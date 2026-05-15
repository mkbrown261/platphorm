export * from './ai'
export * from './dna'
export * from './governance'
export * from './intelligence'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

export interface EditorTab {
  id: string
  filePath: string
  content: string
  language: string
  isDirty: boolean
  isActive: boolean
}

export interface Project {
  id: string
  name: string
  rootPath: string
  createdAt: number
  lastOpenedAt: number
  hasDNA: boolean
  dnaPath?: string
}

export interface AppSettings {
  theme: 'dark' | 'darker' | 'midnight'
  fontSize: number
  fontFamily: string
  providers: {
    openrouter?: string
    anthropic?: string
    openai?: string
    google?: string
    custom?: { baseURL: string; apiKey: string }
  }
  preferredProvider: string
  preferredModel: string
  autoRunPipeline: boolean
  pipelineOnSave: boolean
  governanceStrictMode: boolean
}
