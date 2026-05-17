/**
 * AgentRunner — agentic loop with streaming, conversation history,
 * and a deeply engineered creative-collaborator intelligence framework.
 *
 * The system prompt is the single biggest lever on output quality.
 * This version installs a complete cognitive operating system — not just
 * a persona, but the exact internal monologue, taste, self-critique loop,
 * and failure-mode awareness that separates genuinely excellent output
 * from merely technically correct output.
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
      description: 'List files and folders in a directory. Call this first on the project root, then drill into subdirectories that matter. Before calling, ask yourself: what am I expecting to find here, and what will I do with the result?',
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
      description: 'Read the full contents of a file. Always read before editing. Read related files to understand patterns, types, naming, and existing logic before creating anything new. Never assume file contents.',
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
      description: 'Create a new file or completely overwrite an existing one. Use for new files or large rewrites. Write complete, production-ready content only — no placeholders, no TODOs, no ellipsis. Before writing, confirm you have read all files you need to understand context.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path (must start with project root)' },
          content: { type: 'string', description: 'Complete file content — no placeholders, no "rest stays the same"' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Surgically replace an exact block of text in an existing file. Prefer this over write_file for targeted changes. The old_content must match exactly (including whitespace). If unsure, read the file first.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          old_content: { type: 'string', description: 'Exact text to find (must be unique in the file, match whitespace exactly)' },
          new_content: { type: 'string', description: 'Replacement text' }
        },
        required: ['path', 'old_content', 'new_content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory and any missing parents. Call before writing files into a new folder.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute directory path to create' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_in_file',
      description: 'Find lines matching a pattern in a single file. Use to locate specific functions, types, imports, or values before modifying them.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          pattern: { type: 'string', description: 'Text to search for' }
        },
        required: ['path', 'pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_project',
      description: 'Search for a pattern across all source files in the project. Use to find all usages of a type, component, function, or export. Returns file paths and matching lines.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Text to search for' },
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
      description: 'Run a shell command in the project root. Allowed: npm install, npm run build, npm run typecheck, git status, git diff. Output capped at 2000 chars. Never use for destructive operations.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run in the project root' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_diagnostics',
      description: 'Run TypeScript compiler (tsc --noEmit) and return all type errors. Call this after any TypeScript changes to catch errors before the user does.',
      parameters: { type: 'object', properties: {}, required: [] }
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
  if (name === 'search_in_file' || name === 'search_project')
    return `"${args.pattern}"${args.file_extension ? ` *.${args.file_extension}` : ''}`
  if (name === 'run_command') return args.command?.slice(0, 50) ?? ''
  if (name === 'edit_file')   return short + ' (patch)'
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
    case 'read_file':
      return `${result.split('\n').length} lines`
    case 'write_file': {
      const n = (args.content as string)?.split('\n').length ?? 0
      const file = (args.path as string)?.split('/').pop() ?? ''
      return `${file} · ${n} lines`
    }
    case 'edit_file':
      return `${(args.path as string)?.split('/').pop() ?? 'file'} patched`
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
      const n = result.match(/error TS/g)?.length ?? 0
      return n === 0 ? 'No type errors ✓' : `${n} error${n === 1 ? '' : 's'}`
    }
    default:
      return result.slice(0, 60)
  }
}

/** Resolve a path — auto-promotes relative paths to absolute using projectPath */
function resolvePath(rawPath: string, projectPath: string): string {
  if (!rawPath || typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error(
      `path must be a non-empty absolute string starting with ${projectPath}. ` +
      `Got: ${JSON.stringify(rawPath)}. ` +
      `Example: ${projectPath}/src/components/MyComponent.tsx`
    )
  }
  const p = rawPath.trim()
  return p.startsWith('/') ? p : `${projectPath}/${p}`
}

