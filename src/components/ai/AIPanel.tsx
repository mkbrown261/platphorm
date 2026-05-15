import { useState, useRef, useEffect, useCallback } from 'react'
import { useAIStore } from '../../store/aiStore'
import { useDNAStore } from '../../store/dnaStore'
import { useProjectStore } from '../../store/projectStore'
import { orchestrator } from '../../core/providers/AIOrchestrator'
import { runPipeline } from '../../core/intelligence/Pipeline'
import type { PipelineContext, LayerResult } from '../../types'

type Role = 'user' | 'assistant' | 'system'
interface Msg { id: string; role: Role; content: string; score?: number; approved?: boolean }

const LAYERS = ['Intent','Arch','Security','Deps','Perf','Continuity','Validation','Exec','Observe','Critique']

const SUGGESTIONS = [
  'Build a REST API with auth',
  'Add a database model',
  'Create a React component',
  'Fix security vulnerabilities',
  'Optimize performance'
]

function renderContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((p, i) => {
    if (p.startsWith('```')) {
      const lines = p.slice(3, -3).split('\n')
      const lang = lines[0].trim()
      const code = lines.slice(1).join('\n').trim()
      return (
        <div key={i} style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{lang || 'code'}</span>
            <button onClick={() => navigator.clipboard.writeText(code)} style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace' }}>copy</button>
          </div>
          <pre style={{ margin: 0, padding: '12px 14px', fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.75)', overflowX: 'auto', background: 'rgba(0,0,0,0.3)', lineHeight: 1.7 }}>
            <code>{code}</code>
          </pre>
        </div>
      )
    }
    if (!p.trim()) return null
    return <p key={i} style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.65, color: 'rgba(255,255,255,0.75)', whiteSpace: 'pre-wrap' }}>{p}</p>
  })
}

