import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawn, ChildProcess } from 'child_process'
import Store from 'electron-store'

// ── Preview dev-server process registry ──────────────────────────────────────
// Tracks one running dev server per project root path.
const previewProcesses = new Map<string, { proc: ChildProcess; port: number; url: string }>()

/**
 * Run `npm install` in a directory and wait for it to finish.
 * Used by preview:start to auto-install deps before starting the dev server.
 * Timeout: 5 min — cold-cache installs legitimately take minutes; warm installs return fast.
 */
function runNpmInstall(cwd: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Suppress npm funding/audit noise so we get clean output
        NPM_CONFIG_FUND: '0',
        NPM_CONFIG_AUDIT: '0',
        NPM_CONFIG_LOGLEVEL: 'error'
      }
    })

    let output = ''
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch {}
      resolve({ success: false, error: `npm install timed out after 5 minutes.\n${output.slice(-500)}` })
    }, 300_000)

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: `npm install exited with code ${code}.\n${output.slice(0, 800)}` })
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ success: false, error: String(err) })
    })
  })
}

/** Detect the dev-script to run for a given project (npm run dev, yarn dev, etc.). */
/**
 * Find the best runnable project root — checks the given path first, then
 * one level of subfolders. Returns the path + command to run, or null if
 * nothing runnable is found anywhere.
 */
function findRunnableProject(projectPath: string): {
  cwd: string; cmd: string; args: string[]
} | null {
  const PREFERRED = ['dev', 'start', 'serve', 'preview']

  const tryPath = (dir: string): { cwd: string; cmd: string; args: string[] } | null => {
    const pkgPath = path.join(dir, 'package.json')
    if (!fs.existsSync(pkgPath)) return null
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const scripts: Record<string, string> = pkg.scripts ?? {}
      for (const name of PREFERRED) {
        if (scripts[name]) {
          const useYarn = fs.existsSync(path.join(dir, 'yarn.lock'))
          const usePnpm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))
          const pm = useYarn ? 'yarn' : usePnpm ? 'pnpm' : 'npm'
          return { cwd: dir, cmd: pm, args: ['run', name] }
        }
      }
      // package.json exists but no script — check for local vite binary
      const viteLocal = path.join(dir, 'node_modules', '.bin', 'vite')
      if (fs.existsSync(viteLocal)) return { cwd: dir, cmd: viteLocal, args: [] }
    } catch {}
    return null
  }

  // 1. Try the root first
  const root = tryPath(projectPath)
  if (root) return root

  // 2. Search one level of subfolders (website/, client/, app/, frontend/, etc.)
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const sub = tryPath(path.join(projectPath, entry.name))
      if (sub) return sub
    }
  } catch {}

  return null
}

function detectDevCommand(projectPath: string): { cmd: string; args: string[] } {
  const result = findRunnableProject(projectPath)
  if (result) return { cmd: result.cmd, args: result.args }
  return { cmd: 'npm', args: ['run', 'dev'] }
}

/** Check if a TCP port is accepting connections on localhost */
function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net')
    const sock = net.createConnection({ port, host: '127.0.0.1' })
    sock.setTimeout(300)
    sock.on('connect', () => { sock.destroy(); resolve(true) })
    sock.on('error', () => resolve(false))
    sock.on('timeout', () => { sock.destroy(); resolve(false) })
  })
}

// Common dev-server ports. Vite: 5173 (+5174... when busy). Next/CRA: 3000.
const CANDIDATE_PORTS = [5173, 5174, 5175, 3000, 3001, 3002, 4000, 4173, 8080, 8000, 8888, 5000, 5001, 4321]

/** Snapshot which candidate ports are ALREADY open (e.g. PLATPHORM's own dev server). */
async function snapshotOpenPorts(): Promise<Set<number>> {
  const open = new Set<number>()
  await Promise.all(CANDIDATE_PORTS.map(async (p) => {
    if (await isPortOpen(p)) open.add(p)
  }))
  return open
}

