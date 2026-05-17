/**
 * PreviewPanel — Live preview of the user's project.
 *
 * Uses the Electron-native approach: the main process spawns the project's
 * dev server (npm run dev / vite / yarn dev) as a real child process and
 * returns the localhost URL. This panel renders that URL in a <webview> tag,
 * giving a real browser environment with full npm support, hot reload, etc.
 *
 * This is strictly better than Babel-in-iframe because:
 * - No package resolution limitations (all node_modules work)
 * - Hot module replacement works natively
 * - TypeScript, CSS modules, path aliases all work via the project's vite config
 * - Zero overhead in the renderer process
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useProjectStore } from '../../store/projectStore'

type PreviewState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'running'; url: string; port: number }
  | { status: 'error'; message: string }

export function PreviewPanel() {
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const [refreshKey, setRefreshKey] = useState(0)
  const webviewRef = useRef<any>(null)
  const { activeProject } = useProjectStore()

  // Check if a server is already running for this project on mount
  useEffect(() => {
    if (!activeProject) return
    window.api.preview.status(activeProject.rootPath).then(s => {
      if (s.running && s.url) {
        setPreview({ status: 'running', url: s.url, port: s.port! })
      }
    }).catch(() => {})
  }, [activeProject?.rootPath])

  // Stop server when project changes
  useEffect(() => {
    return () => {
      if (activeProject) {
        window.api.preview.stop(activeProject.rootPath).catch(() => {})
      }
    }
  }, [activeProject?.rootPath])

  const startPreview = useCallback(async () => {
    if (!activeProject) return
    setPreview({ status: 'starting' })
    try {
      const result = await window.api.preview.start(activeProject.rootPath)
      if (result.success && result.url) {
        setPreview({ status: 'running', url: result.url, port: result.port! })
      } else {
        setPreview({ status: 'error', message: result.error ?? 'Failed to start dev server' })
      }
    } catch (err) {
      setPreview({ status: 'error', message: String(err) })
    }
  }, [activeProject])

  const stopPreview = useCallback(async () => {
    if (!activeProject) return
    await window.api.preview.stop(activeProject.rootPath).catch(() => {})
    setPreview({ status: 'idle' })
  }, [activeProject])

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  const openExternal = useCallback(() => {
    if (preview.status === 'running') {
      window.api.shell.openExternal(preview.url).catch(() => {})
    }
  }, [preview])

  if (!activeProject) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>
          <BrowserIcon />
        </div>
        <div style={styles.emptyTitle}>No project open</div>
        <div style={styles.emptyDesc}>Open a project to preview it here</div>
      </div>
    )
  }

  return (
    <div style={styles.root}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          {/* Status dot */}
          <div style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: preview.status === 'running' ? '#22c55e'
              : preview.status === 'starting' ? '#f59e0b'
              : preview.status === 'error' ? '#ef4444'
              : 'rgba(255,255,255,0.2)',
            boxShadow: preview.status === 'running' ? '0 0 6px #22c55e' : 'none',
            transition: 'all 0.3s'
          }} />
          {/* URL bar */}
          <div style={styles.urlBar}>
            {preview.status === 'running'
              ? <span style={{ color: 'rgba(167,139,250,0.7)', fontFamily: 'monospace', fontSize: 11 }}>{preview.url}</span>
              : preview.status === 'starting'
                ? <span style={{ color: 'rgba(245,158,11,0.7)', fontSize: 11, fontStyle: 'italic' }}>Starting dev server...</span>
                : preview.status === 'error'
                  ? <span style={{ color: 'rgba(239,68,68,0.7)', fontSize: 11 }}>Error — see details below</span>
                  : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>Server not running</span>
            }
          </div>
        </div>

        <div style={styles.toolbarRight}>
          {preview.status === 'running' && (
            <>
              <ToolBtn onClick={refresh} title="Refresh">
                <RefreshIcon />
              </ToolBtn>
              <ToolBtn onClick={openExternal} title="Open in browser">
                <ExternalIcon />
              </ToolBtn>
              <ToolBtn onClick={stopPreview} title="Stop server" danger>
                <StopIcon />
              </ToolBtn>
            </>
          )}
          {(preview.status === 'idle' || preview.status === 'error') && (
            <button onClick={startPreview} style={styles.startBtn}>
              <PlayIcon />
              <span>Start Preview</span>
            </button>
          )}
          {preview.status === 'starting' && (
            <div style={styles.spinner} />
          )}
        </div>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {preview.status === 'running' && (
          // Electron webview — renders the actual localhost dev server.
          // The key forces a remount (full reload) when refresh is clicked.
          <webview
            key={`${preview.url}-${refreshKey}`}
            ref={webviewRef}
            src={preview.url}
            style={{ width: '100%', height: '100%', border: 'none' }}
            // Allow the webview to load localhost URLs
            webpreferences="allowRunningInsecureContent=yes, javascript=yes"
          />
        )}

        {preview.status === 'idle' && (
          <div style={styles.placeholder}>
            <div style={styles.placeholderIcon}><BrowserIcon /></div>
            <div style={styles.placeholderTitle}>Preview your project</div>
            <div style={styles.placeholderDesc}>
              Starts your project's dev server ({detectScript(activeProject.rootPath)}) and
              renders it here. Hot reload works — changes appear instantly.
            </div>
            <button onClick={startPreview} style={styles.startBtnLarge}>
              <PlayIcon />
              Start Preview
            </button>
          </div>
        )}

        {preview.status === 'starting' && (
          <div style={styles.placeholder}>
            <div style={{ ...styles.placeholderIcon, animation: 'spin 1.2s linear infinite' }}>
              <RefreshIcon />
            </div>
            <div style={styles.placeholderTitle}>Starting dev server...</div>
            <div style={styles.placeholderDesc}>
              Running <code style={{ fontFamily: 'monospace', color: 'rgba(167,139,250,0.7)' }}>{detectScript(activeProject.rootPath)}</code>
              <br />This usually takes 5–15 seconds.
            </div>
          </div>
        )}

        {preview.status === 'error' && (
          <div style={styles.placeholder}>
            <div style={{ ...styles.placeholderIcon, color: '#f87171' }}>⚠</div>
            <div style={{ ...styles.placeholderTitle, color: '#f87171' }}>Failed to start</div>
            <div style={styles.placeholderDesc}>{preview.message}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 8, lineHeight: 1.6, maxWidth: 300, textAlign: 'center' }}>
              Make sure <code style={{ fontFamily: 'monospace' }}>npm install</code> has been run in the project and a dev script exists in package.json.
            </div>
            <button onClick={startPreview} style={styles.startBtnLarge}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectScript(projectPath: string): string {
  // Can't read fs synchronously here — just show a sensible default
  return 'npm run dev'
}

