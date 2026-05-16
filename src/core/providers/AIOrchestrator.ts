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
import { buildUnifiedIdentity, type IdentityContext } from '../intelligence/UnifiedIdentity'
import { DEFAULT_ROLE_MODELS } from '../../store/modelStore'

// Runtime role→model overrides (set by modelStore)
let _roleModelOverrides: Partial<Record<ModelRole, string>> = {}
let _sessionModelOverride: string | null = null

// Unified AI Identity context — set once when DNA loads, used in every call
let _identityContext: IdentityContext = {}

export function setRoleModelOverrides(overrides: Partial<Record<ModelRole, string>>) {
  _roleModelOverrides = overrides
}

export function setSessionModelOverride(model: string | null) {
  _sessionModelOverride = model
}

/**
 * Sets the global identity context used to build the UnifiedIdentity system prompt.
 * Call this whenever DNA loads or the architecture doc changes.
 * Every subsequent orchestrate() and streamOrchestrate() call will use this context.
 */
export function setIdentityContext(context: IdentityContext) {
  _identityContext = context
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
    // 1. Session override wins (user picked a specific model for this conversation)
    if (_sessionModelOverride) return _sessionModelOverride

    if (provider === 'openrouter') {
      // 2. User-configured role override wins over defaults (modelStore is single source of truth)
      return _roleModelOverrides[role] ?? DEFAULT_ROLE_MODELS[role] ?? DEFAULT_ROLE_MODELS.general
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

    // Build the Unified AI Identity and inject as system prompt.
    // If the request already has a system prompt, prepend the identity to it.
    // This ensures every AI call is architecturally aware — no exceptions.
    const unifiedIdentity = buildUnifiedIdentity(_identityContext)
    const baseSystemPrompt = request.options?.systemPrompt
    const systemPrompt = baseSystemPrompt
      ? `${unifiedIdentity}\n\n---\n\n${baseSystemPrompt}`
      : unifiedIdentity

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
          role,
          systemPrompt
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

    // Inject Unified AI Identity into every streaming call as well
    const unifiedIdentity = buildUnifiedIdentity(_identityContext)
    const baseSystemPrompt = request.options?.systemPrompt
    const systemPrompt = baseSystemPrompt
      ? `${unifiedIdentity}\n\n---\n\n${baseSystemPrompt}`
      : unifiedIdentity

    const order = [
      this.preferredProvider,
      ...this.fallbackOrder.filter((p) => p !== this.preferredProvider)
    ]

    for (const providerName of order) {
      const provider = this.getProvider(providerName)
      if (!provider) continue

      try {
        const model = this.selectModel(role, providerName)
        const options: GenerationOptions = { ...(request.options ?? {}), model, role, systemPrompt }

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
