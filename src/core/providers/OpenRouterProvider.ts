import OpenAI from 'openai'
import type { GenerationOptions, GenerationResult, ModelConfig, StreamChunk } from '../../types'
import { BaseAIProvider } from './interfaces/AIProvider'

const OPENROUTER_MODELS: ModelConfig[] = [
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'openrouter',
    contextWindow: 200000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.015, output: 0.075 },
    recommendedRoles: ['architect', 'security']
  },
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.5',
    provider: 'openrouter',
    contextWindow: 200000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.003, output: 0.015 },
    recommendedRoles: ['backend', 'frontend', 'refactor', 'general']
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openrouter',
    contextWindow: 128000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.005, output: 0.015 },
    recommendedRoles: ['backend', 'frontend', 'general']
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'openrouter',
    contextWindow: 1000000,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.00125, output: 0.01 },
    recommendedRoles: ['performance', 'continuity']
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'openrouter',
    contextWindow: 64000,
    supportsFunctionCalling: false,
    supportsStreaming: true,
    costPer1kTokens: { input: 0.00055, output: 0.00219 },
    recommendedRoles: ['validation']
  }
]

export class OpenRouterProvider extends BaseAIProvider {
  private client: OpenAI

  constructor(apiKey: string) {
    super(apiKey, 'https://openrouter.ai/api/v1')
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://platphorm.dev',
        'X-Title': 'PLATPHORM'
      },
      dangerouslyAllowBrowser: true
    })
  }

  async generate(prompt: string, options: GenerationOptions = {}): Promise<GenerationResult> {
    const model = options.model ?? 'anthropic/claude-sonnet-4-6'
    const start = Date.now()

    const response = await this.withRetry(() => this.client.chat.completions.create({
      model,
      messages: this.buildMessages(prompt, options.systemPrompt) as any,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
      stream: false
    }))

    const content = response.choices[0]?.message?.content ?? ''
    return {
      content,
      model,
      provider: 'openrouter',
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0
      },
      latencyMs: Date.now() - start
    }
  }

  async *stream(prompt: string, options: GenerationOptions = {}): AsyncGenerator<StreamChunk> {
    const model = options.model ?? 'anthropic/claude-sonnet-4-6'

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
    return OPENROUTER_MODELS
  }
}