function ToolBtn({ onClick, title, danger, children }: {
  onClick: () => void; title: string; danger?: boolean; children: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
        background: hover ? (danger ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.08)') : 'transparent',
        color: hover ? (danger ? '#f87171' : 'rgba(255,255,255,0.7)') : 'rgba(255,255,255,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s'
      }}
    >
      {children}
    </button>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function BrowserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="18" rx="2"/>
      <line x1="2" y1="9" x2="22" y2="9"/>
      <line x1="8" y1="3" x2="8" y2="9"/>
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5,3 19,12 5,21"/>
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
    </svg>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  root: {
    display: 'flex', flexDirection: 'column' as const,
    height: '100%', background: '#0b0c14', overflow: 'hidden'
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    height: 38, padding: '0 10px', flexShrink: 0,
    background: '#08090f', borderBottom: '1px solid rgba(255,255,255,0.07)',
    gap: 8
  },
  toolbarLeft: {
    display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0
  },
  toolbarRight: {
    display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0
  },
  urlBar: {
    flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
    padding: '3px 10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const
  },
  startBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: 'white',
    fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
    boxShadow: '0 0 10px rgba(124,58,237,0.3)', transition: 'box-shadow 0.2s'
  },
  startBtnLarge: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '9px 20px', borderRadius: 9, border: 'none', cursor: 'pointer',
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: 'white',
    fontSize: 13, fontWeight: 600, fontFamily: 'inherit', marginTop: 16,
    boxShadow: '0 0 20px rgba(124,58,237,0.35)'
  },
  spinner: {
    width: 16, height: 16, borderRadius: '50%',
    border: '2px solid rgba(167,139,250,0.2)', borderTopColor: '#a78bfa',
    animation: 'spin 0.7s linear infinite'
  },
  empty: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    justifyContent: 'center', flex: 1, gap: 10, color: 'rgba(255,255,255,0.2)',
    height: '100%'
  },
  emptyIcon: { fontSize: 32, color: 'rgba(255,255,255,0.1)', marginBottom: 4 },
  emptyTitle: { fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.3)' },
  emptyDesc: { fontSize: 11, color: 'rgba(255,255,255,0.15)' },
  placeholder: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    justifyContent: 'center', height: '100%', gap: 10, padding: 32, textAlign: 'center' as const
  },
  placeholderIcon: {
    fontSize: 36, color: 'rgba(124,58,237,0.4)', marginBottom: 8
  },
  placeholderTitle: {
    fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.55)'
  },
  placeholderDesc: {
    fontSize: 12, color: 'rgba(255,255,255,0.25)', lineHeight: 1.65, maxWidth: 300
  }
}
