import type { AIProviderInterface, GenerationOptions, GenerationResult, ModelConfig, StreamChunk } from '../../../types'

export abstract class BaseAIProvider implements AIProviderInterface {
  protected apiKey: string
  protected baseURL: string

  constructor(apiKey: string, baseURL: string) {
    this.apiKey = apiKey
    this.baseURL = baseURL
  }

  abstract generate(prompt: string, options?: GenerationOptions): Promise<GenerationResult>
  abstract stream(prompt: string, options?: GenerationOptions): AsyncGenerator<StreamChunk>
  abstract isAvailable(): Promise<boolean>
  abstract listModels(): Promise<ModelConfig[]>

  protected buildMessages(prompt: string, systemPrompt?: string) {
    const messages: Array<{ role: string; content: string }> = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: prompt })
    return messages
  }
}
