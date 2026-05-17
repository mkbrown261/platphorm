import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatCompletionMessageParam } from 'openai/resources'
import { useAIStore } from '../../store/aiStore'
import { useDNAStore } from '../../store/dnaStore'
import { useProjectStore } from '../../store/projectStore'
import { runPipeline } from '../../core/intelligence/Pipeline'
import { runAgent, buildAgentSystemPrompt } from '../../core/intelligence/AgentRunner'
import { orchestrator } from '../../core/providers/AIOrchestrator'
import type { PipelineContext, LayerResult } from '../../types'

// ─── CSS injected once ────────────────────────────────────────────────────────

const GLOBAL_CSS = `
@keyframes spin { to { transform: rotate(360deg) } }
@keyframes blink { 0%,80%,100% { opacity:0.2 } 40% { opacity:1 } }
@keyframes glow { 0%,100% { opacity:0.6 } 50% { opacity:1 } }
@keyframes fadeIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }
@keyframes pulse-ring {
  0%   { transform:scale(0.85); opacity:0.8 }
  50%  { transform:scale(1.1);  opacity:0.4 }
  100% { transform:scale(0.85); opacity:0.8 }
}
@keyframes cursor-blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
`

if (typeof document !== 'undefined' && !document.getElementById('platphorm-ai-css')) {
  const s = document.createElement('style')
  s.id = 'platphorm-ai-css'
  s.textContent = GLOBAL_CSS
  document.head.appendChild(s)
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityItem =
  | { kind: 'stream'; text: string; done: boolean }           // streaming text with cursor
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

/** Confirmation dialog state — holds Promise resolver until user acts */
interface ConfirmPending {
  score: number
  warnings: string[]
  resolve: (confirmed: boolean) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYER_LABELS = [
  '01 · Intent', '02 · Architecture', '03 · Security', '04 · Dependencies',
  '05 · Performance', '06 · Continuity', '07 · Validation',
  '08 · Execution', '09 · Observability', '10 · Self-Critique'
]

const SUGGESTIONS = [
  'Build a REST API with auth',
  'Add a database model for users',
  'Create a React component',
  'Refactor for better performance',
  'Review this file for security issues',
  'Add error handling and logging',
]

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Inline text cursor shown while streaming */
function StreamCursor() {
  return (
    <span style={{
      display: 'inline-block', width: 2, height: '1em',
      background: '#a78bfa', marginLeft: 1, verticalAlign: 'text-bottom',
      animation: 'cursor-blink 0.9s ease-in-out infinite'
    }} />
  )
}

/** Streaming or completed text block */
function StreamBlock({ item }: { item: Extract<ActivityItem, { kind: 'stream' }> }) {
  return (
    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', lineHeight: 1.7, whiteSpace: 'pre-wrap', animation: 'fadeIn 0.15s ease' }}>
      {renderMarkdown(item.text)}
      {!item.done && <StreamCursor />}
    </div>
  )
}

/** Pulsing orb + label shown at the very start before first token */
function ThinkingOrb() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <div style={{ position: 'relative', width: 24, height: 24, flexShrink: 0 }}>
        {/* Outer ring */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: '1.5px solid rgba(167,139,250,0.25)',
          animation: 'pulse-ring 2s ease-in-out infinite'
        }} />
        {/* Inner orb */}
        <div style={{
          position: 'absolute', inset: 4, borderRadius: '50%',
          background: 'radial-gradient(circle, #a78bfa 0%, #7c3aed 100%)',
          boxShadow: '0 0 10px rgba(167,139,250,0.6)',
          animation: 'glow 2s ease-in-out infinite'
        }} />
      </div>
      <span style={{ fontSize: 11, color: 'rgba(167,139,250,0.6)', fontStyle: 'italic', letterSpacing: 0.5 }}>
        thinking...
      </span>
    </div>
  )
}

