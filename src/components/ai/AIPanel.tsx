import { useState, useRef, useEffect, useCallback } from 'react'
import { useAIStore } from '../../store/aiStore'
import { useDNAStore } from '../../store/dnaStore'
import { useProjectStore } from '../../store/projectStore'
import { orchestrator } from '../../core/providers/AIOrchestrator'
import { runPipeline } from '../../core/intelligence/Pipeline'
import type { PipelineContext, LayerResult } from '../../types'

type MsgRole = 'user' | 'assistant' | 'system'
interface Msg {
  id: string
  role: MsgRole
  content: string
  pipelineScore?: number
  pipelineApproved?: boolean
  layers?: LayerResult[]
}

const LAYERS = ['Intent','Architecture','Security','Dependency','Performance','Continuity','Validation','Execution','Observability','Critique']

function PipelineProgress({ current, layers }: { current: number; layers: LayerResult[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {LAYERS.map((name, i) => {
            const done = layers[i]
            const active = i === current && !done
            return (
              <div
                key={name}
                title={name}
                className={`h-1 w-4 rounded-full transition-all duration-300 ${
                  done
                    ? done.status === 'passed' ? 'bg-emerald-500' : done.status === 'failed' ? 'bg-red-500' : 'bg-amber-400'
                    : active ? 'bg-violet-400 layer-active' : 'bg-base-500/40'
                }`}
              />
            )
          })}
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          {current < 10 ? LAYERS[current] : 'Complete'}
        </span>
      </div>
    </div>
  )
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="relative group mt-2 rounded-lg overflow-hidden border border-base-500/30">
      <div className="flex items-center justify-between px-3 py-1.5 bg-base-700/60 border-b border-base-500/20">
        <span className="text-[10px] text-slate-500 font-mono">{language ?? 'code'}</span>
        <button onClick={copy} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors font-mono">
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      <pre className="text-xs text-slate-300 p-3 overflow-x-auto leading-relaxed font-mono bg-base-800/60">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g)
  return (
    <div className="space-y-1">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n')
          const lang = lines[0].trim()
          const code = lines.slice(1).join('\n')
          return <CodeBlock key={i} code={code} language={lang || undefined} />
        }
        if (!part.trim()) return null
        return (
          <p key={i} className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
            {part}
          </p>
        )
      })}
    </div>
  )
}

