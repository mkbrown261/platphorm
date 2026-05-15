import { useAIStore } from '../../store/aiStore'
import type { Finding } from '../../types'

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 border-red-900/50 bg-red-900/10',
  high: 'text-orange-400 border-orange-900/50 bg-orange-900/10',
  medium: 'text-amber-400 border-amber-900/50 bg-amber-900/10',
  low: 'text-blue-400 border-blue-900/50 bg-blue-900/10',
  info: 'text-slate-400 border-slate-800 bg-slate-900/10'
}

export function SecurityPanel() {
  const { activePipeline } = useAIStore()

  if (!activePipeline) {
    return (
      <div className="p-4 font-mono text-center">
        <div className="text-slate-600 text-xs">
          No pipeline results yet.
          <br />
          Run the 10-layer pipeline to see security analysis.
        </div>
      </div>
    )
  }

  const secLayer = activePipeline.layers.find((l) => l.layer === 'security')
  const allFindings = activePipeline.layers.flatMap((l) => l.findings)
  const secFindings = allFindings.filter((f) => f.layer === 'security')

  const bySeverity = (sev: string) => secFindings.filter((f) => f.severity === sev)
  const critical = bySeverity('critical')
  const high = bySeverity('high')
  const medium = bySeverity('medium')
  const low = bySeverity('low')

  return (
    <div className="p-3 font-mono text-xs space-y-4 overflow-y-auto">
      {/* Score */}
      <div className="flex items-center justify-between border border-[#1a1a2e] rounded p-3">
        <div>
          <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">
            Security Score
          </div>
          <div
            className={`text-2xl font-bold ${
              (secLayer?.score ?? 0) >= 80
                ? 'text-emerald-400'
                : (secLayer?.score ?? 0) >= 60
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {secLayer?.score ?? 0}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">Status</div>
          <div
            className={`text-sm font-mono ${
              secLayer?.status === 'passed'
                ? 'text-emerald-400'
                : secLayer?.status === 'failed'
                  ? 'text-red-400'
                  : 'text-amber-400'
            }`}
          >
            {secLayer?.status?.toUpperCase() ?? 'N/A'}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Critical', count: critical.length, color: 'text-red-400' },
          { label: 'High', count: high.length, color: 'text-orange-400' },
          { label: 'Medium', count: medium.length, color: 'text-amber-400' },
          { label: 'Low', count: low.length, color: 'text-blue-400' }
        ].map(({ label, count, color }) => (
          <div key={label} className="border border-[#1a1a2e] rounded p-2 text-center">
            <div className={`text-lg font-bold ${color}`}>{count}</div>
            <div className="text-[9px] text-slate-600">{label}</div>
          </div>
        ))}
      </div>

      {/* Findings */}
      {secFindings.length === 0 ? (
        <div className="text-emerald-500/60 text-center py-4">
          No security issues detected
        </div>
      ) : (
        <div className="space-y-2">
          {secFindings.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  )
}

function FindingCard({ finding }: { finding: Finding }) {
  const colors = SEVERITY_COLORS[finding.severity] ?? SEVERITY_COLORS.info

  return (
    <div className={`border rounded p-2 ${colors}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase tracking-widest opacity-70">
          {finding.severity}
        </span>
        <span className="text-[9px] text-slate-600">{finding.category}</span>
      </div>
      <div className="text-slate-300 leading-relaxed">{finding.message}</div>
      {finding.location && (
        <div className="text-slate-600 mt-1">@ {finding.location}</div>
      )}
      {finding.suggestedFix && (
        <div className="mt-2 text-slate-500 border-t border-current/20 pt-1">
          Fix: {finding.suggestedFix}
        </div>
      )}
    </div>
  )
}
