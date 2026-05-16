import { useState, useEffect, useCallback } from 'react'
import { useAIStore } from '../../store/aiStore'
import { useModelStore, DEFAULT_ROLE_MODELS, ROLE_DESCRIPTIONS, FEATURED_MODELS } from '../../store/modelStore'
import { orchestrator, setRoleModelOverrides } from '../../core/providers/AIOrchestrator'
import type { ModelRole } from '../../types'

interface Props { onClose: () => void }

const S = {
  overlay: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute' as const, inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)' },
  modal: {
    position: 'relative' as const, width: 680,
    background: '#0d0e1a',
    border: '1px solid rgba(124,58,237,0.2)',
    borderRadius: 16, overflow: 'hidden',
    boxShadow: '0 0 80px rgba(124,58,237,0.15), 0 40px 60px rgba(0,0,0,0.6)'
  },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  body: { display: 'flex', height: 480 },
  nav: { width: 160, borderRight: '1px solid rgba(255,255,255,0.06)', padding: 8, flexShrink: 0 },
  content: { flex: 1, padding: 20, overflowY: 'auto' as const },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.06)' }
}

const TABS = [
  { id: 'providers', label: 'AI Providers' },
  { id: 'models',    label: 'Model Picker' },
  { id: 'roles',     label: 'Role → Model' },
  { id: 'editor',    label: 'Editor' },
  { id: 'governance',label: 'Governance' }
] as const
type Tab = typeof TABS[number]['id']

const ROLES: ModelRole[] = ['architect', 'security', 'backend', 'frontend', 'refactor', 'performance', 'validation', 'continuity', 'general']

