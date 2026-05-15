/**
 * PREVIEW PANEL
 *
 * Live preview renderer for any content PLATPHORM creates.
 * Like the Genspark preview — click it, see what was built.
 *
 * Modes:
 * 1. INLINE IFRAME — renders HTML/CSS/JS inside the editor area (sandbox)
 * 2. POPUP WINDOW — opens a new Electron window for full-screen preview
 * 3. FILE PREVIEW — reads a file from disk and renders it
 *
 * Supports: HTML, CSS (wrapped), JS (sandboxed), React (via CDN), Markdown
 * Auto-detects content type and wraps appropriately.
 */

import { useState, useRef, useEffect, useCallback } from 'react'

export interface PreviewContent {
  html?: string
  css?: string
  js?: string
  title?: string
  filePath?: string
  raw?: string          // Already-complete HTML document
  language?: string     // For syntax-highlighted code preview
}

interface Props {
  content: PreviewContent
  onClose?: () => void
  embedded?: boolean    // true = inside EditorArea tab, false = floating panel
}

// ─── Content assembler ────────────────────────────────────────────────────────

function buildPreviewDocument(content: PreviewContent): string {
  // Already a complete HTML document
  if (content.raw && content.raw.trimStart().startsWith('<!DOCTYPE') || content.raw?.trimStart().startsWith('<html')) {
    return content.raw!
  }

  // Build from parts
  const css = content.css ?? ''
  const js = content.js ?? ''
  const html = content.html ?? content.raw ?? ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.title ?? 'Preview'}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    ${css}
  </style>
</head>
<body>
  ${html}
  ${js ? `<script>\n${js}\n</script>` : ''}
</body>
</html>`
}

function buildMarkdownDocument(markdown: string): string {
  // Simple markdown-to-HTML (no dependency on external lib)
  const escaped = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  const html = escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/```[\w]*\n([\s\S]*?)```/gm, '<pre><code>$1</code></pre>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[h|u|p|l|c])/gm, '')

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: -apple-system, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.65; }
  h1,h2,h3 { font-weight: 600; margin-top: 2em; }
  code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  ul { padding-left: 1.5em; }
  li { margin: 4px 0; }
</style>
</head><body><p>${html}</p></body></html>`
}