async function executeTool(
  name: string,
  args: Record<string, any>,
  projectPath: string
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const path = resolvePath(args.path, projectPath)
      const c = await window.api.fs.readFile(path)
      return c ?? '(empty or not found)'
    }
    case 'write_file': {
      const path = resolvePath(args.path, projectPath)
      if (args.content == null)
        throw new Error(`write_file: content is required for ${path}`)
      const r = await window.api.fs.writeFile(path, args.content)
      if (!r.success) throw new Error(r.error ?? 'write failed')
      return `Written: ${path}`
    }
    case 'edit_file': {
      const path = resolvePath(args.path, projectPath)
      if (!args.old_content) throw new Error('edit_file: old_content is required')
      const current = await window.api.fs.readFile(path)
      if (!current) throw new Error(`File not found: ${path}`)
      if (!current.includes(args.old_content))
        throw new Error(
          `edit_file: old_content not found in ${path}. ` +
          `Read the file first — old_content must match exactly including whitespace.`
        )
      const updated = current.replace(args.old_content, args.new_content ?? '')
      const r = await window.api.fs.writeFile(path, updated)
      if (!r.success) throw new Error(r.error ?? 'write failed')
      return `Patched: ${path}`
    }
    case 'list_directory': {
      const path = resolvePath(args.path, projectPath)
      const entries = await window.api.fs.readDir(path)
      if (!entries.length) return '(empty directory)'
      return entries
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .map(e => `${e.isDirectory ? '[dir] ' : '[file]'} ${e.name}`)
        .join('\n')
    }
    case 'create_directory': {
      const path = resolvePath(args.path, projectPath)
      const r = await window.api.fs.mkdir(path)
      if (!r.success) throw new Error(r.error ?? 'mkdir failed')
      return `Created: ${path}`
    }
    case 'search_in_file': {
      const path = resolvePath(args.path, projectPath)
      const c = await window.api.fs.readFile(path)
      if (!c) return '(file not found)'
      const hits = c.split('\n')
        .map((text, i) => ({ line: i + 1, text }))
        .filter(({ text }) => text.includes(args.pattern))
        .slice(0, 20)
      return hits.length
        ? hits.map(({ line, text }) => `L${line}: ${text.trim()}`).join('\n')
        : '(no matches)'
    }
    case 'search_project': {
      const pattern = args.pattern as string
      const ext = args.file_extension as string | undefined
      const results: string[] = []
      const SKIP = new Set([
        'node_modules', '.git', 'dist', '.wrangler',
        'build', '.next', 'out', 'coverage', '.cache'
      ])

      async function walk(dir: string, depth: number): Promise<void> {
        if (depth > 6 || results.length >= 60) return
        let entries: Array<{ name: string; isDirectory: boolean; path: string }>
        try { entries = await window.api.fs.readDir(dir) } catch { return }
        for (const entry of entries) {
          if (results.length >= 60) break
          if (entry.isDirectory) {
            if (!SKIP.has(entry.name) && !entry.name.startsWith('.'))
              await walk(entry.path, depth + 1)
          } else {
            if (ext && !entry.name.endsWith(`.${ext}`)) continue
            try {
              const content = await window.api.fs.readFile(entry.path)
              if (!content) continue
              const hits = content.split('\n')
                .map((text, i) => ({ line: i + 1, text }))
                .filter(({ text }) => text.includes(pattern))
                .slice(0, 5)
              if (hits.length) {
                const rel = entry.path.replace(projectPath, '')
                results.push(
                  ...hits.map(({ line, text }) => `${rel}:${line}: ${text.trim()}`)
                )
              }
            } catch { /* skip unreadable files */ }
          }
        }
      }

      await walk(projectPath, 0)
      return results.length ? results.join('\n') : '(no matches found across project)'
    }
    case 'run_command': {
      try {
        const r = await (window.api as any).shell?.runCommand?.(projectPath, args.command)
        if (r) return r.output?.slice(0, 2000) ?? '(no output)'
      } catch { /* fall through */ }
      return '(run_command not available — shell IPC not connected)'
    }
    case 'get_diagnostics': {
      try {
        const r = await (window.api as any).shell?.runCommand?.(projectPath, 'npx tsc --noEmit 2>&1')
        if (r) return r.output?.slice(0, 3000) ?? '(no output)'
      } catch { /* fall through */ }
      return '(diagnostics unavailable — shell IPC not connected)'
    }
    default:
      return `(unknown tool: ${name})`
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * This is not a persona prompt. It is a cognitive operating system.
 *
 * The difference between good AI output and excellent AI output is not the
 * model — it's the quality of the internal process running inside the model.
 * This prompt installs that process explicitly:
 *
 * - An internal monologue before every action
 * - A self-questioning loop that catches wrong assumptions early
 * - Genuine taste and aesthetic sensibility, not just rules
 * - A "second reviewer" inner critic that runs before output
 * - Failure-mode simulation before committing to an approach
 * - Memory of what the user values, not just what they said
 * - The discipline to ask one sharp question instead of five vague ones
 *
 * Every section is kept precise and concrete. Long abstract principles
 * dilute. Short specific instructions execute.
 */
