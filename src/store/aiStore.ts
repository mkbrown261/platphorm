import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppSettings, LayerResult, PipelineResult } from '../types'

interface AIState {
  settings: AppSettings
  isConfigured: boolean
  pipelineHistory: PipelineResult[]
  activePipeline: PipelineResult | null
  pipelineRunning: boolean
  layerProgress: { index: number; name: string; result?: LayerResult } | null

  updateSettings: (s: Partial<AppSettings>) => void
  setConfigured: (v: boolean) => void
  startPipeline: () => void
  updateLayerProgress: (index: number, name: string, result?: LayerResult) => void
  completePipeline: (result: PipelineResult) => void
  clearPipeline: () => void
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'midnight',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  providers: {},
  preferredProvider: 'openrouter',
  preferredModel: 'anthropic/claude-sonnet-4-5',
  autoRunPipeline: false,
  pipelineOnSave: false,
  governanceStrictMode: false
}

export const useAIStore = create<AIState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      isConfigured: false,
      pipelineHistory: [],
      activePipeline: null,
      pipelineRunning: false,
      layerProgress: null,

      updateSettings: (s) =>
        set((state) => ({ settings: { ...state.settings, ...s } })),

      setConfigured: (v) => set({ isConfigured: v }),

      startPipeline: () => set({ pipelineRunning: true, layerProgress: null }),

      updateLayerProgress: (index, name, result) =>
        set({ layerProgress: { index, name, result } }),

      completePipeline: (result) =>
        set((s) => ({
          pipelineRunning: false,
          activePipeline: result,
          layerProgress: null,
          pipelineHistory: [...s.pipelineHistory.slice(-50), result]
        })),

      clearPipeline: () =>
        set({ activePipeline: null, pipelineRunning: false, layerProgress: null })
    }),
    {
      name: 'platphorm-ai-settings',
      // Only persist settings and isConfigured — not pipeline history or runtime state
      partialize: (state) => ({
        settings: state.settings,
        isConfigured: state.isConfigured,
      }),
    }
  )
)
