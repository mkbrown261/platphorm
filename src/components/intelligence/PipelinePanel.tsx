import { useAIStore } from '../../store/aiStore'
import type { LayerResult } from '../../types'

const LAYER_LABELS: Record<string, string> = {
  intent: 'Intent Analysis',
  architecture: 'Architecture',
  security: 'Security',
  dependency: 'Dependency',
  performance: 'Performance',
  continuity: 'Continuity',
  validation: 'Validation',
  execution: 'Execution',
  observability: 'Observability',
  selfCritique: 'Self-Critique'
}

const STATUS_COLORS: Record<string, string> = {
  passed: 'text-emerald-400 bg-emerald-900/20 border-emerald-800',
  failed: 'text-red-400 bg-red-900/20 border-red-800',
  warned: 'text-amber-400 bg-amber-900/20 border-amber-800',
  skipped: 'text-slate-500 bg-slate-900/20 border-slate-800',
  running: 'text-violet-400 bg-violet-900/20 border-violet-800 animate-pulse',
  idle: 'text-slate-700 bg-slate-900/10 border-slate-900'
}

function LayerCard({ layer, isActive }: { layer: LayerResult; isActive?: boolean }) {
  const colors = STATUS_COLORS[isActive ? 'running' : layer.status] ?? STATUS_COLORS.idle
  const findings = layer.findings ?? []
  const criticals = findings.filter((f) => f.severity === 'critical').length
  const highs = findings.filter((f) => f.severity === 'high').length

  return (
    <div className={`border rounded p-2 font-mono text-xs ${colors}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold">{LAYER_LABELS[layer.layer] ?? layer.layer}</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] opacity-70 uppercase">{layer.status}</span>
          <span className="text-slate-500">{layer.score}/100</span>
        </div>
      </div>
      {(criticals > 0 || highs > 0) && (
        <div className="flex gap-2 text-[9px]">
          {criticals > 0 && <span className="text-red-400">{criticals} critical</span>}
          {highs > 0 && <span className="text-orange-400">{highs} high</span>}
        </div>
      )}
      <div className="mt-1 h-0.5 bg-black/30 rounded">
        <div
          className="h-full rounded bg-current transition-all duration-500"
          style={{ width: `${layer.score}%`, opacity: 0.4 }}
        />
      </div>
    </div>
  )
}

export function PipelinePanel() {
  const { activePipeline, pipelineRunning, layerProgress, pipelineHistory } = useAIStore()

  if (!activePipeline && !pipelineRunning) {
    return (
      <div className="p-4 font-mono">
        <div className="text-xs text-slate-600 text-center mb-6">
          Enable Pipeline Mode in the Intelligence panel, then describe what to build.
        </div>
        {pipelineHistory.length > 0 && (
          <div>
            <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-2">
              Recent Pipelines
            </div>
            {pipelineHistory.slice(-5).reverse().map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border border-[#1a1a2e] rounded px-3 py-2 mb-1"
              >
                <span className={`text-xs ${p.approved ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p.approved ? '✓' : '✗'} Score {p.overallScore}
                </span>
                <span className="text-[9px] text-slate-600">
                  {new Date(p.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const pipeline = activePipeline
  const layers = pipeline?.layers ?? []

  return (
    <div className="p-3 font-mono text-xs space-y-3 overflow-y-auto">
      {/* Overall */}
      {pipeline && (
        <div className={`border rounded p-3 ${pipeline.approved ? 'border-emerald-800 bg-emerald-900/10' : 'border-red-800 bg-red-900/10'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">
                Pipeline Result
              </div>
              <div className={`text-xl font-bold ${pipeline.approved ? 'text-emerald-400' : 'text-red-400'}`}>
                {pipeline.approved ? 'APPROVED' : 'BLOCKED'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-600 uppercase tracking-widest mb-1">Score</div>
              <div className="text-2xl font-bold text-slate-300">{pipeline.overallScore}</div>
            </div>
          </div>
          {pipeline.blockers.length > 0 && (
            <div className="mt-2 space-y-1">
              {pipeline.blockers.map((b) => (
                <div key={b.id} className="text-red-400 text-[10px]">
                  ✗ {b.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Layer cards */}
      <div className="space-y-1.5">
        {pipelineRunning && layers.length < 10
          ? Array.from({ length: 10 }).map((_, i) => {
              const existing = layers[i]
              const isActive = i === (layerProgress?.index ?? -1)
              const layerKey = Object.keys(LAYER_LABELS)[i]

              if (existing) {
                return <LayerCard key={existing.layer} layer={existing} />
              }

              return (
                <div
                  key={i}
                  className={`border rounded p-2 ${isActive ? STATUS_COLORS.running : STATUS_COLORS.idle}`}
                >
                  <div className="flex items-center justify-between">
                    <span>{LAYER_LABELS[layerKey] ?? `Layer ${i + 1}`}</span>
                    <span className="text-[9px] opacity-50">
                      {isActive ? 'RUNNING' : 'PENDING'}
                    </span>
                  </div>
                </div>
              )
            })
          : layers.map((layer) => (
              <LayerCard key={layer.layer} layer={layer} />
            ))}
      </div>

      {/* Execution plan */}
      {pipeline?.executionPlan && (
        <div className="border border-[#1a1a2e] rounded p-3 space-y-2">
          <div className="text-[10px] text-slate-600 uppercase tracking-widest">
            Execution Plan
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs ${
              pipeline.executionPlan.estimatedRisk === 'low' ? 'text-emerald-400' :
              pipeline.executionPlan.estimatedRisk === 'medium' ? 'text-amber-400' :
              'text-red-400'
            }`}>
              Risk: {pipeline.executionPlan.estimatedRisk.toUpperCase()}
            </span>
            <span className="text-slate-600">
              {pipeline.executionPlan.changes.length} file(s)
            </span>
            {pipeline.executionPlan.reversible && (
              <span className="text-emerald-600">reversible</span>
            )}
          </div>
          {pipeline.executionPlan.changes.map((change, i) => (
            <div key={i} className="flex gap-2 text-[10px]">
              <span className={`flex-shrink-0 ${
                change.type === 'create' ? 'text-emerald-500' :
                change.type === 'delete' ? 'text-red-500' : 'text-amber-500'
              }`}>
                {change.type.toUpperCase()}
              </span>
              <span className="text-slate-500 truncate">{change.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