export function SettingsModal({ onClose }: Props) {
  const { settings, updateSettings, setConfigured } = useAIStore()
  const {
    availableModels, isLoadingModels, modelsError, lastFetchedAt,
    roleModels, setRoleModel, resetRoleModels,
    setAvailableModels, setLoadingModels, setModelsError
  } = useModelStore()

  const [keys, setKeys] = useState({
    openrouter: settings.providers.openrouter ?? '',
    anthropic: settings.providers.anthropic ?? '',
    openai: settings.providers.openai ?? ''
  })
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<Tab>('providers')
  const [modelSearch, setModelSearch] = useState('')

  useEffect(() => {
    const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
    if (envKey && !keys.openrouter) setKeys(k => ({ ...k, openrouter: envKey }))
  }, [])

  const fetchModels = useCallback(async () => {
    const apiKey = keys.openrouter || settings.providers.openrouter
    if (!apiKey) { setModelsError('Add an OpenRouter API key first'); return }
    setLoadingModels(true)
    setModelsError(null)
    try {
      const res = await window.api.ai.listModels(apiKey)
      if (res.success && res.data) {
        const data = res.data as any
        const models = (data.data ?? []).sort((a: any, b: any) => a.id.localeCompare(b.id))
        setAvailableModels(models)
      } else {
        setModelsError(res.error ?? 'Failed to fetch models')
      }
    } catch (err) {
      setModelsError(String(err))
    }
  }, [keys.openrouter, settings.providers.openrouter])

  // Auto-fetch when switching to model tabs if not loaded
  useEffect(() => {
    if ((tab === 'models' || tab === 'roles') && availableModels.length === 0 && !isLoadingModels) {
      fetchModels()
    }
  }, [tab])

  const save = async () => {
    Object.entries(keys).forEach(([provider, key]) => {
      if (key.trim()) orchestrator.addProvider({ provider: provider as any, apiKey: key.trim() })
    })
    const preferred = keys.openrouter ? 'openrouter' : keys.anthropic ? 'anthropic' : keys.openai ? 'openai' : settings.preferredProvider
    updateSettings({ providers: keys, preferredProvider: preferred })
    setConfigured(Object.values(keys).some(k => k.trim().length > 0))
    // Push role overrides into orchestrator
    setRoleModelOverrides(roleModels)
    setSaved(true)
    // Auto-fetch live model catalog when a key is saved
    if (keys.openrouter.trim()) {
      fetchModels()
    }
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  const filteredModels = availableModels.filter(m =>
    !modelSearch || m.id.toLowerCase().includes(modelSearch.toLowerCase()) || (m.name ?? '').toLowerCase().includes(modelSearch.toLowerCase())
  )

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.backdrop} />
      <div style={S.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(79,70,229,0.2))', border: '1px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Settings</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: 4, borderRadius: 6, display: 'flex', transition: 'color 0.1s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.25)'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Body */}
        <div style={S.body}>
          {/* Nav */}
          <div style={S.nav}>
            {TABS.map(({ id, label }) => {
              const active = tab === id
              return (
                <button key={id} onClick={() => setTab(id)} style={{
                  width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', fontSize: 12, marginBottom: 2,
                  background: active ? 'rgba(124,58,237,0.15)' : 'transparent',
                  color: active ? '#a78bfa' : 'rgba(255,255,255,0.3)', transition: 'all 0.1s'
                }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)' }}>
                  {label}
                </button>
              )
            })}
          </div>

          {/* Content */}
          <div style={S.content}>

            {/* ── PROVIDERS ── */}
            {tab === 'providers' && (
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, marginBottom: 16 }}>
                  Add your API keys. OpenRouter gives access to all models with a single key.
                </p>
                {([
                  { id: 'openrouter', label: 'OpenRouter', hint: 'sk-or-v1-...', sub: 'Claude, GPT-4, Gemini & 200+ models' },
                  { id: 'anthropic', label: 'Anthropic', hint: 'sk-ant-...', sub: 'Direct Claude access' },
                  { id: 'openai', label: 'OpenAI', hint: 'sk-...', sub: 'GPT-4o / o3 access' }
                ] as const).map(({ id, label, hint, sub }) => (
                  <KeyField key={id} label={label} sub={sub} value={keys[id]} placeholder={hint}
                    onChange={v => setKeys(k => ({ ...k, [id]: v }))} />
                ))}
              </div>
            )}

            {/* ── MODEL PICKER ── */}
            {tab === 'models' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    value={modelSearch}
                    onChange={e => setModelSearch(e.target.value)}
                    placeholder="Search models (claude, gpt, gemini, deepseek...)"
                    style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '7px 12px', fontSize: 12, color: 'rgba(255,255,255,0.7)', outline: 'none', fontFamily: 'monospace' }}
                  />
                  <button onClick={fetchModels} disabled={isLoadingModels}
                    style={{ padding: '7px 14px', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, cursor: isLoadingModels ? 'wait' : 'pointer', fontSize: 11, color: '#a78bfa', transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                    {isLoadingModels ? '⟳ Loading...' : lastFetchedAt ? '↻ Refresh' : '↓ Load All'}
                  </button>
                </div>
                {modelsError && (
                  <div style={{ fontSize: 11, color: '#fca5a5', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 12px' }}>
                    {modelsError}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                    {lastFetchedAt
                      ? `${availableModels.length} models · refreshed ${new Date(lastFetchedAt).toLocaleTimeString()}`
                      : `${availableModels.length} featured models · click "Load All" for full catalog`}
                  </div>
                  {isLoadingModels && (
                    <div style={{ width: 10, height: 10, border: '1.5px solid rgba(167,139,250,0.3)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320, overflowY: 'auto' }}>
                  {filteredModels.map(m => {
                    const isSelected = settings.preferredModel === m.id
                    const isFeatured = FEATURED_MODELS.some(f => f.id === m.id)
                    const inputCost = parseFloat(m.pricing?.prompt ?? '0') * 1e6
                    const ctxK = m.context_length >= 1000 ? `${(m.context_length / 1000).toFixed(0)}k` : String(m.context_length)
                    return (
                      <button key={m.id} onClick={() => updateSettings({ preferredModel: m.id })}
                        style={{
                          textAlign: 'left', padding: '8px 12px', borderRadius: 8, border: 'none',
                          background: isSelected ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.02)',
                          cursor: 'pointer', transition: 'all 0.1s',
                          outline: isSelected ? '1px solid rgba(124,58,237,0.35)' : 'none'
                        }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
                        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isSelected && <span style={{ color: '#22c55e', fontSize: 10 }}>●</span>}
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: isSelected ? '#c4b5fd' : 'rgba(255,255,255,0.75)' }}>{m.id}</span>
                            {isFeatured && !lastFetchedAt && (
                              <span style={{ fontSize: 9, color: '#a78bfa', background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 4, padding: '1px 5px' }}>★</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8, fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)' }}>
                            {m.context_length && <span>{ctxK} ctx</span>}
                            {inputCost > 0 && <span>${inputCost.toFixed(2)}/M</span>}
                          </div>
                        </div>
                        {m.name && m.name !== m.id && (
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2, marginLeft: isSelected ? 14 : 0 }}>{m.name}</div>
                        )}
                      </button>
                    )
                  })}
                  {filteredModels.length === 0 && !isLoadingModels && (
                    <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>
                      No models match your search
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── ROLE → MODEL ── */}
            {tab === 'roles' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>Role → Model Assignment</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
                      Route each AI role to the best model for that task.
                    </div>
                  </div>
                  <button onClick={resetRoleModels}
                    style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                    Reset defaults
                  </button>
                </div>
                {ROLES.map(role => (
                  <RoleModelRow
                    key={role}
                    role={role}
                    currentModel={roleModels[role]}
                    defaultModel={DEFAULT_ROLE_MODELS[role]}
                    description={ROLE_DESCRIPTIONS[role]}
                    models={availableModels}
                    isLoadingModels={isLoadingModels}
                    onChange={modelId => setRoleModel(role, modelId)}
                  />
                ))}
                {availableModels.length === 0 && (
                  <div style={{ marginTop: 12, padding: 16, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 10, fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
                    Go to "Model Picker" tab and click "Load Models" to populate the dropdowns
                  </div>
                )}
              </div>
            )}

            {/* ── EDITOR ── */}
            {tab === 'editor' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Font Size</label>
                  <input type="number" min={10} max={24} value={settings.fontSize}
                    onChange={e => updateSettings({ fontSize: Number(e.target.value) })}
                    style={{ width: 80, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'rgba(255,255,255,0.7)', outline: 'none', fontFamily: 'monospace' }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Font Family</label>
                  <select value={settings.fontFamily} onChange={e => updateSettings({ fontFamily: e.target.value })}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'rgba(255,255,255,0.7)', outline: 'none', width: '100%' }}>
                    <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                    <option value="'Fira Code', monospace">Fira Code</option>
                    <option value="'SF Mono', monospace">SF Mono</option>
                    <option value="monospace">System Mono</option>
                  </select>
                </div>
              </div>
            )}

            {/* ── GOVERNANCE ── */}
            {tab === 'governance' && (
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, marginBottom: 16 }}>
                  Governance protocol runs automatically on all AI requests when a project is open.
                </p>
                <Toggle label="Strict Mode" sub="Block execution on any high-severity finding (not just critical)" value={settings.governanceStrictMode} onChange={v => updateSettings({ governanceStrictMode: v })} />
                <Toggle label="Pipeline on Save" sub="Run governance checks when saving a file" value={settings.pipelineOnSave} onChange={v => updateSettings({ pipelineOnSave: v })} />
                <Toggle label="Auto-run Pipeline" sub="Automatically apply approved changes without confirmation" value={settings.autoRunPipeline} onChange={v => updateSettings({ autoRunPipeline: v })} />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button onClick={onClose}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 8 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}>
            Cancel
          </button>
          <button onClick={save}
            style={{ fontSize: 12, background: saved ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg, #7c3aed, #4f46e5)', border: saved ? '1px solid rgba(34,197,94,0.4)' : 'none', color: saved ? '#22c55e' : 'white', padding: '7px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}>
            {saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RoleModelRow({ role, currentModel, defaultModel, description, models, isLoadingModels, onChange }: {
  role: ModelRole
  currentModel: string
  defaultModel: string
  description: string
  models: any[]
  isLoadingModels: boolean
  onChange: (modelId: string) => void
}) {
  const isModified = currentModel !== defaultModel
  return (
    <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: `1px solid ${isModified ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.05)'}`, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: isModified ? '#a78bfa' : 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{role}</span>
          {isModified && <span style={{ fontSize: 9, color: '#a78bfa', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 4, padding: '1px 5px' }}>custom</span>}
        </div>
        {isModified && (
          <button onClick={() => onChange(defaultModel)}
            style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', background: 'none', border: 'none', cursor: 'pointer' }}>
            reset
          </button>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginBottom: 6, lineHeight: 1.4 }}>{description}</div>
      {models.length > 0 ? (
        <select
          value={currentModel}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: 'rgba(255,255,255,0.65)', outline: 'none', fontFamily: 'monospace' }}>
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
      ) : (
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: isLoadingModels ? '#a78bfa' : 'rgba(255,255,255,0.3)', padding: '4px 0' }}>
          {isLoadingModels ? 'Loading models...' : currentModel}
        </div>
      )}
    </div>
  )
}

function KeyField({ label, sub, value, placeholder, onChange }: {
  label: string; sub: string; value: string; placeholder: string; onChange: (v: string) => void
}) {
  const [show, setShow] = useState(false)
  const hasFilled = value.length > 0
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <label style={{ fontSize: 12, color: hasFilled ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.5)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          {hasFilled && <span style={{ color: '#22c55e', fontSize: 10 }}>●</span>}
          {label}
        </label>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{sub}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: `1px solid ${hasFilled ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', outline: 'none', transition: 'border-color 0.2s' }}
          onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.6)'}
          onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = hasFilled ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'} />
        <button onClick={() => setShow(v => !v)}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, cursor: 'pointer', padding: '0 12px', color: 'rgba(255,255,255,0.3)', fontSize: 11, transition: 'all 0.1s' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}>
          {show ? 'hide' : 'show'}
        </button>
      </div>
    </div>
  )
}

function Toggle({ label, sub, value, onChange }: { label: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>{sub}</div>
      </div>
      <button onClick={() => onChange(!value)}
        style={{ position: 'relative', width: 36, height: 20, borderRadius: 99, border: 'none', cursor: 'pointer', background: value ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.08)', transition: 'background 0.2s', flexShrink: 0, boxShadow: value ? '0 0 12px rgba(124,58,237,0.4)' : 'none' }}>
        <span style={{ position: 'absolute', top: 3, left: value ? 17 : 3, width: 14, height: 14, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
      </button>
    </div>
  )
}
