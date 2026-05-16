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

  /**
   * Retry wrapper with exponential backoff.
   * Retries on rate-limit (429) and transient server errors (5xx).
   * Does NOT retry on auth errors (401, 403) or bad requests (400).
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
    baseDelayMs = 1000
  ): Promise<T> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn()
      } catch (err: any) {
        lastErr = err
        const status: number | undefined =
          err?.status ?? err?.response?.status ?? err?.statusCode

        // Never retry auth failures or explicit bad requests
        if (status === 401 || status === 403 || status === 400) throw err

        // Stop after last attempt
        if (attempt === maxAttempts) break

        // Respect Retry-After header if present (in seconds)
        const retryAfter = Number(err?.headers?.['retry-after'] ?? err?.response?.headers?.['retry-after'])
        const delay = !isNaN(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200

        await new Promise(r => setTimeout(r, Math.min(delay, 30_000)))
      }
    }
    throw lastErr
  }
}
