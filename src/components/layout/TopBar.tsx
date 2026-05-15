import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { useAIStore } from '../../store/aiStore'

export function TopBar() {
  const { activeProject, openTabs, activeTabId, closeTab, setActiveTab } = useProjectStore()
  const { isInitialized, dna } = useDNAStore()
  const { pipelineRunning } = useAIStore()

  return (
    <div className="flex flex-col border-b border-[#1a1a2e] bg-[#06060e]">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 h-10" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <span className="text-xs font-mono font-bold text-violet-400 tracking-[0.2em] uppercase">
            PLATPHORM
          </span>
          {activeProject && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-500 font-mono">{activeProject.name}</span>
            </>
          )}
          {isInitialized && dna && (
            <span className="text-xs text-emerald-500/60 font-mono">DNA ✓</span>
          )}
          {pipelineRunning && (
            <span className="text-xs text-violet-400 font-mono animate-pulse">PIPELINE RUNNING</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      {openTabs.length > 0 && (
        <div className="flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex items-center gap-2 px-4 py-2 border-r border-[#1a1a2e] cursor-pointer text-xs font-mono whitespace-nowrap transition-colors ${
                tab.id === activeTabId
                  ? 'bg-[#080810] text-slate-200 border-b border-b-violet-500'
                  : 'text-slate-600 hover:text-slate-400 hover:bg-[#0a0a14]'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.filePath.split('/').pop()}</span>
              {tab.isDirty && <span className="text-amber-400">●</span>}
              <button
                className="opacity-0 group-hover:opacity-100 hover:text-slate-300 ml-1"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
