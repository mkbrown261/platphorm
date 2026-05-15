import { useState, useCallback } from 'react'
import { useDNAStore } from '../../store/dnaStore'
import { dnaEngine } from '../../core/dna/DNAEngine'
import { useProjectStore } from '../../store/projectStore'
import type { ADR, ProjectDNA, ModelRole } from '../../types'

type Section = 'overview' | 'laws' | 'locked' | 'registries' | 'adrs' | 'intents' | 'forbidden'

const SECTION_LABELS: Record<Section, string> = {
  overview:   'Overview',
  laws:       'System Laws',
  locked:     'Locked Systems',
  registries: 'Registries',
  adrs:       'ADRs',
  intents:    'Intent Contracts',
  forbidden:  'Forbidden Patterns'
}

// ── Health Score ────────────────────────────────────────────────────────────
function computeHealthScore(dna: ProjectDNA): { score: number; issues: string[] } {
  const issues: string[] = []
  let score = 100

  if (!dna.identity.systemName) { issues.push('No system name defined'); score -= 10 }
  if (!dna.identity.corePurpose) { issues.push('No core purpose defined'); score -= 10 }
  if (dna.systemLaws.length < 10) { issues.push(`Only ${dna.systemLaws.length} system laws (recommend 17)`); score -= 5 }
  if (dna.lockedSystems.length === 0) { issues.push('No locked systems defined'); score -= 10 }
  if (dna.forbiddenPatterns.length === 0) { issues.push('No forbidden patterns defined'); score -= 8 }
  if (dna.adrs.length === 0) { issues.push('No ADRs recorded'); score -= 7 }
  if (dna.serviceRegistry.length === 0) { issues.push('Service registry empty'); score -= 5 }
  if (dna.domainRegistry.length === 0) { issues.push('Domain registry empty'); score -= 5 }
  if (!dna.securityRequirements) { issues.push('No security requirements defined'); score -= 8 }
  if (!dna.stateManagement) { issues.push('No state management philosophy defined'); score -= 5 }
  if (dna.providerRegistry.length === 0) { issues.push('Provider abstraction registry empty'); score -= 7 }
  if (dna.identity.alwaysDoes.length === 0) { issues.push('No behavioral constraints (alwaysDoes)'); score -= 5 }
  if (dna.identity.neverDoes.length === 0) { issues.push('No behavioral constraints (neverDoes)'); score -= 5 }

  return { score: Math.max(0, score), issues }
}

function HealthScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444'
  const label = score >= 80 ? 'Healthy' : score >= 60 ? 'Degraded' : 'Critical'
  return (
    <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>DNA Health</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color, fontWeight: 700 }}>{score}/100 · {label}</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: `linear-gradient(to right, ${color}80, ${color})`, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

// ── Tag list ─────────────────────────────────────────────────────────────────
function TagList({ items, color = '#a78bfa' }: { items: string[]; color?: string }) {
  if (!items?.length) return <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>None</span>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {items.map((item, i) => (
        <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: `${color}14`, border: `1px solid ${color}30`, color, fontFamily: 'monospace' }}>{item}</span>
      ))}
    </div>
  )
}

