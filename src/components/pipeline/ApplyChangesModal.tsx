import { useState } from 'react'
import type { ExecutionPlan, FileChange } from '../../types'

interface Props {
  plan: ExecutionPlan
  projectPath: string
  onApply: (results: Array<{ path: string; success: boolean; error?: string }>) => void
  onReject: () => void
}

const TYPE_COLOR: Record<string, string> = {
  create: '#22c55e',
  modify: '#f59e0b',
  delete: '#ef4444',
  rename: '#3b82f6'
}

const TYPE_ICON: Record<string, string> = {
  create: '+',
  modify: '~',
  delete: '−',
  rename: '→'
}

function FileChangeRow({ change, expanded, onToggle }: {
  change: FileChange
  expanded: boolean
  onToggle: () => void
}) {
  const name = change.path.split('/').slice(-2).join('/')
  const color = TYPE_COLOR[change.type] ?? '#a78bfa'
  const icon = TYPE_ICON[change.type] ?? '•'

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 16px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s'
        }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <span style={{
          width: 18, height: 18, borderRadius: 4, background: `${color}18`,
          border: `1px solid ${color}40`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0
        }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 1 }}>{change.reason}</div>
        </div>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
          {change.after ? `${change.after.split('\n').length} lines` : ''}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, color: 'rgba(255,255,255,0.2)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M3 2l4 3-4 3V2z" fill="currentColor" />
        </svg>
      </button>

      {expanded && change.after && (
        <div style={{ margin: '0 16px 10px', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)' }}>{change.path}</span>
            <button
              onClick={() => navigator.clipboard.writeText(change.after!)}
              style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace' }}
            >copy</button>
          </div>
          <pre style={{
            margin: 0, padding: '10px 12px', maxHeight: 260, overflowY: 'auto',
            fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            color: 'rgba(255,255,255,0.65)', lineHeight: 1.65,
            background: 'rgba(0,0,0,0.3)', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
          }}>
            <code>{change.after}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

export function ApplyChangesModal({ plan, projectPath, onApply, onReject }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [appliedResults, setAppliedResults] = useState<Array<{ path: string; success: boolean; error?: string }> | null>(null)

  const toggle = (path: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  const riskColor = {
    low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#ef4444'
  }[plan.estimatedRisk] ?? '#a78bfa'

  const handleApply = async () => {
    setApplying(true)
    try {
      const applicable = plan.changes.filter(c => c.type !== 'rename' || c.after)
      const results = await window.api.fs.applyChanges(
        applicable.map(c => ({ path: c.path, type: c.type, after: c.after }))
      )

      // Append to audit log
      const entry = JSON.stringify({
        timestamp: Date.now(),
        action: 'apply_changes',
        actor: 'ai',
        changes: applicable.map(c => c.path),
        risk: plan.estimatedRisk,
        approved: true,
        immutable: true
      })
      await window.api.fs.appendAuditLog(projectPath, entry)

      setAppliedResults(results)
      const allOk = results.every(r => r.success)
      if (allOk) {
        setTimeout(() => onApply(results), 1200)
      }
    } catch (err) {
      setAppliedResults([{ path: 'system', success: false, error: String(err) }])
    }
    setApplying(false)
  }

  const isDone = appliedResults !== null
  const allSucceeded = isDone && appliedResults.every(r => r.success)
  const anyFailed = isDone && appliedResults.some(r => !r.success)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Backdrop */}
      <div
        onClick={!applying ? onReject : undefined}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' }}
      />

      {/* Modal */}
      <div style={{
        position: 'relative', width: 640, maxHeight: '85vh',
        background: '#0e0f1c', border: '1px solid rgba(124,58,237,0.25)',
        borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 0 80px rgba(124,58,237,0.2), 0 40px 80px rgba(0,0,0,0.7)'
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>Apply Execution Plan</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
              {plan.changes.length} file{plan.changes.length !== 1 ? 's' : ''} · {plan.reversible ? 'Reversible' : 'Irreversible'}
            </div>
          </div>
          {/* Risk badge */}
          <div style={{
            padding: '3px 10px', borderRadius: 99,
            background: `${riskColor}18`, border: `1px solid ${riskColor}40`,
            fontSize: 10, fontFamily: 'monospace', color: riskColor, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 1
          }}>
            {plan.estimatedRisk} risk
          </div>
        </div>

        {/* Rollback plan */}
        {plan.rollbackPlan && (
          <div style={{ padding: '8px 20px', background: 'rgba(124,58,237,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.5)" strokeWidth="2"><path d="M3 12a9 9 0 109 9"/><polyline points="3 3 3 12 12 12"/></svg>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>Rollback: {plan.rollbackPlan}</span>
          </div>
        )}

        {/* Changes list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {plan.changes.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
              No file changes in this plan
            </div>
          ) : (
            plan.changes.map(change => (
              <FileChangeRow
                key={change.path}
                change={change}
                expanded={expanded.has(change.path)}
                onToggle={() => toggle(change.path)}
              />
            ))
          )}
        </div>

        {/* Applied results */}
        {isDone && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', background: allSucceeded ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)' }}>
            {appliedResults!.map(r => (
              <div key={r.path} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: r.success ? '#22c55e' : '#ef4444' }}>{r.success ? '✓' : '✗'}</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.4)' }}>{r.path.split('/').slice(-1)[0]}</span>
                {r.error && <span style={{ fontSize: 10, color: '#ef4444' }}>{r.error}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            onClick={onReject}
            disabled={applying}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 16px', borderRadius: 8, transition: 'color 0.1s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}
          >
            Reject
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {plan.changes.length > 0 && (
              <button
                onClick={() => setExpanded(
                  expanded.size === plan.changes.length
                    ? new Set()
                    : new Set(plan.changes.map(c => c.path))
                )}
                style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', padding: '6px 12px', borderRadius: 8, transition: 'all 0.1s' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.25)'}
              >
                {expanded.size === plan.changes.length ? 'Collapse all' : 'Expand all'}
              </button>
            )}

            <button
              onClick={handleApply}
              disabled={applying || isDone}
              style={{
                fontSize: 12, fontWeight: 600,
                background: isDone
                  ? allSucceeded ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'
                  : applying ? 'rgba(124,58,237,0.3)' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                border: isDone
                  ? allSucceeded ? '1px solid rgba(34,197,94,0.4)' : '1px solid rgba(239,68,68,0.4)'
                  : 'none',
                color: isDone ? (allSucceeded ? '#22c55e' : '#ef4444') : 'white',
                padding: '7px 20px', borderRadius: 8, cursor: applying || isDone ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                boxShadow: !isDone && !applying ? '0 0 16px rgba(124,58,237,0.4)' : 'none'
              }}
            >
              {applying && (
                <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              )}
              {isDone
                ? allSucceeded ? '✓ Applied' : anyFailed ? '✗ Partial failure' : '✓ Done'
                : applying ? 'Applying...' : `Apply ${plan.changes.length} change${plan.changes.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
