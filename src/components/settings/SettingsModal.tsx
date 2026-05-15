import { useState, useEffect } from 'react'
import { useAIStore } from '../../store/aiStore'
import { orchestrator } from '../../core/providers/AIOrchestrator'

interface Props { onClose: () => void }

export function SettingsModal({ onClose }: Props) {
  const { settings, updateSettings, setConfigured } = useAIStore()
  const [keys, setKeys] = useState({
    openrouter: settings.providers.openrouter ?? '',
    anthropic: settings.providers.anthropic ?? '',
    openai: settings.providers.openai ?? ''
  })
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'providers' | 'editor' | 'governance'>('providers')

  useEffect(() => {
    const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
    if (envKey && !keys.openrouter) setKeys(k => ({ ...k, openrouter: envKey }))
  }, [])

  const save = () => {
    Object.entries(keys).forEach(([provider, key]) => {
      if (key.trim()) {
        orchestrator.addProvider({ provider: provider as any, apiKey: key.trim() })
      }
    })
    const preferred = keys.openrouter ? 'openrouter' : keys.anthropic ? 'anthropic' : keys.openai ? 'openai' : settings.preferredProvider
    updateSettings({ providers: keys, preferredProvider: preferred })
    setConfigured(Object.values(keys).some(k => k.trim().length > 0))
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-[560px] bg-base-900 border border-base-400/30 rounded-2xl shadow-2xl overflow-hidden panel-enter"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-500/30">
          <span className="text-sm font-semibold text-slate-200">Settings</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="flex h-80">
          {/* Sidebar tabs */}
          <div className="w-40 border-r border-base-500/30 p-2 space-y-0.5 flex-shrink-0">
            {([['providers', 'AI Providers'], ['editor', 'Editor'], ['governance', 'Governance']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                  tab === id ? 'bg-violet-500/15 text-violet-300' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-5 overflow-y-auto">
            {tab === 'providers' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Add your API keys. OpenRouter gives access to all models with a single key.
                </p>
                {([
                  { id: 'openrouter', label: 'OpenRouter', hint: 'sk-or-v1-...', sub: 'Claude, GPT-4, Gemini & more' },
                  { id: 'anthropic', label: 'Anthropic', hint: 'sk-ant-...', sub: 'Direct Claude access' },
                  { id: 'openai', label: 'OpenAI', hint: 'sk-...', sub: 'Direct GPT-4 / o3 access' }
                ] as const).map(({ id, label, hint, sub }) => (
                  <KeyField
                    key={id}
                    label={label}
                    sub={sub}
                    value={keys[id]}
                    placeholder={hint}
                    onChange={v => setKeys(k => ({ ...k, [id]: v }))}
                  />
                ))}
              </div>
            )}
            {tab === 'editor' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Font Size</label>
                  <input
                    type="number"
                    min={10} max={24}
                    value={settings.fontSize}
                    onChange={e => updateSettings({ fontSize: Number(e.target.value) })}
                    className="w-20 bg-base-700 border border-base-400/30 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">Font Family</label>
                  <select
                    value={settings.fontFamily}
                    onChange={e => updateSettings({ fontFamily: e.target.value })}
                    className="bg-base-700 border border-base-400/30 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none w-full"
                  >
                    <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                    <option value="'Fira Code', monospace">Fira Code</option>
                    <option value="'SF Mono', monospace">SF Mono</option>
                    <option value="monospace">System Mono</option>
                  </select>
                </div>
              </div>
            )}
            {tab === 'governance' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Governance protocol runs automatically on all AI requests when a project is open.
                </p>
                <Toggle
                  label="Strict Mode"
                  sub="Block execution on any high-severity finding"
                  value={settings.governanceStrictMode}
                  onChange={v => updateSettings({ governanceStrictMode: v })}
                />
                <Toggle
                  label="Pipeline on Save"
                  sub="Run governance checks when saving a file"
                  value={settings.pipelineOnSave}
                  onChange={v => updateSettings({ pipelineOnSave: v })}
                />
                <Toggle
                  label="Auto-run Pipeline"
                  sub="Automatically apply approved changes"
                  value={settings.autoRunPipeline}
                  onChange={v => updateSettings({ autoRunPipeline: v })}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-base-500/30">
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300 px-4 py-2 transition-colors">Cancel</button>
          <button
            onClick={save}
            className="text-xs bg-violet-600 hover:bg-violet-500 text-white px-5 py-2 rounded-lg transition-colors"
          >
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function KeyField({ label, sub, value, placeholder, onChange }: {
  label: string; sub: string; value: string; placeholder: string; onChange: (v: string) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs text-slate-300 font-medium">{label}</label>
        <span className="text-[10px] text-slate-600">{sub}</span>
      </div>
      <div className="flex gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-base-700/60 border border-base-400/30 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-700 focus:outline-none focus:border-violet-500/50 font-mono transition-colors"
        />
        <button onClick={() => setShow(v => !v)} className="text-slate-600 hover:text-slate-400 px-2 transition-colors text-xs">
          {show ? 'hide' : 'show'}
        </button>
      </div>
    </div>
  )
}

function Toggle({ label, sub, value, onChange }: {
  label: string; sub: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-xs text-slate-300">{label}</div>
        <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-8 h-4 rounded-full transition-colors ${value ? 'bg-violet-600' : 'bg-base-500'}`}
      >
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}
