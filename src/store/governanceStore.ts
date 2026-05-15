import { create } from 'zustand'
import type { AuditLog, GovernanceEvent, GovernanceReport } from '../types'

interface GovernanceState {
  events: GovernanceEvent[]
  auditLog: AuditLog[]
  report: GovernanceReport | null
  strictMode: boolean

  addEvent: (event: GovernanceEvent) => void
  appendAudit: (entry: AuditLog) => void
  setReport: (report: GovernanceReport) => void
  setStrictMode: (v: boolean) => void
  clearEvents: () => void
}

export const useGovernanceStore = create<GovernanceState>((set) => ({
  events: [],
  auditLog: [],
  report: null,
  strictMode: false,

  addEvent: (event) =>
    set((s) => ({ events: [...s.events.slice(-200), event] })),

  appendAudit: (entry) =>
    set((s) => ({ auditLog: [...s.auditLog, entry] })),

  setReport: (report) => set({ report }),

  setStrictMode: (v) => set({ strictMode: v }),

  clearEvents: () => set({ events: [] })
}))
