import { useState, useEffect } from 'react'
import { ActivityBar } from './components/layout/ActivityBar'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { EditorArea } from './components/editor/EditorArea'
import { AIPanel } from './components/ai/AIPanel'
import { useAIStore } from './store/aiStore'
import { orchestrator } from './core/providers/AIOrchestrator'
import { SettingsModal } from './components/settings/SettingsModal'

export default function App() {
  const [panel, setPanel] = useState('files')
  const [showSettings, setShowSettings] = useState(false)
  const { settings, updateSettings, setConfigured } = useAIStore()

  useEffect(() => {
    // Restore runtime-saved API keys from electron-store first,
    // then fall back to build-time env var if nothing is persisted.
    const applyEnvFallback = (existingProviders: Record<string, string>) => {
      const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
      const hasAnyKey = Object.values(existingProviders).some(k => !!k)
      if (envKey && !hasAnyKey) {
        orchestrator.addProvider({ provider: 'openrouter', apiKey: envKey })
        updateSettings({ providers: { openrouter: envKey }, preferredProvider: 'openrouter' })
        setConfigured(true)
      }
    }

    if (typeof window !== 'undefined' && window.api?.store) {
      window.api.store.getAll().then((stored: Record<string, unknown>) => {
        const providers = (stored.providers ?? {}) as Record<string, string>
        const preferred = (stored.preferredProvider as string) || 'openrouter'

        const hasAnyKey = Object.values(providers).some(k => !!k)
        if (hasAnyKey) {
          // Wire every persisted provider key + preferred into the orchestrator
          orchestrator.configure({ providers, preferredProvider: preferred })
          updateSettings({ providers, preferredProvider: preferred })
          setConfigured(true)
        } else {
          // Nothing in electron-store — try build-time env var
          applyEnvFallback(providers)
        }
      }).catch(() => {
        // electron-store unavailable (e.g. browser-only preview); use env var
        applyEnvFallback({})
      })
    } else {
      // Running outside Electron (e.g. Vite dev server preview)
      applyEnvFallback({})
    }
  }, [])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); setShowSettings(v => !v) }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#08090f', color: '#e2e8f0', overflow: 'hidden', fontFamily: 'Inter, -apple-system, sans-serif' }}>

      {/* Title bar */}
      <div
        style={{ height: 40, display: 'flex', alignItems: 'center', background: '#06070d', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0, WebkitAppRegion: 'drag' } as any}
      >
        <div style={{ marginLeft: 80, display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' } as any}>
          {/* Logo mark */}
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 12px rgba(124,58,237,0.5)' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'white', letterSpacing: -0.5 }}>P</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', letterSpacing: 3, textTransform: 'uppercase' }}>PLATPHORM</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <ActivityBar active={panel} onChange={(id) => id === 'settings' ? setShowSettings(true) : setPanel(id)} />
        <Sidebar panel={panel} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <EditorArea />
        </div>
        <AIPanel />
      </div>

      <StatusBar />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
