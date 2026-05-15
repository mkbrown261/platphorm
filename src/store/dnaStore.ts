import { create } from 'zustand'
import type { ProjectDNA } from '../types'

interface DNAState {
  dna: ProjectDNA | null
  isInitializing: boolean
  isInitialized: boolean
  initError: string | null

  setDNA: (dna: ProjectDNA) => void
  setInitializing: (v: boolean) => void
  setInitialized: (v: boolean) => void
  setInitError: (e: string | null) => void
  updateDNA: (partial: Partial<ProjectDNA>) => void
  clearDNA: () => void
}

export const useDNAStore = create<DNAState>((set) => ({
  dna: null,
  isInitializing: false,
  isInitialized: false,
  initError: null,

  setDNA: (dna) => set({ dna }),
  setInitializing: (v) => set({ isInitializing: v }),
  setInitialized: (v) => set({ isInitialized: v }),
  setInitError: (e) => set({ initError: e }),
  updateDNA: (partial) =>
    set((s) => (s.dna ? { dna: { ...s.dna, ...partial, lastUpdated: Date.now() } } : {})),
  clearDNA: () => set({ dna: null, isInitialized: false })
}))
