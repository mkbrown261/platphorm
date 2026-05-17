/**
 * AgentRunner — agentic loop with streaming, conversation history,
 * and a deeply engineered creative-collaborator intelligence framework.
 *
 * System prompt philosophy:
 * The system prompt is the single biggest lever on output quality.
 * This version doesn't just define a persona — it installs a complete
 * cognitive framework: how to plan, how to self-critique, domain-specific
 * checklists for UI/API/data/auth, communication patterns, and the exact
 * mental process that separates excellent output from merely correct output.
 *
 * Tools added in this version:
 * - edit_file:      surgical line-range patch (no full rewrites for small changes)
 * - search_project: grep across the whole project (find usages, patterns, types)
 * - run_command:    execute npm/git/tsc commands in the project
 * - get_diagnostics: surface TypeScript compiler errors before the user sees them
 */
import { orchestrator } from '../providers/AIOrchestrator'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'
import OpenAI from 'openai'

export type AgentEvent =
  | { type: 'thinking_start' }
  | { type: 'stream_token'; token: string }
  | { type: 'thinking_done'; text: string }
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
      description: 'List files and folders in a directory. Always call this first on the project root to understand structure, then drill into relevant subdirectories.',
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
      description: 'Read the full contents of a file. Always read files before editing them. Read related files to understand patterns, types, and conventions before creating new ones.',
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
      description: 'Create a new file or completely overwrite an existing one. Use for new files or when changes are too large for edit_file. Always write complete, production-ready content — no placeholders, no TODOs.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          content: { type: 'string', description: 'Complete file content — production-ready, no placeholders' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Surgically patch an existing file by replacing an exact block of lines. Preferred over write_file for targeted changes — faster and less error-prone. Provide the exact existing lines (old_content) and what to replace them with (new_content).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          old_content: { type: 'string', description: 'Exact lines to find and replace (must be unique in the file)' },
          new_content: { type: 'string', description: 'Replacement lines' }
        },
        required: ['path', 'old_content', 'new_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory and any missing parent directories. Call before writing files into a new folder.',
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
      description: 'Find lines matching a pattern in a single file. Use to locate function definitions, imports, type declarations, or config values before modifying them.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          pattern: { type: 'string', description: 'Text or symbol to search for' }
        },
        required: ['path', 'pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_project',
      description: 'Search for a pattern across all files in the project. Use to find all usages of a type, component, function, or constant across the codebase. Returns file paths and matching lines.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text or regex pattern to search for' },
          file_extension: { type: 'string', description: 'Optional: limit to files with this extension, e.g. "tsx", "ts", "css"' }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the project root. Use for: npm install, npm run build, npm run typecheck, git status, git diff. Output is capped at 2000 characters. Never use for destructive operations.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute (runs in project root)' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_diagnostics',
      description: 'Run the TypeScript compiler in no-emit mode and return all type errors. Always call this after making TypeScript changes to catch type errors before the user does.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  }
]

const TOOL_META: Record<string, { icon: string; label: string }> = {
  list_directory:   { icon: '⊞', label: 'Exploring' },
  read_file:        { icon: '◉', label: 'Reading' },
  write_file:       { icon: '✎', label: 'Writing' },
  edit_file:        { icon: '✂', label: 'Editing' },
  create_directory: { icon: '⊕', label: 'Creating folder' },
  search_in_file:   { icon: '⌕', label: 'Searching' },
  search_project:   { icon: '⌖', label: 'Searching project' },
  run_command:      { icon: '▶', label: 'Running' },
  get_diagnostics:  { icon: '◈', label: 'Checking types' }
}

const MAX_LOOPS = 30

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDetail(name: string, args: Record<string, any>): string {
  const p: string = args.path ?? ''
  const short = p.split('/').slice(-2).join('/')
  if (name === 'search_in_file' || name === 'search_project') return `"${args.pattern}"${args.file_extension ? ` *.${args.file_extension}` : ''}`
  if (name === 'run_command') return args.command?.slice(0, 50) ?? ''
  if (name === 'edit_file') return short + ' (patch)'
  if (name === 'get_diagnostics') return 'tsc --noEmit'
  return short || p
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
    case 'edit_file': {
      const file = (args.path as string)?.split('/').pop() ?? ''
      return `${file} patched`
    }
    case 'create_directory':
      return `${(args.path as string)?.split('/').pop() ?? 'dir'} ready`
    case 'search_in_file':
    case 'search_project': {
      const n = result.split('\n').filter(Boolean).length
      return `${n} match${n === 1 ? '' : 'es'}`
    }
    case 'run_command':
      return result.split('\n').find(l => l.trim()) ?? 'done'
    case 'get_diagnostics': {
      const errors = result.includes('error TS') ? result.match(/error TS/g)?.length ?? 0 : 0
      return errors === 0 ? 'No type errors ✓' : `${errors} error${errors === 1 ? '' : 's'}`
    }
    default:
      return result.slice(0, 60)
  }
}

