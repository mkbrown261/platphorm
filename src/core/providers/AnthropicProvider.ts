import Anthropic from '@anthropic-ai/sdk'
import type { GenerationOptions, GenerationResult, ModelConfig, StreamChunk } from '../../types'
import { BaseAIProvider } from './interfaces/AIProvider'

const ANTHROPIC_MODELS: ModelConfig[] = [
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.015, output: 0.075 },
    recommendedRoles: ['architect', 'security']
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    recommendedRoles: ['backend', 'frontend', 'refactor', 'general']
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.0008, output: 0.004 },
    recommendedRoles: ['performance']
  }
]

export class AnthropicProvider extends BaseAIProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    super(apiKey, 'https://api.anthropic.com')
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  }

  async generate(prompt: string, options: GenerationOptions = {}): Promise<GenerationResult> {
    const model = options.model ?? 'claude-sonnet-4-6'
    const start = Date.now()

    const userContent: any = options.attachments?.length
      ? [
          ...options.attachments.map(img => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mimeType, data: img.base64 }
          })),
          { type: 'text', text: prompt }
        ]
      : prompt

    const response = await this.withRetry(() => this.client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    }))

    const content = response.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    return {
      content,
      model,
      provider: 'anthropic',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens
      },
      latencyMs: Date.now() - start
    }
  }

  async *stream(prompt: string, options: GenerationOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? 'claude-sonnet-4-6'

    const stream = this.client.messages.stream({
      model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { content: event.delta.text, done: false, model }
      }
    }
    yield { content: '', done: true, model }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }]
      })
      return true
    } catch {
      return false
    }
  }

  async listModels(): Promise<ModelConfig[]> {
    return ANTHROPIC_MODELS
  }
}
