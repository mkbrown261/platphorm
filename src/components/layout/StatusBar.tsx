import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { useAIStore } from '../../store/aiStore'
import { useGovernanceStore } from '../../store/governanceStore'

export function StatusBar() {
  const { openTabs, activeTabId } = useProjectStore()
  const { dna, isInitializing } = useDNAStore()
  const { settings, isConfigured, activePipeline } = useAIStore()
  const { report } = useGovernanceStore()

  const activeTab = openTabs.find((t) => t.id === activeTabId)

  const healthColor =
    report?.overallHealth === 'healthy'
      ? 'text-emerald-500'
      : report?.overallHealth === 'degraded'
        ? 'text-amber-500'
        : 'text-red-500'

  return (
    <div className="flex items-center justify-between px-4 h-6 bg-[#06060e] border-t border-[#1a1a2e] text-[10px] font-mono">
      <div className="flex items-center gap-4 text-slate-600">
        {isInitializing && <span className="text-violet-400 animate-pulse">Analyzing DNA...</span>}
        {dna && !isInitializing && (
          <span className={healthColor}>
            {report?.overallHealth?.toUpperCase() ?? 'HEALTHY'}
          </span>
        )}
        {activePipeline && (
          <span className={activePipeline.approved ? 'text-emerald-500' : 'text-red-500'}>
            SCORE {activePipeline.overallScore}/100
          </span>
        )}
        {report && report.activeViolations > 0 && (
          <span className="text-amber-500">{report.activeViolations} VIOLATIONS</span>
        )}
      </div>

      <div className="flex items-center gap-4 text-slate-600">
        {activeTab && (
          <>
            <span>{activeTab.language}</span>
            <span>{activeTab.filePath.split('/').slice(-2).join('/')}</span>
          </>
        )}
        <span className={isConfigured ? 'text-violet-400' : 'text-slate-700'}>
          {isConfigured ? settings.preferredProvider.toUpperCase() : 'NO PROVIDER'}
        </span>
      </div>
    </div>
  )
}
