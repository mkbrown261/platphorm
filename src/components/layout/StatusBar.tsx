import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { useAIStore } from '../../store/aiStore'

export function StatusBar() {
  const { openTabs, activeTabId } = useProjectStore()
  const { dna, isInitializing } = useDNAStore()
  const { isConfigured, settings, activePipeline, pipelineRunning } = useAIStore()

  const activeTab = openTabs.find(t => t.id === activeTabId)

  return (
    <div className="flex items-center justify-between h-6 px-3 bg-base-950 border-t border-base-500/30 text-[10px] font-mono flex-shrink-0 select-none">
      {/* Left */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          <span className="text-violet-400 font-semibold tracking-wider">PLATPHORM</span>
        </div>
        {isInitializing && <span className="text-violet-400 animate-pulse">Analyzing project...</span>}
        {dna && !isInitializing && (
          <span className="text-slate-600">{dna.identity.systemName}</span>
        )}
        {pipelineRunning && (
          <span className="text-violet-400 animate-pulse">Running governance pipeline...</span>
        )}
        {activePipeline && !pipelineRunning && (
          <span className={activePipeline.approved ? 'text-emerald-500' : 'text-red-400'}>
            {activePipeline.approved ? '✓' : '✗'} {activePipeline.overallScore}/100
          </span>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-4 text-slate-600">
        {activeTab && (
          <>
            <span>{activeTab.language}</span>
            <span className="text-slate-700">
              {activeTab.filePath.split('/').slice(-2).join('/')}
            </span>
          </>
        )}
        <span className={isConfigured ? 'text-violet-400/70' : 'text-slate-700'}>
          {isConfigured ? settings.preferredProvider : 'no provider'}
        </span>
      </div>
    </div>
  )
}
