import { useState, useRef, useEffect, useCallback } from 'react'
import { useAIStore } from '../../store/aiStore'
import { useDNAStore } from '../../store/dnaStore'
import { useProjectStore } from '../../store/projectStore'
import { useGovernanceStore } from '../../store/governanceStore'
import { useModelStore } from '../../store/modelStore'
import { runPipeline } from '../../core/intelligence/Pipeline'
import { runAgent, buildAgentSystemPrompt } from '../../core/intelligence/AgentRunner'
import { orchestrator, setSessionModelOverride, setIdentityContext } from '../../core/providers/AIOrchestrator'
import { runAutoRefactor, hasAutoFixableFindings, describeAutoRefactorScope, type RefactorResult, type RefactorProgressEvent } from '../../core/intelligence/AutoRefactor'
import { ApplyChangesModal } from '../pipeline/ApplyChangesModal'
import { FindingsPanel } from '../pipeline/FindingsPanel'
import { PreviewButton } from '../preview/PreviewPanel'
import type { PreviewContent } from '../preview/PreviewPanel'
import type { PipelineContext, LayerResult, PipelineResult, ExecutionPlan, ModelRole } from '../../types'

// ─── Types ───────────────────────────────────────────────────────────────────

type ActivityItem =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; icon: string; label: string; detail: string; status: 'running' | 'done' | 'error'; summary?: string }
  | { kind: 'pipeline'; index: number; label: string; description: string; status: 'running' | 'done' | 'warned' | 'failed' }