// ── Section: Overview ────────────────────────────────────────────────────────
function OverviewSection({ dna, health }: { dna: ProjectDNA; health: ReturnType<typeof computeHealthScore> }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Identity card */}
      <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 6 }}>{dna.identity.systemName || 'Unnamed System'}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, marginBottom: 12 }}>{dna.identity.corePurpose}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10, fontFamily: 'monospace' }}>
          {[
            ['Laws', dna.systemLaws.length],
            ['Locked', dna.lockedSystems.length],
            ['Services', dna.serviceRegistry.length],
            ['Domains', dna.domainRegistry.length],
            ['APIs', dna.apiContractRegistry.length],
            ['ADRs', dna.adrs.length]
          ].map(([k, v]) => (
            <div key={String(k)} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>{k}</span>
              <span style={{ color: '#a78bfa', fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Always / Never */}
      <div>
        <div style={{ fontSize: 10, color: '#22c55e', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 6 }}>Always Does</div>
        {dna.identity.alwaysDoes?.length ? dna.identity.alwaysDoes.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <span style={{ color: '#22c55e', flexShrink: 0, fontSize: 10 }}>✓</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{a}</span>
          </div>
        )) : <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Not defined</span>}
      </div>
      <div>
        <div style={{ fontSize: 10, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 6 }}>Never Does</div>
        {dna.identity.neverDoes?.length ? dna.identity.neverDoes.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <span style={{ color: '#ef4444', flexShrink: 0, fontSize: 10 }}>✗</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>{a}</span>
          </div>
        )) : <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Not defined</span>}
      </div>

      {/* Recovery */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 12 }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 8 }}>Recovery Logic</div>
        {[
          ['Provider Failure', dna.identity.onProviderFailure],
          ['Data Corruption', dna.identity.onDataCorruption],
          ['Unexpected State', dna.identity.onUnexpectedState],
        ].map(([k, v]) => (
          <div key={String(k)} style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: '#a78bfa', fontFamily: 'monospace' }}>{k}: </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{v || 'Not defined'}</span>
          </div>
        ))}
        <div style={{ marginTop: 4, fontSize: 10 }}>
          <span style={{ color: dna.identity.rollbackCapability ? '#22c55e' : '#ef4444' }}>
            {dna.identity.rollbackCapability ? '✓ Rollback capable' : '✗ No rollback'}: </span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>{dna.identity.rollbackMechanism}</span>
        </div>
      </div>

      {/* Health issues */}
      {health.issues.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10, color: '#fca5a5', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>DNA Gaps</div>
          {health.issues.map((iss, i) => (
            <div key={i} style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 3, paddingLeft: 8, borderLeft: '2px solid rgba(239,68,68,0.3)' }}>{iss}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Section: Laws ─────────────────────────────────────────────────────────────
function LawsSection({ dna }: { dna: ProjectDNA }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginBottom: 8, lineHeight: 1.6 }}>
        System laws are non-negotiable architectural rules. All AI output is checked against these.
      </div>
      {dna.systemLaws.map(law => (
        <div key={law.id} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: `1px solid ${law.locked ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)'}` }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: law.locked ? '#a78bfa' : 'rgba(255,255,255,0.25)', fontWeight: 700, flexShrink: 0, width: 20 }}>{String(law.id).padStart(2, '0')}</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, flex: 1 }}>{law.rule}</span>
          {law.locked && <span style={{ fontSize: 9, color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 4, padding: '1px 5px', flexShrink: 0, alignSelf: 'flex-start' }}>LOCKED</span>}
        </div>
      ))}
      {dna.systemLaws.length === 0 && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 24 }}>No system laws defined</div>}
    </div>
  )
}

// ── Section: Locked Systems ───────────────────────────────────────────────────
function LockedSection({ dna }: { dna: ProjectDNA }) {
  const STATUS_COLOR: Record<string, string> = { LOCKED: '#ef4444', SELF_MODIFIABLE: '#22c55e', CONTEXT_LOCKED: '#f59e0b' }
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginBottom: 8, lineHeight: 1.6 }}>
        Locked systems require explicit user approval before any AI modification. The governance pipeline enforces this.
      </div>
      {dna.lockedSystems.map(sys => {
        const color = STATUS_COLOR[sys.status] ?? '#6366f1'
        return (
          <div key={sys.name} style={{ padding: '10px 14px', borderRadius: 10, background: `${color}08`, border: `1px solid ${color}25` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{sys.name}</span>
              <span style={{ fontSize: 9, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 4, padding: '2px 7px', fontFamily: 'monospace', fontWeight: 700 }}>{sys.status}</span>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>{sys.description}</div>
          </div>
        )
      })}
      {dna.lockedSystems.length === 0 && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: 24 }}>No locked systems defined</div>}
    </div>
  )
}

