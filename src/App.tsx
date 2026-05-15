import { useState, useEffect } from 'react'
import { ActivityBar } from './components/layout/ActivityBar'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { EditorArea } from './components/editor/EditorArea'
import { AIPanel } from './components/ai/AIPanel'
import { useAIStore } from './store/aiStore'
import { orchestrator } from './core/providers/AIOrchestrator'
import { SettingsModal } from './components/settings/SettingsModal'

export default function App() {
  const [sidebarPanel, setSidebarPanel] = useState('files')
  const [showSettings, setShowSettings] = useState(false)
  const { settings, updateSettings, setConfigured } = useAIStore()

  // Auto-configure from env key on launch
  useEffect(() => {
    const key = import.meta.env.VITE_OPENROUTER_API_KEY
    if (key) {
      orchestrator.addProvider({ provider: 'openrouter', apiKey: key })
      updateSettings({ providers: { openrouter: key }, preferredProvider: 'openrouter' })
      setConfigured(true)
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handlePanelChange = (id: string) => {
    if (id === 'settings') { setShowSettings(true); return }
    setSidebarPanel(id)
  }

  return (
    <div className="flex flex-col h-screen bg-base-900 overflow-hidden">
      {/* Title bar drag region */}
      <div
        className="h-8 flex items-center px-4 bg-base-950 border-b border-base-500/30 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* macOS traffic lights space + title */}
        <div className="ml-16 flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span className="text-[11px] font-semibold text-slate-500 tracking-widest uppercase">PLATPHORM</span>
        </div>
      </div>

      {/* Main IDE body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity bar */}
        <ActivityBar active={sidebarPanel} onChange={handlePanelChange} />

        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 bg-base-900 border-r border-base-500/25 overflow-hidden">
          <Sidebar panel={sidebarPanel} />
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-base-800">
          <EditorArea />
        </div>

        {/* AI Panel */}
        <div className="w-80 flex-shrink-0 overflow-hidden">
          <AIPanel />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Settings modal */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