export function AIPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [pipelineLayer, setPipelineLayer] = useState(-1)
  const [completedLayers, setCompletedLayers] = useState<LayerResult[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { settings, pipelineRunning, startPipeline, updateLayerProgress, completePipeline } = useAIStore()
  const { dna } = useDNAStore()
  const { activeProject, openTabs, activeTabId } = useProjectStore()

  const activeTab = openTabs.find(t => t.id === activeTabId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, pipelineLayer])

  const addMsg = (msg: Omit<Msg, 'id'>) =>
    setMsgs(prev => [...prev, { ...msg, id: `m-${Date.now()}-${Math.random()}` }])

  const send = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || streaming || pipelineRunning) return
    setInput('')

    addMsg({ role: 'user', content: prompt })

    if (!orchestrator.hasProviders()) {
      addMsg({ role: 'system', content: 'Add an API key in Settings to start building.' })
      return
    }

    // Always run pipeline if project is open, otherwise direct
    if (activeProject) {
      await runWithPipeline(prompt)
    } else {
      await runDirect(prompt)
    }
  }, [input, streaming, pipelineRunning, activeProject, dna, activeTab, settings])

  const runDirect = async (prompt: string) => {
    setStreaming(true)
    const id = `m-${Date.now()}`
    setMsgs(prev => [...prev, { id, role: 'assistant', content: '' }])

    try {
      const sys = dna
        ? `You are PLATPHORM, an AI engineering OS. Project: ${dna.identity.systemName}. Purpose: ${dna.identity.corePurpose}. Always respect System Laws. Never create forbidden patterns.`
        : 'You are PLATPHORM, an AI-native engineering OS. Prioritize architectural coherence, security, and production quality above all else.'

      for await (const chunk of orchestrator.streamOrchestrate({
        prompt: activeTab ? `Active file: ${activeTab.filePath}\n\n${prompt}` : prompt,
        role: 'general',
        options: { systemPrompt: sys }
      })) {
        setMsgs(prev => prev.map(m => m.id === id ? { ...m, content: m.content + chunk.content } : m))
      }
    } catch (err) {
      setMsgs(prev => prev.map(m => m.id === id ? { ...m, content: `Error: ${String(err)}` } : m))
    }
    setStreaming(false)
  }

  const runWithPipeline = async (prompt: string) => {
    startPipeline()
    setPipelineLayer(0)
    setCompletedLayers([])

    const context: PipelineContext = {
      projectPath: activeProject!.rootPath,
      userPrompt: prompt,
      selectedCode: activeTab?.content?.slice(0, 4000),
      activeFile: activeTab?.filePath,
      projectDNAAvailable: !!dna,
      architectureDoc: undefined,
      systemLaws: dna?.systemLaws.map(l => l.rule) ?? [],
      forbiddenPatterns: dna?.forbiddenPatterns ?? [],
      lockedSystems: dna?.lockedSystems.map(s => s.name) ?? [],
      relevantRegistries: ''
    }

    const id = `m-${Date.now()}`
    setMsgs(prev => [...prev, { id, role: 'assistant', content: '' }])

    try {
      const result = await runPipeline(context, (index, _name, layerResult) => {
        setPipelineLayer(index)
        updateLayerProgress(index, _name, layerResult)
        if (layerResult) setCompletedLayers(prev => [...prev, layerResult])
      })

      completePipeline(result)
      setPipelineLayer(10)

      const generatedContent = result.executionPlan?.changes
        ?.filter(c => c.after)
        .map(c => c.after!)
        .join('\n\n') ?? ''

      let response = ''
      if (result.approved) {
        response = `Done — ${result.overallScore}/100 across all checks.\n\n`
        if (generatedContent) response += generatedContent
        else response += 'Implementation plan validated. Review the changes in the Pipeline tab.'
      } else {
        response = `${result.blockers.length} issue(s) need attention before this can be applied:\n\n`
        result.blockers.forEach(b => { response += `• ${b.message}\n` })
        if (result.warnings.length > 0) {
          response += `\n${result.warnings.length} warning(s) noted.`
        }
      }

      setMsgs(prev => prev.map(m => m.id === id ? {
        ...m,
        content: response,
        pipelineScore: result.overallScore,
        pipelineApproved: result.approved,
        layers: result.layers
      } : m))
    } catch (err) {
      setMsgs(prev => prev.map(m => m.id === id ? { ...m, content: `Pipeline error: ${String(err)}` } : m))
    }

    setPipelineLayer(-1)
    setCompletedLayers([])
  }

  const isRunning = streaming || pipelineRunning

  return (
    <div className="flex flex-col h-full bg-base-900 border-l border-base-500/30">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-base-500/20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-violet-400 animate-pulse' : 'bg-emerald-500'}`} />
          <span className="text-xs font-semibold text-slate-400">PLATPHORM AI</span>
        </div>
        {dna && (
          <span className="text-[10px] text-slate-600 font-mono ml-auto truncate max-w-[120px]" title={dna.identity.systemName}>
            {dna.identity.systemName}
          </span>
        )}
      </div>

      {/* Pipeline progress (only when running) */}
      {pipelineRunning && pipelineLayer >= 0 && (
        <div className="px-4 py-2 border-b border-base-500/20 bg-base-800/60 flex-shrink-0">
          <PipelineProgress current={pipelineLayer} layers={completedLayers} />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 panel-enter">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
              </svg>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-slate-300">What do you want to build?</div>
              <div className="text-xs text-slate-600 max-w-[200px] leading-relaxed">
                {activeProject
                  ? 'Every request is validated through governance protocol automatically.'
                  : 'Open a project folder to enable full governance mode.'}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-[220px]">
              {['Build a REST API endpoint', 'Add authentication', 'Create a data model', 'Fix this code'].map(s => (
                <button
                  key={s}
                  onClick={() => { setInput(s); textareaRef.current?.focus() }}
                  className="text-xs text-left px-3 py-2 rounded-lg border border-base-400/30 text-slate-500 hover:text-slate-300 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map(msg => (
          <div key={msg.id} className="space-y-1.5 panel-enter">
            {msg.role === 'user' && (
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-violet-600/15 border border-violet-500/20 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm text-slate-200">
                  {msg.content}
                </div>
              </div>
            )}
            {msg.role === 'assistant' && (
              <div className="space-y-2">
                {/* Pipeline badge */}
                {msg.pipelineScore !== undefined && (
                  <div className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border font-mono ${
                    msg.pipelineApproved
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-red-500/30 bg-red-500/10 text-red-400'
                  }`}>
                    <span>{msg.pipelineApproved ? '✓' : '✗'}</span>
                    <span>{msg.pipelineScore}/100</span>
                    <span className="text-current/50">· 10 layers</span>
                  </div>
                )}
                <div className="text-sm text-slate-300 leading-relaxed">
                  <MessageContent content={msg.content} />
                  {isRunning && msg === msgs[msgs.length - 1] && !msg.content && (
                    <span className="inline-block w-1.5 h-4 bg-violet-400 cursor-blink rounded-sm" />
                  )}
                </div>
              </div>
            )}
            {msg.role === 'system' && (
              <div className="text-[11px] text-slate-600 text-center py-1">{msg.content}</div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-base-500/20 flex-shrink-0">
        <div className="relative bg-base-700/50 border border-base-400/30 rounded-xl focus-within:border-violet-500/50 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            placeholder={activeProject ? 'Build anything...' : 'Ask PLATPHORM...'}
            rows={3}
            className="w-full bg-transparent px-3.5 pt-3 pb-10 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none font-sans"
          />
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
            <span className="text-[10px] text-slate-600 font-mono">⌘↵</span>
            <button
              onClick={send}
              disabled={!input.trim() || isRunning}
              className="w-7 h-7 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-base-600/50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            >
              {isRunning ? (
                <div className="w-3 h-3 border border-slate-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