// ── Section: Registries ───────────────────────────────────────────────────────
function RegistriesSection({ dna }: { dna: ProjectDNA }) {
  const [reg, setReg] = useState<'service' | 'domain' | 'component' | 'api' | 'provider'>('service')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 2, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
        {(['service', 'domain', 'component', 'api', 'provider'] as const).map(r => (
          <button key={r} onClick={() => setReg(r)} style={{
            fontSize: 10, padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: reg === r ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
            color: reg === r ? '#a78bfa' : 'rgba(255,255,255,0.3)', transition: 'all 0.1s',
            fontFamily: 'monospace', textTransform: 'capitalize'
          }}>{r}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {reg === 'service' && (dna.serviceRegistry?.length ? dna.serviceRegistry.map(s => (
          <div key={s.name} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#a78bfa', marginBottom: 4 }}>{s.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{s.purpose}</div>
            {s.allowedDependencies?.length > 0 && <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 2 }}>Allowed: {s.allowedDependencies.join(', ')}</div>}
            {s.forbidden?.length > 0 && <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 2 }}>Forbidden: {s.forbidden.join(', ')}</div>}
            {s.recoveryBehavior && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>Recovery: {s.recoveryBehavior}</div>}
          </div>
        )) : <EmptyState label="No services in registry" />)}

        {reg === 'domain' && (dna.domainRegistry?.length ? dna.domainRegistry.map(d => (
          <div key={d.name} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#3b82f6', marginBottom: 6, fontFamily: 'monospace' }}>{d.name}</div>
            <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 2 }}>Owns:</div>
            <TagList items={d.owns} color="#22c55e" />
            {d.forbidden?.length > 0 && <><div style={{ fontSize: 10, color: '#ef4444', marginTop: 6, marginBottom: 2 }}>Forbidden:</div><TagList items={d.forbidden} color="#ef4444" /></>}
          </div>
        )) : <EmptyState label="No domains in registry" />)}

        {reg === 'component' && (dna.componentRegistry?.length ? dna.componentRegistry.map(c => (
          <div key={c.name} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 4 }}>{c.name}</div>
            {c.variants?.length > 0 && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>Variants: {c.variants.join(', ')}</div>}
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#a78bfa' }}>Import from: {c.importFrom}</div>
            {c.doNotRecreate && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>⚠ Do NOT recreate</div>}
          </div>
        )) : <EmptyState label="No components in registry" />)}

        {reg === 'api' && (dna.apiContractRegistry?.length ? dna.apiContractRegistry.map(a => (
          <div key={`${a.method}:${a.endpoint}`} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: `1px solid ${a.status === 'LOCKED' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: { GET: '#22c55e', POST: '#3b82f6', PUT: '#f59e0b', PATCH: '#f59e0b', DELETE: '#ef4444' }[a.method] ?? '#a78bfa' }}>{a.method}</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.7)' }}>{a.endpoint}</span>
              </div>
              <span style={{ fontSize: 9, color: a.status === 'LOCKED' ? '#ef4444' : '#22c55e', background: a.status === 'LOCKED' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${a.status === 'LOCKED' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`, borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace' }}>{a.status}</span>
            </div>
            {a.errors?.length > 0 && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>Errors: {a.errors.join(', ')}</div>}
            {a.auth && <div style={{ fontSize: 10, color: '#f59e0b' }}>Auth required</div>}
          </div>
        )) : <EmptyState label="No API contracts in registry" />)}

        {reg === 'provider' && (dna.providerRegistry?.length ? dna.providerRegistry.map(p => (
          <div key={p.name} style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(124,58,237,0.15)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#c4b5fd', marginBottom: 4 }}>{p.name}</div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#a78bfa', marginBottom: 6 }}>Interface: {p.interfaceName}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>Current: {p.currentImplementation}</div>
            {p.swappableWith?.length > 0 && <div style={{ fontSize: 10, color: '#22c55e', marginBottom: 2 }}>Swappable with: {p.swappableWith.join(', ')}</div>}
            {p.neverCallDirectly && <div style={{ fontSize: 10, color: '#ef4444', marginTop: 4 }}>⚠ Never call SDK directly outside interface</div>}
          </div>
        )) : <EmptyState label="No providers in registry" />)}
      </div>
    </div>
  )
}

