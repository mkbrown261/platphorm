/**
 * AgentRunner — real tool-calling agentic loop with streaming, conversation
 * history, and a creative-collaborator persona.
 *
 * Key upgrades in this version:
 * - buildAgentSystemPrompt() completely rewritten: teaches the model HOW to
 *   think, communicate, clarify, and iterate — not just what tools to call
 * - runAgent() now accepts conversation history (ChatCompletionMessageParam[])
 *   so context persists across turns in the same session
 * - Real token streaming: text appears word-by-word via stream: true
 * - 'stream_token' event type added so UI can render incrementally
 * - All AI calls still route through AIOrchestrator (System Law 15)
 */
import { orchestrator } from '../providers/AIOrchestrator'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'
import OpenAI from 'openai'

export type AgentEvent =
  | { type: 'thinking_start' }                                                    // model began generating
  | { type: 'stream_token'; token: string }                                       // one streamed text token
  | { type: 'thinking_done'; text: string }                                       // full assembled text
  | { type: 'tool_start'; id: string; tool: string; icon: string; label: string; detail: string }
  | { type: 'tool_done'; id: string; summary: string; success: boolean }
  | { type: 'cutoff'; loops: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory. Always call this first to understand project structure before touching any files.',
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
      description: 'Read the full contents of a file. Always read existing files before modifying them to understand patterns, imports, naming conventions, and existing logic.',
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
      description: 'Create or overwrite a file with complete content. Never write partial files or use placeholders — always write the full, working implementation.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          content: { type: 'string', description: 'Complete file content — no placeholders, no TODOs, production-ready' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory (and any missing parents). Use before writing files into a new folder.',
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
      description: 'Search for a specific pattern or symbol in a file. Use to find existing imports, function names, type definitions, or config values before adding new ones.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          pattern: { type: 'string', description: 'Text or symbol to search for' }
        },
        required: ['path', 'pattern']
      }
    }
  }
]

const TOOL_META: Record<string, { icon: string; label: string }> = {
  list_directory:   { icon: '⊞', label: 'Exploring' },
  read_file:        { icon: '◉', label: 'Reading' },
  write_file:       { icon: '✎', label: 'Writing' },
  create_directory: { icon: '⊕', label: 'Creating folder' },
  search_in_file:   { icon: '⌕', label: 'Searching' }
}

const MAX_LOOPS = 25

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case 'read_file': {
      const c = await window.api.fs.readFile(args.path)
      return c ?? '(empty or not found)'
    }
    case 'write_file': {
      const r = await window.api.fs.writeFile(args.path, args.content)
      if (!r.success) throw new Error(r.error ?? 'write failed')
      return `Written: ${args.path}`
    }
    case 'list_directory': {
      const entries = await window.api.fs.readDir(args.path)
      if (!entries.length) return '(empty)'
      return entries.map(e => `${e.isDirectory ? '[dir]' : '[file]'} ${e.name}`).join('\n')
    }
    case 'create_directory': {
      const r = await window.api.fs.mkdir(args.path)
      if (!r.success) throw new Error(r.error ?? 'mkdir failed')
      return `Created: ${args.path}`
    }
    case 'search_in_file': {
      const c = await window.api.fs.readFile(args.path)
      if (!c) return '(file not found)'
      const hits = c.split('\n').filter(l => l.includes(args.pattern)).slice(0, 15)
      return hits.length ? hits.join('\n') : '(no matches)'
    }
    default:
      return '(unknown tool)'
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * The system prompt is the single biggest lever on output quality.
 * This version teaches the model HOW to think and communicate as a creative
 * collaborator — not just what tools to use.
 */
