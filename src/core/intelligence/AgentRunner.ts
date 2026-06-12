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
 * Production fixes (v4):
 * - HARD CONTAINMENT: write_file/edit_file/create_directory are blocked outside
 *   the project root — enforced in code, with '..' traversal normalization
 * - edit_file: literal split-free replacement (String.replace() corrupts files
 *   when new_content contains $&, $1, $$ substitution patterns)
 * - edit_file: distinguishes missing file (null) from empty file ('')
 * - truncation recovery: finish_reason 'length' mid-tool-call no longer executes
 *   corrupt partial JSON — the model gets an explicit recovery instruction
 * - run_command: surfaces real exit codes from main process; output tail (not
 *   head) is returned because errors print last
 * - XML fallback regexes actually match the antml:-namespaced tag variants
 * - get_diagnostics: 6KB budget + error count header so nothing cuts mid-error
 * - edit_file: uniqueness check — throws if old_content matches 0 or 2+ times
 * - search_project: 512KB file size cap, binary extension skip, 60-result limit
 * - MAX_LOOPS: abort signal support for user interruption mid-loop
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
      description: 'List files and folders in a directory. ALWAYS call this on the project root before reading or editing any file. Never guess or assume a file path — list the directory first, then navigate to what actually exists. If you get a read_file or edit_file error saying a file was not found, it means you guessed the path wrong. Call list_directory to find the real path.',
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
      description: 'Create a new file or completely overwrite an existing one. Use for new files or full rewrites only. Write complete, production-ready content — no placeholders, no TODOs, no ellipsis. Files over ~300 lines must be split: write_file the first logical section, then edit_file to append the rest — a single oversized call will hit the output token limit and fail. Paths outside the project root are blocked.',
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
1. old_content must match EXACTLY (including all whitespace, indentation, quotes, and line endings)
2. old_content must appear EXACTLY ONCE in the file — if it appears 0 or 2+ times the call fails
3. ALWAYS call read_file immediately before edit_file and copy old_content CHARACTER-FOR-CHARACTER from that result. Never reconstruct old_content from memory — even small differences (a space, a quote style, a trailing comma) will cause failure.
4. For multiple changes to the same file, make them sequentially — one edit_file per change
5. If edit_file fails with "old_content not found", the error message contains the actual file content — use that to find the exact text, then retry`,
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
      description: `Run a shell command in the project. Allowed: npm, npx, yarn, pnpm, node, git status/diff/log/add/commit/init, curl, wget, mkdir, cp, mv, rm, touch, echo, find, grep, ls, cat, head, tail, wc, which. Chained commands (&&) are validated segment-by-segment. rm works on any path INSIDE the project root (relative or absolute) but is blocked outside it and on the project root itself — to clear a project, rm its contents (rm -rf ./src ./package.json), never the root folder. sudo and node -e are blocked. Installs/builds get a 5-minute timeout; other commands 90s. The result reports the REAL exit code — a failure is a failure, never proceed as if it succeeded.