// ── Section: ADRs ─────────────────────────────────────────────────────────────
function ADRsSection({ dna }: { dna: ProjectDNA }) {
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ decision: '', reason: '', tradeoffs: '' })
  const [saving, setSaving] = useState(false)

  const addADR = async () => {
    if (!form.decision.trim()) return
    setSaving(true)
    dnaEngine.addADR({ decision: form.decision, reason: form.reason, tradeoffs: form.tradeoffs, status: 'ACTIVE' })
    setForm({ decision: '', reason: '', tradeoffs: '' })
    setShowAdd(false)
    setSaving(false)
  }

  const STATUS_COLOR: Record<string, string> = { ACTIVE: '#22c55e', LOCKED: '#ef4444', SUPERSEDED: '#6b7280' }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>Architecture Decision Records prevent AI from reversing locked decisions.</div>
        <button onClick={() => setShowAdd(v => !v)}
          style={{ fontSize: 10, padding: '4px 10px', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 6, color: '#a78bfa', cursor: 'pointer' }}>
          + Add ADR
        </button>
      </div>

      {showAdd && (
        <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Field label="Decision" value={form.decision} onChange={v => setForm(f => ({ ...f, decision: v }))} placeholder="e.g. Use Zustand over Redux" />
          <Field label="Reason" value={form.reason} onChange={v => setForm(f => ({ ...f, reason: v }))} placeholder="Why was this decision made?" />
          <Field label="Tradeoffs" value={form.tradeoffs} onChange={v => setForm(f => ({ ...f, tradeoffs: v }))} placeholder="What did we give up?" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowAdd(false)} style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
            <button onClick={addADR} disabled={saving || !form.decision.trim()}
              style={{ fontSize: 11, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: 'white', border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer' }}>
              {saving ? 'Saving...' : 'Save ADR'}
            </button>
          </div>
        </div>
      )}

      {dna.adrs.map(adr => {
        const color = STATUS_COLOR[adr.status] ?? '#a78bfa'
        return (
          <div key={adr.id} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#a78bfa' }}>{adr.id}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{adr.decision}</span>
              </div>
              <span style={{ fontSize: 9, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace' }}>{adr.status}</span>
            </div>
            {adr.reason && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{adr.reason}</div>}
            {adr.tradeoffs && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>Tradeoffs: {adr.tradeoffs}</div>}
          </div>
        )
      })}
      {dna.adrs.length === 0 && !showAdd && <EmptyState label="No ADRs recorded yet — add your first decision" />}
    </div>
  )
}

// ── Section: Forbidden Patterns ───────────────────────────────────────────────
function ForbiddenSection({ dna }: { dna: ProjectDNA }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginBottom: 8, lineHeight: 1.6 }}>
        These patterns trigger automatic rejection. If AI generates them, the pipeline blocks execution.
      </div>
      {dna.forbiddenPatterns.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.12)' }}>
          <span style={{ color: '#ef4444', fontSize: 12, flexShrink: 0, marginTop: 1 }}>✗</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>{p}</span>
        </div>
      ))}
      {dna.forbiddenPatterns.length === 0 && <EmptyState label="No forbidden patterns defined" />}
    </div>
  )
}

