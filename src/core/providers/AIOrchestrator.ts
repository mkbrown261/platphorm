import type {
  AIProviderInterface,
  AppSettings,
  GenerationOptions,
  ModelConfig,
  ModelProvider,
  ModelRole,
  OrchestratorRequest,
  OrchestratorResult,
  ProviderConfig,
  StreamChunk
} from '../../types'
import { AnthropicProvider } from './AnthropicProvider'
import { OpenAIProvider } from './OpenAIProvider'
import { OpenRouterProvider } from './OpenRouterProvider'

const ROLE_MODEL_MAP: Record<ModelRole, string> = {
  architect: 'anthropic/claude-opus-4',
  security: 'anthropic/claude-opus-4',
  backend: 'anthropic/claude-sonnet-4-5',
  frontend: 'anthropic/claude-sonnet-4-5',
  refactor: 'anthropic/claude-sonnet-4-5',
  performance: 'google/gemini-2.5-pro',
  general: 'anthropic/claude-sonnet-4-5',
  validation: 'deepseek/deepseek-r1',
  continuity: 'google/gemini-2.5-pro'
}

export class AIOrchestrator {
  private providers: Map<ModelProvider, AIProviderInterface> = new Map()
  private preferredProvider: ModelProvider = 'openrouter'
  private fallbackOrder: ModelProvider[] = ['openrouter', 'anthropic', 'openai']

  configure(settings: Partial<AppSettings>): void {
    const { providers, preferredProvider } = settings

    if (providers?.openrouter) {
      this.providers.set('openrouter', new OpenRouterProvider(providers.openrouter))
    }
    if (providers?.anthropic) {
      this.providers.set('anthropic', new AnthropicProvider(providers.anthropic))
    }
    if (providers?.openai) {
      this.providers.set('openai', new OpenAIProvider(providers.openai))
    }

    if (preferredProvider) {
      this.preferredProvider = preferredProvider as ModelProvider
    }
  }

  addProvider(config: ProviderConfig): void {
    switch (config.provider) {
      case 'openrouter':
        this.providers.set('openrouter', new OpenRouterProvider(config.apiKey))
        break
      case 'anthropic':
        this.providers.set('anthropic', new AnthropicProvider(config.apiKey))
        break
      case 'openai':
        this.providers.set('openai', new OpenAIProvider(config.apiKey))
        break
    }
  }

  private selectModel(role: ModelRole, provider: ModelProvider): string {
    if (provider === 'openrouter') {
      return ROLE_MODEL_MAP[role] ?? ROLE_MODEL_MAP.general
    }
    if (provider === 'anthropic') {
      return role === 'architect' || role === 'security'
        ? 'claude-opus-4-7'
        : 'claude-sonnet-4-6'
    }
    if (provider === 'openai') {
      return role === 'architect' || role === 'security' ? 'o3' : 'gpt-4o'
    }
    return 'anthropic/claude-sonnet-4-5'
  }

  private getProvider(name: ModelProvider): AIProviderInterface | null {
    return this.providers.get(name) ?? null
  }

  async orchestrate(request: OrchestratorRequest): Promise<OrchestratorResult> {
    const role = request.role ?? 'general'
    let fallbackUsed = false

    const order = [
      this.preferredProvider,
      ...this.fallbackOrder.filter((p) => p !== this.preferredProvider)
    ]

    for (const providerName of order) {
      const provider = this.getProvider(providerName)
      if (!provider) continue

      try {
        const model = this.selectModel(role, providerName)
        const options: GenerationOptions = {
          ...(request.options ?? {}),
          model,
          role
        }

        const result = await provider.generate(request.prompt, options)
        return {
          result,
          provider: providerName,
          model,
          role,
          fallbackUsed
        }
      } catch {
        fallbackUsed = true
        continue
      }
    }

    throw new Error('All AI providers failed. Check your API keys in Settings.')
  }

  async *streamOrchestrate(
    request: OrchestratorRequest
  ): AsyncGenerator<StreamChunk & { provider: ModelProvider; model: string }> {
    const role = request.role ?? 'general'

    const order = [
      this.preferredProvider,
      ...this.fallbackOrder.filter((p) => p !== this.preferredProvider)
    ]

    for (const providerName of order) {
      const provider = this.getProvider(providerName)
      if (!provider) continue

      try {
        const model = this.selectModel(role, providerName)
        const options: GenerationOptions = { ...(request.options ?? {}), model, role }

        for await (const chunk of provider.stream(request.prompt, options)) {
          yield { ...chunk, provider: providerName, model }
        }
        return
      } catch {
        continue
      }
    }

    throw new Error('All AI providers failed during streaming.')
  }

  async listAllModels(): Promise<ModelConfig[]> {
    const results: ModelConfig[] = []
    for (const provider of this.providers.values()) {
      const models = await provider.listModels().catch(() => [])
      results.push(...models)
    }
    return results
  }

  hasProviders(): boolean {
    return this.providers.size > 0
  }

  getActiveProviders(): ModelProvider[] {
    return Array.from(this.providers.keys())
  }
}

export const orchestrator = new AIOrchestrator()
