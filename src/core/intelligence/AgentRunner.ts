/**
 * AgentRunner — agentic loop with streaming, conversation history,
 * and a deeply engineered creative-collaborator intelligence framework.
 *
 * The system prompt is the single biggest lever on output quality.
 * This version installs a complete cognitive operating system — not just
 * a persona, but the exact internal monologue, taste, self-critique loop,
 * and failure-mode awareness that separates genuinely excellent output
 * from merely technically correct output.
 *
 * Production fixes (v3):
 * - edit_file: uniqueness check — throws if old_content matches 0 or 2+ times
 * - run_command / get_diagnostics: throws on IPC failure, no silent fallback
 * - search_project: 512KB file size cap, binary extension skip, 60-result limit
 * - temperature: 0.3 globally — tool calls require precision over creativity
 * - compressHistory: structural memory — tracks decisions, rejections, preferences
 * - inner monologue: model emits ⟶ commitment token before every tool call
 * - MAX_LOOPS: abort signal support for user interruption mid-loop
 * - TASTE hook: structured post-edit UI checklist trigger in system prompt
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
      description: 'Create a new file or completely overwrite an existing one. Use for new files or large rewrites only. Write complete, production-ready content — no placeholders, no TODOs, no ellipsis. Before writing, confirm you have read all files you need to understand context.',
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
      description: `Surgically replace an exact block of text in an existing file. Prefer this over write_file for targeted changes.

RULES (enforced — violations throw):
1. old_content must match EXACTLY (including all whitespace and indentation)
2. old_content must appear EXACTLY ONCE in the file — if it appears 0 or 2+ times the call fails
3. If unsure, call read_file first and copy the text verbatim
4. For multiple changes to the same file, make them sequentially — one edit_file per change`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path' },
          old_content: { type: 'string', description: 'Exact text to replace — must appear exactly once in the file, whitespace-perfect' },
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
      description: 'Search for a pattern across all source files in the project. Use to find all usages of a type, component, function, or export. Returns file paths and matching lines. Skips node_modules, dist, binary files, and files over 512KB.',
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
      description: 'Run a shell command in the project root. Allowed: npm install, npm run build, npm run typecheck, git status, git diff. Output capped at 2000 chars. Never use for destructive operations. Throws if shell IPC is not connected.',
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
      description: 'Run TypeScript compiler (tsc --noEmit) and return all type errors. Call this after any TypeScript changes to catch errors before the user does. Throws if shell IPC is not connected.',
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

// Binary file extensions that search_project will skip — reading these produces
// garbage and wastes the per-file read budget.
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff',
  'mp4', 'mp3', 'wav', 'ogg', 'webm', 'mov', 'avi',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'zip', 'tar', 'gz', 'rar', '7z',
  'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'exe', 'dll', 'so', 'dylib',
  'map',           // source maps — huge, not useful for search
  'lock',          // package-lock.json, yarn.lock — enormous
])

// Max file size (bytes) we'll attempt to read during search_project.
// 512KB is generous for source files; anything larger is almost certainly
// generated, minified, or binary-adjacent.
const SEARCH_MAX_FILE_BYTES = 512 * 1024

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

/** Returns true if a filename looks like a binary/generated file we should skip */
function isBinaryFilename(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(ext)
}

