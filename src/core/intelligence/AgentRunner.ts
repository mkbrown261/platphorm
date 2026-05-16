import OpenAI from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; id: string; tool: string; icon: string; label: string; detail: string }
  | { type: 'tool_done'; id: string; tool: string; summary: string; success: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string }

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory to understand project structure',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute directory path' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file to understand existing code before making changes',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute file path' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or overwrite an existing file. Use for ALL code generation — do not describe code, write it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          content: { type: 'string', description: 'Complete file content' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory and any necessary parent directories',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path to create' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_in_file',
      description: 'Search for a pattern in a file to understand existing patterns, imports, or structure',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          pattern: { type: 'string', description: 'Text to search for' }
        },
        required: ['path', 'pattern']
      }
    }
  }
]

const TOOL_META: Record<string, { icon: string; label: string }> = {
  list_directory: { icon: '⊞', label: 'Exploring' },
  read_file:      { icon: '◉', label: 'Reading' },
  write_file:     { icon: '✎', label: 'Writing' },
  create_directory: { icon: '⊕', label: 'Creating folder' },
  search_in_file: { icon: '⌕', label: 'Searching' }
}

function getDetail(name: string, args: Record<string, any>): string {
  const path: string = args.path ?? ''
  const short = path.split('/').slice(-2).join('/')
  if (name === 'search_in_file') return `"${args.pattern}" in ${short}`
  return short || path
}

function getSummary(name: string, args: Record<string, any>, result: string, ok: boolean): string {
  if (!ok) return `Error: ${result.slice(0, 80)}`
  switch (name) {
    case 'list_directory': {
      const n = result.split('\n').filter(Boolean).length
      return `${n} item${n === 1 ? '' : 's'}`
    }
    case 'read_file': {
      const n = result.split('\n').length
      return `${n} lines`
    }
    case 'write_file': {
      const n = (args.content as string)?.split('\n').length ?? 0
      const file = (args.path as string)?.split('/').pop() ?? ''
      return `${file} · ${n} lines`
    }
    case 'create_directory':
      return `${(args.path as string)?.split('/').pop() ?? 'dir'} ready`
    case 'search_in_file': {
      const n = result.split('\n').filter(Boolean).length
      return `${n} match${n === 1 ? '' : 'es'}`
    }
    default:
      return result.slice(0, 60)
  }
}

function resolvePath(raw: unknown, projectRoot?: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('path argument must be a non-empty string')
  const p = raw.trim()
  if (p.startsWith('/')) return p
  if (!projectRoot) throw new Error(`relative path "${p}" requires a project root — open a project first`)
  return `${projectRoot.replace(/\/$/, '')}/${p}`
}

async function executeTool(name: string, args: Record<string, any>, projectRoot?: string): Promise<string> {
  switch (name) {
    case 'read_file': {
      const c = await window.api.fs.readFile(resolvePath(args.path, projectRoot))
      return c ?? '(empty or not found)'
    }
    case 'write_file': {
      const p = resolvePath(args.path, projectRoot)
      if (typeof args.content !== 'string') throw new Error('write_file requires a content string')
      const r = await window.api.fs.writeFile(p, args.content)
      if (!r.success) throw new Error(r.error ?? 'write failed')
      return `Written: ${p}`
    }
    case 'list_directory': {
      const entries = await window.api.fs.readDir(resolvePath(args.path, projectRoot))
      if (!entries.length) return '(empty)'
      return entries.map(e => `${e.isDirectory ? '[dir]' : '[file]'} ${e.name}`).join('\n')
    }
    case 'create_directory': {
      const r = await window.api.fs.mkdir(resolvePath(args.path, projectRoot))
      if (!r.success) throw new Error(r.error ?? 'mkdir failed')
      return `Created: ${args.path}`
    }
    case 'search_in_file': {
      const c = await window.api.fs.readFile(resolvePath(args.path, projectRoot))
      if (!c) return '(file not found)'
      const hits = c.split('\n').filter(l => l.includes(args.pattern)).slice(0, 15)
      return hits.length ? hits.join('\n') : '(no matches)'
    }
    default:
      return '(unknown tool)'
  }
}

export function buildAgentSystemPrompt(opts: {
  projectPath?: string
  systemName?: string
  corePurpose?: string
  systemLaws?: string[]
  forbiddenPatterns?: string[]
}): string {
  const lines: string[] = [
    'You are PLATPHORM, an AI engineering agent with file system access.',
    '',
    'CORE BEHAVIOR:',
    '- Use tools to actually build things. Never just describe what you would create.',
    '- Always explore the project structure before writing new code.',
    '- Read relevant existing files to match patterns, imports, and style.',
    '- Write complete, production-ready files — no placeholders or TODOs.',
    '- Narrate briefly what you\'re doing and why as you work.',
    '- After writing files, summarize what you built.',
    ''
  ]

  if (opts.projectPath) lines.push(`Project root: ${opts.projectPath}`, '')
  if (opts.systemName) lines.push(`System: ${opts.systemName}`)
  if (opts.corePurpose) lines.push(`Purpose: ${opts.corePurpose}`, '')

  if (opts.systemLaws?.length) {
    lines.push('System Laws (must not be violated):')
    opts.systemLaws.forEach((l, i) => lines.push(`  ${i + 1}. ${l}`))
    lines.push('')
  }

  if (opts.forbiddenPatterns?.length) {
    lines.push('Forbidden patterns: ' + opts.forbiddenPatterns.join(', '), '')
  }

  return lines.join('\n')
}

export async function* runAgent(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
  projectRoot?: string
): AsyncGenerator<AgentEvent> {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'https://platphorm.dev', 'X-Title': 'PLATPHORM' },
    dangerouslyAllowBrowser: true
  })

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ]

  for (let i = 0; i < 25; i++) {
    let response: Awaited<ReturnType<typeof client.chat.completions.create>>
    try {
      response = await client.chat.completions.create({
        model: 'anthropic/claude-sonnet-4-6',
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 8192,
        temperature: 0.2
      }) as any
    } catch (err) {
      yield { type: 'error', message: String(err) }
      return
    }

    const msg = (response as any).choices?.[0]?.message
    if (!msg) { yield { type: 'done' }; return }

    if (msg.content?.trim()) {
      yield { type: 'thinking', text: msg.content.trim() }
    }

    if (!msg.tool_calls?.length) {
      yield { type: 'done' }
      return
    }

    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })

    for (const call of msg.tool_calls) {
      const name: string = call.function.name
      let args: Record<string, any> = {}
      try { args = JSON.parse(call.function.arguments) } catch { args = {} }

      const meta = TOOL_META[name] ?? { icon: '◈', label: name }

      yield {
        type: 'tool_start',
        id: call.id,
        tool: name,
        icon: meta.icon,
        label: meta.label,
        detail: getDetail(name, args)
      }

      let result: string
      let ok = true
      try {
        result = await executeTool(name, args, projectRoot)
      } catch (err) {
        result = String(err)
        ok = false
      }

      yield { type: 'tool_done', id: call.id, tool: name, summary: getSummary(name, args, result, ok), success: ok }

      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  yield { type: 'done' }
}
