import OpenAI from 'openai'
import type { GenerationOptions, GenerationResult, ModelConfig, StreamChunk } from '../../types'
import { BaseAIProvider } from './interfaces/AIProvider'

const OPENAI_MODELS: ModelConfig[] = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.005, output: 0.015 },
    recommendedRoles: ['backend', 'frontend', 'general']
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    recommendedRoles: ['performance']
  },
  {
    id: 'o3',
    name: 'o3',
    provider: 'openai',
    contextWindow: 200000,
    supportsFunctionCalling: true,
    supportsStreaming: false,
    costPer1kTokens: { input: 0.01, output: 0.04 },
    recommendedRoles: ['architect', 'security', 'validation']
  }
]

export class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI

  constructor(apiKey: string) {
    super(apiKey, 'https://api.openai.com/v1')
    this.client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })
  }

  async generate(prompt: string, options: GenerationOptions = {}): Promise<GenerationResult> {
    const model = options.model ?? 'gpt-4o'
    const start = Date.now()

    const response = await this.withRetry(() => this.client.chat.completions.create({
      model,
      messages: this.buildMessages(prompt, options.systemPrompt, options.attachments) as any,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
      stream: false
    }))

    const content = response.choices[0]?.message?.content ?? ''
    return {
      content,
      model,
      provider: 'openai',
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0
      },
      latencyMs: Date.now() - start
    }
  }

  async *stream(prompt: string, options: GenerationOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? 'gpt-4o'

    const stream = await this.client.chat.completions.create({
      model,
      messages: this.buildMessages(prompt, options.systemPrompt) as any,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
      stream: true
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? ''
      const done = chunk.choices[0]?.finish_reason != null
      yield { content, done, model }
      if (done) break
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list()
      return true
    } catch {
      return false
    }
  }

  async listModels(): Promise<ModelConfig[]> {
    return OPENAI_MODELS
  }
}
