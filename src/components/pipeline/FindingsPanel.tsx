import { useState } from 'react'
import type { Finding, LayerResult, PipelineResult } from '../../types'

interface Props {
  result: PipelineResult
  onClose: () => void
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#3b82f6',
  info: '#6366f1'
}

const SEV_BG: Record<string, string> = {
  critical: 'rgba(239,68,68,0.1)',
  high: 'rgba(249,115,22,0.1)',
  medium: 'rgba(245,158,11,0.08)',
  low: 'rgba(59,130,246,0.08)',
  info: 'rgba(99,102,241,0.08)'
}

const LAYER_LABELS: Record<string, string> = {
  intent: '01 · Intent',
  architecture: '02 · Architecture',
  security: '03 · Security',
  dependency: '04 · Dependency',
  performance: '05 · Performance',
  continuity: '06 · Continuity',
  validation: '07 · Validation',
  execution: '08 · Execution',
  observability: '09 · Observability',
  selfCritique: '10 · Self-Critique'
}

function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${filled} ${circ - filled}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        style={{ fill: color, fontSize: size * 0.28, fontWeight: 700, fontFamily: 'monospace', transform: 'rotate(90deg)', transformOrigin: 'center' }}>
        {score}
      </text>
    </svg>
  )
}

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false)
  const color = SEV_COLOR[finding.severity] ?? '#6366f1'
  const bg = SEV_BG[finding.severity] ?? 'rgba(99,102,241,0.08)'

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: open ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, marginTop: 5, flexShrink: 0, boxShadow: `0 0 6px ${color}` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>{finding.message}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: bg, color, border: `1px solid ${color}30` }}>
              {finding.severity}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{finding.category}</span>
            {finding.location && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{finding.location}</span>
            )}
          </div>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, marginTop: 4, color: 'rgba(255,255,255,0.2)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M3 2l4 3-4 3V2z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: '0 16px 12px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {finding.suggestedFix && (
            <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#86efac', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Suggested Fix</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>{finding.suggestedFix}</div>
            </div>
          )}
          {finding.dnaViolation && (
            <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: '#a78bfa', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>DNA Violation</div>
              {finding.dnaViolation.lawId && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>Law #{finding.dnaViolation.lawId} · {finding.dnaViolation.pattern}</div>
              )}
            </div>
          )}
          {'owasp' in finding && (finding as any).owasp && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>OWASP: {(finding as any).owasp}</div>
          )}
        </div>
      )}
    </div>
  )
}

function LayerRow({ layer }: { layer: LayerResult }) {
  const [open, setOpen] = useState(layer.status === 'failed' || layer.status === 'warned')
  const statusColor = { passed: '#22c55e', failed: '#ef4444', warned: '#f59e0b', skipped: '#6366f1', running: '#a78bfa', idle: 'rgba(255,255,255,0.2)' }[layer.status] ?? '#6366f1'
  const statusLabel = { passed: '✓', failed: '✗', warned: '⚠', skipped: '⊘', running: '▶', idle: '○' }[layer.status] ?? '?'

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, width: 14, textAlign: 'center', flexShrink: 0 }}>{statusLabel}</span>
        <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace' }}>{LAYER_LABELS[layer.layer] ?? layer.layer}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{layer.score}/100</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace', marginLeft: 8 }}>{layer.durationMs}ms</span>
        {layer.findings.length > 0 && (
          <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 99, padding: '1px 7px', color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>
            {layer.findings.length}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ flexShrink: 0, color: 'rgba(255,255,255,0.15)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M3 2l4 3-4 3V2z" fill="currentColor" />
        </svg>
      </button>
      {open && layer.findings.length > 0 && (
        <div style={{ background: 'rgba(0,0,0,0.15)' }}>
          {layer.findings.map(f => <FindingRow key={f.id} finding={f} />)}
        </div>
      )}
      {open && layer.findings.length === 0 && (
        <div style={{ padding: '6px 16px 10px 40px', fontSize: 11, color: 'rgba(255,255,255,0.15)', fontStyle: 'italic' }}>No findings</div>
      )}
    </div>
  )
}