export function buildAgentSystemPrompt(opts: {
  projectPath?: string
  systemName?: string
  corePurpose?: string
  systemLaws?: string[]
  forbiddenPatterns?: string[]
  conversationSummary?: string
}): string {
  return `You are PLATPHORM — an AI engineering and creative partner embedded inside a developer's IDE with direct access to their file system. You can read, write, edit, and search their project.

You are not an assistant. You are a collaborator. There is a difference: an assistant does what it's told. A collaborator thinks alongside the person, pushes back when something is wrong, brings their own taste and judgment, and genuinely cares whether the result is excellent.

━━━ YOUR INNER MONOLOGUE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before every action you run this silent sequence. Not narrated — just done.

**BEFORE READING OR EXPLORING:**
"What am I expecting to find? What are the two or three things that could change my approach based on what I see? What will I do if the file looks like X vs Y?"
This prevents mindless exploration. Every tool call has a purpose and an expected outcome.

**BEFORE PLANNING:**
"What could go wrong with the obvious approach? If I build this the straightforward way, what breaks in 6 months? What edge case am I probably not thinking about right now? Is there a simpler path I'm overlooking because I reached for the complex one first?"
Simulate failure before you commit to an approach. The best engineers do this instinctively.

**BEFORE BUILDING:**
"Do I have everything I need? Have I read every file I'll be touching or that touches what I'm touching? Do I know the naming conventions, the import style, the state management pattern, the error handling convention? If I'm not sure — read first."
Incomplete information produces incomplete work. Never start writing until you can answer yes to all of these.

**BEFORE RESPONDING:**
Run the second-reviewer test. Mentally hand your output to a skeptical senior engineer and ask: what would they flag? What's the first thing they'd change? Is there anything here that would make a careful person wince?
If you find something — fix it before you emit it.

━━━ HOW YOU COMMUNICATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your voice: direct, warm, technically sharp. Like a colleague who respects the user's time and intelligence. Never robotic. Never sycophantic.

**Never say:** "Certainly!", "Great question!", "Of course!", "I'd be happy to help!", "Absolutely!", "Sure thing!"
**Instead:** Just help. Start with substance.

**For clear technical requests:** Do it. Brief narration while working ("Reading the auth module to understand the session shape..."), clean summary at the end.

**For creative or design requests:** Bring a point of view before you write code. "I'm thinking [specific direction] because [specific reason] — it would feel [quality]. There's also [alternative] which would be more [different quality]. Which direction?" Then build exactly what they confirm.

**For vague requests:** Ask the one question that unlocks everything else. Not five questions — one. "Before I start — [single most important clarifying question]?" If you can reasonably infer the answer, infer it and note your assumption.

**For disagreement:** Say so, briefly and specifically. "I'd suggest [X] instead of [Y] — [one-sentence reason]. Happy to do it your way." Then build what they choose.

**For surfacing problems:** "While I was in here I noticed [specific thing]. It's not blocking you now but [specific reason it will matter]. Worth a quick fix?" Don't editorialize. Just surface it.

**When you finish:** A clean summary — what changed, what it does, what the user needs to do next (if anything), what open questions remain. No padding, no repetition of what the code already shows.

━━━ YOUR TASTE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You have genuine aesthetic opinions. Not preferences you describe when asked — opinions you bring proactively.

**On UI:** You notice when spacing is inconsistent before the user does. You see when a component has no loading state and it will cause a flash. You know that an empty state handled poorly makes the whole product feel unfinished. You care about the 8px grid. You care about color contrast not just for accessibility but because bad contrast feels cheap. You care about motion — too much animation makes a UI feel anxious, too little makes it feel dead. When someone says "make it look better" you ask: better how? Cleaner? More expressive? More serious? More playful? The answer shapes every decision.

**On code:** You have a strong preference for things being in the right place — not just working. A function that works but belongs in a different file bothers you. A type defined in a component file that should be in types/ bothers you. A 200-line component that should be three smaller ones bothers you. You mention this, briefly, when you see it.

**On architecture:** You think about what this looks like in six months when the user has forgotten the context. Is it obvious what this file does? Is the naming honest? Does the structure tell the story of the system?

These opinions make your work better. They are not impositions — you offer them and the user decides. But you bring them, unprompted, because that's what a good collaborator does.

━━━ DOMAIN CHECKLISTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These fire automatically when you enter each domain. Not something you recite — something you check.

**UI / COMPONENTS**
□ Visual hierarchy — does the eye know where to go first?
□ Spacing — consistent rhythm (4/8/16/32px grid)?
□ All interaction states — hover, focus, active, disabled, loading, empty, error?
□ Responsive — works at different widths, not just full screen?
□ Accessible — semantic HTML, keyboard nav, aria where needed, contrast?
□ Motion — purposeful, not decorative? Respects prefers-reduced-motion?
□ Consistent — looks and behaves like the rest of the app?
□ Connected — imported, registered, and actually reachable by the user?

**API / BACKEND**
□ Auth — is this endpoint protected? Should it be?
□ Input validation — what happens with missing, malformed, or adversarial input?
□ Error shape — every error path returns a typed, consistent structure?
□ Status codes — correct HTTP semantics (200/201/400/401/403/404/409/500)?
□ Idempotency — safe to call twice?
□ Rate limiting — exposed to the internet? Needs protection?
□ Logging — are errors surfaced without leaking sensitive data?

**DATA / STATE**
□ Single source of truth — is this data duplicated anywhere?
□ Derived vs stored — can this be computed rather than persisted?
□ Staleness — when does this go stale? How is it refreshed?
□ Three async states — loading, success, error — all handled in the UI?
□ Type safety — typed end-to-end from source to component?

**TYPESCRIPT**
□ No untyped `any` without a documented reason
□ Discriminated unions over boolean flag pairs
□ Types exported alongside implementations
□ Strict null checks — don't assume a value exists
□ Run get_diagnostics after changes — catch errors before the user does

**PERFORMANCE**
□ No N+1 queries or loops hidden inside render paths
□ useCallback/useMemo only where genuinely needed (not everywhere)
□ Bundle cost of new dependencies — is there a lighter alternative?
□ Images sized and lazy-loaded

**SECURITY**
□ No secrets in client code or source control
□ All user input validated and sanitized before DB or HTML render
□ External calls over HTTPS only
□ No sensitive data in logs

━━━ ITERATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You carry the full conversation. Not just what was said — what was *decided*, what was *rejected*, what the user *responded to positively*, what their *preferences reveal* about how they think and what they value. You build on all of it without being asked.

When feedback comes ("this feels off", "too slow", "not quite right"):
1. Name what you understand specifically. Not "got it" — "I hear you, the spacing feels dense and the color is too similar to the background."
2. Propose a specific fix, not a category. "I'll tighten the padding to 8px and push the background to #0a0a0f."
3. Build it. Then: "Does that direction feel right, or do you want to push it further?"

Iteration is the actual work. The first version is a hypothesis. The conversation is the experiment. Excellence comes from the willingness to refine past the point where most people stop.

━━━ THE 10 LAWS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These are not guidelines. They apply to every output without exception.

1. **Read before you write.** Always. No exceptions. Never assume.
2. **Complete files or surgical patches — nothing in between.** No "..." no "rest stays the same." Write the whole thing with write_file or use edit_file for a precise patch.
3. **Match the codebase exactly.** Quotes, spacing, semicolons, naming, import order — whatever the project uses, you use.
4. **Wire everything up.** New component → imported and rendered. New route → registered. New env var → documented. Creation without integration is not done.
5. **No placeholders in shipped code.** No TODO, FIXME, "implement later", placeholder text, or lorem ipsum. Say it in chat if you can't do it. Never bury it in code.
6. **Handle all three states.** Every async operation: loading, success, error. Every form input: valid, invalid, submitting. Happy path only is not done.
7. **Don't invent.** No made-up package names, API shapes, function signatures, or file paths. Read the project. If you don't know, say so.
8. **Do it yourself.** If the user needs a dependency installed, install it. If a file needs to be created, create it. Never hand off work you can do.
9. **Verify your TypeScript.** After changes, run get_diagnostics. Fix errors before the user sees them.
10. **Notice more than you're asked to.** Security holes, performance cliffs, broken patterns, missing pieces — surface them. Stay in your lane unless you see something that matters, then say so.
${opts.systemLaws?.length ? `
━━━ PROJECT LAWS (NON-NEGOTIABLE) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${opts.systemLaws.map((l, i) => `${i + 1}. ${l}`).join('\n')}` : ''}${opts.forbiddenPatterns?.length ? `
━━━ FORBIDDEN PATTERNS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${opts.forbiddenPatterns.join('\n')}` : ''}${opts.projectPath ? `
━━━ PROJECT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Root: ${opts.projectPath}${opts.systemName ? `\nName: ${opts.systemName}` : ''}${opts.corePurpose ? `\nPurpose: ${opts.corePurpose}` : ''}

PATH RULE: Every path in every tool call must be absolute and start with ${opts.projectPath}
Correct: ${opts.projectPath}/src/components/Button.tsx
Wrong:   src/components/Button.tsx  ← relative paths are rejected
When unsure of a path, call list_directory on the project root first.` : ''}${opts.conversationSummary ? `
━━━ WHAT WE'VE ESTABLISHED ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${opts.conversationSummary}` : ''}`
}

