import { useProjectStore } from '../../store/projectStore'
import { useDNAStore } from '../../store/dnaStore'
import { useAIStore } from '../../store/aiStore'
import type { PipelineResult } from '../../types'

// ─── Health computation ───────────────────────────────────────────────────────

/**
 * FIX 12: Derive an overall project health score from the N most recent pipeline
 * results. Uses an exponentially-weighted average so recent runs carry more
 * weight, and caps the look-back window at 10 runs to keep it meaningful.
 *
 * Returns null when there are no runs yet (no score to show).
 */
function computeOverallHealth(history: PipelineResult[]): {
  score: number
  trend: 'up' | 'down' | 'flat'
  label: string
  color: string
} | null {
  if (history.length === 0) return null

  const WINDOW = Math.min(history.length, 10)
  const recent = history.slice(-WINDOW)

  // Exponential weights: newer runs get higher weight
  const weights = recent.map((_, i) => Math.pow(1.5, i))
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const weighted = recent.reduce((sum, r, i) => sum + r.overallScore * weights[i], 0)
  const score = Math.round(weighted / totalWeight)

  // Trend: compare latest against previous (if we have at least 2)
  let trend: 'up' | 'down' | 'flat' = 'flat'
  if (history.length >= 2) {
    const delta = history[history.length - 1].overallScore - history[history.length - 2].overallScore
    if (delta > 2) trend = 'up'
    else if (delta < -2) trend = 'down'
  }

  const label = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 60 ? 'Fair' : 'Needs attention'
  const color = score >= 90 ? '#22c55e' : score >= 75 ? '#86efac' : score >= 60 ? '#f59e0b' : '#ef4444'

  return { score, trend, label, color }
}

const TREND_ICON: Record<'up' | 'down' | 'flat', string> = { up: '↑', down: '↓', flat: '→' }

// ─── Component ────────────────────────────────────────────────────────────────

export function StatusBar() {
  const { openTabs, activeTabId } = useProjectStore()
  const { dna, isInitializing } = useDNAStore()
  const { isConfigured, settings, activePipeline, pipelineRunning, pipelineHistory } = useAIStore()

  const activeTab = openTabs.find(t => t.id === activeTabId)
  const health = computeOverallHealth(pipelineHistory)

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

        {/* FIX 12: Overall health indicator derived from pipeline history */}
        {health && !pipelineRunning && (
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            title={`Project health: ${health.label} (${pipelineHistory.length} run${pipelineHistory.length !== 1 ? 's' : ''})`}
          >
            <span style={{ color: TREND_ICON[health.trend] === '↑' ? '#22c55e' : TREND_ICON[health.trend] === '↓' ? '#f87171' : 'rgba(255,255,255,0.2)' }}>
              {TREND_ICON[health.trend]}
            </span>
            <span style={{ color: health.color }}>{health.score}</span>
            <span style={{ color: 'rgba(255,255,255,0.12)' }}>health</span>
          </div>
        )}

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
