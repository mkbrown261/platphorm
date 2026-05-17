import { useState, useEffect } from 'react'
import { useAIStore } from '../../store/aiStore'
import { orchestrator } from '../../core/providers/AIOrchestrator'

interface Props { onClose: () => void }

const S = {
  overlay: { position: 'fixed' as const, inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute' as const, inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' },
  modal: {
    position: 'relative' as const, width: 560,
    background: '#0d0e1a',
    border: '1px solid rgba(124,58,237,0.2)',
    borderRadius: 16, overflow: 'hidden',
    boxShadow: '0 0 80px rgba(124,58,237,0.15), 0 40px 60px rgba(0,0,0,0.6)'
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)'
  },
  body: { display: 'flex', height: 340 },
  nav: { width: 148, borderRight: '1px solid rgba(255,255,255,0.06)', padding: 8, flexShrink: 0 },
  content: { flex: 1, padding: 20, overflowY: 'auto' as const },
  footer: {
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
    padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.06)'
  }
}

export function SettingsModal({ onClose }: Props) {
  const { settings, updateSettings, setConfigured } = useAIStore()
  const [keys, setKeys] = useState({
    openrouter: settings.providers.openrouter ?? '',
    anthropic: settings.providers.anthropic ?? '',
    openai: settings.providers.openai ?? ''
  })
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'providers' | 'editor' | 'governance'>('providers')

  // On mount: prefer persisted keys from electron-store over env var
  useEffect(() => {
    window.api.store.get('providers').then((persisted: any) => {
      if (persisted && typeof persisted === 'object') {
        setKeys(k => ({
          openrouter: persisted.openrouter || k.openrouter,
          anthropic:  persisted.anthropic  || k.anthropic,
          openai:     persisted.openai     || k.openai
        }))
      } else {
        // Fall back to env var only if no persisted keys exist
        const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
        if (envKey) setKeys(k => ({ ...k, openrouter: k.openrouter || envKey }))
      }
    }).catch(() => {
      const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
      if (envKey) setKeys(k => ({ ...k, openrouter: k.openrouter || envKey }))
    })
  }, [])

  const save = async () => {
    const trimmed = {
      openrouter: keys.openrouter.trim(),
      anthropic:  keys.anthropic.trim(),
      openai:     keys.openai.trim()
    }
    // Register active providers with orchestrator
    Object.entries(trimmed).forEach(([provider, key]) => {
      if (key) orchestrator.addProvider({ provider: provider as any, apiKey: key })
    })
    const preferred = trimmed.openrouter ? 'openrouter'
      : trimmed.anthropic ? 'anthropic'
      : trimmed.openai    ? 'openai'
      : settings.preferredProvider
    updateSettings({ providers: trimmed, preferredProvider: preferred })
    setConfigured(Object.values(trimmed).some(k => k.length > 0))

    // Persist to electron-store so keys survive app restarts
    await window.api.store.set('providers', trimmed).catch(() => {})
    await window.api.store.set('preferredProvider', preferred).catch(() => {})

    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.backdrop} />
      <div style={S.modal} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(79,70,229,0.2))', border: '1px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.8)" strokeWidth="1.8">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Settings</span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', padding: 4, borderRadius: 6, display: 'flex', transition: 'color 0.1s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.25)'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={S.body}>
          {/* Nav */}
          <div style={S.nav}>
            {(['providers', 'editor', 'governance'] as const).map(id => {
              const labels = { providers: 'AI Providers', editor: 'Editor', governance: 'Governance' }
              const active = tab === id
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 10px',
                    borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 12, marginBottom: 2, transition: 'all 0.1s',
                    background: active ? 'rgba(124,58,237,0.15)' : 'transparent',
                    color: active ? '#a78bfa' : 'rgba(255,255,255,0.3)'
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)' }}
                >
                  {labels[id]}
                </button>
              )
            })}
          </div>

          {/* Content */}
          <div style={S.content}>
            {tab === 'providers' && (
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, marginBottom: 16 }}>
                  Add your API keys. OpenRouter gives access to all models with a single key.
                </p>
                {([
                  { id: 'openrouter', label: 'OpenRouter', hint: 'sk-or-v1-...', sub: 'Claude, GPT-4, Gemini & more' },
                  { id: 'anthropic',  label: 'Anthropic',  hint: 'sk-ant-...',   sub: 'Direct Claude access' },
                  { id: 'openai',     label: 'OpenAI',     hint: 'sk-...',        sub: 'GPT-4 / o3 access' }
                ] as const).map(({ id, label, hint, sub }) => (
                  <KeyField
                    key={id} label={label} sub={sub}
                    value={keys[id]} placeholder={hint}
                    onChange={v => setKeys(k => ({ ...k, [id]: v }))}
                  />
                ))}
              </div>
            )}

            {tab === 'editor' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Font Size</label>
                  <input
                    type="number" min={10} max={24}
                    value={settings.fontSize}
                    onChange={e => updateSettings({ fontSize: Number(e.target.value) })}
                    style={{ width: 80, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'rgba(255,255,255,0.7)', outline: 'none', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6 }}>Font Family</label>
                  <select
                    value={settings.fontFamily}
                    onChange={e => updateSettings({ fontFamily: e.target.value })}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'rgba(255,255,255,0.7)', outline: 'none', width: '100%' }}
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
              <div>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6, marginBottom: 16 }}>
                  Governance protocol runs automatically on all AI requests when a project is open.
                </p>
                <Toggle label="Strict Mode" sub="Block execution on any high-severity finding" value={settings.governanceStrictMode} onChange={v => updateSettings({ governanceStrictMode: v })} />
                <Toggle label="Pipeline on Save" sub="Run governance checks when saving a file" value={settings.pipelineOnSave} onChange={v => updateSettings({ pipelineOnSave: v })} />
                <Toggle label="Auto-run Pipeline" sub="Automatically apply approved changes" value={settings.autoRunPipeline} onChange={v => updateSettings({ autoRunPipeline: v })} />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <button
            onClick={onClose}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 8, transition: 'color 0.1s' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}
          >
            Cancel
          </button>
          <button
            onClick={save}
            style={{ fontSize: 12, background: saved ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg, #7c3aed, #4f46e5)', border: saved ? '1px solid rgba(34,197,94,0.4)' : 'none', color: saved ? '#22c55e' : 'white', padding: '7px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s' }}
          >
            {saved ? '✓ Saved' : 'Save Changes'}
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
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: `1px solid ${hasFilled ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.7)', fontFamily: 'monospace', outline: 'none', transition: 'border-color 0.2s' }}
          onFocus={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.6)'}
          onBlur={e => (e.currentTarget as HTMLElement).style.borderColor = hasFilled ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.08)'}
        />
        <button
          onClick={() => setShow(v => !v)}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, cursor: 'pointer', padding: '0 12px', color: 'rgba(255,255,255,0.3)', fontSize: 11, transition: 'all 0.1s' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'}
        >
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>{sub}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        style={{ position: 'relative', width: 36, height: 20, borderRadius: 99, border: 'none', cursor: 'pointer', background: value ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(255,255,255,0.08)', transition: 'background 0.2s', flexShrink: 0, boxShadow: value ? '0 0 12px rgba(124,58,237,0.4)' : 'none' }}
      >
        <span style={{ position: 'absolute', top: 3, left: value ? 17 : 3, width: 14, height: 14, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }} />
      </button>
    </div>
  )
}
