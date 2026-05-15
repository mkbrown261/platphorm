import { useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { useAIStore } from '../../store/aiStore'
import { MonacoEditor } from './MonacoEditor'

export function EditorArea() {
  const { openTabs, activeTabId, closeTab, setActiveTab, updateTabContent, markTabClean } = useProjectStore()
  const { settings } = useAIStore()
  const activeTab = openTabs.find(t => t.id === activeTabId)

  const handleSave = useCallback(async () => {
    if (!activeTab) return
    await window.api.fs.writeFile(activeTab.filePath, activeTab.content)
    markTabClean(activeTab.id)
  }, [activeTab, markTabClean])

  if (openTabs.length === 0) return <WelcomeView />

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-end h-9 bg-base-800 border-b border-base-500/30 overflow-x-auto flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
        {openTabs.map(tab => {
          const fileName = tab.filePath.split('/').pop() ?? tab.filePath
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                relative flex items-center gap-2 px-4 h-full cursor-pointer select-none
                border-r border-base-500/20 flex-shrink-0 group transition-colors text-xs
                ${isActive
                  ? 'bg-base-900 text-slate-200'
                  : 'bg-base-800 text-slate-500 hover:text-slate-300 hover:bg-base-700/50'
                }
              `}
            >
              {isActive && <span className="absolute top-0 left-0 right-0 h-px bg-violet-500" />}
              <span className="font-mono">{fileName}</span>
              {tab.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70" />}
              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                className="opacity-0 group-hover:opacity-100 hover:text-slate-100 text-slate-500 ml-0.5 transition-opacity leading-none"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M9.5 3.5L6 7 2.5 3.5 3.5 2.5 6 6 8.5 2.5 9.5 3.5zM2.5 8.5L6 5l3.5 3.5-1 1L6 6 3.5 9.5l-1-1z"/>
                </svg>
              </button>
            </div>
          )
        })}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave() } }}>
        {activeTab ? (
          <MonacoEditor
            key={activeTab.id}
            tabId={activeTab.id}
            filePath={activeTab.filePath}
            content={activeTab.content}
            language={activeTab.language}
            fontSize={settings.fontSize}
            fontFamily={settings.fontFamily}
          />
        ) : (
          <WelcomeView />
        )}
      </div>
    </div>
  )
}

function WelcomeView() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-base-900 select-none">
      <div className="text-center space-y-6 panel-enter">
        {/* Logo mark */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-violet-900/20 border border-violet-500/20 flex items-center justify-center">
              <span className="text-2xl font-bold text-violet-400 tracking-tight">P</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-base-900 flex items-center justify-center">
              <span className="text-[8px] text-white font-bold">✓</span>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xl font-semibold text-slate-200 tracking-tight">PLATPHORM</div>
          <div className="text-sm text-slate-500">AI-Native Engineering OS</div>
        </div>

        <div className="grid grid-cols-2 gap-2 max-w-xs text-xs">
          {[
            { key: '⌘O', action: 'Open folder' },
            { key: '⌘K', action: 'Command palette' },
            { key: '⌘⇧P', action: 'AI builder' },
            { key: '⌘,', action: 'Settings' }
          ].map(({ key, action }) => (
            <div key={action} className="flex items-center gap-2 text-slate-600">
              <kbd className="bg-base-600/60 border border-base-400/30 rounded px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{key}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>

        <div className="text-[11px] text-slate-700 max-w-xs leading-relaxed">
          Open a project to initialize DNA analysis. Every AI request follows governance protocol automatically.
        </div>
      </div>
    </div>
  )
}
