import { useState, useEffect } from 'react'
import { useAIStore } from '../../store/aiStore'
import { orchestrator } from '../../core/providers/AIOrchestrator'

export function SettingsPanel() {
  const { settings, updateSettings, setConfigured } = useAIStore()
  const [openrouterKey, setOpenrouterKey] = useState(settings.providers.openrouter ?? '')
  const [anthropicKey, setAnthropicKey] = useState(settings.providers.anthropic ?? '')
  const [openaiKey, setOpenaiKey] = useState(settings.providers.openai ?? '')
  const [saved, setSaved] = useState(false)

  // Auto-load env key on mount
  useEffect(() => {
    const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
    if (envKey && !openrouterKey) {
      setOpenrouterKey(envKey)
      applyKey('openrouter', envKey)
    }
  }, [])

  const applyKey = (provider: string, key: string) => {
    if (!key.trim()) return
    orchestrator.addProvider({ provider: provider as any, apiKey: key.trim() })

    const updated = {
      ...settings.providers,
      [provider]: key.trim()
    }
    updateSettings({ providers: updated, preferredProvider: provider })
    setConfigured(true)
  }

  const handleSave = () => {
    if (openrouterKey.trim()) applyKey('openrouter', openrouterKey)
    if (anthropicKey.trim()) applyKey('anthropic', anthropicKey)
    if (openaiKey.trim()) applyKey('openai', openaiKey)

    const preferred =
      openrouterKey.trim() ? 'openrouter' :
      anthropicKey.trim() ? 'anthropic' :
      openaiKey.trim() ? 'openai' : settings.preferredProvider

    updateSettings({ preferredProvider: preferred })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-4 font-mono text-xs space-y-6 overflow-y-auto">
      <div>
        <div className="text-violet-400 uppercase tracking-widest text-[10px] mb-3">
          AI Providers
        </div>
        <div className="text-slate-600 mb-4 leading-relaxed">
          Add your own API keys for direct provider access, or use OpenRouter to access all models
          with a single key.
        </div>

        <div className="space-y-3">
          <KeyField
            label="OpenRouter"
            sublabel="Access all models — Claude, GPT-4, Gemini, DeepSeek, and more"
            value={openrouterKey}
            onChange={setOpenrouterKey}
            placeholder="sk-or-v1-..."
          />
          <KeyField
            label="Anthropic"
            sublabel="Direct Claude access (Claude Opus, Sonnet, Haiku)"
            value={anthropicKey}
            onChange={setAnthropicKey}
            placeholder="sk-ant-..."
          />
          <KeyField
            label="OpenAI"
            sublabel="Direct OpenAI access (GPT-4o, o3)"
            value={openaiKey}
            onChange={setOpenaiKey}
            placeholder="sk-..."
          />
        </div>

        <button
          onClick={handleSave}
          className="mt-4 w-full py-2 bg-violet-600 hover:bg-violet-500 text-white rounded text-xs transition-colors"
        >
          {saved ? '✓ Saved' : 'Save & Apply'}
        </button>
      </div>

      <div className="border-t border-[#1a1a2e] pt-4">
        <div className="text-violet-400 uppercase tracking-widest text-[10px] mb-3">
          Preferred Provider
        </div>
        <div className="flex gap-2">
          {['openrouter', 'anthropic', 'openai'].map((p) => (
            <button
              key={p}
              onClick={() => updateSettings({ preferredProvider: p })}
              className={`px-3 py-1 rounded border text-xs transition-colors ${
                settings.preferredProvider === p
                  ? 'border-violet-500 text-violet-400 bg-violet-500/10'
                  : 'border-slate-800 text-slate-600 hover:border-slate-600'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[#1a1a2e] pt-4">
        <div className="text-violet-400 uppercase tracking-widest text-[10px] mb-3">
          Governance
        </div>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-slate-400">Strict Mode — block execution on any high violation</span>
          <div
            className={`w-8 h-4 rounded-full transition-colors cursor-pointer ${
              settings.governanceStrictMode ? 'bg-violet-600' : 'bg-slate-800'
            }`}
            onClick={() => updateSettings({ governanceStrictMode: !settings.governanceStrictMode })}
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer mt-2">
          <span className="text-slate-400">Run pipeline on save</span>
          <div
            className={`w-8 h-4 rounded-full transition-colors cursor-pointer ${
              settings.pipelineOnSave ? 'bg-violet-600' : 'bg-slate-800'
            }`}
            onClick={() => updateSettings({ pipelineOnSave: !settings.pipelineOnSave })}
          />
        </label>
      </div>

      <div className="border-t border-[#1a1a2e] pt-4 text-slate-700">
        <div className="mb-1">PLATPHORM v0.1.0</div>
        <div>AI-Native Engineering Operating System</div>
      </div>
    </div>
  )
}

function KeyField({
  label,
  sublabel,
  value,
  onChange,
  placeholder
}: {
  label: string
  sublabel: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const [show, setShow] = useState(false)

  return (
    <div className="border border-[#1a1a2e] rounded p-3">
      <div className="text-slate-300 mb-0.5">{label}</div>
      <div className="text-slate-600 text-[10px] mb-2">{sublabel}</div>
      <div className="flex gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-[#0a0a14] border border-[#1a1a2e] rounded px-2 py-1.5 text-xs text-slate-300 placeholder-slate-700 focus:outline-none focus:border-violet-500/50 font-mono"
        />
        <button
          onClick={() => setShow((v) => !v)}
          className="text-slate-600 hover:text-slate-400 px-2"
        >
          {show ? '◉' : '○'}
        </button>
      </div>
    </div>
  )
}
