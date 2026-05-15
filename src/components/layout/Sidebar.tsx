import { useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { dnaEngine } from '../../core/dna/DNAEngine'
import type { FileEntry } from '../../types'

interface SidebarProps {
  activePanel: string
  onPanelChange: (panel: string) => void
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  css: 'css',
  json: 'json',
  md: 'markdown',
  html: 'html',
  sh: 'shell',
  yaml: 'yaml',
  yml: 'yaml'
}

function FileTreeNode({ entry, depth = 0 }: { entry: FileEntry; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2)
  const openFile = useProjectStore((s) => s.openFile)

  const handleClick = async () => {
    if (entry.isDirectory) {
      setExpanded((v) => !v)
      return
    }
    const content = await window.api.fs.readFile(entry.path)
    const ext = entry.name.split('.').pop() ?? ''
    const language = LANGUAGE_MAP[ext] ?? 'plaintext'
    openFile(entry.path, content ?? '', language)
  }

  return (
    <div>
      <button
        className="w-full flex items-center gap-1 px-2 py-[3px] hover:bg-white/5 text-left text-xs text-slate-400 hover:text-slate-200 transition-colors rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={handleClick}
      >
        <span className="flex-shrink-0 text-slate-600">
          {entry.isDirectory ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className={entry.isDirectory ? 'text-slate-300' : ''}>{entry.name}</span>
      </button>
      {entry.isDirectory && expanded && entry.children?.map((child) => (
        <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function Sidebar({ activePanel, onPanelChange }: SidebarProps) {
  const { activeProject, fileTree, setProject, setFileTree } = useProjectStore()
  const { setDNA, setInitializing, setInitialized, setInitError } = useDNAStore()

  const handleOpenFolder = async () => {
    const folderPath = await window.api.fs.openFolder()
    if (!folderPath) return

    const name = folderPath.split('/').pop() ?? 'Project'
    setProject({
      id: `project-${Date.now()}`,
      name,
      rootPath: folderPath,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      hasDNA: false
    })

    const entries = await buildFileTree(folderPath, 0)
    setFileTree(entries)

    // Auto-initialize DNA
    setInitializing(true)
    try {
      const dna = await dnaEngine.initialize(folderPath)
      setDNA(dna)
      setInitialized(true)
    } catch (e) {
      setInitError(String(e))
    } finally {
      setInitializing(false)
    }
  }

  const NAV_ITEMS = [
    { id: 'files', icon: '⌗', label: 'Files' },
    { id: 'dna', icon: '⬡', label: 'DNA' },
    { id: 'governance', icon: '⚖', label: 'Laws' },
    { id: 'security', icon: '⛊', label: 'Security' },
    { id: 'pipeline', icon: '⊕', label: 'Pipeline' },
    { id: 'settings', icon: '⚙', label: 'Settings' }
  ]

  return (
    <div className="flex h-full">
      {/* Icon rail */}
      <div className="w-12 flex flex-col items-center py-4 gap-1 border-r border-[#1a1a2e] bg-[#06060e]">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            title={item.label}
            onClick={() => onPanelChange(item.id)}
            className={`w-8 h-8 flex items-center justify-center rounded text-sm transition-colors ${
              activePanel === item.id
                ? 'text-violet-400 bg-violet-500/10'
                : 'text-slate-600 hover:text-slate-400'
            }`}
          >
            {item.icon}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="flex-1 overflow-hidden flex flex-col bg-[#080810]">
        <div className="px-3 py-2 border-b border-[#1a1a2e] flex items-center justify-between">
          <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            {NAV_ITEMS.find((n) => n.id === activePanel)?.label}
          </span>
          {activePanel === 'files' && (
            <button
              onClick={handleOpenFolder}
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              Open
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {activePanel === 'files' && (
            <div className="py-2">
              {!activeProject ? (
                <div className="px-3 py-8 text-center">
                  <div className="text-slate-600 text-xs mb-3">No project open</div>
                  <button
                    onClick={handleOpenFolder}
                    className="text-xs text-violet-400 hover:text-violet-300 border border-violet-500/30 rounded px-3 py-1.5 transition-colors"
                  >
                    Open Folder
                  </button>
                </div>
              ) : (
                fileTree.map((entry) => (
                  <FileTreeNode key={entry.path} entry={entry} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

async function buildFileTree(dirPath: string, depth: number): Promise<FileEntry[]> {
  if (depth > 3) return []
  const IGNORED = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.DS_Store'])

  try {
    const entries = await window.api.fs.readDir(dirPath)
    const result: FileEntry[] = []

    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue
      const node: FileEntry = {
        name: entry.name,
        path: entry.path,
        isDirectory: entry.isDirectory
      }
      if (entry.isDirectory && depth < 3) {
        node.children = await buildFileTree(entry.path, depth + 1)
      }
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
