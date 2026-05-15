import Editor, { type Monaco } from '@monaco-editor/react'
import { useCallback, useRef } from 'react'
import { useProjectStore } from '../../store/projectStore'

interface MonacoEditorProps {
  tabId: string
  filePath: string
  content: string
  language: string
  fontSize: number
  fontFamily: string
}

export function MonacoEditor({
  tabId,
  content,
  language,
  fontSize,
  fontFamily
}: MonacoEditorProps) {
  const editorRef = useRef<any>(null)
  const updateTabContent = useProjectStore((s) => s.updateTabContent)

  const handleMount = useCallback((editor: any, monaco: Monaco) => {
    editorRef.current = editor

    monaco.editor.defineTheme('platphorm-midnight', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '4a5568', fontStyle: 'italic' },
        { token: 'keyword', foreground: '9f7aea' },
        { token: 'string', foreground: '68d391' },
        { token: 'number', foreground: 'f6ad55' },
        { token: 'type', foreground: '63b3ed' },
        { token: 'function', foreground: 'fc8181' }
      ],
      colors: {
        'editor.background': '#080810',
        'editor.foreground': '#e2e8f0',
        'editor.lineHighlightBackground': '#0d0d1a',
        'editor.selectionBackground': '#9f7aea33',
        'editorCursor.foreground': '#9f7aea',
        'editorLineNumber.foreground': '#2d3748',
        'editorLineNumber.activeForeground': '#9f7aea',
        'editor.inactiveSelectionBackground': '#9f7aea22',
        'editorGutter.background': '#080810',
        'scrollbarSlider.background': '#1a1a2e',
        'scrollbarSlider.hoverBackground': '#9f7aea33'
      }
    })

    monaco.editor.setTheme('platphorm-midnight')

    editor.updateOptions({
      fontFamily,
      fontSize,
      fontLigatures: true,
      lineHeight: 1.7,
      padding: { top: 16, bottom: 16 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'gutter',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      suggest: { preview: true },
      inlineSuggest: { enabled: true }
    })
  }, [fontFamily, fontSize])

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        updateTabContent(tabId, value)
      }
    },
    [tabId, updateTabContent]
  )

  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      onChange={handleChange}
      onMount={handleMount}
      options={{
        automaticLayout: true,
        scrollbar: { useShadows: false, verticalScrollbarSize: 6, horizontalScrollbarSize: 6 }
      }}
    />
  )
}
