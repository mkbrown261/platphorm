import { useCallback, useState } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { MonacoEditor } from './MonacoEditor'
import { PreviewPanel } from '../preview/PreviewPanel'
import type { PreviewContent } from '../preview/PreviewPanel'

const EXT_COLOR: Record<string, string> = {
  ts:'#3b82f6', tsx:'#3b82f6', js:'#eab308', jsx:'#60a5fa',
  css:'#a855f7', json:'#f59e0b', md:'#64748b', py:'#22c55e',
  html:'#f97316', htm:'#f97316',
}

// Extensions that can be previewed inline
const PREVIEWABLE_EXTS = new Set(['html', 'htm', 'md', 'css', 'js', 'jsx', 'ts', 'tsx'])
const SPLIT_PREVIEW_EXTS = new Set(['html', 'htm', 'md', 'css'])

// Preview eye icon SVG
const EyeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

// Popout icon
const PopoutIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
)

export function EditorArea() {
  const { openTabs, activeTabId, closeTab, setActiveTab, markTabClean } = useProjectStore()
  const { settings } = useAIStore()
  const activeTab = openTabs.find(t => t.id === activeTabId)
  const [showPreview, setShowPreview] = useState(false)
  const [popoutLoading, setPopoutLoading] = useState(false)

  const handleSave = useCallback(async () => {
    if (!activeTab) return
    await window.api.fs.writeFile(activeTab.filePath, activeTab.content)
    markTabClean(activeTab.id)
  }, [activeTab, markTabClean])

  // Determine if active tab is previewable
  const activeExt = activeTab?.filePath.split('.').pop()?.toLowerCase() ?? ''
  const canSplitPreview = SPLIT_PREVIEW_EXTS.has(activeExt)
  const canPopoutPreview = PREVIEWABLE_EXTS.has(activeExt)

  // Build preview content from the active tab
  const buildPreviewContent = useCallback((): PreviewContent => {
    if (!activeTab) return {}
    const ext = activeExt
    if (ext === 'html' || ext === 'htm') {
      return {
        raw: activeTab.content,
        title: activeTab.filePath.split('/').pop(),
      }
    }
    if (ext === 'md') {
      return {
        raw: activeTab.content,
        language: 'markdown',
        title: activeTab.filePath.split('/').pop(),
      }
    }
    if (ext === 'css') {
      return {
        css: activeTab.content,
        html: `<div style="padding:20px;font-family:monospace;font-size:12px;color:#555">
          <p>CSS Preview — add HTML to see styled output.</p>
          <div class="preview-sample">Sample element</div>
        </div>`,
        title: activeTab.filePath.split('/').pop(),
      }
    }
    // Code preview with syntax highlighting
    return {
      raw: activeTab.content,
      language: ext,
      title: activeTab.filePath.split('/').pop(),
    }
  }, [activeTab, activeExt])

  // Popout: open in separate Electron window
  const handlePopout = useCallback(async () => {
    if (!activeTab) return
    setPopoutLoading(true)
    try {
      const content = buildPreviewContent()
      let doc: string
      if (content.raw && (content.raw.trimStart().startsWith('<!DOCTYPE') || content.raw.trimStart().startsWith('<html'))) {
        doc = content.raw
      } else if (content.language === 'markdown') {
        // Use the file path to let the preview system build it
        doc = activeTab.content
      } else {
        doc = activeTab.content
      }
      await (window as any).api?.preview?.open(doc, content.title ?? 'Preview')
    } catch (e) {
      console.error('Popout failed:', e)
    }
    setPopoutLoading(false)
  }, [activeTab, buildPreviewContent])

  if (openTabs.length === 0) return <Welcome />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0b0c14' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', height: 38,
        background: '#08090f', borderBottom: '1px solid rgba(255,255,255,0.07)',
        overflowX: 'auto', flexShrink: 0
      }}>
        {openTabs.map(tab => {
          const name = tab.filePath.split('/').pop() ?? tab.filePath
          const ext = name.split('.').pop() ?? ''
          const active = tab.id === activeTabId
          const dotColor = EXT_COLOR[ext] ?? 'rgba(255,255,255,0.3)'
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 6,
                padding: '0 14px', height: '100%', cursor: 'pointer', flexShrink: 0,
                background: active ? '#0b0c14' : 'transparent',
                borderRight: '1px solid rgba(255,255,255,0.05)',
                userSelect: 'none', transition: 'background 0.1s'
              }}
            >
              {/* Active top indicator */}
              {active && <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(to right, #7c3aed, #a78bfa)' }} />}
              {/* File type dot */}
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0, opacity: 0.8 }} />
              <span style={{ fontSize: 12, fontFamily: 'monospace', color: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
                {name}
              </span>
              {tab.isDirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />}
              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'rgba(255,255,255,0.2)', fontSize: 14, lineHeight: 1, borderRadius: 3, transition: 'all 0.1s', marginLeft: 2 }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.2)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >×</button>
            </div>
          )
        })}

        {/* Preview controls — only show for previewable active file */}
        {activeTab && canPopoutPreview && (
          <div style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
            padding: '0 10px', flexShrink: 0
          }}>
            {/* Split preview toggle (HTML/MD/CSS only) */}
            {canSplitPreview && (
              <button
                onClick={() => setShowPreview(v => !v)}
                title={showPreview ? 'Close preview' : 'Open preview panel'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', height: 24,
                  fontSize: 10, fontFamily: 'monospace',
                  color: showPreview ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                  background: showPreview ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${showPreview ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 5, cursor: 'pointer', transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (!showPreview) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
                onMouseLeave={e => { if (!showPreview) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
              >
                <EyeIcon />
                {showPreview ? 'Hide Preview' : 'Preview'}
              </button>
            )}

            {/* Popout button */}
            <button
              onClick={handlePopout}
              disabled={popoutLoading}
              title="Open preview in new window"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', height: 24,
                fontSize: 10, fontFamily: 'monospace',
                color: 'rgba(255,255,255,0.4)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 5, cursor: popoutLoading ? 'wait' : 'pointer',
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'}
            >
              {popoutLoading
                ? <div style={{ width: 8, height: 8, border: '1.5px solid rgba(255,255,255,0.2)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                : <PopoutIcon />
              }
              Pop out
            </button>
          </div>
        )}
      </div>

      {/* Editor + Preview split */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}
        onKeyDown={e => { if ((e.metaKey||e.ctrlKey) && e.key==='s') { e.preventDefault(); handleSave() } }}
      >
        {/* Monaco Editor */}
        <div style={{ flex: showPreview ? '0 0 50%' : '1 1 100%', overflow: 'hidden', transition: 'flex 0.2s ease' }}>
          {activeTab && (
            <MonacoEditor
              key={activeTab.id}
              tabId={activeTab.id}
              filePath={activeTab.filePath}
              content={activeTab.content}
              language={activeTab.language}
              fontSize={settings.fontSize}
              fontFamily={settings.fontFamily}
            />
          )}
        </div>

        {/* Preview Panel — shown when split preview is active */}
        {showPreview && canSplitPreview && activeTab && (
          <div style={{
            flex: '0 0 50%', overflow: 'hidden',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', flexDirection: 'column'
          }}>
            <PreviewPanel
              key={activeTab.id + activeTab.content.length}
              content={buildPreviewContent()}
              onClose={() => setShowPreview(false)}
              embedded={true}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function Welcome() {
  const { activeProject } = useProjectStore()
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: '#0b0c14', position: 'relative', overflow: 'hidden'
    }}>
      {/* Background glow */}
      <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: 500, height: 300, background: 'radial-gradient(ellipse, rgba(124,58,237,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* Grid overlay */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(124,58,237,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.04) 1px, transparent 1px)', backgroundSize: '48px 48px', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {/* Logo */}
        <div style={{ position: 'relative', marginBottom: 28 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(79,70,229,0.2))',
            border: '1px solid rgba(124,58,237,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 40px rgba(124,58,237,0.2), 0 0 80px rgba(124,58,237,0.1)'
          }}>
            <span style={{ fontSize: 32, fontWeight: 800, background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>P</span>
          </div>
          {activeProject && (
            <div style={{ position: 'absolute', bottom: -4, right: -4, width: 20, height: 20, borderRadius: '50%', background: '#22c55e', border: '2px solid #0b0c14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 10, color: 'white', fontWeight: 700 }}>✓</span>
            </div>
          )}
        </div>

        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 6, textTransform: 'uppercase', background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 8 }}>
          PLATPHORM
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', letterSpacing: 1, marginBottom: 40 }}>
          AI-Native Engineering OS
        </div>

        {/* Hints */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 40 }}>
          {[['⌘O','Open project'],['⌘,','Settings'],['⌘K','Command palette'],['⌘↵','Send to AI']].map(([k,l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <kbd style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '2px 8px', fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{k}</kbd>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{l}</span>
            </div>
          ))}
        </div>

        {/* Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 99, padding: '6px 16px' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            {activeProject ? `${activeProject.name} · DNA ready` : 'Open a project to begin'}
          </span>
        </div>
      </div>
    </div>
  )
}
