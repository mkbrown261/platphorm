import { useState, useEffect, useRef, useCallback } from 'react'

interface DirEntry { name: string; path: string; isDirectory: boolean }

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__'])

interface Props {
  onSelect: (path: string) => void
  onCancel: () => void
}

export function FolderPicker({ onSelect, onCancel }: Props) {
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderError, setNewFolderError] = useState('')
  const newFolderRef = useRef<HTMLInputElement>(null)

  const navigate = useCallback(async (dir: string) => {
    const raw = await window.api.fs.readDir(dir)
    const dirs = raw
      .filter(e => e.isDirectory && !e.name.startsWith('.') && !SKIP.has(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    setCwd(dir)
    setEntries(dirs)
    setSelected(dir)
    setCreatingFolder(false)
    setNewFolderName('')
    setNewFolderError('')
  }, [])

  useEffect(() => {
    window.api.fs.getHome().then(home => navigate(home))
  }, [navigate])

  useEffect(() => {
    if (creatingFolder) newFolderRef.current?.focus()
  }, [creatingFolder])

  const breadcrumbs = cwd.split('/').filter(Boolean)

  const goToBreadcrumb = (idx: number) => {
    const target = '/' + breadcrumbs.slice(0, idx + 1).join('/')
    navigate(target)
  }

  const confirmNewFolder = async () => {
    const name = newFolderName.trim()
    if (!name) { setNewFolderError('Name required'); return }
    if (/[/\\:*?"<>|]/.test(name)) { setNewFolderError('Invalid characters'); return }
    const newPath = cwd + '/' + name
    const result = await window.api.fs.mkdir(newPath)
    if (!result.success) { setNewFolderError(result.error ?? 'Failed'); return }
    await navigate(cwd)
    setSelected(newPath)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onCancel(); return }
    if (e.key === 'Enter' && !creatingFolder) { if (selected) onSelect(selected) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }} onClick={onCancel} />

      {/* Dialog */}
      <div style={{
        position: 'relative', width: 680, height: 480,
        background: '#111218',
        border: '1px solid rgba(124,58,237,0.25)',
        borderRadius: 14,
        boxShadow: '0 0 80px rgba(124,58,237,0.12), 0 40px 80px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }}>

        {/* Header */}
        <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Open Folder</span>
            <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: 4, borderRadius: 6, display: 'flex' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.25)'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 11, padding: '2px 4px', borderRadius: 4, flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}>
              /
            </button>
            {breadcrumbs.map((seg, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10 }}>›</span>
                <button
                  onClick={() => goToBreadcrumb(i)}
                  style={{ background: i === breadcrumbs.length - 1 ? 'rgba(124,58,237,0.12)' : 'none', border: 'none', cursor: 'pointer', color: i === breadcrumbs.length - 1 ? '#a78bfa' : 'rgba(255,255,255,0.35)', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
                  onMouseEnter={e => { if (i < breadcrumbs.length - 1) (e.currentTarget as HTMLElement).style.color = '#a78bfa' }}
                  onMouseLeave={e => { if (i < breadcrumbs.length - 1) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)' }}
                >
                  {seg}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* File list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {/* New folder input row */}
          {creatingFolder && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', marginBottom: 4, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              <input
                ref={newFolderRef}
                value={newFolderName}
                onChange={e => { setNewFolderName(e.target.value); setNewFolderError('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.stopPropagation(); confirmNewFolder() }
                  if (e.key === 'Escape') { e.stopPropagation(); setCreatingFolder(false); setNewFolderName(''); setNewFolderError('') }
                }}
                placeholder="Folder name"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace' }}
              />
              {newFolderError && <span style={{ fontSize: 10, color: '#f87171' }}>{newFolderError}</span>}
              <button onClick={confirmNewFolder} style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', border: 'none', cursor: 'pointer', color: 'white', fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 600 }}>Create</button>
              <button onClick={() => { setCreatingFolder(false); setNewFolderName(''); setNewFolderError('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 11, padding: '3px 6px', borderRadius: 6 }}>✕</button>
            </div>
          )}

          {entries.length === 0 && !creatingFolder && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120, color: 'rgba(255,255,255,0.15)', fontSize: 12 }}>
              Empty folder
            </div>
          )}

          {entries.map(entry => {
            const isSel = selected === entry.path
            return (
              <button
                key={entry.path}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => navigate(entry.path)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: isSel ? 'rgba(124,58,237,0.15)' : 'transparent',
                  textAlign: 'left', transition: 'background 0.1s', marginBottom: 2
                }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={isSel ? 'rgba(124,58,237,0.6)' : 'rgba(255,255,255,0.12)'} stroke={isSel ? '#a78bfa' : 'rgba(255,255,255,0.3)'} strokeWidth="1.5" style={{ flexShrink: 0 }}>
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <span style={{ fontSize: 13, color: isSel ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.name}
                </span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          background: '#0d0e1a', flexShrink: 0
        }}>
          {/* New Folder button */}
          <button
            onClick={() => { setCreatingFolder(true); setNewFolderName('New Folder') }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, cursor: 'pointer', padding: '7px 14px',
              fontSize: 12, color: 'rgba(255,255,255,0.45)', transition: 'all 0.15s'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.35)'; (e.currentTarget as HTMLElement).style.color = '#a78bfa' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Folder
          </button>

          {/* Current path preview */}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220, margin: '0 12px' }}>
            {selected ?? cwd}
          </span>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={onCancel}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: 'pointer', padding: '7px 16px', fontSize: 12, color: 'rgba(255,255,255,0.45)', transition: 'all 0.1s' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.45)'}
            >
              Cancel
            </button>
            <button
              onClick={() => selected && onSelect(selected)}
              disabled={!selected}
              style={{ background: selected ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, cursor: selected ? 'pointer' : 'default', padding: '7px 20px', fontSize: 12, color: selected ? 'white' : 'rgba(255,255,255,0.2)', fontWeight: 600, transition: 'all 0.15s', boxShadow: selected ? '0 0 20px rgba(124,58,237,0.3)' : 'none' }}
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
