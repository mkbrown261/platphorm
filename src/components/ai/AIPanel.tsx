import { useState, useRef, useEffect, useCallback } from 'react'
import { useAIStore } from '../../store/aiStore'
import { useDNAStore } from '../../store/dnaStore'
import { useProjectStore } from '../../store/projectStore'
import { runPipeline } from '../../core/intelligence/Pipeline'
import { runAgent, buildAgentSystemPrompt } from '../../core/intelligence/AgentRunner'
import { orchestrator } from '../../core/providers/AIOrchestrator'
import type { PipelineContext, LayerResult, PipelineResult } from '../../types'

// ─── Types ───────────────────────────────────────────────────────────────────

type ActivityItem =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; icon: string; label: string; detail: string; status: 'running'|'done'|'error'; summary?: string }
  | { kind: 'pipeline'; index: number; label: string; description: string; status: 'running'|'done'|'warned'|'failed' }
  | { kind: 'cutoff'; loops: number }

interface Msg {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  activity?: ActivityItem[]
  score?: number
  approved?: boolean
}

/** Pending confirmation — resolves true (proceed) or false (cancel) */
interface ConfirmRequest {
  result: PipelineResult
  resolve: (proceed: boolean) => void
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LAYER_LABELS = [
  '01 · Intent', '02 · Architecture', '03 · Security', '04 · Dependencies',
  '05 · Performance', '06 · Continuity', '07 · Validation',
  '08 · Execution', '09 · Observability', '10 · Self-Critique'
]

const SUGGESTIONS = [
  'Build a REST API with auth',
  'Add a database model',
  'Create a React component',
  'Refactor for better performance',
  'Fix security vulnerabilities'
]

// ─── Confirmation Dialog ──────────────────────────────────────────────────────

function ConfirmDialog({ req, prompt }: { req: ConfirmRequest; prompt: string }) {
  const { result } = req

  // Summarise what the agent will do (warnings + blockers omitted since result.approved=true)
  const warnings = result.layers.flatMap(l =>
    l.findings.filter(f => f.severity === 'high' || f.severity === 'medium')
  )

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(6,7,13,0.85)', backdropFilter: 'blur(6px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 20
    }}>
      <div style={{
        width: '100%', maxWidth: 300,
        background: '#0f1017', border: '1px solid rgba(124,58,237,0.35)',
        borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.15)'
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 13, color: '#4ade80' }}>✓</span>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Governance Passed</div>
            <div style={{ fontSize: 10, color: 'rgba(34,197,94,0.7)', fontFamily: 'monospace' }}>{result.overallScore}/100 · All 10 layers</div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>Request</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.55, maxHeight: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt}
            </div>
          </div>

          {warnings.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: 'rgba(245,158,11,0.7)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>⚠ Warnings ({warnings.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 100, overflowY: 'auto' }}>
                {warnings.slice(0, 5).map((w, i) => (
                  <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4, padding: '4px 8px', background: 'rgba(245,158,11,0.05)', borderRadius: 6, borderLeft: '2px solid rgba(245,158,11,0.3)' }}>
                    {w.message}
                  </div>
                ))}
                {warnings.length > 5 && (
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>+{warnings.length - 5} more</div>
                )}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.55, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
            The agent will now write files to your project. This action modifies your codebase and cannot be automatically undone.
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8 }}>
          <button
            onClick={() => req.resolve(false)}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 9,
              background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.4)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.2)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => req.resolve(true)}
            style={{
              flex: 2, padding: '9px 0', borderRadius: 9,
              background: 'linear-gradient(135deg, #16a34a, #15803d)',
              border: '1px solid rgba(34,197,94,0.35)',
              color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 0 16px rgba(34,197,94,0.2)',
              transition: 'all 0.15s'
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 24px rgba(34,197,94,0.35)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px rgba(34,197,94,0.2)' }}
          >
            Confirm &amp; Build
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ToolCard({ item }: { item: Extract<ActivityItem, { kind: 'tool' }> }) {
  const running = item.status === 'running'
  const ok = item.status === 'done'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 12px', borderRadius: 8,
      background: running ? 'rgba(124,58,237,0.08)' : ok ? 'rgba(34,197,94,0.05)' : 'rgba(239,68,68,0.06)',
      border: `1px solid ${running ? 'rgba(124,58,237,0.2)' : ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.2)'}`,
      transition: 'all 0.2s'
    }}>
      <span style={{ fontSize: 13, width: 18, textAlign: 'center', flexShrink: 0, color: running ? '#a78bfa' : ok ? '#4ade80' : '#f87171', fontFamily: 'monospace' }}>
        {item.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{item.label}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{item.detail}</span>
        </div>
        {item.summary && (
          <div style={{ fontSize: 10, color: ok ? 'rgba(74,222,128,0.7)' : 'rgba(248,113,113,0.7)', marginTop: 1 }}>{item.summary}</div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>
        {running ? (
          <div style={{ width: 12, height: 12, border: '1.5px solid rgba(167,139,250,0.3)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        ) : ok ? (
          <span style={{ fontSize: 10, color: '#4ade80', fontFamily: 'monospace' }}>✓</span>
        ) : (
          <span style={{ fontSize: 10, color: '#f87171', fontFamily: 'monospace' }}>✗</span>
        )}
      </div>
    </div>
  )
}

function PipelineCard({ item }: { item: Extract<ActivityItem, { kind: 'pipeline' }> }) {
  const running = item.status === 'running'
  const failed = item.status === 'failed'
  const warned = item.status === 'warned'
  const done = item.status === 'done'

  const dotColor = running ? '#a78bfa' : done ? '#22c55e' : warned ? '#f59e0b' : '#ef4444'
  const textColor = running ? 'rgba(167,139,250,0.9)' : done ? 'rgba(34,197,94,0.8)' : warned ? 'rgba(245,158,11,0.8)' : 'rgba(239,68,68,0.8)'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '6px 12px', borderRadius: 8,
      background: running ? 'rgba(124,58,237,0.06)' : 'transparent',
      borderLeft: `2px solid ${dotColor}`,
      transition: 'all 0.2s'
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: textColor, fontFamily: 'monospace', fontWeight: 600 }}>{item.label}</span>
          {running && <div style={{ width: 10, height: 10, border: '1.5px solid rgba(167,139,250,0.3)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />}
          {!running && <span style={{ fontSize: 10, color: textColor }}>{done ? '✓' : warned ? '⚠' : '✗'}</span>}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2, lineHeight: 1.4 }}>{item.description}</div>
      </div>
    </div>
  )
}

/** FIX 11: Renders the agent loop-cap warning */
function CutoffCard({ item }: { item: Extract<ActivityItem, { kind: 'cutoff' }> }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 8,
      background: 'rgba(245,158,11,0.06)',
      border: '1px solid rgba(245,158,11,0.2)'
    }}>
      <span style={{ fontSize: 14, flexShrink: 0 }}>⚠</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: 'rgba(245,158,11,0.85)', fontWeight: 600 }}>Agent loop limit reached</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2, lineHeight: 1.45 }}>
          The agent completed {item.loops} tool-use loops without finishing. The task may be partially done — check your files and re-prompt if needed.
        </div>
      </div>
    </div>
  )
}