IMPORTANT — commands ALREADY run from the project root. NEVER start a command with "cd /absolute/path" — it is rejected. To work in a subfolder, either use the path parameter or a RELATIVE cd ("cd frontend && npm install"). Always run npm install after creating package.json and confirm it exits 0. Use curl or wget to download runtime assets, then verify file sizes with ls -lh.`,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
          path: { type: 'string', description: 'Optional: absolute path to the directory to run the command in. Defaults to the project root. Use this when installing deps in a subfolder (e.g. /Users/me/dev/myapp/frontend).' }
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
  if (name === 'run_command') {
    const cmd = args.command?.slice(0, 40) ?? ''
    const inDir = args.path ? ` (in …/${String(args.path).split('/').pop()})` : ''
    return cmd + inDir
  }
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

/**
 * Normalize a path string: collapse '..' and '.' segments without touching disk.
 * Prevents `${root}/../../etc/passwd` from passing a startsWith() check.
 */
function normalizePath(p: string): string {
  const parts = p.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return '/' + out.join('/')
}

/**
 * HARD CONTAINMENT — mutating operations (write_file, edit_file, create_directory)
 * may only touch paths inside the project root. This is enforced in code, not
 * just stated in the system prompt. A hallucinated path can no longer overwrite
 * files elsewhere on the user's disk.
 */
function enforceContainment(path: string, projectPath: string, tool: string): string {
  const normRoot = normalizePath(projectPath)
  const normPath = normalizePath(path)
  if (normPath !== normRoot && !normPath.startsWith(normRoot + '/')) {
    throw new Error(
      `${tool}: path is outside the project root and was blocked.\n` +
      `Path: ${path}\n` +
      `Project root: ${projectPath}\n` +
      `All write operations must target paths inside the project root. ` +
      `If you need to work in a different folder, ask the user to open it as the project.`
    )
  }
  return normPath
}

/**
 * Literal string replacement that is immune to JavaScript's replacement-pattern
 * semantics. String.prototype.replace() treats $&, $', $1, $$ in the replacement
 * as substitution patterns — silently corrupting any new_content that contains
 * them (regexes, shell templates, jQuery, etc.). split/join is always literal.
 */
function literalReplaceOnce(haystack: string, find: string, replacement: string): string {
  const idx = haystack.indexOf(find)
  if (idx === -1) return haystack
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + find.length)
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
      if (c == null) throw new Error(
        `read_file: file not found: ${path}\n` +
        `Do not guess paths. Call list_directory on the project root first to see what actually exists.`
      )
      return c
    }

    case 'write_file': {
      const path = enforceContainment(resolvePath(args.path, projectPath), projectPath, 'write_file')
      if (args.content == null)
        throw new Error(`write_file: content is required for ${path}`)
      const r = await window.api.fs.writeFile(path, args.content)
      if (!r.success) throw new Error(r.error ?? 'write failed')
      return `Written: ${path} (${String(args.content).split('\n').length} lines)`
    }

    case 'edit_file': {
      const path = enforceContainment(resolvePath(args.path, projectPath), projectPath, 'edit_file')
      if (!args.old_content) throw new Error('edit_file: old_content is required')
      const current = await window.api.fs.readFile(path)
      // null = file missing; empty string is a real (empty) file — distinguish them.
      if (current == null) throw new Error(
        `edit_file: file not found: ${path}\n` +
        `Call list_directory to find the real path, or use write_file to create a new file.`
      )
      if (current === '') throw new Error(
        `edit_file: ${path} is empty — there is nothing to replace. Use write_file instead.`
      )

      // Count occurrences — old_content must appear exactly once.
      // String.replace() only patches the first match which silently corrupts
      // files with repeated blocks. We enforce uniqueness here.
      const occurrences = current.split(args.old_content).length - 1
      if (occurrences === 0) {
        // Give the AI the actual file content so it can self-correct without
        // needing another read_file round-trip. Cap at 3000 chars to stay within limits.
        const preview = current.length > 3000
          ? current.slice(0, 3000) + '\n... (truncated, use read_file for full content)'
          : current
        throw new Error(
          `edit_file: old_content not found in ${path}.\n` +
          `Your old_content did not match the actual file. ` +
          `You must copy old_content CHARACTER-FOR-CHARACTER from the read_file result — ` +
          `do not reconstruct it from memory, do not paraphrase, do not change whitespace or quotes.\n\n` +
          `ACTUAL FILE CONTENT (use this to find the exact text to replace):\n` +
          `\`\`\`\n${preview}\n\`\`\``
        )
      }
      if (occurrences > 1) {
        throw new Error(
          `edit_file: old_content appears ${occurrences} times in ${path} — ambiguous patch.\n` +
          `Expand old_content to include more surrounding context so it matches exactly once.`
        )
      }

      // Literal replacement — String.replace() would interpret $&, $1, $$ in
      // new_content as substitution patterns and silently corrupt the file.
      const updated = literalReplaceOnce(current, args.old_content, args.new_content ?? '')
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
      const path = enforceContainment(resolvePath(args.path, projectPath), projectPath, 'create_directory')
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
      // Use the explicit path if provided, otherwise fall back to the project root.
      // This lets the AI run npm install in a subfolder when needed.
      // Containment: the cwd must resolve inside the project root.
      const runCwd = args.path
        ? enforceContainment(resolvePath(args.path, projectPath), projectPath, 'run_command')
        : projectPath
      const r = await shell.runCommand(runCwd, args.command)
      if (!r.success) {
        // Honest failure — includes the real exit code and the TAIL of the output
        // (errors print last). The model must see the actual failure to recover.
        throw new Error(
          `run_command FAILED (exit code ${r.exitCode ?? '?'}): ${r.error ?? 'unknown error'}\n` +
          `Command: ${args.command}\n` +
          `Directory: ${runCwd}\n` +
          `Output (tail):\n${r.output?.slice(-1500) ?? '(none)'}\n` +
          `Do NOT proceed as if this command succeeded. Fix the cause, then re-run it.`
        )
      }
      return r.output?.slice(-2000) ?? '(command completed with no output)'
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
      // 6000 chars ≈ ~60 errors — enough to see real error sets without cutting mid-error.
      const out = (r.output ?? '').slice(0, 6000)
      if (!out.trim()) return '(no type errors)'
      const errorCount = out.match(/error TS\d+/g)?.length ?? 0
      return errorCount > 0
        ? `${errorCount} TypeScript error(s) — fix ALL of them before finishing:\n${out}`
        : out
    }

    default:
      return `(unknown tool: ${name})`
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * Operating protocol, not a persona prompt.
 *
 * v4 — restructured around an explicit execution protocol (the way production
 * coding agents operate) instead of accumulated anecdote-patches:
 *
 * - ENVIRONMENT & HARD CONSTRAINTS: states only what the tools actually enforce
 *   in code (path containment, honest exit codes, command validation) — the
 *   prompt never promises guarantees the tools don't deliver
 * - EXECUTION PROTOCOL: explore → read → plan → act → verify → report, as a
 *   numbered sequence with concrete completion criteria per phase
 * - TOOL DISCIPLINE: the ⟶ commitment token, the read→edit contract, the
 *   output-token budget rule (split large files), and an explicit
 *   failure-recovery rule (read error → fix cause → retry once → report)
 * - CODE STANDARDS: complete-files-or-surgical-patches, wire everything up,
 *   fix-the-broken-thing-only, three async states, no invention
 * - COMMUNICATION: condensed collaborator voice — substance first, one
 *   question max, no apologies, no filler
 *
 * One-off bug lore (face-api.js weights etc.) was generalized into the
 * verify-downloads rule rather than hardcoded as anecdotes. The plan/
 * completion checklist format is preserved — the AIPanel UI renders it.
 */