export function AIPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [layerIdx, setLayerIdx] = useState(-1)
  const [doneLayers, setDoneLayers] = useState<LayerResult[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const { settings, pipelineRunning, startPipeline, updateLayerProgress, completePipeline } = useAIStore()
  const { dna } = useDNAStore()
  const { activeProject, openTabs, activeTabId } = useProjectStore()
  const activeTab = openTabs.find(t => t.id === activeTabId)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, layerIdx])

  const push = (m: Omit<Msg, 'id'>) => setMsgs(p => [...p, { ...m, id: `m${Date.now()}${Math.random()}` }])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming || pipelineRunning) return
    setInput('')
    push({ role: 'user', content: text })

    if (!orchestrator.hasProviders()) {
      push({ role: 'system', content: 'Add an API key in Settings (⌘,) to get started.' })
      return
    }

    activeProject ? await withPipeline(text) : await direct(text)
  }, [input, streaming, pipelineRunning, activeProject, dna, activeTab])

  const direct = async (prompt: string) => {
    setStreaming(true)
    const id = `m${Date.now()}`
    setMsgs(p => [...p, { id, role: 'assistant', content: '' }])
    try {
      const sys = dna
        ? `You are PLATPHORM, an AI engineering OS. Project: ${dna.identity.systemName}. ${dna.identity.corePurpose}. Respect all system laws.`
        : 'You are PLATPHORM, an AI-native engineering OS. Always write production-quality, architecturally sound, secure code.'
      for await (const chunk of orchestrator.streamOrchestrate({ prompt: activeTab ? `File: ${activeTab.filePath}\n\n${prompt}` : prompt, role: 'general', options: { systemPrompt: sys } })) {
        setMsgs(p => p.map(m => m.id === id ? { ...m, content: m.content + chunk.content } : m))
      }
    } catch (err) {
      setMsgs(p => p.map(m => m.id === id ? { ...m, content: `Error: ${String(err)}` } : m))
    }
    setStreaming(false)
  }

  const withPipeline = async (prompt: string) => {
    startPipeline(); setLayerIdx(0); setDoneLayers([])
    const ctx: PipelineContext = {
      projectPath: activeProject!.rootPath, userPrompt: prompt,
      selectedCode: activeTab?.content?.slice(0, 4000), activeFile: activeTab?.filePath,
      projectDNAAvailable: !!dna, architectureDoc: undefined,
      systemLaws: dna?.systemLaws.map((l: any) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? [],
      lockedSystems: dna?.lockedSystems.map((s: any) => s.name) ?? [],
      relevantRegistries: ''
    }
    const id = `m${Date.now()}`
    setMsgs(p => [...p, { id, role: 'assistant', content: '' }])
    try {
      const result = await runPipeline(ctx, (idx, name, lr) => {
        setLayerIdx(idx)
        updateLayerProgress(idx, name, lr)
        if (lr) setDoneLayers(p => [...p, lr])
      })
      completePipeline(result)
      setLayerIdx(10)

      const generated = result.executionPlan?.changes?.filter(c => c.after).map(c => c.after!).join('\n\n') ?? ''
      let reply = result.approved
        ? `${result.overallScore}/100 — all checks passed.\n\n${generated || 'Implementation plan validated and ready to apply.'}`
        : `${result.blockers.length} issue(s) found:\n\n${result.blockers.map(b => `• ${b.message}`).join('\n')}`

      setMsgs(p => p.map(m => m.id === id ? { ...m, content: reply, score: result.overallScore, approved: result.approved } : m))
    } catch (err) {
      setMsgs(p => p.map(m => m.id === id ? { ...m, content: `Pipeline error: ${String(err)}` } : m))
    }
    setLayerIdx(-1); setDoneLayers([])
  }

  const busy = streaming || pipelineRunning

  return (
    <div style={{ width: 320, flexShrink: 0, background: '#090a11', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, rgba(124,58,237,0.4), rgba(79,70,229,0.3))', border: '1px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: busy ? '0 0 12px rgba(124,58,237,0.4)' : 'none', transition: 'box-shadow 0.3s' }}>
          <span style={{ fontSize: 13, fontWeight: 800, background: 'linear-gradient(135deg, #c4b5fd, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>P</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>PLATPHORM AI</div>
          <div style={{ fontSize: 10, color: busy ? '#a78bfa' : dna ? '#22c55e' : 'rgba(255,255,255,0.2)' }}>
            {busy ? 'Analyzing...' : dna ? dna.identity.systemName : 'Ready'}
          </div>
        </div>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: busy ? '#a78bfa' : '#22c55e', transition: 'background 0.3s', boxShadow: busy ? '0 0 8px #a78bfa' : '0 0 6px #22c55e' }} />
      </div>

      {/* Pipeline bar */}
      {pipelineRunning && layerIdx >= 0 && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(124,58,237,0.04)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
            {LAYERS.map((name, i) => {
              const done = doneLayers[i]
              const active = i === layerIdx && !done
              let bg = 'rgba(255,255,255,0.08)'
              if (done) bg = done.status === 'passed' ? '#22c55e' : done.status === 'failed' ? '#ef4444' : '#f59e0b'
              if (active) bg = '#a78bfa'
              return <div key={name} title={name} style={{ flex: 1, height: 3, borderRadius: 99, background: bg, transition: 'background 0.3s', opacity: active ? 1 : 0.8 }} />
            })}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
            {layerIdx < 10 ? `${String(layerIdx+1).padStart(2,'0')} · ${LAYERS[layerIdx]}` : 'Complete'}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 20, textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>Build anything</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, maxWidth: 220 }}>
                {activeProject ? 'Every request is governed by your project DNA.' : 'Open a project to enable full governance mode.'}
              </div>
            </div>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => { setInput(s); taRef.current?.focus() }}
                  style={{ textAlign: 'left', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.4)', transition: 'all 0.15s', fontFamily: 'inherit' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.25)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: '85%', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: '16px 16px 4px 16px', padding: '10px 14px', fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
                  {msg.content}
                </div>
              </div>
            )}
            {msg.role === 'assistant' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {msg.score !== undefined && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, border: msg.approved ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.3)', background: msg.approved ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', fontSize: 10, fontFamily: 'monospace', width: 'fit-content' }}>
                    <span style={{ color: msg.approved ? '#22c55e' : '#ef4444' }}>{msg.approved ? '✓' : '✗'}</span>
                    <span style={{ color: msg.approved ? '#86efac' : '#fca5a5' }}>{msg.score}/100 · 10 layers</span>
                  </div>
                )}
                <div>{renderContent(msg.content)}</div>
                {busy && msg === msgs[msgs.length - 1] && !msg.content && (
                  <div style={{ display: 'flex', gap: 3, padding: '8px 0' }}>
                    {[0,1,2].map(i => <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#7c3aed', display: 'block', animation: `blink 1.2s ${i*0.2}s ease-in-out infinite` }} />)}
                  </div>
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
        <div style={{ position: 'relative', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, transition: 'border-color 0.2s' }}
          onFocus={() => {}} >
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            placeholder={activeProject ? 'Build anything...' : 'Ask PLATPHORM...'}
            rows={3}
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '12px 14px 36px', fontSize: 13, color: 'rgba(255,255,255,0.8)', resize: 'none', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}
          />
          <div style={{ position: 'absolute', bottom: 8, left: 12, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace' }}>⌘↵ send</span>
            <button
              onClick={send}
              disabled={!input.trim() || busy}
              style={{
                width: 28, height: 28, borderRadius: 8,
                background: input.trim() && !busy ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.06)',
                border: 'none', cursor: input.trim() && !busy ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: input.trim() && !busy ? '0 0 12px rgba(124,58,237,0.4)' : 'none',
                transition: 'all 0.2s', flexShrink: 0
              }}
            >
              {busy ? (
                <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