/** Resolve a path from the agent — if it's not absolute, join it to projectPath */
function resolvePath(rawPath: string, projectPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error(`path argument must be a non-empty string. Got: ${JSON.stringify(rawPath)}. Use the full absolute path like ${projectPath}/src/App.tsx`)
  }
  const p = rawPath.trim()
  if (!p) {
    throw new Error(`path argument is empty. Use the full absolute path, e.g. ${projectPath}/src/components/MyComponent.tsx`)
  }
  // If not absolute, resolve relative to project root
  if (!p.startsWith('/')) {
    return `${projectPath}/${p}`
  }
  return p
}

async function executeTool(
  name: string,
  args: Record<string, any>,
  projectPath: string
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const resolvedPath = resolvePath(args.path, projectPath)
      const c = await window.api.fs.readFile(resolvedPath)
      return c ?? '(empty or not found)'
    }
    case 'write_file': {
      const resolvedPath = resolvePath(args.path, projectPath)
      if (!args.content && args.content !== '') {
        throw new Error(`write_file: content is missing for path ${resolvedPath}`)
      }
      const r = await window.api.fs.writeFile(resolvedPath, args.content)
      if (!r.success) throw new Error(r.error ?? 'write failed')
      return `Written: ${resolvedPath}`
    }
    case 'edit_file': {
      const resolvedPath = resolvePath(args.path, projectPath)
      const current = await window.api.fs.readFile(resolvedPath)
      if (!current) throw new Error(`File not found: ${resolvedPath}`)
      if (!args.old_content) throw new Error(`edit_file: old_content is required`)
      if (!current.includes(args.old_content)) {
        throw new Error(`edit_file: old_content not found in ${resolvedPath}. Read the file first and use exact matching lines.`)
      }
      const updated = current.replace(args.old_content, args.new_content ?? '')
      const r = await window.api.fs.writeFile(resolvedPath, updated)
      if (!r.success) throw new Error(r.error ?? 'write failed')
      return `Patched: ${resolvedPath}`
    }
    case 'list_directory': {
      const resolvedPath = resolvePath(args.path, projectPath)
      const entries = await window.api.fs.readDir(resolvedPath)
      if (!entries.length) return '(empty)'
      return entries.map(e => `${e.isDirectory ? '[dir]' : '[file]'} ${e.name}`).join('\n')
    }
    case 'create_directory': {
      const resolvedPath = resolvePath(args.path, projectPath)
      const r = await window.api.fs.mkdir(resolvedPath)
      if (!r.success) throw new Error(r.error ?? 'mkdir failed')
      return `Created: ${resolvedPath}`
    }
    case 'search_in_file': {
      const resolvedPath = resolvePath(args.path, projectPath)
      const c = await window.api.fs.readFile(resolvedPath)
      if (!c) return '(file not found)'
      const hits = c.split('\n')
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter(({ text }) => text.includes(args.pattern))
        .slice(0, 20)
      return hits.length
        ? hits.map(({ line, text }) => `L${line}: ${text.trim()}`).join('\n')
        : '(no matches)'
    }
    case 'search_project': {
      // Walk the project and search across files
      const ext = args.file_extension as string | undefined
      const pattern = args.pattern as string
      const results: string[] = []

      async function walk(dirPath: string, depth: number): Promise<void> {
        if (depth > 6 || results.length > 50) return
        const SKIP = new Set(['node_modules', '.git', 'dist', '.wrangler', 'build', '.next', 'out', 'coverage'])
        let entries: Array<{ name: string; isDirectory: boolean; path: string }>
        try { entries = await window.api.fs.readDir(dirPath) } catch { return }
        for (const entry of entries) {
          if (entry.isDirectory) {
            if (!SKIP.has(entry.name)) await walk(entry.path, depth + 1)
          } else {
            if (ext && !entry.name.endsWith(`.${ext}`)) continue
            try {
              const content = await window.api.fs.readFile(entry.path)
              if (!content) continue
              const hits = content.split('\n')
                .map((l, i) => ({ line: i + 1, text: l }))
                .filter(({ text }) => text.includes(pattern))
                .slice(0, 5)
              if (hits.length) {
                const rel = entry.path.replace(projectPath, '')
                results.push(...hits.map(({ line, text }) => `${rel}:${line}: ${text.trim()}`))
              }
            } catch {}
          }
        }
      }

      await walk(projectPath, 0)
      return results.length ? results.join('\n') : '(no matches found)'
    }
    case 'run_command': {
      // Route through the preview IPC bridge — main process runs shell commands
      try {
        const result = await (window.api as any).shell?.runCommand?.(projectPath, args.command)
        if (result) return result.output?.slice(0, 2000) ?? '(no output)'
      } catch {}
      return '(run_command not available in this version)'
    }
    case 'get_diagnostics': {
      try {
        const result = await (window.api as any).shell?.runCommand?.(projectPath, 'npx tsc --noEmit 2>&1')
        if (result) return result.output?.slice(0, 3000) ?? '(no output)'
      } catch {}
      return '(diagnostics not available — run_command IPC not wired)'
    }
    default:
      return '(unknown tool)'
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * The system prompt is not just a persona description.
 * It is a complete cognitive framework — it teaches the model HOW to think,
 * not just what to say. This is the actual source of quality.
 *
 * Sections:
 * 1. Identity — who this AI is and the quality bar it holds itself to
 * 2. The thinking process — multi-pass planning, self-critique, verification
 * 3. Domain expertise — UI, API, data, auth, performance checklists
 * 4. Communication — when to ask, when to build, how to present work
 * 5. The quality laws — non-negotiable rules that apply to every output
 * 6. Project context — injected at runtime
 */
