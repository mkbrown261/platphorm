import { useState, useEffect } from 'react'
import { TopBar } from './components/layout/TopBar'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { MonacoEditor } from './components/editor/MonacoEditor'
import { AIOverlay } from './components/editor/AIOverlay'
import { DNAPanel } from './components/governance/DNAPanel'
import { SecurityPanel } from './components/governance/SecurityPanel'
import { PipelinePanel } from './components/intelligence/PipelinePanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { useProjectStore } from './store/projectStore'
import { useAIStore } from './store/aiStore'
import { orchestrator } from './core/providers/AIOrchestrator'

export default function App() {
  const [sidebarPanel, setSidebarPanel] = useState('files')
  const [showRightPanel, setShowRightPanel] = useState(true)

  const { openTabs, activeTabId } = useProjectStore()
  const { settings, updateSettings, setConfigured } = useAIStore()

  const activeTab = openTabs.find((t) => t.id === activeTabId)

  // Initialize providers from env on mount
  useEffect(() => {
    const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
    if (envKey) {
      orchestrator.addProvider({ provider: 'openrouter', apiKey: envKey })
      updateSettings({ providers: { ...settings.providers, openrouter: envKey }, preferredProvider: 'openrouter' })
      setConfigured(true)
    }
  }, [])

  const rightPanelContent = () => {
    if (sidebarPanel === 'dna') return <DNAPanel />
    if (sidebarPanel === 'security') return <SecurityPanel />
    if (sidebarPanel === 'pipeline') return <PipelinePanel />
    if (sidebarPanel === 'settings') return <SettingsPanel />
    if (sidebarPanel === 'governance') return <DNAPanel />
    return <AIOverlay />
  }

  return (
    <div className="flex flex-col h-screen bg-[#080810] text-slate-200 overflow-hidden">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <div className="w-64 flex-shrink-0 border-r border-[#1a1a2e] overflow-hidden">
          <Sidebar activePanel={sidebarPanel} onPanelChange={setSidebarPanel} />
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeTab ? (
            <MonacoEditor
              tabId={activeTab.id}
              filePath={activeTab.filePath}
              content={activeTab.content}
              language={activeTab.language}
              fontSize={settings.fontSize}
              fontFamily={settings.fontFamily}
            />
          ) : (
            <WelcomeScreen />
          )}
        </div>

        {/* Right panel — AI / Governance */}
        {showRightPanel && (
          <div className="w-80 flex-shrink-0 flex flex-col overflow-hidden">
            {/* Panel switcher */}
            <div className="flex border-b border-[#1a1a2e] bg-[#06060e]">
              {[
                { id: 'ai', label: 'AI' },
                { id: 'pipeline', label: 'Pipeline' },
                { id: 'security', label: 'Security' },
                { id: 'dna', label: 'DNA' }
              ].map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setSidebarPanel(id)}
                  className={`flex-1 py-2 text-xs font-mono transition-colors border-b-2 ${
                    sidebarPanel === id
                      ? 'border-violet-500 text-violet-400'
                      : 'border-transparent text-slate-600 hover:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden">
              {sidebarPanel === 'ai' || !['pipeline', 'security', 'dna'].includes(sidebarPanel)
                ? <AIOverlay />
                : rightPanelContent()
              }
            </div>
          </div>
        )}

        {/* Toggle right panel */}
        <button
          onClick={() => setShowRightPanel((v) => !v)}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-8 bg-[#1a1a2e] hover:bg-violet-900/30 text-slate-600 hover:text-violet-400 text-xs flex items-center justify-center transition-colors rounded-l"
          style={{ zIndex: 10 }}
        >
          {showRightPanel ? '›' : '‹'}
        </button>
      </div>

      <StatusBar />
    </div>
  )
}

function WelcomeScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#080810] font-mono">
      <div className="text-center space-y-4">
        <div className="text-4xl font-bold tracking-[0.3em] text-violet-400 opacity-80">
          PLATPHORM
        </div>
        <div className="text-sm text-slate-600 tracking-[0.2em] uppercase">
          AI-Native Engineering OS
        </div>
        <div className="mt-8 space-y-2 text-xs text-slate-700 max-w-sm">
          <div>Open a project folder to initialize project DNA</div>
          <div>All AI requests pass through 10 governance layers</div>
          <div>No code is trusted until validated</div>
        </div>
        <div className="mt-8 flex gap-3 justify-center">
          <KeyHint keys={['⌘', ',']} label="Settings" />
          <KeyHint keys={['⌘', 'O']} label="Open" />
        </div>
      </div>
    </div>
  )
}

function KeyHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-slate-700">
      <div className="flex gap-0.5">
        {keys.map((k) => (
          <span key={k} className="border border-slate-800 rounded px-1 py-0.5 text-[10px]">
            {k}
          </span>
        ))}
      </div>
      <span>{label}</span>
    </div>
  )
}
