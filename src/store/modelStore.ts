import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelRole } from '../types'

export interface OpenRouterModel {
  id: string
  name: string
  description?: string
  context_length: number
  pricing: { prompt: string; completion: string }
  top_provider?: { context_length?: number }
}

// Canonical role→model map. Single source of truth — also imported by AIOrchestrator.
// OpenRouter model IDs: https://openrouter.ai/models
export const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
  architect:    'anthropic/claude-opus-4-7',
  security:     'anthropic/claude-opus-4-7',
  backend:      'anthropic/claude-sonnet-4-6',
  frontend:     'anthropic/claude-sonnet-4-6',
  refactor:     'anthropic/claude-sonnet-4-6',
  performance:  'google/gemini-2.5-pro',
  general:      'anthropic/claude-sonnet-4-6',
  validation:   'deepseek/deepseek-r1-0528',
  continuity:   'google/gemini-2.5-pro'
}

export const ROLE_DESCRIPTIONS: Record<ModelRole, string> = {
  architect:    'Architecture planning, DNA analysis, registry management',
  security:     'Security audits, threat modeling, vulnerability detection',
  backend:      'Services, APIs, auth, databases, business logic',
  frontend:     'UI components, state binding, rendering',
  refactor:     'Code improvement, coherence, drift removal',
  performance:  'Optimization, bundle analysis, profiling',
  general:      'General chat, direct answers (no project open)',
  validation:   'Output validation, contract checking, type verification',
  continuity:   'Coherence checks, cross-session memory, drift detection'
}

// Hand-curated list of the best current models — shown before the live catalog loads
// These cover the most important providers so users can immediately pick a model
export const FEATURED_MODELS: OpenRouterModel[] = [
  // Anthropic Claude
  { id: 'anthropic/claude-opus-4-7',   name: 'Claude Opus 4.7',   context_length: 200000, pricing: { prompt: '0.000015', completion: '0.000075' } },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'anthropic/claude-haiku-4-5',  name: 'Claude Haiku 4.5',  context_length: 200000, pricing: { prompt: '0.0000008', completion: '0.000004' } },
  // OpenAI
  { id: 'openai/gpt-4o',               name: 'GPT-4o',            context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001' } },
  { id: 'openai/gpt-4o-mini',          name: 'GPT-4o mini',       context_length: 128000, pricing: { prompt: '0.00000015', completion: '0.0000006' } },
  { id: 'openai/o3',                   name: 'OpenAI o3',         context_length: 200000, pricing: { prompt: '0.00001', completion: '0.00004' } },
  { id: 'openai/o4-mini',              name: 'OpenAI o4-mini',    context_length: 200000, pricing: { prompt: '0.0000011', completion: '0.0000044' } },
  // Google Gemini
  { id: 'google/gemini-2.5-pro',       name: 'Gemini 2.5 Pro',    context_length: 1000000, pricing: { prompt: '0.00000125', completion: '0.00001' } },
  { id: 'google/gemini-2.5-flash',     name: 'Gemini 2.5 Flash',  context_length: 1000000, pricing: { prompt: '0.000000075', completion: '0.0000003' } },
  // DeepSeek
  { id: 'deepseek/deepseek-r1-0528',   name: 'DeepSeek R1 0528',  context_length: 160000, pricing: { prompt: '0.0000005', completion: '0.00000215' } },
  { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3',    context_length: 160000, pricing: { prompt: '0.00000027', completion: '0.0000011' } },
  // Meta Llama
  { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick',  context_length: 524288, pricing: { prompt: '0.0000002', completion: '0.0000006' } },
  { id: 'meta-llama/llama-4-scout',    name: 'Llama 4 Scout',     context_length: 524288, pricing: { prompt: '0.00000008', completion: '0.00000024' } },
  // Mistral
  { id: 'mistralai/mistral-large',     name: 'Mistral Large',     context_length: 128000, pricing: { prompt: '0.000002', completion: '0.000006' } },
  { id: 'mistralai/codestral-2501',    name: 'Codestral 2501',    context_length: 256000, pricing: { prompt: '0.000001', completion: '0.000003' } },
]

interface ModelState {
  // Fetched model catalog from OpenRouter API
  availableModels: OpenRouterModel[]
  isLoadingModels: boolean
  modelsError: string | null
  lastFetchedAt: number | null

  // Role → model assignments (persisted)
  roleModels: Record<ModelRole, string>

  // Per-session overrides (not persisted — reset on launch)
  sessionModel: string | null
  sessionRole: ModelRole | null

  // Actions
  setAvailableModels: (models: OpenRouterModel[]) => void
  setLoadingModels: (v: boolean) => void
  setModelsError: (e: string | null) => void
  setRoleModel: (role: ModelRole, modelId: string) => void
  setRoleModels: (map: Record<ModelRole, string>) => void
  setSessionModel: (model: string | null) => void
  setSessionRole: (role: ModelRole | null) => void
  resetRoleModels: () => void
}

export const useModelStore = create<ModelState>()(
  persist(
    (set) => ({
      availableModels: FEATURED_MODELS,  // start with curated list, live fetch replaces it
      isLoadingModels: false,
      modelsError: null,
      lastFetchedAt: null,

      roleModels: { ...DEFAULT_ROLE_MODELS },

      sessionModel: null,
      sessionRole: null,

      setAvailableModels: (models) =>
        set({ availableModels: models, lastFetchedAt: Date.now(), modelsError: null }),

      setLoadingModels: (v) => set({ isLoadingModels: v }),

      setModelsError: (e) => set({ modelsError: e, isLoadingModels: false }),

      setRoleModel: (role, modelId) =>
        set(s => ({ roleModels: { ...s.roleModels, [role]: modelId } })),

      setRoleModels: (map) => set({ roleModels: map }),

      setSessionModel: (model) => set({ sessionModel: model }),

      setSessionRole: (role) => set({ sessionRole: role }),

      resetRoleModels: () => set({ roleModels: { ...DEFAULT_ROLE_MODELS } })
    }),
    {
      name: 'platphorm-models',
      // Persist role assignments and cached model list, but not loading/error state
      partialize: (state) => ({
        availableModels: state.availableModels,
        lastFetchedAt: state.lastFetchedAt,
        roleModels: state.roleModels,
      }),
    }
  )
)