function wrapCodeForPreview(code: string, language: string): string {
  const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<style>
  body { margin: 0; background: #0d1117; }
  pre { margin: 0; padding: 24px; min-height: 100vh; }
  code { font-size: 13px; line-height: 1.6; }
</style>
</head><body>
<pre><code class="language-${language}">${escaped}</code></pre>
<script>hljs.highlightAll();</script>
</body></html>`
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PreviewPanel({ content, onClose, embedded = true }: Props) {
  const [loading, setLoading] = useState(true)
  const [popoutLoading, setPopoutLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build the document to render
  const getDocument = useCallback((): string => {
    if (content.filePath) return '' // loaded asynchronously
    if (content.language === 'markdown') return buildMarkdownDocument(content.raw ?? content.html ?? '')
    if (content.language && content.language !== 'html') return wrapCodeForPreview(content.raw ?? content.html ?? '', content.language)
    return buildPreviewDocument(content)
  }, [content])

  const [srcdoc, setSrcdoc] = useState<string>(() => getDocument())

  // Load from file if filePath provided
  useEffect(() => {
    if (!content.filePath) {
      setSrcdoc(getDocument())
      return
    }

    setLoading(true)
    ;(window as any).api?.preview?.readForPreview(content.filePath).then((res: any) => {
      if (res?.success && res.content) {
        const ext = res.ext?.replace('.', '') ?? 'html'
        if (ext === 'html' || ext === 'htm') {
          setSrcdoc(res.content)
        } else if (ext === 'md') {
          setSrcdoc(buildMarkdownDocument(res.content))
        } else {
          setSrcdoc(wrapCodeForPreview(res.content, ext))
        }
        setError(null)
      } else {
        setError(res?.error ?? 'Could not read file for preview')
      }
      setLoading(false)
    }).catch((err: any) => {
      setError(String(err))
      setLoading(false)
    })
  }, [content.filePath, refreshKey])

  useEffect(() => {
    if (!content.filePath) {
      setSrcdoc(getDocument())
      setLoading(false)
    }
  }, [content, refreshKey])

  const handlePopout = async () => {
    setPopoutLoading(true)
    try {
      const doc = srcdoc
      await (window as any).api?.preview?.open(doc, content.title ?? 'PLATPHORM Preview')
    } catch {
      // fallback: open in system browser via data URL
    }
    setPopoutLoading(false)
  }

  const handleRefresh = () => setRefreshKey(k => k + 1)

  const handleIframeLoad = () => setLoading(false)

  const zoomIn = () => setScale(s => Math.min(s + 0.1, 2))
  const zoomOut = () => setScale(s => Math.max(s - 0.1, 0.3))
  const zoomReset = () => setScale(1)

  // ─── Toolbar ───────────────────────────────────────────────────────────────

  const Toolbar = () => (
    <div style={{
      height: 36, flexShrink: 0,
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '0 10px',
      background: '#0f1016',
      borderBottom: '1px solid rgba(255,255,255,0.07)'
    }}>
      {/* Status dot */}
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: loading ? '#f59e0b' : error ? '#ef4444' : '#22c55e', flexShrink: 0 }} />

      {/* Title */}
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 6 }}>
        {content.title ?? content.filePath?.split('/').pop() ?? 'Preview'}
      </span>

      {/* Zoom */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <button onClick={zoomOut} title="Zoom out" style={toolBtnStyle}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button onClick={zoomReset} title="Reset zoom" style={{ ...toolBtnStyle, fontSize: 9, fontFamily: 'monospace', minWidth: 36 }}>
          {Math.round(scale * 100)}%
        </button>
        <button onClick={zoomIn} title="Zoom in" style={toolBtnStyle}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />

      {/* Refresh */}
      <button onClick={handleRefresh} title="Refresh preview" style={toolBtnStyle}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>

      {/* Popout */}
      <button onClick={handlePopout} disabled={popoutLoading} title="Open in window" style={toolBtnStyle}>
        {popoutLoading
          ? <div style={{ width: 10, height: 10, border: '1.5px solid rgba(255,255,255,0.2)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        }
      </button>

      {/* Close (only in embedded mode with onClose) */}
      {onClose && (
        <button onClick={onClose} title="Close preview" style={{ ...toolBtnStyle, marginLeft: 4 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      )}
    </div>
  )

  // ─── Render ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0b13' }}>
        <Toolbar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>Preview Error</div>
            <div style={{ fontSize: 11, color: 'rgba(239,68,68,0.7)', fontFamily: 'monospace' }}>{error}</div>
          </div>
          <button onClick={handleRefresh} style={{ fontSize: 11, color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 7, padding: '6px 14px', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0b13', overflow: 'hidden' }}>
      <Toolbar />

      {/* Iframe container */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#fff' }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#0a0b13'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(124,58,237,0.2)', borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>Rendering preview...</span>
            </div>
          </div>
        )}

        <div style={{
          width: '100%',
          height: '100%',
          overflow: 'auto',
          display: 'flex',
          alignItems: scale < 1 ? 'flex-start' : 'stretch',
          justifyContent: scale < 1 ? 'center' : 'stretch',
        }}>
          <iframe
            ref={iframeRef}
            srcDoc={srcdoc}
            onLoad={handleIframeLoad}
            title="PLATPHORM Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            style={{
              border: 'none',
              background: 'white',
              flexShrink: 0,
              transformOrigin: 'top left',
              transform: `scale(${scale})`,
              width: scale !== 1 ? `${100 / scale}%` : '100%',
              height: scale !== 1 ? `${100 / scale}%` : '100%',
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const toolBtnStyle: React.CSSProperties = {
  width: 26, height: 26,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  cursor: 'pointer',
  color: 'rgba(255,255,255,0.35)',
  transition: 'all 0.12s',
  flexShrink: 0,
  padding: 0,
}

// ─── Preview button (used in AIPanel and EditorArea) ─────────────────────────

export interface PreviewTriggerProps {
  content: PreviewContent
  label?: string
  small?: boolean
}

/**
 * A button that opens a preview. Use this wherever you want "click to preview."
 * Renders the preview inline by opening a new editor-area tab, or pops out a window.
 */
export function PreviewButton({ content, label = 'Preview ↗', small = false }: PreviewTriggerProps) {
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      const doc = buildPreviewDocument(content)
      await (window as any).api?.preview?.open(doc, content.title ?? 'PLATPHORM Preview')
    } catch {
      // Fallback: nothing
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        fontSize: small ? 10 : 11,
        color: '#22c55e',
        background: 'rgba(34,197,94,0.08)',
        border: '1px solid rgba(34,197,94,0.2)',
        borderRadius: 99,
        padding: small ? '2px 8px' : '3px 12px',
        cursor: loading ? 'wait' : 'pointer',
        fontFamily: 'monospace',
        display: 'flex', alignItems: 'center', gap: 4,
        transition: 'all 0.15s'
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.15)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(34,197,94,0.08)'}
    >
      {loading
        ? <div style={{ width: 8, height: 8, border: '1.5px solid rgba(34,197,94,0.3)', borderTopColor: '#22c55e', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      }
      {label}
    </button>
  )
}