async function executeTool(
  name: string,
  args: Record<string, any>,
  projectPath: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new Error('Interrupted by user')

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
      if (!current) throw new Error(`edit_file: file not found: ${path}`)

      // Count occurrences — old_content must appear exactly once.
      // String.replace() only patches the first match which silently corrupts
      // files with repeated blocks. We enforce uniqueness here.
      const occurrences = current.split(args.old_content).length - 1
      if (occurrences === 0) {
        throw new Error(
          `edit_file: old_content not found in ${path}.\n` +
          `Read the file with read_file first and copy the exact text you want to replace, ` +
          `including all whitespace and indentation.\n` +
          `Tip: use search_in_file to locate the line numbers first.`
        )
      }
      if (occurrences > 1) {
        throw new Error(
          `edit_file: old_content appears ${occurrences} times in ${path} — ambiguous patch.\n` +
          `Expand old_content to include more surrounding context so it matches exactly once.`
        )
      }

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
        'build', '.next', 'out', 'coverage', '.cache', '.turbo'
      ])

      async function walk(dir: string, depth: number): Promise<void> {
        if (signal?.aborted) return
        if (depth > 6 || results.length >= 60) return
        let entries: Array<{ name: string; isDirectory: boolean; path: string }>
        try { entries = await window.api.fs.readDir(dir) } catch { return }

        for (const entry of entries) {
          if (signal?.aborted || results.length >= 60) break

          if (entry.isDirectory) {
            if (!SKIP.has(entry.name) && !entry.name.startsWith('.'))
              await walk(entry.path, depth + 1)
            continue
          }

          // Skip binary/generated files entirely
          if (isBinaryFilename(entry.name)) continue

          // Skip files with wrong extension if filter is set
          if (ext && !entry.name.endsWith(`.${ext}`)) continue

          try {
            // Check file size before reading — avoids slurping package-lock.json (2MB+),
            // compiled bundles, or other large generated files.
            // We use a heuristic: readFile and immediately check byte length.
            // If the API exposes stat(), prefer that. Otherwise read and gate.
            const content = await window.api.fs.readFile(entry.path)
            if (!content) continue

            // Byte-length guard (UTF-16 strings: length ≈ bytes for ASCII source)
            if (content.length > SEARCH_MAX_FILE_BYTES) continue

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

      await walk(projectPath, 0)
      return results.length ? results.join('\n') : '(no matches found across project)'
    }

    case 'run_command': {
      // Explicit failure — never silently tell the model a command ran when it didn't.
      // If shell IPC isn't wired, the model must know so it can tell the user honestly.
      const shell = (window.api as any).shell
      if (typeof shell?.runCommand !== 'function') {
        throw new Error(
          'run_command: shell IPC is not connected. ' +
          'The shell:runCommand bridge is not available in this environment. ' +
          'Tell the user the command could not be run and show them what to run manually.'
        )
      }
      const r = await shell.runCommand(projectPath, args.command)
      if (!r.success) {
        throw new Error(
          `run_command failed: ${r.error ?? 'unknown error'}\n` +
          `Command: ${args.command}\n` +
          `Output: ${r.output?.slice(0, 500) ?? '(none)'}`
        )
      }
      return r.output?.slice(0, 2000) ?? '(command completed with no output)'
    }

    case 'get_diagnostics': {
      const shell = (window.api as any).shell
      if (typeof shell?.runCommand !== 'function') {
        throw new Error(
          'get_diagnostics: shell IPC is not connected. ' +
          'TypeScript diagnostics require the shell:runCommand bridge. ' +
          'Tell the user to run "npx tsc --noEmit" manually in the project root.'
        )
      }
      const r = await shell.runCommand(projectPath, 'npx tsc --noEmit 2>&1')
      // tsc exits non-zero when there are errors — that's expected, not a failure.
      // We always return the output so the model can read and fix the errors.
      return (r.output ?? '').slice(0, 3000) || '(no type errors)'
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
 * - A visible commitment token before every tool call (⟶) that forces
 *   deliberate intent rather than reflexive action
 * - A self-questioning loop that catches wrong assumptions early
 * - Genuine taste and aesthetic sensibility, not just rules
 * - A "second reviewer" inner critic that runs before output
 * - Failure-mode simulation before committing to an approach
 * - Structural memory of what the user values, built, and rejected
 * - The discipline to ask one sharp question instead of five vague ones
 * - A post-edit UI hook that fires the visual checklist automatically
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

━━━ PLAN FIRST — COMPLETE THE LIST — ALWAYS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every multi-step task follows this exact two-part structure. No exceptions.

PART 1 — Before calling any tool, write the full plan:

Here's what I'll do:
- [ ] Step one
- [ ] Step two
- [ ] Step three
- [ ] Step four

Rules:
- Every item on one line, every item written, before any tool call.
- Never stop the list early. Never truncate. If there are 7 steps, write all 7.
- The UI renders this as a live checklist. A cut-off list is broken UI.

PART 2 — After ALL work is done, the VERY LAST thing you write is the completion list:

Here's what I did:
- [x] Step one
- [x] Step two
- [x] Step three
- [x] Step four

Rules:
- This list uses - [x] for every completed item, - [ ] for anything not done.
- It is the LAST thing in your response. Nothing after it.
- Do NOT follow it with numbered "next steps", recommendations, or questions. Those go BEFORE the completion list if needed.
- Do NOT replace the - [x] list with a numbered list. They are different things. A numbered list is not a completion list.
- The completion list must have every item from the original plan. No items dropped.

━━━ YOUR COMMITMENT TOKEN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Before calling ANY tool, output one line starting with ⟶ that states your specific purpose for that call. This is not narration after the fact — it is a statement of intent that commits you before you act.

Examples:
⟶ Reading Button.tsx to understand the existing event handler pattern before I add the new onClick
⟶ Listing src/components/ to find where the modal lives before I edit it
⟶ Searching for "useAuth" across the project to find all call sites before I change the signature
⟶ Running tsc to catch any type errors introduced by the interface change

This token does two things: it forces deliberate intent (no mindless tool calls), and it makes your reasoning visible so the user can follow your process and correct your assumptions before you go the wrong direction.

If you cannot write a clear ⟶ line — if you're not sure why you're calling the tool — don't call it. Re-read the conversation and think again.

━━━ YOUR INNER MONOLOGUE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Beyond the ⟶ token, run this silent sequence before each phase. Not narrated — just done.

**BEFORE EXPLORING:**
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

**For clear technical requests:** Do it. Brief ⟶ narration while working, clean summary at the end.

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

**After every UI file edit — before you close the response — run this quick check and surface exactly one thing if anything is off:**
□ Does the eye know where to go first? (visual hierarchy)
□ Are all interaction states handled? (hover, focus, disabled, loading, empty, error)
□ Does it look consistent with the rest of the app?
□ Is there any motion that serves no purpose, or any transition that should exist but doesn't?
If everything checks out, say nothing. If one thing is off, name it in one sentence. Not a list — the most important one.

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
□ No untyped \`any\` without a documented reason
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
11. **Every project must be runnable.** The root package.json MUST have a "dev" script. If you create a project, you create a complete one: package.json with scripts, all dependencies listed, index.html or entry point, everything needed to run with a single "npm run dev". A project the user can't run is not done.
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
 *
 * Tracks four things that make multi-turn sessions feel coherent:
 *   1. Decisions made — architectural, design, or technical choices that stuck
 *   2. Things built or changed — concrete file-level work completed
 *   3. Things rejected — approaches that were tried or proposed and turned down
 *   4. Preferences revealed — things the user responded to positively, or
 *      patterns in what they push back on, that reveal how they think
 *
 * This is not a transcript. It is a working memory of signal, not noise.
 * The goal: the model should be able to read this and understand not just
 * what happened, but what the user cares about and what direction was chosen.
 */
export function compressHistory(history: ChatCompletionMessageParam[]): string {
  if (!history.length) return ''

  const decisions:   string[] = []
  const built:       string[] = []
  const rejected:    string[] = []
  const preferences: string[] = []

  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    const content = typeof msg.content === 'string' ? msg.content : ''
    if (!content.trim()) continue

    if (msg.role === 'user') {
      // Detect rejections / preference signals in user messages
      // "don't", "not quite", "actually", "instead", "I don't want" suggest course correction
      if (/\b(don't|do not|not quite|that's not|instead|actually|i don't want|remove|revert|undo)\b/i.test(content)) {
        rejected.push(`User corrected: "${content.slice(0, 150).trim()}"`)
      }
      // Positive confirmation — "perfect", "exactly", "love it", "yes" after an AI response
      else if (i > 0 && /\b(perfect|exactly|love it|great|yes|that's it|looks good|nice)\b/i.test(content) && content.length < 120) {
        const prevAssistant = history[i - 1]
        const prevContent = typeof prevAssistant?.content === 'string' ? prevAssistant.content : ''
        // What did they just approve?
        const approvedThing = prevContent.match(/(?:I've? |just |now )?(added|created|built|updated|fixed|changed|written|refactored)\s+([^\n.]{0,80})/i)?.[0]
        if (approvedThing) {
          preferences.push(`User approved: ${approvedThing.trim()}`)
        }
      }
      // Architectural or directional decisions — "let's use", "we'll go with", "keep it as"
      else if (/\b(let'?s use|we'?ll use|go with|keep|stick with|use .{3,40} for|decided to)\b/i.test(content)) {
        decisions.push(`Decided: "${content.slice(0, 150).trim()}"`)
      }
    }

    if (msg.role === 'assistant') {
      // Extract concrete things built — file-level work
      const builtMatches = content.match(/(?:created|wrote|built|added|fixed|updated|patched|refactored|moved|renamed)\s+([^\n.]{0,100})/gi)
      if (builtMatches) {
        built.push(...builtMatches.slice(0, 3).map(m => m.trim()))
      }
      // Extract explicit architectural decisions stated by the assistant
      const decisionMatches = content.match(/(?:I'?(?:ve|m) (?:using|going with|chosen|decided)|the approach is|this means|going forward)\s+([^\n.]{0,120})/gi)
      if (decisionMatches) {
        decisions.push(...decisionMatches.slice(0, 2).map(m => m.trim()))
      }
    }
  }

  const sections: string[] = []

  if (decisions.length) {
    sections.push('**Decisions made:**\n' + [...new Set(decisions)].slice(0, 5).map(d => `  • ${d}`).join('\n'))
  }
  if (built.length) {
    sections.push('**Work completed:**\n' + [...new Set(built)].slice(0, 8).map(b => `  • ${b}`).join('\n'))
  }
  if (rejected.length) {
    sections.push('**Rejected / corrected:**\n' + [...new Set(rejected)].slice(0, 4).map(r => `  • ${r}`).join('\n'))
  }
  if (preferences.length) {
    sections.push('**User preferences revealed:**\n' + [...new Set(preferences)].slice(0, 4).map(p => `  • ${p}`).join('\n'))
  }

  return sections.length
    ? sections.join('\n\n')
    : 'Session in progress — no strong signals extracted yet.'
}

// ─── XML tool-call fallback parser ───────────────────────────────────────────
//
// Claude models via OpenRouter sometimes emit their native Anthropic XML tool-call
// format in the content stream instead of structured tool_calls deltas.
// These helpers parse that format and strip it from the display text.

function parseXMLToolCalls(text: string): { id: string; name: string; arguments: string }[] {
  const results: { id: string; name: string; arguments: string }[] = []
  // Match both <invoke name="..."> and <invoke name="...">
  const invokeRe = /<(?:antml:)?invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:antml:)?invoke>/g
  let invokeMatch: RegExpExecArray | null
  while ((invokeMatch = invokeRe.exec(text)) !== null) {
    const toolName = invokeMatch[1]
    const body = invokeMatch[2]
    // Parse parameters: <parameter name="key">value</parameter> (or antml: prefixed)
    const args: Record<string, string> = {}
    const paramRe = /<(?:antml:)?parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:antml:)?parameter>/g
    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramRe.exec(body)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim()
    }
    results.push({
      id: `xml-${Date.now()}-${results.length}`,
      name: toolName,
      arguments: JSON.stringify(args)
    })
  }
  return results
}

function stripXMLToolCalls(text: string): string {
  return text
    // Full function_calls blocks (both namespaced and plain)
    .replace(/<(?:antml:)?function_calls>[\s\S]*?<\/(?:antml:)?function_calls>/g, '')
    // Orphaned invoke blocks (if function_calls wrapper was malformed)
    .replace(/<(?:antml:)?invoke[\s\S]*?<\/(?:antml:)?invoke>/g, '')
    // Any leftover individual tags
    .replace(/<\/?(?:antml:)?(?:function_calls|invoke|parameter)[^>]*>/g, '')
    // Bare "antml:" fragment tokens (incomplete streaming)
    .replace(/antml:[a-z_]+/g, '')
    .trim()
}

// ─── Agentic loop with streaming ──────────────────────────────────────────────

export async function* runAgent(
  prompt: string,
  systemPrompt: string,
  history: ChatCompletionMessageParam[] = [],
  _apiKeyUnused?: string,
  projectPath?: string,
  signal?: AbortSignal   // caller passes an AbortController signal to interrupt mid-loop
): AsyncGenerator<AgentEvent> {

  // Respect an already-aborted signal immediately
  if (signal?.aborted) {
    yield { type: 'error', message: 'Interrupted before start' }
    return
  }

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
    // Check abort signal at the top of every loop — user can interrupt at any point
    if (signal?.aborted) {
      yield { type: 'error', message: `Interrupted after ${loop} loop${loop === 1 ? '' : 's'}` }
      return
    }

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
        // 0.3 — precision over creativity for code editing and tool calls.
        // Tool execution (edit_file exact matching, path construction, TS fixes)
        // requires determinism. Creative variation belongs in the conversation layer,
        // not in the code generation layer.
        temperature: 0.3,
        stream: true
      }) as any

      const toolCallAccumulators: Record<number, {
        id: string; name: string; arguments: string
      }> = {}

      // Track whether we're inside an Anthropic XML tool-call block so we can
      // suppress those tokens from the UI stream. The block starts on the first
      // token that contains <function_calls> (or <function_calls>) and ends
      // after the closing </function_calls> (or </function_calls>) token.
      let insideXMLBlock = false

      for await (const chunk of stream) {
        if (signal?.aborted) break

        const delta = chunk.choices?.[0]?.delta

        if (delta?.content) {
          fullText += delta.content

          // Detect XML tool-call block boundaries mid-stream and suppress those tokens
          if (!insideXMLBlock && /(<function_calls>|<function_calls>)/.test(delta.content)) {
            insideXMLBlock = true
          }
          if (!insideXMLBlock) {
            yield { type: 'stream_token', token: delta.content }
          }
          if (insideXMLBlock && /(<\/function_calls>|<\/function_calls>)/.test(fullText)) {
            insideXMLBlock = false
          }
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

      // Re-check abort after stream completes
      if (signal?.aborted) {
        yield { type: 'error', message: `Interrupted after ${loop} loop${loop === 1 ? '' : 's'}` }
        return
      }

      let toolCalls = Object.values(toolCallAccumulators)

      // ── XML fallback parser ────────────────────────────────────────────────
      // Some Claude models via OpenRouter still emit their native Anthropic XML
      // tool-call format in the content stream even with parallel_tool_calls:false.
      // Detect this: if the stream text contains <function_calls> (or the namespaced
      // <function_calls>) and we have no structured tool_calls, parse the XML
      // manually so tools still fire — and strip the raw XML from the displayed text.
      if (!hasToolCalls && /(<function_calls>|<function_calls>)/.test(fullText)) {
        const xmlCalls = parseXMLToolCalls(fullText)
        if (xmlCalls.length > 0) {
          toolCalls = xmlCalls
          hasToolCalls = true
          // Strip the XML block from the text shown in the UI bubble
          fullText = stripXMLToolCalls(fullText)
        }
      }

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
        if (signal?.aborted) {
          yield { type: 'error', message: 'Interrupted during tool execution' }
          return
        }

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
          result = await executeTool(name, args, root, signal)
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