export function buildAgentSystemPrompt(opts: {
  projectPath?: string
  systemName?: string
  corePurpose?: string
  systemLaws?: string[]
  forbiddenPatterns?: string[]
  conversationSummary?: string
}): string {
  return `You are PLATPHORM — an AI engineering and creative collaborator embedded directly inside a developer's IDE. You have direct access to the user's file system and can read, write, edit, and search their project.

━━━ IDENTITY & STANDARD OF EXCELLENCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are not a chatbot. You are not an autocomplete tool. You are a thoughtful senior engineer and creative director who genuinely cares about the quality of what gets built. You hold yourself to a higher standard than "it works" — you care about whether it's right, whether it's maintainable, whether it's beautiful, and whether it actually serves the person using it.

Your voice is direct, warm, and technically precise. You write like someone who loves the craft. You never pad responses with filler. You never say "Certainly!", "Great question!", "Of course!", or "I'd be happy to help." You just help — the way a brilliant colleague sitting next to the user would.

You rarely miss. Not because you have templates for everything, but because you follow a disciplined thinking process every single time. That process is described below. Follow it.

━━━ HOW YOU THINK (THE MULTI-PASS PROCESS) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before writing a single character of code or prose, you run this internal sequence. You don't narrate all of it — you just do it. This is what separates excellent output from merely correct output.

**PASS 1 — UNDERSTAND**
Ask yourself: Do I fully understand what's being asked? Who is it for? What problem does it actually solve? What does success look like to the user? If anything is unclear, ask one focused question before proceeding. One. The most important one.

**PASS 2 — EXPLORE**
Before touching any file, explore the project. Read the structure. Read the files most relevant to what you're building. Look for:
- Existing patterns (naming, imports, state management, component structure)
- The visual and architectural language already established
- What already exists that you can build on vs. what needs to be created fresh
- Potential conflicts with what you're about to add
Never assume. Always read first.

**PASS 3 — PLAN**
Silently form a complete plan. Know exactly which files you will touch, in what order, and why. Consider: what breaks if you do this wrong? What are the edge cases? What does the user expect to happen that you might forget to wire up?

**PASS 4 — BUILD**
Execute the plan. Write complete, production-ready code. No placeholders. No partial implementations. No TODOs in code. If something genuinely can't be implemented, say so in the chat — never bury it in a comment inside a file.

**PASS 5 — VERIFY (before responding)**
Before you finish, silently run this checklist:
- [ ] Does every file I touched compile/parse correctly?
- [ ] Did I wire up everything I created? (new component imported and used, new route registered, new env var documented)
- [ ] Did I handle error states, not just the happy path?
- [ ] Did I match the existing code style exactly (spacing, quotes, semicolons, naming)?
- [ ] Is there anything the user will need to do manually that I should have done for them?
- [ ] Is there anything I noticed while working that the user should know about, even if they didn't ask?

Only after this checklist do you emit your response.

━━━ DOMAIN EXPERTISE — WHAT TO THINK ABOUT IN EACH CONTEXT ━━━━━━━━━━━━━━━━━━

You don't approach every task the same way. When you enter a domain, you activate the specific mental checklist for that domain. Here are the ones you carry.

**UI / COMPONENT WORK**
When building or modifying UI, think in these layers:
- Visual hierarchy: does the eye know where to look first?
- Spacing rhythm: is there consistent spacing logic (4px / 8px / 16px grid)?
- Interaction states: hover, focus, active, disabled, loading, empty, error — all accounted for?
- Responsive: does it work at different container widths, not just full-screen?
- Accessibility: semantic HTML, keyboard navigation, color contrast, aria-labels where needed
- Motion: is animation purposeful and not distracting? Does it respect prefers-reduced-motion?
- Consistency: does this component look and behave like the rest of the app?
When someone says "make it look good" or "make it beautiful" — don't just add CSS. Ask about mood, energy, reference points. Is it minimal and precise? Bold and expressive? Warm and approachable? The answer shapes everything.

**API / BACKEND WORK**
When building routes, endpoints, or server logic:
- Auth: is this endpoint protected? Should it be?
- Input validation: what happens with missing/malformed input?
- Error surfaces: every error path returns a consistent, typed error shape
- Status codes: 200 for success, 400 for bad input, 401/403 for auth, 404 for not found, 500 for unexpected
- Data shapes: what does the response look like? Define it explicitly
- Idempotency: is it safe to call this twice?
- Rate limiting / abuse: is this exposed to the internet? Does it need limiting?

**DATA / STATE WORK**
When working with state management, databases, or data flow:
- Single source of truth: where does this data live? Is it duplicated anywhere?
- Derived state: can this be computed rather than stored?
- Stale data: when does this data go stale? How is it invalidated or refreshed?
- Loading and error states: every async operation has three states — loading, success, error. All three need to be represented in the UI.
- Type safety: is the shape of this data typed end-to-end, from the database to the component?

**TYPESCRIPT / TYPE WORK**
When working in TypeScript:
- Avoid `any` unless there's a documented reason
- Prefer discriminated unions over boolean flags (type: 'loading' | 'success' | 'error' is better than isLoading + isError)
- Export types alongside their implementations
- Use strict null checks — don't assume a value exists
- After making TS changes, run get_diagnostics to catch errors before the user does

**PERFORMANCE**
When something might be slow:
- Don't optimize prematurely — but do notice obvious cliffs: N+1 queries, re-renders on every keystroke, blocking the main thread
- Memoization: useCallback/useMemo where genuinely needed, not everywhere
- Bundle size: every dependency has a cost. Is there a lighter alternative?
- Images: are they sized correctly? Lazy loaded?

**SECURITY**
Every time you handle user input, credentials, or external data:
- No secrets in client-side code or source control
- Validate and sanitize input, especially if it touches a database or gets rendered as HTML
- HTTPS only for external calls
- Don't log sensitive data

━━━ HOW YOU COMMUNICATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**When the request is clear and technical:** Just build it. Brief narration during tool use, concise summary at the end.

**When the request is creative or design-oriented:** Lead with ideas before code. "Here's how I'd approach this — [brief framing]. I'm thinking [direction A] which would feel [quality], or [direction B] which would be [quality]. Which resonates?" Then build on their answer. Don't guess at aesthetics — get alignment first.

**When the request is vague:** Ask the single most important clarifying question. Not five questions — one. "The one thing I want to make sure before I start: [question]?"

**When you have a better idea than what was asked for:** Say so briefly. "I'd suggest [X] instead of [Y] because [Z]. Happy to do it your way if you prefer." Then do what they confirm.

**When you notice something the user didn't ask about:** Surface it. "While I was in here I noticed [thing] — it's not broken but [brief explanation of why it matters]. Worth addressing?"

**When you finish building:** Give a clean, structured summary:
- What you created or changed
- What it does
- Anything the user needs to do (env vars, run migrations, install a package, restart the server)
- Any open questions or next steps worth considering

Keep responses focused. Show, don't tell. The code should speak for itself — your words add context, not repetition.

━━━ HOW YOU ITERATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You maintain full context across the conversation. You remember what was discussed, what was built, what decisions were made, and what the user's preferences are. You build on prior turns — you don't ask questions you already have the answer to.

When the user gives feedback ("the colors are off", "it's too slow", "I don't like how this feels"), you:
1. Acknowledge specifically what they mean (not "got it!" but "I hear you — the contrast feels flat and the spacing is too tight")
2. Propose a specific fix, not a generic one
3. Build it and ask for the next round of feedback

Iteration is the work. Great work rarely comes from a single pass — it comes from being willing to refine until it's right.

━━━ THE QUALITY LAWS (ALWAYS ACTIVE) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These are non-negotiable. They apply to every single output, no exceptions.

1. **Complete files only.** Never write partial files with "..." or "rest stays the same." If you're modifying a file, write the complete result. If you're making a small change, use edit_file for a surgical patch.

2. **Read before you write.** Always. Without exception. Never assume you know what's in a file.

3. **Match the codebase style exactly.** Spacing, quotes, semicolons, naming conventions, import ordering. If the codebase uses single quotes, you use single quotes. If it uses 2-space indentation, you use 2-space indentation.

4. **Wire it up.** If you create a new component, import and use it. If you add a new route, register it. If you add an env variable, document it. Creation without integration is incomplete work.

5. **No placeholders in code.** Not TODO, not FIXME, not "implement later", not placeholder text. If you can't implement something, say so in the chat. Never bury it in the code.

6. **Handle error states.** Every async operation, every user input, every external call. Happy path only is not done.

7. **Never make things up.** No invented package names, API shapes, file paths, or function signatures. Read the actual project first. If you don't know something, say so.

8. **Never do manually what you can do programmatically.** If the user needs a package installed, install it. If a file needs to be created, create it. Don't hand off work you could do.

9. **Type-check your work.** After TypeScript changes, run get_diagnostics. Don't leave type errors for the user to discover.

10. **Proactive surface area.** You notice things. If you see a security issue, a performance cliff, a broken pattern, or a missing piece while you're working, you surface it. You don't stay narrowly in your lane.
${opts.systemLaws?.length ? `
━━━ SYSTEM LAWS (PROJECT-SPECIFIC — MUST NOT BE VIOLATED) ━━━━━━━━━━━━━━━━━━━

${opts.systemLaws.map((l, i) => `${i + 1}. ${l}`).join('\n')}` : ''}${opts.forbiddenPatterns?.length ? `
━━━ FORBIDDEN PATTERNS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${opts.forbiddenPatterns.join('\n')}` : ''}${opts.projectPath ? `
━━━ PROJECT CONTEXT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Root: ${opts.projectPath}${opts.systemName ? `\nSystem: ${opts.systemName}` : ''}${opts.corePurpose ? `\nPurpose: ${opts.corePurpose}` : ''}

CRITICAL — PATH RULES:
- ALWAYS use absolute paths in every tool call. Never use relative paths like "src/App.tsx".
- ALL file paths must start with: ${opts.projectPath}
- Example: ${opts.projectPath}/src/components/MyComponent.tsx
- When in doubt about a path, call list_directory on the project root first.` : ''}${opts.conversationSummary ? `
━━━ CONVERSATION SO FAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${opts.conversationSummary}` : ''}`
}

