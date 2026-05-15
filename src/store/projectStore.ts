import { create } from 'zustand'
import type { EditorTab, FileEntry, Project } from '../types'

interface ProjectState {
  activeProject: Project | null
  fileTree: FileEntry[]
  openTabs: EditorTab[]
  activeTabId: string | null

  setProject: (project: Project) => void
  setFileTree: (tree: FileEntry[]) => void
  openFile: (filePath: string, content: string, language: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTabContent: (tabId: string, content: string) => void
  markTabClean: (tabId: string) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProject: null,
  fileTree: [],
  openTabs: [],
  activeTabId: null,

  setProject: (project) => set({ activeProject: project }),

  setFileTree: (tree) => set({ fileTree: tree }),

  openFile: (filePath, content, language) => {
    const { openTabs } = get()
    const existing = openTabs.find((t) => t.filePath === filePath)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }

    const tab: EditorTab = {
      id: `tab-${Date.now()}`,
      filePath,
      content,
      language,
      isDirty: false,
      isActive: true
    }

    set((s) => ({
      openTabs: [...s.openTabs.map((t) => ({ ...t, isActive: false })), tab],
      activeTabId: tab.id
    }))
  },

  closeTab: (tabId) => {
    const { openTabs, activeTabId } = get()
    const remaining = openTabs.filter((t) => t.id !== tabId)
    const newActive =
      activeTabId === tabId ? (remaining[remaining.length - 1]?.id ?? null) : activeTabId
    set({ openTabs: remaining, activeTabId: newActive })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updateTabContent: (tabId, content) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t
      )
    }))
  },

  markTabClean: (tabId) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t))
    }))
  }
}))