function ToolCard({ item }: { item: Extract<ActivityItem, { kind: 'tool' }> }) {
  const running = item.status === 'running'
  const ok = item.status === 'done'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 12px', borderRadius: 8,
      background: running ? 'rgba(124,58,237,0.08)' : ok ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.06)',
      border: `1px solid ${running ? 'rgba(124,58,237,0.2)' : ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.2)'}`,
      transition: 'all 0.25s', animation: 'fadeIn 0.15s ease'
    }}>
      <span style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0, color: running ? '#a78bfa' : ok ? '#4ade80' : '#f87171', fontFamily: 'monospace' }}>
        {item.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 600 }}>{item.label}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', flex: 1 }}>{item.detail}</span>
        </div>
        {item.summary && (
          <div style={{ fontSize: 10, color: ok ? 'rgba(74,222,128,0.65)' : 'rgba(248,113,113,0.65)', marginTop: 2 }}>{item.summary}</div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>
        {running
          ? <div style={{ width: 13, height: 13, border: '2px solid rgba(167,139,250,0.2)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          : ok
            ? <span style={{ fontSize: 11, color: '#4ade80' }}>✓</span>
            : <span style={{ fontSize: 11, color: '#f87171' }}>✗</span>
        }
      </div>
    </div>
  )
}

function PipelineCard({ item }: { item: Extract<ActivityItem, { kind: 'pipeline' }> }) {
  const running = item.status === 'running'
  const done    = item.status === 'done'
  const warned  = item.status === 'warned'
  const dotColor  = running ? '#a78bfa' : done ? '#22c55e' : warned ? '#f59e0b' : '#ef4444'
  const textColor = running ? 'rgba(167,139,250,0.9)' : done ? 'rgba(34,197,94,0.8)' : warned ? 'rgba(245,158,11,0.8)' : 'rgba(239,68,68,0.8)'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '6px 12px', borderRadius: 8,
      background: running ? 'rgba(124,58,237,0.05)' : 'transparent',
      borderLeft: `2px solid ${dotColor}`,
      transition: 'all 0.25s', animation: 'fadeIn 0.15s ease'
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: textColor, fontFamily: 'monospace', fontWeight: 700 }}>{item.label}</span>
          {running
            ? <div style={{ width: 10, height: 10, border: '1.5px solid rgba(167,139,250,0.25)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
            : <span style={{ fontSize: 10, color: textColor }}>{done ? '✓' : warned ? '⚠' : '✗'}</span>
          }
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 2, lineHeight: 1.4 }}>{item.description}</div>
      </div>
    </div>
  )
}

function CutoffBanner({ loops }: { loops: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 12px', borderRadius: 8,
      background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.22)',
      animation: 'fadeIn 0.2s ease'
    }}>
      <span style={{ fontSize: 13, flexShrink: 0 }}>⚠</span>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(245,158,11,0.9)', fontFamily: 'monospace' }}>
          Agent reached {loops}-step limit
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, lineHeight: 1.5 }}>
          The task may be partially complete. Review the files created so far and re-submit with a more focused prompt to continue.
        </div>
      </div>
    </div>
  )
}

function ActivityStream({ items, isLastMsg, busy }: { items: ActivityItem[]; isLastMsg: boolean; busy: boolean }) {
  if (!items.length) {
    // Show orb while waiting for first token
    if (isLastMsg && busy) return <ThinkingOrb />
    return null
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {items.map((item, i) => {
        if (item.kind === 'stream')    return <StreamBlock key={i} item={item} />
        if (item.kind === 'tool')      return <ToolCard key={item.id} item={item} />
        if (item.kind === 'pipeline')  return <PipelineCard key={item.index} item={item} />
        if (item.kind === 'cutoff')    return <CutoffBanner key={i} loops={item.loops} />
        return null
      })}
    </div>
  )
}

/**
 * FIX 10: Confirmation dialog — Promise-based overlay.
 * Pauses withPipeline until the user explicitly confirms or cancels.
 */
