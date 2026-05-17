export type ModelProvider = 'openrouter' | 'anthropic' | 'openai' | 'google' | 'custom'
export type ModelRole =
  | 'architect'
  | 'backend'
  | 'frontend'
  | 'security'
  | 'performance'
  | 'refactor'
  | 'general'
  | 'validation'
  | 'continuity'

export interface ModelConfig {
  id: string
  name: string
  provider: ModelProvider
  contextWindow: number
  supportsFunctionCalling: boolean
  supportsStreaming: boolean
  costPer1kTokens: { input: number; output: number }
  recommendedRoles: ModelRole[]
}

export interface ProviderConfig {
  provider: ModelProvider
  apiKey: string
  baseURL?: string
  defaultModel?: string
}

export interface GenerationOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  systemPrompt?: string
  role?: ModelRole
}

export interface GenerationResult {
  content: string
  model: string
  provider: ModelProvider
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  latencyMs: number
}

export interface StreamChunk {
  content: string
  done: boolean
  model?: string
}

export interface AIProviderInterface {
  readonly apiKey: string
  readonly baseURL: string
  generate(prompt: string, options?: GenerationOptions): Promise<GenerationResult>
  stream(prompt: string, options?: GenerationOptions): AsyncGenerator<StreamChunk>
  isAvailable(): Promise<boolean>
  listModels(): Promise<ModelConfig[]>
}

export interface OrchestratorRequest {
  prompt: string
  role: ModelRole
  context?: string
  options?: GenerationOptions
}

export interface OrchestratorResult {
  result: GenerationResult
  provider: ModelProvider
  model: string
  role: ModelRole
  fallbackUsed: boolean
}