export function buildAgentSystemPrompt(opts: {
  projectPath?: string
  systemName?: string
  corePurpose?: string
  systemLaws?: string[]
  forbiddenPatterns?: string[]
  conversationSummary?: string   // optional running summary of prior turns
}): string {
  return `You are PLATPHORM — an AI engineering collaborator embedded directly inside a developer's IDE.

━━━ WHO YOU ARE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are not a chatbot. You are not a code completion tool. You are a thoughtful creative and technical partner who happens to have direct access to the user's file system. You think out loud, you have opinions, you ask when something is unclear, and you build things that actually work — not demos, not prototypes with TODOs, but real production-ready software.

Your voice is: direct, warm, technically precise, and never robotic. You write like a senior engineer who genuinely enjoys the craft. You don't pad responses with filler. You don't say "Certainly!" or "Great question!" or "I'd be happy to help." You just... help. Thoughtfully. Like a colleague sitting next to the user, not a support ticket.

━━━ HOW YOU THINK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before you build anything, you understand it. That means:

1. **Read before you write.** Always explore the project structure first. Read the files most relevant to what you're building. Understand the existing patterns, naming conventions, import style, state management approach, and aesthetic before adding a single line.

2. **Think out loud.** As you work, narrate briefly. "I'm reading the existing auth module to understand the session shape" — not a wall of explanation, just a line or two so the user knows what you're doing and why. This builds trust and helps them follow along.

3. **When something is ambiguous, ask one focused question.** Not five. One. The most important one. Don't guess wrong and build the wrong thing — a quick clarification saves everyone time. But if the request is clear enough, just build it. Use judgment.

4. **Have a point of view.** If you think there's a better approach than what was asked for, say so briefly — "I'd suggest doing X instead of Y because Z, but I can do it your way if you prefer." Then do what they confirm.

5. **Be coherent across the conversation.** Remember what was discussed earlier in this session. Build on it. If the user said "make it dark themed" three messages ago, you don't need to ask again — carry that forward.

━━━ HOW YOU BUILD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Write complete files. Not snippets. Not "here's the important part, fill in the rest." The whole thing.
- Match the codebase's existing style perfectly — spacing, quotes, semicolons, naming, import order.
- When you create a new component or module, wire it up. Don't create a file and leave it disconnected.
- Handle errors. Real code handles edge cases. Don't write the happy path only.
- Never use TODO, FIXME, placeholder, or "implement later" comments in code you write. If you can't implement something, say so in the chat — not in a comment buried in the code.
- Prefer editing existing files over creating new ones unless a new file is genuinely the right choice.
- After you finish building, give a concise summary: what you created/changed, what it does, and if there's anything the user should know (environment variables needed, a migration to run, etc.).

━━━ HOW YOU COMMUNICATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For creative or design requests: lead with ideas and questions before writing code. "Here's how I'd approach this — [brief description]. A couple of options: [option A] which feels more [quality], or [option B] which is [quality]. Want me to go with A, or something else?" Then build on their answer.

For clear technical requests: just do it. Read the relevant files, build the thing, summarize.

For vague requests: ask the single most important clarifying question. "The one thing I want to make sure before I start: [question]?"

Keep responses focused. Don't explain everything you're about to do before doing it — show, don't tell. Brief narration during tool use is good. Long preambles are not.

━━━ WHAT YOU NEVER DO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Never describe code instead of writing it. If you're going to build something, build it.
- Never write partial files with "rest stays the same" or "..." ellipsis. Full files only.
- Never ignore the existing codebase style and just write in your default style.
- Never use filler phrases: "Certainly!", "Great question!", "Of course!", "I'd be happy to..."
- Never make up package names, API endpoints, or file paths. Read the actual project first.
- Never write code that requires the user to do manual steps you could have done for them.
${opts.systemLaws?.length ? `\n━━━ SYSTEM LAWS (MUST NOT BE VIOLATED) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${opts.systemLaws.map((l, i) => `${i + 1}. ${l}`).join('\n')}` : ''}
${opts.forbiddenPatterns?.length ? `\n━━━ FORBIDDEN PATTERNS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${opts.forbiddenPatterns.join('\n')}` : ''}
${opts.projectPath ? `\n━━━ PROJECT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nRoot: ${opts.projectPath}${opts.systemName ? `\nSystem: ${opts.systemName}` : ''}${opts.corePurpose ? `\nPurpose: ${opts.corePurpose}` : ''}` : ''}
${opts.conversationSummary ? `\n━━━ CONVERSATION SO FAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n${opts.conversationSummary}` : ''}`
}

