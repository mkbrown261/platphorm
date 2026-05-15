import { useGovernanceStore } from '../../store/governanceStore'
import { useAIStore } from '../../store/aiStore'
import { useProjectStore } from '../../store/projectStore'
import type { AuditLog, GovernanceEvent } from '../../types'

const EVENT_COLORS: Record<string, string> = {
  locked_system_access:         '#ef4444',
  forbidden_pattern_detected:   '#f97316',
  law_violation:                '#f59e0b',
  architecture_drift:           '#f59e0b',
  security_risk:                '#ef4444',
  dependency_risk:              '#f97316',
  hallucination_detected:       '#a78bfa',
  provider_abstraction_violated:'#ef4444',
  scope_expansion_detected:     '#f59e0b',
  context_lock_violated:        '#f59e0b'
}

const EVENT_ICONS: Record<string, string> = {
  locked_system_access:         '🔒',
  forbidden_pattern_detected:   '✗',
  law_violation:                '⚠',
  architecture_drift:           '↗',
  security_risk:                '🛡',
  dependency_risk:              '📦',
  hallucination_detected:       '👁',
  provider_abstraction_violated:'⛔',
  scope_expansion_detected:     '↔',
  context_lock_violated:        '🔐'
}

function MetricPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ flex: 1, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color }}>{value}</div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function EventRow({ event }: { event: GovernanceEvent }) {
  const color = EVENT_COLORS[event.type] ?? '#6366f1'
  const icon = EVENT_ICONS[event.type] ?? '•'
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 12, color, flexShrink: 0, width: 16, textAlign: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.description}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.2)' }}>{time}</span>
          <span style={{ fontSize: 10, color: event.approved ? '#22c55e' : '#ef4444' }}>{event.approved ? '✓ approved' : '✗ blocked'}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{event.actor}</span>
        </div>
      </div>
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditLog }) {
  const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>{time}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: entry.approved ? '#22c55e' : '#ef4444', marginRight: 6 }}>{entry.approved ? '✓' : '✗'}</span>
          <span style={{ color: '#a78bfa', marginRight: 6 }}>{entry.actor}</span>
          {entry.action} → <span style={{ fontFamily: 'monospace' }}>{entry.target}</span>
        </div>
      </div>
    </div>
  )
}

export function GovernanceDashboard() {
  const { events, auditLog, report } = useGovernanceStore()
  const { activePipeline, pipelineHistory } = useAIStore()
  const { activeProject } = useProjectStore()

  const recentEvents = [...events].reverse().slice(0, 50)
  const recentAudit = [...auditLog].reverse().slice(0, 50)

  const violations = events.filter(e => !e.approved).length
  const health = activePipeline
    ? activePipeline.overallScore >= 80 ? 'healthy' : activePipeline.overallScore >= 60 ? 'degraded' : 'critical'
    : 'healthy'
  const healthColor = { healthy: '#22c55e', degraded: '#f59e0b', critical: '#ef4444' }[health]

  const avgScore = pipelineHistory.length
    ? Math.round(pipelineHistory.slice(-10).reduce((a, r) => a + r.overallScore, 0) / Math.min(pipelineHistory.length, 10))
    : null

  return (
    <div style={{ width: 260, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 2 }}>Governance</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: healthColor, boxShadow: `0 0 6px ${healthColor}` }} />
          <span style={{ fontSize: 11, color: healthColor, fontWeight: 600, textTransform: 'capitalize' }}>{health}</span>
          {activeProject && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>· {activeProject.name}</span>}
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <MetricPill label="Pipelines" value={pipelineHistory.length} color="#a78bfa" />
        <MetricPill label="Violations" value={violations} color={violations > 0 ? '#ef4444' : '#22c55e'} />
        {avgScore !== null && <MetricPill label="Avg Score" value={avgScore} color={avgScore >= 80 ? '#22c55e' : '#f59e0b'} />}
      </div>

      {/* Active pipeline score */}
      {activePipeline && (
        <div style={{ margin: '8px 12px', padding: '10px 12px', background: activePipeline.approved ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${activePipeline.approved ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>Last Pipeline</span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: activePipeline.approved ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{activePipeline.overallScore}/100</span>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${activePipeline.overallScore}%`, background: activePipeline.approved ? '#22c55e' : '#ef4444', borderRadius: 99 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)' }}>
            <span>{activePipeline.blockers.length} blockers</span>
            <span>{activePipeline.warnings.length} warnings</span>
            <span>{activePipeline.durationMs}ms</span>
          </div>
        </div>
      )}

      {/* Events feed */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Governance events */}
        {recentEvents.length > 0 && (
          <div style={{ padding: '10px 14px 6px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Governance Events ({events.length})
            </div>
            {recentEvents.slice(0, 20).map(e => <EventRow key={e.id} event={e} />)}
          </div>
        )}

        {/* Audit log */}
        {recentAudit.length > 0 && (
          <div style={{ padding: '10px 14px 6px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Audit Log ({auditLog.length})
            </div>
            {recentAudit.slice(0, 30).map(e => <AuditRow key={e.id} entry={e} />)}
          </div>
        )}

        {events.length === 0 && auditLog.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 8, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 28, opacity: 0.2 }}>🛡</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', lineHeight: 1.6 }}>
              {activeProject ? 'No governance events yet. Run a pipeline.' : 'Open a project to begin governance.'}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