function ConfirmDialog({ pending, onDecide }: { pending: ConfirmPending; onDecide: (v: boolean) => void }) {
  const scoreColor = pending.score >= 90 ? '#22c55e' : pending.score >= 70 ? '#f59e0b' : '#ef4444'
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(8,9,15,0.88)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      animation: 'fadeIn 0.2s ease'
    }}>
      <div style={{
        width: '100%', maxWidth: 300, background: '#0f1020',
        border: '1px solid rgba(124,58,237,0.3)', borderRadius: 14, padding: 20,
        boxShadow: '0 0 40px rgba(124,58,237,0.2)', display: 'flex', flexDirection: 'column', gap: 14
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Governance passed</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Agent is ready to write files</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: scoreColor, fontFamily: 'monospace', lineHeight: 1 }}>{pending.score}</div>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>/100 governance score</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>10 layers · all checks complete</div>
          </div>
        </div>

        {pending.warnings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 10, color: 'rgba(245,158,11,0.7)', fontWeight: 600, marginBottom: 2 }}>
              ⚠ {pending.warnings.length} warning{pending.warnings.length !== 1 ? 's' : ''} noted
            </div>
            {pending.warnings.slice(0, 3).map((w, i) => (
              <div key={i} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', lineHeight: 1.4, paddingLeft: 8, borderLeft: '2px solid rgba(245,158,11,0.3)' }}>{w}</div>
            ))}
            {pending.warnings.length > 3 && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', paddingLeft: 8 }}>+{pending.warnings.length - 3} more</div>
            )}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, padding: '8px 10px', background: 'rgba(124,58,237,0.05)', borderRadius: 8, border: '1px solid rgba(124,58,237,0.1)' }}>
          The agent will <strong style={{ color: 'rgba(167,139,250,0.8)' }}>create or modify files on disk</strong>. This cannot be automatically undone.
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onDecide(false)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as any).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as any).style.color = 'rgba(255,255,255,0.75)' }}
            onMouseLeave={e => { (e.currentTarget as any).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as any).style.color = 'rgba(255,255,255,0.5)' }}>
            Cancel
          </button>
          <button onClick={() => onDecide(true)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: 'white', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, boxShadow: '0 0 16px rgba(124,58,237,0.35)', transition: 'all 0.15s' }}
            onMouseEnter={e => { (e.currentTarget as any).style.boxShadow = '0 0 24px rgba(124,58,237,0.55)' }}
            onMouseLeave={e => { (e.currentTarget as any).style.boxShadow = '0 0 16px rgba(124,58,237,0.35)' }}>
            Confirm &amp; Build
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text: string) {
  // Split on code fences first
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((p, i) => {
    if (p.startsWith('```')) {
      const lines = p.slice(3, -3).split('\n')
      const lang = lines[0].trim()
      const code = lines.slice(1).join('\n').trim()
      return (
        <div key={i} style={{ marginTop: 8, marginBottom: 4, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 12px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{lang || 'code'}</span>
            <button onClick={() => navigator.clipboard.writeText(code)} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, transition: 'color 0.1s' }}
              onMouseEnter={e => (e.currentTarget as any).style.color = 'rgba(255,255,255,0.7)'}
              onMouseLeave={e => (e.currentTarget as any).style.color = 'rgba(255,255,255,0.3)'}>
              copy
            </button>
          </div>
          <pre style={{ margin: 0, padding: '10px 14px', fontSize: 12, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: 'rgba(255,255,255,0.78)', overflowX: 'auto', background: 'rgba(0,0,0,0.35)', lineHeight: 1.75 }}>
            <code>{code}</code>
          </pre>
        </div>
      )
    }
    if (!p.trim()) return null
    // Inline bold **text**
    const rendered = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    return <p key={i} dangerouslySetInnerHTML={{ __html: rendered }} style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.7, color: 'rgba(255,255,255,0.78)', whiteSpace: 'pre-wrap' }} />
  })
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AIPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmPending, setConfirmPending] = useState<ConfirmPending | null>(null)

  // Conversation history for multi-turn memory (what gets sent back to the model)
  const historyRef = useRef<ChatCompletionMessageParam[]>([])

  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef     = useRef<HTMLTextAreaElement>(null)

  const { settings, startPipeline, updateLayerProgress, completePipeline, pipelineRunning } = useAIStore()
  const { dna }    = useDNAStore()
  const { activeProject, openTabs, activeTabId } = useProjectStore()
  const activeTab  = openTabs.find(t => t.id === activeTabId)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const newId = () => `m${Date.now()}${Math.random().toString(36).slice(2)}`

  // ── Activity helpers ──────────────────────────────────────────────────────

  const pushActivity = useCallback((msgId: string, item: ActivityItem) => {
    setMsgs(prev => prev.map(m => {
      if (m.id !== msgId) return m
      const activity = m.activity ?? []
      if (item.kind === 'pipeline') {
        const idx = activity.findIndex(a => a.kind === 'pipeline' && a.index === item.index)
        if (idx >= 0) { const next = [...activity]; next[idx] = item; return { ...m, activity: next } }
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

  /** Append a token to the current streaming activity item, or create one */
  const appendStreamToken = useCallback((msgId: string, token: string) => {
    setMsgs(prev => prev.map(m => {
      if (m.id !== msgId) return m
      const activity = m.activity ?? []
      const lastIdx  = activity.length - 1
      const last     = activity[lastIdx]
      if (last && last.kind === 'stream' && !last.done) {
        const next = [...activity]
        next[lastIdx] = { ...last, text: last.text + token }
        return { ...m, activity: next }
      }
      return { ...m, activity: [...activity, { kind: 'stream', text: token, done: false }] }
    }))
  }, [])

  /** Mark the current streaming block as done (removes cursor) */
  const finalizeStream = useCallback((msgId: string) => {
    setMsgs(prev => prev.map(m => {
      if (m.id !== msgId) return m
      const activity = (m.activity ?? []).map(a =>
        a.kind === 'stream' && !a.done ? { ...a, done: true } : a
      )
      return { ...m, activity }
    }))
  }, [])

  // ── Confirmation dialog ───────────────────────────────────────────────────

  const waitForConfirmation = useCallback((score: number, warnings: string[]): Promise<boolean> => {
    return new Promise<boolean>(resolve => setConfirmPending({ score, warnings, resolve }))
  }, [])

  const handleConfirmDecision = useCallback((confirmed: boolean) => {
    if (!confirmPending) return
    confirmPending.resolve(confirmed)
    setConfirmPending(null)
  }, [confirmPending])

  // ── Send ──────────────────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)

    setMsgs(p => [...p, { id: newId(), role: 'user', content: text }])

    if (!orchestrator.hasProviders()) {
      setMsgs(p => [...p, { id: newId(), role: 'system', content: 'Add an API key in Settings (⌘,) to get started.' }])
      setBusy(false)
      return
    }

    activeProject ? await withPipeline(text) : await withAgent(text)
    setBusy(false)
  }, [input, busy, activeProject, dna, activeTab, settings])

  // ── Agent mode (no project open) ─────────────────────────────────────────

  const withAgent = async (prompt: string) => {
    const msgId = newId()
    setMsgs(p => [...p, { id: msgId, role: 'assistant', activity: [] }])

    const sys = buildAgentSystemPrompt({
      systemName: dna?.identity?.systemName,
      corePurpose: dna?.identity?.corePurpose,
      systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? []
    })

    const fullPrompt = activeTab ? `[Context file: ${activeTab.filePath}]\n\n${prompt}` : prompt
    let assistantText = ''

    try {
      for await (const event of runAgent(fullPrompt, sys, historyRef.current)) {
        if (event.type === 'thinking_start') {
          // ThinkingOrb shows automatically via empty activity + busy
        } else if (event.type === 'stream_token') {
          assistantText += event.token
          appendStreamToken(msgId, event.token)
        } else if (event.type === 'thinking_done') {
          finalizeStream(msgId)
        } else if (event.type === 'tool_start') {
          pushActivity(msgId, { kind: 'tool', id: event.id, icon: event.icon, label: event.label, detail: event.detail, status: 'running' })
        } else if (event.type === 'tool_done') {
          patchTool(msgId, event.id, event.success ? 'done' : 'error', event.summary)
        } else if (event.type === 'cutoff') {
          pushActivity(msgId, { kind: 'cutoff', loops: event.loops })
        } else if (event.type === 'error') {
          finalizeStream(msgId)
          setMsgs(p => p.map(m => m.id === msgId ? { ...m, content: `Error: ${event.message}` } : m))
        }
      }
    } catch (err) {
      finalizeStream(msgId)
      setMsgs(p => p.map(m => m.id === msgId ? { ...m, content: `Error: ${String(err)}` } : m))
    }

    // Append to conversation history for next turn
    if (assistantText) {
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: fullPrompt },
        { role: 'assistant', content: assistantText }
      ]
      // Keep history from growing unbounded — last 20 messages (10 turns)
      if (historyRef.current.length > 20) {
        historyRef.current = historyRef.current.slice(-20)
      }
    }
  }

  // ── Pipeline mode (project open) ─────────────────────────────────────────

  const withPipeline = async (prompt: string) => {
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
          pushActivity(msgId, { kind: 'pipeline', index, label, description, status: 'running' })
        } else {
          const status = layerResult.status === 'failed' ? 'failed'
            : layerResult.findings.some(f => f.severity === 'high') ? 'warned'
            : 'done'
          pushActivity(msgId, { kind: 'pipeline', index, label, description, status })
        }
      })

      completePipeline(result)

      if (result.approved) {
        // Collect warnings for confirm dialog
        const warnings = result.layers.flatMap(l => l.findings)
          .filter(f => f.severity === 'high' || f.severity === 'critical')
          .map(f => f.message).slice(0, 10)

        const confirmed = await waitForConfirmation(result.overallScore, warnings)

        if (!confirmed) {
          pushActivity(msgId, { kind: 'stream', text: 'Build cancelled.', done: true })
          setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: false } : m))
          return
        }

        // Build a conversation summary for agent context
        const conversationSummary = historyRef.current.length > 0
          ? historyRef.current
              .filter(m => m.role === 'user')
              .map(m => `User: ${String(m.content).slice(0, 200)}`)
              .join('\n')
          : undefined

        const sys = buildAgentSystemPrompt({
          projectPath: activeProject!.rootPath,
          systemName: dna?.identity?.systemName,
          corePurpose: dna?.identity?.corePurpose,
          systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
          forbiddenPatterns: dna?.forbiddenPatterns ?? [],
          conversationSummary
        })

        let assistantText = ''

        for await (const event of runAgent(prompt, sys, historyRef.current)) {
          if (event.type === 'stream_token') {
            assistantText += event.token
            appendStreamToken(msgId, event.token)
          } else if (event.type === 'thinking_done') {
            finalizeStream(msgId)
          } else if (event.type === 'tool_start') {
            pushActivity(msgId, { kind: 'tool', id: event.id, icon: event.icon, label: event.label, detail: event.detail, status: 'running' })
          } else if (event.type === 'tool_done') {
            patchTool(msgId, event.id, event.success ? 'done' : 'error', event.summary)
          } else if (event.type === 'cutoff') {
            pushActivity(msgId, { kind: 'cutoff', loops: event.loops })
          } else if (event.type === 'error') {
            finalizeStream(msgId)
            pushActivity(msgId, { kind: 'stream', text: `Agent error: ${event.message}`, done: true })
          }
        }

        // Thread into history
        if (assistantText) {
          historyRef.current = [
            ...historyRef.current,
            { role: 'user', content: prompt },
            { role: 'assistant', content: assistantText }
          ]
          if (historyRef.current.length > 20) historyRef.current = historyRef.current.slice(-20)
        }

        setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: true } : m))
      } else {
        const blockText = `Blocked by governance (${result.overallScore}/100):\n${result.blockers.map(b => `• ${b.message}`).join('\n')}`
        pushActivity(msgId, { kind: 'stream', text: blockText, done: true })
        setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: false } : m))
      }
    } catch (err) {
      setMsgs(p => p.map(m => m.id === msgId ? { ...m, content: `Pipeline error: ${String(err)}` } : m))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isLastMsgAssistant = msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant'

  return (
    <div style={{ width: 340, flexShrink: 0, background: '#090a11', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {confirmPending && <ConfirmDialog pending={confirmPending} onDecide={handleConfirmDecision} />}

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, background: 'linear-gradient(135deg, rgba(124,58,237,0.5), rgba(79,70,229,0.4))', border: '1px solid rgba(124,58,237,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: busy ? '0 0 20px rgba(124,58,237,0.55)' : 'none', transition: 'box-shadow 0.4s' }}>
          <span style={{ fontSize: 14, fontWeight: 800, background: 'linear-gradient(135deg, #c4b5fd, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>P</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>PLATPHORM AI</div>
          <div style={{ fontSize: 10, color: confirmPending ? '#f59e0b' : busy ? '#a78bfa' : '#22c55e', transition: 'color 0.3s' }}>
            {confirmPending ? 'Awaiting your confirmation...'
              : busy ? (activeProject ? 'Running governance pipeline...' : 'Working...')
              : (dna ? dna.identity?.systemName : 'Ready')}
          </div>
        </div>
        {/* Status dot */}
        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: confirmPending ? '#f59e0b' : busy ? '#a78bfa' : '#22c55e', boxShadow: `0 0 ${busy || confirmPending ? 10 : 6}px ${confirmPending ? '#f59e0b' : busy ? '#a78bfa' : '#22c55e'}`, transition: 'all 0.3s', animation: busy && !confirmPending ? 'glow 1.5s ease-in-out infinite' : 'none' }} />
      </div>

      {/* Context chip */}
      {activeTab && (
        <div style={{ padding: '5px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace' }}>context</span>
          <span style={{ fontSize: 10, color: 'rgba(167,139,250,0.45)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeTab.filePath.split('/').slice(-2).join('/')}
          </span>
        </div>
      )}

      {/* History clear button — only shown when there's history */}
      {historyRef.current.length > 0 && !busy && (
        <div style={{ padding: '4px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button
            onClick={() => { historyRef.current = []; setMsgs([]) }}
            style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', padding: '2px 4px', transition: 'color 0.1s' }}
            onMouseEnter={e => (e.currentTarget as any).style.color = 'rgba(255,255,255,0.45)'}
            onMouseLeave={e => (e.currentTarget as any).style.color = 'rgba(255,255,255,0.18)'}
          >
            clear conversation
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Empty state */}
        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 20, textAlign: 'center', padding: '0 8px' }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.72)', marginBottom: 6 }}>Build anything</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.22)', lineHeight: 1.65, maxWidth: 230 }}>
                {activeProject
                  ? 'Requests pass through 10 governance layers, then I build directly in your project.'
                  : 'Open a project to unlock full agent mode with file creation.'}
              </div>
            </div>
            {activeProject && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.13)', borderRadius: 99, fontSize: 11, color: 'rgba(34,197,94,0.65)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 6px #22c55e' }} />
                Agent mode · files will be created
              </div>
            )}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => { setInput(s); taRef.current?.focus() }}
                  style={{ textAlign: 'left', padding: '8px 12px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 9, cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.38)', fontFamily: 'inherit', transition: 'all 0.15s' }}
                  onMouseEnter={e => { (e.currentTarget as any).style.background = 'rgba(124,58,237,0.08)'; (e.currentTarget as any).style.borderColor = 'rgba(124,58,237,0.2)'; (e.currentTarget as any).style.color = 'rgba(255,255,255,0.72)' }}
                  onMouseLeave={e => { (e.currentTarget as any).style.background = 'rgba(255,255,255,0.025)'; (e.currentTarget as any).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as any).style.color = 'rgba(255,255,255,0.38)' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {msgs.map((msg, msgIdx) => (
          <div key={msg.id} style={{ animation: 'fadeIn 0.2s ease' }}>
            {msg.role === 'user' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: '88%', background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.22)', borderRadius: '14px 14px 4px 14px', padding: '9px 13px', fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.55 }}>
                  {msg.content}
                </div>
              </div>
            )}

            {msg.role === 'assistant' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Score badge */}
                {msg.score !== undefined && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, border: msg.approved ? '1px solid rgba(34,197,94,0.28)' : '1px solid rgba(239,68,68,0.28)', background: msg.approved ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)', fontSize: 10, fontFamily: 'monospace', width: 'fit-content' }}>
                    <span style={{ color: msg.approved ? '#22c55e' : '#ef4444' }}>{msg.approved ? '✓' : '✗'}</span>
                    <span style={{ color: msg.approved ? '#86efac' : '#fca5a5' }}>{msg.score}/100 · 10 layers · {msg.approved ? 'shipped' : 'blocked'}</span>
                  </div>
                )}

                {/* Activity stream */}
                {msg.activity !== undefined && (
                  <ActivityStream
                    items={msg.activity}
                    isLastMsg={msgIdx === msgs.length - 1}
                    busy={busy}
                  />
                )}

                {/* Plain text fallback (error messages, etc.) */}
                {msg.content && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.65 }}>{msg.content}</div>}
              </div>
            )}

            {msg.role === 'system' && (
              <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.18)', padding: '4px 0' }}>{msg.content}</div>
            )}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ position: 'relative', background: 'rgba(255,255,255,0.04)', border: `1px solid ${busy ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.09)'}`, borderRadius: 12, transition: 'border-color 0.2s' }}>
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
            }}
            placeholder={activeProject ? 'Build anything — governance runs automatically...' : 'Ask PLATPHORM anything...'}
            rows={3}
            disabled={busy || !!confirmPending}
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '11px 13px 36px', fontSize: 13, color: 'rgba(255,255,255,0.82)', resize: 'none', fontFamily: 'Inter, -apple-system, sans-serif', lineHeight: 1.55, opacity: busy || confirmPending ? 0.5 : 1 }}
          />
          <div style={{ position: 'absolute', bottom: 8, left: 12, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.1)', fontFamily: 'monospace' }}>⌘↵ send</span>
            <button
              onClick={send}
              disabled={!input.trim() || busy || !!confirmPending}
              style={{
                width: 28, height: 28, borderRadius: 8, border: 'none', flexShrink: 0,
                background: input.trim() && !busy && !confirmPending ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.06)',
                cursor: input.trim() && !busy && !confirmPending ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: input.trim() && !busy && !confirmPending ? '0 0 14px rgba(124,58,237,0.4)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              {busy
                ? <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.25)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
