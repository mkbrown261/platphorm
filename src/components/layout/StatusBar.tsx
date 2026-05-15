import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { useAIStore } from '../../store/aiStore'

export function StatusBar() {
  const { openTabs, activeTabId } = useProjectStore()
  const { dna, isInitializing } = useDNAStore()
  const { isConfigured, settings, activePipeline, pipelineRunning } = useAIStore()

  const activeTab = openTabs.find(t => t.id === activeTabId)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 24, padding: '0 12px',
      background: '#06070d',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      flexShrink: 0, userSelect: 'none',
      fontSize: 10, fontFamily: 'monospace'
    }}>
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', flexShrink: 0, boxShadow: '0 0 6px rgba(167,139,250,0.8)' }} />
          <span style={{ color: '#a78bfa', fontWeight: 700, letterSpacing: 2 }}>PLATPHORM</span>
        </div>

        {isInitializing && (
          <span style={{ color: '#a78bfa', opacity: 0.7 }}>Analyzing project DNA...</span>
        )}
        {dna && !isInitializing && (
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>{dna.identity?.systemName}</span>
        )}
        {pipelineRunning && (
          <span style={{ color: '#a78bfa', opacity: 0.8 }}>▶ Running pipeline...</span>
        )}
        {activePipeline && !pipelineRunning && (
          <span style={{ color: activePipeline.approved ? '#22c55e' : '#f87171' }}>
            {activePipeline.approved ? '✓' : '✗'} {activePipeline.overallScore}/100
          </span>
        )}
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: 'rgba(255,255,255,0.2)' }}>
        {activeTab && (
          <>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>{activeTab.language}</span>
            <span>{activeTab.filePath.split('/').slice(-2).join('/')}</span>
          </>
        )}
        <span style={{ color: isConfigured ? 'rgba(167,139,250,0.6)' : 'rgba(255,255,255,0.15)' }}>
          {isConfigured ? (settings.preferredProvider ?? 'openrouter') : 'no provider'}
        </span>
      </div>
    </div>
  )
}