/** Try to parse the dev server's printed URL (Vite/Next/CRA all print one). */
function parsePortFromOutput(output: string): number | null {
  const m = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/)
  if (m) {
    const port = parseInt(m[1], 10)
    if (port > 0 && port < 65536) return port
  }
  return null
}

/**
 * Poll for a NEWLY opened dev-server port until timeout.
 * `ignore` is the set of ports that were already open before we spawned the
 * server — critically, this excludes PLATPHORM's own dev server (5173 in dev
 * mode), which previously caused the preview to "detect" PLATPHORM itself and
 * render a blank screen.
 * `getOutput` lets us check the server's own printed URL first — the most
 * reliable signal, and it catches ports outside the candidate list.
 */
async function detectNewPort(
  timeoutMs: number,
  ignore: Set<number>,
  getOutput: () => string
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // 1. Most reliable: the URL the server itself printed
    const printed = parsePortFromOutput(getOutput())
    if (printed && !ignore.has(printed) && await isPortOpen(printed)) return printed
    // 2. Fallback: scan candidate ports, skipping pre-existing ones
    for (const port of CANDIDATE_PORTS) {
      if (ignore.has(port)) continue
      if (await isPortOpen(port)) return port
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

// Persistent settings store — lives in the OS user-data directory,
// never in source control. API keys are stored here so they survive restarts.
const store = new Store<{
  providers: { openrouter?: string; anthropic?: string; openai?: string }
  preferredProvider: string
  fontSize: number
  fontFamily: string
}>({
  name: 'platphorm-settings',
  defaults: {
    providers: {},
    preferredProvider: 'openrouter',
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
  }
})

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      webviewTag: true,         // <webview> renders the live preview in-app (own process, no cross-origin iframe limits)
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.platphorm.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpcHandlers(): void {
  // File system operations
  ipcMain.handle('fs:openFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      return entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(dirPath, e.name)
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:exists', async (_event, filePath: string) => {
    return fs.existsSync(filePath)
  })

  ipcMain.handle('fs:mkdir', async (_event, dirPath: string) => {
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:getHome', async () => {
    return os.homedir()
  })

  // ── Persistent settings (electron-store) ──────────────────────────────────
  // API keys are stored in the OS user-data directory — never in source control.

  ipcMain.handle('store:get', (_event, key: string) => {
    return store.get(key)
  })

  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key, value)
    return { success: true }
  })

  ipcMain.handle('store:delete', (_event, key: string) => {
    store.delete(key as any)
    return { success: true }
  })

  ipcMain.handle('store:getAll', () => {
    return store.store
  })

  // ── Live preview: spawn dev server ────────────────────────────────────────
  ipcMain.handle('preview:start', async (_event, projectPath: string) => {
    // Kill any existing server for this project
    const existing = previewProcesses.get(projectPath)
    if (existing) {
      try { existing.proc.kill('SIGTERM') } catch {}
      previewProcesses.delete(projectPath)
    }

    const runnable = findRunnableProject(projectPath)
    if (!runnable) {
      return {
        success: false,
        error: 'No runnable project found. Make sure the project has a package.json with a "dev" or "start" script and dependencies are installed (npm install).'
      }
    }

    const { cwd: runnableCwd, cmd, args } = runnable

    // Auto-install dependencies if node_modules is missing.
    // The user should never have to run npm install manually — we do it for them.
    const nodeModulesPath = path.join(runnableCwd, 'node_modules')
    if (!fs.existsSync(nodeModulesPath)) {
      const installResult = await runNpmInstall(runnableCwd)
      if (!installResult.success) {
        return {
          success: false,
          error: `Auto-install failed in ${runnableCwd}:\n${installResult.error}`
        }
      }
    }

    // Snapshot ports that are already open BEFORE spawning — anything in this
    // set (including PLATPHORM's own dev server) must not be mistaken for the
    // user's server.
    const preExistingPorts = await snapshotOpenPorts()

    let startupError = ''
    const proc = spawn(cmd, args, {
      cwd: runnableCwd,
      env: {
        ...process.env,
        BROWSER: 'none',
        VITE_OPEN: 'false',
        NEXT_TELEMETRY_DISABLED: '1'
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    // Capture startup output — used both to parse the server's printed URL and
    // to report errors if the server never opens a port.
    proc.stdout?.on('data', (d: Buffer) => { startupError += d.toString().slice(0, 500) })
    proc.stderr?.on('data', (d: Buffer) => { startupError += d.toString().slice(0, 500) })
    proc.on('error', () => {})   // prevent unhandled error crashes

    // Give the process 1.5s to start, then detect the NEW port (parsed from the
    // server's own output first, then candidate-port scan excluding ports that
    // were already open — e.g. PLATPHORM's own dev server).
    await new Promise(r => setTimeout(r, 1500))

    const port = await detectNewPort(28_500, preExistingPorts, () => startupError)   // 1.5s already spent = 30s total

    if (!port) {
      try { proc.kill('SIGTERM') } catch {}
      const detail = startupError.trim()
        ? `\n\nServer output:\n${startupError.slice(0, 600).trim()}`
        : ''
      return {
        success: false,
        error: `Dev server did not open a port within 30s. Make sure npm install is complete and the project has a dev script in package.json.${detail}`
      }
    }

    const url = `http://localhost:${port}`
    previewProcesses.set(projectPath, { proc, port, url })
    return { success: true, port, url }
  })

  // ── Live preview: stop dev server ─────────────────────────────────────────
  ipcMain.handle('preview:stop', async (_event, projectPath: string) => {
    const existing = previewProcesses.get(projectPath)
    if (existing) {
      existing.proc.kill('SIGTERM')
      previewProcesses.delete(projectPath)
    }
    return { success: true }
  })

  // ── Live preview: status ──────────────────────────────────────────────────
  ipcMain.handle('preview:status', async (_event, projectPath: string) => {
    const existing = previewProcesses.get(projectPath)
    if (!existing) return { running: false }
    return { running: true, port: existing.port, url: existing.url }
  })

  // Kill all preview servers on app quit
  app.on('before-quit', () => {
    for (const { proc } of previewProcesses.values()) {
      try { proc.kill('SIGTERM') } catch {}
    }
  })

  // ── Shell utilities ───────────────────────────────────────────────────────
  // electronAPI from @electron-toolkit/preload does NOT expose shell.
  // We route safe operations through IPC handlers instead.

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
      return { success: true }
    }
    return { success: false, error: 'Only http/https URLs are supported' }
  })

  // ── shell:runCommand — executes a shell command in a project directory ────
  // Used by the agent for: npm install, npx tsc --noEmit, git status, etc.
  //
  // Security model:
  // 1. The command is split on shell separators (&&, ||, ;, |) and EVERY
  //    segment must start with an allowlisted prefix — a single allowed prefix
  //    can no longer smuggle a second arbitrary command behind it.
  // 2. Destructive patterns are explicitly blocked regardless of allowlist
  //    (rm targeting paths outside cwd, sudo, shutdown, eval-style node, etc.).
  // 3. Real exit codes are reported. A non-zero exit is success:false — the
  //    agent must never be told a failed install/build succeeded.
  const ALLOWED_COMMAND_PREFIXES = [
    'npm ', 'npx ', 'yarn ', 'pnpm ', 'node ',
    'git status', 'git diff', 'git log', 'git add', 'git commit', 'git init',
    'which ', 'ls', 'cat ', 'head ', 'tail ', 'wc ',
    'curl ', 'wget ',
    'mkdir ', 'cp ', 'mv ', 'rm ',
    'touch ', 'echo ', 'find ', 'grep '
  ]

  // Patterns that are never allowed, regardless of prefix allowlist.
  const BLOCKED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
    { re: /\bsudo\b/,                          reason: 'sudo is not allowed' },
    { re: /\brm\s+(-\w*[rf]\w*\s+)*(\/|~)/,    reason: 'rm targeting absolute or home paths is not allowed — rm only within the project' },
    { re: /\bnode\s+(-e|--eval|-p|--print)\b/, reason: 'node eval flags are not allowed — write a script file and run it' },
    { re: /\b(shutdown|reboot|halt|mkfs|dd)\b/, reason: 'system-level commands are not allowed' },
    { re: />\s*\/(etc|usr|bin|sbin|var|boot)\//, reason: 'redirecting output into system directories is not allowed' },
    { re: /\bchmod\s+777\b/,                   reason: 'chmod 777 is not allowed' },
    { re: /\$\(|`/,                            reason: 'command substitution is not allowed' }
  ]

  function validateCommand(command: string, cwd: string): { ok: boolean; reason?: string } {
    for (const { re, reason } of BLOCKED_PATTERNS) {
      if (re.test(command)) return { ok: false, reason }
    }
    // Validate every segment of a chained command, not just the first.
    const segments = command.split(/&&|\|\||;|\|/).map(s => s.trim()).filter(Boolean)
    if (!segments.length) return { ok: false, reason: 'empty command' }
    for (const seg of segments) {
      // `cd` segments: relative paths are always fine (cwd is already contained),
      // absolute paths are allowed ONLY if they resolve inside the project root.
      const cdMatch = seg.match(/^cd\s+("[^"]+"|'[^']+'|\S+)$/)
      if (cdMatch) {
        const target = cdMatch[1].replace(/^["']|["']$/g, '')
        if (target.startsWith('~')) {
          return { ok: false, reason: `cd into home-relative path is not allowed: "${target}"` }
        }
        if (path.isAbsolute(target)) {
          const resolvedTarget = path.resolve(target)
          const resolvedRoot = path.resolve(cwd)
          if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
            return {
              ok: false,
              reason: `cd outside the project root is not allowed: "${target}". ` +
                `Commands already run from the project root (${cwd}) — use relative paths, e.g. "cd subfolder && npm install".`
            }
          }
        }
        continue
      }
      const allowed = ALLOWED_COMMAND_PREFIXES.some(p =>
        seg.startsWith(p) || seg === p.trim()
      )
      if (!allowed) return { ok: false, reason: `segment not in allowlist: "${seg.slice(0, 60)}"` }
    }
    return { ok: true }
  }

  // Long-running operations (installs, builds) legitimately exceed 60s on cold
  // caches. 5 minutes for those; 90s for everything else.
  function commandTimeout(command: string): number {
    return /\b(install|build|create|init|add)\b/.test(command) ? 300_000 : 90_000
  }

  ipcMain.handle('shell:runCommand', async (_event, cwd: string, command: string) => {
    const verdict = validateCommand(command, cwd)
    if (!verdict.ok) {
      return { success: false, error: `Command rejected: ${verdict.reason}` }
    }
    // Containment: cwd must exist and be a directory.
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      return { success: false, error: `Working directory does not exist: ${cwd}` }
    }

    return new Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }>((resolve) => {
      const proc = spawn(command, [], {
        cwd,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NPM_CONFIG_FUND: '0', NPM_CONFIG_AUDIT: '0' }
      })

      let output = ''
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

      const ms = commandTimeout(command)
      const timeout = setTimeout(() => {
        try { proc.kill('SIGTERM') } catch {}
        resolve({
          success: false,
          error: `Command timed out after ${Math.round(ms / 1000)}s`,
          output: output.slice(-2000)
        })
      }, ms)

      proc.on('close', (code) => {
        clearTimeout(timeout)
        // Honest exit codes — a non-zero exit is a FAILURE. The agent must see
        // the real outcome or it will build on top of broken installs.
        if (code === 0) {
          resolve({ success: true, output: output.slice(-3000), exitCode: 0 })
        } else {
          resolve({
            success: false,
            exitCode: code ?? -1,
            error: `Command exited with code ${code}`,
            output: output.slice(-3000)
          })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({ success: false, error: String(err), output: output.slice(-2000) })
      })
    })
  })
}
