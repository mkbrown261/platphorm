import { useState, useEffect } from 'react'
import { ActivityBar } from './components/layout/ActivityBar'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { EditorArea } from './components/editor/EditorArea'
import { AIPanel } from './components/ai/AIPanel'
import { useAIStore } from './store/aiStore'
import { useGovernanceStore } from './store/governanceStore'
import { useDNAStore } from './store/dnaStore'
import { useProjectStore } from './store/projectStore'
import { orchestrator, setRoleModelOverrides, setIdentityContext } from './core/providers/AIOrchestrator'
import { wireGovernanceStore } from './core/governance/GovernanceEngine'
import { SettingsModal } from './components/settings/SettingsModal'
import { useModelStore } from './store/modelStore'

export default function App() {
  const [panel, setPanel] = useState('files')
  const [showSettings, setShowSettings] = useState(false)
  const { settings, updateSettings, setConfigured } = useAIStore()
  const { appendAudit, addEvent } = useGovernanceStore()
  const { roleModels, setAvailableModels, setLoadingModels } = useModelStore()
  const { dna } = useDNAStore()
  const { activeProject, refreshFileTree } = useProjectStore()

  // Wire GovernanceEngine → governanceStore
  useEffect(() => {
    wireGovernanceStore(
      (entry) => appendAudit(entry),
      (event) => addEvent(event)
    )
  }, [])

  // Sync role model overrides into orchestrator on mount and on change
  useEffect(() => {
    setRoleModelOverrides(roleModels)
  }, [roleModels])

  // Sync DNA into UnifiedIdentity context whenever it changes
  useEffect(() => {
    setIdentityContext({ dna })
  }, [dna])

  // ── On startup: restore persisted API keys into the orchestrator ──────────
  // The zustand persist middleware restores settings from localStorage, but the
  // orchestrator is a plain class instance that resets on every app launch.
  // We need to re-register all saved API keys with it.
  useEffect(() => {
    const { providers, preferredProvider } = settings

    // Re-register any saved provider keys
    if (providers.openrouter?.trim()) {
      orchestrator.addProvider({ provider: 'openrouter', apiKey: providers.openrouter.trim() })
      setConfigured(true)
    }
    if (providers.anthropic?.trim()) {
      orchestrator.addProvider({ provider: 'anthropic', apiKey: providers.anthropic.trim() })
      setConfigured(true)
    }
    if (providers.openai?.trim()) {
      orchestrator.addProvider({ provider: 'openai', apiKey: providers.openai.trim() })
      setConfigured(true)
    }

    // Env key override (dev convenience — takes priority if set)
    const envKey = import.meta.env.VITE_OPENROUTER_API_KEY
    if (envKey) {
      orchestrator.addProvider({ provider: 'openrouter', apiKey: envKey })
      updateSettings({ providers: { ...providers, openrouter: envKey }, preferredProvider: 'openrouter' })
      setConfigured(true)
    }

    // Auto-fetch the live model catalog if we have a key
    const apiKey = envKey || providers.openrouter
    if (apiKey) {
      autoFetchModels(apiKey)
    }
  }, []) // run once on mount — settings already hydrated from localStorage by this point

  const autoFetchModels = async (apiKey: string) => {
    try {
      setLoadingModels(true)
      const res = await window.api.ai.listModels(apiKey)
      if (res.success && res.data) {
        const data = res.data as any
        const models = (data.data ?? [])
          .filter((m: any) => m.id && m.pricing)
          .sort((a: any, b: any) => a.id.localeCompare(b.id))
        if (models.length > 0) setAvailableModels(models)
      }
    } catch {
      // Silently fail — FEATURED_MODELS is the fallback
    } finally {
      setLoadingModels(false)
    }
  }

  // Rebuild file tree from disk on startup if a project was persisted
  useEffect(() => {
    if (activeProject?.rootPath) refreshFileTree()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcut for settings
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