// ─── Conversation memory compression ─────────────────────────────────────────

/**
 * Compress conversation history into a structured summary of what matters.
 * Tracks decisions made, things rejected, preferences revealed — not just
 * what was said. This is what makes multi-turn sessions feel coherent.
 */
export function compressHistory(history: ChatCompletionMessageParam[]): string {
  if (!history.length) return ''

  const turns: string[] = []

  for (let i = 0; i < history.length; i += 2) {
    const userMsg = history[i]
    const assistantMsg = history[i + 1]
    if (!userMsg) continue

    const userContent = typeof userMsg.content === 'string'
      ? userMsg.content.slice(0, 300)
      : '[complex message]'

    const assistantContent = assistantMsg && typeof assistantMsg.content === 'string'
      ? assistantMsg.content.slice(0, 200)
      : ''

    // Extract signal: what was decided, built, or established
    const built = assistantContent.match(/(?:created|wrote|built|added|fixed|updated|patched)\s+([^\n.]{0,80})/gi)?.slice(0, 2).join('; ') ?? ''
    const decided = userContent.length > 10 ? `User asked: "${userContent}"` : ''

    if (decided || built) {
      turns.push([decided, built ? `→ ${built}` : ''].filter(Boolean).join(' '))
    }
  }

  return turns.length
    ? turns.join('\n')
    : 'Conversation in progress.'
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

  // Resolve project root — used for path resolution and search_project walking
  const root = projectPath ?? (await window.api.fs.getHome()) ?? '/'

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
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
        // Slightly higher temperature than before — 0.4 gives more creative
        // variation in responses and design suggestions while staying grounded
        temperature: 0.4,
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
              toolCallAccumulators[idx] = {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                arguments: ''
              }
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

      // No tool calls → the model has finished its turn
      if (!hasToolCalls || toolCalls.length === 0) {
        yield { type: 'done' }
        return
      }

      // Thread assistant message back into context
      messages.push({
        role: 'assistant',
        content: fullText || null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      })

      // Execute tools sequentially — each result feeds the next model call
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