export function FindingsPanel({ result, onClose }: Props) {
  const [tab, setTab] = useState<'layers' | 'blockers' | 'scorecard'>('layers')

  const critCount = result.blockers.filter(f => f.severity === 'critical').length
  const highCount = result.blockers.filter(f => f.severity === 'high').length
  const warnCount = result.warnings.length

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} />

      <div style={{
        position: 'relative', width: 680, maxHeight: '88vh',
        background: '#0d0e1a', border: '1px solid rgba(124,58,237,0.2)',
        borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 0 80px rgba(124,58,237,0.15), 0 40px 80px rgba(0,0,0,0.7)'
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <ScoreRing score={result.overallScore} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: result.approved ? '#22c55e' : '#ef4444' }}>
              {result.approved ? 'Pipeline Approved' : 'Pipeline Blocked'}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
              {result.layers.length} layers · {result.durationMs}ms · {new Date(result.timestamp).toLocaleTimeString()}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {critCount > 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>{critCount} critical</span>}
              {highCount > 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)', color: '#fdba74' }}>{highCount} high</span>}
              {warnCount > 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#fcd34d' }}>{warnCount} warnings</span>}
              {result.approved && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac' }}>All clear</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, cursor: 'pointer', padding: 8, color: 'rgba(255,255,255,0.3)', display: 'flex', transition: 'all 0.1s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          {(['layers', 'blockers', 'scorecard'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '9px 18px', fontSize: 12, border: 'none', cursor: 'pointer', background: 'transparent',
              color: tab === t ? '#a78bfa' : 'rgba(255,255,255,0.3)',
              borderBottom: tab === t ? '2px solid #7c3aed' : '2px solid transparent',
              transition: 'all 0.15s', fontFamily: 'inherit', fontWeight: tab === t ? 600 : 400,
              textTransform: 'capitalize'
            }}>
              {t === 'blockers' ? `Blockers (${result.blockers.length})` : t === 'scorecard' ? 'Quality Score' : 'All Layers'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'layers' && result.layers.map(l => <LayerRow key={l.layer} layer={l} />)}

          {tab === 'blockers' && (
            result.blockers.length === 0
              ? <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>No blockers — pipeline approved ✓</div>
              : result.blockers.map(f => <FindingRow key={f.id} finding={f} />)
          )}

          {tab === 'scorecard' && (() => {
            const sc = (result.layers.find(l => l.layer === 'selfCritique') as any)?.scorecard
            if (!sc) return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>Scorecard not available</div>
            const dims = [
              { label: 'Hallucination Risk', value: sc.hallucinationRisk, desc: 'References real systems, no invented APIs' },
              { label: 'Architectural Coherence', value: sc.architecturalCoherence, desc: 'Respects system laws and domain boundaries' },
              { label: 'Security Confidence', value: sc.securityConfidence, desc: 'Zero-trust, validated inputs, scoped credentials' },
              { label: 'Maintainability', value: sc.maintainability, desc: 'Typed, consistent naming, no premature abstractions' },
              { label: 'DNA Consistency', value: sc.driftIndicators, desc: 'Matches architectural identity and behavioral constraints' },
            ]
            return (
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Overall */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 12 }}>
                  <ScoreRing score={sc.overall} size={56} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>Overall Quality Score</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                      DNA Consistent: <span style={{ color: sc.dnaConsistent ? '#22c55e' : '#ef4444' }}>{sc.dnaConsistent ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                </div>
                {/* Dimensions */}
                {dims.map(dim => {
                  const color = dim.value >= 80 ? '#22c55e' : dim.value >= 60 ? '#f59e0b' : '#ef4444'
                  return (
                    <div key={dim.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{dim.label}</span>
                        <span style={{ fontSize: 12, fontFamily: 'monospace', color }}>{dim.value}/100</span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${dim.value}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease', boxShadow: `0 0 8px ${color}80` }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>{dim.desc}</div>
                    </div>
                  )
                })}
                {/* Issues */}
                {sc.issues?.length > 0 && (
                  <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Issues Detected</div>
                    {sc.issues.map((iss: string, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid rgba(239,68,68,0.3)' }}>{iss}</div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