// ── Intent Contracts ──────────────────────────────────────────────────────────
function IntentsSection({ dna }: { dna: ProjectDNA }) {
  const [showBuilder, setShowBuilder] = useState(false)
  const [form, setForm] = useState({ intent: '', inputs: '', outputs: '', stateImpact: '', dependencies: '', security: '', failure: '', observability: '' })
  const [generated, setGenerated] = useState<string | null>(null)

  const build = () => {
    const contract = `INTENT CONTRACT
══════════════════════════════════════════
INTENT:        ${form.intent}
INPUTS:        ${form.inputs}
OUTPUTS:       ${form.outputs}
STATE IMPACT:  ${form.stateImpact}
DEPENDENCIES:  ${form.dependencies}
SECURITY:      ${form.security}
FAILURE:       ${form.failure}
OBSERVABILITY: ${form.observability}
══════════════════════════════════════════`
    setGenerated(contract)
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 1.5 }}>
          Fill out before generating any code. Prevents hallucinated implementation drift.
        </div>
        <button onClick={() => setShowBuilder(v => !v)}
          style={{ fontSize: 10, padding: '4px 10px', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 6, color: '#a78bfa', cursor: 'pointer', flexShrink: 0, marginLeft: 8 }}>
          + New Contract
        </button>
      </div>

      {showBuilder && (
        <div style={{ background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([
            ['intent', 'What problem is this solving?'],
            ['inputs', 'What enters the system?'],
            ['outputs', 'What leaves the system?'],
            ['stateImpact', 'What changes in persistent state?'],
            ['dependencies', 'What existing systems does this interact with?'],
            ['security', 'What risks does this introduce?'],
            ['failure', 'What can break and how should it be handled?'],
            ['observability', 'How is this monitored, logged, or traced?']
          ] as const).map(([key, placeholder]) => (
            <Field key={key} label={key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
              value={(form as any)[key]} onChange={v => setForm(f => ({ ...f, [key]: v }))}
              placeholder={placeholder} />
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowBuilder(false); setGenerated(null) }} style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
            <button onClick={build}
              style={{ fontSize: 11, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: 'white', border: 'none', borderRadius: 6, padding: '5px 14px', cursor: 'pointer' }}>
              Generate Contract
            </button>
          </div>
          {generated && (
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)' }}>intent-contract.txt</span>
                <button onClick={() => navigator.clipboard.writeText(generated)} style={{ fontSize: 10, color: '#a78bfa', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace' }}>copy</button>
              </div>
              <pre style={{ margin: 0, padding: '10px 14px', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.65)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{generated}</pre>
            </div>
          )}
        </div>
      )}
      {!showBuilder && <EmptyState label='Click "+ New Contract" to build an Intent Contract' />}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>{label}</div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: 'rgba(255,255,255,0.7)', outline: 'none', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' as const }}
        onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.5)'}
        onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'} />
    </div>
  )
}

// ── Main DNA Panel ────────────────────────────────────────────────────────────
export function DNAPanel() {
  const { dna, isInitializing } = useDNAStore()
  const { activeProject } = useProjectStore()
  const [section, setSection] = useState<Section>('overview')

  if (isInitializing) return (
    <div style={{ width: 260, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 10, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16, fontWeight: 600 }}>Analyzing DNA</div>
        {[80, 65, 90, 55, 75, 60].map((w, i) => (
          <div key={i} style={{ height: 8, background: 'rgba(124,58,237,0.15)', borderRadius: 4, marginBottom: 8, width: `${w}%` }} />
        ))}
      </div>
    </div>
  )

  if (!dna || !activeProject) return (
    <div style={{ width: 260, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>🧬</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', lineHeight: 1.6 }}>Open a project to initialize DNA</div>
      </div>
    </div>
  )

  const health = computeHealthScore(dna)

  return (
    <div style={{ width: 260, flexShrink: 0, background: '#0a0b13', borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 2 }}>Project DNA</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{dna.identity.systemName}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 1 }}>v{dna.version}</div>
      </div>

      {/* Health */}
      <HealthScoreBar score={health.score} />

      {/* Section nav */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        {(Object.keys(SECTION_LABELS) as Section[]).map(s => (
          <button key={s} onClick={() => setSection(s)} style={{
            width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontSize: 11, marginBottom: 1, transition: 'all 0.1s',
            background: section === s ? 'rgba(124,58,237,0.15)' : 'transparent',
            color: section === s ? '#a78bfa' : 'rgba(255,255,255,0.3)',
            fontWeight: section === s ? 600 : 400
          }}
            onMouseEnter={e => { if (section !== s) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.55)' }}
            onMouseLeave={e => { if (section !== s) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)' }}>
            {SECTION_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {section === 'overview' && <OverviewSection dna={dna} health={health} />}
        {section === 'laws' && <LawsSection dna={dna} />}
        {section === 'locked' && <LockedSection dna={dna} />}
        {section === 'registries' && <RegistriesSection dna={dna} />}
        {section === 'adrs' && <ADRsSection dna={dna} />}
        {section === 'intents' && <IntentsSection dna={dna} />}
        {section === 'forbidden' && <ForbiddenSection dna={dna} />}
      </div>
    </div>
  )
}
