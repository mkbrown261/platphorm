import { useState, useRef, useEffect } from 'react'
import { useAIStore } from '../../store/aiStore'
import { useDNAStore } from '../../store/dnaStore'
import { useProjectStore } from '../../store/projectStore'
import { orchestrator } from '../../core/providers/AIOrchestrator'
import { runPipeline } from '../../core/intelligence/Pipeline'
import type { PipelineContext } from '../../types'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

const LAYER_LABELS: Record<string, string> = {
  intent: '01 Intent',
  architecture: '02 Architecture',
  security: '03 Security',
  dependency: '04 Dependency',
  performance: '05 Performance',
  continuity: '06 Continuity',
  validation: '07 Validation',
  execution: '08 Execution',
  observability: '09 Observability',
  selfCritique: '10 Self-Critique'
}

export function AIOverlay() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'system',
      content: 'PLATPHORM is ready. All requests pass through 10 intelligence layers before execution.',
      timestamp: Date.now()
    }
  ])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [usePipeline, setUsePipeline] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { settings, pipelineRunning, layerProgress, startPipeline, updateLayerProgress, completePipeline } = useAIStore()
  const { dna } = useDNAStore()
  const { activeProject, openTabs, activeTabId } = useProjectStore()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const activeTab = openTabs.find((t) => t.id === activeTabId)

  const appendMessage = (msg: Omit<Message, 'id' | 'timestamp'>) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: `msg-${Date.now()}-${Math.random()}`, timestamp: Date.now() }
    ])
  }

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming || pipelineRunning) return

    const userPrompt = input.trim()
    setInput('')
    appendMessage({ role: 'user', content: userPrompt })

    if (!orchestrator.hasProviders()) {
      appendMessage({
        role: 'system',
        content: 'No AI providers configured. Open Settings (⌘,) to add your API keys.'
      })
      return
    }

    if (usePipeline) {
      await runWithPipeline(userPrompt)
    } else {
      await runDirect(userPrompt)
    }
  }

  const runDirect = async (prompt: string) => {
    setIsStreaming(true)
    const assistantMsgId = `msg-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '', timestamp: Date.now() }
    ])

    try {
      const systemPrompt = dna
        ? `You are PLATPHORM's AI assistant operating within the ${dna.identity.systemName} project.
Core purpose: ${dna.identity.corePurpose}
System Laws: ${dna.systemLaws?.slice(0, 5).map((l) => l.rule).join('; ')}
Never violate System Laws. Never create forbidden patterns.`
        : 'You are PLATPHORM, an AI-native engineering OS. Prioritize architectural coherence, security, and production safety above all else.'

      for await (const chunk of orchestrator.streamOrchestrate({
        prompt: activeTab ? `[File: ${activeTab.filePath}]\n\n${prompt}` : prompt,
        role: 'general',
        options: { systemPrompt }
      })) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: m.content + chunk.content } : m
          )
        )
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: `Error: ${String(err)}` }
            : m
        )
      )
    } finally {
      setIsStreaming(false)
    }
  }

  const runWithPipeline = async (prompt: string) => {
    startPipeline()

    const context: PipelineContext = {
      projectPath: activeProject?.rootPath ?? '',
      userPrompt: prompt,
      selectedCode: activeTab?.content?.slice(0, 3000),
      activeFile: activeTab?.filePath,
      projectDNAAvailable: !!dna,
      architectureDoc: dna ? undefined : undefined,
      systemLaws: dna?.systemLaws.map((l) => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? [],
      lockedSystems: dna?.lockedSystems.map((s) => s.name) ?? [],
      relevantRegistries: ''
    }

    appendMessage({
      role: 'system',
      content: 'Pipeline initiated — running 10-layer governance validation...'
    })

    try {
      const result = await runPipeline(context, (index, name, layerResult) => {
        updateLayerProgress(index, name, layerResult)
      })

      completePipeline(result)

      const summary = [
        `Pipeline complete — Score: ${result.overallScore}/100`,
        result.approved ? '✓ APPROVED' : '✗ BLOCKED',
        result.blockers.length > 0
          ? `Blockers: ${result.blockers.map((b) => b.message).join('; ')}`
          : 'No critical blockers',
        result.warnings.length > 0 ? `Warnings: ${result.warnings.length}` : ''
      ]
        .filter(Boolean)
        .join('\n')

      appendMessage({ role: 'system', content: summary })

      if (result.approved && result.executionPlan) {
        appendMessage({
          role: 'assistant',
          content: `Execution plan generated — ${result.executionPlan.changes.length} file(s) affected. Risk: ${result.executionPlan.estimatedRisk}. Review in the Pipeline panel.`
        })
      }
    } catch (err) {
      completePipeline({
        id: 'failed',
        timestamp: Date.now(),
        context,
        layers: [],
        overallScore: 0,
        approved: false,
        blockers: [],
        warnings: [],
        durationMs: 0
      })
      appendMessage({ role: 'system', content: `Pipeline error: ${String(err)}` })
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#080810] border-l border-[#1a1a2e]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a2e]">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
          <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">
            Intelligence
          </span>
        </div>
        <button
          onClick={() => setUsePipeline((v) => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${
            usePipeline
              ? 'border-violet-500 text-violet-400 bg-violet-500/10'
              : 'border-slate-700 text-slate-500 hover:border-slate-500'
          }`}
        >
          {usePipeline ? '10-Layer Pipeline ON' : 'Direct Mode'}
        </button>
      </div>

      {/* Pipeline progress */}
      {pipelineRunning && layerProgress && (
        <div className="px-4 py-2 border-b border-[#1a1a2e] bg-[#0d0d1a]">
          <div className="text-xs text-slate-500 mb-1">
            Running {LAYER_LABELS[layerProgress.name] ?? layerProgress.name}...
          </div>
          <div className="flex gap-1">
            {Object.keys(LAYER_LABELS).map((key, i) => (
              <div
                key={key}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i < layerProgress.index
                    ? 'bg-violet-500'
                    : i === layerProgress.index
                      ? 'bg-violet-400 animate-pulse'
                      : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 font-mono text-sm">
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' && (
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-violet-500/20 border border-violet-500/30 rounded-lg px-3 py-2 text-slate-200 text-sm">
                  {msg.content}
                </div>
              </div>
            )}
            {msg.role === 'assistant' && (
              <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content}
                {isStreaming && msg === messages[messages.length - 1] && (
                  <span className="inline-block w-2 h-4 ml-1 bg-violet-400 animate-pulse" />
                )}
              </div>
            )}
            {msg.role === 'system' && (
              <div className="text-xs text-slate-600 border border-slate-800 rounded px-3 py-2 whitespace-pre-wrap">
                {msg.content}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-[#1a1a2e]">
        <div className="flex gap-2">
          <textarea
            className="flex-1 bg-[#0d0d1a] border border-[#1a1a2e] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-violet-500/50 transition-colors font-mono"
            placeholder={
              usePipeline
                ? 'Describe what to build — pipeline will validate...'
                : 'Ask PLATPHORM...'
            }
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming || pipelineRunning}
            className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-xs font-mono transition-colors"
          >
            {pipelineRunning ? '...' : isStreaming ? '▪' : '⏎'}
          </button>
        </div>
        <div className="mt-1 text-xs text-slate-700">⌘↵ to send</div>
      </div>
    </div>
  )
}