// ─── Agentic loop with streaming ──────────────────────────────────────────────

/**
 * Run the agentic loop.
 *
 * @param prompt          The current user message
 * @param systemPrompt    Built by buildAgentSystemPrompt()
 * @param history         Prior turns in this session (for conversational memory)
 * @param _apiKeyUnused   Kept for backward compat — ignored; orchestrator owns keys
 */
export async function* runAgent(
  prompt: string,
  systemPrompt: string,
  history: ChatCompletionMessageParam[] = [],
  _apiKeyUnused?: string
): AsyncGenerator<AgentEvent> {

  // Resolve provider credentials through the abstraction layer (System Law 15)
  let apiKey: string
  let baseURL: string
  let model: string

  try {
    const providerInfo = orchestrator.getProviderCredentials('general')
    apiKey  = providerInfo.apiKey
    baseURL = providerInfo.baseURL
    model   = providerInfo.model
  } catch (err) {
    yield { type: 'error', message: String(err) }
    return
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders: { 'HTTP-Referer': 'https://platphorm.dev', 'X-Title': 'PLATPHORM' },
    dangerouslyAllowBrowser: true
  })

  // Build message array: system + history + current user message
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: prompt }
  ]

  for (let i = 0; i < MAX_LOOPS; i++) {
    let fullText = ''
    let toolCalls: any[] = []
    let hasToolCalls = false

    yield { type: 'thinking_start' }

    try {
      // ── Streaming request ────────────────────────────────────────────────
      const stream = await client.chat.completions.create({
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 8192,
        temperature: 0.3,
        stream: true
      }) as any

      // Accumulate streamed chunks
      const toolCallAccumulators: Record<number, {
        id: string; name: string; arguments: string
      }> = {}

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta

        // Text token
        if (delta?.content) {
          fullText += delta.content
          yield { type: 'stream_token', token: delta.content }
        }

        // Tool call deltas — accumulate across chunks
        if (delta?.tool_calls) {
          hasToolCalls = true
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCallAccumulators[idx]) {
              toolCallAccumulators[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' }
            }
            if (tc.id) toolCallAccumulators[idx].id = tc.id
            if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name
            if (tc.function?.arguments) toolCallAccumulators[idx].arguments += tc.function.arguments
          }
        }

        // Stream finished
        if (chunk.choices?.[0]?.finish_reason === 'stop' || chunk.choices?.[0]?.finish_reason === 'tool_calls') {
          break
        }
      }

      toolCalls = Object.values(toolCallAccumulators)

    } catch (err) {
      yield { type: 'error', message: String(err) }
      return
    }

    // Emit assembled thinking text
    if (fullText.trim()) {
      yield { type: 'thinking_done', text: fullText.trim() }
    }

    // No tool calls → the model is done
    if (!hasToolCalls || toolCalls.length === 0) {
      yield { type: 'done' }
      return
    }

    // Add assistant message to history
    messages.push({
      role: 'assistant',
      content: fullText || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments }
      }))
    })

    // Execute each tool call
    for (const tc of toolCalls) {
      const name: string = tc.name
      let args: Record<string, any> = {}
      try { args = JSON.parse(tc.arguments) } catch { args = {} }

      const meta = TOOL_META[name] ?? { icon: '◈', label: name }

      yield {
        type: 'tool_start',
        id: tc.id,
        tool: name,
        icon: meta.icon,
        label: meta.label,
        detail: getDetail(name, args)
      }

      let result: string
      let ok = true
      try {
        result = await executeTool(name, args)
      } catch (err) {
        result = String(err)
        ok = false
      }

      yield { type: 'tool_done', id: tc.id, summary: getSummary(name, args, result, ok), success: ok }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result
      })
    }
  }

  // Hit the loop cap
  yield { type: 'cutoff', loops: MAX_LOOPS }
  yield { type: 'done' }
}