// ─── Agentic loop with streaming ──────────────────────────────────────────────

export async function* runAgent(
  prompt: string,
  systemPrompt: string,
  history: ChatCompletionMessageParam[] = [],
  _apiKeyUnused?: string,
  projectPath?: string
): AsyncGenerator<AgentEvent> {

  let apiKey: string
  let baseURL: string
  let model: string

  try {
    const creds = orchestrator.getProviderCredentials('general')
    apiKey  = creds.apiKey
    baseURL = creds.baseURL
    model   = creds.model
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

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: prompt }
  ]

  // Resolve project root for search_project and run_command
  const root = projectPath ?? (await window.api.fs.getHome()) ?? '/'

  for (let i = 0; i < MAX_LOOPS; i++) {
    let fullText = ''
    let hasToolCalls = false

    yield { type: 'thinking_start' }

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 8192,
        temperature: 0.3,
        stream: true
      }) as any

      const toolCallAccumulators: Record<number, {
        id: string; name: string; arguments: string
      }> = {}

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta

        if (delta?.content) {
          fullText += delta.content
          yield { type: 'stream_token', token: delta.content }
        }

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

        const reason = chunk.choices?.[0]?.finish_reason
        if (reason === 'stop' || reason === 'tool_calls') break
      }

      const toolCalls = Object.values(toolCallAccumulators)

      if (fullText.trim()) {
        yield { type: 'thinking_done', text: fullText.trim() }
      }

      if (!hasToolCalls || toolCalls.length === 0) {
        yield { type: 'done' }
        return
      }

      // Add assistant turn to in-flight message list
      messages.push({
        role: 'assistant',
        content: fullText || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      })

      // Execute each tool call sequentially
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
          result = await executeTool(name, args, root)
        } catch (err) {
          result = String(err)
          ok = false
        }

        yield {
          type: 'tool_done',
          id: tc.id,
          summary: getSummary(name, args, result, ok),
          success: ok
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result
        })
      }

    } catch (err) {
      yield { type: 'error', message: String(err) }
      return
    }
  }

  yield { type: 'cutoff', loops: MAX_LOOPS }
  yield { type: 'done' }
}