interface Msg {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  activity?: ActivityItem[]
  score?: number
  approved?: boolean
  pipelineResult?: PipelineResult
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
        return null
      })}
    </div>
  )
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '6px 0', alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'rgba(167,139,250,0.5)', marginRight: 4, fontStyle: 'italic' }}>PLATPHORM is thinking</span>
      {[0, 1, 2].map(i => (
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
  const [pendingPlan, setPendingPlan] = useState<{ plan: ExecutionPlan; result?: PipelineResult | any } | null>(null)
  const [viewingResult, setViewingResult] = useState<PipelineResult | null>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [refactoringMsgId, setRefactoringMsgId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const { settings, startPipeline, updateLayerProgress, completePipeline, pipelineRunning } = useAIStore()
  const { dna } = useDNAStore()
  const { activeProject, openTabs, activeTabId, refreshFileTree } = useProjectStore()
  const { appendAudit } = useGovernanceStore()
  const { sessionModel, sessionRole, setSessionModel, setSessionRole, availableModels, roleModels } = useModelStore()
  const activeTab = openTabs.find(t => t.id === activeTabId)

  // Sync session model override into orchestrator whenever it changes
  useEffect(() => { setSessionModelOverride(sessionModel) }, [sessionModel])

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

  const patchTool = useCallback((msgId: string, id: string, status: 'running' | 'done' | 'error', summary: string) => {
    setMsgs(prev => prev.map(m => {
      if (m.id !== msgId || !m.activity) return m
      return { ...m, activity: m.activity.map(a => a.kind === 'tool' && a.id === id ? { ...a, status, summary } : a) }
    }))
  }, [])

  const push = (m: Omit<Msg, 'id'>) =>
    setMsgs(p => [...p, { ...m, id: `m${Date.now()}${Math.random()}` }])

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
      projectPath: activeProject?.rootPath,
      systemName: dna?.identity?.systemName,
      corePurpose: dna?.identity?.corePurpose,
      systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? []
    })

    const fullPrompt = activeTab ? `Context file: ${activeTab.filePath}\n\n${prompt}` : prompt

    try {
      for await (const event of runAgent(fullPrompt, sys, apiKey, activeProject?.rootPath)) {
        if (event.type === 'thinking') {
          pushActivity(msgId, { kind: 'thinking', text: event.text })
        } else if (event.type === 'tool_start') {
          pushActivity(msgId, { kind: 'tool', id: event.id, icon: event.icon, label: event.label, detail: event.detail, status: 'running' })
        } else if (event.type === 'tool_done') {
          patchTool(msgId, event.id, event.success ? 'done' : 'error', event.summary)
          if (event.success && (event.tool === 'write_file' || event.tool === 'create_directory')) refreshFileTree()
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

    // A3 FIX: Read ARCHITECTURE.md and inject into pipeline context
    // Also update the global identity context so the architecture doc is live in every AI call
    let architectureDoc: string | undefined
    if (activeProject) {
      const archPath = `${activeProject.rootPath}/ARCHITECTURE.md`
      const content = await window.api.fs.readFile(archPath)
      architectureDoc = content ?? undefined
      // Refresh identity context with latest architecture doc
      setIdentityContext({ dna, architectureDoc })
    }

    const ctx: PipelineContext & { strictMode?: boolean } = {
      projectPath: activeProject!.rootPath,
      userPrompt: prompt,
      selectedCode: activeTab?.content?.slice(0, 4000),
      activeFile: activeTab?.filePath,
      projectDNAAvailable: !!dna,
      architectureDoc,
      systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? [],
      lockedSystems: dna?.lockedSystems?.map((s: any) => s.name) ?? [],
      relevantRegistries: dna ? buildRegistryContext(dna) : '',
      strictMode: settings.governanceStrictMode
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

      // Log governance audit entry
      appendAudit({
        id: `audit-${Date.now()}`,
        timestamp: Date.now(),
        action: 'pipeline_run',
        actor: 'ai',
        target: prompt.slice(0, 80),
        approved: result.approved,
        pipelineResultId: result.id,
        immutable: true
      })

      // After governance passes, run agent to build the code
      if (result.approved) {
        const planHasContent = result.executionPlan?.changes?.some(c => c.after && c.after.trim().length > 20)
        const planFileCount = result.executionPlan?.changes?.length ?? 0

        if (planHasContent) {
          // Execution layer already generated complete file content — apply directly, no re-generation
          pushActivity(msgId, { kind: 'thinking', text: `✓ Pipeline generated ${planFileCount} file${planFileCount !== 1 ? 's' : ''} · Score ${result.overallScore}/100 · Applying...` })
          setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: true, pipelineResult: result } : m))
          setPendingPlan({ plan: result.executionPlan!, result })
        } else {
          // Execution layer gave a plan but no code — agent uses the plan as its spec
          pushActivity(msgId, { kind: 'thinking', text: `Pipeline passed ${result.overallScore}/100 · Agent building with plan...` })

          // Build an enriched agent prompt that includes the execution plan
          const planContext = result.executionPlan?.changes?.length
            ? `\n\nEXECUTION PLAN (from governance pipeline):\nFiles to create/modify:\n${result.executionPlan.changes.map(c => `  - ${c.type}: ${c.path} — ${c.reason}`).join('\n')}\n\nRisk: ${result.executionPlan.estimatedRisk}\nNotes: ${result.executionPlan.rollbackPlan}`
            : ''

          const sys = buildAgentSystemPrompt({
            projectPath: activeProject!.rootPath,
            systemName: dna?.identity?.systemName,
            corePurpose: dna?.identity?.corePurpose,
            systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
            forbiddenPatterns: dna?.forbiddenPatterns ?? []
          })

          const enrichedPrompt = `${prompt}${planContext}`

          for await (const event of runAgent(enrichedPrompt, sys, apiKey, activeProject?.rootPath)) {
            if (event.type === 'thinking') {
              pushActivity(msgId, { kind: 'thinking', text: event.text })
            } else if (event.type === 'tool_start') {
              pushActivity(msgId, { kind: 'tool', id: event.id, icon: event.icon, label: event.label, detail: event.detail, status: 'running' })
            } else if (event.type === 'tool_done') {
              patchTool(msgId, event.id, event.success ? 'done' : 'error', event.summary)
              if (event.success && (event.tool === 'write_file' || event.tool === 'create_directory')) refreshFileTree()
            } else if (event.type === 'error') {
              pushActivity(msgId, { kind: 'thinking', text: `Agent error: ${event.message}` })
            }
          }

          setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: true, pipelineResult: result } : m))

          // Show apply modal if execution plan has file changes
          if (result.executionPlan?.changes?.length) {
            setPendingPlan({ plan: result.executionPlan, result })
          }
        }
      } else {
        // Blocked — show blockers clearly
        const blockText = result.blockers.map(b => `• ${b.message}`).join('\n')
        pushActivity(msgId, { kind: 'thinking', text: `Governance blocked (${result.overallScore}/100):\n${blockText}` })
        setMsgs(p => p.map(m => m.id === msgId ? { ...m, score: result.overallScore, approved: false, pipelineResult: result } : m))
      }
    } catch (err) {
      setMsgs(p => p.map(m => m.id === msgId ? { ...m, content: `Pipeline error: ${String(err)}` } : m))
    }
  }

  // ─── Auto-Refactor ────────────────────────────────────────────────────────

  const runRefactor = useCallback(async (msgId: string, pipelineResult: PipelineResult) => {
    if (!activeProject || refactoringMsgId) return
    setRefactoringMsgId(msgId)
    setBusy(true)

    const ctx: PipelineContext = {
      projectPath: activeProject.rootPath,
      userPrompt: pipelineResult.context.userPrompt,
      selectedCode: pipelineResult.context.selectedCode,
      activeFile: pipelineResult.context.activeFile,
      projectDNAAvailable: !!dna,
      architectureDoc: pipelineResult.context.architectureDoc,
      systemLaws: dna?.systemLaws?.map((l: any) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? [],
      lockedSystems: dna?.lockedSystems?.map((s: any) => s.name) ?? [],
      relevantRegistries: pipelineResult.context.relevantRegistries ?? ''
    }

    pushActivity(msgId, { kind: 'thinking', text: `Auto-Refactor: ${describeAutoRefactorScope(pipelineResult)}` })

    // Single tool card for the whole refactor run
    pushActivity(msgId, { kind: 'tool', id: `fix-run`, icon: '⚙', label: 'Auto-Fix', detail: `Regenerating ${pipelineResult.blockers.length} blocker${pipelineResult.blockers.length !== 1 ? 's' : ''}...`, status: 'running' })

    const onRefactorProgress = (event: RefactorProgressEvent) => {
      switch (event.type) {
        case 'analyzing':
          pushActivity(msgId, { kind: 'thinking', text: event.message })
          break
        case 'fixing':
          // Update the single tool card detail
          patchTool(msgId, 'fix-run', 'running' as any, event.message.slice(0, 80))
          break
        case 'fix_complete':
          // Handled in 'done'
          break
        case 'done': {
          const r = event.result
          if (r.readyToApply && r.fileChanges.length > 0) {
            patchTool(msgId, 'fix-run', 'done', `✓ Generated ${r.fileChanges.length} file${r.fileChanges.length !== 1 ? 's' : ''} · ${r.overallConfidence}% confidence`)
            const summary = `Auto-Fix complete — ${r.fileChanges.length} file${r.fileChanges.length !== 1 ? 's' : ''} regenerated · ${r.overallConfidence}% confidence · Ready to apply`
            pushActivity(msgId, { kind: 'thinking', text: summary })
            const plan: ExecutionPlan = {
              changes: r.fileChanges,
              estimatedRisk: r.overallConfidence >= 80 ? 'low' : r.overallConfidence >= 60 ? 'medium' : 'high',
              reversible: true,
              rollbackPlan: 'Revert with git before auto-fix was applied',
              affectedServices: [],
              requiresApproval: true
            }
            setPendingPlan({ plan, result: pipelineResult })
          } else {
            patchTool(msgId, 'fix-run', 'error', 'Could not generate fixes — try rephrasing your request')
            pushActivity(msgId, { kind: 'thinking', text: 'Auto-Fix could not produce valid output. Try clicking ⚙ Auto-Fix again, or rephrase your request.' })
          }
          break
        }
        case 'error':
          patchTool(msgId, 'fix-run', 'error', event.message.slice(0, 80))
          pushActivity(msgId, { kind: 'thinking', text: `Auto-Fix error: ${event.message}` })
          break
      }
    }

    try {
      const refactorResult: RefactorResult = await runAutoRefactor(pipelineResult, ctx, dna, onRefactorProgress)
      appendAudit({
        id: `audit-refactor-${Date.now()}`,
        timestamp: Date.now(),
        action: 'auto_refactor',
        actor: 'ai',
        target: `${refactorResult.fixedCount} fixes for: ${pipelineResult.context.userPrompt.slice(0, 60)}`,
        approved: refactorResult.readyToApply,
        pipelineResultId: pipelineResult.id,
        immutable: true
      })
    } catch (err) {
      patchTool(msgId, 'fix-run', 'error', String(err).slice(0, 80))
      pushActivity(msgId, { kind: 'thinking', text: `Auto-Fix failed: ${String(err)}` })
    }

    setRefactoringMsgId(null)
    setBusy(false)
  }, [activeProject, dna, refactoringMsgId, pushActivity, patchTool, appendAudit])

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ width: 340, flexShrink: 0, background: '#090a11', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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
            <div style={{ fontSize: 10, color: busy ? '#a78bfa' : '#22c55e', transition: 'color 0.3s' }}>
              {busy ? (activeProject ? 'Running governance pipeline...' : 'Agent working...') : (dna ? dna.identity?.systemName : 'Ready')}
            </div>
          </div>
          <div style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: busy ? '#a78bfa' : '#22c55e',
            boxShadow: busy ? '0 0 10px #a78bfa' : '0 0 6px #22c55e',
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
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>Build anything</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, maxWidth: 220 }}>
                  {activeProject
                    ? 'Requests pass through 10 governance layers, then I build directly in your project.'
                    : 'Open a project for full agent mode with file creation.'}
                </div>
              </div>
              {activeProject && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 99, fontSize: 11, color: 'rgba(34,197,94,0.7)' }}>
                  <span>●</span>
                  <span>Agent mode · files will be created</span>
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
                  {/* Score badge + action buttons */}
                  {msg.score !== undefined && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, border: msg.approved ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.3)', background: msg.approved ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', fontSize: 10, fontFamily: 'monospace', width: 'fit-content' }}>
                        <span style={{ color: msg.approved ? '#22c55e' : '#ef4444' }}>{msg.approved ? '✓' : '✗'}</span>
                        <span style={{ color: msg.approved ? '#86efac' : '#fca5a5' }}>{msg.score}/100 · 10 layers · {msg.approved ? 'shipped' : 'blocked'}</span>
                      </div>
                      {/* View findings button */}
                      {msg.pipelineResult && (
                        <button
                          onClick={() => setViewingResult(msg.pipelineResult!)}
                          style={{ fontSize: 10, color: '#a78bfa', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 99, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace', transition: 'all 0.15s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.15)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.08)'}
                        >
                          View findings →
                        </button>
                      )}
                      {/* Re-open apply modal if plan available */}
                      {msg.approved && msg.pipelineResult?.executionPlan?.changes?.length ? (
                        <button
                          onClick={() => setPendingPlan({ plan: msg.pipelineResult!.executionPlan!, result: msg.pipelineResult! })}
                          style={{ fontSize: 10, color: '#22c55e', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 99, padding: '3px 10px', cursor: 'pointer', fontFamily: 'monospace', transition: 'all 0.15s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.15)'}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.08)'}
                        >
                          Apply changes ↗
                        </button>
                      ) : null}
                      {/* Preview button — shown when pipeline generated HTML/CSS/JS content */}
                      {msg.approved && (() => {
                        const htmlChange = msg.pipelineResult?.executionPlan?.changes?.find(
                          c => c.after && c.after.trim().length > 20 &&
                            /\.(html?|css|jsx?|tsx?)$/i.test(c.path)
                        )
                        if (!htmlChange) return null
                        const ext = htmlChange.path.split('.').pop()?.toLowerCase() ?? 'html'
                        const isHtml = ext === 'html' || ext === 'htm'
                        const previewContent: PreviewContent = isHtml
                          ? { raw: htmlChange.after, title: htmlChange.path.split('/').pop() }
                          : ext === 'css'
                            ? { css: htmlChange.after, title: htmlChange.path.split('/').pop() }
                            : { raw: htmlChange.after, language: ext, title: htmlChange.path.split('/').pop() }
                        return <PreviewButton key="preview" content={previewContent} label="Preview ↗" small />
                      })()}
                      {/* Auto-Fix button on blocked results */}
                      {!msg.approved && msg.pipelineResult && hasAutoFixableFindings(msg.pipelineResult) && (
                        <button
                          onClick={() => runRefactor(msg.id, msg.pipelineResult!)}
                          disabled={!!refactoringMsgId || busy}
                          style={{ fontSize: 10, color: refactoringMsgId === msg.id ? '#fbbf24' : '#f97316', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 99, padding: '3px 10px', cursor: refactoringMsgId ? 'not-allowed' : 'pointer', fontFamily: 'monospace', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4 }}
                          onMouseEnter={e => { if (!refactoringMsgId) (e.currentTarget as HTMLElement).style.background = 'rgba(249,115,22,0.15)' }}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(249,115,22,0.08)'}
                        >
                          {refactoringMsgId === msg.id ? (
                            <><div style={{ width: 8, height: 8, border: '1.5px solid rgba(251,191,36,0.4)', borderTopColor: '#fbbf24', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> fixing...</>
                          ) : '⚙ Auto-Fix'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Activity stream */}
                  {msg.activity && <ActivityStream items={msg.activity} />}

                  {/* Plain text fallback */}
                  {msg.content && <div>{renderMarkdown(msg.content)}</div>}

                  {/* Typing indicator — show when busy and this is the last message and it has no content yet */}
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
        <div style={{ padding: '10px 12px 12px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, position: 'relative' }}>

          {/* Model / Role override chips */}
          <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowModelPicker(v => !v)}
              style={{
                fontSize: 10, fontFamily: 'monospace', padding: '3px 8px', borderRadius: 6,
                background: sessionModel ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.04)',
                border: sessionModel ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(255,255,255,0.07)',
                color: sessionModel ? '#c4b5fd' : 'rgba(255,255,255,0.25)', cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>
              {sessionModel ? sessionModel.split('/').slice(-1)[0] : 'model'}
            </button>
            {(['architect', 'backend', 'frontend', 'security'] as ModelRole[]).map(r => (
              <button key={r} onClick={() => setSessionRole(sessionRole === r ? null : r)}
                style={{
                  fontSize: 10, fontFamily: 'monospace', padding: '3px 8px', borderRadius: 6,
                  background: sessionRole === r ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.03)',
                  border: sessionRole === r ? '1px solid rgba(124,58,237,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  color: sessionRole === r ? '#a78bfa' : 'rgba(255,255,255,0.2)', cursor: 'pointer', transition: 'all 0.15s'
                }}>
                {r}
              </button>
            ))}
            {(sessionModel || sessionRole) && (
              <button onClick={() => { setSessionModel(null); setSessionRole(null) }}
                style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'none', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)', cursor: 'pointer' }}>
                ×
              </button>
            )}
          </div>

          {/* Inline model search dropdown */}
          {showModelPicker && (
            <div style={{ position: 'absolute', bottom: 120, left: 12, right: 12, background: '#0d0e1a', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 10, zIndex: 20, maxHeight: 200, overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
              <div style={{ padding: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <input autoFocus placeholder="Search models..." id="model-search-inline"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 6, padding: '5px 10px', fontSize: 11, color: 'rgba(255,255,255,0.7)', outline: 'none', fontFamily: 'monospace' }}
                  onChange={e => {
                    const q = e.target.value.toLowerCase()
                    const el = document.getElementById('model-list-inline')
                    if (el) el.querySelectorAll<HTMLElement>('[data-id]').forEach(btn => {
                      btn.style.display = btn.dataset.id?.includes(q) ? 'block' : 'none'
                    })
                  }} />
              </div>
              <div id="model-list-inline">
                {(availableModels.length > 0 ? availableModels : Object.values(roleModels).filter((v, i, a) => a.indexOf(v) === i).map(id => ({ id, name: id }))).map((m: any) => (
                  <button key={m.id} data-id={m.id}
                    onClick={() => { setSessionModel(m.id); setShowModelPicker(false) }}
                    style={{ width: '100%', textAlign: 'left', display: 'block', padding: '7px 12px', fontSize: 11, fontFamily: 'monospace', color: sessionModel === m.id ? '#c4b5fd' : 'rgba(255,255,255,0.55)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.08)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    {m.id}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ position: 'relative', background: 'rgba(255,255,255,0.04)', border: `1px solid ${busy ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.09)'}`, borderRadius: 12, transition: 'border-color 0.2s' }}>
            <textarea
              ref={taRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
              onFocus={() => setShowModelPicker(false)}
              placeholder={activeProject ? 'Build anything — agent will create files...' : 'Ask PLATPHORM...'}
              rows={3}
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', padding: '11px 13px 34px', fontSize: 13, color: 'rgba(255,255,255,0.8)', resize: 'none', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}
            />
            <div style={{ position: 'absolute', bottom: 8, left: 12, right: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', fontFamily: 'monospace' }}>⌘↵</span>
              <button
                onClick={send}
                disabled={!input.trim() || busy}
                style={{
                  width: 28, height: 28, borderRadius: 8, border: 'none', flexShrink: 0,
                  background: input.trim() && !busy ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.06)',
                  cursor: input.trim() && !busy ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: input.trim() && !busy ? '0 0 14px rgba(124,58,237,0.4)' : 'none',
                  transition: 'all 0.2s'
                }}
              >
                {busy
                  ? <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Apply Changes Modal */}
      {pendingPlan && (
        <ApplyChangesModal
          plan={pendingPlan.plan}
          projectPath={activeProject?.rootPath ?? ''}
          onApply={(results) => {
            setPendingPlan(null)
            push({ role: 'system', content: `✓ Applied ${results.filter(r => r.success).length}/${results.length} changes successfully.` })
          }}
          onReject={() => {
            setPendingPlan(null)
            push({ role: 'system', content: 'Changes rejected — no files modified.' })
          }}
        />
      )}

      {/* Findings Panel */}
      {viewingResult && (
        <FindingsPanel
          result={viewingResult}
          onClose={() => setViewingResult(null)}
        />
      )}
    </>
  )
}

// Build a concise registry context string for pipeline injection
function buildRegistryContext(dna: any): string {
  const parts: string[] = []
  if (dna.serviceRegistry?.length) {
    parts.push('SERVICES: ' + dna.serviceRegistry.map((s: any) => `${s.name} (${s.purpose})`).join(', '))
  }
  if (dna.domainRegistry?.length) {
    parts.push('DOMAINS: ' + dna.domainRegistry.map((d: any) => `${d.name} owns [${d.owns?.join(', ')}]`).join(' | '))
  }
  if (dna.apiContractRegistry?.length) {
    parts.push('APIs: ' + dna.apiContractRegistry.map((a: any) => `${a.method} ${a.endpoint} [${a.status}]`).join(', '))
  }
  if (dna.providerRegistry?.length) {
    parts.push('PROVIDERS: ' + dna.providerRegistry.map((p: any) => `${p.name} via ${p.interfaceName}`).join(', '))
  }
  return parts.join('\n')
}