function ThinkingBubble({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.65, whiteSpace: 'pre-wrap', padding: '2px 0' }}>
      {text}
    </div>
  )
}

function ActivityStream({ items }: { items: ActivityItem[] }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => {
        if (item.kind === 'thinking') return <ThinkingBubble key={i} text={item.text} />
        if (item.kind === 'tool') return <ToolCard key={item.id} item={item} />
        if (item.kind === 'pipeline') return <PipelineCard key={item.index} item={item} />
        if (item.kind === 'cutoff') return <CutoffCard key={`cutoff-${i}`} item={item} />
        return null
      })}
    </div>
  )
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '6px 0', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'rgba(167,139,250,0.5)', marginRight: 4, fontStyle: 'italic' }}>PLATPHORM is thinking</span>
      {[0,1,2].map(i => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#7c3aed', display: 'block', animation: `blink 1.2s ${i * 0.2}s ease-in-out infinite` }} />
      ))}
    </div>
  )
}

function renderMarkdown(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((p, i) => {
    if (p.startsWith('```')) {
      const lines = p.slice(3, -3).split('\n')
      const lang = lines[0].trim()
      const code = lines.slice(1).join('\n').trim()
      return (
        <div key={i} style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{lang || 'code'}</span>
            <button onClick={() => navigator.clipboard.writeText(code)} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>copy</button>
          </div>
          <pre style={{ margin: 0, padding: '10px 14px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.75)', overflowX: 'auto', background: 'rgba(0,0,0,0.3)', lineHeight: 1.7 }}>
            <code>{code}</code>
          </pre>
        </div>
      )
    }
    if (!p.trim()) return null
    return <p key={i} style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.65, color: 'rgba(255,255,255,0.75)', whiteSpace: 'pre-wrap' }}>{p}</p>
  })
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AIPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** FIX 10: pending confirmation request — shown as modal overlay */
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const { settings, startPipeline, updateLayerProgress, completePipeline, pipelineRunning } = useAIStore()
  const { dna } = useDNAStore()
  const { activeProject, openTabs, activeTabId } = useProjectStore()
  const activeTab = openTabs.find(t => t.id === activeTabId)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const newId = () => `m${Date.now()}${Math.random().toString(36).slice(2)}`

  const pushActivity = useCallback((msgId: string, item: ActivityItem) => {
    setMsgs(prev => prev.map(m => {
      if (m.id !== msgId) return m
      const activity = m.activity ?? []
      // Update existing pipeline item if index matches
      if (item.kind === 'pipeline') {
        const idx = activity.findIndex(a => a.kind === 'pipeline' && a.index === item.index)
        if (idx >= 0) {
          const next = [...activity]; next[idx] = item
          return { ...m, activity: next }
        }
      }
      return { ...m, activity: [...activity, item] }
    }))
  }, [])

  const patchTool = useCallback((msgId: string, id: string, status: 'done'|'error', summary: string) => {
    setMsgs(prev => prev.map(m => {
      if (m.id !== msgId || !m.activity) return m
      return { ...m, activity: m.activity.map(a => a.kind === 'tool' && a.id === id ? { ...a, status, summary } : a) }
    }))
  }, [])

  /**
   * FIX 10: Show a confirmation dialog after governance passes.
   * Returns a Promise that resolves `true` (proceed) or `false` (cancel).
   */
  const requestConfirmation = useCallback((result: PipelineResult): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setConfirmReq({ result, resolve })
    })
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)

    const userMsg: Msg = { id: newId(), role: 'user', content: text }
    setMsgs(p => [...p, userMsg])

    if (!orchestrator.hasProviders()) {
      setMsgs(p => [...p, { id: newId(), role: 'system', content: 'Add an API key in Settings (⌘,) to get started.' }])
      setBusy(false)
      return
    }

    const apiKey = settings.providers?.openrouter ?? ''

    if (!apiKey) {
      setMsgs(p => [...p, { id: newId(), role: 'system', content: 'OpenRouter API key required for agent mode. Add it in Settings (⌘,).' }])
      setBusy(false)
      return
    }

    activeProject ? await withPipeline(text, apiKey) : await withAgent(text, apiKey)
    setBusy(false)
  }, [input, busy, activeProject, dna, activeTab, settings])

  const withAgent = async (prompt: string, apiKey: string) => {
    const msgId = newId()
    setMsgs(p => [...p, { id: msgId, role: 'assistant', activity: [] }])

    const sys = buildAgentSystemPrompt({
      systemName: dna?.identity?.systemName,
      corePurpose: dna?.identity?.corePurpose,
      systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? []
    })

    const fullPrompt = activeTab ? `Context file: ${activeTab.filePath}\n\n${prompt}` : prompt

    try {
      for await (const event of runAgent(fullPrompt, sys, apiKey)) {
        if (event.type === 'thinking') {
          pushActivity(msgId, { kind: 'thinking', text: event.text })
        } else if (event.type === 'tool_start') {
          pushActivity(msgId, { kind: 'tool', id: event.id, icon: event.icon, label: event.label, detail: event.detail, status: 'running' })
        } else if (event.type === 'tool_done') {
          patchTool(msgId, event.id, event.success ? 'done' : 'error', event.summary)
        } else if (event.type === 'cutoff') {
          // FIX 11: show loop-cap warning in activity stream
          pushActivity(msgId, { kind: 'cutoff', loops: event.loops })
        } else if (event.type === 'error') {
          setMsgs(p => p.map(m => m.id === msgId ? { ...m, content: `Error: ${event.message}` } : m))
        }
      }
    } catch (err) {
      setMsgs(p => p.map(m => m.id === msgId ? { ...m, content: `Error: ${String(err)}` } : m))
    }
  }

  const withPipeline = async (prompt: string, apiKey: string) => {
    const msgId = newId()
    setMsgs(p => [...p, { id: msgId, role: 'assistant', activity: [] }])
    startPipeline()

    const ctx: PipelineContext = {
      projectPath: activeProject!.rootPath,
      userPrompt: prompt,
      selectedCode: activeTab?.content?.slice(0, 4000),
      activeFile: activeTab?.filePath,
      projectDNAAvailable: !!dna,
      architectureDoc: undefined,
      systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? [],
      lockedSystems: dna?.lockedSystems?.map((s: any) => s.name) ?? [],
      relevantRegistries: ''
    }

    try {
      const result = await runPipeline(ctx, (index, _name, description, layerResult) => {
        const label = LAYER_LABELS[index] ?? `Layer ${index + 1}`
        updateLayerProgress(index, _name, layerResult)

        if (!layerResult) {
          // Layer starting
          pushActivity(msgId, { kind: 'pipeline', index, label, description, status: 'running' })
        } else {
          // Layer complete
          const status = layerResult.status === 'failed' ? 'failed'
            : layerResult.findings.some(f => f.severity === 'high') ? 'warned'
            : 'done'
          pushActivity(msgId, { kind: 'pipeline', index, label, description, status })
        }
      })

      completePipeline(result)

      if (result.approved) {
        // ── FIX 10: Explicit user confirmation before writing any files ──────
        pushActivity(msgId, { kind: 'thinking', text: `Governance passed ${result.overallScore}/100 — awaiting your confirmation to write files.` })

        const userConfirmed = await requestConfirmation(result)
        setConfirmReq(null)  // always dismiss the dialog

        if (!userConfirmed) {
          pushActivity(msgId, { kind: 'thinking', text: 'Build cancelled by user.' })
          setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: false } : m))
          return
        }

        // User confirmed — proceed to agent execution
        pushActivity(msgId, { kind: 'thinking', text: `Building now…` })

        const sys = buildAgentSystemPrompt({
          projectPath: activeProject!.rootPath,
          systemName: dna?.identity?.systemName,
          corePurpose: dna?.identity?.corePurpose,
          systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
          forbiddenPatterns: dna?.forbiddenPatterns ?? []
        })

        for await (const event of runAgent(prompt, sys, apiKey)) {
          if (event.type === 'thinking') {
            pushActivity(msgId, { kind: 'thinking', text: event.text })
          } else if (event.type === 'tool_start') {
            pushActivity(msgId, { kind: 'tool', id: event.id, icon: event.icon, label: event.label, detail: event.detail, status: 'running' })
          } else if (event.type === 'tool_done') {
            patchTool(msgId, event.id, event.success ? 'done' : 'error', event.summary)
          } else if (event.type === 'cutoff') {
            // FIX 11: loop-cap warning in pipeline flow too
            pushActivity(msgId, { kind: 'cutoff', loops: event.loops })
          } else if (event.type === 'error') {
            pushActivity(msgId, { kind: 'thinking', text: `Agent error: ${event.message}` })
          }
        }

        setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: true } : m))
      } else {
        // Blocked — show blockers
        const blockText = `Blocked by governance:\n${result.blockers.map(b => `• ${b.message}`).join('\n')}`
        pushActivity(msgId, { kind: 'thinking', text: blockText })
        setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: false } : m))
      }
    } catch (err) {
      setMsgs(p => p.map(m => m.id === msgId ? { ...m, content: `Pipeline error: ${String(err)}` } : m))
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ width: 340, flexShrink: 0, background: '#090a11', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* FIX 10: Confirmation dialog overlay — blocks the panel while waiting */}
      {confirmReq && (
        <ConfirmDialog
          req={confirmReq}
          prompt={[...msgs].reverse().find(m => m.role === 'user')?.content ?? ''}
        />
      )}

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.5), rgba(79,70,229,0.4))',
          border: '1px solid rgba(124,58,237,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: busy ? '0 0 16px rgba(124,58,237,0.5)' : 'none',
          transition: 'box-shadow 0.3s'
        }}>
          <span style={{ fontSize: 14, fontWeight: 800, background: 'linear-gradient(135deg, #c4b5fd, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>P</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>PLATPHORM AI</div>
          <div style={{ fontSize: 10, color: confirmReq ? '#f59e0b' : busy ? '#a78bfa' : '#22c55e', transition: 'color 0.3s' }}>
            {confirmReq ? 'Awaiting confirmation…' : busy ? (activeProject ? 'Running governance pipeline...' : 'Agent working...') : (dna ? dna.identity?.systemName : 'Ready')}
          </div>
        </div>
        <div style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: confirmReq ? '#f59e0b' : busy ? '#a78bfa' : '#22c55e',
          boxShadow: confirmReq ? '0 0 10px #f59e0b' : busy ? '0 0 10px #a78bfa' : '0 0 6px #22c55e',
          transition: 'all 0.3s',
          animation: busy ? 'glow 1.5s ease-in-out infinite' : 'none'
        }} />
      </div>

      {/* Context chip */}
      {activeTab && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>context</span>
          <span style={{ fontSize: 10, color: 'rgba(167,139,250,0.5)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeTab.filePath.split('/').slice(-2).join('/')}
          </span>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Empty state */}
        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 20, textAlign: 'center', padding: '0 8px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>Build anything</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, maxWidth: 220 }}>
                {activeProject
                  ? 'Requests pass through 10 governance layers. You confirm before files are written.'
                  : 'Open a project for full agent mode with file creation.'}
              </div>
            </div>
            {activeProject && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 99, fontSize: 11, color: 'rgba(34,197,94,0.7)' }}>
                <span>●</span>
                <span>Agent mode · confirmation required before write</span>
              </div>
            )}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => { setInput(s); taRef.current?.focus() }}
                  style={{ textAlign: 'left', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 9, cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'inherit', transition: 'all 0.15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.2)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {msgs.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: '88%', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: '14px 14px 4px 14px', padding: '9px 13px', fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
                  {msg.content}
                </div>
              </div>
            )}

            {msg.role === 'assistant' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Score badge */}
                {msg.score !== undefined && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, border: msg.approved ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.3)', background: msg.approved ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', fontSize: 10, fontFamily: 'monospace', width: 'fit-content' }}>
                    <span style={{ color: msg.approved ? '#22c55e' : '#ef4444' }}>{msg.approved ? '✓' : '✗'}</span>
                    <span style={{ color: msg.approved ? '#86efac' : '#fca5a5' }}>{msg.score}/100 · 10 layers · {msg.approved ? 'shipped' : 'blocked'}</span>
                  </div>
                )}

                {/* Activity stream */}
                {msg.activity && <ActivityStream items={msg.activity} />}

                {/* Plain text fallback */}
                {msg.content && <div>{renderMarkdown(msg.content)}</div>}

                {/* Typing indicator */}
                {busy && msg === msgs[msgs.length - 1] && !msg.content && (!msg.activity || msg.activity.length === 0) && (
                  <TypingDots />
                )}
              </div>
            )}

            {msg.role === 'system' && (
              <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', padding: '4px 0' }}>{msg.content}</div>
            )}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ position: 'relative', background: 'rgba(255,255,255,0.04)', border: `1px solid ${busy || confirmReq ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.09)'}`, borderRadius: 12, transition: 'border-color 0.2s' }}>
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            placeholder={activeProject ? 'Build anything — governance runs first, then you confirm…' : 'Ask PLATPHORM...'}
            rows={3}
            disabled={!!confirmReq}
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '11px 13px 34px', fontSize: 13, color: 'rgba(255,255,255,0.8)', resize: 'none', fontFamily: 'Inter, sans-serif', lineHeight: 1.5, opacity: confirmReq ? 0.4 : 1 }}
          />
          <div style={{ position: 'absolute', bottom: 8, left: 12, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', fontFamily: 'monospace' }}>⌘↵</span>
            <button
              onClick={send}
              disabled={!input.trim() || busy || !!confirmReq}
              style={{
                width: 28, height: 28, borderRadius: 8, border: 'none', flexShrink: 0,
                background: input.trim() && !busy && !confirmReq ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.06)',
                cursor: input.trim() && !busy && !confirmReq ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: input.trim() && !busy && !confirmReq ? '0 0 14px rgba(124,58,237,0.4)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              {busy
                ? <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
