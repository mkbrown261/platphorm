import { useState, useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { dnaEngine } from '../../core/dna/DNAEngine'
import type { FileEntry } from '../../types'

const FILE_ICONS: Record<string, { color: string; label: string }> = {
  ts: { color: '#3178c6', label: 'TS' },
  tsx: { color: '#3178c6', label: 'TSX' },
  js: { color: '#f7df1e', label: 'JS' },
  jsx: { color: '#61dafb', label: 'JSX' },
  css: { color: '#264de4', label: 'CSS' },
  json: { color: '#cbcb41', label: '{}' },
  md: { color: '#519aba', label: 'MD' },
  py: { color: '#3572A5', label: 'PY' },
  go: { color: '#00ADD8', label: 'GO' },
  rs: { color: '#dea584', label: 'RS' },
  html: { color: '#e34c26', label: 'HTML' },
  sh: { color: '#89e051', label: 'SH' },
  yaml: { color: '#cb171e', label: 'YML' },
  yml: { color: '#cb171e', label: 'YML' }
}

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', css: 'css', json: 'json',
  md: 'markdown', html: 'html', sh: 'shell', yaml: 'yaml', yml: 'yaml'
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop() ?? ''
  const info = FILE_ICONS[ext]
  if (!info) return <span className="text-base-400 text-xs">·</span>
  return (
    <span className="text-[9px] font-bold rounded px-0.5" style={{ color: info.color, opacity: 0.85 }}>
      {info.label}
    </span>
  )
}

function FileNode({ entry, depth = 0 }: { entry: FileEntry; depth?: number }) {
  const [open, setOpen] = useState(depth < 1)
  const openFile = useProjectStore((s) => s.openFile)

  const handleClick = useCallback(async () => {
    if (entry.isDirectory) { setOpen(v => !v); return }
    const content = await window.api.fs.readFile(entry.path)
    const ext = entry.name.split('.').pop() ?? ''
    openFile(entry.path, content ?? '', LANG_MAP[ext] ?? 'plaintext')
  }, [entry, openFile])

  return (
    <div>
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-1.5 py-[3px] pr-2 text-left rounded-sm hover:bg-white/5 transition-colors group"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {entry.isDirectory ? (
          <svg
            width="10" height="10" viewBox="0 0 10 10"
            className={`flex-shrink-0 text-base-400 transition-transform duration-100 ${open ? 'rotate-90' : ''}`}
          >
            <path d="M3 2l4 3-4 3V2z" fill="currentColor"/>
          </svg>
        ) : (
          <span className="w-2.5 flex justify-center flex-shrink-0">
            <FileIcon name={entry.name} />
          </span>
        )}
        <span className={`text-xs truncate ${entry.isDirectory ? 'text-slate-300 font-medium' : 'text-slate-400 group-hover:text-slate-200'}`}>
          {entry.name}
        </span>
      </button>
      {entry.isDirectory && open && entry.children?.map(child => (
        <FileNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </div>
  )
}

interface SidebarProps {
  panel: string
}

export function Sidebar({ panel }: SidebarProps) {
  const { activeProject, fileTree, setProject, setFileTree } = useProjectStore()
  const { setDNA, setInitializing, setInitialized, setInitError, dna, isInitializing } = useDNAStore()

  const openFolder = useCallback(async () => {
    const path = await window.api.fs.openFolder()
    if (!path) return
    setProject({ id: `p-${Date.now()}`, name: path.split('/').pop() ?? 'Project', rootPath: path, createdAt: Date.now(), lastOpenedAt: Date.now(), hasDNA: false })
    const tree = await buildTree(path, 0)
    setFileTree(tree)
    setInitializing(true)
    try {
      const d = await dnaEngine.initialize(path)
      setDNA(d)
      setInitialized(true)
    } catch (e) { setInitError(String(e)) }
    finally { setInitializing(false) }
  }, [setProject, setFileTree, setDNA, setInitializing, setInitialized, setInitError])

  if (panel === 'settings') return <SettingsPlaceholder />
  if (panel === 'dna') return <DNASummary dna={dna} initializing={isInitializing} />

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-base-500/30">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
          {activeProject?.name ?? 'Explorer'}
        </span>
        <button
          onClick={openFolder}
          className="text-slate-500 hover:text-violet-400 transition-colors p-0.5 rounded"
          title="Open Folder"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {!activeProject ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-base-600/50 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5">
                <path d="M3 7a2 2 0 012-2h3.172a2 2 0 011.414.586l1.828 1.828A2 2 0 0012.828 8H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
              </svg>
            </div>
            <div className="text-xs text-slate-500">No folder open</div>
            <button
              onClick={openFolder}
              className="text-xs text-violet-400 hover:text-violet-300 border border-violet-500/30 hover:border-violet-400/50 rounded-lg px-3 py-1.5 transition-all"
            >
              Open Folder
            </button>
          </div>
        ) : (
          fileTree.map(entry => <FileNode key={entry.path} entry={entry} />)
        )}
      </div>
    </div>
  )
}

function DNASummary({ dna, initializing }: { dna: any; initializing: boolean }) {
  if (initializing) return (
    <div className="p-4 space-y-3">
      <div className="text-[10px] text-violet-400 font-mono uppercase tracking-widest animate-pulse">Analyzing DNA...</div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-2 rounded bg-base-500/50 animate-pulse" style={{ width: `${60 + i * 8}%`, animationDelay: `${i * 100}ms` }} />
      ))}
    </div>
  )
  if (!dna) return (
    <div className="p-4 text-xs text-slate-500 text-center mt-8">Open a project to initialize DNA</div>
  )
  return (
    <div className="p-3 space-y-4 overflow-y-auto text-xs">
      <div>
        <div className="text-[10px] text-violet-400 uppercase tracking-widest font-semibold mb-1.5">Identity</div>
        <div className="text-slate-200 font-medium">{dna.identity.systemName}</div>
        <div className="text-slate-500 mt-0.5 leading-relaxed">{dna.identity.corePurpose}</div>
      </div>
      {dna.systemLaws?.length > 0 && (
        <div>
          <div className="text-[10px] text-violet-400 uppercase tracking-widest font-semibold mb-1.5">System Laws</div>
          {dna.systemLaws.slice(0, 8).map((l: any) => (
            <div key={l.id} className="flex gap-2 mb-1 text-slate-500">
              <span className="text-base-400 flex-shrink-0 font-mono">{String(l.id).padStart(2,'0')}</span>
              <span className="leading-relaxed">{l.rule}</span>
            </div>
          ))}
        </div>
      )}
      {dna.lockedSystems?.length > 0 && (
        <div>
          <div className="text-[10px] text-amber-500 uppercase tracking-widest font-semibold mb-1.5">Locked Systems</div>
          {dna.lockedSystems.map((s: any) => (
            <div key={s.name} className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60 flex-shrink-0" />
              <span className="text-slate-400">{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SettingsPlaceholder() {
  return (
    <div className="p-3 text-xs text-slate-500 text-center mt-8">
      Open Settings via the AI panel
    </div>
  )
}

async function buildTree(dir: string, depth: number): Promise<FileEntry[]> {
  if (depth > 3) return []
  const SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__'])
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
  } catch { return [] }
}
