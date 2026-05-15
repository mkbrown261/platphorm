import { create } from 'zustand'
import type { ModelRole } from '../types'

export interface OpenRouterModel {
  id: string
  name: string
  description?: string
  context_length: number
  pricing: { prompt: string; completion: string }
  top_provider?: { context_length?: number }
}

// Default role → model assignments — matches AIOrchestrator ROLE_MODEL_MAP
export const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
  architect:    'anthropic/claude-opus-4',
  security:     'anthropic/claude-opus-4',
  backend:      'anthropic/claude-sonnet-4-5',
  frontend:     'anthropic/claude-sonnet-4-5',
  refactor:     'anthropic/claude-sonnet-4-5',
  performance:  'google/gemini-2.5-pro',
  general:      'anthropic/claude-sonnet-4-5',
  validation:   'deepseek/deepseek-r1',
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

interface ModelState {
  // Fetched model catalog
  availableModels: OpenRouterModel[]
  isLoadingModels: boolean
  modelsError: string | null
  lastFetchedAt: number | null

  // Role → model assignments (overrides AIOrchestrator defaults)
  roleModels: Record<ModelRole, string>

  // Per-session model override (user picks for this conversation)
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

export const useModelStore = create<ModelState>((set) => ({
  availableModels: [],
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
}))
