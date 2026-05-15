import { useState, useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { dnaEngine } from '../../core/dna/DNAEngine'
import { FolderPicker } from './FolderPicker'
import type { FileEntry } from '../../types'

const EXT_COLOR: Record<string, string> = {
  ts:'#3b82f6', tsx:'#3b82f6', js:'#eab308', jsx:'#60a5fa',
  css:'#a855f7', json:'#f59e0b', md:'#64748b', py:'#22c55e',
  go:'#06b6d4', rs:'#f97316', html:'#ef4444', sh:'#84cc16',
  yaml:'#f43f5e', yml:'#f43f5e', env:'#6366f1', svg:'#ec4899'
}
const EXT_LABEL: Record<string, string> = {
  ts:'TS', tsx:'TSX', js:'JS', jsx:'JSX', css:'CSS', json:'{}',
  md:'MD', py:'PY', go:'GO', rs:'RS', html:'HTML', sh:'SH',
  yaml:'YML', yml:'YML', env:'ENV', svg:'SVG'
}
const LANG: Record<string, string> = {
  ts:'typescript', tsx:'typescript', js:'javascript', jsx:'javascript',
  py:'python', rs:'rust', go:'go', css:'css', json:'json',
  md:'markdown', html:'html', sh:'shell', yaml:'yaml', yml:'yaml'
}
const SKIP = new Set(['node_modules','.git','dist','out','.next','__pycache__','.DS_Store'])

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop() ?? ''
  const color = EXT_COLOR[ext] ?? 'rgba(255,255,255,0.2)'
  const label = EXT_LABEL[ext]
  if (!label) return <span style={{ width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.15)', fontSize: 14 }}>·</span>
  return (
    <span style={{
      width: 26, fontSize: 9, fontWeight: 700, fontFamily: 'monospace',
      color, letterSpacing: 0, flexShrink: 0,
      display: 'flex', alignItems: 'center'
    }}>
      {label}
    </span>
  )
}

function FileNode({ entry, depth = 0 }: { entry: FileEntry; depth?: number }) {
  const [open, setOpen] = useState(depth < 1)
  const openFile = useProjectStore(s => s.openFile)

  const click = useCallback(async () => {
    if (entry.isDirectory) { setOpen(v => !v); return }
    const content = await window.api.fs.readFile(entry.path)
    const ext = entry.name.split('.').pop() ?? ''
    openFile(entry.path, content ?? '', LANG[ext] ?? 'plaintext')
  }, [entry, openFile])

  return (
    <div>
      <button
        onClick={click}
        title={entry.name}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 4,
          paddingTop: 3, paddingBottom: 3, paddingRight: 8,
          paddingLeft: 8 + depth * 12,
          background: 'transparent', border: 'none', cursor: 'pointer',
          borderRadius: 4, transition: 'background 0.1s',
          textAlign: 'left'
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        {entry.isDirectory ? (
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, color: 'rgba(255,255,255,0.25)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.12s' }}>
            <path d="M3 2l4 3-4 3V2z" fill="currentColor"/>
          </svg>
        ) : (
          <FileIcon name={entry.name} />
        )}
        <span style={{
          fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: entry.isDirectory ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.5)',
          fontWeight: entry.isDirectory ? 500 : 400
        }}>
          {entry.name}
        </span>
      </button>
      {entry.isDirectory && open && entry.children?.map(c => <FileNode key={c.path} entry={c} depth={depth + 1} />)}
    </div>
  )
}

export function Sidebar({ panel }: { panel: string }) {
  const { activeProject, fileTree, setProject, setFileTree } = useProjectStore()
  const { setDNA, setInitializing, setInitialized, setInitError, dna, isInitializing } = useDNAStore()
  const [showPicker, setShowPicker] = useState(false)

  const openProject = useCallback(async (path: string) => {
    setShowPicker(false)
    setProject({ id: `p-${Date.now()}`, name: path.split('/').pop() ?? 'Project', rootPath: path, createdAt: Date.now(), lastOpenedAt: Date.now(), hasDNA: false })
    const tree = await buildTree(path)
    setFileTree(tree)
    setInitializing(true)
    try { const d = await dnaEngine.initialize(path); setDNA(d); setInitialized(true) }
    catch (e) { setInitError(String(e)) }
    finally { setInitializing(false) }
  }, [setProject, setFileTree, setDNA, setInitializing, setInitialized, setInitError])

  const openFolder = useCallback(() => setShowPicker(true), [])

  if (panel === 'dna') return <DNAView dna={dna} loading={isInitializing} />

  return (
    <div style={{ width: 220, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {showPicker && <FolderPicker onSelect={openProject} onCancel={() => setShowPicker(false)} />}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: 2 }}>
          {activeProject?.name ?? 'Explorer'}
        </span>
        <button onClick={openFolder} title="Open folder" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: 2, borderRadius: 4, display: 'flex' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.25)'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 4, paddingBottom: 4 }}>
        {!activeProject ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80%', gap: 12, padding: 20, textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="1.5"><path d="M3 7a2 2 0 012-2h3.17a2 2 0 011.42.59l1.82 1.82A2 2 0 0012.83 8H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
            </div>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>No folder open</span>
            <button onClick={openFolder} style={{
              fontSize: 11, color: '#a78bfa', background: 'rgba(124,58,237,0.1)',
              border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', transition: 'all 0.15s'
            }}>Open Folder</button>
          </div>
        ) : (
          fileTree.map(e => <FileNode key={e.path} entry={e} />)
        )}
      </div>
    </div>
  )
}

function DNAView({ dna, loading }: { dna: any; loading: boolean }) {
  if (loading) return (
    <div style={{ width: 220, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', padding: 16 }}>
      <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16, fontWeight: 600 }}>Analyzing DNA</div>
      {[80,65,90,55,75].map((w, i) => (
        <div key={i} style={{ height: 8, background: 'rgba(124,58,237,0.15)', borderRadius: 4, marginBottom: 8, width: `${w}%`, opacity: 0.7 }} />
      ))}
    </div>
  )
  if (!dna) return (
    <div style={{ width: 220, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>Open a project</span>
    </div>
  )
  return (
    <div style={{ width: 220, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto', padding: 12 }}>
      <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>DNA</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>{dna.identity.systemName}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, marginBottom: 16 }}>{dna.identity.corePurpose}</div>
      {dna.systemLaws?.slice(0,6).map((l: any) => (
        <div key={l.id} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: 'rgba(124,58,237,0.6)', fontFamily: 'monospace', flexShrink: 0 }}>{String(l.id).padStart(2,'0')}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>{l.rule}</span>
        </div>
      ))}
    </div>
  )
}

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
    return result.sort((a, b) => { if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1; return a.name.localeCompare(b.name) })
  } catch { return [] }
}
