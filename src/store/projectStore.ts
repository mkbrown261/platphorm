import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EditorTab, FileEntry, Project } from '../types'

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.DS_Store'])

async function buildTree(dir: string, depth = 0): Promise<FileEntry[]> {
  if (depth > 3) return []
  try {
    const entries = await window.api.fs.readDir(dir)
    const result: FileEntry[] = []
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue
      const node: FileEntry = { name: e.name, path: e.path, isDirectory: e.isDirectory }
      if (e.isDirectory && depth < 3) node.children = await buildTree(e.path, depth + 1)
      result.push(node)
    }
    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

interface ProjectState {
  activeProject: Project | null
  fileTree: FileEntry[]
  openTabs: EditorTab[]
  activeTabId: string | null

  setProject: (project: Project) => void
  setFileTree: (tree: FileEntry[]) => void
  refreshFileTree: () => Promise<void>
  openFile: (filePath: string, content: string, language: string) => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTabContent: (tabId: string, content: string) => void
  markTabClean: (tabId: string) => void
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      activeProject: null,
      fileTree: [],
      openTabs: [],
      activeTabId: null,

      setProject: (project) => set({ activeProject: project }),

      setFileTree: (tree) => set({ fileTree: tree }),

      refreshFileTree: async () => {
        const { activeProject } = get()
        if (!activeProject?.rootPath) return
        const tree = await buildTree(activeProject.rootPath)
        set({ fileTree: tree })
      },

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
    }),
    {
      name: 'platphorm-project',
      // Only persist the active project — file tree and tabs are rebuilt from disk on startup
      partialize: (s) => ({ activeProject: s.activeProject })
    }
  )
)