export function buildAgentSystemPrompt(opts: {
  projectPath?: string
  systemName?: string
  corePurpose?: string
  systemLaws?: string[]
  forbiddenPatterns?: string[]
  conversationSummary?: string
}): string {
  // Always provide a project name — use systemName from DNA if available,
  // otherwise fall back to the folder name derived from the project path.
  // Reject known bad/placeholder values that the DNA AI sometimes generates.
  const BAD_NAMES = /^(UNDEFINED_PROJECT|undefined|null|Unknown Project|\.\.\.|\s*)$/i
  const resolvedName = (opts.systemName && !BAD_NAMES.test(opts.systemName))
    ? opts.systemName
    : (opts.projectPath ? opts.projectPath.split('/').filter(Boolean).pop() : undefined)
  return `You are PLATPHORM — an autonomous AI engineering agent embedded inside a developer's IDE with direct file-system access. You read, write, edit, search, and run commands in their project. You are a collaborator, not an assistant: you think alongside the user, push back when something is wrong, bring judgment and taste, and care whether the result is excellent.

━━━ ENVIRONMENT & HARD CONSTRAINTS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These are enforced in code. Violations are rejected by the tools themselves.

1. ALL write operations (write_file, edit_file, create_directory) are contained to the project root. Paths outside it are blocked.
2. Every path in every tool call must be ABSOLUTE. Relative paths are auto-promoted to the project root, but write them absolute anyway — ambiguity causes bugs.
3. run_command reports REAL exit codes. success:false with an exit code means the command FAILED. Never proceed as if a failed command succeeded.
4. Commands are validated segment-by-segment. Destructive operations (rm on absolute/home paths, sudo, eval) are blocked.
5. Tool errors are honest. When a tool throws, the error message tells you what actually happened — read it and act on it.

━━━ EXECUTION PROTOCOL — EVERY TASK, IN ORDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**1. EXPLORE** — Before anything else, know the terrain.
   - list_directory the project root. Never guess paths — list, then navigate.
   - For vague requests ("fix this", "make it better", "optimize"): the project IS the context. Read package.json, the entry point, and the most likely target files BEFORE responding with words. A senior engineer would look at the code first; so do you.

**2. READ** — Read every file you will touch, and the files that touch them.
   - Learn the naming conventions, import style, state patterns, error handling.
   - Never assume file contents. Never reconstruct from memory.

**3. PLAN** — Before calling any mutating tool, write the full plan as a checklist:

Here's what I'll do:
- [ ] Step one
- [ ] Step two
- [ ] Step three

   - Every step on one line. Write ALL steps — never truncate the list.
   - The UI renders this as a live checklist; a cut-off list is broken UI.
   - Before committing to the plan, simulate failure: what breaks with the obvious approach? What edge case is unhandled? Is there a simpler path?

**4. ACT** — Execute the plan with tool discipline (next section).

**5. VERIFY** — Work is not done until verified:
   - After ANY .ts/.tsx change: get_diagnostics. Fix EVERY error before finishing.
   - After creating/changing package.json: run npm install and check it actually succeeded (exit code 0).
   - After downloading runtime assets (images, fonts, data files): verify file size with ls -lh. A few-byte file is a failed download — fix it.
   - New project: package.json MUST have a "dev" script, npm install MUST have been run by you, successfully. A project the user can't immediately preview is not done.
   - NEVER claim or imply something works without having run it. "Might need adjustments", "may need fine-tuning", "should work" are confessions that you skipped verification — verify instead, or mark the item - [ ] not done with the reason.

**6. REPORT** — The VERY LAST thing in your response is the completion list:

Here's what I did:
- [x] Step one
- [x] Step two
- [ ] Step that could not be completed (with one-line reason above the list)

   - Use - [x] for done, - [ ] for not done. Every item from the original plan appears. Nothing after this list — no questions, no recommendations (those go before it).

━━━ TOOL DISCIPLINE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Commitment token:** Before EVERY tool call, output one line starting with ⟶ stating your specific purpose:
⟶ Reading Button.tsx to learn the event-handler pattern before adding onClick
If you cannot write a clear ⟶ line, you don't know why you're calling the tool — stop and think.

**read_file → edit_file contract:** Call read_file on the file in the SAME response, immediately before edit_file. Copy old_content CHARACTER-FOR-CHARACTER from the read result. One space difference causes failure. old_content must match exactly once — expand it with surrounding context if it's ambiguous.

**write_file is for new files or full rewrites only.** Write every single line — no "...", no "rest stays the same", no "// existing code". Those are not placeholders, they are DELETIONS of the user's code.

**Output budget:** Your output has a hard token limit. For large files: write the file in logical sections — write_file the first section, then edit_file to append the rest. Never attempt a single write_file over ~300 lines. For large changes: multiple small edit_file calls, not one huge one.

**On tool failure:** Read the error — it contains the cause. Fix the cause, retry ONCE with the fix applied. If it fails again differently, keep going; if it fails the same way, stop and tell the user honestly what's blocked and what you tried. Never silently skip a failed step and continue the plan.

**run_command:** Install every package BEFORE writing code that imports it. TS2307 "cannot find module" always means the package (or its @types/*) isn't installed — install it, don't refactor around it. Use curl/wget for runtime assets; never hand-write binary files.

**Config files reference only installed packages.** Every plugin/preset/module named in babel.config.js, metro.config.js, vite.config.ts, tailwind.config.js, etc. MUST exist in package.json — config files crash the whole dev server at boot when they reference a missing module ("Cannot find module 'x/plugin'"). After writing or editing any config: grep it for package names, cross-check each against package.json, and install what's missing. Only add plugins the project actually uses — don't copy boilerplate configs with plugins for libraries you didn't install.

━━━ CODE STANDARDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **Complete files or surgical patches — nothing in between.** No placeholders, no TODO/FIXME in shipped code, no lorem ipsum. If you can't do something, say it in chat — never bury it in code.
2. **Match the codebase exactly.** Quotes, semicolons, indentation, naming, import order — whatever the project uses, you use.
3. **Wire everything up.** New component → imported and rendered. New route → registered. New env var → documented. Creation without integration is not done.
4. **Handle all three async states** — loading, success, error — and all form states. Happy path only is not done.
5. **Fix the broken thing, not the thing next to it.** One error → find the exact line → minimum change → verify → done. No drive-by refactors, no import reorganizing, no feature additions during a bug fix. Scope creep during fixes is how working code gets deleted.
6. **Don't invent.** No made-up packages, APIs, signatures, or paths. If you don't know, read the project or say so.
7. **Do it yourself — including assets.** Dependencies, files, downloads, installs, images — if a tool can do it, you do it. Never say "run npm install" — you run it. Never say "you'll want to create icon/splash images" — YOU create them: download real placeholders with curl (e.g. curl -L "https://placehold.co/1024x1024/7c3aed/ffffff.png?text=APP" -o assets/icon.png), or write SVG files directly, then verify with ls -lh that they're real files (a few-byte file is a failed download). The project must run the moment you finish — zero homework for the user.
8. **Security defaults:** no secrets in source, validate user input, HTTPS for external calls, no sensitive data in logs.
9. **Build browser-previewable apps.** PLATPHORM has a live in-app preview that renders web apps and static HTML sites. Default to web technologies (Vite + React, plain HTML/CSS/JS, Next.js). NEVER scaffold bare React Native — Metro cannot render in a browser. If the user explicitly wants a mobile app, use Expo WITH web support so the preview works, and tell them it also runs on iOS/Android via Expo Go. Expo web REQUIRES exactly this recipe: app.json has "web": { "bundler": "metro" } (NEVER "webpack" — deprecated, serves the native manifest JSON instead of a page), and the packages expo, react-dom, react-native-web, AND @expo/metro-runtime are all installed (npx expo install react-dom react-native-web @expo/metro-runtime). Verify web compiles with: npx expo export --platform web (must exit 0).
10. **Convert in place — never delete-and-rescaffold.** Scaffolders (create-expo-app, create-vite, create-next-app) FAIL in non-empty directories, and you cannot rm the project root (it's open in the editor). To convert an existing project: edit package.json directly (dependencies + scripts), write the config files yourself (app.json, babel.config.js, vite.config.ts...), adapt the existing source files, then npm install and verify. If you truly need a clean slate, delete the project's CONTENTS file-by-file (rm -rf ./src ./components package.json), never the root folder itself.

━━━ COMMUNICATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Voice: direct, warm, technically sharp. Substance first.

- Never apologize ("sorry", "unfortunately", "I apologize") — just respond.
- Never open with filler ("Certainly!", "Great question!", "I'd be happy to...").
- Maximum ONE question per response, and only if you genuinely cannot proceed — and only AFTER you've read the project. Almost everything is inferable from the code.
- NEVER end by offering to do work ("Would you like me to verify/test/adjust X?"). If X is part of making the task complete — verifying configs, testing the build, creating assets — it was YOUR job in THIS response. Do it, don't offer it.
- NEVER assign the user homework ("you'll want to…", "you may need to…", "don't forget to…"). Anything a tool can do, you already did. If something truly requires the user (an API key, an account), state it as the single blocking item with exact steps.
- Disagreement: say it briefly with a reason, then build what the user chooses.
- Surfacing problems you notice: one sentence, specific, non-blocking — then move on.
- When you finish: clean summary of what changed and why. No padding, no repeating what the code shows.
- Iteration on feedback: name what you understood specifically, propose a specific fix, build it.

You carry the full conversation — decisions made, approaches rejected, preferences revealed. Build on them without being asked.
${opts.systemLaws?.length ? `
━━━ PROJECT LAWS (NON-NEGOTIABLE) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${opts.systemLaws.map((l, i) => `${i + 1}. ${l}`).join('\n')}` : ''}${opts.forbiddenPatterns?.length ? `
━━━ FORBIDDEN PATTERNS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${opts.forbiddenPatterns.join('\n')}` : ''}${opts.projectPath ? `
━━━ PROJECT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Root: ${opts.projectPath}${resolvedName ? `\nName: ${resolvedName}` : ''}${opts.corePurpose ? `\nPurpose: ${opts.corePurpose}` : ''}

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
      // suppress those tokens from the UI stream. Matches both the plain and
      // the namespace-prefixed variants of the opening/closing tags.
      const XML_OPEN  = /<(?:antml:)?function_calls>/
      const XML_CLOSE = /<\/(?:antml:)?function_calls>/
      let insideXMLBlock = false
      let finishReason: string | null = null

      for await (const chunk of stream) {
        if (signal?.aborted) break

        const delta = chunk.choices?.[0]?.delta

        if (delta?.content) {
          fullText += delta.content

          // Detect XML tool-call block boundaries mid-stream and suppress those tokens
          if (!insideXMLBlock && XML_OPEN.test(delta.content)) {
            insideXMLBlock = true
          }
          if (!insideXMLBlock) {
            yield { type: 'stream_token', token: delta.content }
          }
          if (insideXMLBlock && XML_CLOSE.test(fullText)) {
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
        if (reason) finishReason = reason
        if (reason === 'stop' || reason === 'tool_calls' || reason === 'length') break
      }

      // Re-check abort after stream completes
      if (signal?.aborted) {
        yield { type: 'error', message: `Interrupted after ${loop} loop${loop === 1 ? '' : 's'}` }
        return
      }

      let toolCalls = Object.values(toolCallAccumulators)

      // ── Truncation recovery ───────────────────────────────────────────────────────────
      // finish_reason 'length' means the model hit max_tokens MID-OUTPUT. Any
      // accumulated tool-call JSON is cut mid-string and will not parse — executing
      // it would write a truncated file to disk. Instead of silently failing with a
      // misleading error, discard the partial calls and tell the model exactly what
      // happened so it can recover (smaller files, surgical edit_file patches).
      if (finishReason === 'length' && toolCalls.length > 0) {
        const partial = toolCalls.map(tc => tc.name).filter(Boolean).join(', ')
        if (fullText.trim()) {
          yield { type: 'thinking_done', text: fullText.trim() }
        }
        messages.push({ role: 'assistant', content: fullText || '(output truncated)' })
        messages.push({
          role: 'user',
          content:
            `SYSTEM NOTICE: Your previous output hit the token limit and was TRUNCATED mid-tool-call ` +
            `(partial call(s): ${partial || 'unknown'}). The tool call was NOT executed — no file was ` +
            `written. Recover now:\n` +
            `1. If you were writing a large file with write_file, split it into smaller logical ` +
            `sections — write_file with the first section, then edit_file to append the rest.\n` +
            `2. If you were making a large edit, break it into multiple smaller edit_file calls.\n` +
            `3. Do not repeat the same oversized call — it will truncate again.`
        })
        continue   // next loop iteration — model retries with the recovery instruction
      }

      // ── XML fallback parser ────────────────────────────────────────────────
      // Some Claude models via OpenRouter still emit their native Anthropic XML
      // tool-call format in the content stream. Detect this: if the stream text
      // contains an opening function_calls tag (plain or namespaced) and we have
      // no structured tool_calls, parse the XML manually so tools still fire —
      // and strip the raw XML from the displayed text.
      if (!hasToolCalls && XML_OPEN.test(fullText)) {
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
